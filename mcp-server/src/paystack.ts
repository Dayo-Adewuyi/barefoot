import crypto from "node:crypto";
import { config } from "./config.js";
import type { Store } from "./store.js";

export interface InitResult {
  authorization_url: string;
}

export interface VerifyResult {
  found: boolean;
  status: "success" | "failed" | "abandoned" | "pending";
  amount_kobo?: number;
  currency?: string;
  gateway_message?: string;
}

export class PaystackError extends Error {
  constructor(message: string, readonly httpStatus?: number) {
    super(message);
  }
}

/**
 * Wraps the three Paystack calls the agent needs. In "mock" mode (no secret key)
 * nothing leaves the machine: links point at the server's own /mock/pay page.
 */
export class Paystack {
  constructor(private store: Store) {}

  get mode() {
    return config.paystack.mode;
  }

  private async call(method: "GET" | "POST", path: string, body?: unknown) {
    const res = await fetch(`${config.paystack.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.paystack.secretKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      status?: boolean;
      message?: string;
      data?: any;
    };
    return { http: res.status, json };
  }

  async initialize(args: {
    reference: string;
    amount_kobo: number;
    email: string;
    metadata: Record<string, unknown>;
  }): Promise<InitResult> {
    if (this.mode === "mock") {
      return { authorization_url: `${config.publicBaseUrl}/mock/pay/${args.reference}` };
    }
    const body: Record<string, unknown> = {
      reference: args.reference,
      amount: args.amount_kobo,
      currency: "NGN",
      email: args.email,
      metadata: args.metadata,
    };
    if (config.paystack.callbackUrl) body.callback_url = config.paystack.callbackUrl;
    if (config.paystack.splitCode) body.split_code = config.paystack.splitCode;

    const { http, json } = await this.call("POST", "/transaction/initialize", body);
    if (http >= 400 || !json.status || !json.data?.authorization_url) {
      throw new PaystackError(json.message || `Paystack initialize failed (HTTP ${http})`, http);
    }
    return { authorization_url: json.data.authorization_url };
  }

  async verify(reference: string): Promise<VerifyResult> {
    if (this.mode === "mock") {
      const outcome = this.store.read((d) => d.mock_outcomes[reference]);
      const amount = this.store.read((d) => d.payments.find((p) => p.reference === reference)?.amount_kobo);
      if (!outcome) return { found: true, status: "pending", amount_kobo: amount, currency: "NGN" };
      return {
        found: true,
        status: outcome,
        amount_kobo: amount,
        currency: "NGN",
        gateway_message: outcome === "failed" ? "Declined (mock)" : undefined,
      };
    }
    const { http, json } = await this.call("GET", `/transaction/verify/${encodeURIComponent(reference)}`);
    if (http === 404 || (http === 400 && /not found/i.test(json.message ?? ""))) {
      return { found: false, status: "pending" };
    }
    if (http >= 400 || !json.status) {
      throw new PaystackError(json.message || `Paystack verify failed (HTTP ${http})`, http);
    }
    const s = String(json.data?.status ?? "");
    const status: VerifyResult["status"] =
      s === "success" ? "success" : s === "failed" || s === "reversed" ? "failed" : s === "abandoned" ? "abandoned" : "pending";
    return {
      found: true,
      status,
      amount_kobo: Number(json.data?.amount),
      currency: json.data?.currency,
      gateway_message: json.data?.gateway_response,
    };
  }

  async refund(reference: string): Promise<void> {
    if (this.mode === "mock") return;
    const { http, json } = await this.call("POST", "/refund", { transaction: reference });
    if (http >= 400 || !json.status) {
      throw new PaystackError(json.message || `Paystack refund failed (HTTP ${http})`, http);
    }
  }

  /** Paystack signs webhooks with HMAC-SHA512 of the raw body using the secret key. */
  static validWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
    if (!signature || !config.paystack.secretKey) return false;
    const expected = crypto.createHmac("sha512", config.paystack.secretKey).update(rawBody).digest("hex");
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(signature.trim().toLowerCase(), "utf8");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
}
