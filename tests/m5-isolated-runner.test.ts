import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteDatabase } from "../src/db/database.js";
import { ProductionService } from "../src/services/production-service.js";
import { journaledSubmissionProvider } from "../src/services/journaled-submission-provider.js";
import type { ProductionProvider, ProviderProductionRequest } from "../src/services/production-provider.js";
import { runM5IsolatedOffline } from "../src/services/m5-isolated-runner.js";

const execFileAsync = promisify(execFile);
const ROOT = resolve(process.cwd());
const CONFIG_PATH = resolve(ROOT, "m5-6f-d-visuals.vel522fh/isolated-test-config.json");
const VALIDATION_PATH = resolve(ROOT, "m5-6f-d-visuals.vel522fh/material-validation.json");
const temporaryRoots: string[] = [];
const databases: SqliteDatabase[] = [];

function workspaceParent(): string {
  const root = mkdtempSync(join(tmpdir(), "channelforge-6f-i-test-"));
  temporaryRoots.push(root);
  return root;
}

function directSubmissionInput(): Omit<ProviderProductionRequest, "correlationId"> {
  return {
    topic: "Why is the sky blue?",
    script: "Air scatters blue wavelengths.",
    videoTerms: ["sky", "scattering"],
    language: "en",
    aspectRatio: "9:16",
    targetDurationSec: 3,
    videoSource: "local",
    videoMaterials: [{ provider: "local", url: "scene-01.mp4" }],
    voiceName: "kokoro:af_heart",
    subtitleEnabled: false,
    backgroundMusic: ""
  };
}

function directJob(root: string) {
  const database = new SqliteDatabase(join(root, "database.sqlite"));
  databases.push(database);
  const service = new ProductionService(database);
  const channel = service.createChannel({ slug: `6f-i-${Date.now()}`, platform: "youtube", locale: "en-US", audience: "science learners", contentPillars: ["science"], brand: { voice: "clear", visualStyle: "educational", bannedTopics: [] }, policy: { defaultPrivacy: "private", humanApprovalRequired: true, factualReviewRequired: true, rightsReviewRequired: true }, credentialsRef: { youtube: "secret://6f-i-test" }, status: "active" });
  const brief = service.createBrief({ channelId: channel.id, topic: "Why is the sky blue?", angle: "Rayleigh scattering", hook: "Air scatters blue light.", format: "short", language: "en", aspectRatio: "9:16", targetDurationSec: 3, audiencePromise: "Learn the core idea.", contentPillars: ["science"], status: "ready" });
  const job = service.createProductionJob({ channelId: channel.id, briefId: brief.id, renderer: "moneyprinterturbo", idempotencyKey: `6f-i-${Date.now()}-${Math.random()}` });
  for (const state of ["PLANNING", "NARRATING", "SOURCING", "CAPTIONING", "RENDERING"] as const) service.transitionJob(job.id, state);
  return { service, job };
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Operation 6F-I isolated runner", () => {
  it("preflights all eight scenes and captures the adapter-generated sequential payload", async () => {
    const result = await runM5IsolatedOffline({ configPath: CONFIG_PATH, validationPath: VALIDATION_PATH, workspaceParent: workspaceParent() });
    expect(result.providerRunState).toBe("accepted");
    expect(result.jobState).toBe("RENDERING");
    expect(result.providerCalls).toBe(1);
    expect(result.remoteTaskId).toBe("mock-6f-i-task");
    expect(result.preflight.materialCount).toBe(8);
    expect(result.preflight.totalDeclaredDurationSec).toBe(24);
    expect(result.preflight.decodeEvidenceCount).toBe(8);
    expect(result.preflight.visualQualityStatuses).toEqual(Array(8).fill("pass"));
    expect(result.journalStages).toEqual(["PREPARED", "REQUEST_STARTED", "RESPONSE_RECEIVED", "ACKNOWLEDGEMENT_PERSISTED"]);
    expect(result.duplicateSubmissionPrevented).toBe(true);
    expect(result.workspaceCleaned).toBe(true);
    expect(result.providerPayload).toMatchObject({ video_source: "local", video_clip_duration: 3, video_count: 1, video_concat_mode: "sequential", voice_name: "kokoro:af_heart", subtitle_enabled: false, bgm_type: "" });
    expect(result.providerPayload?.video_materials).toEqual(result.preflight.materialPaths.map((url) => ({ provider: "local", url, duration: 3 })));
    expect(JSON.stringify(result.providerPayload?.video_materials)).not.toContain("9ea6776fa37842d1be8ef1846019e15c");
  });

  it("keeps timeout outcomes UNKNOWN and blocks an automatic retry", async () => {
    const result = await runM5IsolatedOffline({ configPath: CONFIG_PATH, validationPath: VALIDATION_PATH, workspaceParent: workspaceParent(), mode: "timeout" });
    expect(result.providerRunState).toBe("unknown");
    expect(result.remoteTaskId).toBeUndefined();
    expect(result.providerCalls).toBe(1);
    expect(result.journalStages).toEqual(["PREPARED", "REQUEST_STARTED", "RESPONSE_RECEIVED"]);
    expect(result.duplicateSubmissionPrevented).toBe(true);
  });

  it("recovers an interrupted submission as UNKNOWN without retrying", async () => {
    const result = await runM5IsolatedOffline({ configPath: CONFIG_PATH, validationPath: VALIDATION_PATH, workspaceParent: workspaceParent(), mode: "interrupted" });
    expect(result.jobState).toBe("FAILED");
    expect(result.providerRunState).toBe("unknown");
    expect(result.journalStages).toEqual(["PREPARED", "REQUEST_STARTED"]);
    expect(result.duplicateSubmissionPrevented).toBe(true);
  });

  it("does not transmit when PREPARED journaling fails", async () => {
    const root = workspaceParent();
    const { service, job } = directJob(root);
    const journalPath = join(root, "journal-file");
    writeFileSync(journalPath, "not a directory");
    let calls = 0;
    const baseProvider: ProductionProvider = {
      name: "moneyprinterturbo",
      submitProduction: async () => {
        calls += 1;
        return { state: "accepted", providerPayload: {} };
      },
      getProductionStatus: async () => { throw new Error("not used"); },
      getProductionArtifacts: async () => { throw new Error("not used"); },
      cancelProduction: async () => ({ state: "unsupported" })
    };
    const provider = journaledSubmissionProvider(service, job.id, baseProvider, journalPath, "manifest");
    await service.submitProduction(job.id, directSubmissionInput(), provider);
    expect(calls).toBe(0);
    expect(service.getProviderRun(job.id)?.state).toBe("failed");
  });

  it("runs the dedicated child runner to normal exit and cleans its workspace", async () => {
    const { stdout } = await execFileAsync(process.execPath, ["scripts/run-file-backed-submission-harness.mjs", "scripts/run-6f-i-isolated-runner.ts", "--mode", "success"], { cwd: ROOT, timeout: 120000, maxBuffer: 1024 * 1024 });
    const result = JSON.parse(stdout.trim()) as { providerRunState: string; providerCalls: number; journalStages: string[]; workspaceCleaned: boolean };
    expect(result.providerRunState).toBe("accepted");
    expect(result.providerCalls).toBe(1);
    expect(result.journalStages).toHaveLength(4);
    expect(result.workspaceCleaned).toBe(true);
  });
});
