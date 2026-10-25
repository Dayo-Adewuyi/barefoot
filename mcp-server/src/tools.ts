import crypto from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config } from "./config.js";
import { Paystack, PaystackError } from "./paystack.js";
import { reconcilePayment } from "./payments.js";
import type { Payment, Store, StockItem } from "./store.js";

// ---------- shared schemas and helpers ----------

const workerCode = z
  .string()
  .regex(/^CHW-\d{3}$/, "Worker codes look like CHW-001")
  .describe("The health worker's code, e.g. CHW-001");

const patientCode = z
  .string()
  .regex(/^P-\d{3,6}$/, "Use the pseudonymous patient code, e.g. P-1042. Never a name or phone number.")
  .describe("Pseudonymous patient code, e.g. P-1042. Never a name or phone number.");

const reference = z.string().min(6).max(100).describe("Payment reference returned by create_payment_link");

type Json = Record<string, unknown>;

function ok(payload: Json) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

/** Tool-level failure the agent must handle (not a crash). */
function fail(error_code: string, message: string, next_step: string, extra: Json = {}) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ error_code, message, next_step, ...extra }, null, 2) }],
  };
}

const ngn = (kobo: number) => Math.round(kobo) / 100;
const shortId = (prefix: string) => `${prefix}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

function stockView(item: StockItem) {
  return {
    sku: item.sku,
    name: item.name,
    unit: item.unit,
    price_ngn: item.price_ngn,
    qty_on_hand: item.qty,
    in_stock: item.qty > 0,
    low_stock: item.qty <= item.reorder_level,
  };
}

function paymentView(p: Payment) {
  return {
    reference: p.reference,
    status: p.status,
    patient_code: p.patient_code,
    sku: p.sku,
    quantity: p.quantity,
    amount_ngn: ngn(p.amount_kobo),
    payer: p.payer,
    sponsor_relationship: p.sponsor_relationship,
    payment_link: p.authorization_url,
    created_at: p.created_at,
    verified_at: p.verified_at,
    dispensed_receipt: p.dispensed_receipt,
    gateway_message: p.gateway_message,
  };
}

// ---------- registration ----------

export function registerTools(server: McpServer, store: Store, paystack: Paystack): void {
  const findWorker = (code: string) => store.read((d) => d.workers.find((w) => w.code === code));
  const findItem = (worker: string, sku: string) =>
    store.read((d) => (d.stock[worker] ?? []).find((i) => i.sku === sku));

  // ---- check_stock ----
  server.registerTool(
    "check_stock",
    {
      title: "Check stock and price",
      description:
        "List the medicines and tests a health worker has on hand, with the fixed price in naira. " +
        "Pass `item` to search (e.g. 'ACT', 'malaria test', 'ORS'). Only recommend items returned here.",
      inputSchema: {
        worker_code: workerCode,
        item: z.string().max(60).optional().describe("Optional search text, e.g. 'ACT child' or 'RDT'"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ worker_code, item }) => {
      const worker = findWorker(worker_code);
      if (!worker) {
        return fail("unknown_worker", `No health worker with code ${worker_code}.`, "Ask the worker to confirm their CHW code.");
      }
      const all = store.read((d) => d.stock[worker_code] ?? []);
      const q = item?.toLowerCase().trim();
      const matches = q
        ? all.filter((i) => i.name.toLowerCase().includes(q) || i.keywords.some((k) => q.includes(k) || k.includes(q)))
        : all;
      return ok({
        worker_code,
        cadre: worker.cadre,
        query: item ?? null,
        items: matches.map(stockView),
        note: matches.length ? undefined : "No matching item in this worker's stock. Do not recommend it; refer if it is needed.",
      });
    },
  );

  // ---- create_payment_link / request_sponsor_payment ----
  async function createPayment(args: {
    worker_code: string;
    patient_code: string;
    sku: string;
    quantity: number;
    payer: "caregiver" | "sponsor";
    sponsor_relationship?: string;
  }) {
    if (!findWorker(args.worker_code)) {
      return fail("unknown_worker", `No health worker with code ${args.worker_code}.`, "Ask the worker to confirm their CHW code.");
    }
    const item = findItem(args.worker_code, args.sku);
    if (!item) {
      return fail("unknown_item", `SKU ${args.sku} is not in ${args.worker_code}'s stock.`, "Call check_stock and use a sku it returns.");
    }
    if (item.qty < args.quantity) {
      return fail("out_of_stock", `${item.name}: only ${item.qty} on hand.`, "Do not take payment. Offer a referral or another vendor.", {
        qty_on_hand: item.qty,
      });
    }

    // No double charging for the same worker, patient and item: a payment that is
    // already paid but not yet dispensed wins, then an open pending link.
    const ttlMs = config.paymentLinkTtlHours * 3600_000;
    const recent = store.read((d) =>
      d.payments.filter(
        (p) =>
          p.worker_code === args.worker_code &&
          p.patient_code === args.patient_code &&
          p.sku === args.sku &&
          Date.now() - Date.parse(p.created_at) < ttlMs,
      ),
    );
    const paid = recent.find((p) => p.status === "success" && !p.dispensed_receipt && !p.refunded_at);
    if (paid) {
      return ok({
        already_paid: true,
        ...paymentView(paid),
        next_step: "Do NOT send a new link. This item is already paid. Call record_dispense with this reference.",
      });
    }
    const existing = recent.find((p) => p.status === "pending");
    if (existing) {
      return ok({ reused_existing_link: true, ...paymentView(existing), message_for_worker: "A link for this item is already open. Use the same one." });
    }

    const ref = `bf_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
    const amount_kobo = item.price_ngn * 100 * args.quantity;
    const email = `${args.patient_code.toLowerCase()}.${args.worker_code.toLowerCase()}@${config.paystack.payerEmailDomain}`;

    let init;
    try {
      init = await paystack.initialize({
        reference: ref,
        amount_kobo,
        email,
        metadata: {
          worker_code: args.worker_code,
          patient_code: args.patient_code,
          sku: args.sku,
          quantity: args.quantity,
          payer: args.payer,
          sponsor_relationship: args.sponsor_relationship,
          custom_fields: [
            { display_name: "Item", variable_name: "item", value: item.name },
            { display_name: "Patient code", variable_name: "patient_code", value: args.patient_code },
          ],
        },
      });
    } catch (err) {
      const e = err as PaystackError;
      console.error(`[paystack] initialize failed (HTTP ${e.httpStatus ?? "?"}): ${e.message}`);
      return fail("gateway_error", `Could not create the payment link: ${e.message}`, "Tell the worker payment is unavailable right now and to try again in a few minutes. Do not release the medicine.");
    }

    const payment: Payment = {
      reference: ref,
      worker_code: args.worker_code,
      patient_code: args.patient_code,
      sku: args.sku,
      quantity: args.quantity,
      amount_kobo,
      currency: "NGN",
      payer: args.payer,
      sponsor_relationship: args.sponsor_relationship,
      authorization_url: init.authorization_url,
      status: "pending",
      created_at: new Date().toISOString(),
    };
    await store.write((d) => {
      d.payments.push(payment);
    });
    return ok({ ...paymentView(payment), item_name: item.name, expires_in_hours: config.paymentLinkTtlHours, paystack_mode: paystack.mode });
  }

  server.registerTool(
    "create_payment_link",
    {
      title: "Create a payment link (caregiver pays now)",
      description:
        "Create a Paystack payment link for one stocked item for a patient, paid by the caregiver on the spot. " +
        "Reuses an open link for the same patient and item instead of creating a duplicate.",
      inputSchema: {
        worker_code: workerCode,
        patient_code: patientCode,
        sku: z.string().describe("SKU from check_stock"),
        quantity: z.number().int().min(1).max(5).default(1),
      },
    },
    async (a) => createPayment({ ...a, payer: "caregiver" }),
  );

  server.registerTool(
    "request_sponsor_payment",
    {
      title: "Ask someone else to pay (sponsor)",
      description:
        "Create a payment link for a sponsor elsewhere (e.g. a family member in Lagos or abroad) and a ready-to-forward WhatsApp message. " +
        "Identify the patient only by code and relationship, never by name.",
      inputSchema: {
        worker_code: workerCode,
        patient_code: patientCode,
        sku: z.string().describe("SKU from check_stock"),
        quantity: z.number().int().min(1).max(5).default(1),
        sponsor_relationship: z.string().max(40).describe("Who is paying, relative to the patient, e.g. 'mother's son'"),
      },
    },
    async (a) => {
      const result = await createPayment({ ...a, payer: "sponsor" });
      if ("isError" in result) return result;
      const view = JSON.parse(result.content[0].text) as Json;
      const message =
        `Hello. A community health worker with Barefoot is treating your family member (ref ${a.patient_code}). ` +
        `The medicine costs ₦${view.amount_ngn}. You can pay securely here: ${view.payment_link}. ` +
        `The medicine is given as soon as payment is confirmed.`;
      return ok({ ...view, message_to_forward: message });
    },
  );

  // ---- verify_payment ----
  server.registerTool(
    "verify_payment",
    {
      title: "Verify a payment",
      description:
        "Check with Paystack whether a payment succeeded. This is the ONLY valid proof of payment. " +
        "Statuses: success, pending, abandoned, failed, amount_mismatch, not_found, refunded.",
      inputSchema: { reference },
      annotations: { idempotentHint: true },
    },
    async ({ reference: ref }) => {
      let updated;
      try {
        updated = await reconcilePayment(store, paystack, ref);
      } catch (err) {
        return fail("gateway_error", `Paystack could not be reached: ${(err as Error).message}`, "Do not release. Ask the worker to wait a minute, then verify again.");
      }
      if (!updated) {
        return ok({ reference: ref, status: "not_found", next_step: "Check the reference with the worker. Never assume it is paid." });
      }

      const next: Record<string, string> = {
        success: "Call record_dispense with this reference, then tell the worker to dispense.",
        pending: "Not paid yet. Do not release. Wait, or offer a sponsor request.",
        abandoned: "Not paid yet. Do not release. Offer to resend the link or ask a sponsor.",
        failed: "Payment failed. Do not release. Explain the reason simply and offer a new link or a sponsor.",
        amount_mismatch: "Do not release. Hand over to a human to resolve the amount.",
        refunded: "This payment was refunded. Do not release.",
      };
      return ok({ ...paymentView(updated), next_step: next[updated.status] ?? "" });
    },
  );

  // ---- record_dispense ----
  server.registerTool(
    "record_dispense",
    {
      title: "Record a dispense",
      description:
        "After verify_payment returns success, record that the item was given to the patient. Decrements stock " +
        "and returns a receipt. Safe to call twice: returns the same receipt.",
      inputSchema: { reference },
      annotations: { idempotentHint: true },
    },
    async ({ reference: ref }) => {
      const p = store.read((d) => d.payments.find((x) => x.reference === ref));
      if (!p) return fail("not_found", `No payment ${ref}.`, "Check the reference.");
      if (p.dispensed_receipt) {
        return ok({ already_dispensed: true, receipt: p.dispensed_receipt, reference: ref });
      }
      if (p.status !== "success") {
        return fail("not_paid", `Payment ${ref} is ${p.status}, not success.`, "Do not release. Call verify_payment first.");
      }
      return store.write((d) => {
        const item = (d.stock[p.worker_code] ?? []).find((i) => i.sku === p.sku);
        if (!item || item.qty < p.quantity) {
          return fail("out_of_stock", `${p.sku} ran out after payment.`, "Call refund_payment, then offer a referral or another vendor.", {
            qty_on_hand: item?.qty ?? 0,
          });
        }
        item.qty -= p.quantity;
        const receipt = shortId("RCPT");
        const pay = d.payments.find((x) => x.reference === ref)!;
        pay.dispensed_receipt = receipt;
        d.dispenses.push({
          receipt,
          reference: ref,
          worker_code: p.worker_code,
          patient_code: p.patient_code,
          sku: p.sku,
          quantity: p.quantity,
          at: new Date().toISOString(),
        });
        return ok({
          receipt,
          reference: ref,
          item: item.name,
          qty_remaining: item.qty,
          low_stock: item.qty <= item.reorder_level,
          message_for_worker: "Dispense now, at the dose for the patient's weight band in the Standing Orders.",
        });
      });
    },
  );

  // ---- refund_payment ----
  server.registerTool(
    "refund_payment",
    {
      title: "Refund a payment",
      description: "Refund a successful payment when the item cannot be dispensed (e.g. ran out). Not allowed after dispensing.",
      inputSchema: { reference, reason: z.string().max(200) },
      annotations: { destructiveHint: true },
    },
    async ({ reference: ref, reason }) => {
      const p = store.read((d) => d.payments.find((x) => x.reference === ref));
      if (!p) return fail("not_found", `No payment ${ref}.`, "Check the reference.");
      if (p.status === "refunded") return ok({ reference: ref, status: "refunded", already_refunded: true });
      if (p.dispensed_receipt) return fail("already_dispensed", "This item was already dispensed.", "Hand over to a human if there is a dispute.");
      if (p.status !== "success") return fail("nothing_to_refund", `Payment is ${p.status}.`, "No money was taken; nothing to refund.");
      try {
        await paystack.refund(ref);
      } catch (err) {
        return fail("gateway_error", `Refund failed: ${(err as Error).message}`, "Hand over to a human to complete the refund.");
      }
      await store.write((d) => {
        const pay = d.payments.find((x) => x.reference === ref)!;
        pay.status = "refunded";
        pay.refunded_at = new Date().toISOString();
        pay.refund_reason = reason;
      });
      return ok({ reference: ref, status: "refunded", amount_ngn: ngn(p.amount_kobo), message_for_worker: "The payment has been refunded to the payer." });
    },
  );

  // ---- create_referral ----
  server.registerTool(
    "create_referral",
    {
      title: "Refer a patient",
      description:
        "Book a referral to the nearest suitable facility that is accepting patients. 'emergency' goes to a general hospital, " +
        "'routine' to a primary health centre. Returns a referral code and the facility phone line.",
      inputSchema: {
        worker_code: workerCode,
        patient_code: patientCode,
        urgency: z.enum(["emergency", "routine"]),
        reason: z.string().min(3).max(300).describe("Danger signs or reason, no names"),
      },
    },
    async ({ worker_code, patient_code, urgency, reason }) => {
      const worker = findWorker(worker_code);
      if (!worker) return fail("unknown_worker", `No health worker with code ${worker_code}.`, "Ask the worker to confirm their CHW code.");
      const type = urgency === "emergency" ? "general_hospital" : "phc";
      const candidates = store
        .read((d) => d.facilities.filter((f) => f.type === type))
        .sort((a, b) => (a.distance_km[worker.ward] ?? 999) - (b.distance_km[worker.ward] ?? 999));
      const skipped = candidates.filter((f) => !f.accepting).map((f) => ({ name: f.name, reason: "not accepting patients now" }));
      const chosen = candidates.find((f) => f.accepting);
      if (!chosen) {
        return fail("no_facility", "No suitable facility is accepting patients.", "Hand over to the on-call clinician now.", { skipped });
      }
      const code = shortId("REF");
      await store.write((d) => {
        d.referrals.push({ code, patient_code, worker_code, facility_id: chosen.id, urgency, reason, at: new Date().toISOString() });
      });
      return ok({
        referral_code: code,
        urgency,
        facility: { name: chosen.name, phone: chosen.phone, distance_km: chosen.distance_km[worker.ward] ?? null },
        skipped,
        next_step: urgency === "emergency" ? "Send the patient now, then call handover_to_human." : "Tell the worker when the patient should go.",
      });
    },
  );

  // ---- list_facilities ----
  server.registerTool(
    "list_facilities",
    {
      title: "List facilities",
      description: "List referral facilities near a health worker's ward, with whether each is accepting patients.",
      inputSchema: { worker_code: workerCode },
      annotations: { readOnlyHint: true },
    },
    async ({ worker_code }) => {
      const worker = findWorker(worker_code);
      if (!worker) return fail("unknown_worker", `No health worker with code ${worker_code}.`, "Ask the worker to confirm their CHW code.");
      const list = store
        .read((d) => d.facilities)
        .map((f) => ({ name: f.name, type: f.type, phone: f.phone, accepting: f.accepting, distance_km: f.distance_km[worker.ward] ?? null }))
        .sort((a, b) => (a.distance_km ?? 999) - (b.distance_km ?? 999));
      return ok({ worker_code, ward: worker.ward, facilities: list });
    },
  );
}
