# ChannelForge — M5 Phase C Handoff

## Current checkpoint

**Milestone:** M5 Phase C — First Real MP4 Production  
**Workspace:** `/Users/osaid/Documents/ChannelForge`  
**Last completed operation:** Operation 6D-B — authorized replacement production submission  
**Current next step:** Separately authorized provider polling; do not submit again.

## Authoritative current state

Operation 6D-B completed successfully through the existing
`ProductionService.submitProduction()` path.

| Record | Current value |
|---|---|
| Canonical job | `m5-sky-blue-job` |
| Job state | `RENDERING` |
| Provider | `moneyprinterturbo` |
| Provider run ID | `64dbc0ea-b86f-4bda-a8ee-6ff7fec53d5f` |
| Provider run state | `accepted` |
| Provider task ID | `fecf2a82-877e-418d-8625-a7a7aaffb194` |
| Attempt count | `2` |
| Attempt 1 ID | `0d93cc0b-d8a4-41aa-8b7d-d21eb5a6ecf8` |
| Attempt 1 state | `unknown` |
| Attempt 1 correlation ID | `channelforge-m5-sky-blue-job-attempt-1` |
| Attempt 2 correlation ID | `channelforge-m5-sky-blue-job-attempt-2` |
| Retry resolution ID | `7b230d3b-39df-4ceb-94d2-3eccb4c37373` |
| Retry authorization | consumed: `YES` |
| Duplicate risk | acknowledged: `YES` |

The Operation 6D-B output did not print the generated attempt-2 database ID
or its separate row state. Do not infer either value from the provider run
alone. Obtain them through a separately authorized read-only inspection if
needed.

## Production request

- Topic: `Why is the sky blue?`
- Aspect ratio: `9:16`
- Target duration: `24` seconds
- Video source: local
- Registered material: `9ea6776fa37842d1be8ef1846019e15c.mp4`
- Voice alias: `kokoro:af_heart`
- Actual narrator: macOS Samantha
- Subtitles: disabled
- Background music: disabled
- Output count: `1`
- Rendering threads: `1`

The request fingerprint was checked against the original provider run before
the replacement submission.

## Services at the last successful check

These are historical observations and must be reverified before any future
runtime operation:

- MoneyPrinterTurbo: PID `13747`, `127.0.0.1:8080`, authenticated readiness passed.
- Samantha speech bridge: PID `15926`, `127.0.0.1:8880`, connectivity passed.

The last submission command independently passed:

- Authenticated MoneyPrinterTurbo task-list readiness.
- Samantha TCP connectivity without synthesis.
- Local material regular-file/nonempty check: `39,639` bytes.
- Identifiable concurrent ChannelForge writer check: `0` found.

## Completed recovery history

1. Runner compiled successfully with 0 TypeScript errors and 0 warnings.
2. Import-time safety review completed.
3. Schema dry-run passed.
4. Canonical database prepared.
5. Services recovered and readiness verified.
6. Canonical job/material preflight passed.
7. Initial submission persisted attempt 1 and was interrupted by the harness.
8. Read-only SQLite inspection found job `RENDERING`, provider run `submitting`,
   attempt 1 `submitting`, and no remote task ID.
9. Provider task-list reconciliation returned zero tasks; outcome remained uncertain.
10. Local log/task-artifact inspection found no acceptance evidence.
11. Operation 6A recovered the interrupted job:
    - job `RENDERING -> FAILED`
    - provider run `submitting -> unknown`
12. Operation 6B recovered the job:
    - job `FAILED -> PLANNING`
13. Operation 6C persisted the authority-bound, unconsumed `authorize_retry`
    resolution for the exact attempt and revision.
14. Operation 6D-A advanced the job:
    - `PLANNING -> NARRATING -> SOURCING -> CAPTIONING -> RENDERING`
15. Operation 6D-B consumed the retry authorization and created/submitted
    attempt 2 through `ProductionService.submitProduction()` exactly once.

## Required next-session procedure

Resume at **provider polling**, not submission.

Before polling, request separate authorization for a bounded verification of
the current database/provider-run state and service readiness if required by
the owner. Treat the recorded service PIDs as historical until verified.

Then request separate authorization for exactly one polling operation using:

- Job: `m5-sky-blue-job`
- Provider task ID: `fecf2a82-877e-418d-8625-a7a7aaffb194`
- Current provider-run state: `accepted`
- Expected active correlation: `channelforge-m5-sky-blue-job-attempt-2`

Use `ProductionService.pollProduction()` and the existing
`MoneyPrinterTurboAdapter.getProductionStatus()` path. Do not call the
provider status endpoint directly if the owner authorizes application-level
polling.

After a successful provider status observation, continue only with separate
authorization for artifact retrieval, then MP4 integrity/metadata validation.
Do not approve, publish, or shut down services automatically.

## Hard constraints

- Never rerun `--submit` for this job.
- Do not create another job or upload the material again.
- Do not retry automatically after `unknown`.
- Preserve attempt 1 and its unknown outcome.
- Do not manually edit SQLite.
- Do not bypass `ProductionService`.
- Do not publish to YouTube or any other platform.
- Do not install or integrate OpenMontage or the YouTube Agent Skill during M5.
- Keep human review and publishing approval boundaries intact.

## Suggested opening message for the next session

> Continue ChannelForge M5 Phase C from `docs/M5_PHASE_C_HANDOFF.md`. Operation
> 6D-B submitted the sanctioned replacement attempt once and received provider
> task `fecf2a82-877e-418d-8625-a7a7aaffb194`; the canonical job is still
> `RENDERING` and the provider run is `accepted`. Do not submit again. Prepare
> the next separately authorized read-only/current-readiness check and then
> the `ProductionService.pollProduction()` operation. Preserve attempt 1,
> respect the UNKNOWN history, and stop after each authorized operation.
