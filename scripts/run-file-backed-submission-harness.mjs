import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const entryPoint = resolve(process.argv[2] ?? "tests/fixtures/file-backed-submission-child.ts");
const childArgs = process.argv.slice(3);
const root = await mkdtemp(join(process.cwd(), ".channelforge-file-harness-"));
const output = join(root, "runner.mjs");

try {
  await build({
    entryPoints: [entryPoint],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    loader: { ".ts": "ts" },
    external: ["better-sqlite3", "zod"],
    logLevel: "error"
  });
  const code = await new Promise((resolveCode, rejectCode) => {
    const child = spawn(process.execPath, [output, ...childArgs], { stdio: "inherit" });
    child.once("error", rejectCode);
    child.once("exit", (exitCode, signal) => resolveCode(signal ? 1 : (exitCode ?? 1)));
  });
  process.exitCode = code;
} finally {
  await rm(root, { recursive: true, force: true });
}
