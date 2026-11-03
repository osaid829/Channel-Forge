import { z } from "zod";
import type { ProviderName, ProviderRunState } from "../domain/types.js";

export interface ProviderProductionRequest {
  topic: string;
  script: string;
  videoTerms: string[];
  language: string;
  aspectRatio: "9:16" | "16:9" | "1:1";
  targetDurationSec: number;
  correlationId: string;
  videoSource?: "local" | "pexels" | "pixabay" | "coverr";
  videoMaterials?: Array<{ provider: "local"; url: string; duration?: number }>;
  voiceName?: string;
  subtitleEnabled?: boolean;
  backgroundMusic?: "" | "random";
}

export interface ProviderTaskReference {
  provider: ProviderName;
  remoteTaskId: string;
  correlationId: string;
}

export interface ProviderSubmission {
  reference?: ProviderTaskReference;
  state: ProviderRunState;
  providerStatus?: number;
  error?: string;
  providerPayload: Record<string, unknown>;
}

export interface NormalizedProviderStatus {
  reference: ProviderTaskReference;
  state: ProviderRunState;
  progress: number | null;
  providerStatus: number;
  failedStage?: string;
  error?: string;
  providerPayload: Record<string, unknown>;
}

export interface ProviderArtifact {
  kind: "render" | "video" | "audio" | "caption";
  providerPath: string;
  relativePath: string;
  mimeType: string;
  sha256: string;
  byteSize: number;
  sourceMetadata: Record<string, unknown>;
  provenance: {
    provider: "moneyprinterturbo";
    remoteTaskId: string;
    correlationId: string;
    providerPath: string;
  };
}

export interface ProviderCancellation {
  state: "cancelled" | "unsupported" | "already_terminal" | "unknown";
  detail?: string;
}

export interface ProductionProvider {
  readonly name: ProviderName;
  submitProduction(input: ProviderProductionRequest): Promise<ProviderSubmission>;
  getProductionStatus(reference: ProviderTaskReference): Promise<NormalizedProviderStatus>;
  getProductionArtifacts(reference: ProviderTaskReference): Promise<ProviderArtifact[]>;
  cancelProduction(reference: ProviderTaskReference): Promise<ProviderCancellation>;
}

export interface HttpRequest {
  method: "GET" | "POST" | "DELETE";
  url: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  redirect?: "error" | "manual";
}

export interface HttpResponse {
  status: number;
  json(): Promise<unknown>;
  stream(): AsyncIterable<Uint8Array>;
  headers?: Record<string, string | undefined>;
}

export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>;
const ProviderTaskIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);

export const ProviderProductionRequestSchema = z.object({
  topic: z.string().min(1).max(500),
  script: z.string().min(1).max(100000),
  videoTerms: z.array(z.string().min(1).max(500)).min(1).max(100),
  language: z.string().min(2).max(20),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]),
  targetDurationSec: z.number().int().positive().max(7200),
  correlationId: z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/),
  videoSource: z.enum(["local", "pexels", "pixabay", "coverr"]).optional(),
  videoMaterials: z.array(z.object({ provider: z.literal("local"), url: z.string().min(1).max(2000), duration: z.number().positive().optional() }).strict()).max(100).optional(),
  voiceName: z.string().max(200).optional(),
  subtitleEnabled: z.boolean().optional(),
  backgroundMusic: z.enum(["", "random"]).optional()
}).strict();

export const ProviderEnvelopeSchema = z.object({
  status: z.number().int(),
  message: z.string().optional(),
  data: z.unknown().optional()
}).strict();

export const ProviderTaskSchema = z.object({
  task_id: ProviderTaskIdSchema,
  request_id: z.string().min(1).optional(),
  state: z.number().int(),
  progress: z.number().finite().min(0).max(100).optional(),
  videos: z.array(z.string().min(1)).optional(),
  combined_videos: z.array(z.string().min(1)).optional(),
  audio_file: z.string().min(1).optional(),
  subtitle_path: z.string().optional(),
  failed_stage: z.string().min(1).nullable().optional(),
  error: z.string().min(1).nullable().optional()
}).passthrough();

export const ProviderSubmissionResponseSchema = ProviderEnvelopeSchema.extend({
  data: z.object({ task_id: ProviderTaskIdSchema }).strict()
}).strict();

export const ProviderTaskResponseSchema = ProviderEnvelopeSchema.extend({
  data: ProviderTaskSchema
}).strict();

export const ProviderTaskListResponseSchema = ProviderEnvelopeSchema.extend({
  data: z.object({
    tasks: z.array(ProviderTaskSchema),
    total: z.number().int().nonnegative().optional(),
    page: z.number().int().positive().optional(),
    page_size: z.number().int().positive().optional()
  }).strict()
}).strict();

export class ProviderAdapterError extends Error {
  constructor(readonly code: "configuration" | "protocol" | "http" | "timeout" | "network" | "conflict", message: string, readonly details?: Record<string, unknown>) {
    super(message);
    this.name = "ProviderAdapterError";
  }
}
