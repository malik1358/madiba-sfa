import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOfflineProspectCustomerCode,
  buildProspectCustomerCode,
  enrichProspectsWithOrders,
  formatProspectOrderLabel,
  mapProspectOrderNumbers,
  resolveProspectCustomerCode,
} from "../app/lib/prospects.js";

test("buildProspectCustomerCode formats prospect order customer codes", () => {
  assert.equal(buildProspectCustomerCode(126), "PROSPECT-126");
  assert.equal(buildProspectCustomerCode("64"), "PROSPECT-64");
  assert.equal(buildProspectCustomerCode(0), "");
  assert.equal(buildOfflineProspectCustomerCode("abc123"), "PROSPECT-OFF-abc123");
  assert.equal(resolveProspectCustomerCode({ offline_id: "abc123", id: 9 }), "PROSPECT-9");
  assert.equal(resolveProspectCustomerCode({ offline_id: "abc123" }), "PROSPECT-OFF-abc123");
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

test("enrichProspectsWithOrders matches both live and offline prospect customer codes", () => {
  const enriched = enrichProspectsWithOrders(
    [{ id: 9, offline_id: "abc123", company_name: "Test Shop" }],
    [
      { id: 3, order_number: "SO-OFF", customer_code: "PROSPECT-OFF-abc123", status: "SUBMITTED", created_at: "2026-09-01T10:00:00Z" },
      { id: 4, order_number: "325", customer_code: "PROSPECT-9", status: "SUBMITTED", created_at: "2026-09-07T08:00:00Z" },
    ],
  );

  assert.equal(enriched[0].latest_order_number, "325");
  assert.deepEqual(enriched[0].order_numbers, ["325", "SO-OFF"]);
});

test("mapProspectOrderNumbers includes offline prospect customer codes", () => {
  const grouped = mapProspectOrderNumbers([
    { id: 3, order_number: "SO-OFF", customer_code: "PROSPECT-OFF-abc123", status: "SUBMITTED", created_at: "2026-09-01T10:00:00Z" },
  ]);
  assert.equal(grouped.get("PROSPECT-OFF-ABC123")?.[0]?.order_number, "SO-OFF");
});
