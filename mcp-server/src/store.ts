import fs from "node:fs/promises";
import path from "node:path";

export type Payer = "caregiver" | "sponsor";

export type PaymentStatus =
  | "pending"
  | "success"
  | "failed"
  | "abandoned"
  | "amount_mismatch"
  | "refunded";

export interface Worker {
  code: string;
  ward: string;
  cadre: "CHEW" | "JCHEW"; // picks which Standing Orders volume applies
}

export interface StockItem {
  sku: string;
  name: string;
  unit: string;
  price_ngn: number;
  qty: number;
  reorder_level: number;
  keywords: string[];
}

export interface Payment {
  reference: string;
  worker_code: string;
  patient_code: string;
  sku: string;
  quantity: number;
  amount_kobo: number;
  currency: "NGN";
  payer: Payer;
  sponsor_relationship?: string;
  authorization_url: string;
  status: PaymentStatus;
  gateway_message?: string;
  created_at: string;
  verified_at?: string;
  dispensed_receipt?: string;
  refunded_at?: string;
  refund_reason?: string;
}

export interface Dispense {
  receipt: string;
  reference: string;
  worker_code: string;
  patient_code: string;
  sku: string;
  quantity: number;
  at: string;
}

export interface Facility {
  id: string;
  name: string;
  type: "phc" | "general_hospital";
  phone: string;
  accepting: boolean;
  distance_km: Record<string, number>; // by ward
}

export interface Referral {
  code: string;
  patient_code: string;
  worker_code: string;
  facility_id: string;
  urgency: "emergency" | "routine";
  reason: string;
  at: string;
}

export interface Ledger {
  workers: Worker[];
  stock: Record<string, StockItem[]>; // by worker code
  facilities: Facility[];
  payments: Payment[];
  dispenses: Dispense[];
  referrals: Referral[];
  mock_outcomes: Record<string, "success" | "failed" | "abandoned">;
}

/**
 * A tiny JSON-file store. Good enough for a demo and readable in a code review;
 * production would use Postgres with a unique index on payment reference.
 * Writes are serialized through a promise chain and replaced atomically.
 */
export class Store {
  private data!: Ledger;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private file: string, private seedFile: string) {}

  async load(): Promise<void> {
    try {
      this.data = JSON.parse(await fs.readFile(this.file, "utf8"));
    } catch (err) {
      // Seed only a missing ledger. A corrupt one must stop the server, not be
      // overwritten with seed data and lose every payment.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      this.data = JSON.parse(await fs.readFile(this.seedFile, "utf8"));
      await this.persist();
    }
  }

  read<T>(fn: (d: Ledger) => T): T {
    return fn(this.data);
  }

  write<T>(fn: (d: Ledger) => T | Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const result = await fn(this.data);
      await this.persist();
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.data, null, 2));
    await fs.rename(tmp, this.file);
  }
}
