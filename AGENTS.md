# ChannelForge Agent Guidance

## Scope

ChannelForge is the canonical local-first control plane for the approved
Option C modular hybrid architecture.

ChannelForge owns:

- Domain contracts and SQLite state.
- Production orchestration and state transitions.
- Artifact provenance and validation evidence.
- Human approval records.
- Provider interfaces and idempotency.

MoneyPrinterTurbo, AgentTube, OpenClaw, and YouTube are integrations behind
explicit adapters. They must not become the canonical persistence layer.

## Safety

- Keep development local-first.
- Never store raw credentials in domain records or fixtures.
- Keep publishing private by default.
- Never treat synthetic or test artifacts as real production output.
- Never bypass the production service to mutate job state.
- Do not add external providers unless explicitly requested.
- Do not access unrelated projects.

## Verification

Use temporary SQLite databases for tests. Network access must remain disabled
for domain and persistence tests.
