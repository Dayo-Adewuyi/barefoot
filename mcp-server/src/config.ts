import path from "node:path";

// Load .env from the working directory if present; variables already set (systemd) win.
try {
  process.loadEnvFile();
} catch {
  // no .env: rely on the process environment
}

function env(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

const paystackSecret = env("PAYSTACK_SECRET_KEY");
if (paystackSecret.startsWith("sk_live_")) {
  // The TSG brief forbids live keys, and so does this build.
  throw new Error("PAYSTACK_SECRET_KEY is a live key. Use a sk_test_ key only.");
}

export const config = {
  port: Number(env("PORT", "8787")),
  host: env("HOST", "0.0.0.0"),
  // Chord sends this as `Authorization: Bearer <token>` when the MCP server is
  // registered with auth_type "bearer". Empty = no auth (local dev only).
  mcpBearerToken: env("MCP_BEARER_TOKEN"),
  publicBaseUrl: env("PUBLIC_BASE_URL", `http://localhost:${env("PORT", "8787")}`),
  dataFile: path.resolve(env("DATA_FILE", "data/ledger.json")),
  seedFile: path.resolve(env("SEED_FILE", "data/seed.json")),

  paystack: {
    secretKey: paystackSecret,
    // "test" = real Paystack API with a sk_test_ key; "mock" = no network, local pay page.
    mode: paystackSecret ? ("test" as const) : ("mock" as const),
    baseUrl: "https://api.paystack.co",
    callbackUrl: env("PAYSTACK_CALLBACK_URL"),
    splitCode: env("PAYSTACK_SPLIT_CODE"),
    payerEmailDomain: env("PAYER_EMAIL_DOMAIN", "care.croupa.com"),
  },

  chord: {
    baseUrl: env("CHORD_BASE_URL", "https://api.chordhq.xyz"),
    eventSubscriptionId: env("CHORD_EVENT_SUBSCRIPTION_ID"),
    eventSigningSecret: env("CHORD_EVENT_SIGNING_SECRET"),
  },

  paymentLinkTtlHours: 24,
};

export type Config = typeof config;
