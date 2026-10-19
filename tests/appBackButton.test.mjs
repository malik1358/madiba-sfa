import test from "node:test";
import assert from "node:assert/strict";

import { resolveBackFallbackPath } from "../app/lib/navigation.js";

test("resolveBackFallbackPath returns null on home", () => {
  assert.equal(resolveBackFallbackPath("/"), null);
});

test("resolveBackFallbackPath returns home from management panel", () => {
  assert.equal(resolveBackFallbackPath("/management"), "/");
});

test("resolveBackFallbackPath returns parent management route", () => {
  assert.equal(resolveBackFallbackPath("/management/my-day"), "/management");
  assert.equal(resolveBackFallbackPath("/management/payment-collections/legal"), "/management/payment-collections");
});
