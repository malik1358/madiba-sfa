import test from "node:test";
import assert from "node:assert/strict";
import {
  collectSourcePricedCodes,
  keepPositivePublishedPrices,
  keepPositiveRegionPriceMaps,
  retainOnlySourcePricedCodes,
  retainOnlySourceRegionPriceMaps,
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

test("collectSourcePricedCodes reads only positive Apps Script rates", () => {
  const allowed = collectSourcePricedCodes({
    priceMap: { A006297: 60, A003946: 0 },
    regionPriceMaps: {
      riyadh: { A006297: 60 },
      dammam: { A006297: 63, A003947: "Stock out" },
    },
    retailRegionPriceMaps: { riyadh: { A006297: 75 } },
  });

  assert.equal(allowed.has("A006297"), true);
  assert.equal(allowed.has("A003946"), false);
  assert.equal(allowed.has("A003947"), false);
});

test("retainOnlySourcePricedCodes drops alias-invented stock-out glove codes", () => {
  const allowed = collectSourcePricedCodes({
    priceMap: { A006297: 60, A006298: 60 },
    regionPriceMaps: { dammam: { A006297: 63, A006298: 63 } },
  });
  // Simulate a buggy parser that copied MADIBA rates onto stock-out codes.
  const leaked = {
    A006297: 60,
    A006298: 60,
    A003946: 60,
    A003947: 60,
  };

  assert.deepEqual(retainOnlySourcePricedCodes(leaked, allowed), {
    A006297: 60,
    A006298: 60,
  });
  assert.deepEqual(retainOnlySourceRegionPriceMaps({
    dammam: { A006297: 63, A003946: 63 },
  }, allowed), {
    dammam: { A006297: 63 },
  });
});
