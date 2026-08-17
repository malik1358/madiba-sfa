import test from "node:test";
import assert from "node:assert/strict";
import {
  dedupeLocationRows,
  parseLocationSpreadsheetRow,
  planCustomerLocationUpdates,
} from "../app/lib/customerLocationImport.js";

test("parseLocationSpreadsheetRow reads Party Name and misspelled GPS columns", () => {
  const row = parseLocationSpreadsheetRow({
    "Party Name": "1224  RAWAAT MAZAYA GIFT LUXURIES TRADING CO.",
    Lattitude: 24.56251,
    Longitutde: 46.743959,
  });

  assert.equal(row.customer_code, "1224");
  assert.equal(row.latitude, 24.56251);
  assert.equal(row.longitude, 46.743959);
});

test("planCustomerLocationUpdates skips zero coordinates and matches by code", () => {
  const plan = planCustomerLocationUpdates(
    [
      { party_name: "1415 sharikat khutwh alearud", customer_code: "1415", latitude: 24.5, longitude: 46.6 },
      { party_name: "Sada Al khaleej Trading company", customer_code: "", latitude: 0, longitude: 0 },
    ],
    [{ customer_code: "1415", customer_name: "SHARIKAT KHUTWH ALEARUD" }],
  );

  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].customer_code, "1415");
  assert.equal(plan.skipped.length, 1);
});

test("dedupeLocationRows keeps the latest valid coordinates", () => {
  const rows = dedupeLocationRows([
    { customer_code: "1010", latitude: 0, longitude: 0, party_name: "1010 first" },
    { customer_code: "1010", latitude: 24.64, longitude: 46.73, party_name: "1010 second" },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].latitude, 24.64);
});
