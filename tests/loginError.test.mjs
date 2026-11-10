import test from "node:test";
import assert from "node:assert/strict";

import { loginErrorMessage } from "../app/lib/loginError.js";

test("network failures do not claim the password is wrong", () => {
  assert.match(loginErrorMessage({ name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 }), /Cannot reach/);
  assert.match(loginErrorMessage({ message: "NetworkError when attempting to fetch resource." }, true), /تعذر الاتصال/);
});

test("rejected credentials retain the invalid login message", () => {
  assert.equal(loginErrorMessage({ name: "AuthApiError", message: "Invalid login credentials", status: 400 }), "Incorrect email or password");
});

test("Supabase egress / spend-cap blocks do not look like a wrong password", () => {
  const quotaError = {
    name: "AuthApiError",
    status: 402,
    message: "Service for this project is restricted due to the following violations: exceed_egress_quota. The project owner must upgrade their plan or remove spend caps to restore service.",
  };
  assert.match(loginErrorMessage(quotaError), /usage limit/i);
  assert.match(loginErrorMessage(quotaError, true), /حد الاستخدام/);
  assert.doesNotMatch(loginErrorMessage(quotaError), /Incorrect email or password/);
});
