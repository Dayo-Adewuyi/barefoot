# Barefoot: care where there is no doctor

A WhatsApp teammate, built on Chord, that takes a community health worker from
"what is wrong with this patient" to "the right medicine is paid for and
dispensed": danger signs and Ebola exposure first, the dose from the national
Standing Orders with its page, Paystack payment by the caregiver or a relative
anywhere, verified before the medicine is released, and emergency referral with a
human handover.

All people, facilities, prices and payments are synthetic. Paystack runs in test
mode only; live keys are refused at startup.

**Read these first:** [problem statement](docs/problem-statement.md) ·
[field notes](docs/field-notes.md) · [go-live note](docs/go-live-note.md)

## What's live

| Part | Where |
| --- | --- |
| Teammate | Chord, WhatsApp simulator. Skills `clinical-protocols`, `pharmacy-payments`, `referral`; knowledge bundle of all 255 Standing Orders sections |
| Custom tool | MCP server at `https://care.croupa.com/mcp` (Vultr VPS, systemd, Cloudflare Tunnel, bearer auth) |
| Payments | Paystack test mode; signed webhook at `/webhooks/paystack`; payers land on `/paid` |
| Payment → agent | Verified payments are forwarded, signed, to a Chord event subscription (`payment.verified`) |

## How a payment flows

```
worker on WhatsApp ─► Chord teammate ─► create_payment_link ─► Paystack checkout ─► payer (caregiver or son in Lagos)
                                                                     │
          "he has paid" ─► verify_payment ◄── Paystack webhook (HMAC-SHA512, re-verified with the API)
                                 │                   └─► signed payment.verified event ─► Chord event subscription
                                 ▼
                         record_dispense ─► receipt, stock decremented, low-stock warning
```

## Tools the teammate can call

| Tool | What it does |
| --- | --- |
| `check_stock` | Items and fixed naira prices a health worker has on hand |
| `create_payment_link` | Paystack link for the caregiver. Returns an open or already-paid payment instead of charging twice |
| `request_sponsor_payment` | Same, for a sponsor elsewhere, plus a forwardable WhatsApp message with no patient name |
| `verify_payment` | Asks Paystack for the truth: success, pending, abandoned, failed, amount mismatch |
| `record_dispense` | Only after verified payment; decrements stock, returns a receipt, flags low stock; idempotent |
| `refund_payment` | Only when a paid item can't be dispensed |
| `create_referral` | Nearest facility that is accepting patients; skips full ones |
| `list_facilities` | Facilities near the worker's ward |

Every failure comes back as a typed error with the next step for the agent
(`gateway_error`, `out_of_stock`, `not_paid`, `amount_mismatch`, ...), so the agent
says "don't release the medicine yet" rather than guessing.

## What's in the repo

```
skills/                      Chord skill files, one folder per skill
  clinical-protocols/        Danger signs and Ebola screening, dose tables for all ages, scope
  pharmacy-payments/         No release before verified payment; failure handling
  referral/                  Emergency referral, details first, then human handover
knowledge/
  national-guidelines/       2024 National Standing Orders, CHEW + JCHEW, all 255 sections
  where-there-is-no-doctor/  The Hesperian handbook, one file per chapter
mcp-server/                  The custom tool: MCP server (TypeScript, Express)
  src/tools.ts               The 8 tools
  src/paystack.ts            Paystack test API, plus an offline mock mode
  src/chord-relay.ts         Signs and forwards verified payments to Chord
  public/paid.html           Page payers land on after checkout
  data/seed.json             Synthetic workers, stock, prices and facilities
  test/                      23-check end-to-end smoke test + Chord signature vectors
scripts/
  split_standing_orders.py   Rebuilds knowledge/national-guidelines/ from the CHPRBN PDFs
  split_book.py              Rebuilds the handbook chapters from the PDF
  chord/register-mcp.sh      Registers the MCP server with Chord in the documented order
  chord/upload-skills.sh     Creates or updates, publishes and includes each skill
  chord/upload-knowledge.sh  Uploads the knowledge bundle, shares it, checks access
docs/                        Problem statement, field notes, go-live note, Chord facts
```

## Run it locally (no keys needed)

```bash
cd mcp-server
npm install
npm test            # Chord signature vectors + 23-check end-to-end smoke test
cp .env.example .env
npm run dev         # http://localhost:8787/mcp, mock checkout at /mock/pay/<ref>
```

Without `PAYSTACK_SECRET_KEY` the server runs in **mock mode**: payment links open
a local checkout page with Pay / Decline / Abandon buttons, so every branch can be
shown without network access. With `PAYSTACK_SECRET_KEY=sk_test_...` links open real
Paystack test checkout; point the Paystack test webhook at
`https://<public-host>/webhooks/paystack`.

## Deploy and connect to Chord

1. Run `mcp-server` behind public HTTPS (Chord blocks localhost and private
   addresses). Set `PUBLIC_BASE_URL`, a long random `MCP_BEARER_TOKEN`, the Paystack
   test key and `PAYER_EMAIL_DOMAIN` (a real domain; Paystack rejects `.example`).
2. Get your IDs: the app shows none of them, but `GET /v1/teammates` returns `id`
   and `workspace_id`.
3. With `CHORD_API_KEY` and `CHORD_TEAMMATE_ID` exported:
   ```bash
   ./scripts/chord/register-mcp.sh       # also needs CHORD_WORKSPACE_ID, MCP_URL, MCP_BEARER_TOKEN
   ./scripts/chord/upload-skills.sh      # teammate:read, teammate:update
   ./scripts/chord/upload-knowledge.sh   # rag:ingest, rag:retrieve
   ```
4. For sponsor payments that confirm themselves: create an event subscription with
   `event_type_filter: "payment.verified"` and set `CHORD_EVENT_SUBSCRIPTION_ID` and
   `CHORD_EVENT_SIGNING_SECRET` on the server.

## Demo script (simulator)

1. "CHW-001 here. Child P-1042, 3 years, 10 kg, fever 2 days, malaria test positive."
2. The agent asks the Ebola and danger-sign questions; answer no to all.
3. It gives the dose with its page, checks stock and asks who pays. "Her son in Lagos."
4. It sends a sponsor link and a message to forward. Open the link, **close it
   without paying**, and say "he has paid": the agent finds it abandoned and keeps
   the medicine on the shelf.
5. Pay with a Paystack test card. "He has paid": verified, dispense recorded,
   receipt, and a low-stock warning.
6. New case: "Child P-1043 is having a fit now." No payment: the referral and the
   facility's phone line come first; the next message hands the chat to a clinician.
7. Optional: "Adult P-2001, fever 3 days, back from Uganda last week." The agent
   treats it as suspected Ebola: no touching, isolate, call NCDC 6232, refer.

## Status

| Part | State |
| --- | --- |
| Guidance, caregiver and sponsor payment, verify, dispense, refund, referral | Live in the simulator against Paystack test mode |
| Paystack webhook → server → Chord event subscription | Live: Chord accepts the event and runs the teammate; it can't reach the worker yet (field note 3) |
| Ebola screening, dose tables for all ages | Live; doses not yet doctor-approved (said in the chat) |
| Human handover alert | Not set up: the go-live note's first condition |
| Vouchers, restock orders, follow-ups, voice notes | Not built |

## Safety

- Danger signs and Ebola exposure come first; emergencies never wait for payment.
- Doses come only from the 2024 National Standing Orders for the worker's cadre, by
  weight band and with a citation. Never from memory or *Where There Is No Doctor*.
  No dose is doctor-approved yet; four source discrepancies are flagged for the
  reviewer in `dose-tables.md`.
- Patients are identified by pseudonymous codes only; names are rejected by the
  tool schema.

## How AI tools were used

Built with Claude Code (Anthropic). It read the Chord and Paystack docs, wrote the
MCP server, tests, skill drafts and scripts, extracted the Standing Orders, and ran
the deployment and uploads under my direction. I chose the problem and scope, ran
every conversation in the simulator, decided each fix after reading the logs, and
reviewed the clinical safety rules. Every tool was run and tested before it shipped.
