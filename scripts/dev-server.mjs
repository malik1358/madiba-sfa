import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DEV_PORT, killProcessOnPort } from "./dev-port.mjs";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function warnIfEnvMissing() {
  const envPath = path.join(repoRoot, ".env.local");
  if (existsSync(envPath)) return;

  console.warn("");
  console.warn("Warning: .env.local was not found.");
  console.warn("Copy .env.example to .env.local before running the app locally.");
  console.warn("");
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const port = Number(process.env.PORT || DEFAULT_DEV_PORT);
  const shouldClean = args.has("--clean");

  process.chdir(repoRoot);
  warnIfEnvMissing();

  if (shouldClean) {
    rmSync(path.join(repoRoot, ".next"), { recursive: true, force: true });
    console.log("Removed .next cache.");
  }

  killProcessOnPort(port);
  await sleep(400);

  console.log(`Starting MADIBA SFA dev server at http://localhost:${port}`);

  const child = spawn(process.execPath, [nextBin, "dev", "-p", String(port)], {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: String(port),
    },
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
