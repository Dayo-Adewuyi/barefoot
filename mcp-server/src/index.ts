import crypto from "node:crypto";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./config.js";
import { Store } from "./store.js";
import { Paystack, validPaystackSignature } from "./paystack.js";
import { MockGateway, mockCheckoutRouter } from "./mock-checkout.js";
import { Clinic } from "./clinic.js";
import { registerTools } from "./tools.js";
import { chordRelayEnabled, forwardToChord } from "./chord-relay.js";

const store = new Store(config.dataFile, config.seedFile);
const gateway = config.paystack.secretKey ? new Paystack(config.paystack.secretKey) : new MockGateway(store);
const clinic = new Clinic(store, gateway);

function buildServer(): McpServer {
  const server = new McpServer({ name: "barefoot", version: "0.1.0" });
  registerTools(server, clinic);
  return server;
}

const app = express();
app.disable("x-powered-by");

// Request log: method, path, status, duration. Never bodies or headers (secrets).
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on("finish", () => console.log(`${req.method} ${req.path} -> ${res.statusCode} ${Date.now() - t0}ms`));
  next();
});

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, paystack_mode: clinic.paymentMode, chord_relay: chordRelayEnabled() });
});

function requireBearer(req: Request, res: Response, next: NextFunction) {
  if (!config.mcpBearerToken) return next(); // local dev only
  const header = req.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(config.mcpBearerToken);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
}

app.post("/mcp", requireBearer, express.json({ limit: "1mb" }), async (req, res) => {
  // Stateless: a fresh server + transport per request. Chord sends JSON POSTs and
  // accepts JSON or SSE responses.
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request failed:", err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

const methodNotAllowed = (_req: Request, res: Response) => {
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
};
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

async function onPaymentConfirmed(reference: string, source: string) {
  const p = await clinic.reconcile(reference).catch((e) => {
    console.error(`[${source}] reconcile failed for ${reference}:`, (e as Error).message);
    return undefined;
  });
  if (!p) return;
  console.log(`[${source}] ${reference} -> ${p.status}`);
  if (p.status !== "success" || !chordRelayEnabled()) return;
  await forwardToChord({
    event_type: "payment.verified",
    event_id: `payment:${reference}`, // stable id, so Chord dedupes redeliveries
    data: {
      reference,
      worker_code: p.worker_code,
      patient_code: p.patient_code,
      sku: p.sku,
      quantity: p.quantity,
      amount_ngn: p.amount_kobo / 100,
      payer: p.payer,
      sponsor_relationship: p.sponsor_relationship,
    },
  });
}

// Paystack webhook: raw body is required for the HMAC-SHA512 signature check.
app.post("/webhooks/paystack", express.raw({ type: "*/*", limit: "256kb" }), (req, res) => {
  const raw = req.body as Buffer;
  if (!validPaystackSignature(raw, req.get("x-paystack-signature"))) {
    res.sendStatus(401);
    return;
  }
  res.sendStatus(200); // acknowledge fast; do the work after
  try {
    const event = JSON.parse(raw.toString("utf8")) as { event?: string; data?: { reference?: string } };
    if (event.event === "charge.success" && event.data?.reference) {
      void onPaymentConfirmed(event.data.reference, "paystack-webhook");
    }
  } catch {
    console.error("[paystack-webhook] unparseable body");
  }
});

// Where Paystack sends the payer after checkout (PAYSTACK_CALLBACK_URL). It
// claims nothing: the webhook and verify_payment decide whether it was paid.
app.get("/paid", (_req, res) => {
  res.sendFile(path.resolve("public/paid.html"));
});

if (gateway instanceof MockGateway) {
  app.use(mockCheckoutRouter(store, (ref) => void onPaymentConfirmed(ref, "mock-pay")));
}

await store.load();
app.listen(config.port, config.host, () => {
  console.log(`Barefoot MCP on :${config.port} (paystack=${clinic.paymentMode}, chord_relay=${chordRelayEnabled()}, auth=${config.mcpBearerToken ? "bearer" : "none"})`);
});
