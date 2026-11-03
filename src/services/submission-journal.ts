import { dirname, join, resolve } from "node:path";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";

export const SUBMISSION_RECEIPT_STAGES = [
  "PREPARED",
  "REQUEST_STARTED",
  "RESPONSE_RECEIVED",
  "ACKNOWLEDGEMENT_PERSISTED"
] as const;

export type SubmissionReceiptStage = (typeof SUBMISSION_RECEIPT_STAGES)[number];

export interface SubmissionReceiptContext {
  productionJobId: string;
  providerRunId: string;
  attemptId: string;
  correlationId: string;
  requestFingerprint: string;
  materialManifestFingerprint: string;
}

export interface SubmissionReceipt extends SubmissionReceiptContext {
  stage: SubmissionReceiptStage;
  recordedAt: string;
  providerTaskId?: string;
  providerState?: string;
  providerStatus?: number;
  error?: string;
}

async function writeAtomically(path: string, value: unknown): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export class SubmissionJournal {
  private readonly directory: string;

  constructor(root: string, private readonly context: SubmissionReceiptContext) {
    this.directory = resolve(root, context.productionJobId, context.attemptId);
  }

  async record(stage: SubmissionReceiptStage, details: Omit<SubmissionReceipt, keyof SubmissionReceiptContext | "stage" | "recordedAt"> = {}): Promise<SubmissionReceipt> {
    const receipt: SubmissionReceipt = { ...this.context, stage, recordedAt: new Date().toISOString(), ...details };
    await writeAtomically(join(this.directory, `${stage}.json`), receipt);
    await writeAtomically(join(this.directory, "latest.json"), receipt);
    return receipt;
  }

  static async read(root: string, productionJobId: string, attemptId: string): Promise<SubmissionReceipt[]> {
    const directory = resolve(root, productionJobId, attemptId);
    const records: SubmissionReceipt[] = [];
    for (const stage of SUBMISSION_RECEIPT_STAGES) {
      try {
        records.push(JSON.parse(await readFile(join(directory, `${stage}.json`), "utf8")) as SubmissionReceipt);
      } catch (error) {
        if (!(error instanceof Error) || !((error as NodeJS.ErrnoException).code === "ENOENT")) throw error;
      }
    }
    return records;
  }
}
