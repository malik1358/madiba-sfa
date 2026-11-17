#!/usr/bin/env node
// Auto-sync the local workspace with origin/main when the editor opens
// (.vscode/tasks.json runs this on folderOpen in VS Code and Cursor).
// Safe by design: it only fast-forwards a clean `main` checkout. Detached
// HEADs, dirty trees, diverged main, and feature branches are reported
// loudly but never touched.
import { execFileSync } from "node:child_process";

function git(...args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function warn(lines) {
  const border = "!".repeat(72);
  console.warn(`\n${border}\n${lines.filter(Boolean).join("\n")}\n${border}\n`);
}

try {
  git("rev-parse", "--is-inside-work-tree");
} catch {
  process.exit(0);
}

try {
  git("fetch", "origin", "main");
} catch {
  console.warn("[sync-workspace] Could not fetch origin/main (offline?). Skipped.");
  process.exit(0);
}

let branch = "";
try {
  branch = git("rev-parse", "--abbrev-ref", "HEAD");
} catch {
  branch = "HEAD";
}

const dirty = git("status", "--porcelain") !== "";
const behind = Number(git("rev-list", "--count", "HEAD..origin/main"));
const ahead = Number(git("rev-list", "--count", "origin/main..HEAD"));

if (branch === "HEAD") {
  warn([
    "[sync-workspace] DETACHED HEAD checkout!",
    `This workspace is ${behind} commit(s) behind origin/main.`,
    "Do not edit here. Check out a branch first:",
    "  git checkout main; git pull --ff-only",
  ]);
  process.exit(0);
}

if (branch === "main") {
  if (behind === 0) {
    console.log("[sync-workspace] main is up to date with origin/main.");
  } else if (!dirty && ahead === 0) {
    git("merge", "--ff-only", "origin/main");
    console.log(`[sync-workspace] Fast-forwarded main by ${behind} commit(s) to origin/main.`);
  } else {
    warn([
      `[sync-workspace] main is ${behind} commit(s) behind origin/main and was NOT auto-synced:`,
      dirty ? "- the working tree has uncommitted changes" : "",
      ahead > 0 ? `- main has ${ahead} local commit(s) not on origin/main` : "",
      "Commit/stash (and push or branch off local commits), then run: git pull --ff-only",
    ]);
  }
  process.exit(0);
}

// Feature branch: never touch it, just report drift against origin/main.
if (behind > 0) {
  console.log(
    `[sync-workspace] Branch '${branch}' is ${behind} commit(s) behind origin/main (ahead ${ahead}). Rebase or merge main before opening a PR if needed.`,
  );
} else {
  console.log(`[sync-workspace] Branch '${branch}' is up to date with origin/main.`);
}
