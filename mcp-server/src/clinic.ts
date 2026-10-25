import crypto from "node:crypto";
import { config } from "./config.js";
import type { PaymentGateway } from "./paystack.js";
import type { Facility, Ledger, Payer, Payment, StockItem, Store, Worker } from "./store.js";

/** A failure the agent must handle (not a crash): what went wrong and what to do next. */
export class ClinicError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly nextStep: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export interface PaymentRequest {
  worker_code: string;
  patient_code: string;
  sku: string;
  quantity: number;
  payer: Payer;
  sponsor_relationship?: string;
}

const ngn = (kobo: number) => Math.round(kobo) / 100;
const now = () => new Date().toISOString();
const shortId = (prefix: string) => `${prefix}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
const byRef = (d: Ledger, ref: string) => d.payments.find((p) => p.reference === ref);

const NEXT_STEP_BY_STATUS: Record<string, string> = {
  success: "Call record_dispense with this reference, then tell the worker to dispense.",
  pending: "Not paid yet. Do not release. Wait, or offer a sponsor request.",
  abandoned: "Not paid yet. Do not release. Offer to resend the link or ask a sponsor.",
  failed: "Payment failed. Do not release. Explain the reason simply and offer a new link or a sponsor.",
  amount_mismatch: "Do not release. Hand over to a human to resolve the amount.",
  refunded: "This payment was refunded. Do not release.",
};

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

const distanceFrom = (ward: string) => (f: Facility) => f.distance_km[ward] ?? null;

/**
 * Everything a health worker can do: look up stock, take payment, dispense,
 * refund and refer. Each method returns the agent-facing result or throws a
 * ClinicError. All ledger mutations go through the store's write lock.
 */
export class Clinic {
  constructor(
    private store: Store,
    private gateway: PaymentGateway,
  ) {}

  get paymentMode() {
    return this.gateway.mode;
  }

  checkStock(worker_code: string, query?: string) {
    const worker = this.worker(worker_code);
    const all = this.store.read((d) => d.stock[worker_code] ?? []);
    const q = query?.toLowerCase().trim();
    const matches = q
      ? all.filter((i) => i.name.toLowerCase().includes(q) || i.keywords.some((k) => q.includes(k) || k.includes(q)))
      : all;
    return {
      worker_code,
      cadre: worker.cadre,
      query: query ?? null,
      items: matches.map(stockView),
      note: matches.length ? undefined : "No matching item in this worker's stock. Do not recommend it; refer if it is needed.",
    };
  }

  async requestPayment(req: PaymentRequest) {
    this.worker(req.worker_code);
    const item = this.store.read((d) => (d.stock[req.worker_code] ?? []).find((i) => i.sku === req.sku));
    if (!item) {
      throw new ClinicError("unknown_item", `SKU ${req.sku} is not in ${req.worker_code}'s stock.`, "Call check_stock and use a sku it returns.");
    }
    if (item.qty < req.quantity) {
      throw new ClinicError("out_of_stock", `${item.name}: only ${item.qty} on hand.`, "Do not take payment. Offer a referral or another vendor.", {
        qty_on_hand: item.qty,
      });
    }

    // No double charging for the same worker, patient and item: a payment that is
    // already paid but not yet dispensed wins, then an open pending link.
    const ttlMs = config.paymentLinkTtlHours * 3600_000;
    const recent = this.store.read((d) =>
      d.payments.filter(
        (p) =>
          p.worker_code === req.worker_code &&
          p.patient_code === req.patient_code &&
          p.sku === req.sku &&
          Date.now() - Date.parse(p.created_at) < ttlMs,
      ),
    );
    const paid = recent.find((p) => p.status === "success" && !p.dispensed_receipt && !p.refunded_at);
    if (paid) {
      return {
        already_paid: true as const,
        ...paymentView(paid),
        next_step: "Do NOT send a new link. This item is already paid. Call record_dispense with this reference.",
      };
    }
    const open = recent.find((p) => p.status === "pending");
    if (open) {
      return { reused_existing_link: true, ...paymentView(open), message_for_worker: "A link for this item is already open. Use the same one." };
    }

    const reference = `bf_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
    const amount_kobo = item.price_ngn * 100 * req.quantity;
    let authorization_url: string;
    try {
      ({ authorization_url } = await this.gateway.initialize({
        reference,
        amount_kobo,
        email: `${req.patient_code.toLowerCase()}.${req.worker_code.toLowerCase()}@${config.paystack.payerEmailDomain}`,
        metadata: {
          worker_code: req.worker_code,
          patient_code: req.patient_code,
          sku: req.sku,
          quantity: req.quantity,
          payer: req.payer,
          sponsor_relationship: req.sponsor_relationship,
          custom_fields: [
            { display_name: "Item", variable_name: "item", value: item.name },
            { display_name: "Patient code", variable_name: "patient_code", value: req.patient_code },
          ],
        },
      }));
    } catch (err) {
      console.error(`[gateway] initialize failed: ${(err as Error).message}`);
      throw new ClinicError(
        "gateway_error",
        `Could not create the payment link: ${(err as Error).message}`,
        "Tell the worker payment is unavailable right now and to try again in a few minutes. Do not release the medicine.",
      );
    }

    const payment: Payment = {
      reference,
      worker_code: req.worker_code,
      patient_code: req.patient_code,
      sku: req.sku,
      quantity: req.quantity,
      amount_kobo,
      currency: "NGN",
      payer: req.payer,
      sponsor_relationship: req.sponsor_relationship,
      authorization_url,
      status: "pending",
      created_at: now(),
    };
    await this.store.write((d) => {
      d.payments.push(payment);
    });
    return { ...paymentView(payment), item_name: item.name, expires_in_hours: config.paymentLinkTtlHours, paystack_mode: this.gateway.mode };
  }

  async requestSponsorPayment(req: Omit<PaymentRequest, "payer"> & { sponsor_relationship: string }) {
    const result = await this.requestPayment({ ...req, payer: "sponsor" });
    if ("already_paid" in result) return result; // never invite a sponsor to pay twice
    const message =
      `Hello. A community health worker with Barefoot is treating your family member (ref ${req.patient_code}). ` +
      `The medicine costs ₦${result.amount_ngn}. You can pay securely here: ${result.payment_link}. ` +
      `The medicine is given as soon as payment is confirmed.`;
    return { ...result, message_to_forward: message };
  }

  async verifyPayment(reference: string) {
    let p: Payment | undefined;
    try {
      p = await this.reconcile(reference);
    } catch (err) {
      throw new ClinicError("gateway_error", `Paystack could not be reached: ${(err as Error).message}`, "Do not release. Ask the worker to wait a minute, then verify again.");
    }
    if (!p) return { reference, status: "not_found", next_step: "Check the reference with the worker. Never assume it is paid." };
    return { ...paymentView(p), next_step: NEXT_STEP_BY_STATUS[p.status] ?? "" };
  }

  /**
   * Ask the gateway for the truth about a payment and record it. Used by
   * verifyPayment and by the webhook, so both paths agree. Never trusts a
   * webhook body or a customer's word on its own. Throws if the gateway fails.
   */
  async reconcile(reference: string): Promise<Payment | undefined> {
    const p = this.store.read((d) => byRef(d, reference));
    if (!p) return undefined;
    if (["success", "refunded", "amount_mismatch"].includes(p.status)) return { ...p };

    const v = await this.gateway.verify(reference);

    return this.store.write((d) => {
      const pay = byRef(d, reference)!;
      if (!v.found) {
        pay.status = "pending";
      } else if (v.status === "success") {
        const matches = v.amount_kobo === pay.amount_kobo && (v.currency ?? "NGN") === pay.currency;
        pay.status = matches ? "success" : "amount_mismatch";
        pay.verified_at = now();
        if (!matches) {
          pay.gateway_message = `Paid ${ngn(v.amount_kobo ?? 0)} ${v.currency}, expected ${ngn(pay.amount_kobo)} NGN`;
        }
      } else {
        pay.status = v.status;
        pay.gateway_message = v.gateway_message;
      }
      return { ...pay };
    });
  }

  dispense(reference: string) {
    return this.store.write((d) => {
      const pay = this.payment(d, reference);
      if (pay.dispensed_receipt) return { already_dispensed: true, receipt: pay.dispensed_receipt, reference };
      if (pay.status !== "success") {
        throw new ClinicError("not_paid", `Payment ${reference} is ${pay.status}, not success.`, "Do not release. Call verify_payment first.");
      }
      const item = (d.stock[pay.worker_code] ?? []).find((i) => i.sku === pay.sku);
      if (!item || item.qty < pay.quantity) {
        throw new ClinicError("out_of_stock", `${pay.sku} ran out after payment.`, "Call refund_payment, then offer a referral or another vendor.", {
          qty_on_hand: item?.qty ?? 0,
        });
      }
      item.qty -= pay.quantity;
      const receipt = shortId("RCPT");
      pay.dispensed_receipt = receipt;
      d.dispenses.push({
        receipt,
        reference,
        worker_code: pay.worker_code,
        patient_code: pay.patient_code,
        sku: pay.sku,
        quantity: pay.quantity,
        at: now(),
      });
      return {
        receipt,
        reference,
        item: item.name,
        qty_remaining: item.qty,
        low_stock: item.qty <= item.reorder_level,
        message_for_worker: "Dispense now, at the dose for the patient's weight band in the Standing Orders.",
      };
    });
  }

  refund(reference: string, reason: string) {
    // ponytail: the gateway call runs inside the store lock so a dispense can't
    // slip in between the check and the refund; it holds other writes for up to
    // the 15 s fetch timeout. Use a "refunding" status if that ever matters.
    return this.store.write(async (d) => {
      const pay = this.payment(d, reference);
      if (pay.status === "refunded") return { reference, status: "refunded", already_refunded: true };
      if (pay.dispensed_receipt) {
        throw new ClinicError("already_dispensed", "This item was already dispensed.", "Hand over to a human if there is a dispute.");
      }
      if (pay.status !== "success") {
        throw new ClinicError("nothing_to_refund", `Payment is ${pay.status}.`, "No money was taken; nothing to refund.");
      }
      try {
        await this.gateway.refund(reference);
      } catch (err) {
        throw new ClinicError("gateway_error", `Refund failed: ${(err as Error).message}`, "Hand over to a human to complete the refund.");
      }
      pay.status = "refunded";
      pay.refunded_at = now();
      pay.refund_reason = reason;
      return { reference, status: "refunded", amount_ngn: ngn(pay.amount_kobo), message_for_worker: "The payment has been refunded to the payer." };
    });
  }

  async refer(req: { worker_code: string; patient_code: string; urgency: "emergency" | "routine"; reason: string }) {
    const worker = this.worker(req.worker_code);
    const type = req.urgency === "emergency" ? "general_hospital" : "phc";
    const distance = distanceFrom(worker.ward);
    const candidates = this.store
      .read((d) => d.facilities.filter((f) => f.type === type))
      .sort((a, b) => (distance(a) ?? 999) - (distance(b) ?? 999));
    const skipped = candidates.filter((f) => !f.accepting).map((f) => ({ name: f.name, reason: "not accepting patients now" }));
    const chosen = candidates.find((f) => f.accepting);
    if (!chosen) {
      throw new ClinicError("no_facility", "No suitable facility is accepting patients.", "Hand over to the on-call clinician now.", { skipped });
    }
    const code = shortId("REF");
    await this.store.write((d) => {
      d.referrals.push({ code, ...req, facility_id: chosen.id, at: now() });
    });
    return {
      referral_code: code,
      urgency: req.urgency,
      facility: { name: chosen.name, phone: chosen.phone, distance_km: distance(chosen) },
      skipped,
      next_step:
        req.urgency === "emergency"
          ? "Give the worker the facility, referral code and phone now. Do NOT call handover_to_human in this reply: call it on the worker's next message."
          : "Tell the worker when the patient should go.",
    };
  }

  listFacilities(worker_code: string) {
    const worker = this.worker(worker_code);
    const distance = distanceFrom(worker.ward);
    const facilities = this.store
      .read((d) => d.facilities)
      .map((f) => ({ name: f.name, type: f.type, phone: f.phone, accepting: f.accepting, distance_km: distance(f) }))
      .sort((a, b) => (a.distance_km ?? 999) - (b.distance_km ?? 999));
    return { worker_code, ward: worker.ward, facilities };
  }

  private worker(code: string): Worker {
    const w = this.store.read((d) => d.workers.find((x) => x.code === code));
    if (!w) throw new ClinicError("unknown_worker", `No health worker with code ${code}.`, "Ask the worker to confirm their CHW code.");
    return w;
  }

  private payment(d: Ledger, reference: string): Payment {
    const p = byRef(d, reference);
    if (!p) throw new ClinicError("not_found", `No payment ${reference}.`, "Check the reference.");
    return p;
  }
}
