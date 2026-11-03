import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { ArtifactValidationService, defaultRenderRequirements } from "../src/services/artifact-validation.js";
import { FfprobeMediaProbe } from "../src/services/ffprobe-media-probe.js";
import type { MediaAsset } from "../src/domain/types.js";

const ROOT = resolve(process.cwd());
const ARTIFACT_ROOT = resolve(ROOT, "m5-6f-live.94N1uK/artifacts/continuation-2026-10-13T18-54-53-357Z-564faf4b");
const TASK = "2214a271-7ec1-47f1-ba8e-cfec04eb7dea";
const CORRELATION = "channelforge-726f068f-770b-4450-a958-414bc27ef8a8-attempt-1";

function asset(relativePath: string, type: MediaAsset["type"], mimeType: string, providerPath: string): MediaAsset {
  const absolutePath = resolve(ARTIFACT_ROOT, relativePath);
  const bytes = readFileSync(absolutePath);
  const file = statSync(absolutePath);
  return {
    id: `offline-${type}-${TASK}`,
    schemaVersion: 1,
    productionJobId: "726f068f-770b-4450-a958-414bc27ef8a8",
    type,
    relativePath,
    mimeType,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteSize: file.size,
    sourceProvider: "moneyprinterturbo",
    sourceMetadata: { provenance: { provider: "moneyprinterturbo", remoteTaskId: TASK, correlationId: CORRELATION, providerPath } },
    rightsStatus: "pending",
    validationStatus: "unvalidated",
    isSynthetic: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

const validator = new ArtifactValidationService(ARTIFACT_ROOT, new FfprobeMediaProbe({ ffprobePath: "/opt/homebrew/bin/ffprobe", ffmpegPath: "/opt/homebrew/bin/ffmpeg" }));
const results = [
  validator.validate(asset(`moneyprinterturbo/${TASK}/final-1.mp4`, "render", "video/mp4", `/tasks/${TASK}/final-1.mp4`), { ...defaultRenderRequirements, targetDurationSec: 24, aspectRatio: "9:16" }),
  validator.validate(asset(`moneyprinterturbo/${TASK}/combined-1.mp4`, "video", "video/mp4", `/tasks/${TASK}/combined-1.mp4`), { ...defaultRenderRequirements, kind: "video", requiredAudio: false, targetDurationSec: 24, aspectRatio: "9:16" }),
  validator.validate(asset(`moneyprinterturbo/${TASK}/audio.mp3`, "audio", "audio/mpeg", `/tasks/${TASK}/audio.mp3`), { ...defaultRenderRequirements, kind: "audio", requiredAudio: true, targetDurationSec: 24 })
];
console.log(JSON.stringify({ artifactRoot: ARTIFACT_ROOT, task: TASK, results }, null, 2));
