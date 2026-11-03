import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ApprovalRequiredError } from "../src/domain/errors.js";
import { SqliteDatabase } from "../src/db/database.js";
import { ArtifactValidationService } from "../src/services/artifact-validation.js";
import { MoneyPrinterTurboAdapter } from "../src/services/moneyprinterturbo-adapter.js";
import { ProductionService } from "../src/services/production-service.js";
import { createProviderResolutionBoundary } from "../src/services/provider-resolution-boundary.js";
import { type HttpRequest, type HttpResponse, type ProviderProductionRequest } from "../src/services/production-provider.js";

const directories: string[] = [];
const databases: SqliteDatabase[] = [];
let jobSequence = 0;

function response(payload: unknown, status = 200): HttpResponse {
  const bytes = Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload));
  return {
    status,
    json: async () => payload,
    headers: { "content-length": String(bytes.byteLength) },
    stream: async function* () { const copy = new Uint8Array(bytes.byteLength); copy.set(bytes); yield copy; }
  };
}

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "channelforge-mpt-"));
  directories.push(directory);
  const database = new SqliteDatabase(join(directory, "channel-forge.sqlite"));
  databases.push(database);
  const service = new ProductionService(database);
  return { directory, database, service };
}

function setupWithResolutionAuthority(operatorId: string) {
  const base = setup();
  const boundary = createProviderResolutionBoundary(operatorId);
  return { ...base, boundary, service: new ProductionService(base.database, { resolutionVerifier: boundary.verifier }) };
}

function artifactDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "mpt-artifacts-"));
  directories.push(directory);
  return directory;
}

function createJob(service: ProductionService) {
  const channel = service.createChannel({ slug: `mpt-${++jobSequence}`, platform: "youtube", locale: "en-US", audience: "US professionals", contentPillars: ["technology"], brand: { voice: "clear", visualStyle: "editorial", bannedTopics: [] }, policy: { defaultPrivacy: "private", humanApprovalRequired: true, factualReviewRequired: true, rightsReviewRequired: true }, credentialsRef: { youtube: "secret://youtube/test" } });
  const brief = service.createBrief({ channelId: channel.id, topic: "What Would Happen If the Internet Disappeared for One Hour?", angle: "First-order consequences", hook: "At 9:00 AM, every screen goes blank.", format: "short", language: "en", aspectRatio: "9:16", targetDurationSec: 45, audiencePromise: "Understand the impact quickly", contentPillars: ["technology"] });
  return service.createProductionJob({ channelId: channel.id, briefId: brief.id, renderer: "moneyprinterturbo", idempotencyKey: `mpt-${brief.id}` });
}

const requestInput: Omit<ProviderProductionRequest, "correlationId"> = {
  topic: "What Would Happen If the Internet Disappeared for One Hour?",
  script: "At 9:00 AM, every screen goes blank. Then the world starts improvising.",
  videoTerms: ["internet outage", "emergency communication"],
  language: "en",
  aspectRatio: "9:16",
  targetDurationSec: 45,
  videoSource: "local",
  subtitleEnabled: true,
  backgroundMusic: ""
};

function adapter(directory: string, transport: (request: HttpRequest) => Promise<HttpResponse>, options: Partial<{ timeoutMs: number; pollIntervalMs: number; maxPolls: number; maxArtifactBytes: number; artifactTimeoutMs: number }> = {}) {
  return new MoneyPrinterTurboAdapter({ apiKey: "local-test-key", artifactRoot: directory, transport, ...options });
}

function successfulTaskResponse(taskOverrides: Record<string, unknown> = {}) {
  return {
    status: 200,
    message: "success",
    data: {
      task_id: "remote-success",
      state: 1,
      progress: 100,
      videos: ["/tasks/remote-success/final-1.mp4"],
      combined_videos: ["/tasks/remote-success/combined-1.mp4"],
      failed_stage: null,
      error: null,
      cross_post_state: null,
      cross_post_results: null,
      cross_post_error: null,
      warnings: null,
      failed_video_index: null,
      script: "safe fixture script",
      terms: "safe fixture terms",
      audio_file: "/tasks/remote-success/audio.mp3",
      audio_duration: 24,
      subtitle_path: "",
      materials: [],
      ...taskOverrides
    }
  };
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function pendingUntilAborted(request: HttpRequest): Promise<HttpResponse> {
  return new Promise((_, reject) => {
    const rejectAborted = () => {
      const error = new Error("request aborted");
      error.name = "AbortError";
      reject(error);
    };
    if (request.signal?.aborted) {
      rejectAborted();
      return;
    }
    request.signal?.addEventListener("abort", rejectAborted, { once: true });
  });
}

describe("MoneyPrinterTurbo adapter", () => {
  it("submits a typed production request with authenticated correlation", async () => {
    let received: HttpRequest | undefined;
    const provider = adapter(artifactDirectory(), async (request) => { received = request; return response({ status: 200, message: "success", data: { task_id: "remote-1" } }); });
    const result = await provider.submitProduction({ ...requestInput, correlationId: "channelforge-job-1" });
    expect(result.state).toBe("accepted");
    expect(result.reference?.remoteTaskId).toBe("remote-1");
    expect(received?.headers["x-api-key"]).toBe("local-test-key");
    expect(received?.headers["x-task-id"]).toBe("channelforge-job-1");
    expect(JSON.parse(received?.body ?? "{}").video_script).toContain("every screen");
  });

  it("serializes the corrected eight-scene local payload in order", async () => {
    let received: HttpRequest | undefined;
    const materials = Array.from({ length: 8 }, (_, index) => ({ provider: "local" as const, url: `m5-6fd-test/scene-${String(index + 1).padStart(2, "0")}.mp4`, duration: 3 }));
    const provider = adapter(artifactDirectory(), async (request) => { received = request; return response({ status: 200, message: "success", data: { task_id: "remote-eight-scenes" } }); });
    await provider.submitProduction({ ...requestInput, targetDurationSec: 24, videoMaterials: materials, correlationId: "corrected-eight-scenes" });
    const body = JSON.parse(received?.body ?? "{}");
    expect(body.video_source).toBe("local");
    expect(body.video_clip_duration).toBe(3);
    expect(body.video_concat_mode).toBe("sequential");
    expect(body.video_count).toBe(1);
    expect(body.video_materials).toEqual(materials);
    expect(body.video_materials.map((material: { url: string }) => material.url)).toEqual(materials.map((material) => material.url));
    expect(body.video_materials.some((material: { url: string }) => material.url.includes("9ea6776fa37842d1be8ef1846019e15c"))).toBe(false);
  });

  it("normalizes processing and failed provider task states", async () => {
    const processing = adapter(artifactDirectory(), async () => response({ status: 200, message: "success", data: { task_id: "remote-2", request_id: "channelforge-job-2", state: 4, progress: 37 } }));
    const processingResult = await processing.getProductionStatus({ provider: "moneyprinterturbo", remoteTaskId: "remote-2", correlationId: "channelforge-job-2" });
    expect(processingResult.state).toBe("processing");
    expect(processingResult.progress).toBe(37);
    const failed = adapter(artifactDirectory(), async () => response({ status: 200, message: "success", data: { task_id: "remote-3", state: -1, progress: 20, failed_stage: "audio", error: "TTS failed" } }));
    const failedResult = await failed.getProductionStatus({ provider: "moneyprinterturbo", remoteTaskId: "remote-3", correlationId: "channelforge-job-3" });
    expect(failedResult.state).toBe("failed");
    expect(failedResult.failedStage).toBe("audio");
  });

  it("rejects a status response for a different task or correlation", async () => {
    const wrongTask = adapter(artifactDirectory(), async () => response({ status: 200, message: "success", data: { task_id: "other-task", request_id: "identity-check", state: 4, progress: 10 } }));
    await expect(wrongTask.getProductionStatus({ provider: "moneyprinterturbo", remoteTaskId: "expected-task", correlationId: "identity-check" })).rejects.toMatchObject({ code: "protocol" });

    const wrongCorrelation = adapter(artifactDirectory(), async () => response({ status: 200, message: "success", data: { task_id: "expected-task", request_id: "other-correlation", state: 4, progress: 10 } }));
    await expect(wrongCorrelation.getProductionStatus({ provider: "moneyprinterturbo", remoteTaskId: "expected-task", correlationId: "identity-check" })).rejects.toMatchObject({ code: "protocol" });
  });

  it("accepts nullable failure fields and omits null failure details on success", async () => {
    const provider = adapter(artifactDirectory(), async () => response(successfulTaskResponse()));
    const result = await provider.getProductionStatus({ provider: "moneyprinterturbo", remoteTaskId: "remote-success", correlationId: "success" });
    expect(result.state).toBe("succeeded");
    expect(result.providerStatus).toBe(1);
    expect(result.progress).toBe(100);
    expect(result.failedStage).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(result.providerPayload.subtitle_path).toBe("");
  });

  it("accepts missing and nonempty subtitle paths", async () => {
    const missing = successfulTaskResponse();
    delete (missing.data as Record<string, unknown>).subtitle_path;
    const missingProvider = adapter(artifactDirectory(), async () => response(missing));
    await expect(missingProvider.getProductionStatus({ provider: "moneyprinterturbo", remoteTaskId: "remote-success", correlationId: "missing-subtitle" })).resolves.toMatchObject({ state: "succeeded" });

    const nonemptyProvider = adapter(artifactDirectory(), async () => response(successfulTaskResponse({ subtitle_path: "/tasks/remote-success/subtitle.srt" })));
    const result = await nonemptyProvider.getProductionStatus({ provider: "moneyprinterturbo", remoteTaskId: "remote-success", correlationId: "nonempty-subtitle" });
    expect(result.state).toBe("succeeded");
    expect(result.providerPayload.subtitle_path).toBe("/tasks/remote-success/subtitle.srt");
  });

  it("rejects invalid task-status field types and envelope values", async () => {
    const invalidResponses = [
      { status: 200, message: "success", data: { task_id: "remote-invalid", state: 1, failed_stage: 42 } },
      { status: 200, message: "success", data: { task_id: "remote-invalid", state: 1, error: ["failed"] } },
      successfulTaskResponse({ subtitle_path: null }),
      successfulTaskResponse({ subtitle_path: 42 }),
      successfulTaskResponse({ subtitle_path: ["subtitle.srt"] }),
      { status: 200, message: "success", data: { task_id: "remote invalid", state: 1 } },
      { status: 200, message: "success", data: { task_id: "remote-invalid", state: "1" } },
      { status: "200", message: "success", data: { task_id: "remote-invalid", state: 1 } },
      { status: 200, message: "success", data: { task_id: "remote-invalid", state: 1 }, unexpected: true }
    ];

    for (const payload of invalidResponses) {
      const provider = adapter(artifactDirectory(), async () => response(payload));
      await expect(provider.getProductionStatus({ provider: "moneyprinterturbo", remoteTaskId: "remote-invalid", correlationId: "invalid" })).rejects.toMatchObject({ code: "protocol" });
    }
  });

  it("does not treat an empty subtitle path as a downloadable caption artifact", async () => {
    const directory = artifactDirectory();
    const task = successfulTaskResponse({ task_id: "remote-no-subtitle", videos: ["/tasks/remote-no-subtitle/final-1.mp4"], combined_videos: [] });
    delete (task.data as Record<string, unknown>).audio_file;
    const provider = adapter(directory, async (request) => request.url.endsWith("final-1.mp4")
      ? response("fixture video")
      : response(task));
    const artifacts = await provider.getProductionArtifacts({ provider: "moneyprinterturbo", remoteTaskId: "remote-no-subtitle", correlationId: "no-subtitle" });
    expect(artifacts.map((artifact) => artifact.kind)).toEqual(["render"]);
  });

  it("bounds polling without retrying forever", async () => {
    let polls = 0;
    const provider = adapter(artifactDirectory(), async () => { polls += 1; return response({ status: 200, message: "success", data: { task_id: "remote-poll", state: 4, progress: 50 } }); }, { pollIntervalMs: 0, maxPolls: 2 });
    const result = await provider.waitForProduction({ provider: "moneyprinterturbo", remoteTaskId: "remote-poll", correlationId: "poll-limit" });
    expect(result.state).toBe("unknown");
    expect(polls).toBe(2);
  });

  it("rejects malformed responses and authentication failures", async () => {
    const malformed = adapter(artifactDirectory(), async () => response({ unexpected: true }));
    await expect(malformed.submitProduction({ ...requestInput, correlationId: "malformed" })).rejects.toMatchObject({ code: "protocol" });
    const unauthorized = adapter(artifactDirectory(), async () => response({ status: 401, message: "invalid API key" }, 401));
    await expect(unauthorized.submitProduction({ ...requestInput, correlationId: "unauthorized" })).rejects.toMatchObject({ code: "http" });
  });

  it("preserves UNKNOWN after an ambiguous timeout and does not resubmit", async () => {
    const calls: string[] = [];
    const provider = adapter(artifactDirectory(), async (request) => {
      calls.push(request.method + " " + request.url);
      if (request.url.endsWith("/videos")) return pendingUntilAborted(request);
      return response({ status: 200, message: "success", data: { tasks: [], total: 0, page: 1, page_size: 1000 } });
    }, { timeoutMs: 1 });
    const result = await provider.submitProduction({ ...requestInput, correlationId: "ambiguous" });
    expect(result.state).toBe("unknown");
    expect(calls.filter((call) => call.endsWith("/videos"))).toHaveLength(1);
    expect(calls.some((call) => call.includes("/tasks?page=1"))).toBe(true);
  });

  it("reconciles an ambiguous submission by the stable correlation ID", async () => {
    const provider = adapter(artifactDirectory(), async (request) => {
      if (request.url.endsWith("/videos")) return pendingUntilAborted(request);
      return response({ status: 200, message: "success", data: { tasks: [{ task_id: "remote-reconciled", request_id: "reconcile-me", state: 4, progress: 12 }], total: 1, page: 1, page_size: 1000 } });
    }, { timeoutMs: 1 });
    const result = await provider.submitProduction({ ...requestInput, correlationId: "reconcile-me" });
    expect(result.state).toBe("processing");
    expect(result.reference?.remoteTaskId).toBe("remote-reconciled");
  });

  it("persists the submitting run before submission and prevents duplicates", async () => {
    const { service, directory } = setup(); const job = createJob(service); let submissions = 0;
    const provider = adapter(directory, async () => { submissions += 1; return response({ status: 200, message: "success", data: { task_id: "remote-persisted" } }); });
    const first = await service.submitProduction(job.id, requestInput, provider);
    const second = await service.submitProduction(job.id, requestInput, provider);
    expect(first.remoteTaskId).toBe("remote-persisted");
    expect(second.id).toBe(first.id);
    expect(submissions).toBe(1);
    expect(service.getProviderRun(job.id)?.remoteTaskId).toBe("remote-persisted");
  });

  it("reports active cancellation as unsupported without issuing DELETE", async () => {
    const methods: string[] = [];
    const provider = adapter(artifactDirectory(), async (request) => { methods.push(request.method); return response({ status: 200, message: "success", data: { task_id: "remote-active", state: 4, progress: 10 } }); });
    const result = await provider.cancelProduction({ provider: "moneyprinterturbo", remoteTaskId: "remote-active", correlationId: "cancel-test" });
    expect(result.state).toBe("unsupported");
    expect(methods).not.toContain("DELETE");
  });

  it("discovers safe artifacts, copies them locally, and rejects unsafe paths", async () => {
    const directory = artifactDirectory();
    const payload = Buffer.from("real provider artifact");
    const provider = adapter(directory, async (request) => request.url.endsWith("final-1.mp4")
      ? { status: 200, json: async () => ({}), headers: { "content-length": String(payload.byteLength) }, stream: async function* () { const copy = new Uint8Array(payload.byteLength); copy.set(payload); yield copy; } }
      : response({ status: 200, message: "success", data: { task_id: "remote-safe", state: 1, videos: ["/tasks/remote-safe/final-1.mp4"] } }));
    const artifacts = await provider.getProductionArtifacts({ provider: "moneyprinterturbo", remoteTaskId: "remote-safe", correlationId: "safe" });
    expect(artifacts[0].relativePath).toBe("moneyprinterturbo/remote-safe/final-1.mp4");
    expect(artifacts[0].provenance).toEqual({ provider: "moneyprinterturbo", remoteTaskId: "remote-safe", correlationId: "safe", providerPath: "/tasks/remote-safe/final-1.mp4" });
    expect(readFileSync(join(directory, artifacts[0].relativePath))).toEqual(payload);
    const unsafe = adapter(directory, async () => response({ status: 200, message: "success", data: { task_id: "remote-unsafe", state: 1, videos: ["/tasks/remote-unsafe/../secret.mp4"] } }));
    await expect(unsafe.getProductionArtifacts({ provider: "moneyprinterturbo", remoteTaskId: "remote-unsafe", correlationId: "unsafe" })).rejects.toMatchObject({ code: "protocol" });
  });

  it("rejects oversized streamed artifacts before finalization", async () => {
    const directory = artifactDirectory();
    const provider = adapter(directory, async (request) => request.url.endsWith("final-1.mp4")
      ? response("0123456789")
      : response({ status: 200, message: "success", data: { task_id: "remote-large", state: 1, videos: ["/tasks/remote-large/final-1.mp4"] } }), { maxArtifactBytes: 4 });
    await expect(provider.getProductionArtifacts({ provider: "moneyprinterturbo", remoteTaskId: "remote-large", correlationId: "large" })).rejects.toMatchObject({ code: "protocol" });
  });

  it("registers copied provider artifacts as unvalidated ChannelForge assets", async () => {
    const { service, directory } = setup(); const job = createJob(service); const payload = Buffer.from("provider render");
    const provider = adapter(directory, async (request) => {
      if (request.method === "POST") return response({ status: 200, message: "success", data: { task_id: "remote-registered" } });
      if (request.url.endsWith("final-1.mp4")) return response(payload.toString());
      return response({ status: 200, message: "success", data: { task_id: "remote-registered", state: 1, videos: ["/tasks/remote-registered/final-1.mp4"] } });
    });
    await service.submitProduction(job.id, requestInput, provider);
    const assets = await service.getProductionArtifacts(job.id, provider);
    expect(assets[0].validationStatus).toBe("unvalidated");
    expect(service.getJob(job.id).artifactIds).toContain(assets[0].id);
  });

  it("marks interrupted provider work UNKNOWN and preserves review gates", async () => {
    const { service, directory } = setup(); const job = createJob(service);
    const provider = adapter(directory, async () => response({ status: 200, message: "success", data: { task_id: "remote-interrupted" } }));
    await service.submitProduction(job.id, requestInput, provider);
    service.transitionJob(job.id, "PLANNING");
    const recovered = service.recoverInterruptedJobs()[0];
    expect(recovered.failureKind).toBe("interrupted");
    expect(service.getProviderRun(job.id)?.state).toBe("unknown");
    expect(() => service.approveJob(job.id)).toThrow(ApprovalRequiredError);
  });

  it("maps a completed provider observation from RENDERING to VALIDATING only", async () => {
    const { service, directory } = setup(); const job = createJob(service);
    const provider = adapter(directory, async (request) => request.method === "POST"
      ? response({ status: 200, message: "success", data: { task_id: "remote-complete" } })
      : response({ status: 200, message: "success", data: { task_id: "remote-complete", state: 1, progress: 100 } }));
    for (const state of ["PLANNING", "NARRATING", "SOURCING", "CAPTIONING", "RENDERING"] as const) service.transitionJob(job.id, state);
    await service.submitProduction(job.id, requestInput, provider);
    await service.pollProduction(job.id, provider);
    expect(service.getJob(job.id).currentState).toBe("VALIDATING");
  });

  it("requires an operator decision before an UNKNOWN run can be retried", async () => {
    const { service, directory, boundary } = setupWithResolutionAuthority("operator-1"); const job = createJob(service);
    const provider = adapter(directory, async (request) => request.url.endsWith("/videos") ? pendingUntilAborted(request) : response({ status: 200, message: "success", data: { tasks: [] } }), { timeoutMs: 1 });
    await service.submitProduction(job.id, requestInput, provider);
    const run = service.getProviderRun(job.id)!;
    const receipt = boundary.issuer.issue({ productionJobId: job.id, attemptId: run.attemptId, expectedRevision: run.resolutionRevision, decision: "preserve_unknown" });
    await service.resolveUnknownProviderRun(job.id, "preserve_unknown", receipt, provider);
    await expect(service.submitProduction(job.id, requestInput, provider)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(service.resolveUnknownProviderRun(job.id, "preserve_unknown", receipt, provider)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("allows an explicitly authorized retry as a new preserved attempt", async () => {
    const { service, directory, boundary } = setupWithResolutionAuthority("operator-2"); const job = createJob(service); let submissions = 0;
    const provider = adapter(directory, async (request) => {
      if (request.url.endsWith("/videos")) {
        submissions += 1;
        return submissions === 1 ? pendingUntilAborted(request) : response({ status: 200, message: "success", data: { task_id: "remote-retry" } });
      }
      return response({ status: 200, message: "success", data: { tasks: [] } });
    }, { timeoutMs: 1 });
    await service.submitProduction(job.id, requestInput, provider);
    const first = service.getProviderRun(job.id)!;
    const receipt = boundary.issuer.issue({ productionJobId: job.id, attemptId: first.attemptId, expectedRevision: first.resolutionRevision, decision: "authorize_retry" });
    await service.resolveUnknownProviderRun(job.id, "authorize_retry", receipt, provider, { note: "Acknowledged possible duplicate provider execution" });
    const retried = await service.submitProduction(job.id, requestInput, provider);
    expect(retried.attemptNumber).toBe(2);
    expect(retried.remoteTaskId).toBe("remote-retry");
  });

  it("attaches only to an existing provider task with the original correlation", async () => {
    const { service, directory, boundary } = setupWithResolutionAuthority("operator-3"); const job = createJob(service);
    const provider = adapter(directory, async (request) => {
      if (request.url.endsWith("/videos")) return pendingUntilAborted(request);
      if (request.url.endsWith("/tasks?page=1&page_size=1000")) return response({ status: 200, message: "success", data: { tasks: [] } });
      return response({ status: 200, message: "success", data: { task_id: "remote-attached", request_id: `channelforge-${job.id}-attempt-1`, state: 4, progress: 22 } });
    }, { timeoutMs: 1 });
    await service.submitProduction(job.id, requestInput, provider);
    const first = service.getProviderRun(job.id)!;
    const receipt = boundary.issuer.issue({ productionJobId: job.id, attemptId: first.attemptId, expectedRevision: first.resolutionRevision, decision: "attach_existing" });
    const attached = await service.resolveUnknownProviderRun(job.id, "attach_existing", receipt, provider, { remoteTaskId: "remote-attached" });
    expect(attached.state).toBe("processing");
    expect(attached.remoteTaskId).toBe("remote-attached");
  });

  it("validates large artifacts with streaming checksum verification", () => {
    const { directory, database } = setup(); const payload = Buffer.alloc(2 * 1024 * 1024, 7);
    mkdirSync(join(directory, "jobs"), { recursive: true }); writeFileSync(join(directory, "jobs/stream.mp4"), payload);
    const validator = new ArtifactValidationService(directory, { source: "trusted-runtime", inspect: () => ({ playable: true, mimeType: "video/mp4", durationSec: 45, width: 1080, height: 1920, containerFormat: "mov,mp4,m4a,3gp,3g2,mj2", videoStreams: [{ index: 0, codecName: "h264", durationSec: 45, width: 1080, height: 1920, frameRate: 30 }], audioStreams: [{ index: 1, codecName: "aac", durationSec: 45, sampleRate: 44100, channels: 2 }], decode: { video: "passed" as const, audio: "passed" as const }, audioLoudness: { meanDb: -19, maxDb: -5 }, raw: { ffprobe: true } }) });
    const service = new ProductionService(database, { artifactValidator: validator });
    const job = createJob(service);
    for (const state of ["PLANNING", "NARRATING", "SOURCING", "CAPTIONING", "RENDERING", "VALIDATING"] as const) service.transitionJob(job.id, state);
    const asset = service.recordArtifact({ productionJobId: job.id, type: "render", relativePath: "jobs/stream.mp4", mimeType: "video/mp4", sha256: createHash("sha256").update(payload).digest("hex"), byteSize: payload.byteLength, sourceProvider: "moneyprinterturbo", sourceMetadata: {}, rightsStatus: "pending", isSynthetic: false });
    expect(service.validateArtifact(asset.id).validationStatus).toBe("validated");
  });
});
