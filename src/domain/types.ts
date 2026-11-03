export const SCHEMA_VERSION = 1 as const;

export type SchemaVersion = typeof SCHEMA_VERSION;
export type EntityId = string;
export type IsoDate = string;

export interface PersistedRecord {
  id: EntityId;
  schemaVersion: SchemaVersion;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface ChannelProfile extends PersistedRecord {
  slug: string;
  platform: "youtube";
  locale: string;
  audience: string;
  contentPillars: string[];
  brand: { voice: string; visualStyle: string; bannedTopics: string[] };
  policy: {
    defaultPrivacy: "private" | "unlisted" | "public";
    humanApprovalRequired: true;
    factualReviewRequired: boolean;
    rightsReviewRequired: boolean;
  };
  credentialsRef: { youtube: string };
  status: "active" | "paused" | "archived";
}

export interface ContentBrief extends PersistedRecord {
  channelId: EntityId;
  topic: string;
  angle: string;
  hook: string;
  format: "short" | "long_form";
  language: string;
  aspectRatio: "9:16" | "16:9" | "1:1";
  targetDurationSec: number;
  audiencePromise: string;
  contentPillars: string[];
  claimIds: EntityId[];
  evidenceIds: EntityId[];
  status: "draft" | "researched" | "ready" | "rejected";
}

export interface ResearchEvidence extends PersistedRecord {
  briefId: EntityId;
  sourceType: "youtube" | "official_site" | "dataset" | "article" | "license";
  locator: string;
  title: string;
  publisher: string;
  capturedAt: IsoDate;
  excerpt: string;
  claimIds: EntityId[];
  verification: "unreviewed" | "verified" | "rejected";
  rightsNote?: string;
}

export interface Script extends PersistedRecord {
  briefId: EntityId;
  language: string;
  title: string;
  beats: Array<{
    id: string;
    kind: "hook" | "setup" | "stakes" | "payoff" | "cta";
    text: string;
    targetDurationSec: number;
    claimIds: EntityId[];
  }>;
  wordCount: number;
  targetDurationSec: number;
  status: "draft" | "reviewed" | "approved" | "rejected";
}

export interface SceneManifest extends PersistedRecord {
  scriptId: EntityId;
  aspectRatio: "9:16" | "16:9" | "1:1";
  scenes: Array<{
    id: string;
    order: number;
    narration: string;
    expectedDurationSec: number;
    visualDirection: string;
    assetRequirements: string[];
    captionText: string;
    claimIds: EntityId[];
  }>;
  status: "draft" | "ready" | "rendered" | "superseded";
}

export type ArtifactType = "video" | "image" | "audio" | "caption" | "render";
export type RightsReviewStatus = "pending" | "verified" | "waived" | "rejected";
export type ArtifactValidationStatus = "unvalidated" | "validated" | "invalid";

export interface MediaAsset extends PersistedRecord {
  productionJobId: EntityId;
  sceneId?: string;
  type: ArtifactType;
  relativePath: string;
  mimeType: string;
  sha256: string;
  byteSize: number;
  durationSec?: number;
  width?: number;
  height?: number;
  sourceProvider: string;
  sourceMetadata: Record<string, unknown>;
  rightsStatus: RightsReviewStatus;
  validationStatus: ArtifactValidationStatus;
  validationEvidence?: Record<string, unknown>;
  isSynthetic: boolean;
}

export const PRODUCTION_JOB_STATES = [
  "CREATED",
  "PLANNING",
  "NARRATING",
  "SOURCING",
  "CAPTIONING",
  "RENDERING",
  "VALIDATING",
  "REVIEW",
  "APPROVED",
  "FAILED",
  "CANCELLED"
] as const;

export type ProductionJobState = (typeof PRODUCTION_JOB_STATES)[number];
export type FailureKind = "runtime_failure" | "interrupted";

export type ProviderName = "moneyprinterturbo";
export type ProviderRunState = "submitting" | "accepted" | "processing" | "succeeded" | "failed" | "unknown";
export type ProviderResolutionDecision = "attach_existing" | "preserve_unknown" | "authorize_retry";

export interface ProductionJob extends PersistedRecord {
  channelId: EntityId;
  briefId: EntityId;
  renderer: string;
  currentState: ProductionJobState;
  stageStates: Record<string, "pending" | "running" | "succeeded" | "failed" | "skipped">;
  artifactIds: EntityId[];
  idempotencyKey: string;
  payloadFingerprint: string;
  lastError?: string;
  failureKind?: FailureKind;
  interruptedAt?: IsoDate;
}

export interface ProductionProviderRun extends PersistedRecord {
  productionJobId: EntityId;
  provider: ProviderName;
  correlationId: string;
  remoteTaskId?: string;
  state: ProviderRunState;
  providerStatus?: number;
  requestFingerprint: string;
  submittedAt: IsoDate;
  lastPolledAt?: IsoDate;
  cancelRequestedAt?: IsoDate;
  error?: string;
  providerPayload: Record<string, unknown>;
  attemptId: EntityId;
  attemptNumber: number;
  resolutionRevision: string;
}

export interface ProductionProviderAttempt extends PersistedRecord {
  productionJobId: EntityId;
  provider: ProviderName;
  attemptNumber: number;
  correlationId: string;
  remoteTaskId?: string;
  state: ProviderRunState;
  providerStatus?: number;
  requestFingerprint: string;
  submittedAt: IsoDate;
  lastPolledAt?: IsoDate;
  cancelRequestedAt?: IsoDate;
  error?: string;
  providerPayload: Record<string, unknown>;
  resolutionRevision: string;
  acknowledgedDuplicateRisk: boolean;
}

export interface ProviderResolutionRecord extends PersistedRecord {
  attemptId: EntityId;
  productionJobId: EntityId;
  decision: ProviderResolutionDecision;
  expectedRevision: string;
  operatorId: string;
  note?: string;
  consumedAt?: IsoDate;
}

export interface JobTransition {
  id: number;
  jobId: EntityId;
  fromState?: ProductionJobState;
  toState: ProductionJobState;
  reason?: string;
  error?: string;
  createdAt: IsoDate;
}

export interface ApprovalRecord extends PersistedRecord {
  productionJobId: EntityId;
  reviewer: string;
  reviewFingerprint: string;
  artifactIds: EntityId[];
  factualReview: "pending" | "passed" | "waived" | "failed";
  rightsReview: "pending" | "passed" | "waived" | "failed";
  qualityReview: "pending" | "passed" | "failed";
  decision: "pending" | "approved" | "rejected";
  note?: string;
  decidedAt?: IsoDate;
}

export interface PublishingRecord extends PersistedRecord {
  productionJobId: EntityId;
  channelId: EntityId;
  platform: "youtube";
  status: "planned" | "queued" | "uploading" | "reconciliation_required" | "published" | "failed";
  privacyStatus: "private" | "unlisted" | "public";
  scheduledFor?: IsoDate;
  remoteVideoId?: string;
  remoteUrl?: string;
  idempotencyKey: string;
  reconciliationRequired: boolean;
  publishedAt?: IsoDate;
  error?: string;
}

export interface AnalyticsSnapshot extends PersistedRecord {
  channelId: EntityId;
  publishingRecordId: EntityId;
  window: "24h" | "7d" | "rolling";
  source: "youtube_analytics";
  verified: boolean;
  capturedAt: IsoDate;
  metrics: {
    views: number | null;
    impressions: number | null;
    ctr: number | null;
    watchTimeMinutes: number | null;
    averageViewPercentage: number | null;
    subscribersGained: number | null;
    subscribersLost: number | null;
    estimatedRevenue: number | null;
  };
}
