import test from "node:test";
import assert from "node:assert/strict";
import {
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
  assert.equal(assignCoverBucket(91), ">90");
  assert.equal(assignCoverBucket(null), null);
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
    ">90": 0,
  });
});

test("item cover splits one category across multiple buckets", () => {
  const items = buildItemCoverRows([
    { itemCode: "A1", itemName: "Fast", qty: 10, uploadedValue: 100000, category: "Sundry" },
    { itemCode: "A2", itemName: "Slow", qty: 10, uploadedValue: 200000, category: "Sundry" },
  ], {
    sales30dByItem: new Map([
      ["A1", 300000],
      ["A2", 50000],
    ]),
  });
  assert.equal(items.length, 2);
  assert.equal(items.find((row) => row.itemCode === "A1").bucket, "0-30");
  assert.equal(items.find((row) => row.itemCode === "A2").bucket, ">90");

  const cats = rollCategoriesFromItems(items);
  assert.equal(cats.length, 1);
  assert.equal(cats[0].category, "Sundry");
  assert.equal(cats[0].amount, 300000);
  assert.equal(cats[0].bucketAmounts["0-30"], 100000);
  assert.equal(cats[0].bucketAmounts[">90"], 200000);
  assert.equal(cats[0].bucketAmounts["31-60"], 0);
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
