import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteDatabase } from "../src/db/database.js";
import { ProductionService } from "../src/services/production-service.js";
import { ProviderAdapterError, type ProductionProvider, type ProviderProductionRequest } from "../src/services/production-provider.js";
import { journaledSubmissionProvider, recordAcknowledgement } from "../src/services/journaled-submission-provider.js";
import { SubmissionJournal } from "../src/services/submission-journal.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
let sequence = 0;

function setup() {
  const root = mkdtempSync(join(tmpdir(), "channelforge-harness-"));
  roots.push(root);
  const database = new SqliteDatabase(join(root, "database.sqlite"));
  const service = new ProductionService(database);
  const channel = service.createChannel({ slug: `harness-${++sequence}`, platform: "youtube", locale: "en-US", audience: "science learners", contentPillars: ["science"], brand: { voice: "clear", visualStyle: "educational", bannedTopics: [] }, policy: { defaultPrivacy: "private", humanApprovalRequired: true, factualReviewRequired: true, rightsReviewRequired: true }, credentialsRef: { youtube: "secret://harness" }, status: "active" });
  const brief = service.createBrief({ channelId: channel.id, topic: "Why is the sky blue?", angle: "Rayleigh scattering", hook: "Air scatters blue light.", format: "short", language: "en", aspectRatio: "9:16", targetDurationSec: 3, audiencePromise: "Learn the core idea.", contentPillars: ["science"], status: "ready" });
  const job = service.createProductionJob({ channelId: channel.id, briefId: brief.id, renderer: "moneyprinterturbo", idempotencyKey: `harness-${sequence}` });
  for (const state of ["PLANNING", "NARRATING", "SOURCING", "CAPTIONING", "RENDERING"] as const) service.transitionJob(job.id, state);
  return { root, database, service, job };
}

function input(): Omit<ProviderProductionRequest, "correlationId"> {
  return { topic: "Why is the sky blue?", script: "Air scatters shorter blue wavelengths more strongly.", videoTerms: ["sky", "scattering"], language: "en", aspectRatio: "9:16", targetDurationSec: 3, videoSource: "local", videoMaterials: [{ provider: "local", url: "scene-01.mp4" }], voiceName: "kokoro:af_heart", subtitleEnabled: false, backgroundMusic: "" };
}

function provider(submitProduction: ProductionProvider["submitProduction"]): ProductionProvider {
  return { name: "moneyprinterturbo", submitProduction, getProductionStatus: async () => { throw new Error("not used"); }, getProductionArtifacts: async () => { throw new Error("not used"); }, cancelProduction: async () => ({ state: "unsupported" }) };
}

async function runCase(submitProduction: ProductionProvider["submitProduction"]) {
  const setupValue = setup();
  const journalRoot = join(setupValue.root, "receipts");
  const wrapped = journaledSubmissionProvider(setupValue.service, setupValue.job.id, provider(submitProduction), journalRoot, "manifest-fingerprint");
  let result;
  let thrown: unknown;
  try { result = await setupValue.service.submitProduction(setupValue.job.id, input(), wrapped); } catch (error) { thrown = error; }
  const run = setupValue.service.getProviderRun(setupValue.job.id)!;
  const receipts = await SubmissionJournal.read(journalRoot, setupValue.job.id, run.attemptId);
  return { ...setupValue, result, thrown, run, receipts };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("journaled submission harness", () => {
  it("captures the exact mocked payload boundary and persists acknowledgement", async () => {
    let received: ProviderProductionRequest | undefined;
    const result = await runCase(async (request) => { received = request; return { state: "accepted", providerStatus: 200, reference: { provider: "moneyprinterturbo", remoteTaskId: "mock-task", correlationId: request.correlationId }, providerPayload: { task_id: "mock-task" } }; });
    await recordAcknowledgement(result.service, result.job.id, new SubmissionJournal(join(result.root, "receipts"), { productionJobId: result.job.id, providerRunId: result.run.id, attemptId: result.run.attemptId, correlationId: result.run.correlationId, requestFingerprint: result.run.requestFingerprint, materialManifestFingerprint: "manifest-fingerprint" }), result.run.state, result.run.remoteTaskId, result.run.providerStatus);
    const receipts = await SubmissionJournal.read(join(result.root, "receipts"), result.job.id, result.run.attemptId);
    expect(received?.videoMaterials).toHaveLength(1);
    expect(result.run.state).toBe("accepted");
    expect(result.run.remoteTaskId).toBe("mock-task");
    expect(receipts.map((receipt) => receipt.stage)).toEqual(["PREPARED", "REQUEST_STARTED", "RESPONSE_RECEIVED", "ACKNOWLEDGEMENT_PERSISTED"]);
    expect(receipts.every((receipt) => receipt.providerRunId && receipt.attemptId && receipt.correlationId && receipt.requestFingerprint === result.run.requestFingerprint && receipt.materialManifestFingerprint === "manifest-fingerprint")).toBe(true);
  });

  it("preserves UNKNOWN after an ambiguous timeout and does not automatically retry", async () => {
    let calls = 0;
    const result = await runCase(async () => { calls += 1; throw new ProviderAdapterError("timeout", "mock timeout"); });
    expect(result.run.state).toBe("unknown");
    expect(result.run.remoteTaskId).toBeUndefined();
    expect(calls).toBe(1);
    await expect(result.service.submitProduction(result.job.id, input(), provider(async () => { calls += 1; return { state: "accepted", providerPayload: {} }; }))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(calls).toBe(1);
  });

  it("persists provider rejection as failed without retrying", async () => {
    const result = await runCase(async () => { throw new ProviderAdapterError("http", "mock rejection"); });
    expect(result.run.state).toBe("failed");
    expect(result.run.error).toContain("mock rejection");
  });

  it("records an interrupted transport boundary without creating a duplicate request", async () => {
    const result = await runCase(async () => { throw new Error("connection interrupted"); });
    expect(result.run.state).toBe("failed");
    expect(result.receipts.map((receipt) => receipt.stage)).toEqual(["PREPARED", "REQUEST_STARTED", "RESPONSE_RECEIVED"]);
  });

  it("runs the file-backed child process to normal exit after native cleanup", async () => {
    const { stdout } = await execFileAsync(process.execPath, ["scripts/run-file-backed-submission-harness.mjs", "tests/fixtures/file-backed-submission-child.ts"], { cwd: process.cwd(), timeout: 120000, maxBuffer: 1024 * 1024 });
    const result = JSON.parse(stdout.trim());
    expect(result.state).toBe("accepted");
    expect(result.remoteTaskId).toBe("child-task");
    expect(result.calls).toBe(1);
    expect(result.receiptStages).toEqual(["PREPARED", "REQUEST_STARTED", "RESPONSE_RECEIVED", "ACKNOWLEDGEMENT_PERSISTED"]);
  });
});
