import Database from "better-sqlite3";

type SqliteConnection = InstanceType<typeof Database>;

export interface SqliteRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_profiles (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform = 'youtube'),
  locale TEXT NOT NULL,
  audience TEXT NOT NULL,
  content_pillars_json TEXT NOT NULL,
  brand_json TEXT NOT NULL,
  policy_json TEXT NOT NULL,
  credentials_ref_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS content_briefs (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  channel_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  angle TEXT NOT NULL,
  hook TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('short', 'long_form')),
  language TEXT NOT NULL,
  aspect_ratio TEXT NOT NULL CHECK (aspect_ratio IN ('9:16', '16:9', '1:1')),
  target_duration_sec INTEGER NOT NULL CHECK (target_duration_sec > 0),
  audience_promise TEXT NOT NULL,
  content_pillars_json TEXT NOT NULL,
  claim_ids_json TEXT NOT NULL,
  evidence_ids_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'researched', 'ready', 'rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (channel_id) REFERENCES channel_profiles(id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS production_jobs (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  channel_id TEXT NOT NULL,
  brief_id TEXT NOT NULL,
  renderer TEXT NOT NULL,
  current_state TEXT NOT NULL CHECK (current_state IN (
    'CREATED', 'PLANNING', 'NARRATING', 'SOURCING', 'CAPTIONING',
    'RENDERING', 'VALIDATING', 'REVIEW', 'APPROVED', 'FAILED', 'CANCELLED'
  )),
  stage_states_json TEXT NOT NULL,
  artifact_ids_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_fingerprint TEXT NOT NULL,
  last_error TEXT,
  failure_kind TEXT CHECK (failure_kind IN ('runtime_failure', 'interrupted')),
  interrupted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (channel_id) REFERENCES channel_profiles(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (brief_id) REFERENCES content_briefs(id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  production_job_id TEXT NOT NULL,
  scene_id TEXT,
  artifact_type TEXT NOT NULL CHECK (artifact_type IN ('video', 'image', 'audio', 'caption', 'render')),
  relative_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  duration_sec REAL,
  width INTEGER,
  height INTEGER,
  source_provider TEXT NOT NULL,
  source_metadata_json TEXT NOT NULL,
  rights_status TEXT NOT NULL CHECK (rights_status IN ('pending', 'verified', 'waived', 'rejected')),
  validation_status TEXT NOT NULL CHECK (validation_status IN ('unvalidated', 'validated', 'invalid')),
  validation_evidence_json TEXT,
  is_synthetic INTEGER NOT NULL CHECK (is_synthetic IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (production_job_id, relative_path),
  FOREIGN KEY (production_job_id) REFERENCES production_jobs(id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS approval_records (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  production_job_id TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  review_fingerprint TEXT NOT NULL,
  artifact_ids_json TEXT NOT NULL,
  factual_review TEXT NOT NULL CHECK (factual_review IN ('pending', 'passed', 'waived', 'failed')),
  rights_review TEXT NOT NULL CHECK (rights_review IN ('pending', 'passed', 'waived', 'failed')),
  quality_review TEXT NOT NULL CHECK (quality_review IN ('pending', 'passed', 'failed')),
  decision TEXT NOT NULL CHECK (decision IN ('pending', 'approved', 'rejected')),
  note TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (production_job_id) REFERENCES production_jobs(id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS job_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  reason TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES production_jobs(id)
    ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_briefs_channel_id ON content_briefs(channel_id);
CREATE INDEX IF NOT EXISTS idx_jobs_channel_id ON production_jobs(channel_id);
CREATE INDEX IF NOT EXISTS idx_jobs_brief_id ON production_jobs(brief_id);
CREATE INDEX IF NOT EXISTS idx_jobs_state ON production_jobs(current_state);
CREATE INDEX IF NOT EXISTS idx_assets_job_id ON media_assets(production_job_id);
CREATE INDEX IF NOT EXISTS idx_approvals_job_id ON approval_records(production_job_id);
CREATE INDEX IF NOT EXISTS idx_transitions_job_id ON job_transitions(job_id);
`;

const PROVIDER_RUN_MIGRATION = `
CREATE TABLE IF NOT EXISTS production_provider_runs (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  production_job_id TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL CHECK (provider = 'moneyprinterturbo'),
  correlation_id TEXT NOT NULL UNIQUE,
  remote_task_id TEXT UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('submitting', 'accepted', 'processing', 'succeeded', 'failed', 'unknown')),
  provider_status INTEGER,
  request_fingerprint TEXT NOT NULL CHECK (length(request_fingerprint) = 64),
  submitted_at TEXT NOT NULL,
  last_polled_at TEXT,
  cancel_requested_at TEXT,
  error TEXT,
  provider_payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (production_job_id) REFERENCES production_jobs(id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_provider_runs_state ON production_provider_runs(state);
CREATE INDEX IF NOT EXISTS idx_provider_runs_remote_task_id ON production_provider_runs(remote_task_id);
`;

const PROVIDER_ATTEMPT_MIGRATION = `
CREATE TABLE IF NOT EXISTS production_provider_attempts (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  production_job_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider = 'moneyprinterturbo'),
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  correlation_id TEXT NOT NULL UNIQUE,
  remote_task_id TEXT UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('submitting', 'accepted', 'processing', 'succeeded', 'failed', 'unknown')),
  provider_status INTEGER,
  request_fingerprint TEXT NOT NULL CHECK (length(request_fingerprint) = 64),
  submitted_at TEXT NOT NULL,
  last_polled_at TEXT,
  cancel_requested_at TEXT,
  error TEXT,
  provider_payload_json TEXT NOT NULL,
  resolution_revision TEXT NOT NULL CHECK (length(resolution_revision) = 64),
  acknowledged_duplicate_risk INTEGER NOT NULL CHECK (acknowledged_duplicate_risk IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (production_job_id, attempt_number),
  FOREIGN KEY (production_job_id) REFERENCES production_jobs(id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS provider_resolution_records (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  attempt_id TEXT NOT NULL,
  production_job_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('attach_existing', 'preserve_unknown', 'authorize_retry')),
  expected_revision TEXT NOT NULL CHECK (length(expected_revision) = 64),
  operator_id TEXT NOT NULL,
  note TEXT,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (attempt_id) REFERENCES production_provider_attempts(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (production_job_id) REFERENCES production_jobs(id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

ALTER TABLE production_provider_runs ADD COLUMN current_attempt_id TEXT;

INSERT INTO production_provider_attempts (
  id, schema_version, production_job_id, provider, attempt_number, correlation_id,
  remote_task_id, state, provider_status, request_fingerprint, submitted_at,
  last_polled_at, cancel_requested_at, error, provider_payload_json,
  resolution_revision, acknowledged_duplicate_risk, created_at, updated_at
)
SELECT
  lower(hex(randomblob(16))), schema_version, production_job_id, provider, 1,
  correlation_id, remote_task_id, state, provider_status, request_fingerprint,
  submitted_at, last_polled_at, cancel_requested_at, error, provider_payload_json,
  request_fingerprint, 0, created_at, updated_at
FROM production_provider_runs
WHERE NOT EXISTS (
  SELECT 1 FROM production_provider_attempts a
  WHERE a.production_job_id = production_provider_runs.production_job_id
);

UPDATE production_provider_runs
SET current_attempt_id = (
  SELECT a.id FROM production_provider_attempts a
  WHERE a.production_job_id = production_provider_runs.production_job_id
  ORDER BY a.attempt_number DESC LIMIT 1
)
WHERE current_attempt_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_provider_attempts_job_id ON production_provider_attempts(production_job_id);
CREATE INDEX IF NOT EXISTS idx_provider_attempts_state ON production_provider_attempts(state);
CREATE INDEX IF NOT EXISTS idx_provider_resolutions_attempt_id ON provider_resolution_records(attempt_id);
`;

export class SqliteDatabase {
  private readonly connection: SqliteConnection;

  constructor(filename: string) {
    this.connection = new Database(filename);
    this.connection.pragma("foreign_keys = ON");

    if (filename !== ":memory:") {
      this.connection.pragma("journal_mode = WAL");
      this.connection.pragma("synchronous = NORMAL");
    }

    this.connection.exec(SCHEMA);

    const migration = this.connection.prepare("SELECT version FROM schema_migrations WHERE version = 1").get() as { version: number } | undefined;
    if (!migration) this.connection.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(1, new Date().toISOString());

    const providerMigration = this.connection.prepare("SELECT version FROM schema_migrations WHERE version = 2").get() as { version: number } | undefined;
    if (!providerMigration) {
      this.connection.transaction(() => {
        this.connection.exec(PROVIDER_RUN_MIGRATION);
        this.connection.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(2, new Date().toISOString());
      })();
    }

    const attemptMigration = this.connection.prepare("SELECT version FROM schema_migrations WHERE version = 3").get() as { version: number } | undefined;
    if (!attemptMigration) {
      this.connection.transaction(() => {
        this.connection.exec(PROVIDER_ATTEMPT_MIGRATION);
        this.connection.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(3, new Date().toISOString());
      })();
    }
  }

  run(sql: string, params: unknown[] = []): SqliteRunResult {
    return this.connection.prepare(sql).run(...(params as never[])) as SqliteRunResult;
  }

  get<T>(sql: string, params: unknown[] = []): T | undefined {
    return this.connection.prepare(sql).get(...(params as never[])) as T | undefined;
  }

  all<T>(sql: string, params: unknown[] = []): T[] {
    return this.connection.prepare(sql).all(...(params as never[])) as T[];
  }

  transaction<T>(callback: () => T): T {
    return this.connection.transaction(callback)();
  }

  close(): void {
    if (this.connection.open) this.connection.close();
  }
}
