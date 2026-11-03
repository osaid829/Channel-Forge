import { createHash, randomUUID } from "node:crypto";
import { posix, win32 } from "node:path";
import {
  CreateApprovalRecordSchema,
  CreateChannelProfileSchema,
  CreateContentBriefSchema,
  CreateMediaAssetSchema,
  CreateProductionProviderAttemptSchema,
  CreateProductionProviderRunSchema,
  CreateProviderResolutionRecordSchema,
  CreateProductionJobSchema,
  ValidationEvidenceSchema,
  type CreateApprovalRecordInput,
  type CreateChannelProfileInput,
  type CreateContentBriefInput,
  type CreateMediaAssetInput,
  type CreateProductionProviderAttemptInput,
  type CreateProductionProviderRunInput,
  type CreateProviderResolutionRecordInput,
  type CreateProductionJobInput
} from "../domain/schemas.js";
import {
  ConflictError,
  IdempotencyConflictError,
  NotFoundError,
  UnsafePathError
} from "../domain/errors.js";
import {
  SCHEMA_VERSION,
  type ApprovalRecord,
  type ChannelProfile,
  type ContentBrief,
  type EntityId,
  type JobTransition,
  type MediaAsset,
  type ProductionJob,
  type ProductionJobState,
  type ProductionProviderAttempt,
  type ProductionProviderRun,
  type ProviderResolutionRecord,
  type ProviderRunState
} from "../domain/types.js";
import { SqliteDatabase } from "./database.js";
import type { TrustedValidationEvidence } from "../services/artifact-validation.js";

type Row = Record<string, unknown>;

const timestamp = () => new Date().toISOString();
const json = (value: unknown) => JSON.stringify(value);
const parse = <T>(value: unknown) => JSON.parse(String(value)) as T;

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
}

export function fingerprint(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

export function assertSafeRelativePath(value: string): string {
  if (value.includes("\0") || posix.isAbsolute(value) || win32.isAbsolute(value)) {
    throw new UnsafePathError(value);
  }

  const normalized = posix.normalize(value.replaceAll("\\", "/"));
  if (normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../") || /^[A-Za-z]:/.test(normalized)) {
    throw new UnsafePathError(value);
  }

  return normalized;
}

function channelRow(row: Row): ChannelProfile {
  return {
    id: String(row.id), schemaVersion: Number(row.schema_version) as typeof SCHEMA_VERSION,
    slug: String(row.slug), platform: "youtube", locale: String(row.locale), audience: String(row.audience),
    contentPillars: parse<string[]>(row.content_pillars_json), brand: parse<ChannelProfile["brand"]>(row.brand_json),
    policy: parse<ChannelProfile["policy"]>(row.policy_json), credentialsRef: parse<ChannelProfile["credentialsRef"]>(row.credentials_ref_json),
    status: row.status as ChannelProfile["status"], createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

function briefRow(row: Row): ContentBrief {
  return {
    id: String(row.id), schemaVersion: Number(row.schema_version) as typeof SCHEMA_VERSION, channelId: String(row.channel_id),
    topic: String(row.topic), angle: String(row.angle), hook: String(row.hook), format: row.format as ContentBrief["format"],
    language: String(row.language), aspectRatio: row.aspect_ratio as ContentBrief["aspectRatio"], targetDurationSec: Number(row.target_duration_sec),
    audiencePromise: String(row.audience_promise), contentPillars: parse<string[]>(row.content_pillars_json), claimIds: parse<string[]>(row.claim_ids_json),
    evidenceIds: parse<string[]>(row.evidence_ids_json), status: row.status as ContentBrief["status"], createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

function jobRow(row: Row): ProductionJob {
  const lastError = row.last_error == null ? undefined : String(row.last_error);
  const failureKind = row.failure_kind == null ? undefined : row.failure_kind as ProductionJob["failureKind"];
  const interruptedAt = row.interrupted_at == null ? undefined : String(row.interrupted_at);
  return {
    id: String(row.id), schemaVersion: Number(row.schema_version) as typeof SCHEMA_VERSION, channelId: String(row.channel_id), briefId: String(row.brief_id),
    renderer: String(row.renderer), currentState: row.current_state as ProductionJobState, stageStates: parse<ProductionJob["stageStates"]>(row.stage_states_json),
    artifactIds: parse<string[]>(row.artifact_ids_json), idempotencyKey: String(row.idempotency_key), payloadFingerprint: String(row.payload_fingerprint),
    ...(lastError ? { lastError } : {}), ...(failureKind ? { failureKind } : {}), ...(interruptedAt ? { interruptedAt } : {}),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

function assetRow(row: Row): MediaAsset {
  return {
    id: String(row.id), schemaVersion: Number(row.schema_version) as typeof SCHEMA_VERSION, productionJobId: String(row.production_job_id),
    ...(row.scene_id == null ? {} : { sceneId: String(row.scene_id) }), type: row.artifact_type as MediaAsset["type"], relativePath: String(row.relative_path),
    mimeType: String(row.mime_type), sha256: String(row.sha256), byteSize: Number(row.byte_size),
    ...(row.duration_sec == null ? {} : { durationSec: Number(row.duration_sec) }), ...(row.width == null ? {} : { width: Number(row.width) }),
    ...(row.height == null ? {} : { height: Number(row.height) }), sourceProvider: String(row.source_provider), sourceMetadata: parse<Record<string, unknown>>(row.source_metadata_json),
    rightsStatus: row.rights_status as MediaAsset["rightsStatus"], validationStatus: row.validation_status as MediaAsset["validationStatus"],
    ...(row.validation_evidence_json == null ? {} : { validationEvidence: parse<Record<string, unknown>>(row.validation_evidence_json) }),
    isSynthetic: Number(row.is_synthetic) === 1, createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

function approvalRow(row: Row): ApprovalRecord {
  return {
    id: String(row.id), schemaVersion: Number(row.schema_version) as typeof SCHEMA_VERSION, productionJobId: String(row.production_job_id), reviewer: String(row.reviewer),
    reviewFingerprint: String(row.review_fingerprint), artifactIds: parse<string[]>(row.artifact_ids_json), factualReview: row.factual_review as ApprovalRecord["factualReview"],
    rightsReview: row.rights_review as ApprovalRecord["rightsReview"], qualityReview: row.quality_review as ApprovalRecord["qualityReview"], decision: row.decision as ApprovalRecord["decision"],
    ...(row.note == null ? {} : { note: String(row.note) }), ...(row.decided_at == null ? {} : { decidedAt: String(row.decided_at) }),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

function providerRunRow(row: Row): ProductionProviderRun {
  return {
    id: String(row.id), schemaVersion: Number(row.schema_version) as typeof SCHEMA_VERSION,
    productionJobId: String(row.production_job_id), provider: "moneyprinterturbo", correlationId: String(row.correlation_id),
    ...(row.remote_task_id == null ? {} : { remoteTaskId: String(row.remote_task_id) }),
    state: row.state as ProductionProviderRun["state"],
    ...(row.provider_status == null ? {} : { providerStatus: Number(row.provider_status) }),
    requestFingerprint: String(row.request_fingerprint), submittedAt: String(row.submitted_at),
    ...(row.last_polled_at == null ? {} : { lastPolledAt: String(row.last_polled_at) }),
    ...(row.cancel_requested_at == null ? {} : { cancelRequestedAt: String(row.cancel_requested_at) }),
    ...(row.error == null ? {} : { error: String(row.error) }),
    providerPayload: parse<Record<string, unknown>>(row.provider_payload_json),
    attemptId: String(row.attempt_id ?? row.current_attempt_id),
    attemptNumber: Number(row.attempt_number ?? 1),
    resolutionRevision: String(row.resolution_revision ?? row.request_fingerprint),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

function providerResolutionRow(row: Row): ProviderResolutionRecord {
  return {
    id: String(row.id), schemaVersion: Number(row.schema_version) as typeof SCHEMA_VERSION,
    attemptId: String(row.attempt_id), productionJobId: String(row.production_job_id),
    decision: row.decision as ProviderResolutionRecord["decision"], expectedRevision: String(row.expected_revision),
    operatorId: String(row.operator_id), ...(row.note == null ? {} : { note: String(row.note) }),
    ...(row.consumed_at == null ? {} : { consumedAt: String(row.consumed_at) }),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

export class ChannelRepository {
  constructor(private readonly db: SqliteDatabase) {}

  create(input: CreateChannelProfileInput): ChannelProfile {
    const value = CreateChannelProfileSchema.parse(input); const id = value.id ?? randomUUID(); const time = timestamp();
    this.db.run(`INSERT INTO channel_profiles (id, schema_version, slug, platform, locale, audience, content_pillars_json, brand_json, policy_json, credentials_ref_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, value.schemaVersion, value.slug, value.platform, value.locale, value.audience, json(value.contentPillars), json(value.brand), json(value.policy), json(value.credentialsRef), value.status, time, time]);
    return this.requireById(id);
  }

  getById(id: string): ChannelProfile | undefined { const row = this.db.get<Row>("SELECT * FROM channel_profiles WHERE id = ?", [id]); return row ? channelRow(row) : undefined; }
  requireById(id: string): ChannelProfile { const value = this.getById(id); if (!value) throw new NotFoundError("ChannelProfile", id); return value; }
}

export class ContentBriefRepository {
  constructor(private readonly db: SqliteDatabase) {}

  create(input: CreateContentBriefInput): ContentBrief {
    const value = CreateContentBriefSchema.parse(input); const id = value.id ?? randomUUID(); const time = timestamp();
    this.db.run(`INSERT INTO content_briefs (id, schema_version, channel_id, topic, angle, hook, format, language, aspect_ratio, target_duration_sec, audience_promise, content_pillars_json, claim_ids_json, evidence_ids_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, value.schemaVersion, value.channelId, value.topic, value.angle, value.hook, value.format, value.language, value.aspectRatio, value.targetDurationSec, value.audiencePromise, json(value.contentPillars), json(value.claimIds), json(value.evidenceIds), value.status, time, time]);
    return this.requireById(id);
  }

  getById(id: string): ContentBrief | undefined { const row = this.db.get<Row>("SELECT * FROM content_briefs WHERE id = ?", [id]); return row ? briefRow(row) : undefined; }
  requireById(id: string): ContentBrief { const value = this.getById(id); if (!value) throw new NotFoundError("ContentBrief", id); return value; }
  listByChannel(channelId: string): ContentBrief[] { return this.db.all<Row>("SELECT * FROM content_briefs WHERE channel_id = ? ORDER BY created_at", [channelId]).map(briefRow); }
}

export class ProductionJobRepository {
  constructor(private readonly db: SqliteDatabase) {}

  create(input: CreateProductionJobInput): ProductionJob {
    const value = CreateProductionJobSchema.parse(input); const id = value.id ?? randomUUID(); const time = timestamp();
    const payloadFingerprint = fingerprint({ channelId: value.channelId, briefId: value.briefId, renderer: value.renderer });
    const existing = this.db.get<Row>("SELECT * FROM production_jobs WHERE idempotency_key = ?", [value.idempotencyKey]);
    if (existing) {
      const job = jobRow(existing);
      if (job.payloadFingerprint !== payloadFingerprint) throw new IdempotencyConflictError(value.idempotencyKey, job.payloadFingerprint, payloadFingerprint);
      return job;
    }
    const active = this.db.get<Row>("SELECT id FROM production_jobs WHERE brief_id = ? AND current_state IN ('CREATED','PLANNING','NARRATING','SOURCING','CAPTIONING','RENDERING','VALIDATING','REVIEW') LIMIT 1", [value.briefId]);
    if (active) throw new ConflictError(`An active job already exists for brief ${value.briefId}`, { existingJobId: String(active.id) });
    const stages = { planning: "pending", narrating: "pending", sourcing: "pending", captioning: "pending", rendering: "pending", validating: "pending" };
    this.db.transaction(() => {
      this.db.run(`INSERT INTO production_jobs (id, schema_version, channel_id, brief_id, renderer, current_state, stage_states_json, artifact_ids_json, idempotency_key, payload_fingerprint, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'CREATED', ?, ?, ?, ?, ?, ?)`, [id, value.schemaVersion, value.channelId, value.briefId, value.renderer, json(stages), json([]), value.idempotencyKey, payloadFingerprint, time, time]);
      this.db.run("INSERT INTO job_transitions (job_id, from_state, to_state, reason, created_at) VALUES (?, NULL, 'CREATED', ?, ?)", [id, "job created", time]);
    });
    return this.requireById(id);
  }

  getById(id: string): ProductionJob | undefined { const row = this.db.get<Row>("SELECT * FROM production_jobs WHERE id = ?", [id]); return row ? jobRow(row) : undefined; }
  requireById(id: string): ProductionJob { const value = this.getById(id); if (!value) throw new NotFoundError("ProductionJob", id); return value; }
  listByChannel(channelId: string): ProductionJob[] { return this.db.all<Row>("SELECT * FROM production_jobs WHERE channel_id = ? ORDER BY created_at", [channelId]).map(jobRow); }
  listActive(): ProductionJob[] { return this.db.all<Row>("SELECT * FROM production_jobs WHERE current_state IN ('PLANNING','NARRATING','SOURCING','CAPTIONING','RENDERING','VALIDATING') ORDER BY updated_at").map(jobRow); }

  transition(jobId: string, from: ProductionJobState, to: ProductionJobState, reason?: string, error?: string, failureKind?: "runtime_failure" | "interrupted"): ProductionJob {
    const time = timestamp();
    return this.db.transaction(() => {
      const current = this.requireById(jobId);
      if (current.currentState !== from) throw new ConflictError(`Expected ${from}, found ${current.currentState}`, { jobId });
      this.db.run("UPDATE production_jobs SET current_state = ?, last_error = COALESCE(?, last_error), failure_kind = COALESCE(?, failure_kind), interrupted_at = CASE WHEN ? = 'interrupted' THEN ? ELSE interrupted_at END, updated_at = ? WHERE id = ?", [to, error ?? null, failureKind ?? null, failureKind ?? null, failureKind === "interrupted" ? time : null, time, jobId]);
      this.db.run("INSERT INTO job_transitions (job_id, from_state, to_state, reason, error, created_at) VALUES (?, ?, ?, ?, ?, ?)", [jobId, from, to, reason ?? null, error ?? null, time]);
      return this.requireById(jobId);
    });
  }

  updateError(jobId: string, error: string): ProductionJob { this.db.run("UPDATE production_jobs SET last_error = ?, failure_kind = 'runtime_failure', updated_at = ? WHERE id = ?", [error, timestamp(), jobId]); return this.requireById(jobId); }
  getHistory(jobId: string): JobTransition[] { return this.db.all<Row>("SELECT * FROM job_transitions WHERE job_id = ? ORDER BY id", [jobId]).map((row) => ({ id: Number(row.id), jobId: String(row.job_id), ...(row.from_state ? { fromState: row.from_state as ProductionJobState } : {}), toState: row.to_state as ProductionJobState, ...(row.reason ? { reason: String(row.reason) } : {}), ...(row.error ? { error: String(row.error) } : {}), createdAt: String(row.created_at) })); }
}

export class MediaAssetRepository {
  constructor(private readonly db: SqliteDatabase) {}

  create(input: CreateMediaAssetInput): MediaAsset {
    const value = CreateMediaAssetSchema.parse(input); const id = value.id ?? randomUUID(); const time = timestamp(); const path = assertSafeRelativePath(value.relativePath);
    this.db.transaction(() => {
      this.db.run(`INSERT INTO media_assets (id, schema_version, production_job_id, scene_id, artifact_type, relative_path, mime_type, sha256, byte_size, duration_sec, width, height, source_provider, source_metadata_json, rights_status, validation_status, is_synthetic, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unvalidated', ?, ?, ?)`, [id, value.schemaVersion, value.productionJobId, value.sceneId ?? null, value.type, path, value.mimeType, value.sha256.toLowerCase(), value.byteSize, value.durationSec ?? null, value.width ?? null, value.height ?? null, value.sourceProvider, json(value.sourceMetadata), value.rightsStatus, value.isSynthetic ? 1 : 0, time, time]);
      this.db.run("UPDATE production_jobs SET artifact_ids_json = json_insert(artifact_ids_json, '$[#]', ?), updated_at = ? WHERE id = ?", [id, time, value.productionJobId]);
    });
    return this.requireById(id);
  }

  getById(id: string): MediaAsset | undefined { const row = this.db.get<Row>("SELECT * FROM media_assets WHERE id = ?", [id]); return row ? assetRow(row) : undefined; }
  requireById(id: string): MediaAsset { const value = this.getById(id); if (!value) throw new NotFoundError("MediaAsset", id); return value; }
  getByJobAndPath(jobId: string, relativePath: string): MediaAsset | undefined { const row = this.db.get<Row>("SELECT * FROM media_assets WHERE production_job_id = ? AND relative_path = ?", [jobId, relativePath]); return row ? assetRow(row) : undefined; }
  listByJob(jobId: string): MediaAsset[] { return this.db.all<Row>("SELECT * FROM media_assets WHERE production_job_id = ? ORDER BY created_at", [jobId]).map(assetRow); }

  markValidated(id: string, evidence: TrustedValidationEvidence): MediaAsset {
    const asset = this.requireById(id); if (asset.isSynthetic) throw new ConflictError("Synthetic assets cannot be trusted as production output", { assetId: id });
    const validated = ValidationEvidenceSchema.parse(evidence);
    this.db.run("UPDATE media_assets SET validation_status = 'validated', validation_evidence_json = ?, updated_at = ? WHERE id = ?", [json(validated), timestamp(), id]);
    return this.requireById(id);
  }

  markValidatedBatch(evidenceByAssetId: Array<{ id: string; evidence: TrustedValidationEvidence }>): MediaAsset[] {
    const parsed = evidenceByAssetId.map(({ id, evidence }) => ({ id, evidence: ValidationEvidenceSchema.parse(evidence) }));
    const time = timestamp();
    this.db.transaction(() => {
      for (const item of parsed) {
        const asset = this.requireById(item.id);
        if (asset.isSynthetic) throw new ConflictError("Synthetic assets cannot be trusted as production output", { assetId: item.id });
        this.db.run("UPDATE media_assets SET validation_status = 'validated', validation_evidence_json = ?, updated_at = ? WHERE id = ?", [json(item.evidence), time, item.id]);
      }
    });
    return parsed.map((item) => this.requireById(item.id));
  }

  markInvalid(id: string, reason: string): MediaAsset {
    if (!reason.trim()) throw new ConflictError("Artifact invalidation requires a reason", { assetId: id });
    this.requireById(id);
    this.db.run("UPDATE media_assets SET validation_status = 'invalid', validation_evidence_json = ?, updated_at = ? WHERE id = ?", [json({ source: "trusted-runtime", status: "invalid", reason: reason.slice(0, 2000) }), timestamp(), id]);
    return this.requireById(id);
  }

  hasTrustedValidatedRender(jobId: string): boolean {
    return this.listByJob(jobId).some((asset) => asset.type === "render" && !asset.isSynthetic && asset.validationStatus === "validated" && asset.validationEvidence?.source === "trusted-runtime");
  }

  hasCompleteTrustedValidation(jobId: string): boolean {
    const assets = this.listByJob(jobId);
    return assets.length > 0 && assets.some((asset) => asset.type === "render" && !asset.isSynthetic && asset.validationStatus === "validated") && assets.every((asset) => !asset.isSynthetic && asset.validationStatus === "validated" && asset.validationEvidence?.source === "trusted-runtime");
  }
}

export class ApprovalRepository {
  constructor(private readonly db: SqliteDatabase) {}

  create(input: CreateApprovalRecordInput): ApprovalRecord {
    const value = CreateApprovalRecordSchema.parse(input); const id = value.id ?? randomUUID(); const time = timestamp();
    this.db.run(`INSERT INTO approval_records (id, schema_version, production_job_id, reviewer, review_fingerprint, artifact_ids_json, factual_review, rights_review, quality_review, decision, note, decided_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, value.schemaVersion, value.productionJobId, value.reviewer, value.reviewFingerprint, json(value.artifactIds), value.factualReview, value.rightsReview, value.qualityReview, value.decision, value.note ?? null, value.decidedAt ?? null, time, time]);
    return this.requireById(id);
  }

  getById(id: string): ApprovalRecord | undefined { const row = this.db.get<Row>("SELECT * FROM approval_records WHERE id = ?", [id]); return row ? approvalRow(row) : undefined; }
  requireById(id: string): ApprovalRecord { const value = this.getById(id); if (!value) throw new NotFoundError("ApprovalRecord", id); return value; }
  latestForJob(jobId: string): ApprovalRecord | undefined { const row = this.db.get<Row>("SELECT * FROM approval_records WHERE production_job_id = ? ORDER BY created_at DESC LIMIT 1", [jobId]); return row ? approvalRow(row) : undefined; }
  hasApproved(jobId: string, fingerprintValue: string, artifactIds: string[]): boolean { const approval = this.latestForJob(jobId); return Boolean(approval && approval.decision === "approved" && approval.reviewFingerprint === fingerprintValue && stableEqual(approval.artifactIds, artifactIds) && ["passed", "waived"].includes(approval.factualReview) && ["passed", "waived"].includes(approval.rightsReview) && approval.qualityReview === "passed"); }
}

export class ProductionProviderRunRepository {
  constructor(private readonly db: SqliteDatabase) {}

  create(input: CreateProductionProviderRunInput): ProductionProviderRun {
    const value = CreateProductionProviderRunSchema.parse(input);
    const id = value.id ?? randomUUID(); const attemptId = randomUUID(); const time = timestamp();
    this.db.transaction(() => {
      this.db.run(`INSERT INTO production_provider_attempts (id, schema_version, production_job_id, provider, attempt_number, correlation_id, remote_task_id, state, provider_status, request_fingerprint, submitted_at, last_polled_at, cancel_requested_at, error, provider_payload_json, resolution_revision, acknowledged_duplicate_risk, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`, [attemptId, value.schemaVersion, value.productionJobId, value.provider, value.correlationId, value.remoteTaskId ?? null, value.state, value.providerStatus ?? null, value.requestFingerprint, value.submittedAt, value.lastPolledAt ?? null, value.cancelRequestedAt ?? null, value.error ?? null, json(value.providerPayload), value.requestFingerprint, time, time]);
      this.db.run(`INSERT INTO production_provider_runs (id, schema_version, production_job_id, provider, correlation_id, remote_task_id, state, provider_status, request_fingerprint, submitted_at, last_polled_at, cancel_requested_at, error, provider_payload_json, created_at, updated_at, current_attempt_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, value.schemaVersion, value.productionJobId, value.provider, value.correlationId, value.remoteTaskId ?? null, value.state, value.providerStatus ?? null, value.requestFingerprint, value.submittedAt, value.lastPolledAt ?? null, value.cancelRequestedAt ?? null, value.error ?? null, json(value.providerPayload), time, time, attemptId]);
    });
    return this.requireById(id);
  }

  private select = "SELECT r.*, a.id AS attempt_id, a.attempt_number, a.resolution_revision FROM production_provider_runs r LEFT JOIN production_provider_attempts a ON a.id = r.current_attempt_id";
  getById(id: string): ProductionProviderRun | undefined { const row = this.db.get<Row>(`${this.select} WHERE r.id = ?`, [id]); return row ? providerRunRow(row) : undefined; }
  getByJobId(productionJobId: string): ProductionProviderRun | undefined { const row = this.db.get<Row>(`${this.select} WHERE r.production_job_id = ?`, [productionJobId]); return row ? providerRunRow(row) : undefined; }
  getByCorrelationId(correlationId: string): ProductionProviderRun | undefined { const row = this.db.get<Row>(`${this.select} WHERE r.correlation_id = ?`, [correlationId]); return row ? providerRunRow(row) : undefined; }
  requireById(id: string): ProductionProviderRun { const value = this.getById(id); if (!value) throw new NotFoundError("ProductionProviderRun", id); return value; }

  update(id: string, patch: { state: ProviderRunState; remoteTaskId?: string; providerStatus?: number; lastPolledAt?: string; cancelRequestedAt?: string; error?: string; providerPayload?: Record<string, unknown> }): ProductionProviderRun {
    const current = this.requireById(id); const time = timestamp();
    this.db.transaction(() => {
      this.db.run("UPDATE production_provider_runs SET remote_task_id = ?, state = ?, provider_status = ?, last_polled_at = ?, cancel_requested_at = ?, error = ?, provider_payload_json = ?, updated_at = ? WHERE id = ?", [patch.remoteTaskId ?? current.remoteTaskId ?? null, patch.state, patch.providerStatus ?? current.providerStatus ?? null, patch.lastPolledAt ?? current.lastPolledAt ?? null, patch.cancelRequestedAt ?? current.cancelRequestedAt ?? null, patch.error ?? null, json(patch.providerPayload ?? current.providerPayload), time, id]);
      this.db.run("UPDATE production_provider_attempts SET remote_task_id = ?, state = ?, provider_status = ?, last_polled_at = ?, cancel_requested_at = ?, error = ?, provider_payload_json = ?, updated_at = ? WHERE id = ?", [patch.remoteTaskId ?? current.remoteTaskId ?? null, patch.state, patch.providerStatus ?? current.providerStatus ?? null, patch.lastPolledAt ?? current.lastPolledAt ?? null, patch.cancelRequestedAt ?? current.cancelRequestedAt ?? null, patch.error ?? null, json(patch.providerPayload ?? current.providerPayload), time, current.attemptId]);
    });
    return this.requireById(id);
  }

  reserveAuthorizedRetry(jobId: string, input: CreateProductionProviderAttemptInput, resolutionId: string): ProductionProviderRun {
    const value = CreateProductionProviderAttemptSchema.parse(input); const run = this.getByJobId(jobId); if (!run) throw new NotFoundError("ProductionProviderRun", jobId);
    const id = randomUUID(); const time = timestamp();
    this.db.transaction(() => {
      const consumed = this.db.run("UPDATE provider_resolution_records SET consumed_at = ?, updated_at = ? WHERE id = ? AND attempt_id = ? AND decision = 'authorize_retry' AND consumed_at IS NULL AND expected_revision = ?", [time, time, resolutionId, run.attemptId, run.resolutionRevision]);
      if (consumed.changes !== 1) throw new ConflictError("Provider retry authorization is stale, replayed, or not bound to the current attempt", { jobId, attemptId: run.attemptId });
      this.db.run(`INSERT INTO production_provider_attempts (id, schema_version, production_job_id, provider, attempt_number, correlation_id, remote_task_id, state, provider_status, request_fingerprint, submitted_at, last_polled_at, cancel_requested_at, error, provider_payload_json, resolution_revision, acknowledged_duplicate_risk, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [value.id ?? id, value.schemaVersion, value.productionJobId, value.provider, value.attemptNumber, value.correlationId, value.remoteTaskId ?? null, value.state, value.providerStatus ?? null, value.requestFingerprint, value.submittedAt, value.lastPolledAt ?? null, value.cancelRequestedAt ?? null, value.error ?? null, json(value.providerPayload), value.resolutionRevision, value.acknowledgedDuplicateRisk ? 1 : 0, time, time]);
      this.db.run("UPDATE production_provider_runs SET correlation_id = ?, remote_task_id = ?, state = ?, provider_status = ?, request_fingerprint = ?, submitted_at = ?, last_polled_at = ?, cancel_requested_at = ?, error = ?, provider_payload_json = ?, updated_at = ?, current_attempt_id = ? WHERE id = ?", [value.correlationId, value.remoteTaskId ?? null, value.state, value.providerStatus ?? null, value.requestFingerprint, value.submittedAt, value.lastPolledAt ?? null, value.cancelRequestedAt ?? null, value.error ?? null, json(value.providerPayload), time, value.id ?? id, run.id]);
    });
    return this.requireById(run.id);
  }

  getAttempts(jobId: string): ProductionProviderAttempt[] { return this.db.all<Row>("SELECT * FROM production_provider_attempts WHERE production_job_id = ? ORDER BY attempt_number", [jobId]).map(providerAttemptRow); }
  createResolution(input: CreateProviderResolutionRecordInput): ProviderResolutionRecord { const value = CreateProviderResolutionRecordSchema.parse(input); const id = value.id ?? randomUUID(); const time = timestamp(); this.db.run("INSERT INTO provider_resolution_records (id, schema_version, attempt_id, production_job_id, decision, expected_revision, operator_id, note, consumed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [id, value.schemaVersion, value.attemptId, value.productionJobId, value.decision, value.expectedRevision, value.operatorId, value.note ?? null, value.consumedAt ?? null, time, time]); return this.requireResolution(id); }
  requireResolution(id: string): ProviderResolutionRecord { const row = this.db.get<Row>("SELECT * FROM provider_resolution_records WHERE id = ?", [id]); if (!row) throw new NotFoundError("ProviderResolutionRecord", id); return providerResolutionRow(row); }
  listResolutions(attemptId: string): ProviderResolutionRecord[] { return this.db.all<Row>("SELECT * FROM provider_resolution_records WHERE attempt_id = ? ORDER BY created_at", [attemptId]).map(providerResolutionRow); }
}

function providerAttemptRow(row: Row): ProductionProviderAttempt {
  return {
    id: String(row.id), schemaVersion: Number(row.schema_version) as typeof SCHEMA_VERSION, productionJobId: String(row.production_job_id), provider: "moneyprinterturbo", attemptNumber: Number(row.attempt_number), correlationId: String(row.correlation_id),
    ...(row.remote_task_id == null ? {} : { remoteTaskId: String(row.remote_task_id) }), state: row.state as ProductionProviderAttempt["state"],
    ...(row.provider_status == null ? {} : { providerStatus: Number(row.provider_status) }), requestFingerprint: String(row.request_fingerprint), submittedAt: String(row.submitted_at),
    ...(row.last_polled_at == null ? {} : { lastPolledAt: String(row.last_polled_at) }), ...(row.cancel_requested_at == null ? {} : { cancelRequestedAt: String(row.cancel_requested_at) }), ...(row.error == null ? {} : { error: String(row.error) }), providerPayload: parse<Record<string, unknown>>(row.provider_payload_json), resolutionRevision: String(row.resolution_revision), acknowledgedDuplicateRisk: Number(row.acknowledged_duplicate_risk) === 1, createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

function stableEqual(left: unknown, right: unknown): boolean { return stable(left) === stable(right); }
