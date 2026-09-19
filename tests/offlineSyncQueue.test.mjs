import test from "node:test";
import assert from "node:assert/strict";

import { isOfflineLikeError } from "../app/lib/offlineSyncQueue.js";
import { resolveUploadContentType } from "../app/lib/collectionUploadFile.js";

test("isOfflineLikeError detects browser network failures", () => {
  assert.equal(isOfflineLikeError(new Error("Failed to fetch")), true);
  assert.equal(isOfflineLikeError(new Error("Validation failed")), false);
});

test("offline payload MIME helper maps Android PDF octet-stream by name", () => {
  assert.equal(
    resolveUploadContentType({ name: "FundsReceived.pdf", type: "application/octet-stream" }),
    "application/pdf",
  );
});
