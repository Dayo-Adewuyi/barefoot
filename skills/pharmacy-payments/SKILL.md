---
name: pharmacy-payments
description: Take payment for medicines the health worker is about to dispense (caregiver pays now, a sponsor pays remotely), verify it with Paystack, then record the dispense. Use after the clinical skill confirms a medicine is indicated and in stock.
---

# Pharmacy payments

Read `references/business.md` and `references/payment-rules.md` first.

## The golden rule

**No medicine is released until payment is verified** (or, later, a valid voucher
is confirmed). Exception: a danger sign. Emergencies skip payment entirely and
follow the referral skill.

## Flow

1. **Confirm the item and price.** Call `check_stock` with the worker's code and the
   item. Quote the price exactly as returned, in naira. Never invent or round a price.
2. **Ask who is paying:**
   - **Caregiver, now:** call `create_payment_link` with `payer: "caregiver"`. Send
     the worker the link to show or forward to the caregiver.
   - **Someone else (family elsewhere):** call `request_sponsor_payment`. Give the
     worker the link to forward to the sponsor by WhatsApp. Say who it's for using
     only the patient code and the relationship ("Mama's son"), never a name.
3. **Wait for confirmation.** When the worker says it's paid, or a payment event
   arrives, call `verify_payment` with the reference of the link you already
   sent. Never create a new link to check a payment. If you have lost the
   reference, call `create_payment_link` with the same patient and item: it
   returns the existing paid or open payment (`already_paid` /
   `reused_existing_link`) instead of charging again. A patient code like "P-45"
   must be written with at least three digits ("P-045"); use the same form every time.
4. **Act on the result:**

| `verify_payment` status | What you do |
| --- | --- |
| `success` | Call `record_dispense`. Tell the worker to dispense, and give the receipt reference. |
| `pending` / `abandoned` | Do not release. Ask whether they want to retry, send to a sponsor, or wait. |
| `failed` | Do not release. Give the reason returned, in plain words. Offer a new link or a sponsor request. |
| `amount_mismatch` | Do not release. Say the amount paid doesn't match the item price; hand over to a human. |
| `not_found` | Check the reference with the worker. Never assume it's paid. |

5. **If the item runs out after payment** (`record_dispense` returns
   `out_of_stock`), call `refund_payment` and offer a referral or another vendor.
6. **After dispensing**, if `record_dispense` reports `low_stock: true`, tell the
   worker which item is low.

## Never

- Never accept a screenshot, a transfer alert, or "I've paid" as proof. Only
  `verify_payment` counts.
- Never create a second payment link for the same item and patient while one is
  still pending. Reuse the existing reference.
- Never share one patient's payment details with another conversation.
