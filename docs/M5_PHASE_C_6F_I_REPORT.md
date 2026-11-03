# Operation 6F-I Report

**Project:** ChannelForge  
**Operation:** 6F-I — Final Isolated Runner Integration  
**Result:** PASS  
**Execution boundary:** Offline and mocked only; no live provider request was made.

## 1. Files inspected

- `docs/M5_PHASE_C_HANDOFF.md`
- `m5_production_runner.ts`
- `src/services/production-service.ts`
- `src/services/production-provider.ts`
- `src/services/moneyprinterturbo-adapter.ts`
- `src/services/local-material-preflight.ts`
- `src/services/submission-journal.ts`
- `src/services/journaled-submission-provider.ts`
- `scripts/run-file-backed-submission-harness.mjs`
- `tests/fixtures/file-backed-submission-child.ts`
- `tests/production.test.ts`
- `tests/local-material-preflight.test.ts`
- `tests/submission-harness.test.ts`
- `tests/moneyprinterturbo-adapter.test.ts`
- `m5-6f-d-visuals.vel522fh/isolated-test-config.json`
- `m5-6f-d-visuals.vel522fh/material-validation.json`

## 2. Exact source changes

Added:

- `src/services/m5-isolated-runner.ts`
  - Loads and validates the approved isolated manifest and media-validation evidence.
  - Runs local-material preflight before opening or mutating SQLite.
  - Creates fresh channel, brief, job, provider-run, attempt, and correlation IDs.
  - Uses a fresh file-backed SQLite database and receipt workspace.
  - Builds the production request from the eight approved scenes.
  - Uses `MoneyPrinterTurboAdapter` with an injected offline transport.
  - Wraps the adapter with `journaledSubmissionProvider`.
  - Persists the acknowledgement receipt through `recordAcknowledgement`.
  - Exercises timeout and interrupted recovery modes without retrying.
  - Closes SQLite explicitly and removes temporary workspaces by default.

- `scripts/run-6f-i-isolated-runner.ts`
  - Dedicated CLI entry point for `success`, `timeout`, and `interrupted` offline modes.
  - Rejects `--live` fail-closed.

- `tests/m5-isolated-runner.test.ts`
  - Five targeted tests covering the successful workflow, payload, timeout, interruption,
    journal-before-transmission failure, and child-process cleanup.

- `docs/M5_PHASE_C_6F_I_REPORT.md`
  - This evidence report.

No canonical runner, canonical database, preserved 6F-E database, provider adapter, or
production service behavior was rewritten.

## 3. Runner architecture

The runner sequence is:

1. Read the approved config and media-validation evidence.
2. Verify eight ordered scenes, 24 seconds of declared coverage, 3-second clips,
   checksum/size agreement, successful probe/decode evidence, and frame-analysis agreement.
3. Run `validateLocalMaterialManifest()` and require eight passing visual reviews.
4. Create a fresh isolated workspace and file-backed SQLite database.
5. Create fresh domain records and advance only the isolated job to `RENDERING`.
6. Build the request and pass it through `MoneyPrinterTurboAdapter`.
7. Capture the adapter's serialized HTTP body using a mocked transport.
8. Persist the journal stages and acknowledgement.
9. Attempt a second submit and verify duplicate prevention.
10. Close SQLite and remove the workspace unless `--keep-workspace` is supplied.

## 4. Journal integration

The actual `ProductionService.submitProduction()` boundary receives the
`journaledSubmissionProvider`, not the raw adapter. The successful isolated run wrote:

```text
PREPARED
REQUEST_STARTED
RESPONSE_RECEIVED
ACKNOWLEDGEMENT_PERSISTED
```

The journal context preserved the exact job ID, provider-run ID, attempt ID, correlation
ID, request fingerprint, and material-manifest fingerprint. A separate regression test
confirmed that a `PREPARED` journal failure results in zero provider transmissions.

The retained evidence workspace from the final successful run is:

```text
m5-6f-i-isolated.zvWUeJ/
```

Its receipt directory contains all four stage receipts and `latest.json`. The SQLite
connection was closed before the runner returned; no WAL or shared-memory sidecars were
left in that retained workspace.

## 5. Eight-scene preflight result

```text
material count:             8
declared coverage:          24 seconds
clip duration:               3 seconds
decode evidence:             8/8 successful
visual quality:              8/8 pass
scene order:                 scene-01 through scene-08
material fingerprint:       697d82afb1bd6ba8edd92c476a435b1683c52a70344201edeb272a8b789f1c3e
```

The request referenced only:

```text
m5-6fd-ujph5ewi/scene-01.mp4
m5-6fd-ujph5ewi/scene-02.mp4
m5-6fd-ujph5ewi/scene-03.mp4
m5-6fd-ujph5ewi/scene-04.mp4
m5-6fd-ujph5ewi/scene-05.mp4
m5-6fd-ujph5ewi/scene-06.mp4
m5-6fd-ujph5ewi/scene-07.mp4
m5-6fd-ujph5ewi/scene-08.mp4
```

The obsolete placeholder material was absent.

## 6. Mocked serialized provider payload

The actual adapter-generated request body captured at the mocked transport boundary was:

```json
{
  "video_subject": "Why is the sky blue?",
  "video_script": "Why is the sky blue? Sunlight may look white, but it contains many colors. As sunlight travels through Earth's atmosphere, tiny air molecules scatter shorter blue wavelengths more strongly than longer red wavelengths. That scattered blue light reaches our eyes from across the sky. Near sunset, sunlight takes a longer path through air, leaving warmer colors more noticeable.",
  "video_terms": ["sunlight", "atmosphere", "Rayleigh scattering"],
  "video_language": "en",
  "video_aspect": "9:16",
  "video_clip_duration": 3,
  "video_count": 1,
  "video_source": "local",
  "video_materials": [
    {"provider":"local","url":"m5-6fd-ujph5ewi/scene-01.mp4","duration":3},
    {"provider":"local","url":"m5-6fd-ujph5ewi/scene-02.mp4","duration":3},
    {"provider":"local","url":"m5-6fd-ujph5ewi/scene-03.mp4","duration":3},
    {"provider":"local","url":"m5-6fd-ujph5ewi/scene-04.mp4","duration":3},
    {"provider":"local","url":"m5-6fd-ujph5ewi/scene-05.mp4","duration":3},
    {"provider":"local","url":"m5-6fd-ujph5ewi/scene-06.mp4","duration":3},
    {"provider":"local","url":"m5-6fd-ujph5ewi/scene-07.mp4","duration":3},
    {"provider":"local","url":"m5-6fd-ujph5ewi/scene-08.mp4","duration":3}
  ],
  "voice_name": "kokoro:af_heart",
  "subtitle_enabled": false,
  "bgm_type": "",
  "video_concat_mode": "sequential",
  "match_materials_to_script": true,
  "n_threads": 1
}
```

## 7. Mocked production result

Final retained success run:

- Job ID: `e7c5b18a-2b37-47a1-bf3e-d7b18657ed60`
- Provider-run ID: `e4bcb42b-8ef8-43a8-b92d-a30a8c90b544`
- Attempt ID: `5264116d-2b87-44ef-8dfd-6194ef8338dc`
- Correlation ID: `channelforge-e7c5b18a-2b37-47a1-bf3e-d7b18657ed60-attempt-1`
- Job state: `RENDERING`
- Provider-run state: `accepted`
- Mock provider task: `mock-6f-i-task`
- Submission calls: `1`
- Duplicate submission: prevented

## 8. Native lifecycle results

The dedicated runner was executed through the stable file-backed child-process harness.
The child exited normally, SQLite closed without the prior native cleanup assertion, and
the default runner removed its isolated workspace. The final evidence run used
`--keep-workspace` intentionally so its durable receipts could be inspected after exit.

## 9. Timeout/interruption regression results

- Timeout mode: provider-run remained `unknown`; one submission call; stages stopped at
  `RESPONSE_RECEIVED`; second submission was blocked.
- Interruption mode: job recovered to `FAILED` with failure kind `interrupted`; provider-run
  became `unknown`; stages stopped at `REQUEST_STARTED`; second submission was blocked.
- No automatic retry or provider-task attachment was performed.

## 10. Targeted test results

```text
npx vitest run tests/m5-isolated-runner.test.ts
5 tests passed
```

## 11. Full test-suite results

```text
npm test
6 test files passed
53 tests passed
```

## 12. Type-check result

```text
npm run typecheck
PASS — tsc --noEmit
```

## 13. Canonical database preservation

The canonical database and its sidecars were hashed before and after the offline runs;
all hashes were unchanged:

```text
m5-channel-forge.sqlite      6c0f4fd11e27b3677d0ba28cadbda3662a6657ae611a52f2d26208522438bc99
m5-channel-forge.sqlite-wal  e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
m5-channel-forge.sqlite-shm  fd4c9fda9cd3f9ae7c962b0ddf37232294d55580e1aa165aa06129b8549389eb
```

## 14. Preserved ambiguous database preservation

The preserved 6F-E database and its sidecars were also unchanged:

```text
m5-6f-e-isolated.Y04dBE/isolated-channel-forge.sqlite      1bc0b0f07e52320c05fae9cfba76c21acdae6572ecb0e9198dd3bb17f1f71408
m5-6f-e-isolated.Y04dBE/isolated-channel-forge.sqlite-wal  e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
m5-6f-e-isolated.Y04dBE/isolated-channel-forge.sqlite-shm  fd4c9fda9cd3f9ae7c962b0ddf37232294d55580e1aa165aa06129b8549389eb
```

## 15. Prepared live execution command

Prepared but **not executed**; it is intentionally rejected by the current fail-closed
runner until a separate authorization and live-mode implementation are provided:

```text
node scripts/run-file-backed-submission-harness.mjs scripts/run-6f-i-isolated-runner.ts --live
```

This is the only live command prepared for this operation.

## 16. Remaining blockers

- No live MoneyPrinterTurbo submission was authorized or performed.
- No live provider polling, artifact retrieval, media validation of a live render,
  human approval, or publishing was performed.
- A future live operation must separately authorize service readiness, credentials,
  network access, and the exact one-time submission.

## 17. Readiness for one future isolated production

The isolated integration is ready for one separately authorized future run. It has fresh
identity generation, fail-closed material checks, durable journal receipts, adapter-level
payload coverage, duplicate prevention, explicit SQLite cleanup, and UNKNOWN safeguards.
Operation 6F-I is complete; stop here until the project owner provides a separate live
authorization.
