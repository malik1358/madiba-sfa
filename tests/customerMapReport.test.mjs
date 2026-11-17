import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCustomerMapAreaRows,
  buildCustomerMapReport,
  customerBoughtInWindow,
  customerMapAreaKey,
  customerMapCustomerExportRows,
  customerMapExportRows,
  customerMapTradingWindow,
  customersForAreaKey,
  filterCustomerMapRows,
  isCustomerMapTradingActive,
  normalizeCustomerMapPoint,
  normalizeCustomerMapScope,
} from "../app/lib/customerMapReport.js";

const SAMPLE_ROWS = [
  {
    customer_code: "1001",
    customer_name: "Alpha Store",
    current_salesman_code: "SM01",
    city: "Riyadh",
    area: "Al Malaz District",
    latitude: 24.68,
    longitude: 46.72,
    is_active: true,
    latest_transaction_date: "2026-10-01",
    total_outstanding: 0,
  },
  {
    customer_code: "1002",
    customer_name: "Beta Shop",
    current_salesman_code: "SM01",
    city: "Riyadh",
    area: "Al Malaz District",
    latitude: 24.681,
    longitude: 46.721,
    is_active: true,
    latest_transaction_date: "2025-01-01",
    total_outstanding: 1500,
  },
  {
    customer_code: "1003",
    customer_name: "Gamma Mart",
    current_salesman_code: "SM02",
    city: "Dammam",
    area: "Al Adamah",
    latitude: null,
    longitude: null,
    is_active: true,
    latest_transaction_date: "2025-01-01",
    total_outstanding: 0,
  },
  {
    customer_code: "1004",
    customer_name: "Inactive Pin",
    current_salesman_code: "SM02",
    city: "Dammam",
    area: "Al Adamah",
    latitude: 26.4,
    longitude: 50.1,
    is_active: false,
    latest_transaction_date: "2025-01-01",
    total_outstanding: 0,
  },
];

test("normalizeCustomerMapPoint keeps only saved GPS", () => {
  assert.equal(normalizeCustomerMapPoint(SAMPLE_ROWS[2]), null);
  const point = normalizeCustomerMapPoint(SAMPLE_ROWS[0]);
  assert.equal(point.customer_code, "1001");
  assert.equal(point.area_key, customerMapAreaKey("Riyadh", "Al Malaz District"));
  assert.equal(point.latitude, 24.68);
});

test("trading scope keeps recent buyers and outstanding customers", () => {
  const window = customerMapTradingWindow("2026-11-14");
  assert.equal(customerBoughtInWindow(SAMPLE_ROWS[0], window), true);
  assert.equal(customerBoughtInWindow(SAMPLE_ROWS[1], window), false);
  assert.equal(isCustomerMapTradingActive(SAMPLE_ROWS[1], window), true);
  assert.equal(isCustomerMapTradingActive(SAMPLE_ROWS[2], window), false);

  const trading = filterCustomerMapRows(SAMPLE_ROWS, {
    scope: "trading",
    asOfDate: "2026-11-14",
  });
  assert.deepEqual(trading.map((row) => row.customer_code), ["1001", "1002"]);

  const all = filterCustomerMapRows(SAMPLE_ROWS, { scope: "all" });
  assert.equal(all.length, 4);
});

test("normalizeCustomerMapScope maps legacy activeOnly", () => {
  assert.equal(normalizeCustomerMapScope("trading"), "trading");
  assert.equal(normalizeCustomerMapScope("all"), "all");
  assert.equal(normalizeCustomerMapScope("", { activeOnly: false }), "all");
  assert.equal(normalizeCustomerMapScope(""), "trading");
});

test("filterCustomerMapRows applies city salesman search", () => {
  const riyadh = filterCustomerMapRows(SAMPLE_ROWS, {
    city: "Riyadh",
    scope: "all",
  });
  assert.equal(riyadh.length, 2);

  const salesman = filterCustomerMapRows(SAMPLE_ROWS, { salesman: "SM02", scope: "all" });
  assert.equal(salesman.length, 2);

  const search = filterCustomerMapRows(SAMPLE_ROWS, { search: "beta", scope: "all" });
  assert.equal(search.length, 1);
  assert.equal(search[0].customer_code, "1002");
});

test("buildCustomerMapAreaRows counts GPS and area centroids", () => {
  const areas = buildCustomerMapAreaRows(filterCustomerMapRows(SAMPLE_ROWS, {
    scope: "trading",
    asOfDate: "2026-11-14",
  }));
  assert.equal(areas.length, 1);
  const malaz = areas.find((row) => row.area === "Al Malaz District");
  assert.equal(malaz.customers, 2);
  assert.equal(malaz.with_gps, 2);
  assert.ok(Math.abs(malaz.latitude - 24.6805) < 0.0001);
});

test("buildCustomerMapReport returns summary points and export rows", () => {
  const report = buildCustomerMapReport(SAMPLE_ROWS, {
    scope: "trading",
    asOfDate: "2026-11-14",
  });
  assert.equal(report.summary.customers, 2);
  assert.equal(report.summary.with_gps, 2);
  assert.equal(report.summary.bought_in_window, 1);
  assert.equal(report.summary.with_outstanding, 1);
  assert.equal(report.mapPoints.length, 2);
  assert.equal(report.customers.length, 2);
  assert.deepEqual(report.salesmen, ["SM01"]);

  const exported = customerMapExportRows(report.areaRows);
  assert.equal(exported[0].City, "Riyadh");
  assert.equal(exported[0].Customers, 2);
  assert.equal(exported[0]["With GPS"], 2);

  const malazKey = customerMapAreaKey("Riyadh", "Al Malaz District");
  const malazCustomers = customersForAreaKey(report.customers, malazKey);
  assert.equal(malazCustomers.length, 2);
  assert.equal(malazCustomers.every((row) => row.has_gps), true);

  const customerExport = customerMapCustomerExportRows(malazCustomers);
  assert.equal(customerExport[0].GPS, "Yes");
  assert.ok(customerExport.some((row) => row.Code === "1001"));
});
