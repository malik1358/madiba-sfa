import test from "node:test";
import assert from "node:assert/strict";

import { resolveBuildId } from "../app/lib/buildInfo.js";

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
