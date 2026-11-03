# CHANNELFORGE M5 — FINAL RENDER VALIDATION

**Mission:** M5 Final Production Integration, Live Verification and Technical Closeout  
**Result:** **PARTIAL — TECHNICAL RENDER RECOVERED; HUMAN/CREATIVE APPROVAL PENDING**
**Execution date:** 2026-10-14
**Live provider:** local MoneyPrinterTurbo only  
**Human approval:** not performed

> The original 2026-10-13 sections below preserve the initial bounded-submission
> evidence. The 2026-10-14 recovery addendum at the end is the authoritative final
> state for the already acknowledged task. No second production submission was made.

## 1. Result summary

The explicit live isolated runner was implemented, all offline safeguards passed, and
exactly one local provider POST was made. The provider acknowledged a fresh task and the
runner performed the authorized bounded status window. The task remained `processing` after
12 sequential status requests, so no artifact retrieval or final MP4 validation was
authorized by the workflow. No retry, second POST, canonical mutation, approval, or
publishing occurred.

M5 is therefore **partially verified**, not technically verified and not content-approved.

## 2. Files changed

- `src/services/m5-isolated-runner.ts`
  - Added explicit live-mode execution.
  - Added loopback provider configuration parsing.
  - Added authenticated local readiness check.
  - Added exact serialized-payload guard before the POST.
  - Added one-POST process guard.
  - Added bounded service-level polling, capped at 12 requests.
  - Added isolated artifact retrieval wiring for a future succeeded state.
  - Preserved the durable submission journal and fresh file-backed database.

- `scripts/run-6f-i-isolated-runner.ts`
  - Added deliberate `--live` mode.
  - Offline modes remain the default.
  - Live mode cannot be combined with an offline mode.

- `src/services/journaled-submission-provider.ts`
  - Treats an acknowledged `processing` response with a task ID as eligible for the
    durable acknowledgement receipt, in addition to `accepted`.

- `tests/m5-isolated-runner.test.ts`
  - Existing offline regression coverage remains green.

- `docs/M5_PHASE_C_FINAL_PRODUCTION_REPORT.md`
  - This consolidated closeout report.

Historical `m5-channel-forge.sqlite` and the preserved 6F-E SQLite database were not opened
or modified by the live runner.

## 3. Live runner implementation

The live path requires the explicit flag:

```text
node scripts/run-file-backed-submission-harness.mjs scripts/run-6f-i-isolated-runner.ts --live
```

The runner performs, in order:

1. Approved eight-scene manifest and media-evidence validation.
2. Local-material checksum, size, path, duration, decode-evidence, and visual-quality checks.
3. Provider configuration validation, restricted to a loopback host.
4. Authenticated local readiness request.
5. Fresh isolated workspace and SQLite database creation.
6. Fresh channel, brief, job, provider-run, attempt, and correlation IDs.
7. Durable `PREPARED` and `REQUEST_STARTED` receipts.
8. Exact serialized body and endpoint validation before transmission.
9. One and only one POST guard.
10. Durable response and acknowledgement receipts.
11. At most 12 sequential service-level status requests.

No canonical or preserved job identity was reused.

## 4. Offline regression results

Executed before the live branch:

```text
npx vitest run tests/m5-isolated-runner.test.ts
5 tests passed

npm test
6 test files passed
53 tests passed

npm run typecheck
PASS
```

Offline coverage included:

- Eight-scene request serialization.
- Correct local source, voice, script, duration, and sequential concatenation.
- No obsolete placeholder material.
- Successful acknowledgement.
- Provider rejection handling.
- Timeout to `UNKNOWN`.
- Interrupted submission recovery.
- Journal failure before transmission.
- Duplicate-request blocking.
- File-backed SQLite cleanup and normal child-process exit.

## 5. Local provider readiness

The live runner verified:

```text
Readiness URL: http://127.0.0.1:8080/api/v1/tasks?page=1&page_size=1
HTTP status:   200
```

The provider configuration was loaded from the local MoneyPrinterTurbo configuration.
The API key was never printed or written to the report.

## 6. Actual provider submissions

```text
Actual provider POST count: 1
```

The one POST was sent only after all offline checks, readiness, payload validation, and
isolation checks passed. No second POST was attempted.

## 7. New isolated production history

```text
Job ID:             726f068f-770b-4450-a958-414bc27ef8a8
Channel ID:         7702cb64-780c-414d-a116-8fab034e9d53
Brief ID:           b3a499a2-a446-45b9-b5bb-069a2729c0d0
Provider run ID:    a5a6c5c5-dede-4574-bfb9-13c2a7b36584
Attempt ID:         2c6eba77-9534-4f6b-8436-d252b6ea05de
Correlation ID:     channelforge-726f068f-770b-4450-a958-414bc27ef8a8-attempt-1
Provider task ID:   2214a271-7ec1-47f1-ba8e-cfec04eb7dea
Initial state:      accepted
Final observed:     processing
Job state:          RENDERING
```

The provider task ID was unique and acknowledged by the local provider. Only this task was
tracked.

## 8. Submission journal status

Journal root:

```text
m5-6f-live.94N1uK/submission-receipts/726f068f-770b-4450-a958-414bc27ef8a8/2c6eba77-9534-4f6b-8436-d252b6ea05de/
```

Durable stages:

```text
PREPARED
REQUEST_STARTED
RESPONSE_RECEIVED
ACKNOWLEDGEMENT_PERSISTED
```

Request fingerprint:

```text
50a469f41a1ce87e6c99130a0b37823536fe50526eb3ee15cfb8eb43e72c834e
```

Material manifest fingerprint:

```text
697d82afb1bd6ba8edd92c476a435b1683c52a70344201edeb272a8b789f1c3e
```

## 9. Status tracking

The runner performed the initial acknowledged state observation plus 12 bounded sequential
status requests. Observed sequence:

```text
accepted,
processing, processing, processing, processing, processing, processing,
processing, processing, processing, processing, processing, processing
```

The authorized polling window was exhausted without a succeeded or failed terminal state.
No additional status request was made after the limit.

## 10. Artifact retrieval results

Artifact retrieval was **not performed** because the provider did not confirm successful
rendering within the authorized polling window.

```text
Artifact files retrieved: 0
Artifact registration:    none
Canonical registration:   none
```

The isolated workspace currently contains the SQLite database and durable receipts, but no
completed artifact staging directory. No artifact was treated as production output.

## 11. Final MP4 technical assessment

Not available. No successful render was confirmed and no final MP4 was retrieved in this
mission. Consequently, there is no new evidence for:

- MP4 integrity.
- FFprobe metadata.
- Full FFmpeg decode.
- Duration, resolution, frame rate, or codec.
- Audio stream and duration.
- Audio/video synchronization.

The prior canonical render remains unrelated historical evidence and was not reused.

## 12. Visual assessment

Pending because no new render was confirmed or retrieved. No contact sheet was generated
for the live task, and no visual acceptance decision was made.

The approved source manifest was validated before submission as eight distinct, ordered,
visually passing scenes covering 24 seconds. This validates the input gate only; it does not
prove the provider's final output.

## 13. Narration assessment

Pending because no new rendered audio was retrieved. No listening or transcription claim is
made for the live task.

The submitted request was checked offline against the approved script and voice contract:
`kokoro:af_heart`, subtitles disabled, and the approved science narration.

## 14. Human approval status

Human approval was **not performed**. The isolated job remains in `RENDERING`. No artifact
was registered for review, no review record was created, and nothing was published.

## 15. Database preservation

The canonical database and preserved 6F-E database retained their previously recorded
hashes after the live run:

```text
m5-channel-forge.sqlite                                      6c0f4fd11e27b3677d0ba28cadbda3662a6657ae611a52f2d26208522438bc99
m5-channel-forge.sqlite-wal                                  e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
m5-channel-forge.sqlite-shm                                  fd4c9fda9cd3f9ae7c962b0ddf37232294d55580e1aa165aa06129b8549389eb
m5-6f-e-isolated.Y04dBE/isolated-channel-forge.sqlite        1bc0b0f07e52320c05fae9cfba76c21acdae6572ecb0e9198dd3bb17f1f71408
```

The live database is isolated at:

```text
m5-6f-live.94N1uK/isolated-channel-forge.sqlite
```

## 16. Remaining blockers

- The acknowledged task was still `processing` after the maximum 12 status requests.
- No successful provider state was observed.
- No final artifact was retrieved or technically validated.
- Visual and narration reviews remain pending.
- Human approval remains pending.
- Publishing is not authorized and was not attempted.

## 17. Exact next recommended action

Do not submit again. Do not retry. Do not attach another task.

In a separately bounded continuation, use the existing isolated database and the exact
acknowledged task only:

```text
Job:       726f068f-770b-4450-a958-414bc27ef8a8
Task:      2214a271-7ec1-47f1-ba8e-cfec04eb7dea
Database:  /Users/osaid/Documents/ChannelForge/m5-6f-live.94N1uK/isolated-channel-forge.sqlite
```

The next safe action is a read-only/service-level status continuation. If and only if that
task reaches `succeeded`, retrieve its artifacts into the same isolated workspace, perform
FFprobe/FFmpeg/audio-sync validation, generate a timestamped contact sheet, and conduct
separate visual and narration review. If it remains processing or becomes unknown, preserve
the current identity and stop without a new POST.

**No further production action was taken in this mission.**

---

## 18. M5 recovery closeout — authoritative final state

**Recovery execution:** 2026-10-14

### 18.1 Mission result

**Mission classification: PARTIAL.** The existing remote render completed and was
retrieved into the same isolated workspace. The final MP4 is technically readable,
the eight-scene sequence is visually inspectable, and the output remains gated from
approval and publication. Creative quality and narration intelligibility still require
human review; therefore this is not a publication-readiness PASS.

### 18.2 Authoritative identity and provider state

The continuation reopened the existing isolated database and verified all supplied
identifiers before making any provider request:

```text
Job:          726f068f-770b-4450-a958-414bc27ef8a8
Provider run: a5a6c5c5-dede-4574-bfb9-13c2a7b36584
Attempt:      2c6eba77-9534-4f6b-8436-d252b6ea05de
Correlation:  channelforge-726f068f-770b-4450-a958-414bc27ef8a8-attempt-1
Provider task:2214a271-7ec1-47f1-ba8e-cfec04eb7dea
Database:     m5-6f-live.94N1uK/isolated-channel-forge.sqlite
```

Final persisted state:

```text
Job state:          VALIDATING
Provider run state: succeeded
Provider status:    1
Attempts:           1
Additional POSTs:   0
```

The provider status response returned the exact task ID. The local provider did not
return `request_id` in the task response, so correlation identity is recorded as
`not-returned` rather than inferred. The continuation rejected mismatched task IDs
and mismatched returned correlation IDs when present.

The final successful continuation result recorded one status request for artifact
discovery after the task was already persisted as `succeeded`. The preceding
status-only continuation recorded two status requests: one completion poll and one
artifact-discovery status check. A separate validation-integrated attempt terminated
with a local better-sqlite3/native cleanup assertion before producing a result; it did
not create a task or POST and is not counted as a successful continuation result.
All successful continuation requests were within the maximum eight-request bound.

### 18.3 Artifact retrieval

Retrieval used `MoneyPrinterTurboAdapter.getProductionArtifacts()` and
`ProductionService.getProductionArtifacts()` against the exact task. Files were
written to a new immutable staging directory; prior artifacts were not overwritten.

```text
m5-6f-live.94N1uK/artifacts/continuation-2026-10-13T18-54-53-357Z-564faf4b/
└── moneyprinterturbo/2214a271-7ec1-47f1-ba8e-cfec04eb7dea/
    ├── final-1.mp4
    ├── combined-1.mp4
    └── audio.mp3
```

ChannelForge registered three unvalidated assets for the live job. The final render
asset is the artifact used for technical and visual assessment:

```text
moneyprinterturbo/2214a271-7ec1-47f1-ba8e-cfec04eb7dea/final-1.mp4
```

### 18.4 Technical media validation

`final-1.mp4`:

```text
Container:       MP4 / QuickTime family; probe score 100
Video:           H.264 High, yuv420p, progressive, 1080x1920
Frame rate:      30 fps; 710 decoded frames
Video duration:  23.666667 s
Audio:           AAC-LC, 44.1 kHz, stereo
Audio duration:  23.660000 s
Container size:  2,498,390 bytes
SHA-256:         cfe227f8e67bfc8cd56166ddfbee224cbc96aecc8a10157736dbca5bfddf8290
```

The independently retrieved narration source was also readable:

```text
audio.mp3:       MP3, 24 kHz, mono, 23.657500 s, 189,932 bytes
SHA-256:         89c30fb96322e69a65fcae34cdc13ad0397a347252c823aa988688042bca5e16
```

FFmpeg full video and audio null-sink decodes exited successfully with no reported
decode errors. The audio/video duration difference is approximately 6.667 ms, with
the video ending slightly later. Audio measurements from the final MP4 were:

```text
Integrated loudness: -16.6 LUFS
Loudness range:       1.8 LU
Mean sample volume:  -19.2 dB
Peak sample volume:   -5.3 dB
```

No blank-frame interval was reported by `blackdetect`. `freezedetect` reported
multi-second low-motion intervals within illustrated scenes (including approximately
3–6 s, 15–21 s), which is a creative-quality review item rather than a decode failure.

### 18.5 Visual sequence assessment

Timestamped evidence:

```text
m5-6f-live.94N1uK/artifacts/continuation-2026-10-13T18-54-53-357Z-564faf4b/live-contact-sheet-timestamped-20261014T0020.jpg
SHA-256: ee9f50b83cae1bd0c4676cfb550b2515a3465979dc966e9aca0b6ceda9921b68
```

The contact sheet samples the complete 23.67-second output at two-second intervals.
A boundary-focused inspection showed the expected ordered progression:

1. Blue sky and clouds / opening title.
2. White sunlight containing multiple colors.
3. Short blue wavelengths scattering.
4. Blue scattering more strongly than red.
5. Scattered blue reaching an observer from across the sky.
6. Daytime versus sunset comparison.
7. Longer atmospheric path near sunset.
8. Blue-sky closing composition.

The provider task script and `script.json` reference all eight approved local materials
in sequential order, with `video_concat_mode: sequential`, `video_clip_duration: 3`,
and `match_materials_to_script: true`. The contact sheet is consistent with those
eight scene boundaries and does not show a blank frame, an unrelated placeholder,
or a broken crop. Text and diagrams are legible at the sampled contact-sheet scale.

The output includes repeated/low-motion illustrated frames inside some three-second
scenes. Accordingly:

```text
Infrastructure/sequence evidence: PASS
Creative visual quality:           REVIEW_REQUIRED
```

The latter classification is deliberately conservative: motion metrics do not prove
semantic quality, and the project owner has not yet reviewed the video.

### 18.6 Narration assessment

The final MP4 contains a continuous AAC audio stream, and the provider-side script
contains the approved narration text and the requested `kokoro:af_heart` voice name.
The script covers white sunlight/multiple colors, atmospheric scattering, stronger
short-wavelength scattering, blue light arriving from across the sky, the longer
sunset path, and warmer sunset colors. The scientific content is consistent with the
approved topic.

FFmpeg audio analysis found speech-like non-silent content throughout the track with
short pauses at approximately 1.33–1.59 s, 4.96–5.22 s, 7.71–8.00 s, and
17.32–17.58 s. No transcription engine or reliable human listening review was
available in this run. Therefore intelligibility, sentence repetition, abrupt cuts,
and exact visual-to-word timing are not claimed as proven.

```text
Narration presence/stream continuity: PASS
Narration intelligibility/creative fit: REVIEW_REQUIRED
```

### 18.7 Quality classifications

| Area | Classification | Evidence-based conclusion |
|---|---|---|
| Infrastructure reliability | PASS | One original POST, durable four-stage journal, one preserved attempt, bounded continuation, no retry. |
| Provider integration | PASS | Exact task reached `succeeded`; adapter retrieved three task artifacts and enforced identity/path checks. |
| Artifact technical validity | PASS | FFprobe succeeded, full FFmpeg decode succeeded, streams and checksums recorded. |
| Visual quality | REVIEW_REQUIRED | Correct eight-scene narrative is visible, but low-motion intervals and lack of owner review remain. |
| Narration quality | REVIEW_REQUIRED | Audio exists and matches the approved script contract; intelligibility/listening/transcription remain unverified. |
| Human approval | NOT_ASSESSED | No owner approval receipt or review record exists. |

### 18.8 Source changes and regression evidence

Added or changed for safe recovery:

- `src/services/m5-live-continuation.ts` — reopen-only continuation; exact identity
  verification; maximum eight status requests; status/retrieval only; no submission
  path; isolated artifact staging.
- `scripts/continue-m5-live.ts` — fixed authoritative live continuation entrypoint.
- `src/services/production-service.ts` — rejects mismatched provider task identity and
  mismatched returned correlation identity; supports strict task identity mode.
- `src/services/moneyprinterturbo-adapter.ts` — rejects a status response whose task
  ID or returned correlation ID conflicts with the requested reference.
- `tests/moneyprinterturbo-adapter.test.ts` — regression coverage for both mismatch
  cases.

Checks completed after these changes:

```text
npx vitest run tests/moneyprinterturbo-adapter.test.ts tests/production.test.ts
35 tests passed

npm test
6 test files passed; 54 tests passed

npm run typecheck
PASS — tsc --noEmit
```

### 18.9 Database preservation

The canonical database and preserved 6F-E database hashes remain unchanged from the
previous report:

```text
m5-channel-forge.sqlite                                      6c0f4fd11e27b3677d0ba28cadbda3662a6657ae611a52f2d26208522438bc99
m5-channel-forge.sqlite-wal                                  e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
m5-channel-forge.sqlite-shm                                  fd4c9fda9cd3f9ae7c962b0ddf37232294d55580e1aa165aa06129b8549389eb
m5-6f-e-isolated.Y04dBE/isolated-channel-forge.sqlite        1bc0b0f07e52320c05fae9cfba76c21acdae6572ecb0e9198dd3bb17f1f71408
```

Only `m5-6f-live.94N1uK/isolated-channel-forge.sqlite` was updated. Its final
records show one job, one provider run, one attempt, three media assets, zero approval
records, and the job transition to `VALIDATING`.

### 18.10 Remaining blockers and exact next action

Remaining blockers:

- No human approval has been performed or recorded.
- Narration intelligibility and exact audiovisual timing have not been confirmed by
  listening or transcription.
- Creative visual review should decide whether low-motion illustrated intervals are
  acceptable for the channel.
- The live assets remain `unvalidated` in ChannelForge because the existing trusted
  artifact validator has no production FFprobe-backed probe configured in this run;
  the independent FFprobe/FFmpeg evidence above supports technical validity but does
  not replace a trusted validation record.
- Publishing was not attempted and is not authorized by this closeout.

**Exact recommended next action:** the project owner should review the staged
`final-1.mp4` and contact sheet, listen to the complete narration, and record a
human quality/factual/rights decision through the existing approval boundary. If the
owner rejects the low-motion or narration quality, document a future render decision;
do not resubmit during this mission. If the owner accepts it, configure and run the
existing trusted artifact-validation path, then record approval. Do not publish until
that approval record exists.

---

## 19. M5 validation hardening addendum

### 19.1 Mission result

**PARTIAL.** Trusted local validation is now implemented, exercised against the
recovered M5 artifacts, and integrated into the application workflow. The live
production database was not mutated during this mission, so the live job remains
`VALIDATING` and human acceptance remains pending.

### 19.2 Files changed

- `src/services/ffprobe-media-probe.ts` — production FFprobe parser, FFmpeg full
  decode checks, and audio loudness analysis using non-shell child processes.
- `src/services/artifact-validation.ts` — stream-level requirements, required
  narration/audio checks, A/V tolerance, duration/aspect checks, race-safe file
  identity checks, provenance-bound evidence, and fail-closed validation.
- `src/services/production-service.ts` — provider-bound `validateProduction()`;
  complete validation required before `REVIEW`; provider artifact provenance
  enforcement; single-artifact validation restricted to `VALIDATING`.
- `src/services/production-provider.ts` — explicit provider artifact provenance.
- `src/services/moneyprinterturbo-adapter.ts` — correlation-preserving provenance
  and guaranteed streaming response cleanup on all error paths.
- `src/db/repositories.ts` and `src/domain/schemas.ts` — structured durable
  validation evidence, atomic validation writes, invalidation support, and a
  complete trusted-validation predicate.
- `src/services/m5-live-continuation.ts` — single-owner service close ordering.
- `scripts/validate-m5-live-artifacts.ts` — validation-only, no-network, no-DB-
  mutation evidence command for the recovered live artifact set.
- `tests/ffprobe-media-probe.test.ts`, `tests/artifact-validation.test.ts`,
  `tests/production.test.ts`, and `tests/moneyprinterturbo-adapter.test.ts` —
  regression coverage.

### 19.3 Automated validation implementation

`FfprobeMediaProbe` executes FFprobe without a shell and extracts bounded stream
facts. It then runs FFmpeg null-sink decode checks for required streams and
`volumedetect` for narration loudness. The validator rejects missing audio,
materially silent audio, unsupported codecs/containers, invalid frame rate or
dimensions, target-duration violations, A/V duration mismatches, checksum or
byte-size mismatches, symlinks, missing files, file mutation during probing,
malformed tool output, and missing structured stream evidence.

The application workflow is now:

```text
provider succeeded
  -> artifact retrieval / unvalidated assets
  -> explicit local FFprobe/FFmpeg validation
  -> VALIDATING -> REVIEW only after the complete asset set passes
  -> separate human approval boundary
```

Technical validation does not create or imply human approval.

### 19.4 Actual recovered M5 validation evidence

The validation-only command ran against the immutable recovered artifact staging
directory without making provider requests and without opening or mutating the
live SQLite database:

```text
node scripts/run-file-backed-submission-harness.mjs scripts/validate-m5-live-artifacts.ts
```

The exact final render passed:

```text
Container:       mov,mp4,m4a,3gp,3g2,mj2
Video:           h264, 1080x1920, 30 fps, 23.666667 s
Audio:           aac, 44.1 kHz stereo, 23.660000 s
A/V delta:       0.006667 s
Audio loudness:  mean -19.2 dB, max -5.3 dB
Video decode:    passed
Audio decode:    passed
Checksum:        cfe227f8e67bfc8cd56166ddfbee224cbc96aecc8a10157736dbca5bfddf8290
```

The combined video and standalone MP3 narration also passed their respective
video-only and audio-only contracts. Evidence was emitted but not persisted to
the live database because that mutation was outside this mission's authorization.

### 19.5 SQLite lifecycle investigation

The previous native cleanup assertion was investigated with temporary databases,
the bundled file-backed harness, prepared-statement/transaction stress, and 20
repeated isolated runner executions. The assertion did not reproduce. The source
contains one SQLite connection owner, no retained application prepared statements,
no async transactions, and the native addon closes tracked transaction statements.

The exact original root cause is therefore **not proven**. The most plausible
explanation remains close-ordering or ownership in the transient validation wrapper,
possibly compounded by a one-off Node 24/better-sqlite3 native teardown failure.
The evidence-backed fixes are:

1. The continuation has one outer database owner and closes via
   `ProductionService.close()` only after all awaited work.
2. Provider streaming responses are closed in an outer `finally` on every path.
3. No forced garbage collection, direct SQLite manipulation, retry, or provider
   operation was added.

The original failure's complete stderr/native stack was not preserved, so the
native/runtime hypothesis remains a documented limitation rather than a confirmed
root cause.

### 19.6 Validation quality classifications

```text
Trusted artifact validation implementation: PASS
Recovered M5 technical media validation:    PASS (offline, non-persisted evidence)
Creative visual quality:                     REVIEW_REQUIRED
Narration intelligibility:                  REVIEW_REQUIRED
Human approval:                              NOT_ASSESSED
Publication readiness:                       NOT_READY
```

### 19.7 Regression results

```text
npx vitest run tests/production.test.ts tests/artifact-validation.test.ts tests/ffprobe-media-probe.test.ts tests/moneyprinterturbo-adapter.test.ts
43 tests passed

npm test
8 test files passed; 62 tests passed

npm run typecheck
PASS — tsc --noEmit
```

### 19.8 Preservation and remaining blockers

The canonical database, preserved 6F-E database, and successful live production
identity were not changed. No provider POST, retry, unrelated polling, publishing,
or paid API call occurred.

The live job remains in `VALIDATING` with three unvalidated registered assets. A
separately authorized service-level operation would be required to persist the
trusted evidence and transition the live job to `REVIEW`; that operation must still
not create a provider request. Human review of the final render and complete audio
remains required before approval or publication.

---

## 20. Final acceptance preparation attempt

### 20.1 Current-state verification

The live state was re-read before any service-level transition:

```text
Job:              726f068f-770b-4450-a958-414bc27ef8a8
Job state:        VALIDATING
Provider run:     a5a6c5c5-dede-4574-bfb9-13c2a7b36584
Provider state:   succeeded
Provider task:    2214a271-7ec1-47f1-ba8e-cfec04eb7dea
Attempt:          2c6eba77-9534-4f6b-8436-d252b6ea05de
Correlation:      channelforge-726f068f-770b-4450-a958-414bc27ef8a8-attempt-1
Attempts:         1
Assets:           3 unvalidated
Approvals:        0
```

The final artifact checksums still match the registered asset records:

```text
final-1.mp4:    cfe227f8e67bfc8cd56166ddfbee224cbc96aecc8a10157736dbca5bfddf8290
combined-1.mp4: a2149e55e395bcf8741f307957e6d51e0d779b969d4cdf5ce9f7785674f94247
audio.mp3:      89c30fb96322e69a65fcae34cdc13ad0397a347252c823aa988688042bca5e16
```

### 20.2 Recoverable backup

Before attempting the permitted transition, a SQLite-native `.backup` was created;
WAL and SHM files were not manually manipulated:

```text
m5-6f-live.94N1uK/isolated-channel-forge.pre-acceptance-20261014.sqlite
SHA-256: ed15806e1d7c71d10535a0a0ce4515ebb3f91dfca26f5b67b57800520511bccb
```

The backup independently reads as `VALIDATING`, provider `succeeded`, three
unvalidated assets, zero approvals, and one provider attempt.

### 20.3 Authorized validation result

The existing `ProductionService.validateProduction()` workflow was invoked through:

```text
node scripts/run-file-backed-submission-harness.mjs scripts/validate-m5-live-production.ts
```

The operation made no provider request and did not use direct SQL for validation
writes. It stopped before any asset update or state transition with:

```text
Artifact provenance does not match the succeeded provider attempt
```

Investigation found that the three existing live asset records were created by the
earlier adapter version and contain flat legacy metadata:

```json
{
  "provider": "moneyprinterturbo",
  "remoteTaskId": "2214a271-7ec1-47f1-ba8e-cfec04eb7dea",
  "providerPath": "..."
}
```

They do not contain the required persisted `provenance.correlationId` and nested
`provenance` object. The provider task, remote task ID, and file checksums match,
but the complete provenance precondition does not. Validation correctly failed
closed rather than infer or manufacture a missing provenance value.

Post-attempt verification confirms:

```text
Job state:        VALIDATING
Asset statuses:   3 unvalidated
Approvals:        0
Provider attempts:1
Provider task:    unchanged
```

No validation evidence was persisted and the job did not enter `REVIEW`.

### 20.4 Human review package

Final video:

```text
/Users/osaid/Documents/ChannelForge/m5-6f-live.94N1uK/artifacts/continuation-2026-10-13T18-54-53-357Z-564faf4b/moneyprinterturbo/2214a271-7ec1-47f1-ba8e-cfec04eb7dea/final-1.mp4
```

```text
SHA-256:  cfe227f8e67bfc8cd56166ddfbee224cbc96aecc8a10157736dbca5bfddf8290
Duration: 23.666667 s
Video:    H.264, 1080x1920, 30 fps
Audio:    AAC-LC, 44.1 kHz, stereo, 23.660000 s
```

Human checklist:

- Watch the complete final video from beginning to end.
- Confirm the eight-scene order and absence of visual defects.
- Decide whether low-motion illustrated intervals are creative-quality acceptable.
- Listen to the complete narration and assess intelligibility, continuity, and timing.
- Confirm the explanation is scientifically accurate.
- Confirm asset rights/provenance review.
- Record the quality, factual, and rights decision through the existing approval boundary.

No creative, narration, rights, or human approval was fabricated.

### 20.5 Final acceptance status

```text
Automated technical prerequisites: PASS (offline evidence)
Service-level trusted validation:  BLOCKED by legacy provenance metadata
Current job state:                 VALIDATING
Human acceptance:                  NOT_ASSESSED
M5 readiness:                      PARTIAL — not yet at REVIEW
```

The next engineering action is to resolve the legacy provenance gap through an
authorized, service-level compatibility/reconciliation path that verifies the exact
task, attempt, provider paths, and checksums without creating a new attempt. Do not
manually edit the database, resubmit, poll, publish, or record approval.
