import type { Paystack } from "./paystack.js";
import type { Payment, Store } from "./store.js";

const ngn = (kobo: number) => Math.round(kobo) / 100;

/**
 * Ask Paystack for the truth about a payment and record it. Used by the
 * verify_payment tool and by the Paystack webhook, so both paths agree.
 * Never trusts a webhook body or a customer's word on its own.
 */
export async function reconcilePayment(
  store: Store,
  paystack: Paystack,
  reference: string,
): Promise<Payment | undefined> {
  const p = store.read((d) => d.payments.find((x) => x.reference === reference));
  if (!p) return undefined;
  if (["success", "refunded", "amount_mismatch"].includes(p.status)) return { ...p };

  const v = await paystack.verify(reference); // may throw PaystackError

  return store.write((d) => {
    const pay = d.payments.find((x) => x.reference === reference)!;
    if (!v.found) {
      pay.status = "pending";
    } else if (v.status === "success") {
      const matches = v.amount_kobo === pay.amount_kobo && (v.currency ?? "NGN") === pay.currency;
      pay.status = matches ? "success" : "amount_mismatch";
      pay.verified_at = new Date().toISOString();
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
