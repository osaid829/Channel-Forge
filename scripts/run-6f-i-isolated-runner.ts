import { resolve } from "node:path";
import { runM5IsolatedLive, runM5IsolatedOffline, type IsolatedRunnerMode } from "../src/services/m5-isolated-runner.js";

const ROOT = resolve(process.cwd());
const CONFIG_PATH = resolve(ROOT, "m5-6f-d-visuals.vel522fh/isolated-test-config.json");
const VALIDATION_PATH = resolve(ROOT, "m5-6f-d-visuals.vel522fh/material-validation.json");
const PROVIDER_CONFIG_PATH = resolve(ROOT, "MoneyPrinterTurbo/config.toml");

function fail(message: string): never {
  throw new Error(message);
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const live = args.includes("--live");
  const mode = (optionValue(args, "--mode") ?? "success") as IsolatedRunnerMode;
  if (live && args.includes("--mode")) fail("--live cannot be combined with an offline --mode.");
  if (!live && args.includes("--live")) fail("Invalid live mode.");
  if (!["success", "timeout", "interrupted"].includes(mode)) fail("Mode must be success, timeout, or interrupted.");
  if (live) {
    const result = await runM5IsolatedLive({
      configPath: CONFIG_PATH,
      validationPath: VALIDATION_PATH,
      providerConfigPath: PROVIDER_CONFIG_PATH,
      workspaceParent: ROOT,
      keepWorkspace: true
    });
    console.log(JSON.stringify(result));
    return;
  }
  const result = await runM5IsolatedOffline({
    configPath: CONFIG_PATH,
    validationPath: VALIDATION_PATH,
    workspaceParent: ROOT,
    mode,
    keepWorkspace: args.includes("--keep-workspace")
  });
  console.log(JSON.stringify(result));
}

try {
  await main();
} catch (error) {
  console.error(`6F-I isolated runner failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
