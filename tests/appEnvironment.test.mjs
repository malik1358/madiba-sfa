import test from "node:test";
import assert from "node:assert/strict";

import {
  isNonProductionAppEnv,
  normalizeAppEnv,
  resolveAppEnvironmentLabel,
} from "../app/lib/appEnvironment.js";

test("normalizeAppEnv trims and lowercases", () => {
  assert.equal(normalizeAppEnv({ NEXT_PUBLIC_APP_ENV: " Local " }), "local");
  assert.equal(normalizeAppEnv({}), "");
});

test("local development and legacy staging are non-production", () => {
  assert.equal(isNonProductionAppEnv({ NEXT_PUBLIC_APP_ENV: "local" }), true);
  assert.equal(isNonProductionAppEnv({ NEXT_PUBLIC_APP_ENV: "development" }), true);
  assert.equal(isNonProductionAppEnv({ NEXT_PUBLIC_APP_ENV: "dev" }), true);
  assert.equal(isNonProductionAppEnv({ NEXT_PUBLIC_APP_ENV: "staging" }), true);
});

test("production and unset are production labels", () => {
  assert.equal(isNonProductionAppEnv({ NEXT_PUBLIC_APP_ENV: "production" }), false);
  assert.equal(isNonProductionAppEnv({}), false);
  assert.equal(resolveAppEnvironmentLabel({ NEXT_PUBLIC_APP_ENV: "production" }), "PRODUCTION");
  assert.equal(resolveAppEnvironmentLabel({}), "PRODUCTION");
  assert.equal(resolveAppEnvironmentLabel({ NEXT_PUBLIC_APP_ENV: "local" }), "LOCAL");
});
