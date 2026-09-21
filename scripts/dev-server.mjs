import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DEV_PORT, killProcessOnPort } from "./dev-port.mjs";
import { assertConfiguredSupabaseUrlAllowed } from "../app/lib/supabaseGuard.js";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadEnvLocal() {
  const envPath = path.join(repoRoot, ".env.local");
  if (!existsSync(envPath)) return false;

  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const separator = trimmed.indexOf("=");
      if (separator <= 0) return;
      const key = trimmed.slice(0, separator).trim();
      let value = trimmed.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    });

  return true;
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
  if (loadEnvLocal()) {
    assertConfiguredSupabaseUrlAllowed();
  }

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
