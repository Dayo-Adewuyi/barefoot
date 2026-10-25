import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Clinic, ClinicError } from "./clinic.js";

const workerCode = z
  .string()
  .regex(/^CHW-\d{3}$/, "Worker codes look like CHW-001")
  .describe("The health worker's code, e.g. CHW-001");

const patientCode = z
  .string()
  .regex(/^P-\d{3,6}$/, "Use the pseudonymous patient code, e.g. P-1042. Never a name or phone number.")
  .describe("Pseudonymous patient code, e.g. P-1042. Never a name or phone number.");

const reference = z.string().min(6).max(100).describe("Payment reference returned by create_payment_link");
const sku = z.string().describe("SKU from check_stock");
const quantity = z.number().int().min(1).max(5).default(1);

const text = (payload: unknown) => [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }];

/** Runs a clinic action and turns a ClinicError into a tool-level error the agent can act on. */
async function run(action: () => unknown) {
  try {
    return { content: text(await action()) };
  } catch (err) {
    if (!(err instanceof ClinicError)) throw err;
    return { isError: true, content: text({ error_code: err.code, message: err.message, next_step: err.nextStep, ...err.extra }) };
  }
}

export function registerTools(server: McpServer, clinic: Clinic): void {
  server.registerTool(
    "check_stock",
    {
      title: "Check stock and price",
      description:
        "List the medicines and tests a health worker has on hand, with the fixed price in naira. " +
        "Pass `item` to search (e.g. 'ACT', 'malaria test', 'ORS'). Only recommend items returned here.",
      inputSchema: {
        worker_code: workerCode,
        item: z.string().max(60).optional().describe("Optional search text, e.g. 'ACT child' or 'RDT'"),
      },
      annotations: { readOnlyHint: true },
    },
    ({ worker_code, item }) => run(() => clinic.checkStock(worker_code, item)),
  );

  server.registerTool(
    "create_payment_link",
    {
      title: "Create a payment link (caregiver pays now)",
      description:
        "Create a Paystack payment link for one stocked item for a patient, paid by the caregiver on the spot. " +
        "Reuses an open link for the same patient and item instead of creating a duplicate.",
      inputSchema: { worker_code: workerCode, patient_code: patientCode, sku, quantity },
    },
    (a) => run(() => clinic.requestPayment({ ...a, payer: "caregiver" })),
  );

  server.registerTool(
    "request_sponsor_payment",
    {
      title: "Ask someone else to pay (sponsor)",
      description:
        "Create a payment link for a sponsor elsewhere (e.g. a family member in Lagos or abroad) and a ready-to-forward WhatsApp message. " +
        "Identify the patient only by code and relationship, never by name.",
      inputSchema: {
        worker_code: workerCode,
        patient_code: patientCode,
        sku,
        quantity,
        sponsor_relationship: z.string().max(40).describe("Who is paying, relative to the patient, e.g. 'mother's son'"),
      },
    },
    (a) => run(() => clinic.requestSponsorPayment(a)),
  );

  server.registerTool(
    "verify_payment",
    {
      title: "Verify a payment",
      description:
        "Check with Paystack whether a payment succeeded. This is the ONLY valid proof of payment. " +
        "Statuses: success, pending, abandoned, failed, amount_mismatch, not_found, refunded.",
      inputSchema: { reference },
      annotations: { idempotentHint: true },
    },
    ({ reference }) => run(() => clinic.verifyPayment(reference)),
  );

  server.registerTool(
    "record_dispense",
    {
      title: "Record a dispense",
      description:
        "After verify_payment returns success, record that the item was given to the patient. Decrements stock " +
        "and returns a receipt. Safe to call twice: returns the same receipt.",
      inputSchema: { reference },
      annotations: { idempotentHint: true },
    },
    ({ reference }) => run(() => clinic.dispense(reference)),
  );

  server.registerTool(
    "refund_payment",
    {
      title: "Refund a payment",
      description: "Refund a successful payment when the item cannot be dispensed (e.g. ran out). Not allowed after dispensing.",
      inputSchema: { reference, reason: z.string().max(200) },
      annotations: { destructiveHint: true },
    },
    ({ reference, reason }) => run(() => clinic.refund(reference, reason)),
  );

  server.registerTool(
    "create_referral",
    {
      title: "Refer a patient",
      description:
        "Book a referral to the nearest suitable facility that is accepting patients. 'emergency' goes to a general hospital, " +
        "'routine' to a primary health centre. Returns a referral code and the facility phone line.",
      inputSchema: {
        worker_code: workerCode,
        patient_code: patientCode,
        urgency: z.enum(["emergency", "routine"]),
        reason: z.string().min(3).max(300).describe("Danger signs or reason, no names"),
      },
    },
    (a) => run(() => clinic.refer(a)),
  );

  server.registerTool(
    "list_facilities",
    {
      title: "List facilities",
      description: "List referral facilities near a health worker's ward, with whether each is accepting patients.",
      inputSchema: { worker_code: workerCode },
      annotations: { readOnlyHint: true },
    },
    ({ worker_code }) => run(() => clinic.listFacilities(worker_code)),
  );
}
