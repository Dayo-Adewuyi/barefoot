/**
 * In-process tests of the Clinic interface: no server, no network. Each test
 * gets a fresh ledger seeded from data/seed.json.
 *
 *   npx tsx test/clinic.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Clinic, ClinicError } from "../src/clinic.js";
import { MockGateway } from "../src/mock-checkout.js";
import type { PaymentGateway } from "../src/paystack.js";
import { Store } from "../src/store.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clinic-"));
let n = 0;

async function setup(gateway?: (store: Store) => PaymentGateway) {
  const store = new Store(path.join(dir, `ledger-${n++}.json`), "data/seed.json");
  await store.load();
  const clinic = new Clinic(store, gateway ? gateway(store) : new MockGateway(store));
  const pay = (ref: string, outcome: "success" | "failed" | "abandoned" = "success") =>
    store.write((d) => {
      d.mock_outcomes[ref] = outcome;
    });
  return { store, clinic, pay };
}

const order = { worker_code: "CHW-001", patient_code: "P-1042", sku: "ACT-CHILD", quantity: 1, payer: "caregiver" as const };

async function rejectsWith(code: string, p: Promise<unknown> | (() => unknown)) {
  await assert.rejects(async () => (typeof p === "function" ? p() : p), (e) => e instanceof ClinicError && e.code === code);
}

const tests: Record<string, () => Promise<void>> = {
  async "unknown worker is a ClinicError, not a crash"() {
    const { clinic } = await setup();
    await rejectsWith("unknown_worker", () => clinic.checkStock("CHW-999"));
  },

  async "no payment is taken for an item out of stock"() {
    const { clinic } = await setup();
    await rejectsWith("out_of_stock", clinic.requestPayment({ ...order, worker_code: "CHW-002" }));
  },

  async "a second request reuses the open link"() {
    const { clinic } = await setup();
    const first = await clinic.requestPayment(order);
    const second = await clinic.requestPayment(order);
    assert.equal(second.reference, first.reference);
    assert.ok("reused_existing_link" in second);
  },

  async "sponsor gets no pay message for an item already paid"() {
    const { clinic, pay } = await setup();
    const link = await clinic.requestSponsorPayment({ ...order, sponsor_relationship: "aunt" });
    assert.ok("message_to_forward" in link);
    assert.match(link.message_to_forward, /ref P-1042/);
    await pay(link.reference);
    await clinic.verifyPayment(link.reference);
    const again = await clinic.requestSponsorPayment({ ...order, sponsor_relationship: "aunt" });
    assert.ok("already_paid" in again && !("message_to_forward" in again));
  },

  async "dispense requires a verified payment, then is idempotent"() {
    const { clinic, pay } = await setup();
    const { reference } = await clinic.requestPayment(order);
    await rejectsWith("not_paid", clinic.dispense(reference));
    await pay(reference);
    assert.equal((await clinic.verifyPayment(reference)).status, "success");
    const first = await clinic.dispense(reference);
    const second = await clinic.dispense(reference);
    assert.equal(second.receipt, first.receipt);
    assert.equal(clinic.checkStock("CHW-001", "ACT").items.find((i) => i.sku === "ACT-CHILD")!.qty_on_hand, 3);
  },

  async "concurrent dispenses decrement stock once"() {
    const { clinic, pay } = await setup();
    const { reference } = await clinic.requestPayment(order);
    await pay(reference);
    await clinic.verifyPayment(reference);
    const [a, b] = await Promise.all([clinic.dispense(reference), clinic.dispense(reference)]);
    assert.equal(a.receipt, b.receipt);
    assert.equal(clinic.checkStock("CHW-001", "ACT").items.find((i) => i.sku === "ACT-CHILD")!.qty_on_hand, 3);
  },

  async "refund is refused after dispense and allowed before it"() {
    const { clinic, pay } = await setup();
    const a = await clinic.requestPayment(order);
    const b = await clinic.requestPayment({ ...order, patient_code: "P-2002" });
    for (const r of [a.reference, b.reference]) {
      await pay(r);
      await clinic.verifyPayment(r);
    }
    await clinic.dispense(a.reference);
    await rejectsWith("already_dispensed", clinic.refund(a.reference, "test"));
    assert.equal((await clinic.refund(b.reference, "ran out")).status, "refunded");
    await rejectsWith("not_paid", clinic.dispense(b.reference));
  },

  async "a gateway amount that does not match is never treated as paid"() {
    const { clinic } = await setup(() => ({
      mode: "mock",
      initialize: async () => ({ authorization_url: "http://pay" }),
      verify: async () => ({ found: true, status: "success", amount_kobo: 100, currency: "NGN" }),
      refund: async () => {},
    }));
    const { reference } = await clinic.requestPayment(order);
    assert.equal((await clinic.verifyPayment(reference)).status, "amount_mismatch");
    await rejectsWith("not_paid", clinic.dispense(reference));
  },

  async "a gateway outage is a ClinicError and leaves the payment pending"() {
    const { clinic, store } = await setup((s) => {
      const mock = new MockGateway(s);
      return { mode: "mock", initialize: (a) => mock.initialize(a), verify: async () => Promise.reject(new Error("timeout")), refund: async () => {} };
    });
    const { reference } = await clinic.requestPayment(order);
    await rejectsWith("gateway_error", clinic.verifyPayment(reference));
    assert.equal(store.read((d) => d.payments[0].status), "pending");
  },

  async "emergency referral skips a hospital not accepting patients"() {
    const { clinic } = await setup();
    const r = await clinic.refer({ worker_code: "CHW-001", patient_code: "P-1042", urgency: "emergency", reason: "convulsions" });
    assert.equal(r.facility.name, "Demo General Hospital B");
    assert.equal(r.skipped.length, 1);
  },
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try {
    await fn();
    console.log(`ok    ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL  ${name}\n`, err);
  }
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} failed.` : `\n${Object.keys(tests).length} checks passed.`);
process.exit(failed ? 1 : 0);
