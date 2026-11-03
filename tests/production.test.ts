import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConflictError, IdempotencyConflictError, InvalidTransitionError, ApprovalRequiredError, UnsafePathError } from "../src/domain/errors.js";
import { canTransition } from "../src/domain/job-state-machine.js";
import { SqliteDatabase } from "../src/db/database.js";
import { ArtifactValidationService } from "../src/services/artifact-validation.js";
import { ProductionService } from "../src/services/production-service.js";
import type { ProductionProvider } from "../src/services/production-provider.js";

const directories: string[] = [];
const databases: SqliteDatabase[] = [];

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "channelforge-"));
  directories.push(directory);
  const database = new SqliteDatabase(join(directory, "channel-forge.sqlite"));
  databases.push(database);
  return { directory, database, service: new ProductionService(database) };
}

function channel(service: ProductionService, slug = "ai-tools-productivity") {
  return service.createChannel({ slug, platform: "youtube", locale: "en-US", audience: "US professionals", contentPillars: ["AI tools"], brand: { voice: "clear", visualStyle: "editorial", bannedTopics: [] }, policy: { defaultPrivacy: "private", humanApprovalRequired: true, factualReviewRequired: true, rightsReviewRequired: true }, credentialsRef: { youtube: `secret://youtube/${slug}` } });
}

function brief(service: ProductionService, channelId: string) {
  return service.createBrief({ channelId, topic: "What Would Happen If the Internet Disappeared for One Hour?", angle: "First-order consequences", hook: "At 9:00 AM, every screen goes blank.", format: "short", language: "en", aspectRatio: "9:16", targetDurationSec: 45, audiencePromise: "Understand the impact quickly", contentPillars: ["technology"] });
}

function job(service: ProductionService, channelId: string, briefId: string, idempotencyKey = "fixture-v1") {
  return service.createProductionJob({ channelId, briefId, renderer: "fixture-renderer", idempotencyKey });
}

function validating(service: ProductionService, jobId: string): void {
  for (const state of ["PLANNING", "NARRATING", "SOURCING", "CAPTIONING", "RENDERING", "VALIDATING"] as const) service.transitionJob(jobId, state);
}

function fixtureProbe(overrides: Record<string, unknown> = {}) {
  return {
    playable: true,
    mimeType: "video/mp4",
    durationSec: 1,
    width: 1920,
    height: 1080,
    containerFormat: "mov,mp4,m4a,3gp,3g2,mj2",
    videoStreams: [{ index: 0, codecName: "h264", durationSec: 1, width: 1920, height: 1080, frameRate: 30 }],
    audioStreams: [{ index: 1, codecName: "aac", durationSec: 1, sampleRate: 44100, channels: 2, channelLayout: "stereo" }],
    decode: { video: "passed" as const, audio: "passed" as const },
    audioLoudness: { meanDb: -19, maxDb: -5 },
    raw: { fixture: true },
    ...overrides
  };
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("ChannelForge domain and persistence", () => {
  it("creates channels, briefs, and jobs", () => {
    const { service } = setup(); const c = channel(service); const b = brief(service, c.id); const j = job(service, c.id, b.id);
    expect(c.schemaVersion).toBe(1); expect(b.channelId).toBe(c.id); expect(j.currentState).toBe("CREATED");
  });

  it("accepts and rejects state transitions consistently", () => {
    expect(canTransition("CREATED", "PLANNING")).toBe(true); expect(canTransition("APPROVED", "PLANNING")).toBe(false);
    const { service } = setup(); const c = channel(service); const b = brief(service, c.id); const j = job(service, c.id, b.id);
    expect(() => service.transitionJob(j.id, "RENDERING")).toThrow(InvalidTransitionError);
  });

  it("enforces idempotency and active-job uniqueness", () => {
    const { service } = setup(); const c = channel(service); const b = brief(service, c.id); const first = job(service, c.id, b.id); const second = job(service, c.id, b.id);
    expect(second.id).toBe(first.id);
    expect(() => service.createProductionJob({ channelId: c.id, briefId: b.id, renderer: "other", idempotencyKey: "fixture-v1" })).toThrow(IdempotencyConflictError);
    expect(() => service.createProductionJob({ channelId: c.id, briefId: b.id, renderer: "fixture", idempotencyKey: "fixture-v2" })).toThrow(ConflictError);
  });

  it("persists after reopening and records transitions", () => {
    const first = setup(); const c = channel(first.service); const b = brief(first.service, c.id); const j = job(first.service, c.id, b.id); first.database.close();
    const reopened = new SqliteDatabase(join(first.directory, "channel-forge.sqlite")); databases.push(reopened); const service = new ProductionService(reopened);
    service.transitionJob(j.id, "PLANNING"); expect(service.getJob(j.id).currentState).toBe("PLANNING"); expect(service.getJobHistory(j.id)).toHaveLength(2); reopened.close();
  });

  it("recovers active interruption as an inspectable failure", () => {
    const { service } = setup(); const c = channel(service); const b = brief(service, c.id); const j = job(service, c.id, b.id); service.transitionJob(j.id, "PLANNING");
    const recovered = service.recoverInterruptedJobs()[0]; expect(recovered.currentState).toBe("FAILED"); expect(recovered.failureKind).toBe("interrupted"); expect(recovered.interruptedAt).toBeDefined(); expect(recovered.lastError).toContain("Interrupted");
  });

  it("keeps synthetic validation outside the trusted approval path", () => {
    const { service } = setup(); const c = channel(service); const b = brief(service, c.id); const j = job(service, c.id, b.id);
    const asset = service.recordArtifact({ productionJobId: j.id, type: "render", relativePath: "jobs/fixture/final.mp4", mimeType: "video/mp4", sha256: "a".repeat(64), byteSize: 100, sourceProvider: "fixture", sourceMetadata: { synthetic: true }, rightsStatus: "pending", isSynthetic: true });
    expect(asset.validationStatus).toBe("unvalidated");
    expect(() => service.validateArtifact(asset.id)).toThrow(ConflictError);
  });

  it("accepts a real non-synthetic artifact only with trusted evidence", () => {
    const { directory, database } = setup();
    const relativePath = "jobs/fixture/final.mp4";
    const absolutePath = join(directory, relativePath);
    const payload = Buffer.from("fixture media payload");
    mkdirSync(join(directory, "jobs/fixture"), { recursive: true });
    writeFileSync(absolutePath, payload);
    const canonicalAbsolutePath = realpathSync(absolutePath);
    const probe = { source: "trusted-runtime" as const, inspect: (path: string) => {
      expect(path).toBe(canonicalAbsolutePath);
      return fixtureProbe();
    } };
    const service = new ProductionService(database, { artifactValidator: new ArtifactValidationService(directory, probe) });
    const c = channel(service); const b = brief(service, c.id); const j = job(service, c.id, b.id);
    validating(service, j.id);
    const asset = service.recordArtifact({ productionJobId: j.id, type: "render", relativePath, mimeType: "video/mp4", sha256: createHash("sha256").update(payload).digest("hex"), byteSize: payload.byteLength, sourceProvider: "fixture", sourceMetadata: {}, rightsStatus: "pending", isSynthetic: false });
    const validated = service.validateArtifact(asset.id);
    expect(validated.validationStatus).toBe("validated");
    expect(validated.validationEvidence).toMatchObject({ source: "trusted-runtime", byteSize: payload.byteLength });
  });

  it("records visual review flags without rejecting technically valid media", () => {
    const { directory, database } = setup();
    const relativePath = "jobs/fixture/static.mp4";
    const absolutePath = join(directory, relativePath);
    const payload = Buffer.from("fixture media payload");
    mkdirSync(join(directory, "jobs/fixture"), { recursive: true });
    writeFileSync(absolutePath, payload);
    const service = new ProductionService(database, {
      artifactValidator: new ArtifactValidationService(directory, {
        source: "trusted-runtime",
        inspect: () => fixtureProbe({
          durationSec: 24,
          width: 1080,
          height: 1920,
          videoStreams: [{ index: 0, codecName: "h264", durationSec: 24, width: 1080, height: 1920, frameRate: 30 }],
          audioStreams: [{ index: 1, codecName: "aac", durationSec: 24, sampleRate: 44100, channels: 2, channelLayout: "stereo" }],
          visualAnalysis: {
            sampleCount: 47,
            durationSec: 23.67,
            meanAbsoluteFrameDifferenceMean: 0.001,
            meanAbsoluteFrameDifferenceMax: 0.015,
            nearIdenticalPairRatio: 44 / 46,
            frameMeanRange: 0.008,
            frameStdDevRange: 0.035
          }
        })
      })
    });
    const c = channel(service, "static-review");
    const b = brief(service, c.id);
    const j = job(service, c.id, b.id, "static-review-v1");
    validating(service, j.id);
    const asset = service.recordArtifact({ productionJobId: j.id, type: "render", relativePath, mimeType: "video/mp4", sha256: createHash("sha256").update(payload).digest("hex"), byteSize: payload.byteLength, sourceProvider: "fixture", sourceMetadata: {}, rightsStatus: "pending", isSynthetic: false });
    const validated = service.validateArtifact(asset.id);
    expect(validated.validationStatus).toBe("validated");
    expect(validated.validationEvidence?.probe).toMatchObject({
      visualQualityReview: {
        status: "review_required",
        flags: ["excessive_static_frame_behavior", "placeholder_like_static_composition"]
      }
    });
  });

  it("records artifacts atomically with an unvalidated status", () => {
    const { service } = setup(); const c = channel(service); const b = brief(service, c.id); const j = job(service, c.id, b.id);
    const asset = service.recordArtifact({ productionJobId: j.id, type: "render", relativePath: "jobs/fixture/final.mp4", mimeType: "video/mp4", sha256: "c".repeat(64), byteSize: 100, sourceProvider: "fixture", sourceMetadata: {}, rightsStatus: "pending", isSynthetic: false });
    expect(asset.validationStatus).toBe("unvalidated");
    expect(service.getJob(j.id).artifactIds).toContain(asset.id);
  });

  it("rejects unsafe paths", () => {
    const { service } = setup(); const c = channel(service); const b = brief(service, c.id); const j = job(service, c.id, b.id); const base = { productionJobId: j.id, type: "video" as const, mimeType: "video/mp4", sha256: "b".repeat(64), byteSize: 1, sourceProvider: "fixture", sourceMetadata: {}, rightsStatus: "pending" as const, isSynthetic: true };
    expect(() => service.recordArtifact({ ...base, relativePath: "../escape.mp4" })).toThrow(UnsafePathError);
    expect(() => service.recordArtifact({ ...base, relativePath: "/tmp/escape.mp4" })).toThrow(UnsafePathError);
  });

  it("requires a current authority-bound human approval", () => {
    const { service } = setup(); const c = channel(service); const b = brief(service, c.id); const j = job(service, c.id, b.id);
    expect(() => service.approveJob(j.id)).toThrow(ApprovalRequiredError);
  });

  it("isolates jobs between channels", () => {
    const { service } = setup(); const first = channel(service, "ai-tools-productivity"); const second = channel(service, "gaming-mysteries"); const firstBrief = brief(service, first.id); const secondBrief = service.createBrief({ channelId: second.id, topic: "A Roblox mystery story", angle: "Suspense", hook: "The server was empty.", format: "short", language: "en", aspectRatio: "9:16", targetDurationSec: 45, audiencePromise: "A short mystery", contentPillars: ["mystery"] });
    expect(job(service, first.id, firstBrief.id, "first").channelId).toBe(first.id); expect(job(service, second.id, secondBrief.id, "second").channelId).toBe(second.id); expect(service.listChannelJobs(first.id)).toHaveLength(1); expect(service.listChannelJobs(second.id)).toHaveLength(1);
  });

  it("transitions to REVIEW only after complete provider-bound validation", async () => {
    const { directory, database, service } = setup(); const c = channel(service, "complete-validation"); const b = brief(service, c.id); const j = job(service, c.id, b.id, "complete-validation-v1"); validating(service, j.id);
    const correlationId = `channelforge-${j.id}-attempt-1`;
    const provider: ProductionProvider = { name: "moneyprinterturbo", submitProduction: async () => ({ state: "accepted", reference: { provider: "moneyprinterturbo", remoteTaskId: "task-validation", correlationId }, providerPayload: {} }), getProductionStatus: async (reference) => ({ reference, state: "succeeded", progress: 100, providerStatus: 1, providerPayload: { task_id: reference.remoteTaskId } }), getProductionArtifacts: async () => [], cancelProduction: async () => ({ state: "unsupported" }) };
    await service.submitProduction(j.id, { topic: "topic", script: "script", videoTerms: ["term"], language: "en", aspectRatio: "9:16", targetDurationSec: 45 }, provider); await service.pollProduction(j.id, provider);
    mkdirSync(join(directory, "jobs/complete"), { recursive: true }); writeFileSync(join(directory, "jobs/complete/final.mp4"), "render"); writeFileSync(join(directory, "jobs/complete/audio.mp3"), "audio");
    const provenance = { provider: "moneyprinterturbo", remoteTaskId: "task-validation", correlationId, providerPath: "/tasks/task-validation/final-1.mp4" };
    service.recordArtifact({ productionJobId: j.id, type: "render", relativePath: "jobs/complete/final.mp4", mimeType: "video/mp4", sha256: createHash("sha256").update("render").digest("hex"), byteSize: 6, sourceProvider: "moneyprinterturbo", sourceMetadata: { provenance }, isSynthetic: false });
    service.recordArtifact({ productionJobId: j.id, type: "audio", relativePath: "jobs/complete/audio.mp3", mimeType: "audio/mpeg", sha256: createHash("sha256").update("audio").digest("hex"), byteSize: 5, sourceProvider: "moneyprinterturbo", sourceMetadata: { provenance: { ...provenance, providerPath: "/tasks/task-validation/audio.mp3" } }, isSynthetic: false });
    const validator = new ArtifactValidationService(directory, { source: "trusted-runtime", inspect: (path) => path.endsWith("audio.mp3") ? { playable: true, mimeType: "audio/mpeg", durationSec: 45, width: 0, height: 0, containerFormat: "mp3", videoStreams: [], audioStreams: [{ index: 0, codecName: "mp3", durationSec: 45, sampleRate: 24000, channels: 1 }], decode: { video: "not_required", audio: "passed" }, audioLoudness: { meanDb: -19, maxDb: -5 }, raw: {} } : fixtureProbe({ durationSec: 45, width: 1080, height: 1920, videoStreams: [{ index: 0, codecName: "h264", durationSec: 45, width: 1080, height: 1920, frameRate: 30 }], audioStreams: [{ index: 1, codecName: "aac", durationSec: 45, sampleRate: 44100, channels: 2 }] }) });
    expect(new ProductionService(database, { artifactValidator: validator }).validateProduction(j.id).currentState).toBe("REVIEW");
  });

  it("does not partially validate an artifact set when one asset fails", async () => {
    const { directory, database, service } = setup(); const c = channel(service, "atomic-validation"); const b = brief(service, c.id); const j = job(service, c.id, b.id, "atomic-validation-v1"); validating(service, j.id);
    const correlationId = `channelforge-${j.id}-attempt-1`;
    const provider: ProductionProvider = { name: "moneyprinterturbo", submitProduction: async () => ({ state: "accepted", reference: { provider: "moneyprinterturbo", remoteTaskId: "task-atomic", correlationId }, providerPayload: {} }), getProductionStatus: async (reference) => ({ reference, state: "succeeded", progress: 100, providerStatus: 1, providerPayload: { task_id: reference.remoteTaskId } }), getProductionArtifacts: async () => [], cancelProduction: async () => ({ state: "unsupported" }) };
    await service.submitProduction(j.id, { topic: "topic", script: "script", videoTerms: ["term"], language: "en", aspectRatio: "9:16", targetDurationSec: 45 }, provider); await service.pollProduction(j.id, provider);
    mkdirSync(join(directory, "jobs/atomic"), { recursive: true }); writeFileSync(join(directory, "jobs/atomic/final.mp4"), "render"); writeFileSync(join(directory, "jobs/atomic/audio.mp3"), "audio");
    const provenance = { provider: "moneyprinterturbo", remoteTaskId: "task-atomic", correlationId, providerPath: "/tasks/task-atomic/final-1.mp4" };
    service.recordArtifact({ productionJobId: j.id, type: "render", relativePath: "jobs/atomic/final.mp4", mimeType: "video/mp4", sha256: createHash("sha256").update("render").digest("hex"), byteSize: 6, sourceProvider: "moneyprinterturbo", sourceMetadata: { provenance }, isSynthetic: false });
    service.recordArtifact({ productionJobId: j.id, type: "audio", relativePath: "jobs/atomic/audio.mp3", mimeType: "audio/mpeg", sha256: createHash("sha256").update("audio").digest("hex"), byteSize: 5, sourceProvider: "moneyprinterturbo", sourceMetadata: { provenance: { ...provenance, providerPath: "/tasks/task-atomic/audio.mp3" } }, isSynthetic: false });
    const validator = new ArtifactValidationService(directory, { source: "trusted-runtime", inspect: (path) => { if (path.endsWith("audio.mp3")) throw new Error("tool failure"); return fixtureProbe({ durationSec: 45, width: 1080, height: 1920, videoStreams: [{ index: 0, codecName: "h264", durationSec: 45, width: 1080, height: 1920, frameRate: 30 }], audioStreams: [{ index: 1, codecName: "aac", durationSec: 45, sampleRate: 44100, channels: 2 }] }); } });
    const validatingService = new ProductionService(database, { artifactValidator: validator });
    expect(() => validatingService.validateProduction(j.id)).toThrow("tool failure");
    expect(validatingService.getJob(j.id).currentState).toBe("VALIDATING");
    expect(validatingService.getJob(j.id).artifactIds).toHaveLength(2);
  });
});
