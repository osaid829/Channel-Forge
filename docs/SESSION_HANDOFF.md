# Session Handoff

## Current milestone

The domain core and mocked MoneyPrinterTurbo integration are implemented.
Session 04 established a verified checkpoint of 23 passing tests with no
failures or skips under a single forked worker. Session 04B hardening changes
are implemented but require fresh authorized verification.

## Required next commands

Run individually and obtain approval before each command. The next command is
typechecking; tests require separate authorization after it succeeds:

```bash
npm run typecheck
npm test
```

Tests must run with network access disabled and use temporary databases.

## Next milestone after verification

Review the fresh Session 04B typecheck and mocked-test results, then authorize
any separate operation needed to install or start MoneyPrinterTurbo. Do not
install OpenClaw or connect YouTube.

## M5 validation state

The trusted runtime media probe now has a production `FfprobeMediaProbe` and
FFmpeg decode/loudness implementation. It checks stream facts, codecs,
resolution, frame rate, duration, required narration audio, A/V duration
compatibility, non-silent audio, checksums, file identity, and provider
provenance. `ProductionService.validateProduction()` is the explicit local
workflow step from `VALIDATING` to `REVIEW`; provider success alone never makes
a job reviewable.

The successful M5 live artifacts were validated offline against immutable files
with no database mutation. The live database remains `VALIDATING` with
unvalidated assets because no service-level validation transition was authorized.

The final acceptance preparation attempted the authorized service-level validation
after creating `m5-6f-live.94N1uK/isolated-channel-forge.pre-acceptance-20261014.sqlite`.
It stopped safely because the older live asset records have flat provider metadata
without the required persisted correlation provenance. The database remains
`VALIDATING` with three unvalidated assets; no approval or provider operation was
performed.

The artifact validator uses bounded-memory streaming checksums. The provider
adapter also streams downloads into uniquely created temporary files and
atomically finalizes immutable artifacts, subject to fresh verification.

The prior better-sqlite3 cleanup assertion was not reproducible across isolated
stress and bundled-runner tests. The continuation now has one database owner and
closes through `ProductionService.close()` after all awaited work. Provider
stream cleanup also uses an outer `finally`.

UNKNOWN provider attempts are never automatically resubmitted. An operator
must authorize attachment to a verified task, preserve UNKNOWN, or authorize
a new attempt while acknowledging duplicate-execution risk. Resolution
receipts are independent of human video approval.
