import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SqliteDatabase } from "./src/db/database.js";
import {
  ChannelRepository,
  ContentBriefRepository,
  ProductionJobRepository
} from "./src/db/repositories.js";
import { ProductionService } from "./src/services/production-service.js";
import { MoneyPrinterTurboAdapter } from "./src/services/moneyprinterturbo-adapter.js";
import {
  ProviderProductionRequestSchema,
  type ProviderProductionRequest
} from "./src/services/production-provider.js";

const ROOT = "/Users/osaid/Documents/ChannelForge";
const DATABASE_PATH = resolve(ROOT, "m5-channel-forge.sqlite");
const ARTIFACT_ROOT = resolve(ROOT, "m5-artifacts");
const MONEY_PRINTER_CONFIG = resolve(
  ROOT,
  "MoneyPrinterTurbo/config.toml"
);

const CHANNEL_ID = "m5-sky-blue-channel";
const BRIEF_ID = "m5-sky-blue-brief";
const JOB_ID = "m5-sky-blue-job";
const IDEMPOTENCY_KEY = "m5-sky-blue-local-visual-v1";
const RENDERER = "moneyprinterturbo";
const MATERIAL_FILENAME = "9ea6776fa37842d1be8ef1846019e15c.mp4";

const SCRIPT =
  "Why is the sky blue? Sunlight may look white, but it contains many colors. " +
  "As sunlight travels through Earth's atmosphere, tiny air molecules scatter " +
  "shorter blue wavelengths more strongly than longer red wavelengths. That " +
  "scattered blue light reaches our eyes from across the sky. Near sunset, " +
  "sunlight takes a longer path through air, leaving warmer colors more noticeable.";

const productionInput = {
  topic: "Why is the sky blue?",
  script: SCRIPT,
  videoTerms: ["sunlight", "atmosphere", "Rayleigh scattering"],
  language: "en",
  aspectRatio: "9:16" as const,
  targetDurationSec: 24,
  videoSource: "local" as const,
  videoMaterials: [
    {
      provider: "local" as const,
      url: MATERIAL_FILENAME
    }
  ],
  voiceName: "kokoro:af_heart",
  subtitleEnabled: false,
  backgroundMusic: "" as const
};

type ProductionInput = Omit<ProviderProductionRequest, "correlationId">;

function fail(message: string): never {
  throw new Error(message);
}

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`Existing ${label} does not match the canonical M5 record.`);
  }
}

function validateInput(): ProductionInput {
  const parsed = ProviderProductionRequestSchema.parse({
    ...productionInput,
    correlationId: "m5-dry-run-validation"
  });
  const { correlationId: _correlationId, ...withoutCorrelationId } = parsed;
  return withoutCorrelationId;
}

function canonicalChannelInput() {
  return {
    id: CHANNEL_ID,
    slug: "m5-sky-blue",
    platform: "youtube" as const,
    locale: "en-US",
    audience: "General audiences learning basic science",
    contentPillars: ["science", "atmosphere"],
    brand: {
      voice: "Clear, accurate, and concise educational narration",
      visualStyle: "Minimal vertical educational cards",
      bannedTopics: []
    },
    policy: {
      defaultPrivacy: "private" as const,
      humanApprovalRequired: true as const,
      factualReviewRequired: true,
      rightsReviewRequired: true
    },
    credentialsRef: {
      youtube: "secret://youtube/channelforge-m5"
    },
    status: "active" as const
  };
}

function canonicalBriefInput() {
  return {
    id: BRIEF_ID,
    channelId: CHANNEL_ID,
    topic: "Why is the sky blue?",
    angle: "A concise explanation of Rayleigh scattering",
    hook: "The sky looks blue because air scatters some colors more strongly than others.",
    format: "short" as const,
    language: "en",
    aspectRatio: "9:16" as const,
    targetDurationSec: 24,
    audiencePromise: "Understand the basic science behind the daytime sky in under half a minute.",
    contentPillars: ["science", "atmosphere"],
    claimIds: [],
    evidenceIds: [],
    status: "ready" as const
  };
}

function canonicalJobInput() {
  return {
    id: JOB_ID,
    channelId: CHANNEL_ID,
    briefId: BRIEF_ID,
    renderer: RENDERER,
    idempotencyKey: IDEMPOTENCY_KEY
  };
}

function prepareCanonicalRecords(db: SqliteDatabase): void {
  const channels = new ChannelRepository(db);
  const briefs = new ContentBriefRepository(db);
  const jobs = new ProductionJobRepository(db);

  const channelInput = canonicalChannelInput();
  const channel = channels.getById(CHANNEL_ID) ?? channels.create(channelInput);
  assertEqual("channel", channel, channels.getById(CHANNEL_ID));
  assertEqual("channel", channel.slug, channelInput.slug);
  assertEqual("channel", channel.platform, channelInput.platform);
  assertEqual("channel", channel.locale, channelInput.locale);
  assertEqual("channel", channel.audience, channelInput.audience);
  assertEqual("channel", channel.contentPillars, channelInput.contentPillars);
  assertEqual("channel", channel.brand, channelInput.brand);
  assertEqual("channel", channel.policy, channelInput.policy);
  assertEqual("channel", channel.credentialsRef, channelInput.credentialsRef);
  assertEqual("channel", channel.status, channelInput.status);

  const briefInput = canonicalBriefInput();
  const brief = briefs.getById(BRIEF_ID) ?? briefs.create(briefInput);
  assertEqual("brief channel", brief.channelId, CHANNEL_ID);
  assertEqual("brief", brief.topic, briefInput.topic);
  assertEqual("brief", brief.angle, briefInput.angle);
  assertEqual("brief", brief.hook, briefInput.hook);
  assertEqual("brief", brief.format, briefInput.format);
  assertEqual("brief", brief.language, briefInput.language);
  assertEqual("brief", brief.aspectRatio, briefInput.aspectRatio);
  assertEqual("brief", brief.targetDurationSec, briefInput.targetDurationSec);
  assertEqual("brief", brief.audiencePromise, briefInput.audiencePromise);
  assertEqual("brief", brief.contentPillars, briefInput.contentPillars);
  assertEqual("brief", brief.claimIds, briefInput.claimIds);
  assertEqual("brief", brief.evidenceIds, briefInput.evidenceIds);
  assertEqual("brief", brief.status, briefInput.status);

  const jobInput = canonicalJobInput();
  const job = jobs.getById(JOB_ID) ?? jobs.create(jobInput);
  assertEqual("job channel", job.channelId, jobInput.channelId);
  assertEqual("job brief", job.briefId, jobInput.briefId);
  assertEqual("job renderer", job.renderer, jobInput.renderer);
  assertEqual("job idempotency key", job.idempotencyKey, jobInput.idempotencyKey);

  console.log(`Prepared canonical records: channel=${channel.id}, brief=${brief.id}, job=${job.id}`);
  console.log(`Initial job state: ${job.currentState}`);
  console.log("Provider submission: NO");
}

async function readMoneyPrinterApiKey(): Promise<string> {
  const source = await readFile(MONEY_PRINTER_CONFIG, "utf8");
  const appSection = source.match(/(?:^|\n)\[app\]\s*\n([\s\S]*?)(?=\n\[[^\n]+\]|$)/)?.[1];
  const match = appSection?.match(/^api_key\s*=\s*"([^"]+)"\s*$/m);
  if (!match?.[1]) fail("MoneyPrinterTurbo API key is unavailable.");
  return match[1];
}

function advanceToRendering(service: ProductionService, jobId: string): void {
  const path = [
    "PLANNING",
    "NARRATING",
    "SOURCING",
    "CAPTIONING",
    "RENDERING"
  ] as const;

  let job = service.getJob(jobId);
  if (["FAILED", "CANCELLED", "VALIDATING", "REVIEW", "APPROVED"].includes(job.currentState)) {
    fail(`Canonical job cannot be submitted from state ${job.currentState}.`);
  }

  for (const nextState of path) {
    if (job.currentState === nextState) continue;
    const stateIndex = path.indexOf(job.currentState as (typeof path)[number]);
    const nextIndex = path.indexOf(nextState);
    if (job.currentState !== "CREATED" && (stateIndex < 0 || nextIndex !== stateIndex + 1)) {
      fail(`Canonical job has unexpected state ${job.currentState}.`);
    }
    job = service.transitionJob(jobId, nextState, `M5 runner advanced to ${nextState}`);
  }
}

async function submit(jobId: string): Promise<void> {
  if (jobId !== JOB_ID) fail(`Only the canonical M5 job may be submitted: ${JOB_ID}.`);

  const input = validateInput();
  const apiKey = await readMoneyPrinterApiKey();
  const database = new SqliteDatabase(DATABASE_PATH);

  try {
    const service = new ProductionService(database);
    const job = service.getJob(JOB_ID);
    if (job.channelId !== CHANNEL_ID || job.briefId !== BRIEF_ID || job.renderer !== RENDERER) {
      fail("Canonical job associations do not match the M5 runner contract.");
    }

    advanceToRendering(service, JOB_ID);
    const provider = new MoneyPrinterTurboAdapter({
      apiKey,
      baseUrl: "http://127.0.0.1:8080",
      artifactRoot: ARTIFACT_ROOT
    });
    const run = await service.submitProduction(JOB_ID, input, provider);

    console.log(`Production submission state: ${run.state}`);
    console.log(`Production job: ${JOB_ID}`);
    if (run.remoteTaskId) console.log(`Provider task: ${run.remoteTaskId}`);
    console.log("Submission attempts from this runner: 1");
    console.log("Automatic UNKNOWN retry: NO");
    console.log("API key disclosed: NO");
  } finally {
    database.close();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--dry-run") {
    validateInput();
    console.log("M5 production request schema validation: PASS");
    console.log("Database opened: NO");
    console.log("Provider submission: NO");
    console.log("API key read: NO");
    return;
  }

  if (args.length === 1 && args[0] === "--prepare") {
    validateInput();
    const database = new SqliteDatabase(DATABASE_PATH);
    try {
      prepareCanonicalRecords(database);
    } finally {
      database.close();
    }
    return;
  }

  if (args.length === 2 && args[0] === "--submit") {
    await submit(args[1]);
    return;
  }

  fail("Select exactly one mode: --dry-run, --prepare, or --submit m5-sky-blue-job.");
}

try {
  await main();
} catch (error) {
  console.error(`M5 runner failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
}
