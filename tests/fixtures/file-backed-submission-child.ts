import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteDatabase } from "../../src/db/database.js";
import { ProductionService } from "../../src/services/production-service.js";
import { journaledSubmissionProvider, recordAcknowledgement } from "../../src/services/journaled-submission-provider.js";
import { SubmissionJournal } from "../../src/services/submission-journal.js";

const root = await mkdtemp(join(tmpdir(), "channelforge-child-db-"));
const database = new SqliteDatabase(join(root, "database.sqlite"));
try {
  const service = new ProductionService(database);
  const channel = service.createChannel({ slug: `child-${Date.now()}`, platform: "youtube", locale: "en-US", audience: "science learners", contentPillars: ["science"], brand: { voice: "clear", visualStyle: "educational", bannedTopics: [] }, policy: { defaultPrivacy: "private", humanApprovalRequired: true, factualReviewRequired: true, rightsReviewRequired: true }, credentialsRef: { youtube: "secret://child" }, status: "active" });
  const brief = service.createBrief({ channelId: channel.id, topic: "Why is the sky blue?", angle: "Rayleigh scattering", hook: "Air scatters blue light.", format: "short", language: "en", aspectRatio: "9:16", targetDurationSec: 3, audiencePromise: "Learn the core idea.", contentPillars: ["science"], status: "ready" });
  const job = service.createProductionJob({ channelId: channel.id, briefId: brief.id, renderer: "moneyprinterturbo", idempotencyKey: `child-${Date.now()}` });
  for (const state of ["PLANNING", "NARRATING", "SOURCING", "CAPTIONING", "RENDERING"] as const) service.transitionJob(job.id, state);
  const input = { topic: "Why is the sky blue?", script: "Air scatters shorter blue wavelengths more strongly.", videoTerms: ["sky", "scattering"], language: "en", aspectRatio: "9:16" as const, targetDurationSec: 3, videoSource: "local" as const, videoMaterials: [{ provider: "local" as const, url: "scene-01.mp4" }], voiceName: "kokoro:af_heart", subtitleEnabled: false, backgroundMusic: "" as const };
  let calls = 0;
  const provider = journaledSubmissionProvider(service, job.id, {
    name: "moneyprinterturbo",
    submitProduction: async () => { calls += 1; return { state: "accepted", providerStatus: 200, reference: { provider: "moneyprinterturbo", remoteTaskId: "child-task", correlationId: `channelforge-${job.id}-attempt-1` }, providerPayload: { task_id: "child-task" } }; },
    getProductionStatus: async () => { throw new Error("not used"); },
    getProductionArtifacts: async () => { throw new Error("not used"); },
    cancelProduction: async () => ({ state: "unsupported" as const })
  }, join(root, "receipts"), "child-manifest");
  const result = await service.submitProduction(job.id, input, provider);
  const run = service.getProviderRun(job.id);
  if (!run) throw new Error("Missing child provider run");
  await recordAcknowledgement(service, job.id, new SubmissionJournal(join(root, "receipts"), { productionJobId: job.id, providerRunId: run.id, attemptId: run.attemptId, correlationId: run.correlationId, requestFingerprint: run.requestFingerprint, materialManifestFingerprint: "child-manifest" }), result.state, result.remoteTaskId, result.providerStatus);
  const receipts = await SubmissionJournal.read(join(root, "receipts"), job.id, run.attemptId);
  console.log(JSON.stringify({ jobId: job.id, runId: run.id, attemptId: run.attemptId, state: run.state, remoteTaskId: run.remoteTaskId, calls, receiptStages: receipts.map((receipt) => receipt.stage) }));
} finally {
  database.close();
}
