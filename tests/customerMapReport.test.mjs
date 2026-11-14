import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCustomerMapAreaRows,
  buildCustomerMapReport,
  customerMapAreaKey,
  customerMapExportRows,
  filterCustomerMapRows,
  normalizeCustomerMapPoint,
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
  },
];

test("normalizeCustomerMapPoint keeps only saved GPS", () => {
  assert.equal(normalizeCustomerMapPoint(SAMPLE_ROWS[2]), null);
  const point = normalizeCustomerMapPoint(SAMPLE_ROWS[0]);
  assert.equal(point.customer_code, "1001");
  assert.equal(point.area_key, customerMapAreaKey("Riyadh", "Al Malaz District"));
  assert.equal(point.latitude, 24.68);
});

test("filterCustomerMapRows applies city salesman search and activeOnly", () => {
  const active = filterCustomerMapRows(SAMPLE_ROWS, { activeOnly: true });
  assert.equal(active.length, 3);

  const riyadh = filterCustomerMapRows(SAMPLE_ROWS, { city: "Riyadh", activeOnly: true });
  assert.equal(riyadh.length, 2);

  const salesman = filterCustomerMapRows(SAMPLE_ROWS, { salesman: "SM02", activeOnly: false });
  assert.equal(salesman.length, 2);

  const search = filterCustomerMapRows(SAMPLE_ROWS, { search: "beta", activeOnly: true });
  assert.equal(search.length, 1);
  assert.equal(search[0].customer_code, "1002");
});

test("buildCustomerMapAreaRows counts GPS and area centroids", () => {
  const areas = buildCustomerMapAreaRows(filterCustomerMapRows(SAMPLE_ROWS, { activeOnly: true }));
  assert.equal(areas.length, 2);
  const malaz = areas.find((row) => row.area === "Al Malaz District");
  assert.equal(malaz.customers, 2);
  assert.equal(malaz.with_gps, 2);
  assert.ok(Math.abs(malaz.latitude - 24.6805) < 0.0001);
  const dammam = areas.find((row) => row.city === "Dammam");
  assert.equal(dammam.customers, 1);
  assert.equal(dammam.with_gps, 0);
  assert.equal(dammam.latitude, null);
});

test("buildCustomerMapReport returns summary points and export rows", () => {
  const report = buildCustomerMapReport(SAMPLE_ROWS, { activeOnly: true });
  assert.equal(report.summary.customers, 3);
  assert.equal(report.summary.with_gps, 2);
  assert.equal(report.summary.without_gps, 1);
  assert.equal(report.summary.cities, 2);
  assert.equal(report.mapPoints.length, 2);
  assert.deepEqual(report.salesmen, ["SM01", "SM02"]);

  const exported = customerMapExportRows(report.areaRows);
  assert.equal(exported[0].City, "Riyadh");
  assert.equal(exported[0].Customers, 2);
  assert.equal(exported[0]["With GPS"], 2);
});
