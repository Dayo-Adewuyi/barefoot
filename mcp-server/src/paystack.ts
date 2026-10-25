import crypto from "node:crypto";
import { config } from "./config.js";

export interface VerifyResult {
  found: boolean;
  status: "success" | "failed" | "abandoned" | "pending";
  amount_kobo?: number;
  currency?: string;
  gateway_message?: string;
}

/** Where payments are taken. Adapters: Paystack (test keys) and the offline mock checkout. */
export interface PaymentGateway {
  readonly mode: "test" | "mock";
  initialize(args: {
    reference: string;
    amount_kobo: number;
    email: string;
    metadata: Record<string, unknown>;
  }): Promise<{ authorization_url: string }>;
  verify(reference: string): Promise<VerifyResult>;
  refund(reference: string): Promise<void>;
}

export class PaystackError extends Error {
  constructor(message: string, readonly httpStatus?: number) {
    super(message);
  }
}

export class Paystack implements PaymentGateway {
  readonly mode = "test" as const;

  constructor(private secretKey: string) {}

  private async call(method: "GET" | "POST", path: string, body?: unknown) {
    const res = await fetch(`${config.paystack.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.secretKey}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: any };
    return { http: res.status, json };
  }

  private static fail(what: string, http: number, message?: string): never {
    throw new PaystackError(message || `Paystack ${what} failed (HTTP ${http})`, http);
  }

  async initialize(args: Parameters<PaymentGateway["initialize"]>[0]) {
    const { http, json } = await this.call("POST", "/transaction/initialize", {
      reference: args.reference,
      amount: args.amount_kobo,
      currency: "NGN",
      email: args.email,
      metadata: args.metadata,
      callback_url: config.paystack.callbackUrl || undefined,
      split_code: config.paystack.splitCode || undefined,
    });
    if (http >= 400 || !json.status || !json.data?.authorization_url) Paystack.fail("initialize", http, json.message);
    return { authorization_url: json.data.authorization_url as string };
  }

  async verify(reference: string): Promise<VerifyResult> {
    const { http, json } = await this.call("GET", `/transaction/verify/${encodeURIComponent(reference)}`);
    if (http === 404 || (http === 400 && /not found/i.test(json.message ?? ""))) {
      return { found: false, status: "pending" };
    }
    if (http >= 400 || !json.status) Paystack.fail("verify", http, json.message);
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

  async refund(reference: string) {
    const { http, json } = await this.call("POST", "/refund", { transaction: reference });
    if (http >= 400 || !json.status) Paystack.fail("refund", http, json.message);
  }
}

/** Paystack signs webhooks with HMAC-SHA512 of the raw body using the secret key. */
export function validPaystackSignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!signature || !config.paystack.secretKey) return false;
  const expected = crypto.createHmac("sha512", config.paystack.secretKey).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.trim().toLowerCase(), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
