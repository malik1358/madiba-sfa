import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateSalesForCover,
  assignCoverBucket,
  bucketAmountsFromCover,
  buildInventoryCoverModel,
  buildItemCoverRows,
  enrichPhysicalCategoriesWithBuckets,
  forwardCoverDays,
  rollCategoriesFromItems,
  trailingWindowStart,
} from "../app/lib/inventoryForwardCover.js";

test("trailingWindowStart is inclusive 30-day window", () => {
  assert.equal(trailingWindowStart("2026-10-31", 30), "2026-10-02");
});

test("forwardCoverDays and assignCoverBucket bands", () => {
  assert.equal(forwardCoverDays(300000, 300000, 30), 30);
  assert.equal(assignCoverBucket(0), "0-30");
  assert.equal(assignCoverBucket(30), "0-30");
  assert.equal(assignCoverBucket(31), "31-60");
  assert.equal(assignCoverBucket(60), "31-60");
  assert.equal(assignCoverBucket(61), "61-90");
  assert.equal(assignCoverBucket(90), "61-90");
  assert.equal(assignCoverBucket(91), "91-120");
  assert.equal(assignCoverBucket(120), "91-120");
  assert.equal(assignCoverBucket(121), ">120");
  assert.equal(assignCoverBucket(null), null);
});

test("enrichPhysicalCategoriesWithBuckets rebuilds legacy >90 into current bands", () => {
  const rows = enrichPhysicalCategoriesWithBuckets([
    {
      category: "Sundry",
      amount: 400000,
      sales30d: 100000,
      days: 120,
      bucketAmounts: { "0-30": 0, "31-60": 0, "61-90": 0, ">90": 400000 },
    },
  ]);
  assert.equal(rows[0].bucketAmounts["91-120"], 400000);
  assert.equal(rows[0].bucketAmounts[">120"], 0);
  assert.equal(rows[0].bucketAmounts[">90"], undefined);
});

test("physical categories place full stock in one cover bucket", () => {
  const rows = enrichPhysicalCategoriesWithBuckets([
    { category: "Sundry", amount: 600000, sales30d: 300000, forwardCoverDays: 60 },
    { category: "Fragrance", amount: 400000, sales30d: 150000, forwardCoverDays: 80 },
  ]);
  assert.equal(rows[0].bucketAmounts["31-60"], 600000);
  assert.equal(rows[0].bucketAmounts["0-30"], 0);
  assert.equal(rows[1].bucketAmounts["61-90"], 400000);
  assert.deepEqual(bucketAmountsFromCover(100, 15), {
    "0-30": 100,
    "31-60": 0,
    "61-90": 0,
    "91-120": 0,
    ">120": 0,
  });
});

test("item cover splits one category across multiple buckets", () => {
  const items = buildItemCoverRows([
    { itemCode: "A1", itemName: "Fast", qty: 10, uploadedValue: 100000, category: "Sundry" },
    { itemCode: "A2", itemName: "Slow", qty: 10, uploadedValue: 200000, category: "Sundry" },
  ], {
    sales30dByItem: new Map([
      ["A1", 300000],
      ["A2", 40000],
    ]),
  });
  assert.equal(items.length, 2);
  assert.equal(items.find((row) => row.itemCode === "A1").bucket, "0-30");
  assert.equal(items.find((row) => row.itemCode === "A2").bucket, ">120");

  const cats = rollCategoriesFromItems(items);
  assert.equal(cats.length, 1);
  assert.equal(cats[0].category, "Sundry");
  assert.equal(cats[0].amount, 300000);
  assert.equal(cats[0].bucketAmounts["0-30"], 100000);
  assert.equal(cats[0].bucketAmounts[">120"], 200000);
  assert.equal(cats[0].bucketAmounts["31-60"], 0);
});

test("stock value prefers sales unit rate over catalogue pack rate", () => {
  const items = buildItemCoverRows([
    { itemCode: "A004082", qty: 195225, uploadedValue: 0, category: "Stationery" },
  ], {
    sales30dByItem: { A004082: 8612 },
    salesRateByItem: { A004082: 0.629 },
    rateByItem: { A004082: 132 },
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].amount, Math.round(195225 * 0.629));
  assert.ok(items[0].amount < 200000);
  assert.ok(items[0].amount < 195225 * 132);
});

test("aggregateSalesForCover uses lookback rate when cover window has no sales", () => {
  const { sales30dByItem, salesRateByItem, sales30d } = aggregateSalesForCover([
    { item_code: "A004456", sales_amount: 5374, quantity: 100, transaction_date: "2026-10-13" },
    { item_code: "A1", sales_amount: 3000, quantity: 30, transaction_date: "2026-11-10" },
  ], { coverFrom: "2026-10-16", coverTo: "2026-11-14" });
  assert.equal(sales30d, 3000);
  assert.equal(sales30dByItem.get("A004456"), undefined);
  assert.equal(sales30dByItem.get("A1"), 3000);
  assert.ok(Math.abs(salesRateByItem.get("A004456") - 53.74) < 0.01);
  assert.equal(salesRateByItem.get("A1"), 100);

  const items = buildItemCoverRows([
    { itemCode: "A004456", qty: 1130, uploadedValue: 0, category: "Building Material" },
  ], {
    sales30dByItem,
    salesRateByItem,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].bucket, ">120");
  assert.equal(items[0].amount, Math.round(1130 * 53.74));
});

test("without sales rate, catalogue pack rate is not required for cover rows from server path", () => {
  const withCatalogOnly = buildItemCoverRows([
    { itemCode: "A005203", qty: 360000, uploadedValue: 0, category: "Stationery" },
  ], {
    rateByItem: { A005203: 344 },
  });
  // Library still allows catalogue fallback when explicitly passed (tests / tooling).
  assert.equal(withCatalogOnly[0].amount, Math.round(360000 * 344));
  assert.equal(withCatalogOnly[0].bucket, ">120");

  const noRate = buildItemCoverRows([
    { itemCode: "A005203", qty: 360000, uploadedValue: 0, category: "Stationery" },
  ], {});
  assert.equal(noRate.length, 0);
});

test("buildInventoryCoverModel uses EOD items when provided", () => {
  const items = buildItemCoverRows([
    { itemCode: "X1", uploadedValue: 90000, category: "Personal Care" },
  ], {
    sales30dByItem: { X1: 90000 },
  });
  const model = buildInventoryCoverModel({
    source: "eod",
    stockDate: "2026-11-12",
    items,
  });
  assert.equal(model.source, "eod");
  assert.equal(model.stockDate, "2026-11-12");
  assert.equal(model.physical, 90000);
  assert.equal(model.days, 30);
  assert.equal(model.categories[0].bucketAmounts["0-30"], 90000);
  assert.equal(model.items.length, 1);
});

test("resolveItemStockValue falls back to qty × rate when no uploaded value", () => {
  const items = buildItemCoverRows([
    { itemCode: "B1", qty: 5, uploadedValue: 0, category: "Sundry" },
  ], {
    rateByItem: { B1: 40 },
    sales30dByItem: { B1: 200 },
  });
  assert.equal(items[0].amount, 200);
  assert.equal(items[0].forwardCoverDays, 30);
});
