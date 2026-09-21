import test from "node:test";
import assert from "node:assert/strict";

import {
  PRODUCTION_SUPABASE_PROJECT_REF,
  assertSupabaseUrlAllowed,
  extractSupabaseProjectRef,
  isProductionSupabaseUrl,
  shouldEnforceLocalSupabaseGuard,
} from "../app/lib/supabaseGuard.js";

const PROD_URL = `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`;
const LOCAL_URL = "http://127.0.0.1:54321";

test("extractSupabaseProjectRef reads api and db hosts", () => {
  assert.equal(extractSupabaseProjectRef(PROD_URL), PRODUCTION_SUPABASE_PROJECT_REF);
  assert.equal(
    extractSupabaseProjectRef(`https://db.${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`),
    PRODUCTION_SUPABASE_PROJECT_REF,
  );
  assert.equal(extractSupabaseProjectRef(LOCAL_URL), "");
  assert.equal(extractSupabaseProjectRef(""), "");
});

test("isProductionSupabaseUrl matches production project only", () => {
  assert.equal(isProductionSupabaseUrl(PROD_URL), true);
  assert.equal(isProductionSupabaseUrl(LOCAL_URL), false);
  assert.equal(isProductionSupabaseUrl("https://otherproject.supabase.co"), false);
});

test("Vercel production does not enforce the local guard", () => {
  assert.equal(
    shouldEnforceLocalSupabaseGuard({ VERCEL_ENV: "production", NODE_ENV: "production" }),
    false,
  );
});

test("local and development enforce the guard", () => {
  assert.equal(shouldEnforceLocalSupabaseGuard({ NEXT_PUBLIC_APP_ENV: "local" }), true);
  assert.equal(shouldEnforceLocalSupabaseGuard({ NODE_ENV: "development" }), true);
  assert.equal(shouldEnforceLocalSupabaseGuard({}), true);
});

test("allowed local/dev URL does not throw", () => {
  assert.doesNotThrow(() =>
    assertSupabaseUrlAllowed(LOCAL_URL, { NEXT_PUBLIC_APP_ENV: "local", NODE_ENV: "development" }),
  );
});

test("production URL is blocked in local/development", () => {
  assert.throws(
    () => assertSupabaseUrlAllowed(PROD_URL, { NEXT_PUBLIC_APP_ENV: "local", NODE_ENV: "development" }),
    /Production Supabase is blocked/,
  );
  assert.throws(
    () => assertSupabaseUrlAllowed(PROD_URL, { NODE_ENV: "development" }),
    /Production Supabase is blocked/,
  );
});

test("production URL is allowed on Vercel production", () => {
  assert.doesNotThrow(() =>
    assertSupabaseUrlAllowed(PROD_URL, {
      VERCEL_ENV: "production",
      NEXT_PUBLIC_APP_ENV: "production",
      NODE_ENV: "production",
    }),
  );
});

test("emergency override allows production URL locally", () => {
  assert.doesNotThrow(() =>
    assertSupabaseUrlAllowed(PROD_URL, {
      NODE_ENV: "development",
      MADIBA_ALLOW_PRODUCTION_SUPABASE: "1",
    }),
  );
});
