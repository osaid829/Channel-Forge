# ChannelForge Decisions

## Approved architecture

Option C — Modular Hybrid.

ChannelForge owns canonical state, SQLite persistence, job orchestration,
approvals, provenance, and provider interfaces.

MoneyPrinterTurbo owns rendering, narration, composition, and captions through
an adapter that is not implemented in this milestone.

AgentTube contributes research, YouTube safeguards, publishing, and analytics
capabilities through future adapters.

OpenClaw is an optional future automation coordinator and is not installed or
integrated in this milestone.

## Domain-core decisions

- SQLite is the local source of truth.
- Idempotency keys are persisted and globally unique.
- Only the production service may change production state.
- State transitions and transition history are written atomically.
- Artifacts begin unvalidated.
- Trusted validation evidence is required before review.
- Human approvals are bound to the current production revision and artifact
  checksums.
- Synthetic and test validation cannot authorize a production approval.
