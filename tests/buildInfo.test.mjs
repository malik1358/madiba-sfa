import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCacheBustingReloadUrl,
  resolveBuildId,
  resolveBuildTime,
  formatBuildDateTime,
} from "../app/lib/buildInfo.js";

test("resolveBuildId prefers Vercel commit sha", () => {
  assert.equal(
    resolveBuildId({
      VERCEL_GIT_COMMIT_SHA: "abcdef1234567890",
      NEXT_PUBLIC_BUILD_ID: "ignored",
    }),
    "abcdef1",
  );
});

test("resolveBuildId falls back to public build id", () => {
  assert.equal(
    resolveBuildId({
      NEXT_PUBLIC_BUILD_ID: "staging-build-42",
    }),
    "staging",
  );
});

test("resolveBuildTime reads public build time", () => {
  assert.equal(
    resolveBuildTime({
      NEXT_PUBLIC_BUILD_TIME: "2026-08-20T08:30:00.000Z",
    }),
    "2026-08-20T08:30:00.000Z",
  );
});

test("formatBuildDateTime formats build timestamp", () => {
  const formatted = formatBuildDateTime("2026-08-20T08:30:00.000Z", "en-GB");
  assert.match(formatted, /20 Aug 2026/);
  assert.match(formatted, /08:30|12:30/);
});

test("buildCacheBustingReloadUrl adds build query param", () => {
  assert.equal(
    buildCacheBustingReloadUrl("1e56c2b", "https://madiba-sfa.vercel.app/management/my-day"),
    "/management/my-day?_build=1e56c2b",
  );
});
