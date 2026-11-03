import { resolve } from "node:path";
import { continueM5Live } from "../src/services/m5-live-continuation.js";

const ROOT = resolve(process.cwd());

try {
  const result = await continueM5Live({
    databasePath: resolve(ROOT, "m5-6f-live.94N1uK/isolated-channel-forge.sqlite"),
    workspacePath: resolve(ROOT, "m5-6f-live.94N1uK"),
    providerConfigPath: resolve(ROOT, "MoneyPrinterTurbo/config.toml"),
    jobId: "726f068f-770b-4450-a958-414bc27ef8a8",
    remoteTaskId: "2214a271-7ec1-47f1-ba8e-cfec04eb7dea",
    attemptId: "2c6eba77-9534-4f6b-8436-d252b6ea05de",
    correlationId: "channelforge-726f068f-770b-4450-a958-414bc27ef8a8-attempt-1",
    pollLimit: 8,
    pollDelayMs: 2_000
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(`M5 live continuation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
