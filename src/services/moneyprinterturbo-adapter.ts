import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, realpath, rename, rm, type FileHandle } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { ProviderRunState } from "../domain/types.js";
import type {
  HttpRequest,
  HttpResponse,
  HttpTransport,
  NormalizedProviderStatus,
  ProductionProvider,
  ProviderArtifact,
  ProviderCancellation,
  ProviderProductionRequest,
  ProviderSubmission,
  ProviderTaskReference
} from "./production-provider.js";
import {
  ProviderAdapterError,
  ProviderEnvelopeSchema,
  ProviderSubmissionResponseSchema,
  ProviderTaskListResponseSchema,
  ProviderTaskResponseSchema,
  ProviderTaskSchema,
  ProviderProductionRequestSchema
} from "./production-provider.js";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const DEFAULT_BASE_URL = "http://127.0.0.1:8080";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_MAX_POLLS = 150;
const DEFAULT_MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;
const DEFAULT_ARTIFACT_TIMEOUT_MS = 120_000;

const defaultTransport: HttpTransport = async (request) => {
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

function validateBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ProviderAdapterError("configuration", "MoneyPrinterTurbo base URL is invalid");
  }
  if (parsed.protocol !== "http:" || parsed.pathname !== "/" || !LOOPBACK_HOSTS.has(parsed.hostname) || parsed.username || parsed.password) {
    throw new ProviderAdapterError("configuration", "MoneyPrinterTurbo must use an authenticated HTTP loopback URL");
  }
  if (parsed.search || parsed.hash) throw new ProviderAdapterError("configuration", "MoneyPrinterTurbo base URL cannot contain query or fragment data");
  return parsed.toString().replace(/\/$/, "");
}

function taskReference(reference: ProviderTaskReference): void {
  if (reference.provider !== "moneyprinterturbo" || !/^[A-Za-z0-9_-]{1,128}$/.test(reference.remoteTaskId) || !/^[A-Za-z0-9_-]{1,200}$/.test(reference.correlationId)) {
    throw new ProviderAdapterError("configuration", "Invalid MoneyPrinterTurbo task reference");
  }
}

function taskState(task: z.infer<typeof ProviderTaskSchema>): ProviderRunState {
  if (task.state === 1) return "succeeded";
  if (task.state === -1) return "failed";
  if (task.state === 4) return "processing";
  return "unknown";
}

function taskPayload(task: z.infer<typeof ProviderTaskSchema>): Record<string, unknown> {
  return { ...task };
}

export class MoneyPrinterTurboAdapter implements ProductionProvider {
  readonly name = "moneyprinterturbo" as const;
  private readonly baseUrl: string;
  private readonly transport: HttpTransport;
  private readonly timeoutMs: number;
  private readonly artifactRoot: string;
  private readonly pollIntervalMs: number;
  private readonly maxPolls: number;
  private readonly maxArtifactBytes: number;
  private readonly artifactTimeoutMs: number;

  constructor(options: {
    apiKey: string;
    baseUrl?: string;
    artifactRoot: string;
    transport?: HttpTransport;
    timeoutMs?: number;
    pollIntervalMs?: number;
    maxPolls?: number;
    maxArtifactBytes?: number;
    artifactTimeoutMs?: number;
  }) {
    if (!options.apiKey.trim()) throw new ProviderAdapterError("configuration", "MoneyPrinterTurbo API key is required");
    this.baseUrl = validateBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.transport = options.transport ?? defaultTransport;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.maxPolls = options.maxPolls ?? DEFAULT_MAX_POLLS;
    this.maxArtifactBytes = options.maxArtifactBytes ?? DEFAULT_MAX_ARTIFACT_BYTES;
    this.artifactTimeoutMs = options.artifactTimeoutMs ?? DEFAULT_ARTIFACT_TIMEOUT_MS;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs <= 0 || !Number.isInteger(this.pollIntervalMs) || this.pollIntervalMs < 0 || !Number.isInteger(this.maxPolls) || this.maxPolls < 1 || !Number.isInteger(this.maxArtifactBytes) || this.maxArtifactBytes < 1 || !Number.isInteger(this.artifactTimeoutMs) || this.artifactTimeoutMs <= 0) {
      throw new ProviderAdapterError("configuration", "MoneyPrinterTurbo polling limits must be positive integers");
    }
    this.apiKey = options.apiKey;
    this.artifactRoot = resolve(options.artifactRoot);
  }

  private readonly apiKey: string;

  private async request(path: string, method: HttpRequest["method"], body?: unknown, correlationId?: string): Promise<HttpResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const request: HttpRequest = {
      method,
      url: `${this.baseUrl}${path}`,
      headers: {
        accept: "application/json",
        "x-api-key": this.apiKey,
        ...(correlationId ? { "x-task-id": correlationId } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
      redirect: "error"
    };
    try {
      return await this.transport(request);
    } catch (error) {
      if (controller.signal.aborted) throw new ProviderAdapterError("timeout", "MoneyPrinterTurbo request timed out");
      throw new ProviderAdapterError("network", "MoneyPrinterTurbo request failed", { cause: error instanceof Error ? error.message : String(error) });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async requestStreaming(path: string): Promise<{ response: HttpResponse; close: () => void }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.artifactTimeoutMs);
    try {
      const response = await this.transport({ method: "GET", url: `${this.baseUrl}${path}`, headers: { accept: "application/octet-stream", "x-api-key": this.apiKey }, signal: controller.signal, redirect: "error" });
      if (response.status >= 300 && response.status < 400) throw new ProviderAdapterError("protocol", "MoneyPrinterTurbo artifact download redirected unexpectedly");
      return { response, close: () => { clearTimeout(timeout); controller.abort(); } };
    } catch (error) {
      clearTimeout(timeout);
      if (controller.signal.aborted) throw new ProviderAdapterError("timeout", "MoneyPrinterTurbo artifact download timed out");
      if (error instanceof ProviderAdapterError) throw error;
      throw new ProviderAdapterError("network", "MoneyPrinterTurbo artifact download failed", { cause: error instanceof Error ? error.message : String(error) });
    }
  }

  private async json(response: HttpResponse): Promise<Record<string, unknown>> {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ProviderAdapterError("protocol", "MoneyPrinterTurbo returned invalid JSON", { status: response.status });
    }
    const parsed = ProviderEnvelopeSchema.safeParse(payload);
    if (!parsed.success) throw new ProviderAdapterError("protocol", "MoneyPrinterTurbo returned an invalid response envelope", { status: response.status });
    return parsed.data as Record<string, unknown>;
  }

  private async reconcile(correlationId: string): Promise<ProviderSubmission | undefined> {
    const response = await this.request("/api/v1/tasks?page=1&page_size=1000", "GET");
    if (response.status < 200 || response.status >= 300) return undefined;
    let payload: unknown;
    try { payload = await response.json(); } catch { return undefined; }
    const parsed = ProviderTaskListResponseSchema.safeParse(payload);
    if (!parsed.success) return undefined;
    const task = parsed.data.data.tasks.find((candidate) => candidate.request_id === correlationId);
    if (!task) return undefined;
    return this.submissionFromTask(task, correlationId);
  }

  private submissionFromTask(task: z.infer<typeof ProviderTaskSchema>, correlationId: string): ProviderSubmission {
    return {
      reference: { provider: this.name, remoteTaskId: task.task_id, correlationId },
      state: taskState(task),
      providerStatus: task.state,
      ...(task.error ? { error: task.error } : {}),
      providerPayload: taskPayload(task)
    };
  }

  async submitProduction(input: ProviderProductionRequest): Promise<ProviderSubmission> {
    const validatedInput = ProviderProductionRequestSchema.safeParse(input);
    if (!validatedInput.success) throw new ProviderAdapterError("configuration", "Invalid MoneyPrinterTurbo production request");
    const request = validatedInput.data;
    const body = {
      video_subject: request.topic,
      video_script: request.script,
      video_terms: request.videoTerms,
      video_language: request.language,
      video_aspect: request.aspectRatio,
      video_clip_duration: Math.max(1, Math.min(15, Math.ceil(request.targetDurationSec / 8))),
      video_count: 1,
      video_source: request.videoSource ?? "local",
      video_materials: request.videoMaterials,
      voice_name: request.voiceName ?? "",
      subtitle_enabled: request.subtitleEnabled ?? true,
      bgm_type: request.backgroundMusic ?? "",
      video_concat_mode: "sequential",
      match_materials_to_script: true,
      n_threads: 1
    };
    try {
      const response = await this.request("/api/v1/videos", "POST", body, request.correlationId);
      if (response.status < 200 || response.status >= 300) {
        const envelope = await this.json(response).catch(() => undefined);
        throw new ProviderAdapterError("http", "MoneyPrinterTurbo rejected production submission", { status: response.status, message: envelope?.message });
      }
      const parsed = ProviderSubmissionResponseSchema.safeParse(await this.json(response));
      if (!parsed.success) throw new ProviderAdapterError("protocol", "MoneyPrinterTurbo returned an invalid submission response");
      return {
        reference: { provider: this.name, remoteTaskId: parsed.data.data.task_id, correlationId: request.correlationId },
        state: "accepted",
        providerStatus: parsed.data.status,
        providerPayload: { status: parsed.data.status, ...(parsed.data.message ? { message: parsed.data.message } : {}), data: parsed.data.data }
      };
    } catch (error) {
      if (!(error instanceof ProviderAdapterError) || (error.code !== "timeout" && error.code !== "network")) throw error;
      try {
        const reconciled = await this.reconcile(request.correlationId);
        if (reconciled) return reconciled;
      } catch {
        // Preserve the ambiguous state. A second submission is unsafe.
      }
      return { state: "unknown", error: error.message, providerPayload: { correlationId: request.correlationId } };
    }
  }

  async getProductionStatus(reference: ProviderTaskReference): Promise<NormalizedProviderStatus> {
    taskReference(reference);
    const response = await this.request(`/api/v1/tasks/${encodeURIComponent(reference.remoteTaskId)}`, "GET");
    if (response.status < 200 || response.status >= 300) throw new ProviderAdapterError("http", "MoneyPrinterTurbo task status request failed", { status: response.status });
    const parsed = ProviderTaskResponseSchema.safeParse(await this.json(response));
    if (!parsed.success) throw new ProviderAdapterError("protocol", "MoneyPrinterTurbo returned an invalid task status response");
    const task = parsed.data.data;
    if (task.task_id !== reference.remoteTaskId) throw new ProviderAdapterError("protocol", "MoneyPrinterTurbo returned a different task identity", { expectedTaskId: reference.remoteTaskId, receivedTaskId: task.task_id });
    if (task.request_id !== undefined && task.request_id !== reference.correlationId) throw new ProviderAdapterError("protocol", "MoneyPrinterTurbo returned a different correlation identity", { expectedCorrelationId: reference.correlationId, receivedCorrelationId: task.request_id });
    return {
      reference,
      state: taskState(task),
      progress: task.progress ?? null,
      providerStatus: task.state,
      ...(task.failed_stage ? { failedStage: task.failed_stage } : {}),
      ...(task.error ? { error: task.error } : {}),
      providerPayload: taskPayload(task)
    };
  }

  async waitForProduction(reference: ProviderTaskReference): Promise<NormalizedProviderStatus> {
    for (let attempt = 0; attempt < this.maxPolls; attempt += 1) {
      const status = await this.getProductionStatus(reference);
      if (["succeeded", "failed", "unknown"].includes(status.state)) return status;
      if (attempt + 1 < this.maxPolls && this.pollIntervalMs > 0) await new Promise((resolvePromise) => setTimeout(resolvePromise, this.pollIntervalMs));
    }
    return { reference, state: "unknown", progress: null, providerStatus: 4, error: "MoneyPrinterTurbo polling limit reached", providerPayload: {} };
  }

  async getProductionArtifacts(reference: ProviderTaskReference): Promise<ProviderArtifact[]> {
    const status = await this.getProductionStatus(reference);
    if (status.state === "failed") throw new ProviderAdapterError("conflict", status.error ?? "MoneyPrinterTurbo production failed");
    if (status.state !== "succeeded") throw new ProviderAdapterError("conflict", "MoneyPrinterTurbo production is not complete");
    const task = ProviderTaskSchema.parse(status.providerPayload);
    const paths: Array<{ kind: ProviderArtifact["kind"]; value: string }> = [
      ...(task.videos ?? []).map((value) => ({ kind: "render" as const, value })),
      ...(task.combined_videos ?? []).map((value) => ({ kind: "video" as const, value })),
      ...(task.audio_file ? [{ kind: "audio" as const, value: task.audio_file }] : []),
      ...(task.subtitle_path ? [{ kind: "caption" as const, value: task.subtitle_path }] : [])
    ];
    if (!paths.length) throw new ProviderAdapterError("protocol", "MoneyPrinterTurbo completed without artifacts");
    const artifacts: ProviderArtifact[] = [];
    for (const path of paths) artifacts.push(await this.downloadArtifact(reference, path.kind, path.value));
    return artifacts;
  }

  private async downloadArtifact(reference: ProviderTaskReference, kind: ProviderArtifact["kind"], providerPath: string): Promise<ProviderArtifact> {
    taskReference(reference);
    const url = this.safeArtifactUrl(reference, providerPath);
    const streamed = await this.requestStreaming(url.pathname);
    try {
      const response = streamed.response;
      if (response.status < 200 || response.status >= 300) throw new ProviderAdapterError("http", "MoneyPrinterTurbo artifact download failed", { status: response.status });
      let decodedPath: string;
      try { decodedPath = decodeURIComponent(url.pathname); } catch { throw new ProviderAdapterError("protocol", "MoneyPrinterTurbo returned an invalid encoded artifact path"); }
      const providerRelative = decodedPath.split("/").slice(3).join("/");
      const destinationRelative = `moneyprinterturbo/${reference.remoteTaskId}/${providerRelative}`;
      await mkdir(this.artifactRoot, { recursive: true });
      const root = await realpath(this.artifactRoot);
      const canonicalDestination = resolve(root, destinationRelative);
      if (relative(root, canonicalDestination).startsWith(`..${sep}`) || relative(root, canonicalDestination) === "..") throw new ProviderAdapterError("protocol", "MoneyPrinterTurbo artifact escaped the artifact root");
      await mkdir(dirname(canonicalDestination), { recursive: true });
      const canonicalParent = await realpath(dirname(canonicalDestination));
      if (relative(root, canonicalParent).startsWith(`..${sep}`) || relative(root, canonicalParent) === "..") throw new ProviderAdapterError("protocol", "MoneyPrinterTurbo artifact parent escaped the artifact root");
      try {
        const existing = await lstat(canonicalDestination);
        if (existing.isSymbolicLink()) throw new ProviderAdapterError("protocol", "Refusing to overwrite a symlinked provider artifact");
        throw new ProviderAdapterError("conflict", "Refusing to overwrite an existing immutable provider artifact");
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const temporary = `${canonicalDestination}.${randomUUID()}.tmp`;
      let byteSize = 0;
      const digest = createHash("sha256");
      const file: FileHandle = await open(temporary, "wx");
      try {
      const contentLength = Number(response.headers?.["content-length"] ?? "");
      if (Number.isFinite(contentLength) && contentLength > this.maxArtifactBytes) throw new ProviderAdapterError("protocol", "MoneyPrinterTurbo artifact exceeds the configured download limit");
      const iterator = response.stream()[Symbol.asyncIterator]();
      const deadline = Date.now() + this.artifactTimeoutMs;
      while (true) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new ProviderAdapterError("timeout", "MoneyPrinterTurbo artifact download timed out");
        let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          const next = await Promise.race([
            iterator.next(),
            new Promise<never>((_, reject) => { deadlineTimer = setTimeout(() => reject(new ProviderAdapterError("timeout", "MoneyPrinterTurbo artifact download timed out")), remaining); })
          ]);
          if (next.done) break;
          const chunk = next.value;
          byteSize += chunk.byteLength;
          if (byteSize > this.maxArtifactBytes) throw new ProviderAdapterError("protocol", "MoneyPrinterTurbo artifact exceeds the configured download limit");
          digest.update(chunk);
          await file.write(chunk);
        } finally {
          if (deadlineTimer) clearTimeout(deadlineTimer);
        }
      }
      await file.sync();
      } catch (error) {
        await file.close();
        await rm(temporary, { force: true });
        throw error;
      }
      await file.close();
      try {
        await rename(temporary, canonicalDestination);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
      return {
        kind,
        providerPath,
        relativePath: relative(root, canonicalDestination).split(sep).join("/"),
        mimeType: mimeTypeFor(canonicalDestination),
        sha256: digest.digest("hex"),
        byteSize,
        provenance: { provider: this.name, remoteTaskId: reference.remoteTaskId, correlationId: reference.correlationId, providerPath },
        sourceMetadata: { provider: this.name, remoteTaskId: reference.remoteTaskId, correlationId: reference.correlationId, providerPath }
      };
    } finally {
      streamed.close();
    }
  }

  private safeArtifactUrl(reference: ProviderTaskReference, providerPath: string): URL {
    let url: URL;
    try { url = new URL(providerPath, `${this.baseUrl}/`); } catch { throw new ProviderAdapterError("protocol", "MoneyPrinterTurbo returned an invalid artifact path"); }
    const base = new URL(this.baseUrl);
    if (url.origin !== base.origin || url.protocol !== "http:" || url.search || url.hash) throw new ProviderAdapterError("protocol", "MoneyPrinterTurbo artifact URL is not local");
    let decoded: string;
    try { decoded = decodeURIComponent(url.pathname); } catch { throw new ProviderAdapterError("protocol", "MoneyPrinterTurbo returned an invalid encoded artifact path"); }
    const segments = decoded.split("/").filter(Boolean);
    if (segments.length < 3 || segments[0] !== "tasks" || segments[1] !== reference.remoteTaskId || segments.slice(2).some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\\") || segment.includes("\0"))) throw new ProviderAdapterError("protocol", "MoneyPrinterTurbo returned an unsafe artifact path");
    return url;
  }

  async cancelProduction(reference: ProviderTaskReference): Promise<ProviderCancellation> {
    const status = await this.getProductionStatus(reference);
    if (["succeeded", "failed", "unknown"].includes(status.state)) return { state: "already_terminal", detail: `provider state: ${status.state}` };
    return { state: "unsupported", detail: "MoneyPrinterTurbo has no active-task cancellation endpoint; DELETE only deletes terminal tasks" };
  }
}

function mimeTypeFor(path: string): string {
  if (path.endsWith(".mp4")) return "video/mp4";
  if (path.endsWith(".mp3")) return "audio/mpeg";
  if (path.endsWith(".srt")) return "text/srt";
  return "application/octet-stream";
}
