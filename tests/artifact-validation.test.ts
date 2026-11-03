import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactValidationError } from "../src/domain/errors.js";
import { ArtifactValidationService, defaultRenderRequirements, type MediaProbe, type MediaProbeResult } from "../src/services/artifact-validation.js";
import type { MediaAsset } from "../src/domain/types.js";

const roots: string[] = [];

function baseProbe(overrides: Partial<MediaProbeResult> = {}): MediaProbeResult {
  return {
    playable: true, mimeType: "video/mp4", durationSec: 24, width: 1080, height: 1920,
    containerFormat: "mov,mp4,m4a,3gp,3g2,mj2",
    videoStreams: [{ index: 0, codecName: "h264", durationSec: 24, width: 1080, height: 1920, frameRate: 30 }],
    audioStreams: [{ index: 1, codecName: "aac", durationSec: 23.99, sampleRate: 44100, channels: 2, channelLayout: "stereo" }],
    decode: { video: "passed", audio: "passed" }, audioLoudness: { meanDb: -19, maxDb: -5 }, raw: { fixture: true }, ...overrides
  };
}

function setup(probe: MediaProbe = { source: "trusted-runtime", inspect: () => baseProbe() }) {
  const root = mkdtempSync(join(tmpdir(), "channelforge-validation-")); roots.push(root);
  const directory = join(root, "jobs"); mkdirSync(directory, { recursive: true });
  const relativePath = "jobs/final.mp4"; const absolutePath = join(root, relativePath); const payload = Buffer.from("valid fixture bytes"); writeFileSync(absolutePath, payload);
  const asset: MediaAsset = { id: "asset-1", schemaVersion: 1, productionJobId: "job-1", type: "render", relativePath, mimeType: "video/mp4", sha256: createHash("sha256").update(payload).digest("hex"), byteSize: payload.byteLength, sourceProvider: "moneyprinterturbo", sourceMetadata: { provenance: { provider: "moneyprinterturbo", remoteTaskId: "task-1", correlationId: "corr-1", providerPath: "/tasks/task-1/final-1.mp4" } }, rightsStatus: "pending", validationStatus: "unvalidated", isSynthetic: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  return { root, absolutePath, asset, service: new ArtifactValidationService(root, probe) };
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("ArtifactValidationService", () => {
  it("accepts a valid narrated render and emits bounded trusted evidence", () => {
    const { service, asset } = setup();
    const evidence = service.validate(asset, { ...defaultRenderRequirements, targetDurationSec: 24, aspectRatio: "9:16" });
    expect(evidence.checks).toMatchObject({ audio: "passed", avDuration: "passed", decode: "passed", provenance: "passed" });
    expect(evidence.artifact).toEqual({ id: "asset-1", relativePath: "jobs/final.mp4" });
    expect(JSON.stringify(evidence)).not.toContain("valid fixture bytes");
  });

  it("rejects missing, silent, corrupt, wrong-codec, mismatched, and identity-invalid media", () => {
    const missingAudio = setup({ source: "trusted-runtime", inspect: () => baseProbe({ audioStreams: [], decode: { video: "passed", audio: "not_required" }, audioLoudness: undefined }) });
    expect(() => missingAudio.service.validate(missingAudio.asset)).toThrow("audio stream");
    const silent = setup({ source: "trusted-runtime", inspect: () => baseProbe({ audioLoudness: { meanDb: -70, maxDb: -55 } }) });
    expect(() => silent.service.validate(silent.asset)).toThrow("materially silent");
    const corrupt = setup({ source: "trusted-runtime", inspect: () => { throw new Error("ffprobe failed"); } });
    expect(() => corrupt.service.validate(corrupt.asset)).toThrow("ffprobe failed");
    const codec = setup({ source: "trusted-runtime", inspect: () => baseProbe({ videoStreams: [{ index: 0, codecName: "mpeg4", durationSec: 24, width: 1080, height: 1920, frameRate: 30 }] }) });
    expect(() => codec.service.validate(codec.asset)).toThrow("video codec");
    const mismatch = setup({ source: "trusted-runtime", inspect: () => baseProbe({ durationSec: 4 }) });
    expect(() => mismatch.service.validate(mismatch.asset, { ...defaultRenderRequirements, targetDurationSec: 24 })).toThrow("duration");
    const wrongIdentity = setup(); wrongIdentity.asset.sha256 = "f".repeat(64);
    expect(() => wrongIdentity.service.validate(wrongIdentity.asset)).toThrow("checksum");
  });

  it("rejects missing files, symlinks, and test probes", () => {
    const missing = setup(); rmSync(missing.absolutePath);
    expect(() => missing.service.validate(missing.asset)).toThrow(ArtifactValidationError);
    const linked = setup(); symlinkSync(linked.absolutePath, `${linked.absolutePath}.link`); linked.asset.relativePath = "jobs/final.mp4.link";
    expect(() => linked.service.validate(linked.asset)).toThrow(ArtifactValidationError);
    const testProbe = setup({ source: "test", inspect: () => baseProbe() });
    expect(() => testProbe.service.validate(testProbe.asset)).toThrow("Test media probes");
  });

  it("detects a file mutation during probing", () => {
    const fixture = setup({ source: "trusted-runtime", inspect: () => { writeFileSync(fixture.absolutePath, "changed bytes"); return baseProbe(); } });
    expect(() => fixture.service.validate(fixture.asset)).toThrow("changed during trusted validation");
  });
});
