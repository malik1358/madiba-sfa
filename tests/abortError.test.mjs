import test from "node:test";
import assert from "node:assert/strict";

import {
  REQUEST_TIMEOUT_MESSAGE,
  friendlyErrorMessage,
  isAbortError,
  toFriendlyAbortError,
} from "../app/lib/abortError.js";

test("isAbortError detects AbortError name and aborted messages", () => {
  assert.equal(isAbortError({ name: "AbortError", message: "" }), true);
  assert.equal(isAbortError({ name: "Error", message: "signal is aborted without reason" }), true);
  assert.equal(isAbortError({ name: "Error", message: "Unable to submit order." }), false);
});

test("toFriendlyAbortError replaces raw abort signal text", () => {
  const friendly = toFriendlyAbortError({ name: "AbortError", message: "signal is aborted without reason" });
  assert.equal(friendly.message, REQUEST_TIMEOUT_MESSAGE);
});

test("friendlyErrorMessage keeps non-abort errors", () => {
  assert.equal(
    friendlyErrorMessage({ message: "Credit control blocked this order." }),
    "Credit control blocked this order.",
  );
  assert.equal(
    friendlyErrorMessage({ message: "signal is aborted without reason" }),
    REQUEST_TIMEOUT_MESSAGE,
  );
});
