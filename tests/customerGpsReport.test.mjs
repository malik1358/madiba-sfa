import test from "node:test";
import assert from "node:assert/strict";
import {
  attachDayGpsChangeCounts,
  gpsReportRange,
  gpsReportRow,
  loadAcceptedGpsChangeTotals,
  parseGpsReportDate,
} from "../app/lib/customerGpsReport.js";
import { markVisitsWithAcceptedGpsHistory } from "../app/lib/dailyVisitReportStats.js";

test("GPS report uses exact KSA calendar boundaries including Friday", () => {
  assert.deepEqual(gpsReportRange("2026-10-02", "2026-10-02"), { startIso: "2026-10-01T21:00:00.000Z", endExclusive: "2026-10-02T21:00:00.000Z" });
  assert.throws(() => parseGpsReportDate("2026-02-30"));
  assert.throws(() => gpsReportRange("2026-10-05", "2026-10-04"));
});

test("report calculates displacement and only claims explicitly recorded approvals", () => {
  const base = { latitude: 24.71, longitude: 46.6, previous_latitude: 24.7, previous_longitude: 46.6 };
  const row = gpsReportRow({ ...base, source: "salesman_accepted" }, "Shop");
  assert.ok(row.distance_meters > 1100 && row.distance_meters < 1120);
  assert.equal(row.acceptance, "confirmed_salesman");
  assert.equal(row.customer_name, "Shop");
  assert.match(row.old_map_url, /24.7,46.6/);
  assert.equal(gpsReportRow({ ...base, source: "visit" }).acceptance, "not_recorded");
  assert.equal(gpsReportRow({ ...base, source: "visit_accepted" }).acceptance, "confirmed_other");
  assert.equal(gpsReportRow({ ...base, previous_latitude: null, source: "salesman_accepted" }).acceptance, "not_recorded");
  assert.equal(gpsReportRow({ ...base, latitude: null }).distance_meters, null);
  assert.equal(gpsReportRow({ ...base, previous_latitude: 0 }).old_map_url, "");
});

test("new approval sources preserve daily visit report accepted labels", () => {
  const entry = { customer_code: "1415", user_id: "salesman-1", latitude: 24.71, longitude: 46.6, saved_at: "2026-10-04T10:00:00Z", transaction_type: "VISIT_REPORT" };
  for (const source of ["salesman_accepted", "visit_accepted"]) {
    const result = markVisitsWithAcceptedGpsHistory([entry], [{ ...entry, previous_latitude: 24.7, previous_longitude: 46.6, updated_by: "salesman-1", created_at: entry.saved_at, source }]);
    assert.equal(result[0].meta?.gpsLocationUpdateAccepted, true);
  }
});

test("day change counts mark repeated customers on the same report day", () => {
  const counted = attachDayGpsChangeCounts([
    { customer_code: "1207" },
    { customer_code: "1207" },
    { customer_code: "1315" },
  ]);
  assert.equal(counted[0].times_today, 2);
  assert.equal(counted[1].times_today, 2);
  assert.equal(counted[2].times_today, 1);
});

test("lifetime salesman-accepted totals are counted per customer code", async () => {
  const calls = [];
  const admin = {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        in(_column, codes) { calls.push(codes); return this; },
        range() {
          return Promise.resolve({
            data: [
              { customer_code: "1207" },
              { customer_code: "1207" },
              { customer_code: "1315" },
            ],
            error: null,
          });
        },
      };
    },
  };
  const totals = await loadAcceptedGpsChangeTotals(admin, ["1207", "1315", "1092"]);
  assert.deepEqual(calls[0], ["1207", "1315", "1092"]);
  assert.equal(totals.get("1207"), 2);
  assert.equal(totals.get("1315"), 1);
  assert.equal(totals.get("1092"), 0);
});