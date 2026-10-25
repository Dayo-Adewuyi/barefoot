/**
 * End-to-end smoke test in mock mode (no network, no real money).
 * Starts the server, talks to it over MCP exactly as Chord would, and walks the
 * demo story plus its failure paths.
 *
 *   npm run smoke
 */
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = 18787;
const TOKEN = "smoke-test-token";
const BASE = `http://127.0.0.1:${PORT}`;
const dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fca-")), "ledger.json");

const server = spawn("npx", ["tsx", "src/index.ts"], {
  env: { ...process.env, PORT: String(PORT), MCP_BEARER_TOKEN: TOKEN, PAYSTACK_SECRET_KEY: "", PUBLIC_BASE_URL: BASE, DATA_FILE: dataFile },
  stdio: ["ignore", "pipe", "inherit"],
});
let logs = "";
server.stdout.on("data", (b) => (logs += b.toString()));

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (!cond) {
    console.error(`FAIL  ${label}`, detail ?? "");
    server.kill();
    process.exit(1);
  }
  passed++;
  console.log(`ok    ${label}`);
}

async function main() {
  for (let i = 0; i < 50 && !logs.includes("Barefoot MCP on"); i++) await wait(200);
  check("server started", logs.includes("paystack=mock"), logs);

  // Auth is enforced.
  const noAuth = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  check("rejects a request without the bearer token", noAuth.status === 401);

  const client = new Client({ name: "smoke", version: "0.0.1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } }),
  );

  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  check("lists 8 tools", tools.length === 8, tools);

  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    return { isError: Boolean(r.isError), body: JSON.parse(r.content[0].text) };
  };

  // 1. Stock lookup
  const stock = await call("check_stock", { worker_code: "CHW-001", item: "ACT" });
  check("check_stock finds ACT packs", stock.body.items.length === 3, stock.body);
  check("check_stock returns the worker's cadre", stock.body.cadre === "CHEW", stock.body);

  // Privacy guard: a name instead of a patient code is rejected by the schema.
  const named = (await client.callTool({ name: "create_payment_link", arguments: { worker_code: "CHW-001", patient_code: "Aisha Bello", sku: "ACT-CHILD" } })) as { isError?: boolean };
  check("rejects a patient name instead of a code", Boolean(named.isError));

  // 2. Sponsor payment
  const link = await call("request_sponsor_payment", { worker_code: "CHW-001", patient_code: "P-1042", sku: "ACT-CHILD", sponsor_relationship: "mother's son" });
  check("sponsor link created", !link.isError && link.body.amount_ngn === 1500, link.body);
  check("forward message has no patient name", /ref P-1042/.test(link.body.message_to_forward), link.body.message_to_forward);
  const ref = link.body.reference as string;

  const dup = await call("create_payment_link", { worker_code: "CHW-001", patient_code: "P-1042", sku: "ACT-CHILD" });
  check("reuses the open link instead of double charging", dup.body.reused_existing_link === true && dup.body.reference === ref, dup.body);

  // 3. Not paid yet -> no dispense
  const early = await call("verify_payment", { reference: ref });
  check("unpaid link verifies as pending", early.body.status === "pending", early.body);
  const blocked = await call("record_dispense", { reference: ref });
  check("dispense blocked before payment", blocked.isError && blocked.body.error_code === "not_paid", blocked.body);

  // 4. Sponsor pays on the mock checkout page
  const pay = await fetch(`${BASE}/mock/pay/${ref}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "outcome=success" });
  check("mock checkout accepts payment", pay.ok);
  const paid = await call("verify_payment", { reference: ref });
  check("payment verifies as success", paid.body.status === "success", paid.body);
  const again2 = await call("create_payment_link", { worker_code: "CHW-001", patient_code: "P-1042", sku: "ACT-CHILD" });
  check("paid but undispensed item gets no new link", again2.body.already_paid === true && again2.body.reference === ref, again2.body);

  // 5. Dispense, idempotently
  const disp = await call("record_dispense", { reference: ref });
  check("dispense recorded with receipt", /^RCPT-/.test(disp.body.receipt), disp.body);
  check("stock crossed reorder level", disp.body.low_stock === true && disp.body.qty_remaining === 3, disp.body);
  const again = await call("record_dispense", { reference: ref });
  check("second dispense returns same receipt", again.body.already_dispensed === true && again.body.receipt === disp.body.receipt, again.body);
  const noRefund = await call("refund_payment", { reference: ref, reason: "test" });
  check("refund refused after dispensing", noRefund.isError && noRefund.body.error_code === "already_dispensed", noRefund.body);

  // 6. Failed payment path
  const l2 = await call("create_payment_link", { worker_code: "CHW-001", patient_code: "P-2001", sku: "RDT-MAL" });
  await fetch(`${BASE}/mock/pay/${l2.body.reference}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "outcome=failed" });
  const failed = await call("verify_payment", { reference: l2.body.reference });
  check("declined card verifies as failed with a reason", failed.body.status === "failed" && Boolean(failed.body.gateway_message), failed.body);

  // 7. Out of stock: CHW-002 has no child ACT
  const oos = await call("create_payment_link", { worker_code: "CHW-002", patient_code: "P-3001", sku: "ACT-CHILD" });
  check("no payment taken for an out-of-stock item", oos.isError && oos.body.error_code === "out_of_stock", oos.body);

  // 8. Paid, then stock vanished -> refund
  const l3 = await call("create_payment_link", { worker_code: "CHW-002", patient_code: "P-3002", sku: "RDT-MAL", quantity: 2 });
  const l4 = await call("create_payment_link", { worker_code: "CHW-002", patient_code: "P-3003", sku: "RDT-MAL", quantity: 2 });
  for (const r of [l3.body.reference, l4.body.reference]) {
    await fetch(`${BASE}/mock/pay/${r}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "outcome=success" });
    await call("verify_payment", { reference: r });
  }
  await call("record_dispense", { reference: l3.body.reference });
  const gone = await call("record_dispense", { reference: l4.body.reference });
  check("dispense fails cleanly when stock ran out after payment", gone.isError && gone.body.error_code === "out_of_stock", gone.body);
  const refund = await call("refund_payment", { reference: l4.body.reference, reason: "ran out after payment" });
  check("refund succeeds", refund.body.status === "refunded", refund.body);

  // 9. Emergency referral skips the full hospital
  const refl = await call("create_referral", { worker_code: "CHW-001", patient_code: "P-1042", urgency: "emergency", reason: "convulsions" });
  check("emergency referral skips the hospital not accepting", refl.body.facility.name === "Demo General Hospital B" && refl.body.skipped.length === 1, refl.body);

  await client.close();
  server.kill();
  console.log(`\n${passed} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  console.error(logs);
  server.kill();
  process.exit(1);
});
