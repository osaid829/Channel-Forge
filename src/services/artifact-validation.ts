import { createHash } from "node:crypto";
import { closeSync, existsSync, fstatSync, lstatSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { ArtifactValidationError } from "../domain/errors.js";
import { ValidationEvidenceSchema } from "../domain/schemas.js";
import type { MediaAsset } from "../domain/types.js";
import { assertSafeRelativePath } from "../db/repositories.js";
import { assessVisualQuality, type VisualFrameAnalysis } from "./visual-quality-gate.js";

export interface MediaProbeResult {
  playable: boolean;
  mimeType: string;
  durationSec: number;
  width: number;
  height: number;
  raw: Record<string, unknown>;
  visualAnalysis?: VisualFrameAnalysis;
  containerFormat?: string;
  videoStreams?: Array<{ index: number; codecName: string; durationSec: number; width: number; height: number; frameRate?: number }>;
  audioStreams?: Array<{ index: number; codecName: string; durationSec: number; sampleRate: number; channels: number; channelLayout?: string }>;
  decode?: { video: "passed" | "not_required"; audio: "passed" | "not_required" };
  audioLoudness?: { meanDb: number; maxDb: number };
}

export interface MediaProbe {
  readonly source: "trusted-runtime" | "test";
  inspect(absolutePath: string, requirements?: MediaValidationRequirements): MediaProbeResult;
}

export interface MediaValidationRequirements {
  kind: "render" | "video" | "audio";
  requiredAudio: boolean;
  targetDurationSec?: number;
  targetDurationToleranceSec: number;
  avDurationToleranceSec: number;
  aspectRatio?: "9:16" | "16:9" | "1:1";
  allowedVideoCodecs: string[];
  allowedAudioCodecs: string[];
  allowedContainers: string[];
}

export const defaultRenderRequirements: MediaValidationRequirements = {
  kind: "render",
  requiredAudio: true,
  targetDurationToleranceSec: 1,
  avDurationToleranceSec: 0.25,
  allowedVideoCodecs: ["h264", "hevc", "vp9", "av1"],
  allowedAudioCodecs: ["aac", "mp3", "opus", "vorbis"],
  allowedContainers: ["mov,mp4,m4a,3gp,3g2,mj2", "matroska,webm", "mp3", "wav"]
};

export interface TrustedValidationEvidence {
  source: "trusted-runtime";
  validator: string;
  validatedAt: string;
  summary: string;
  sha256: string;
  byteSize: number;
  media: { mimeType: string; durationSec: number; width: number; height: number };
  artifact: { id: string; relativePath: string };
  provenance?: { provider: string; remoteTaskId?: string; correlationId?: string; providerPath?: string };
  checks: {
    container: "passed"; codec: "passed"; resolution: "passed"; frameRate: "passed"; duration: "passed";
    audio: "passed" | "not_required"; audioDuration: "passed" | "not_required"; avDuration: "passed" | "not_required";
    decode: "passed"; checksum: "passed"; fileIdentity: "passed"; provenance: "passed" | "not_required";
  };
  probe: Record<string, unknown>;
}

function contains(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value === "" || (!isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`));
}

export class ArtifactValidationService {
  constructor(private readonly dataRoot: string, private readonly probe: MediaProbe) {}

  validate(asset: MediaAsset, requirements: MediaValidationRequirements = defaultRenderRequirements): TrustedValidationEvidence {
    if (this.probe.source !== "trusted-runtime") {
      throw new ArtifactValidationError("Test media probes cannot authorize production validation", { assetId: asset.id });
    }
    if (asset.isSynthetic) throw new ArtifactValidationError("Synthetic assets cannot be validated as production output", { assetId: asset.id });
    const relativePath = assertSafeRelativePath(asset.relativePath);
    const root = realpathSync(this.dataRoot);
    const absolutePath = resolve(root, relativePath);
    if (!contains(root, absolutePath)) throw new ArtifactValidationError("Artifact escaped the configured data root", { assetId: asset.id });
    if (!existsSync(absolutePath)) throw new ArtifactValidationError("Artifact is not a regular non-symlink file", { assetId: asset.id });
    const fileStat = lstatSync(absolutePath);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) throw new ArtifactValidationError("Artifact is not a regular non-symlink file", { assetId: asset.id });
    if (realpathSync(absolutePath) !== absolutePath) throw new ArtifactValidationError("Artifact path resolves through a symlink", { assetId: asset.id });
    const descriptor = openSync(absolutePath, "r");
    let byteSize = 0;
    const digest = createHash("sha256");
    let fileIdentity: { dev: number; ino: number; size: number; mtimeMs: number };
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    try {
      const openedStat = fstatSync(descriptor);
      if (!openedStat.isFile() || openedStat.dev !== fileStat.dev || openedStat.ino !== fileStat.ino) throw new ArtifactValidationError("Artifact changed while being opened", { assetId: asset.id });
      fileIdentity = { dev: openedStat.dev, ino: openedStat.ino, size: openedStat.size, mtimeMs: openedStat.mtimeMs };
      let bytesRead = 0;
      do {
        bytesRead = readSync(descriptor, buffer, 0, buffer.byteLength, null);
        if (bytesRead > 0) {
          digest.update(buffer.subarray(0, bytesRead));
          byteSize += bytesRead;
        }
      } while (bytesRead > 0);
    } finally {
      closeSync(descriptor);
    }
    const sha256 = digest.digest("hex");
    if (sha256 !== asset.sha256.toLowerCase()) throw new ArtifactValidationError("Artifact checksum does not match metadata", { assetId: asset.id });
    if (byteSize !== asset.byteSize) throw new ArtifactValidationError("Artifact byte size does not match metadata", { assetId: asset.id });
    const media = this.probe.inspect(absolutePath, requirements);
    const finalStat = statSync(absolutePath);
    if (!finalStat.isFile() || finalStat.dev !== fileIdentity.dev || finalStat.ino !== fileIdentity.ino || finalStat.size !== fileIdentity.size || finalStat.mtimeMs !== fileIdentity.mtimeMs) throw new ArtifactValidationError("Artifact changed during trusted validation", { assetId: asset.id });
    if (!media.playable || media.durationSec <= 0 || (requirements.kind !== "audio" && (media.width <= 0 || media.height <= 0))) throw new ArtifactValidationError("Trusted media probe rejected the artifact", { assetId: asset.id });
    if (media.mimeType !== asset.mimeType) throw new ArtifactValidationError("Artifact MIME type does not match trusted media probe", { assetId: asset.id });
    const structured = media.videoStreams !== undefined || media.audioStreams !== undefined || media.decode !== undefined;
    if (!structured) throw new ArtifactValidationError("Trusted media probe did not return stream-level validation facts", { assetId: asset.id });
    const videoStreams = media.videoStreams ?? [];
    const audioStreams = media.audioStreams ?? [];
    if (requirements.kind !== "audio" && videoStreams.length === 0) throw new ArtifactValidationError("Required video stream is missing", { assetId: asset.id });
    if (requirements.requiredAudio && audioStreams.length === 0) throw new ArtifactValidationError("Required narration audio stream is missing", { assetId: asset.id });
    if (!requirements.allowedContainers.includes(media.containerFormat ?? "")) throw new ArtifactValidationError("Unsupported media container", { assetId: asset.id, container: media.containerFormat });
    if (videoStreams.some((stream) => !requirements.allowedVideoCodecs.includes(stream.codecName))) throw new ArtifactValidationError("Unsupported video codec", { assetId: asset.id });
    if (audioStreams.some((stream) => !requirements.allowedAudioCodecs.includes(stream.codecName))) throw new ArtifactValidationError("Unsupported audio codec", { assetId: asset.id });
    const video = videoStreams[0];
    const audio = audioStreams[0];
    if (requirements.kind !== "audio" && (!video || !Number.isFinite(video.frameRate) || (video.frameRate ?? 0) <= 0)) throw new ArtifactValidationError("Video frame rate is missing or invalid", { assetId: asset.id });
    if (requirements.kind !== "audio" && requirements.aspectRatio && video) {
      const expected = requirements.aspectRatio === "9:16" ? 9 / 16 : requirements.aspectRatio === "16:9" ? 16 / 9 : 1;
      if (Math.abs(video.width / video.height - expected) > 0.03) throw new ArtifactValidationError("Video aspect ratio is incompatible with the production brief", { assetId: asset.id });
    }
    if (requirements.targetDurationSec !== undefined && Math.abs(media.durationSec - requirements.targetDurationSec) > requirements.targetDurationToleranceSec) throw new ArtifactValidationError("Media duration is outside the allowed target tolerance", { assetId: asset.id });
    if (requirements.requiredAudio && audio) {
      if (!Number.isFinite(audio.durationSec) || audio.durationSec <= 0 || audio.sampleRate <= 0 || audio.channels <= 0) throw new ArtifactValidationError("Narration audio stream metadata is invalid", { assetId: asset.id });
      if (video && Math.abs(video.durationSec - audio.durationSec) > requirements.avDurationToleranceSec) throw new ArtifactValidationError("Audio/video duration mismatch exceeds tolerance", { assetId: asset.id });
      if (!media.audioLoudness || media.audioLoudness.maxDb <= -40 || media.audioLoudness.meanDb <= -50) throw new ArtifactValidationError("Narration audio is materially silent", { assetId: asset.id });
    }
    if (media.decode?.video !== (requirements.kind === "audio" ? "not_required" : "passed") || media.decode?.audio !== (requirements.requiredAudio || requirements.kind === "audio" ? "passed" : "not_required")) throw new ArtifactValidationError("Full media decode evidence is missing", { assetId: asset.id });
    const provenance = typeof asset.sourceMetadata.provenance === "object" && asset.sourceMetadata.provenance !== null ? asset.sourceMetadata.provenance as TrustedValidationEvidence["provenance"] : undefined;
    const visualQualityReview = assessVisualQuality(media.visualAnalysis);
    const evidence: TrustedValidationEvidence = { source: "trusted-runtime", validator: "artifact-validation-service/ffprobe-ffmpeg", validatedAt: new Date().toISOString(), summary: "Trusted filesystem, FFprobe stream, FFmpeg decode, checksum, and provenance validation", sha256, byteSize, media: { mimeType: media.mimeType, durationSec: media.durationSec, width: media.width, height: media.height }, artifact: { id: asset.id, relativePath: asset.relativePath }, ...(provenance ? { provenance } : {}), checks: { container: "passed", codec: "passed", resolution: "passed", frameRate: "passed", duration: "passed", audio: requirements.requiredAudio ? "passed" : "not_required", audioDuration: requirements.requiredAudio ? "passed" : "not_required", avDuration: requirements.requiredAudio ? "passed" : "not_required", decode: "passed", checksum: "passed", fileIdentity: "passed", provenance: provenance ? "passed" : "not_required" }, probe: { ...media.raw, containerFormat: media.containerFormat, videoStreams: media.videoStreams, audioStreams: media.audioStreams, decode: media.decode, audioLoudness: media.audioLoudness, fileIdentity, visualQualityReview } };
    ValidationEvidenceSchema.parse(evidence);
    return evidence;
  }
}
