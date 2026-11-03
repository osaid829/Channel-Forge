import { ApprovalRequiredError, ArtifactValidationError, ConflictError } from "../domain/errors.js";
import { assertLegalTransition, isActiveProductionState } from "../domain/job-state-machine.js";
import { CreateApprovalRecordSchema, CreateChannelProfileSchema, CreateContentBriefSchema, CreateMediaAssetSchema, CreateProductionJobSchema, type CreateApprovalRecordInput, type CreateChannelProfileInput, type CreateContentBriefInput, type CreateMediaAssetInput, type CreateProductionJobInput } from "../domain/schemas.js";
import type { ApprovalRecord, ChannelProfile, ContentBrief, EntityId, MediaAsset, ProductionJob, ProductionJobState, ProductionProviderRun, ProviderResolutionDecision } from "../domain/types.js";
import { SqliteDatabase } from "../db/database.js";
import { ApprovalRepository, ChannelRepository, ContentBriefRepository, MediaAssetRepository, ProductionJobRepository, ProductionProviderRunRepository, fingerprint } from "../db/repositories.js";
import { ArtifactValidationService, defaultRenderRequirements, type MediaValidationRequirements, type TrustedValidationEvidence } from "./artifact-validation.js";
import type { HumanApprovalReceipt, HumanApprovalVerifier } from "./approval-boundary.js";
import { ProviderAdapterError, type NormalizedProviderStatus, type ProductionProvider, type ProviderArtifact, type ProviderCancellation, type ProviderProductionRequest, type ProviderTaskReference } from "./production-provider.js";
import type { ProviderResolutionReceipt, ProviderResolutionVerifier } from "./provider-resolution-boundary.js";

export class ProductionService {
  private readonly channels: ChannelRepository;
  private readonly briefs: ContentBriefRepository;
  private readonly jobs: ProductionJobRepository;
  private readonly assets: MediaAssetRepository;
  private readonly approvals: ApprovalRepository;
  private readonly providerRuns: ProductionProviderRunRepository;

  constructor(private readonly db: SqliteDatabase, private readonly options: { approvalVerifier?: HumanApprovalVerifier; artifactValidator?: ArtifactValidationService; resolutionVerifier?: ProviderResolutionVerifier } = {}) {
    this.channels = new ChannelRepository(db);
    this.briefs = new ContentBriefRepository(db);
    this.jobs = new ProductionJobRepository(db);
    this.assets = new MediaAssetRepository(db);
    this.approvals = new ApprovalRepository(db);
    this.providerRuns = new ProductionProviderRunRepository(db);
  }

  createChannel(input: CreateChannelProfileInput): ChannelProfile { return this.channels.create(CreateChannelProfileSchema.parse(input)); }

  createBrief(input: CreateContentBriefInput): ContentBrief {
    const value = CreateContentBriefSchema.parse(input);
    this.channels.requireById(value.channelId);
    return this.briefs.create(value);
  }

  createProductionJob(input: CreateProductionJobInput): ProductionJob {
    const value = CreateProductionJobSchema.parse(input);
    const brief = this.briefs.requireById(value.briefId);
    if (brief.channelId !== value.channelId) throw new ConflictError("Job channel does not match brief channel", { briefId: value.briefId });
    this.channels.requireById(value.channelId);
    return this.jobs.create(value);
  }

  transitionJob(jobId: EntityId, toState: ProductionJobState, reason?: string): ProductionJob {
    const current = this.jobs.requireById(jobId);
    assertLegalTransition(current.currentState, toState);
    if (toState === "REVIEW" && !this.assets.hasCompleteTrustedValidation(jobId)) throw new ConflictError("Complete trusted validation of all production artifacts is required before review", { jobId });
    if (toState === "APPROVED") throw new ApprovalRequiredError("Use approveJob with an authority receipt", { jobId });
    return this.jobs.transition(jobId, current.currentState, toState, reason);
  }

  recordArtifact(input: CreateMediaAssetInput): MediaAsset {
    const value = CreateMediaAssetSchema.parse(input);
    this.jobs.requireById(value.productionJobId);
    return this.assets.create(value);
  }

  validateArtifact(assetId: EntityId, requirements: MediaValidationRequirements = defaultRenderRequirements): MediaAsset {
    if (!this.options.artifactValidator) throw new ConflictError("Trusted artifact validation is not configured", { assetId });
    const asset = this.assets.requireById(assetId);
    const job = this.jobs.requireById(asset.productionJobId);
    if (job.currentState !== "VALIDATING") throw new ConflictError("Artifacts may only be trusted while the job is VALIDATING", { assetId, jobId: job.id, state: job.currentState });
    const evidence = this.options.artifactValidator.validate(asset, requirements);
    return this.assets.markValidated(assetId, evidence);
  }

  validateProduction(jobId: EntityId): ProductionJob {
    if (!this.options.artifactValidator) throw new ConflictError("Trusted artifact validation is not configured", { jobId });
    const job = this.jobs.requireById(jobId);
    if (job.currentState !== "VALIDATING") throw new ConflictError("Production validation requires a job in VALIDATING", { jobId, state: job.currentState });
    const run = this.providerRuns.getByJobId(jobId);
    if (!run || run.state !== "succeeded" || !run.remoteTaskId) throw new ConflictError("Production validation requires a succeeded provider run with an exact task identity", { jobId });
    const assets = this.assets.listByJob(jobId).filter((asset) => ["render", "video", "audio"].includes(asset.type));
    const render = assets.find((asset) => asset.type === "render");
    if (!render) throw new ArtifactValidationError("A final render artifact is required before review", { jobId });
    for (const asset of assets) {
      if (asset.sourceProvider === run.provider) {
        const provenance = asset.sourceMetadata.provenance;
        if (!provenance || typeof provenance !== "object" || (provenance as Record<string, unknown>).remoteTaskId !== run.remoteTaskId || (provenance as Record<string, unknown>).correlationId !== run.correlationId) throw new ArtifactValidationError("Artifact provenance does not match the succeeded provider attempt", { assetId: asset.id, jobId });
      }
    }
    const brief = this.briefs.requireById(job.briefId);
    const evidence: Array<{ id: string; evidence: TrustedValidationEvidence }> = [];
    for (const asset of assets) {
      const requirements: MediaValidationRequirements = asset.type === "render"
        ? { ...defaultRenderRequirements, targetDurationSec: brief.targetDurationSec, aspectRatio: brief.aspectRatio }
        : asset.type === "audio"
          ? { ...defaultRenderRequirements, kind: "audio", requiredAudio: true, targetDurationSec: brief.targetDurationSec }
          : { ...defaultRenderRequirements, kind: "video", requiredAudio: false, targetDurationSec: brief.targetDurationSec, aspectRatio: brief.aspectRatio };
      evidence.push({ id: asset.id, evidence: this.options.artifactValidator.validate(asset, requirements) });
    }
    this.assets.markValidatedBatch(evidence);
    return this.transitionJob(jobId, "REVIEW", "Complete trusted FFprobe/FFmpeg artifact validation passed");
  }

  async submitProduction(jobId: EntityId, input: Omit<ProviderProductionRequest, "correlationId">, provider: ProductionProvider): Promise<ProductionProviderRun> {
    const job = this.jobs.requireById(jobId);
    if (job.currentState === "APPROVED" || job.currentState === "CANCELLED") throw new ConflictError("Terminal job cannot be submitted to a production provider", { jobId });
    if (provider.name !== "moneyprinterturbo") throw new ConflictError("Unsupported production provider", { provider: provider.name });
    const requestFingerprint = fingerprint(input);
    const existing = this.providerRuns.getByJobId(jobId);
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) throw new ConflictError("A provider run already exists for a different production request", { jobId });
      if (existing.state === "unknown") {
        const retryAuthorization = this.providerRuns.listResolutions(existing.attemptId).find((resolution) => resolution.decision === "authorize_retry" && !resolution.consumedAt && resolution.expectedRevision === existing.resolutionRevision);
        if (!retryAuthorization) throw new ConflictError("Provider submission outcome is unknown and requires explicit operator resolution", { jobId, attemptId: existing.attemptId });
        const attemptNumber = existing.attemptNumber + 1;
        const correlationId = `channelforge-${jobId}-attempt-${attemptNumber}`;
        const retryRun = this.providerRuns.reserveAuthorizedRetry(jobId, { productionJobId: jobId, provider: provider.name, correlationId, attemptNumber, state: "submitting", requestFingerprint, submittedAt: new Date().toISOString(), resolutionRevision: requestFingerprint, acknowledgedDuplicateRisk: true, providerPayload: {} }, retryAuthorization.id);
        return this.finishProviderSubmission(retryRun, input, provider);
      }
      return existing;
    }
    const correlationId = `channelforge-${jobId}-attempt-1`;
    const run = this.providerRuns.create({ productionJobId: jobId, provider: provider.name, correlationId, state: "submitting", requestFingerprint, submittedAt: new Date().toISOString(), providerPayload: {} });
    return this.finishProviderSubmission(run, input, provider);
  }

  private async finishProviderSubmission(run: ProductionProviderRun, input: Omit<ProviderProductionRequest, "correlationId">, provider: ProductionProvider): Promise<ProductionProviderRun> {
    try {
      const submission = await provider.submitProduction({ ...input, correlationId: run.correlationId });
      return this.providerRuns.update(run.id, { state: submission.state, remoteTaskId: submission.reference?.remoteTaskId, providerStatus: submission.providerStatus, error: submission.error, providerPayload: submission.providerPayload });
    } catch (error) {
      const unknown = error instanceof ProviderAdapterError && (error.code === "timeout" || error.code === "network");
      return this.providerRuns.update(run.id, { state: unknown ? "unknown" : "failed", error: error instanceof Error ? error.message : String(error), providerPayload: {} });
    }
  }

  getProviderRun(jobId: EntityId): ProductionProviderRun | undefined { this.jobs.requireById(jobId); return this.providerRuns.getByJobId(jobId); }

  async pollProduction(jobId: EntityId, provider: ProductionProvider, options: { requireExactTaskIdentity?: boolean } = {}): Promise<ProductionProviderRun> {
    const run = this.providerRuns.getByJobId(jobId);
    if (!run) throw new ConflictError("No provider run exists for production job", { jobId });
    if (!run.remoteTaskId) throw new ConflictError("Provider run has no remote task ID", { jobId });
    const status = await provider.getProductionStatus({ provider: run.provider, remoteTaskId: run.remoteTaskId, correlationId: run.correlationId });
    const taskId = status.providerPayload.task_id;
    const requestId = status.providerPayload.request_id;
    if (taskId !== undefined && taskId !== run.remoteTaskId) throw new ConflictError("Provider status returned a different task identity", { jobId, expectedTaskId: run.remoteTaskId, receivedTaskId: taskId });
    if (requestId !== undefined && requestId !== run.correlationId) throw new ConflictError("Provider status returned a different correlation identity", { jobId, expectedCorrelationId: run.correlationId, receivedCorrelationId: requestId });
    if (options.requireExactTaskIdentity && taskId !== run.remoteTaskId) throw new ConflictError("Provider status could not prove the exact persisted task identity", { jobId, expectedTaskId: run.remoteTaskId, expectedCorrelationId: run.correlationId });
    const updated = this.updateProviderStatus(run, status);
    this.applyProviderStatus(jobId, status);
    return updated;
  }

  private applyProviderStatus(jobId: EntityId, status: NormalizedProviderStatus): void {
    const job = this.jobs.requireById(jobId);
    if (status.state === "failed" && job.currentState !== "FAILED" && job.currentState !== "CANCELLED" && job.currentState !== "APPROVED") {
      this.failJob(jobId, status.error ?? `MoneyPrinterTurbo failed during ${status.failedStage ?? "production"}`);
      return;
    }
    if (status.state === "succeeded" && job.currentState === "RENDERING") this.transitionJob(jobId, "VALIDATING", "MoneyPrinterTurbo reported a completed provider render");
  }

  async getProductionArtifacts(jobId: EntityId, provider: ProductionProvider): Promise<MediaAsset[]> {
    const run = this.providerRuns.getByJobId(jobId);
    if (!run?.remoteTaskId) throw new ConflictError("A provider task reference is required before artifact discovery", { jobId });
    const reference: ProviderTaskReference = { provider: run.provider, remoteTaskId: run.remoteTaskId, correlationId: run.correlationId };
    const artifacts = await provider.getProductionArtifacts(reference);
    return artifacts.map((artifact) => this.registerProviderArtifact(jobId, artifact));
  }

  async cancelProduction(jobId: EntityId, provider: ProductionProvider): Promise<ProviderCancellation> {
    const run = this.providerRuns.getByJobId(jobId);
    if (!run?.remoteTaskId) throw new ConflictError("A provider task reference is required before cancellation", { jobId });
    const result = await provider.cancelProduction({ provider: run.provider, remoteTaskId: run.remoteTaskId, correlationId: run.correlationId });
    if (result.state === "unsupported") this.providerRuns.update(run.id, { state: run.state, cancelRequestedAt: new Date().toISOString(), error: result.detail, providerPayload: run.providerPayload });
    return result;
  }

  async resolveUnknownProviderRun(jobId: EntityId, decision: ProviderResolutionDecision, receipt: ProviderResolutionReceipt, provider: ProductionProvider, options: { remoteTaskId?: string; note?: string } = {}): Promise<ProductionProviderRun> {
    const run = this.providerRuns.getByJobId(jobId);
    if (!run || run.state !== "unknown") throw new ConflictError("Only an UNKNOWN provider attempt can be resolved", { jobId });
    if (!this.options.resolutionVerifier) throw new ApprovalRequiredError("No provider-resolution authority is configured", { jobId, attemptId: run.attemptId });
    this.options.resolutionVerifier.verify(receipt, { productionJobId: jobId, attemptId: run.attemptId, expectedRevision: run.resolutionRevision, decision });
    if (this.providerRuns.listResolutions(run.attemptId).some((record) => record.expectedRevision === run.resolutionRevision && record.decision === decision)) throw new ConflictError("Provider resolution has already been recorded for this attempt and decision", { jobId, attemptId: run.attemptId, decision });
    if (decision === "attach_existing") {
      if (!options.remoteTaskId) throw new ConflictError("Attaching an existing provider task requires its remote task ID", { jobId });
      const status = await provider.getProductionStatus({ provider: run.provider, remoteTaskId: options.remoteTaskId, correlationId: run.correlationId });
      if (status.providerPayload.request_id !== run.correlationId) throw new ConflictError("Provider task could not be verified against the original correlation ID", { jobId, attemptId: run.attemptId });
      const record = this.providerRuns.createResolution({ attemptId: run.attemptId, productionJobId: jobId, decision, expectedRevision: run.resolutionRevision, operatorId: receipt.operatorId, note: options.note, consumedAt: new Date().toISOString() });
      void record;
      return this.updateProviderStatus(run, status);
    }
    this.providerRuns.createResolution({ attemptId: run.attemptId, productionJobId: jobId, decision, expectedRevision: run.resolutionRevision, operatorId: receipt.operatorId, note: options.note, consumedAt: decision === "authorize_retry" ? undefined : new Date().toISOString() });
    return run;
  }

  private updateProviderStatus(run: ProductionProviderRun, status: NormalizedProviderStatus): ProductionProviderRun {
    return this.providerRuns.update(run.id, { state: status.state, remoteTaskId: status.reference.remoteTaskId, providerStatus: status.providerStatus, lastPolledAt: new Date().toISOString(), error: status.error, providerPayload: status.providerPayload });
  }

  private registerProviderArtifact(jobId: EntityId, artifact: ProviderArtifact): MediaAsset {
    const run = this.providerRuns.getByJobId(jobId);
    if (!run?.remoteTaskId || artifact.provenance.provider !== run.provider || artifact.provenance.remoteTaskId !== run.remoteTaskId || artifact.provenance.correlationId !== run.correlationId || artifact.provenance.providerPath !== artifact.providerPath) throw new ConflictError("Provider artifact provenance does not match the persisted provider attempt", { jobId, relativePath: artifact.relativePath });
    const existing = this.assets.getByJobAndPath(jobId, artifact.relativePath);
    if (existing) return existing;
    return this.recordArtifact({ productionJobId: jobId, type: artifact.kind, relativePath: artifact.relativePath, mimeType: artifact.mimeType, sha256: artifact.sha256, byteSize: artifact.byteSize, sourceProvider: "moneyprinterturbo", sourceMetadata: { ...artifact.sourceMetadata, provenance: artifact.provenance }, rightsStatus: "pending", isSynthetic: false });
  }

  private reviewFingerprint(jobId: string): { fingerprint: string; artifactIds: string[] } {
    const job = this.jobs.requireById(jobId);
    const artifactIds = [...job.artifactIds].sort();
    const artifacts = this.assets.listByJob(jobId).map((asset) => ({ id: asset.id, sha256: asset.sha256, validationStatus: asset.validationStatus, isSynthetic: asset.isSynthetic })).sort((a, b) => a.id.localeCompare(b.id));
    return { artifactIds, fingerprint: fingerprint({ jobId, state: job.currentState, artifacts }) };
  }

  recordHumanApproval(input: Omit<CreateApprovalRecordInput, "reviewFingerprint" | "artifactIds" | "decision"> & { decision?: "approved" | "rejected" | "pending" }, receipt: HumanApprovalReceipt): ApprovalRecord {
    if (!this.options.approvalVerifier) throw new ApprovalRequiredError("No human approval authority is configured", { productionJobId: input.productionJobId });
    const job = this.jobs.requireById(input.productionJobId);
    if (job.currentState !== "REVIEW") throw new ApprovalRequiredError("Human approvals require a job in REVIEW", { productionJobId: job.id });
    const revision = this.reviewFingerprint(job.id);
    this.options.approvalVerifier.verify(receipt, { productionJobId: job.id, reviewFingerprint: revision.fingerprint, artifactIds: revision.artifactIds });
    const value = CreateApprovalRecordSchema.parse({ ...input, reviewFingerprint: revision.fingerprint, artifactIds: revision.artifactIds, decision: input.decision ?? "approved" });
    if (value.decision === "approved" && (!this.assets.hasTrustedValidatedRender(job.id) || value.factualReview === "failed" || value.factualReview === "pending" || value.rightsReview === "failed" || value.rightsReview === "pending" || value.qualityReview !== "passed")) throw new ApprovalRequiredError("Approved human review requires trusted output and passed review checks", { productionJobId: job.id });
    return this.approvals.create(value);
  }

  approveJob(jobId: EntityId): ProductionJob {
    const job = this.jobs.requireById(jobId);
    const revision = this.reviewFingerprint(jobId);
    if (job.currentState !== "REVIEW" || !this.approvals.hasApproved(jobId, revision.fingerprint, revision.artifactIds)) throw new ApprovalRequiredError("A current, authority-bound human approval is required", { jobId });
    return this.jobs.transition(jobId, "REVIEW", "APPROVED", "authority-bound human approval recorded");
  }

  failJob(jobId: EntityId, error: string): ProductionJob {
    const job = this.jobs.requireById(jobId);
    if (!error.trim()) throw new ConflictError("Failure reason cannot be empty", { jobId });
    if (job.currentState === "APPROVED" || job.currentState === "CANCELLED") throw new ConflictError("Terminal job cannot be failed", { jobId });
    if (job.currentState === "FAILED") return this.jobs.updateError(jobId, error);
    assertLegalTransition(job.currentState, "FAILED");
    return this.jobs.transition(jobId, job.currentState, "FAILED", "production failed", error, "runtime_failure");
  }

  recoverInterruptedJobs(): ProductionJob[] {
    return this.jobs.listActive().map((job) => {
      const recovered = this.jobs.transition(job.id, job.currentState, "FAILED", "process interruption recovery", `Interrupted during ${job.currentState}`, "interrupted");
      const run = this.providerRuns.getByJobId(job.id);
      if (run && ["submitting", "accepted", "processing"].includes(run.state)) this.providerRuns.update(run.id, { state: "unknown", error: "ChannelForge recovered an interrupted provider task; outcome requires reconciliation", providerPayload: run.providerPayload });
      return recovered;
    });
  }

  recoverFailedJob(jobId: EntityId): ProductionJob {
    const job = this.jobs.requireById(jobId);
    if (job.currentState !== "FAILED") throw new ConflictError("Only FAILED jobs can be recovered", { jobId });
    return this.jobs.transition(jobId, "FAILED", "PLANNING", "manual recovery requested");
  }

  getJob(jobId: EntityId): ProductionJob { return this.jobs.requireById(jobId); }
  getBrief(briefId: EntityId): ContentBrief { return this.briefs.requireById(briefId); }
  getJobHistory(jobId: EntityId) { this.jobs.requireById(jobId); return this.jobs.getHistory(jobId); }
  listChannelJobs(channelId: EntityId): ProductionJob[] { this.channels.requireById(channelId); return this.jobs.listByChannel(channelId); }
  isJobActive(jobId: EntityId): boolean { return isActiveProductionState(this.jobs.requireById(jobId).currentState); }
  close(): void { this.db.close(); }
}
