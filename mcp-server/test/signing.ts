/** Checks the Chord relay signer against the worked vectors in Chord's docs. */
import { signChord } from "../src/chord-relay.js";

const secret = "a-long-random-shared-secret";
const vectors = [
  {
    name: "event subscription vector (docs/event-subscriptions)",
    body: '{"event_type":"charge.refunded","event_id":"evt_1QaBcDeFgHiJkLmN","data":{"customer_id":"cus_123","amount":4200,"currency":"usd"}}',
    expected: "sha256=25ad8707710b7836c7d1e7f4d2c76a6c858ddc9dbf9d6aadf42924b5d8c41bdb",
  },
  {
    name: "external chat vector (docs/external-chat)",
    body: '{"event":"message","data":{"sender_id":"user_olumide","session_id":"5d8f6c2e-7a41-4b9d-9d3a-3c1e2f0b7a55","message_id":"msg_01HXYZ","text":"I need help with my order"}}',
    expected: "sha256=c572bf6ca4f48d0e34f139516939e6cb89197cf141c62601c36f5613e0eb8161",
  },
];
let failed = 0;
for (const v of vectors) {
  const got = signChord(secret, "1800000000", Buffer.from(v.body, "utf8"));
  const ok = got === v.expected;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${v.name}${ok ? "" : `\n      got ${got}`}`);
}
process.exit(failed ? 1 : 0);
