import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { assertSafeRelativePath } from "../db/repositories.js";
import { assessVisualQuality, type VisualFrameAnalysis, type VisualQualityAssessment } from "./visual-quality-gate.js";

export interface LocalMaterialManifestEntry {
  relativePath: string;
  sha256: string;
  byteSize: number;
  durationSec: number;
  visualAnalysis: VisualFrameAnalysis;
}

export interface LocalMaterialManifest {
  materialRoot: string;
  expectedDurationSec: number;
  clipDurationSec: number;
  materials: LocalMaterialManifestEntry[];
}

export interface LocalMaterialPreflightResult {
  materialPaths: string[];
  visualReviews: VisualQualityAssessment[];
  totalDeclaredDurationSec: number;
}

function contains(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value === "" || (!isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`));
}

function digest(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function validateLocalMaterialManifest(manifest: LocalMaterialManifest): LocalMaterialPreflightResult {
  if (!Number.isFinite(manifest.expectedDurationSec) || manifest.expectedDurationSec <= 0) throw new Error("Expected production duration must be positive.");
  if (!Number.isFinite(manifest.clipDurationSec) || manifest.clipDurationSec <= 0) throw new Error("Provider clip duration must be positive.");
  if (!manifest.materials.length) throw new Error("At least one local material is required.");

  const root = realpathSync(manifest.materialRoot);
  const seen = new Set<string>();
  const visualReviews: VisualQualityAssessment[] = [];
  let totalDeclaredDurationSec = 0;

  for (const material of manifest.materials) {
    const relativePath = assertSafeRelativePath(material.relativePath);
    if (seen.has(relativePath)) throw new Error(`Duplicate local material: ${relativePath}`);
    seen.add(relativePath);
    const absolutePath = resolve(root, relativePath);
    if (!contains(root, absolutePath) || !existsSync(absolutePath)) throw new Error(`Required local material is unavailable: ${relativePath}`);
    const stat = lstatSync(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(absolutePath) !== absolutePath) throw new Error(`Local material is not a regular non-symlink file: ${relativePath}`);
    if (!Number.isInteger(material.byteSize) || material.byteSize <= 0 || stat.size !== material.byteSize) throw new Error(`Local material byte size changed: ${relativePath}`);
    if (digest(absolutePath) !== material.sha256.toLowerCase()) throw new Error(`Local material checksum changed: ${relativePath}`);
    if (!Number.isFinite(material.durationSec) || material.durationSec <= 0) throw new Error(`Local material duration is invalid: ${relativePath}`);
    const visualReview = assessVisualQuality(material.visualAnalysis);
    if (visualReview.status !== "pass") throw new Error(`Local material requires visual review: ${relativePath}`);
    visualReviews.push(visualReview);
    totalDeclaredDurationSec += material.durationSec;
  }

  // The provider adds its own 0.10s safety margin to the measured narration
  // duration. Require declared material coverage for the requested target, which
  // prevents the original short-clip loop without inventing extra source time.
  const requiredCoverage = manifest.expectedDurationSec;
  if (totalDeclaredDurationSec < requiredCoverage) throw new Error(`Local materials provide ${totalDeclaredDurationSec.toFixed(2)} seconds; ${requiredCoverage.toFixed(2)} seconds are required.`);
  return { materialPaths: [...seen], visualReviews, totalDeclaredDurationSec };
}
