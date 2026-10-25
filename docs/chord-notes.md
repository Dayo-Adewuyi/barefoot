# Chord facts this build depends on

Pulled from the Chord docs (api.chordhq.xyz/docs) on 20 Oct 2026. Re-check before deploying.

| Topic | What the docs say | Where it matters here |
| --- | --- | --- |
| Skills | Text only (`.md`, `.txt`, `.json`, `.yaml`, `.csv`); uploaded scripts are not executed; 64 files and 256 KiB per skill package | All logic that acts lives in the MCP server |
| MCP transport | Streamable HTTP at a public HTTPS URL; Chord POSTs JSON, accepts JSON or SSE; localhost and private IPs blocked | Deploy or tunnel before registering |
| MCP auth | `bearer` sends `Authorization: Bearer <auth_token>` | `MCP_BEARER_TOKEN` |
| Teammate scope | Empty `mcp_server_ids` = all enabled servers; `set_mcp_server_ids: []` does not clear | Script sets an explicit list |
| Health probe | Returns HTTP 200 even on failure; read `status` | Script checks `.status` |
| Probes | A disabled server doesn't send its stored token to probes | Script enables before probing |
| Event subscriptions | `X-Chord-Signature: sha256=hex(HMAC_SHA256(secret, ts + "." + body))`, `X-Chord-Timestamp` within 5 min; filter mismatch returns the same 401 as a bad signature | `src/chord-relay.ts`, verified against the docs' test vectors |
| Event runs | No thread is created; result arrives as `event.processed` webhook | Proactive messages to the worker need confirming with TSG |
| Handover | Built-in `handover_to_human` tool on channel turns | Referral skill calls it |
| Simulator | Separate Chord Connect partner app; needs its own approval and consent | Check before the demo |
