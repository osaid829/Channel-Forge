# ChannelForge

**ChannelForge** is the canonical local-first control plane for the approved **Option C Modular Hybrid Architecture** for automated video production pipelines. It owns domain contracts, SQLite state, production orchestration, artifact provenance, validation evidence, and human approval records — while integrating with external providers (MoneyPrinterTurbo, AgentTube, OpenClaw, YouTube) through explicit adapters.

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CHANNELFORGE CONTROL PLANE                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   Domain    │  │ Persistence │  │ Orchestrat. │  │   Provenance &      │ │
│  │  Contracts  │  │  (SQLite)   │  │  (State     │  │   Validation        │ │
│  │  (Zod)      │  │             │  │   Machine)  │  │   Evidence          │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
│         │                │                │                      │           │
│         └────────────────┼────────────────┼──────────────────────┘           │
│                          ▼                ▼                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                    PRODUCTION SERVICE (Single Writer)                    │ │
│  │  • Job lifecycle (CREATED → PLANNING → ... → APPROVED)                  │ │
│  │  • Provider submission & polling (MoneyPrinterTurbo)                    │ │
│  │  • Artifact registration & trusted validation (FFprobe/FFmpeg)          │ │
│  │  • Human approval gates (bound to revision + checksums)                 │ │
│  │  • Provider UNKNOWN resolution (operator-bound decisions)               │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
       ┌─────────────┐      ┌─────────────┐      ┌─────────────┐
       │ MoneyPrinter│      │  AgentTube  │      │  OpenClaw   │
       │    Turbo    │      │  (Future)   │      │  (Future)   │
       │  (Adapter)  │      │  Adapter    │      │  Adapter    │
       └─────────────┘      └─────────────┘      └─────────────┘
              │                    │                    │
              ▼                    ▼                    ▼
       Rendering/Narration   Research/YouTube      Automation
       Composition/Captions  Safeguards/Publishing Coordination
```

---

## 📦 Current State (Implemented & Verified)

### ✅ Core Domain & Persistence
| Component | Status | Details |
|-----------|--------|---------|
| **Zod Domain Schemas** | ✅ Complete | Strict, validated input/output contracts for all entities |
| **SQLite Schema** | ✅ Complete | 8 tables with FK constraints, indexes, WAL mode, migrations v1-v3 |
| **Repository Layer** | ✅ Complete | Type-safe CRUD for ChannelProfile, ContentBrief, ProductionJob, MediaAsset, ApprovalRecord, ProviderRuns/Attempts/Resolutions |
| **Idempotency Keys** | ✅ Complete | Globally unique, payload-fingerprint verified |

### ✅ Production Orchestration
| Component | Status | Details |
|-----------|--------|---------|
| **Job State Machine** | ✅ Complete | 11 states (CREATED→PLANNING→NARRATING→SOURCING→CAPTIONING→RENDERING→VALIDATING→REVIEW→APPROVED, plus FAILED/CANCELLED) |
| **Legal Transitions** | ✅ Enforced | Compile-time + runtime validation; invalid transitions throw |
| **Production Service** | ✅ Complete | Single-writer pattern; owns all state mutations |
| **Stage Tracking** | ✅ Complete | Per-stage pending/running/succeeded/failed/skipped |
| **Interruption Recovery** | ✅ Complete | `recoverInterruptedJobs()` marks active jobs FAILED with `interrupted` kind; provider runs → UNKNOWN |

### ✅ Provider Integration (MoneyPrinterTurbo)
| Component | Status | Details |
|-----------|--------|---------|
| **Provider Contracts** | ✅ Complete | `ProductionProvider` interface: submit, poll, artifacts, cancel |
| **MoneyPrinterTurbo Adapter** | ✅ Complete | Authenticated loopback HTTP (127.0.0.1:8080); API key auth; idempotent submission with reconciliation |
| **Bounded Artifact Downloads** | ✅ Complete | Streaming to temp files; atomic rename; SHA-256 verification; path containment; size/time limits |
| **Provider Attempt History** | ✅ Complete | Append-only attempts table; resolution revision binding; acknowledged duplicate risk |
| **UNKNOWN Resolution** | ✅ Complete | Operator-bound decisions: `attach_existing`, `preserve_unknown`, `authorize_retry` with receipts |

### ✅ Artifact Provenance & Validation
| Component | Status | Details |
|-----------|--------|---------|
| **Media Asset Registration** | ✅ Complete | Type (render/video/audio/caption/image), SHA-256, MIME, dimensions, duration, provenance |
| **Trusted Validation Service** | ✅ Complete | FFprobe stream analysis + FFmpeg full decode; checksum + file identity verification |
| **Validation Evidence** | ✅ Complete | Structured `TrustedValidationEvidence` with 12 checks (container, codec, resolution, framerate, duration, audio, AV sync, decode, checksum, file identity, provenance) |
| **Visual Quality Gate** | ✅ Complete | Frame sampling + sharpness/entropy/contrast/luminance metrics; structured `VisualFrameAnalysis` |
| **Preflight Checks** | ✅ Complete | Local material validation (existence, readability, MIME, duration, resolution) |

### ✅ Human Approval Gates
| Component | Status | Details |
|-----------|--------|---------|
| **Approval Records** | ✅ Complete | Bound to production revision + artifact checksums; factual/rights/quality reviews |
| **Authority Verification** | ✅ Complete | `HumanApprovalVerifier` + `ProviderResolutionVerifier` interfaces; receipt-based |
| **Approval Policy** | ✅ Enforced | `humanApprovalRequired: true` hardcoded; synthetic/test artifacts rejected |

### ✅ Testing & Quality
| Component | Status | Details |
|-----------|--------|---------|
| **Test Suite** | ✅ 62 tests passing | Vitest; deterministic; temporary SQLite; no network access |
| **TypeScript** | ✅ Strict mode | `tsc --noEmit` passes; zero `any` in domain/services |
| **Test Coverage** | ✅ Comprehensive | State machine, repositories, adapter (mocked HTTP), validation, quality gate, preflight, submission harness, isolated runner |

---

## 📁 Project Structure

```
ChannelForge/
├── src/
│   ├── domain/
│   │   ├── types.ts              # Core domain types (251 lines)
│   │   ├── schemas.ts            # Zod validation schemas (177 lines)
│   │   ├── job-state-machine.ts  # State transitions (39 lines)
│   │   └── errors.ts             # Domain-specific error classes
│   ├── db/
│   │   ├── database.ts           # SQLite connection + migrations (300 lines)
│   │   └── repositories.ts       # Type-safe repositories (355 lines)
│   ├── services/
│   │   ├── production-service.ts           # Orchestration core (257 lines)
│   │   ├── production-provider.ts          # Provider contracts (147 lines)
│   │   ├── moneyprinterturbo-adapter.ts    # MPT adapter (407 lines)
│   │   ├── artifact-validation.ts          # FFprobe/FFmpeg validation (148 lines)
│   │   ├── visual-quality-gate.ts          # Frame quality analysis
│   │   ├── local-material-preflight.ts     # Input validation
│   │   ├── approval-boundary.ts            # Human approval interfaces
│   │   ├── provider-resolution-boundary.ts # UNKNOWN resolution
│   │   ├── submission-journal.ts           # Journaled submissions
│   │   ├── ffprobe-media-probe.ts          # Media inspection
│   │   ├── m5-isolated-runner.ts           # Isolated test runner
│   │   ├── m5-live-continuation.ts         # Live job continuation
│   │   └── journaled-submission-provider.ts
├── tests/
│   ├── production.test.ts                # Production service integration
│   ├── artifact-validation.test.ts       # Validation service
│   ├── moneyprinterturbo-adapter.test.ts # Adapter (mocked HTTP)
│   ├── visual-quality-gate.test.ts       # Quality metrics
│   ├── local-material-preflight.test.ts  # Preflight checks
│   ├── ffprobe-media-probe.test.ts       # Media probe
│   ├── submission-harness.test.ts        # Journaled submissions
│   └── m5-isolated-runner.test.ts        # Isolated runner
├── docs/
│   ├── PROJECT_STATUS.md                 # Session status log
│   ├── DECISIONS.md                      # Architecture decisions
│   ├── M5_NARRATION_QUALITY_EXPERIMENT.md
│   ├── M5_QWEN3_TTS_EXPERIMENT_REPORT.md
│   ├── M5_PHASE_C_FINAL_PRODUCTION_REPORT.md
│   ├── M5_PHASE_C_6F_I_REPORT.md
│   ├── M5_PHASE_C_HANDOFF.md
│   └── SESSION_HANDOFF.md
├── scripts/                              # Operational scripts
├── package.json
├── tsconfig.json
└── AGENTS.md                             # Agent guidance
```

---

## 🚀 Getting Started

### Prerequisites
- Node.js 22+
- pnpm (or npm)

### Installation
```bash
git clone https://github.com/osaid829/Channel-Forge.git
cd Channel-Forge
pnpm install
```

### Development Commands
```bash
# Type-check (strict)
pnpm run typecheck

# Run all tests (62 tests, ~1.7s)
pnpm test

# Watch mode for TDD
pnpm run test:watch
```

### Running the Control Plane
```bash
# 1. Start MoneyPrinterTurbo on localhost:8080 (separate process)
#    - Configure API key in MoneyPrinterTurbo config.toml
#    - Ensure loopback HTTP only (security requirement)

# 2. Initialize ChannelForge database
#    - Database file: m5-channel-forge.sqlite (or :memory: for tests)

# 3. Create channel profile, content brief, production job via ProductionService
#    - See tests/production.test.ts for usage patterns

# 4. Submit to MoneyPrinterTurbo via adapter
#    - Requires authenticated loopback transport

# 5. Poll for completion → validate artifacts → human review → approve
```

---

## 🔑 Key Design Principles

### 1. **Local-First Control Plane**
- Zero external dependencies for core orchestration
- SQLite as source of truth (portable, embedded, ACID)
- All state transitions auditable via `job_transitions` table

### 2. **Single-Writer Pattern**
- Only `ProductionService` mutates production state
- Repositories are private to the service
- Prevents race conditions and invariant violations

### 3. **Idempotency Everywhere**
- Production jobs keyed by `idempotencyKey` + `payloadFingerprint`
- Provider submissions reconciled by `correlationId`
- Artifact registration deduplicated by `production_job_id + relative_path`

### 4. **Provenance-Chain Validation**
- Every artifact carries `provenance: { provider, remoteTaskId, correlationId, providerPath }`
- Validation requires exact correlation match
- Synthetic/test artifacts flagged with `isSynthetic: true` and **rejected** from production approval

### 5. **Human-in-the-Loop by Default**
- `humanApprovalRequired: true` enforced at schema level
- Approvals bound to `(reviewFingerprint, artifactIds[])` — any artifact change invalidates prior approval
- Operator receipts required for UNKNOWN provider resolution

### 6. **Provider-Neutral Contracts**
- `ProductionProvider` interface decouples orchestration from implementation
- New providers (AgentTube, OpenClaw, custom) implement the same interface
- MoneyPrinterTurbo is **one** implementation, not the platform

---

## 🗺️ Roadmap: Target State

### Phase 1: Production Hardening (Current → Near-term)
| Feature | Description | Effort |
|---------|-------------|--------|
| **CLI Tooling** | `channelforge` CLI for job creation, submission, polling, approval | Medium |
| **Configuration System** | TOML/JSON config for data root, provider endpoints, timeouts | Low |
| **Metrics/Observability** | Structured logging, event emission, health endpoints | Medium |
| **Backup/Restore** | Automated SQLite backup with WAL checkpointing | Low |
| **Migration Tooling** | Schema migration runner with rollback support | Low |

### Phase 2: Provider Ecosystem
| Feature | Description | Effort |
|---------|-------------|--------|
| **AgentTube Adapter** | Research → YouTube safeguards → publishing → analytics | High |
| **YouTube Publishing Adapter** | OAuth2 flow, resumable upload, privacy controls, idempotency | High |
| **OpenClaw Adapter** | Optional automation coordinator integration | Medium |
| **Multi-Provider Routing** | Job-level provider selection, fallback chains | Medium |

### Phase 3: Content Pipeline Expansion
| Feature | Description | Effort |
|---------|-------------|--------|
| **Script Generation** | LLM-assisted script drafting from briefs | High |
| **Scene Manifest Pipeline** | Script → scene breakdown → visual direction → asset requirements | High |
| **Asset Sourcing** | Pexels/Pixabay/Coverr/local integration with rights tracking | Medium |
| **Narration/TTS** | Multi-voice, multi-language, SSML support | Medium |
| **Caption/Subtitle Pipeline** | SRT/VTT generation, translation, styling | Medium |

### Phase 4: Quality & Compliance
| Feature | Description | Effort |
|---------|-------------|--------|
| **Automated Factual Review** | Claim extraction + evidence matching + verification scoring | High |
| **Rights Management** | License tracking, attribution generation, clearance workflows | High |
| **Brand Compliance** | Voice/visual style enforcement, banned topic detection | Medium |
| **A/B Testing Framework** | Variant production, metric collection, statistical analysis | High |

### Phase 5: Scale & Operations
| Feature | Description | Effort |
|---------|-------------|--------|
| **Multi-Channel Management** | Channel profiles, defaults, bulk operations | Medium |
| **Scheduling/Queue** | Cron-like scheduling, priority queues, resource limits | Medium |
| **Distributed Workers** | Horizontal scaling of validation/download workers | High |
| **Audit/Compliance Export** | Immutable audit logs, GDPR/CCPA data export | Medium |

---

## 🧪 Testing Philosophy

```typescript
// Tests use temporary SQLite databases
const db = new SqliteDatabase(":memory:");

// Network access DISABLED for domain/persistence tests
// Provider tests use mocked HttpTransport
const adapter = new MoneyPrinterTurboAdapter({
  apiKey: "test-key",
  artifactRoot: "/tmp/test-artifacts",
  transport: mockTransport,  // In-memory, deterministic
});

// Validation tests use real FFprobe/FFmpeg on test fixtures
// (ffprobe-media-probe.test.ts validates against recovered M5 files)
```

**Run tests:** `pnpm test` — 62 tests, 0 flaky, ~1.7s

---

## 🔒 Security Model

| Threat | Mitigation |
|--------|------------|
| **Credential leakage** | No raw credentials in DB; `credentialsRef` points to external secret store |
| **Path traversal** | `assertSafeRelativePath()` on all artifact paths; `contains(root, dest)` checks |
| **Symlink attacks** | `lstatSync` + `realpathSync` validation; refuse symlinks |
| **TOCTOU on artifacts** | Open → fstat → read → fstat; verify dev/ino/size/mtime unchanged |
| **Provider spoofing** | Loopback-only URLs; API key in header; correlationId verification |
| **Replay attacks** | Idempotency keys + payload fingerprints + resolution revisions |
| **Synthetic data in prod** | `isSynthetic` flag; rejected by validation service and approval gate |

---

## 📊 Database Schema (v3)

```sql
-- Core domain
channel_profiles        -- YouTube channel configuration
content_briefs          -- Video topic/angle/format specifications
production_jobs         -- Job lifecycle + stage tracking
media_assets            -- Artifacts with provenance + validation evidence
approval_records        -- Human reviews bound to revision + checksums
job_transitions         -- Immutable state transition log

-- Provider integration (v2-v3)
production_provider_runs      -- Current provider run (1 per job)
production_provider_attempts  -- Append-only attempt history
provider_resolution_records   -- Operator decisions for UNKNOWN runs
```

**Migrations:** Automatic on `SqliteDatabase` construction; versioned in `schema_migrations` table.

---

## 🤝 Contributing

1. **Read** `AGENTS.md` and `docs/DECISIONS.md` for architectural constraints
2. **Run** `pnpm run typecheck && pnpm test` before committing
3. **Follow** the single-writer pattern — only `ProductionService` mutates state
4. **Add tests** for new domain logic (deterministic, no network)
5. **Keep** providers behind the `ProductionProvider` interface

---

## 📄 License

MIT License — see `LICENSE` file (inherited from MoneyPrinterTurbo subdirectory).

---

## 🔗 Related Projects

- **MoneyPrinterTurbo** — Rendering/narration provider (subdirectory, separate repo)
- **AgentTube** — Future: Research/YouTube/publishing adapter
- **OpenClaw** — Future: Automation coordinator adapter

---

## 📝 Session History

See `docs/` for detailed session logs:
- `PROJECT_STATUS.md` — Current checkpoint status
- `DECISIONS.md` — Architecture decisions (Option C)
- `M5_PHASE_C_FINAL_PRODUCTION_REPORT.md` — Latest production run details
- `SESSION_HANDOFF.md` — Context for continuation

---

**ChannelForge** — Local-first, auditable, human-governed video production control plane.