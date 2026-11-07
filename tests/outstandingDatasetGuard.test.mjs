import test from "node:test";
import assert from "node:assert/strict";

import {
  isPartialOutstandingDataset,
  outstandingDatasetRowCount,
  shouldRejectOutstandingUpload,
} from "../app/lib/outstandingDatasetGuard.js";

test("partial outstanding datasets are tiny customer books", () => {
  assert.equal(isPartialOutstandingDataset({
    rows: [{ customer_code: "1620" }],
    invoices: [{ customer_code: "1620", ref_no: "NFD/1815" }],
  }), true);
  assert.equal(isPartialOutstandingDataset({
    rows: Array.from({ length: 40 }, (_, index) => ({ customer_code: String(1000 + index) })),
    invoices: [],
  }), false);
});

test("upload reject blocks wiping a full book with a single-customer OS", () => {
  const previous = {
    rows: Array.from({ length: 180 }, (_, index) => ({ customer_code: String(1000 + index) })),
    invoices: [],
  };
  const next = {
    rows: [{ customer_code: "1620" }],
    invoices: [{ customer_code: "1620" }],
  };
  const reason = shouldRejectOutstandingUpload(previous, next);
  assert.match(String(reason || ""), /full company outstanding/i);
  assert.equal(shouldRejectOutstandingUpload(previous, previous), null);
});

test("outstandingDatasetRowCount prefers distinct invoice customers when rows are sparse", () => {
  assert.equal(outstandingDatasetRowCount({
    rows: [{ customer_code: "1620" }],
    invoices: [
      { customer_code: "1620" },
      { customer_code: "1640" },
      { customer_code: "1640" },
    ],
  }), 2);
});
