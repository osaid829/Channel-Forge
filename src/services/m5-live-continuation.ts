import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SqliteDatabase } from "../db/database.js";
import { ProductionProviderRunRepository } from "../db/repositories.js";
import { ConflictError } from "../domain/errors.js";
import { MoneyPrinterTurboAdapter } from "./moneyprinterturbo-adapter.js";
import type { HttpRequest, HttpResponse, ProductionProvider } from "./production-provider.js";
import { ProductionService } from "./production-service.js";
import { SubmissionJournal } from "./submission-journal.js";

export interface M5LiveContinuationOptions {
  databasePath: string;
  workspacePath: string;
  providerConfigPath: string;
  jobId: string;
  remoteTaskId: string;
  attemptId: string;
  correlationId: string;
  pollLimit?: number;
  pollDelayMs?: number;
}

export interface M5LiveContinuationResult {
  mode: "status-and-retrieval-only";
  jobId: string;
  providerRunId: string;
  attemptId: string;
  correlationId: string;
  remoteTaskId: string;
  initialJobState: string;
  finalJobState: string;
  initialProviderState: string;
  finalProviderState: string;
  providerCorrelationIdentity: "verified" | "not-returned";
  pollStates: string[];
  statusRequests: number;
  artifactRoot: string;
  artifactPaths: string[];
  artifactIds: string[];
  journalStages: string[];
  attemptCount: number;
}

function fail(message: string): never {
  throw new Error(message);
}

function readProviderConfig(source: string): { apiKey: string; baseUrl: string } {
  const listenHost = source.match(/^listen_host\s*=\s*"([^"]+)"\s*$/m)?.[1];
  const listenPort = source.match(/^listen_port\s*=\s*(\d+)\s*$/m)?.[1];
  const apiKey = source.match(/(?:^|\n)\[app\]\s*\n([\s\S]*?)(?=\n\[[^\n]+\]|$)/)?.[1]?.match(/^api_key\s*=\s*"([^"]+)"\s*$/m)?.[1];
  if (!listenHost || !listenPort || !apiKey?.trim()) fail("MoneyPrinterTurbo local provider configuration is incomplete.");
  if (!["127.0.0.1", "localhost", "::1"].includes(listenHost)) fail("M5 continuation requires a loopback MoneyPrinterTurbo host.");
  return { apiKey, baseUrl: `http://${listenHost}:${listenPort}` };
}

function createFetchTransport(onStatusRequest: () => void) {
  return async (request: HttpRequest): Promise<HttpResponse> => {
    if (request.method === "GET" && request.headers.accept === "application/json" && request.url.includes("/api/v1/tasks/")) onStatusRequest();
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: request.signal,
      redirect: request.redirect ?? "error"
    });
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      json: () => response.json(),
      stream: async function* () {
        if (!response.body) return;
        const reader = response.body.getReader();
        try {
          while (true) {
            const next = await reader.read();
            if (next.done) return;
            yield next.value;
          }
        } finally {
          reader.releaseLock();
        }
      }
    };
  };
}

function statusOnlyProvider(adapter: MoneyPrinterTurboAdapter): ProductionProvider {
  return {
    name: adapter.name,
    submitProduction: async () => fail("M5 continuation is status-and-retrieval-only; submission is disabled."),
    getProductionStatus: (reference) => adapter.getProductionStatus(reference),
    getProductionArtifacts: (reference) => adapter.getProductionArtifacts(reference),
    cancelProduction: (reference) => adapter.cancelProduction(reference)
  };
}

function assertPersistedIdentity(
  service: ProductionService,
  options: M5LiveContinuationOptions,
  attempts: ReturnType<ProductionProviderRunRepository["getAttempts"]>
): { job: ReturnType<ProductionService["getJob"]>; run: NonNullable<ReturnType<ProductionService["getProviderRun"]>> } {
  const job = service.getJob(options.jobId);
  const run = service.getProviderRun(options.jobId);
  if (!run) throw new ConflictError("The isolated job has no persisted provider run", { jobId: options.jobId });
  if (run.provider !== "moneyprinterturbo" || run.remoteTaskId !== options.remoteTaskId || run.attemptId !== options.attemptId || run.correlationId !== options.correlationId) {
    throw new ConflictError("Persisted live production identity does not match the authoritative continuation identifiers", { jobId: options.jobId });
  }
  if (attempts.length !== 1 || attempts[0]?.id !== options.attemptId || attempts[0]?.remoteTaskId !== options.remoteTaskId || attempts[0]?.correlationId !== options.correlationId) {
    throw new ConflictError("Persisted attempt history is not the expected single acknowledged attempt", { jobId: options.jobId });
  }
  return { job, run };
}

async function wait(delayMs: number): Promise<void> {
  if (delayMs > 0) await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, delayMs));
}

export async function continueM5Live(options: M5LiveContinuationOptions): Promise<M5LiveContinuationResult> {
  const pollLimit = options.pollLimit ?? 8;
  const pollDelayMs = options.pollDelayMs ?? 2_000;
  if (!Number.isInteger(pollLimit) || pollLimit < 1 || pollLimit > 8) fail("M5 continuation polling limit must be between 1 and 8.");
  if (!Number.isInteger(pollDelayMs) || pollDelayMs < 0) fail("M5 continuation polling delay must be a non-negative integer.");

  const providerConfig = readProviderConfig(await readFile(options.providerConfigPath, "utf8"));
  const database = new SqliteDatabase(resolve(options.databasePath));
  const journalRoot = join(resolve(options.workspacePath), "submission-receipts");
  const artifactRoot = join(resolve(options.workspacePath), "artifacts", `continuation-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`);
  let statusRequests = 0;
  let service: ProductionService | undefined;
  try {
    service = new ProductionService(database);
    const attemptsRepository = new ProductionProviderRunRepository(database);
    const attempts = attemptsRepository.getAttempts(options.jobId);
    const initial = assertPersistedIdentity(service, options, attempts);
    await mkdir(artifactRoot, { recursive: true });
    const initialJobState = initial.job.currentState;
    const initialProviderState = initial.run.state;
    const adapter = new MoneyPrinterTurboAdapter({
      apiKey: providerConfig.apiKey,
      baseUrl: providerConfig.baseUrl,
      artifactRoot,
      transport: createFetchTransport(() => {
        statusRequests += 1;
        if (statusRequests > pollLimit) throw new ConflictError("M5 continuation status-request limit reached", { jobId: options.jobId });
      }),
      timeoutMs: 30_000,
      artifactTimeoutMs: 120_000
    });
    const provider = statusOnlyProvider(adapter);
    const pollStates: string[] = [];
    let run = initial.run;
    if (!["succeeded", "failed", "unknown"].includes(run.state)) {
      for (let poll = 0; poll < pollLimit; poll += 1) {
        await wait(poll === 0 ? 0 : pollDelayMs);
        run = await service.pollProduction(options.jobId, provider, { requireExactTaskIdentity: true });
        pollStates.push(run.state);
        if (["succeeded", "failed", "unknown"].includes(run.state)) break;
      }
    }

    const artifactPaths: string[] = [];
    const artifactIds: string[] = [];
    if (run.state === "succeeded") {
      const assets = await service.getProductionArtifacts(options.jobId, provider);
      for (const asset of assets) {
        artifactPaths.push(asset.relativePath);
        artifactIds.push(asset.id);
      }
    }
    const receipts = await SubmissionJournal.read(journalRoot, options.jobId, options.attemptId);
    return {
      mode: "status-and-retrieval-only",
      jobId: options.jobId,
      providerRunId: run.id,
      attemptId: run.attemptId,
      correlationId: run.correlationId,
      remoteTaskId: run.remoteTaskId ?? options.remoteTaskId,
      initialJobState,
      finalJobState: service.getJob(options.jobId).currentState,
      initialProviderState,
      finalProviderState: run.state,
      providerCorrelationIdentity: typeof run.providerPayload.request_id === "string" ? "verified" : "not-returned",
      pollStates,
      statusRequests,
      artifactRoot,
      artifactPaths,
      artifactIds,
      journalStages: receipts.map((receipt) => receipt.stage),
      attemptCount: attempts.length
    };
  } finally {
    if (service) service.close(); else database.close();
  }
}
