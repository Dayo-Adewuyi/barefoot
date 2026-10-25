import crypto from "node:crypto";
import { config } from "./config.js";

/**
 * Forwards a verified payment to a Chord event subscription, so the teammate
 * can act without the worker typing "it's paid".
 *
 * Chord's inbound signature: sha256=hex(HMAC_SHA256(secret, `${ts}.` + rawBody)),
 * with X-Chord-Timestamp in seconds. See docs/chord-notes.md.
 */
export function chordRelayEnabled(): boolean {
  return Boolean(config.chord.eventSubscriptionId && config.chord.eventSigningSecret);
}

export function signChord(secret: string, timestamp: string, raw: Buffer): string {
  const preimage = Buffer.concat([Buffer.from(`${timestamp.trim()}.`, "utf8"), raw]);
  return "sha256=" + crypto.createHmac("sha256", secret).update(preimage).digest("hex");
}

export async function forwardToChord(event: {
  event_type: string;
  event_id: string;
  data: Record<string, unknown>;
}): Promise<{ ok: boolean; status?: number; body?: string }> {
  if (!chordRelayEnabled()) return { ok: false, body: "relay not configured" };

  // Serialize once; sign and send the same bytes.
  const raw = Buffer.from(JSON.stringify(event), "utf8");
  const url = `${config.chord.baseUrl}/api/events/webhook/${config.chord.eventSubscriptionId}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const ts = String(Math.floor(Date.now() / 1000));
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Chord-Timestamp": ts,
          "X-Chord-Signature": signChord(config.chord.eventSigningSecret, ts, raw),
        },
        body: raw,
        signal: AbortSignal.timeout(10_000),
      });
      const body = await res.text();
      console.log(`[chord-relay] attempt ${attempt} -> ${res.status} ${body.slice(0, 200)}`);
      if (res.ok) return { ok: true, status: res.status, body };
      // 401 is final: bad signature, unknown subscription, or event_type filter mismatch.
      if (res.status !== 503) return { ok: false, status: res.status, body };
    } catch (err) {
      console.log(`[chord-relay] attempt ${attempt} network error: ${(err as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  return { ok: false, body: "gave up after 3 attempts" };
}
