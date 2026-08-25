import test from "node:test";
import assert from "node:assert/strict";

import {
  buildProspectCustomerCode,
  enrichProspectsWithOrders,
  formatProspectOrderLabel,
  mapProspectOrderNumbers,
} from "../app/lib/prospects.js";

test("buildProspectCustomerCode formats prospect order customer codes", () => {
  assert.equal(buildProspectCustomerCode(126), "PROSPECT-126");
  assert.equal(buildProspectCustomerCode("64"), "PROSPECT-64");
  assert.equal(buildProspectCustomerCode(0), "");
});

test("formatProspectOrderLabel prefers order_number then falls back to id", () => {
  assert.equal(formatProspectOrderLabel({ id: 55, order_number: "SO-1001" }), "SO-1001");
  assert.equal(formatProspectOrderLabel({ id: 55, order_number: "" }), "55");
});

test("mapProspectOrderNumbers groups sales orders by prospect customer code", () => {
  const grouped = mapProspectOrderNumbers([
    { id: 10, order_number: "", customer_code: "PROSPECT-5", status: "SUBMITTED", created_at: "2026-08-20T10:00:00Z" },
    { id: 12, order_number: "SO-200", customer_code: "PROSPECT-5", status: "DRAFT", created_at: "2026-08-25T10:00:00Z" },
    { id: 99, order_number: "", customer_code: "1062C", status: "SUBMITTED", created_at: "2026-08-25T11:00:00Z" },
  ]);

  assert.deepEqual(grouped.get("PROSPECT-5"), [
    { id: 12, order_number: "SO-200", status: "DRAFT", created_at: "2026-08-25T10:00:00Z" },
    { id: 10, order_number: "10", status: "SUBMITTED", created_at: "2026-08-20T10:00:00Z" },
  ]);
  assert.equal(grouped.has("1062C"), false);
});

test("enrichProspectsWithOrders attaches order numbers to prospect rows", () => {
  const enriched = enrichProspectsWithOrders(
    [{ id: 5, company_name: "Test Shop" }],
    [{ id: 12, order_number: "SO-200", customer_code: "PROSPECT-5", status: "DRAFT", created_at: "2026-08-25T10:00:00Z" }],
  );

  assert.equal(enriched[0].latest_order_number, "SO-200");
  assert.deepEqual(enriched[0].order_numbers, ["SO-200"]);
});
