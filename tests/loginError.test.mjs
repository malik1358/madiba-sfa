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