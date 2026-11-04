import test from "node:test";
import assert from "node:assert/strict";
import {
  keepPositivePublishedPrices,
  keepPositiveRegionPriceMaps,
} from "../app/lib/priceSyncPublish.js";

test("keepPositivePublishedPrices drops zeros, blanks, and non-numeric rates", () => {
  const kept = keepPositivePublishedPrices({
    A003928: 40,
    A003927: 0.56,
    A000001: 0,
    A000002: "",
    A000003: "n/a",
    " a003929 ": "40.00",
  });

  assert.deepEqual(kept, {
    A003928: 40,
    A003927: 0.56,
    A003929: 40,
  });
});

test("keepPositiveRegionPriceMaps keeps positive regional rates and drops zeros", () => {
  const regions = keepPositiveRegionPriceMaps({
    riyadh: {
      A003928: 40,
      A003927: 0.56,
      A003929: 0,
    },
    dammam: {
      A003928: 41,
      A999999: 12,
    },
  });

  assert.deepEqual(regions, {
    riyadh: { A003928: 40, A003927: 0.56 },
    dammam: { A003928: 41, A999999: 12 },
  });
});

test("sales-history-only codes stay out when sync does not merge them into the sheet map", () => {
  const sheetPrices = keepPositivePublishedPrices({
    A003928: 40,
    A003929: 40,
  });
  const salesHistoryFallback = { A003927: 0.56 };
  const published = keepPositivePublishedPrices({
    ...sheetPrices,
    // Intentionally do not spread salesHistoryFallback — sync must never do that.
  });

  assert.equal(Object.prototype.hasOwnProperty.call(published, "A003927"), false);
  assert.equal(salesHistoryFallback.A003927, 0.56);
  assert.deepEqual(Object.keys(published).sort(), ["A003928", "A003929"]);
});
