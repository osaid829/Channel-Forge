import { z } from "zod";
import { PRODUCTION_JOB_STATES, SCHEMA_VERSION } from "./types.js";

const id = z.string().min(1).max(200);
const iso = z.string().datetime({ offset: true });
const sha256 = z.string().regex(/^[a-f0-9]{64}$/i);

export const ProductionJobStateSchema = z.enum(PRODUCTION_JOB_STATES);
export const ProviderNameSchema = z.literal("moneyprinterturbo");
export const ProviderRunStateSchema = z.enum(["submitting", "accepted", "processing", "succeeded", "failed", "unknown"] as const);
export const ProviderResolutionDecisionSchema = z.enum(["attach_existing", "preserve_unknown", "authorize_retry"] as const);

export const CreateChannelProfileSchema = z.object({
  id: id.optional(),
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  platform: z.literal("youtube"),
  locale: z.string().min(2).max(20),
  audience: z.string().min(1).max(500),
  contentPillars: z.array(z.string().min(1).max(100)).min(1).max(20),
  brand: z.object({
    voice: z.string().min(1).max(500),
    visualStyle: z.string().min(1).max(500),
    bannedTopics: z.array(z.string().min(1).max(200)).max(100)
  }),
  policy: z.object({
    defaultPrivacy: z.enum(["private", "unlisted", "public"]),
    humanApprovalRequired: z.literal(true),
    factualReviewRequired: z.boolean(),
    rightsReviewRequired: z.boolean()
  }),
  credentialsRef: z.object({ youtube: z.string().min(1).max(500) }),
  status: z.enum(["active", "paused", "archived"]).default("active")
}).strict();

export const CreateContentBriefSchema = z.object({
  id: id.optional(),
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  channelId: id,
  topic: z.string().min(1).max(500),
  angle: z.string().min(1).max(2000),
  hook: z.string().min(1).max(1000),
  format: z.enum(["short", "long_form"]),
  language: z.string().min(2).max(20),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]),
  targetDurationSec: z.number().int().positive().max(7200),
  audiencePromise: z.string().min(1).max(2000),
  contentPillars: z.array(z.string().min(1).max(100)).min(1).max(20),
  claimIds: z.array(id).max(500).default([]),
  evidenceIds: z.array(id).max(500).default([]),
  status: z.enum(["draft", "researched", "ready", "rejected"]).default("draft")
}).strict();

export const CreateProductionJobSchema = z.object({
  id: id.optional(),
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  channelId: id,
  briefId: id,
  renderer: z.string().min(1).max(200),
  idempotencyKey: z.string().min(1).max(500)
}).strict();

export const CreateMediaAssetSchema = z.object({
  id: id.optional(),
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  productionJobId: id,
  sceneId: z.string().min(1).max(200).optional(),
  type: z.enum(["video", "image", "audio", "caption", "render"]),
  relativePath: z.string().min(1).max(1000),
  mimeType: z.string().min(1).max(200),
  sha256,
  byteSize: z.number().int().nonnegative(),
  durationSec: z.number().finite().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  sourceProvider: z.string().min(1).max(200),
  sourceMetadata: z.record(z.unknown()).default({}),
  rightsStatus: z.enum(["pending", "verified", "waived", "rejected"]).default("pending"),
  isSynthetic: z.boolean().default(false)
}).strict();

export const CreateApprovalRecordSchema = z.object({
  id: id.optional(),
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  productionJobId: id,
  reviewer: z.string().min(1).max(200),
  reviewFingerprint: sha256,
  artifactIds: z.array(id).min(1).max(1000),
  factualReview: z.enum(["pending", "passed", "waived", "failed"]),
  rightsReview: z.enum(["pending", "passed", "waived", "failed"]),
  qualityReview: z.enum(["pending", "passed", "failed"]),
  decision: z.enum(["pending", "approved", "rejected"]),
  note: z.string().max(5000).optional(),
  decidedAt: iso.optional()
}).strict();

export const ValidationEvidenceSchema = z.object({
  source: z.literal("trusted-runtime"),
  validator: z.string().min(1).max(200),
  validatedAt: iso,
  summary: z.string().min(1).max(2000),
  sha256: sha256,
  byteSize: z.number().int().nonnegative(),
  media: z.object({
    mimeType: z.string().min(1),
    durationSec: z.number().finite().positive(),
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative()
  }),
  artifact: z.object({ id, relativePath: z.string().min(1).max(1000) }).optional(),
  provenance: z.object({
    provider: z.string().min(1).max(200),
    remoteTaskId: id.optional(),
    correlationId: id.optional(),
    providerPath: z.string().min(1).max(2000).optional()
  }).optional(),
  checks: z.object({
    container: z.literal("passed"),
    codec: z.literal("passed"),
    resolution: z.literal("passed"),
    frameRate: z.literal("passed"),
    duration: z.literal("passed"),
    audio: z.enum(["passed", "not_required"]),
    audioDuration: z.enum(["passed", "not_required"]),
    avDuration: z.enum(["passed", "not_required"]),
    decode: z.literal("passed"),
    checksum: z.literal("passed"),
    fileIdentity: z.literal("passed"),
    provenance: z.enum(["passed", "not_required"])
  }).optional(),
  probe: z.record(z.unknown()).default({})
}).strict();

export const CreateProductionProviderRunSchema = z.object({
  id: id.optional(),
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  productionJobId: id,
  provider: ProviderNameSchema,
  correlationId: id,
  remoteTaskId: id.optional(),
  state: ProviderRunStateSchema.default("submitting"),
  providerStatus: z.number().int().optional(),
  requestFingerprint: sha256,
  submittedAt: iso,
  lastPolledAt: iso.optional(),
  cancelRequestedAt: iso.optional(),
  error: z.string().max(5000).optional(),
  providerPayload: z.record(z.unknown()).default({})
}).strict();

export const CreateProductionProviderAttemptSchema = CreateProductionProviderRunSchema.extend({
  attemptNumber: z.number().int().positive().default(1),
  resolutionRevision: sha256,
  acknowledgedDuplicateRisk: z.boolean().default(false)
}).strict();

export const CreateProviderResolutionRecordSchema = z.object({
  id: id.optional(),
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  attemptId: id,
  productionJobId: id,
  decision: ProviderResolutionDecisionSchema,
  expectedRevision: sha256,
  operatorId: id,
  note: z.string().max(5000).optional(),
  consumedAt: iso.optional()
}).strict();

export type CreateChannelProfileInput = z.input<typeof CreateChannelProfileSchema>;
export type CreateContentBriefInput = z.input<typeof CreateContentBriefSchema>;
export type CreateProductionJobInput = z.input<typeof CreateProductionJobSchema>;
export type CreateMediaAssetInput = z.input<typeof CreateMediaAssetSchema>;
export type CreateApprovalRecordInput = z.input<typeof CreateApprovalRecordSchema>;
export type ValidationEvidenceInput = z.input<typeof ValidationEvidenceSchema>;
export type CreateProductionProviderRunInput = z.input<typeof CreateProductionProviderRunSchema>;
export type CreateProductionProviderAttemptInput = z.input<typeof CreateProductionProviderAttemptSchema>;
export type CreateProviderResolutionRecordInput = z.input<typeof CreateProviderResolutionRecordSchema>;
