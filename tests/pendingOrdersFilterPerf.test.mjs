import test from "node:test";
import assert from "node:assert/strict";

import {
  findOutstandingForCustomer,
  getOutstandingLookup,
} from "../app/lib/outstanding.js";
import {
  matchesExcelColumnFilter,
  rowMatchesOtherExcelFilters,
} from "../app/lib/excelColumnFilter.js";

const FILTER_KEYS = [
  "orderId",
  "customer",
  "salesman",
  "status",
  "invoiceStatus",
  "uploadedAt",
  "timeToMake",
  "created",
  "lastUpdated",
  "age",
  "orderValue",
  "invoiceValue",
  "currentOutstanding",
];

function buildDataset(customerCount) {
  const rows = Array.from({ length: customerCount }, (_, index) => ({
    customer_code: `${1000 + index}C`,
    customer_name: `Customer ${1000 + index}`,
    total_outstanding: (index % 50) * 100,
    buckets: { "0-30": (index % 50) * 100 },
  }));
  return { rows };
}

function buildOrders(orderCount) {
  return Array.from({ length: orderCount }, (_, index) => ({
    id: `order-${index}`,
    customer_code: `${1000 + (index % 2000)}`,
    customer_name: `Customer ${1000 + (index % 2000)}`,
    salesman_code: index % 2 === 0 ? "OSAMA" : "PARVEZ",
    status: "SUBMITTED",
    total_value: 1000 + index,
    created_at: "2026-09-18T08:00:00.000Z",
    updated_at: "2026-09-19T08:00:00.000Z",
  }));
}

function filterValuesForOrder(order, outstandingAmount) {
  return {
    orderId: String(order.id),
    customer: order.customer_name,
    salesman: order.salesman_code,
    status: order.status,
    invoiceStatus: "Pending for invoice creation",
    uploadedAt: "-",
    timeToMake: "1-7 days",
    created: order.created_at,
    lastUpdated: order.updated_at,
    age: "1",
    orderValue: String(order.total_value),
    invoiceValue: "-",
    currentOutstanding: outstandingAmount == null ? "-" : String(outstandingAmount),
  };
}

test("pending-order filter rebuild stays fast with large outstanding dataset", () => {
  const dataset = buildDataset(4000);
  const orders = buildOrders(500);
  getOutstandingLookup(dataset);

  const outstandingStarted = Date.now();
  const outstandingAmountByOrderId = new Map();
  orders.forEach((order) => {
    const row = findOutstandingForCustomer(dataset, order.customer_code, order.customer_name);
    outstandingAmountByOrderId.set(order.id, row ? Number(row.total_outstanding || 0) : 0);
  });
  const outstandingMs = Date.now() - outstandingStarted;
  assert.ok(outstandingMs < 2000, `outstanding precompute took ${outstandingMs}ms`);

  const filterRows = orders.map((order) => ({
    order,
    values: filterValuesForOrder(order, outstandingAmountByOrderId.get(order.id)),
  }));

  const columnFilters = Object.fromEntries(FILTER_KEYS.map((key) => [key, []]));
  const optionsStarted = Date.now();
  const options = {};
  FILTER_KEYS.forEach((key) => {
    const matching = filterRows.filter(({ values }) => (
      rowMatchesOtherExcelFilters(values, columnFilters, key, FILTER_KEYS, matchesExcelColumnFilter)
    ));
    options[key] = [...new Set(matching.map(({ values }) => values[key]))];
  });
  const optionsMs = Date.now() - optionsStarted;

  assert.equal(options.salesman.length, 2);
  assert.ok(options.customer.length > 100);
  assert.ok(optionsMs < 500, `single-pass filter options took ${optionsMs}ms`);
});
