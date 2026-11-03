import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateLocalMaterialManifest, type LocalMaterialManifest } from "../src/services/local-material-preflight.js";

const roots: string[] = [];

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "channelforge-local-preflight-"));
  roots.push(root);
  return root;
}

function manifest(root: string, relativePath = "scene-01.mp4", createFile = true): LocalMaterialManifest {
  const bytes = Buffer.from("isolated corrected material");
  if (createFile) writeFileSync(join(root, relativePath), bytes);
  return {
    materialRoot: root,
    expectedDurationSec: 2.8,
    clipDurationSec: 3,
    materials: [{
      relativePath,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteSize: bytes.byteLength,
      durationSec: 3,
      visualAnalysis: {
        sampleCount: 20,
        durationSec: 3,
        meanAbsoluteFrameDifferenceMean: 2,
        meanAbsoluteFrameDifferenceMax: 12,
        nearIdenticalPairRatio: 0,
        frameMeanRange: 30,
        frameStdDevRange: 10
      }
    }]
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("local material preflight", () => {
  it("fails closed when a required material is missing", () => {
    const root = fixtureRoot();
    expect(() => validateLocalMaterialManifest(manifest(root, "missing.mp4", false))).toThrow("unavailable");
  });

  it("fails closed when a placeholder-like material is review-flagged", () => {
    const root = fixtureRoot();
    const value = manifest(root);
    value.materials[0].visualAnalysis = { ...value.materials[0].visualAnalysis, meanAbsoluteFrameDifferenceMean: .001, meanAbsoluteFrameDifferenceMax: .01, nearIdenticalPairRatio: 1, frameMeanRange: .01, frameStdDevRange: .02 };
    expect(() => validateLocalMaterialManifest(value)).toThrow("requires visual review");
  });

  it("passes corrected materials after checksum, size, duration, and visual checks", () => {
    const root = fixtureRoot();
    const result = validateLocalMaterialManifest(manifest(root));
    expect(result.materialPaths).toEqual(["scene-01.mp4"]);
    expect(result.visualReviews[0].status).toBe("pass");
  });

  it("rejects invalid or unsafe references", () => {
    const root = fixtureRoot();
    expect(() => validateLocalMaterialManifest(manifest(root, "../escape.mp4"))).toThrow();
    const value = manifest(root);
    value.materials[0].sha256 = "0".repeat(64);
    expect(() => validateLocalMaterialManifest(value)).toThrow("checksum");
  });

  it("requires enough distinct material duration for the provider clip plan", () => {
    const root = fixtureRoot();
    const value = manifest(root);
    value.expectedDurationSec = 4;
    expect(() => validateLocalMaterialManifest(value)).toThrow("seconds are required");
  });
});
