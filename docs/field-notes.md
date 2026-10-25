# Deployment field notes

## Top three

### 1. An emergency handover left the health worker in silence

- **What happened:** In the simulator (24 Oct, 16:16 WAT) the worker reported
  "child vomits everything", a danger sign. Our server logged `create_referral`
  succeeding (referral `REF-A10319`, emergency, facility `gh-b`), and the skill
  then called the built-in `handover_to_human`. The worker received **nothing**:
  not the facility, not the referral code. Their next message, "she has fainted",
  also got no reply. No error anywhere.
- **How I found the cause:** Our server log showed the tool call had worked, so
  the silence came after it. The Threads docs say a takeover moves the thread to
  `human_active` and "the teammate stops answering inbound turns". The Escalation
  docs don't say whether the reply written in the same turn as the handover is
  still delivered; in our run it was not. Nobody saw the handover either: an email
  alert exists (`PUT /v1/teammates/{id}/escalation-notifications`), but only on the
  Escalation rules page, not in the app or the teammate settings.
- **Fix or workaround:** The referral skill now sends the facility, code and phone
  line in one reply and calls `handover_to_human` only on the worker's **next**
  message, repeating the details first if things got worse. Alerting is the first
  item on the go-live note. Trade-off: if the worker never writes again, no
  handover happens. Retested on 25 Oct with a suspected Ebola case: the referral
  (`REF-C142D6`, facility and phone) arrived first; on "patient left" the agent
  handed over with the referral code in the reason, and Chord sent "One moment —
  connecting you with a teammate." Then I handed the thread back with
  `POST /v1/threads/{id}/hand-back`.
- **What Chord should change:** deliver the turn's reply before switching to
  `human_active` (or document that it is dropped); refuse to enable
  `handover_to_human` until a notification target is set; show "handed to a human,
  waiting for an operator" in the simulator so a tester knows why it went quiet.

### 2. A knowledge bundle "owned" by a teammate is invisible to that teammate

- **What happened:** I created the bundle with `POST /v1/knowledge/bundles` and
  `owner_teammate_id` set to my teammate, then uploaded 17 files (all `201`, 517
  chunks indexed). `GET /v1/knowledge/bundles/accessible?teammate_id=…` returned
  `[]` (request `54ee533c-f7d3-462d-9e00-9424adb8b608`). The teammate would have
  answered clinical questions without the Standing Orders it must cite.
- **How I found the cause:** the upload script ends by asking whether the teammate
  can see the bundle instead of trusting the `201`s. The bundle record had
  `owner_teammate_id` set but `access.teammates` empty. The Knowledge docs list
  `owner_teammate_id` as a way to attach a bundle, so docs and API disagree.
- **Fix:** `POST /v1/knowledge/bundles/{id}/shares` with the teammate id. The script
  now always shares and checks `/accessible` at the end.
- **What Chord should change:** make "owner" grant access, or drop it from the
  docs' attach list; show attached bundles on the teammate page.

### 3. A verified payment can wake the agent, but the agent can't tell the worker

- **What happened:** When a sponsor pays, Paystack's signed webhook reaches our
  server, which re-verifies the payment and forwards a signed `payment.verified`
  event to a Chord event subscription. Chord accepted it (24 Oct 15:15:10 UTC:
  `200 {"ok":true,"queued":true}`) and the teammate ran. The worker never saw a
  word.
- **How I found the cause:** the Event subscriptions docs say runs create no thread
  and the only output is an `event.processed` webhook, truncated to 2,000
  characters. There is no way to address the run to the worker's WhatsApp thread.
  This also made a bug of ours worse: the worker still had to type "he has paid",
  the agent made a new link instead of checking the paid one, and the sponsor paid
  twice (25 Oct, refs `bf_mvnkscs2_53d4cfc8` and `bf_mvnku231_27d66f32`). Our fix:
  `create_payment_link` now returns a paid-but-not-dispensed payment as
  `already_paid`, with a regression test.
- **Workaround:** the worker says "he has paid" and the agent checks with
  `verify_payment`. The relay stays on, so the run is ready once Chord can deliver it.
- **What Chord should change:** let an event carry a `session_id`/`sender_id` (or
  a subscription target a thread) so the run's reply goes to that conversation.
  Merchants on WhatsApp need "payment received" pushed to them; this is the missing
  piece.

## Smaller ones

- **Duplicate bundle name gives HTTP 500.** Creating a second bundle named
  "Barefoot clinical knowledge" returned `500` with no message (request
  `85d7147a-6ac5-43e1-b50b-812573fe6c65`). A new name worked. Should be `409` with
  the reason.
- **A text file rejected as "corrupt".** A Standing Orders section extracted with
  PDF layout spacing was 92% spaces; upload returned `400 INVALID_ARGUMENT` "the file
  may be corrupt" (request `9eedca10-1a15-405d-b0f5-c81c746d7107`). Collapsing runs of
  spaces fixed it. Say "mostly whitespace" instead of "corrupt".
- **Finding the API key, workspace and teammate IDs.** The app shows none of them;
  `GET /v1/teammates` returns both IDs. A `GET /v1/me` (workspace, scopes) and a copy
  button on the teammate page would save every builder this step.
- **Chat is text only.** Health workers send WhatsApp voice notes; `text` is the
  only message field, so voice would need our own WhatsApp bridge. Say in the docs
  whether the WhatsApp channel transcribes voice notes.
- **Skill file paths.** The skills API returns paths prefixed with the skill name
  (`referral/SKILL.md`, entrypoint included); the docs' examples don't show this.

## Running log

| When | What | Error / request id | Status |
| --- | --- | --- | --- |
| 2026-10-20 | Built MCP server + skills; 21-check smoke test and Chord signature vectors pass locally in mock mode | n/a | done |
| 2026-10-21 | Deployed to Vultr VPS (systemd, 127.0.0.1:8787) behind a Cloudflare Tunnel at `https://care.croupa.com/mcp`; bearer enforced (401 without token) | n/a | done |
| 2026-10-22 | `register-mcp.sh` failed with `permission denied`: script was not executable. Fixed with `chmod +x` | n/a | fixed |
| 2026-10-22 | Registered MCP server `mcp-fbcdb36c-340c-4d8a-be4e-02f0775e2056` on teammate `94b0363d-…`; all 8 tools discovered and allowlisted; health `ok`, 138 ms | register `8336438f-c3ed-456a-92f1-ca1ce02b33b7`, scope `23af61c3-c6df-4ffd-b8dc-b8ff3714bcd9`, health `401b4b2c-6b71-4ba7-9adc-f39c0b944ff7` | done |
| 2026-10-22 | Uploaded 17 knowledge files (14 Standing Orders sections, 3 WTND demo chapters) to bundle `kb-2443e7009b93`; 517 chunks indexed | create `57adaec8-b72f-44dd-97ee-db0620ab79f9` | done |
| 2026-10-22 | Bundle created with `owner_teammate_id` was **not** accessible to that teammate (`/bundles/accessible` returned `[]`). Docs list `owner_teammate_id` as a way to attach. Fixed with `POST /bundles/{id}/shares`; script now always shares | accessible `54ee533c-f7d3-462d-9e00-9424adb8b608` | fixed; report to Chord |
| 2026-10-24 | Switched VPS to Paystack test mode, added `/paid` callback page, created `payment.verified` event subscription `CHPXiegoOiYsetyrYvWdUQ`; relay on. Server never loaded `.env` outside systemd; fixed with `process.loadEnvFile()` | n/a | done; relay untested end to end |
| 2026-10-25 | Double charge: webhook marked link 1 paid before the worker said "paid"; teammate called `create_payment_link` again, which only reused *pending* links, so it made link 2 (also paid) and link 3. Fixed: paid-but-undispensed payment is returned as `already_paid`; skill says verify the existing reference. P-0045 refs `bf_mvnkscs2_53d4cfc8` (kept), `bf_mvnku231_27d66f32` (duplicate, refund) | n/a | fixed, deployed |
| 2026-10-25 | Downloaded full CHEW/JCHEW Standing Orders; extractor now splits all 255 sections by body heading (JCHEW contents page has wrong page numbers). Added dose rows for diarrhoea <5, 6–12 y, adults, elderly (awaiting doctor sign-off), Ebola screening from NCDC case definition v2, and adult/older-child demo stock | n/a | done; skills and knowledge need re-upload |
| 2026-10-25 | Uploaded via API: `clinical-protocols` v2 published (skills API, `upload-skills.sh`); knowledge bundle `kb-a3bafdc79bd8`, 258 docs. Creating a bundle with an existing name returned **HTTP 500** (create `85d7147a-6ac5-43e1-b50b-812573fe6c65`); a file that was 92% layout spaces returned 400 "may be corrupt" (`9eedca10-1a15-405d-b0f5-c81c746d7107`), fixed by collapsing spaces | see ids | done; old bundle `kb-2443e7009b93` unshared 2026-10-25 (kept, not deleted) |

## Doc inconsistencies spotted while reading (report only if they bite)

1. Thread identity: Concepts/Quickstart say `sender_id` + `session_id`; External chat says `(source_id, sender_id)`.
2. Permissions page omits the `mcp:*` scopes the MCP page requires.
3. Authentication says inbound webhooks are signed over the raw body; the actual scheme prefixes a timestamp.
4. Escalation triggers rely on Procedures, which are disabled for skill-based teammates.
5. OpenAPI records `200` for endpoints that return `201`/`202`/`204`.
6. Event filter mismatch returns the same `401` as a bad signature.

## Non-Chord gotcha worth remembering

The MCP TypeScript SDK's `createMcpExpressApp()` turns on localhost Host-header
validation by default, which would reject requests arriving through a tunnel or a
public host. This server uses plain Express with bearer auth instead.
