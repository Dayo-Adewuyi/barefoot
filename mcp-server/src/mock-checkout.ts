import express, { Router } from "express";
import { config } from "./config.js";
import type { PaymentGateway, VerifyResult } from "./paystack.js";
import type { Store } from "./store.js";

type Outcome = "success" | "failed" | "abandoned";
const OUTCOMES: Outcome[] = ["success", "failed", "abandoned"];

/**
 * Offline stand-in for Paystack, used when no secret key is set. Nothing leaves
 * the machine: links point at this server's /mock/pay page, and the outcome the
 * tester picks there is what verify reports.
 */
export class MockGateway implements PaymentGateway {
  readonly mode = "mock" as const;

  constructor(private store: Store) {}

  async initialize(args: { reference: string }) {
    return { authorization_url: `${config.publicBaseUrl}/mock/pay/${args.reference}` };
  }

  async verify(reference: string): Promise<VerifyResult> {
    const [outcome, amount_kobo] = this.store.read((d) => [
      d.mock_outcomes[reference],
      d.payments.find((p) => p.reference === reference)?.amount_kobo,
    ]);
    return {
      found: true,
      status: outcome ?? "pending",
      amount_kobo,
      currency: "NGN",
      gateway_message: outcome === "failed" ? "Declined (mock)" : undefined,
    };
  }

  async refund() {}
}

/** The mock checkout pages. `onPaid` plays the part of Paystack's charge.success webhook. */
export function mockCheckoutRouter(store: Store, onPaid: (reference: string) => void): Router {
  const router = Router();
  const find = (ref: string) => store.read((d) => d.payments.find((x) => x.reference === ref));

  router.get("/mock/pay/:ref", (req, res) => {
    const p = find(req.params.ref);
    if (!p) {
      res.status(404).send("Unknown payment reference");
      return;
    }
    res.type("html").send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mock checkout</title>
<body style="font-family:system-ui;max-width:28rem;margin:3rem auto;padding:0 1rem">
<h1 style="font-size:1.25rem">Mock checkout (no real money)</h1>
<p>Patient ${p.patient_code} · ${p.sku} × ${p.quantity}<br><strong>₦${(p.amount_kobo / 100).toLocaleString()}</strong></p>
<form method="post"><button name="outcome" value="success">Pay</button>
<button name="outcome" value="failed">Simulate decline</button>
<button name="outcome" value="abandoned">Simulate abandon</button></form></body>`);
  });

  router.post("/mock/pay/:ref", express.urlencoded({ extended: false }), async (req, res) => {
    const ref = String(req.params.ref);
    const outcome = String(req.body?.outcome ?? "success") as Outcome;
    if (!OUTCOMES.includes(outcome)) {
      res.status(400).send("Bad outcome");
      return;
    }
    if (!find(ref)) {
      res.status(404).send("Unknown payment reference");
      return;
    }
    await store.write((d) => {
      d.mock_outcomes[ref] = outcome;
    });
    if (outcome === "success") onPaid(ref);
    res.type("html").send(`<p style="font-family:system-ui">Recorded: ${outcome}. You can close this page.</p>`);
  });

  return router;
}
