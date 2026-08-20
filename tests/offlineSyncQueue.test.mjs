import test from "node:test";
import assert from "node:assert/strict";

import { isOfflineLikeError } from "../app/lib/offlineSyncQueue.js";

test("isOfflineLikeError detects browser network failures", () => {
  assert.equal(isOfflineLikeError(new Error("Failed to fetch")), true);
  assert.equal(isOfflineLikeError(new Error("Validation failed")), false);
});
