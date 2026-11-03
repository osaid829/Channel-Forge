import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { SqliteDatabase } from "../db/database.js";
import { ProductionService } from "./production-service.js";
import {
  ProviderProductionRequestSchema,
  ProviderEnvelopeSchema,
  ProviderAdapterError,
  type HttpRequest,
  type HttpResponse,
  type ProviderProductionRequest,
  type ProductionProvider
} from "./production-provider.js";
import { MoneyPrinterTurboAdapter } from "./moneyprinterturbo-adapter.js";
import {
  journaledSubmissionProvider,
  recordAcknowledgement
} from "./journaled-submission-provider.js";
import { SubmissionJournal } from "./submission-journal.js";
import {
  validateLocalMaterialManifest,
  type LocalMaterialManifest
} from "./local-material-preflight.js";
import type { VisualFrameAnalysis } from "./visual-quality-gate.js";

export type IsolatedRunnerMode = "success" | "timeout" | "interrupted";

export interface IsolatedRunnerOptions {
  configPath: string;
  validationPath: string;
  workspaceParent: string;
  mode?: IsolatedRunnerMode;
  keepWorkspace?: boolean;
}

export interface LiveRunnerOptions {
  configPath: string;
  validationPath: string;
  providerConfigPath: string;
  workspaceParent: string;
  baseUrl?: string;
  pollLimit?: number;
  pollDelayMs?: number;
  keepWorkspace?: boolean;
}

export interface LiveRunnerResult {
  mode: "live";
  jobId: string;
  channelId: string;
  briefId: string;
  providerRunId: string;
  attemptId: string;
  correlationId: string;
  jobState: string;
  providerRunState: string;
  remoteTaskId?: string;
  postCount: number;
  readiness: { url: string; status: number };
  pollStates: string[];
  journalStages: string[];
  artifactPaths: string[];
  artifactIds: string[];
  requestFingerprint: string;
  materialManifestFingerprint: string;
  workspacePath?: string;
  workspaceCleaned: boolean;
}

export interface IsolatedRunnerResult {
  mode: IsolatedRunnerMode;
  jobId: string;
  channelId: string;
  briefId: string;
  providerRunId: string;
  attemptId: string;
  correlationId: string;
  jobState: string;
  providerRunState: string;
  remoteTaskId?: string;
  providerCalls: number;
  preflight: {
    materialCount: number;
    materialPaths: string[];
    totalDeclaredDurationSec: number;
    visualQualityStatuses: string[];
    decodeEvidenceCount: number;
    materialManifestFingerprint: string;
  };
  journalStages: string[];
  providerPayload?: Record<string, unknown>;
  duplicateSubmissionPrevented: boolean;
  workspacePath?: string;
  workspaceCleaned: boolean;
}

const VisualAnalysisSchema = z.object({
  sampleCount: z.number().int().min(2),
  durationSec: z.number().positive(),
  meanAbsoluteFrameDifferenceMean: z.number().nonnegative(),
  meanAbsoluteFrameDifferenceMax: z.number().nonnegative(),
  nearIdenticalPairRatio: z.number().min(0).max(1),
  frameMeanRange: z.number().nonnegative(),
  frameStdDevRange: z.number().nonnegative()
}).passthrough();

const ConfigMaterialSchema = z.object({
  relativePath: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  durationSec: z.number().positive(),
  scene: z.number().int().positive(),
  startSec: z.number().nonnegative(),
  byteSize: z.number().int().positive(),
  visualAnalysis: VisualAnalysisSchema
}).passthrough();

const IsolatedConfigSchema = z.object({
  version: z.literal(1),
  purpose: z.literal("isolated-corrected-m5-test-not-submitted"),
  authoredIllustration: z.literal(true),
  materialRoot: z.string().min(1),
  expectedNarrationDurationSec: z.number().positive(),
  materials: z.array(ConfigMaterialSchema).length(8),
  clipDurationSec: z.number().positive(),
  input: z.object({
    topic: z.literal("Why is the sky blue?"),
    script: z.string().min(1),
    videoTerms: z.array(z.string()).length(3),
    language: z.literal("en"),
    aspectRatio: z.literal("9:16"),
    targetDurationSec: z.literal(24),
    videoSource: z.literal("local"),
    voiceName: z.literal("kokoro:af_heart"),
    subtitleEnabled: z.literal(false),
    backgroundMusic: z.literal("")
  }).passthrough()
}).passthrough();

const ValidationStreamSchema = z.object({
  codec_name: z.literal("h264"),
  codec_type: z.literal("video"),
  width: z.literal(720),
  height: z.literal(1280),
  r_frame_rate: z.literal("30/1"),
  avg_frame_rate: z.literal("30/1")
}).passthrough();

const ValidationFileSchema = z.object({
  file: z.string().min(1),
  path: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  bytes: z.number().int().positive(),
  probe: z.object({
    streams: z.array(ValidationStreamSchema).min(1),
    format: z.object({
      format_name: z.string().includes("mp4"),
      duration: z.string().min(1),
      size: z.string().min(1)
    }).passthrough()
  }).passthrough(),
  probeCode: z.literal(0),
  decodeCode: z.literal(0),
  decodeErrors: z.literal(""),
  frameMetrics: VisualAnalysisSchema
}).passthrough();

const ValidationSchema = z.object({
  materialDirectory: z.string().min(1),
  files: z.array(ValidationFileSchema).length(8)
}).passthrough();

interface ApprovedMaterials {
  manifest: LocalMaterialManifest;
  materialPaths: string[];
  visualQualityStatuses: string[];
  decodeEvidenceCount: number;
  materialManifestFingerprint: string;
  totalDeclaredDurationSec: number;
}

function fail(message: string): never {
  throw new Error(message);
}

function jsonHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function response(payload: unknown, status = 200): HttpResponse {
  return {
    status,
    json: async () => payload,
    stream: async function* () { yield new Uint8Array(); }
  };
}

function readProviderConfig(source: string): { apiKey: string; baseUrl: string } {
  const listenHost = source.match(/^listen_host\s*=\s*"([^"]+)"\s*$/m)?.[1];
  const listenPort = source.match(/^listen_port\s*=\s*(\d+)\s*$/m)?.[1];
  const apiKey = source.match(/(?:^|\n)\[app\]\s*\n([\s\S]*?)(?=\n\[[^\n]+\]|$)/)?.[1]?.match(/^api_key\s*=\s*"([^"]+)"\s*$/m)?.[1];
  if (!listenHost || !listenPort || !apiKey?.trim()) fail("MoneyPrinterTurbo local provider configuration is incomplete.");
  if (!["127.0.0.1", "localhost", "::1"].includes(listenHost)) fail("Live M5 execution requires a loopback MoneyPrinterTurbo host.");
  return { apiKey, baseUrl: `http://${listenHost}:${listenPort}` };
}

function createFetchTransport(onRequest: (request: HttpRequest) => void) {
  return async (request: HttpRequest): Promise<HttpResponse> => {
    onRequest(request);
    const responseValue = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: request.signal,
      redirect: request.redirect ?? "error"
    });
    return {
      status: responseValue.status,
      headers: Object.fromEntries(responseValue.headers.entries()),
      json: () => responseValue.json(),
      stream: async function* () {
        if (!responseValue.body) return;
        const reader = responseValue.body.getReader();
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

async function verifyLocalProviderReadiness(baseUrl: string, apiKey: string): Promise<{ url: string; status: number }> {
  const url = `${baseUrl.replace(/\/$/, "")}/api/v1/tasks?page=1&page_size=1`;
  let responseValue: Response;
  try {
    responseValue = await fetch(url, { method: "GET", headers: { accept: "application/json", "x-api-key": apiKey }, redirect: "error" });
  } catch (error) {
    throw new Error(`Local MoneyPrinterTurbo readiness failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (responseValue.status < 200 || responseValue.status >= 300) fail(`Local MoneyPrinterTurbo readiness returned HTTP ${responseValue.status}.`);
  let payload: unknown;
  try { payload = await responseValue.json(); } catch { fail("Local MoneyPrinterTurbo readiness returned invalid JSON."); }
  if (!ProviderEnvelopeSchema.safeParse(payload).success) fail("Local MoneyPrinterTurbo readiness returned an invalid response envelope.");
  return { url, status: responseValue.status };
}

function assertVisualAnalysisMatches(expected: VisualFrameAnalysis, actual: VisualFrameAnalysis, path: string): void {
  for (const key of [
    "sampleCount",
    "durationSec",
    "meanAbsoluteFrameDifferenceMean",
    "meanAbsoluteFrameDifferenceMax",
    "nearIdenticalPairRatio",
    "frameMeanRange",
    "frameStdDevRange"
  ] as const) {
    if (expected[key] !== actual[key]) fail(`Frame-analysis evidence differs from the approved manifest: ${path}`);
  }
}

async function loadApprovedMaterials(configPath: string, validationPath: string): Promise<ApprovedMaterials> {
  const config = IsolatedConfigSchema.parse(JSON.parse(await readFile(configPath, "utf8")));
  const validation = ValidationSchema.parse(JSON.parse(await readFile(validationPath, "utf8")));
  const firstMaterialDirectory = resolve(config.materialRoot, config.materials[0].relativePath.split("/").slice(0, -1).join("/"));
  if (firstMaterialDirectory !== resolve(validation.materialDirectory)) {
    fail("Approved material and media-validation roots do not match.");
  }
  if (config.expectedNarrationDurationSec !== 24 || config.clipDurationSec !== 3) {
    fail("The corrected M5 manifest must cover 24 seconds with 3-second clips.");
  }
  if (config.input.script !== SCRIPT || JSON.stringify(config.input.videoTerms) !== JSON.stringify(["sunlight", "atmosphere", "Rayleigh scattering"])) {
    fail("The corrected M5 narration input does not match the approved request.");
  }

  const validationByPath = new Map(validation.files.map((file) => [file.path, file]));
  const sceneNumbers = config.materials.map((material) => material.scene);
  const expectedScenes = Array.from({ length: 8 }, (_, index) => index + 1);
  if (JSON.stringify(sceneNumbers) !== JSON.stringify(expectedScenes)) {
    fail("Corrected M5 materials are not in scene order 1 through 8.");
  }

  let expectedStart = 0;
  let decodeEvidenceCount = 0;
  for (const material of config.materials) {
    if (material.durationSec !== config.clipDurationSec || material.startSec !== expectedStart) {
      fail(`Invalid corrected M5 timeline at ${material.relativePath}.`);
    }
    expectedStart += material.durationSec;
    const evidence = validationByPath.get(resolve(config.materialRoot, material.relativePath));
    if (!evidence) fail(`Missing media validation evidence for ${material.relativePath}.`);
    if (evidence.sha256.toLowerCase() !== material.sha256.toLowerCase() || evidence.bytes !== material.byteSize) {
      fail(`Media validation evidence does not match ${material.relativePath}.`);
    }
    assertVisualAnalysisMatches(material.visualAnalysis, evidence.frameMetrics, material.relativePath);
    if (evidence.probeCode !== 0 || evidence.decodeCode !== 0 || evidence.decodeErrors !== "") {
      fail(`Media decoding evidence failed for ${material.relativePath}.`);
    }
    decodeEvidenceCount += 1;
  }
  if (expectedStart !== config.expectedNarrationDurationSec) fail("Corrected M5 materials do not cover the full narration timeline.");

  const manifest: LocalMaterialManifest = {
    materialRoot: config.materialRoot,
    expectedDurationSec: config.expectedNarrationDurationSec,
    clipDurationSec: config.clipDurationSec,
    materials: config.materials.map((material) => ({
      relativePath: material.relativePath,
      sha256: material.sha256,
      byteSize: material.byteSize,
      durationSec: material.durationSec,
      visualAnalysis: material.visualAnalysis
    }))
  };
  const preflight = validateLocalMaterialManifest(manifest);
  if (preflight.materialPaths.length !== config.materials.length || preflight.totalDeclaredDurationSec !== config.expectedNarrationDurationSec) {
    fail("Local-material preflight did not validate all corrected scenes.");
  }
  if (JSON.stringify(preflight.materialPaths) !== JSON.stringify(config.materials.map((material) => material.relativePath))) {
    fail("Local-material preflight changed the approved scene ordering.");
  }
  const materialManifestFingerprint = jsonHash({
    materialRoot: await realpath(config.materialRoot),
    expectedDurationSec: config.expectedNarrationDurationSec,
    clipDurationSec: config.clipDurationSec,
    materials: config.materials
  });
  return {
    manifest,
    materialPaths: preflight.materialPaths,
    visualQualityStatuses: preflight.visualReviews.map((review) => review.status),
    decodeEvidenceCount,
    materialManifestFingerprint,
    totalDeclaredDurationSec: preflight.totalDeclaredDurationSec
  };
}

const SCRIPT =
  "Why is the sky blue? Sunlight may look white, but it contains many colors. " +
  "As sunlight travels through Earth's atmosphere, tiny air molecules scatter " +
  "shorter blue wavelengths more strongly than longer red wavelengths. That " +
  "scattered blue light reaches our eyes from across the sky. Near sunset, " +
  "sunlight takes a longer path through air, leaving warmer colors more noticeable.";

function buildProductionInput(materials: ApprovedMaterials): Omit<ProviderProductionRequest, "correlationId"> {
  const parsed = ProviderProductionRequestSchema.parse({
    topic: "Why is the sky blue?",
    script: SCRIPT,
    videoTerms: ["sunlight", "atmosphere", "Rayleigh scattering"],
    language: "en",
    aspectRatio: "9:16",
    targetDurationSec: 24,
    videoSource: "local",
    videoMaterials: materials.materialPaths.map((url) => ({ provider: "local" as const, url, duration: 3 })),
    voiceName: "kokoro:af_heart",
    subtitleEnabled: false,
    backgroundMusic: "",
    correlationId: "m5-6f-i-input-validation"
  });
  const { correlationId: _correlationId, ...input } = parsed;
  return input;
}

function makeChannelInput(channelId: string) {
  return {
    id: channelId,
    slug: `m5-6f-i-${randomUUID().slice(0, 8)}`,
    platform: "youtube" as const,
    locale: "en-US",
    audience: "General audiences learning basic science",
    contentPillars: ["science", "atmosphere"],
    brand: {
      voice: "Clear, accurate, and concise educational narration",
      visualStyle: "Approved eight-scene educational illustrations",
      bannedTopics: []
    },
    policy: {
      defaultPrivacy: "private" as const,
      humanApprovalRequired: true as const,
      factualReviewRequired: true,
      rightsReviewRequired: true
    },
    credentialsRef: { youtube: "secret://channelforge-m5-6f-i" },
    status: "active" as const
  };
}

function makeBriefInput(channelId: string, briefId: string) {
  return {
    id: briefId,
    channelId,
    topic: "Why is the sky blue?",
    angle: "A concise explanation of Rayleigh scattering",
    hook: "The sky looks blue because air scatters some colors more strongly than others.",
    format: "short" as const,
    language: "en",
    aspectRatio: "9:16" as const,
    targetDurationSec: 24,
    audiencePromise: "Understand the basic science behind the daytime sky in under half a minute.",
    contentPillars: ["science", "atmosphere"],
    claimIds: [],
    evidenceIds: [],
    status: "ready" as const
  };
}

function makeHttpTransport(mode: IsolatedRunnerMode, onRequest: (request: HttpRequest) => void) {
  return async (request: HttpRequest): Promise<HttpResponse> => {
    onRequest(request);
    if (request.method === "GET") {
      return response({ status: 200, message: "success", data: { tasks: [], total: 0, page: 1, page_size: 1000 } });
    }
    if (mode === "timeout") {
      return new Promise<HttpResponse>((_, reject) => {
        const signal = request.signal;
        if (signal?.aborted) {
          reject(new Error("mock transport aborted"));
          return;
        }
        signal?.addEventListener("abort", () => reject(new Error("mock transport aborted")), { once: true });
      });
    }
    return response({ status: 200, message: "success", data: { task_id: "mock-6f-i-task" } });
  };
}

async function waitForStarted(started: Promise<void>): Promise<void> {
  await Promise.race([
    started,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Interrupted test did not reach the provider boundary")), 2_000))
  ]);
}

export async function runM5IsolatedOffline(options: IsolatedRunnerOptions): Promise<IsolatedRunnerResult> {
  const mode = options.mode ?? "success";
  const materials = await loadApprovedMaterials(options.configPath, options.validationPath);
  const input = buildProductionInput(materials);
  const workspace = await mkdtemp(join(resolve(options.workspaceParent), "m5-6f-i-isolated."));
  const databasePath = join(workspace, "isolated-channel-forge.sqlite");
  const journalRoot = join(workspace, "submission-receipts");
  const artifactRoot = join(workspace, "artifacts");
  const database = new SqliteDatabase(databasePath);
  let result: IsolatedRunnerResult | undefined;
  let pendingSubmission: Promise<unknown> | undefined;
  let databaseClosed = false;

  try {
    const service = new ProductionService(database);
    const channelId = randomUUID();
    const briefId = randomUUID();
    const jobId = randomUUID();
    const channel = service.createChannel(makeChannelInput(channelId));
    const brief = service.createBrief(makeBriefInput(channel.id, briefId));
    const job = service.createProductionJob({
      id: jobId,
      channelId: channel.id,
      briefId: brief.id,
      renderer: "moneyprinterturbo",
      idempotencyKey: `m5-6f-i-${randomUUID()}`
    });
    for (const state of ["PLANNING", "NARRATING", "SOURCING", "CAPTIONING", "RENDERING"] as const) {
      service.transitionJob(job.id, state, `6F-I isolated runner advanced to ${state}`);
    }

    let submissionCalls = 0;
    let capturedBody: Record<string, unknown> | undefined;
    let providerStartedResolve: (() => void) | undefined;
    const providerStarted = new Promise<void>((resolveStarted) => { providerStartedResolve = resolveStarted; });
    const transport = makeHttpTransport(mode, (request) => {
      if (request.method === "POST") {
        submissionCalls += 1;
        capturedBody = JSON.parse(request.body ?? "{}") as Record<string, unknown>;
      }
    });
    const adapter = mode === "interrupted" ? undefined : new MoneyPrinterTurboAdapter({
      apiKey: "offline-6f-i-mock-key",
      baseUrl: "http://127.0.0.1:8080",
      artifactRoot,
      transport,
      timeoutMs: 10
    });
    const baseProvider: ProductionProvider = adapter ?? {
      name: "moneyprinterturbo" as const,
      submitProduction: async (): Promise<never> => {
        submissionCalls += 1;
        providerStartedResolve?.();
        return new Promise<never>(() => undefined);
      },
      getProductionStatus: async () => { throw new Error("not used"); },
      getProductionArtifacts: async () => { throw new Error("not used"); },
      cancelProduction: async () => ({ state: "unsupported" as const })
    };
    const provider = journaledSubmissionProvider(service, job.id, baseProvider, journalRoot, materials.materialManifestFingerprint);

    if (mode === "interrupted") {
      pendingSubmission = service.submitProduction(job.id, input, provider);
      await waitForStarted(providerStarted);
      service.recoverInterruptedJobs();
    } else {
      await service.submitProduction(job.id, input, provider);
    }

    let run = service.getProviderRun(job.id);
    if (!run) fail("6F-I isolated runner did not persist a provider run.");
    if (mode === "success") {
      if (!capturedBody) fail("The mocked adapter did not receive a serialized provider payload.");
      if (JSON.stringify(capturedBody.video_materials) !== JSON.stringify(input.videoMaterials)) fail("Serialized provider payload changed the approved material order.");
      const acknowledgedJournal = new SubmissionJournal(journalRoot, {
        productionJobId: job.id,
        providerRunId: run.id,
        attemptId: run.attemptId,
        correlationId: run.correlationId,
        requestFingerprint: run.requestFingerprint,
        materialManifestFingerprint: materials.materialManifestFingerprint
      });
      await recordAcknowledgement(service, job.id, acknowledgedJournal, run.state, run.remoteTaskId, run.providerStatus);
      run = service.getProviderRun(job.id) ?? run;
    }

    let duplicateSubmissionPrevented = false;
    try {
      await service.submitProduction(job.id, input, provider);
      duplicateSubmissionPrevented = mode === "success";
    } catch {
      duplicateSubmissionPrevented = mode !== "success";
    }
    const receipts = await SubmissionJournal.read(journalRoot, job.id, run.attemptId);
    result = {
      mode,
      jobId: job.id,
      channelId: channel.id,
      briefId: brief.id,
      providerRunId: run.id,
      attemptId: run.attemptId,
      correlationId: run.correlationId,
      jobState: service.getJob(job.id).currentState,
      providerRunState: run.state,
      ...(run.remoteTaskId ? { remoteTaskId: run.remoteTaskId } : {}),
      providerCalls: submissionCalls,
      preflight: {
        materialCount: materials.materialPaths.length,
        materialPaths: materials.materialPaths,
        totalDeclaredDurationSec: materials.totalDeclaredDurationSec,
        visualQualityStatuses: materials.visualQualityStatuses,
        decodeEvidenceCount: materials.decodeEvidenceCount,
        materialManifestFingerprint: materials.materialManifestFingerprint
      },
      journalStages: receipts.map((receipt) => receipt.stage),
      ...(capturedBody ? { providerPayload: capturedBody } : {}),
      duplicateSubmissionPrevented,
      ...(options.keepWorkspace ? { workspacePath: workspace } : {}),
      workspaceCleaned: !options.keepWorkspace
    };
  } finally {
    database.close();
    databaseClosed = true;
    if (!options.keepWorkspace) await rm(workspace, { recursive: true, force: true });
  }

  if (!databaseClosed) fail("6F-I isolated SQLite connection did not close.");
  void pendingSubmission;
  if (!result) fail("6F-I isolated runner completed without a result.");
  return result;
}

function assertLiveSerializedPayload(request: HttpRequest, input: Omit<ProviderProductionRequest, "correlationId">, baseUrl: string, correlationId: string): void {
  const expectedUrl = `${baseUrl.replace(/\/$/, "")}/api/v1/videos`;
  if (request.method !== "POST" || request.url !== expectedUrl) throw new ProviderAdapterError("configuration", "Live M5 request endpoint is not the approved local video endpoint.");
  if (request.headers["x-task-id"] !== correlationId) throw new ProviderAdapterError("configuration", "Live M5 request correlation header is incorrect.");
  let body: unknown;
  try { body = JSON.parse(request.body ?? ""); } catch { throw new ProviderAdapterError("configuration", "Live M5 request body is not valid JSON."); }
  const expected = {
    video_subject: input.topic,
    video_script: input.script,
    video_terms: input.videoTerms,
    video_language: input.language,
    video_aspect: input.aspectRatio,
    video_clip_duration: 3,
    video_count: 1,
    video_source: input.videoSource ?? "local",
    video_materials: input.videoMaterials,
    voice_name: input.voiceName ?? "",
    subtitle_enabled: input.subtitleEnabled ?? true,
    bgm_type: input.backgroundMusic ?? "",
    video_concat_mode: "sequential",
    match_materials_to_script: true,
    n_threads: 1
  };
  if (JSON.stringify(body) !== JSON.stringify(expected)) throw new ProviderAdapterError("configuration", "Live M5 serialized provider payload failed the approved request contract.");
}

function isolatedRecords(service: ProductionService) {
  const channel = service.createChannel(makeChannelInput(randomUUID()));
  const brief = service.createBrief(makeBriefInput(channel.id, randomUUID()));
  const job = service.createProductionJob({
    id: randomUUID(),
    channelId: channel.id,
    briefId: brief.id,
    renderer: "moneyprinterturbo",
    idempotencyKey: `m5-6f-i-live-${randomUUID()}`
  });
  for (const state of ["PLANNING", "NARRATING", "SOURCING", "CAPTIONING", "RENDERING"] as const) {
    service.transitionJob(job.id, state, `6F-I live runner advanced to ${state}`);
  }
  return { channel, brief, job };
}

async function waitForNextPoll(delayMs: number): Promise<void> {
  if (delayMs > 0) await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, delayMs));
}

export async function runM5IsolatedLive(options: LiveRunnerOptions): Promise<LiveRunnerResult> {
  const materials = await loadApprovedMaterials(options.configPath, options.validationPath);
  const input = buildProductionInput(materials);
  const providerConfig = readProviderConfig(await readFile(options.providerConfigPath, "utf8"));
  const baseUrl = options.baseUrl ?? providerConfig.baseUrl;
  const pollLimit = options.pollLimit ?? 12;
  const pollDelayMs = options.pollDelayMs ?? 2_000;
  if (!Number.isInteger(pollLimit) || pollLimit < 1 || pollLimit > 12) fail("Live M5 polling limit must be between 1 and 12.");
  if (!Number.isInteger(pollDelayMs) || pollDelayMs < 0) fail("Live M5 polling delay must be a non-negative integer.");
  const readiness = await verifyLocalProviderReadiness(baseUrl, providerConfig.apiKey);
  const workspace = await mkdtemp(join(resolve(options.workspaceParent), "m5-6f-live."));
  const databasePath = join(workspace, "isolated-channel-forge.sqlite");
  const journalRoot = join(workspace, "submission-receipts");
  const artifactRoot = join(workspace, "artifacts");
  const database = new SqliteDatabase(databasePath);
  const retainWorkspace = options.keepWorkspace ?? true;
  let result: LiveRunnerResult | undefined;
  let postCount = 0;
  let run: Awaited<ReturnType<ProductionService["getProviderRun"]>>;
  let records: ReturnType<typeof isolatedRecords> | undefined;

  try {
    const service = new ProductionService(database);
    records = isolatedRecords(service);
    const correlationId = `channelforge-${records.job.id}-attempt-1`;
    const liveTransport = createFetchTransport((request) => {
      if (request.method !== "POST") return;
      if (postCount !== 0) throw new ProviderAdapterError("conflict", "Live M5 submission guard blocked a second POST.");
      assertLiveSerializedPayload(request, input, baseUrl, correlationId);
      postCount += 1;
    });
    const adapter = new MoneyPrinterTurboAdapter({
      apiKey: providerConfig.apiKey,
      baseUrl,
      artifactRoot,
      transport: liveTransport,
      timeoutMs: 30_000,
      artifactTimeoutMs: 120_000
    });
    const provider = journaledSubmissionProvider(service, records.job.id, adapter, journalRoot, materials.materialManifestFingerprint);
    run = await service.submitProduction(records.job.id, input, provider);
    const pollStates: string[] = [run.state];
    if (run.state === "accepted" || run.state === "processing") {
      const acknowledgedJournal = new SubmissionJournal(journalRoot, {
        productionJobId: records.job.id,
        providerRunId: run.id,
        attemptId: run.attemptId,
        correlationId: run.correlationId,
        requestFingerprint: run.requestFingerprint,
        materialManifestFingerprint: materials.materialManifestFingerprint
      });
      await recordAcknowledgement(service, records.job.id, acknowledgedJournal, run.state, run.remoteTaskId, run.providerStatus);
    }
    if (run.remoteTaskId && ["accepted", "processing"].includes(run.state)) {
      for (let poll = 0; poll < pollLimit; poll += 1) {
        await waitForNextPoll(poll === 0 ? 0 : pollDelayMs);
        run = await service.pollProduction(records.job.id, provider);
        pollStates.push(run.state);
        if (["succeeded", "failed", "unknown"].includes(run.state)) break;
      }
    }
    const artifactPaths: string[] = [];
    const artifactIds: string[] = [];
    if (run.state === "succeeded") {
      const assets = await service.getProductionArtifacts(records.job.id, provider);
      for (const asset of assets) {
        artifactPaths.push(asset.relativePath);
        artifactIds.push(asset.id);
      }
    }
    const receipts = await SubmissionJournal.read(journalRoot, records.job.id, run.attemptId);
    result = {
      mode: "live",
      jobId: records.job.id,
      channelId: records.channel.id,
      briefId: records.brief.id,
      providerRunId: run.id,
      attemptId: run.attemptId,
      correlationId: run.correlationId,
      jobState: service.getJob(records.job.id).currentState,
      providerRunState: run.state,
      ...(run.remoteTaskId ? { remoteTaskId: run.remoteTaskId } : {}),
      postCount,
      readiness,
      pollStates,
      journalStages: receipts.map((receipt) => receipt.stage),
      artifactPaths,
      artifactIds,
      requestFingerprint: run.requestFingerprint,
      materialManifestFingerprint: materials.materialManifestFingerprint,
      ...(retainWorkspace ? { workspacePath: workspace } : {}),
      workspaceCleaned: !retainWorkspace
    };
  } finally {
    database.close();
    if (!retainWorkspace) await rm(workspace, { recursive: true, force: true });
  }
  if (!result || !records || !run) fail("Live M5 runner completed without a persisted result.");
  return result;
}
