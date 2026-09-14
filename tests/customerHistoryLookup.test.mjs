import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCustomerHistoryCodeCandidates,
  customerCodeLooksLikeName,
  historyRowMatchesCodeCandidates,
  resolveCustomerHistoryName,
} from "../app/lib/customerHistoryLookup.js";

test("buildCustomerHistoryCodeCandidates extracts account code from dirty master codes", () => {
  assert.deepEqual(
    buildCustomerHistoryCodeCandidates("1409_RAWA'I"),
    ["1409_RAWA'I", "1409"],
  );
  assert.ok(buildCustomerHistoryCodeCandidates("1409 Rawa'i Al-Furs Trading Company").includes("1409"));
});

test("buildCustomerHistoryCodeCandidates keeps name-as-code values for later name fallback", () => {
  const candidates = buildCustomerHistoryCodeCandidates("Rawa'i Al-Furs Trading Company");
  assert.ok(candidates.includes("RAWA'I AL-FURS TRADING COMPANY"));
  assert.equal(candidates.some((code) => /^\d+$/.test(code)), false);
});

test("customerCodeLooksLikeName detects party names stored as customer codes", () => {
  assert.equal(customerCodeLooksLikeName("Rawa'i Al-Furs Trading Company"), true);
  assert.equal(customerCodeLooksLikeName("1409_RAWA'I"), false);
  assert.equal(customerCodeLooksLikeName("1409"), false);
});

test("resolveCustomerHistoryName uses master name and falls back to name-as-code", () => {
  assert.equal(
    resolveCustomerHistoryName("1409", "Rawa'i Al-Furs Trading Company"),
    "RAWA'I AL-FURS TRADING COMPANY",
  );
  assert.equal(
    resolveCustomerHistoryName("Rawa'i Al-Furs Trading Company", "", ""),
    "RAWA'I AL-FURS TRADING COMPANY",
  );
  assert.equal(
    resolveCustomerHistoryName("1409", "", "Rawa'i Al-Furs Trading Company"),
    "RAWA'I AL-FURS TRADING COMPANY",
  );
  assert.equal(resolveCustomerHistoryName("1409", "", ""), "");
});

test("historyRowMatchesCodeCandidates matches sales_raw rows under related codes", () => {
  const candidates = buildCustomerHistoryCodeCandidates("1409_RAWA'I");
  assert.equal(historyRowMatchesCodeCandidates("1409", candidates), true);
  assert.equal(historyRowMatchesCodeCandidates("1409 RAWA'I AL-FURS TRADING COMPANY", candidates), true);
  assert.equal(historyRowMatchesCodeCandidates("9999", candidates), false);
});
