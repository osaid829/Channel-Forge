import { resolve } from "node:path";
import { SqliteDatabase } from "../src/db/database.js";
import { ArtifactValidationService } from "../src/services/artifact-validation.js";
import { FfprobeMediaProbe } from "../src/services/ffprobe-media-probe.js";
import { ProductionService } from "../src/services/production-service.js";

const ROOT = resolve(process.cwd());
const JOB_ID = "726f068f-770b-4450-a958-414bc27ef8a8";
const TASK_ID = "2214a271-7ec1-47f1-ba8e-cfec04eb7dea";
const ATTEMPT_ID = "2c6eba77-9534-4f6b-8436-d252b6ea05de";
const CORRELATION_ID = "channelforge-726f068f-770b-4450-a958-414bc27ef8a8-attempt-1";
const DATABASE_PATH = resolve(ROOT, "m5-6f-live.94N1uK/isolated-channel-forge.sqlite");
const ARTIFACT_ROOT = resolve(ROOT, "m5-6f-live.94N1uK/artifacts/continuation-2026-10-13T18-54-53-357Z-564faf4b");

const database = new SqliteDatabase(DATABASE_PATH);
const service = new ProductionService(database, {
  artifactValidator: new ArtifactValidationService(ARTIFACT_ROOT, new FfprobeMediaProbe({ ffprobePath: "/opt/homebrew/bin/ffprobe", ffmpegPath: "/opt/homebrew/bin/ffmpeg" }))
});

try {
  const job = service.getJob(JOB_ID);
  const run = service.getProviderRun(JOB_ID);
  if (job.currentState !== "VALIDATING") throw new Error(`Refusing validation: expected VALIDATING, found ${job.currentState}.`);
  if (!run || run.state !== "succeeded" || run.remoteTaskId !== TASK_ID || run.attemptId !== ATTEMPT_ID || run.correlationId !== CORRELATION_ID) throw new Error("Refusing validation: persisted provider identity does not match the authoritative M5 identity.");
  const result = service.validateProduction(JOB_ID);
  console.log(JSON.stringify({ jobId: JOB_ID, taskId: TASK_ID, attemptId: ATTEMPT_ID, correlationId: CORRELATION_ID, finalState: result.currentState, validation: "persisted", approvals: 0 }, null, 2));
} catch (error) {
  console.error(`M5 validation stopped without transition: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  service.close();
}
