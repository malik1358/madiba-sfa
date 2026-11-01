import test from "node:test";
import assert from "node:assert/strict";

import {
  canServePreparedOverviewSlice,
  deserializePreparedOverviewBundle,
  isPreparedOverviewFilters,
  pickPreparedOverviewSlice,
  preparedOverviewBundleIsFresh,
  preparedOverviewFingerprint,
  serializePreparedOverviewBundle,
} from "../app/lib/biPreparedBundle.js";
import { emptyGrowthFilters } from "../app/lib/categoryGrowth.js";

test("prepared overview filters accept only all-time empty filters", () => {
  assert.equal(isPreparedOverviewFilters(emptyGrowthFilters()), true);
  assert.equal(isPreparedOverviewFilters({ ...emptyGrowthFilters(), dateFrom: "2026-01-01" }), false);
  assert.equal(isPreparedOverviewFilters({ ...emptyGrowthFilters(), itemNameContains: "MADIBA" }), false);
  assert.equal(isPreparedOverviewFilters({ ...emptyGrowthFilters(), values: { category: ["Paper"] } }), false);
  assert.equal(canServePreparedOverviewSlice({ ...emptyGrowthFilters(), groupBy: "salesman" }), true);
  assert.equal(canServePreparedOverviewSlice({ ...emptyGrowthFilters(), itemNameContains: "MADIBA" }), true);
  assert.equal(canServePreparedOverviewSlice({ ...emptyGrowthFilters(), dateFrom: "2026-01-01" }), false);
  assert.equal(pickPreparedOverviewSlice({
    growth: { groups: [{ label: "G" }] },
    salesman: { groups: [{ label: "S" }] },
    madiba: { groups: [{ label: "M" }] },
  }, { groupBy: "salesman" })?.groups?.[0]?.label, "S");
  assert.equal(pickPreparedOverviewSlice({
    growth: { groups: [{ label: "G" }] },
    madiba: { groups: [{ label: "M" }] },
  }, { itemNameContains: "MADIBA" })?.groups?.[0]?.label, "M");
});

test("prepared overview bundle freshness follows batch and fingerprint", () => {
  const prepared = serializePreparedOverviewBundle(
    { growth: { groups: [] }, meta: {} },
    {
      batchId: "batch-1",
      builtAt: "2026-11-01T10:00:00.000Z",
      asOfDate: "2026-11-01",
      cubeBuiltAt: "2026-11-01T09:00:00.000Z",
      fingerprint: preparedOverviewFingerprint({}),
    },
  );
  assert.equal(preparedOverviewBundleIsFresh(prepared, {
    batchId: "batch-1",
    fingerprint: preparedOverviewFingerprint({}),
  }), true);
  assert.equal(preparedOverviewBundleIsFresh(prepared, {
    batchId: "batch-2",
    fingerprint: preparedOverviewFingerprint({}),
  }), false);
  assert.equal(
    deserializePreparedOverviewBundle({ version: 99, bundle: { growth: {} } }),
    null,
  );
});
