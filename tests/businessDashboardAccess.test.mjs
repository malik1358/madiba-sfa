import test from "node:test";
import assert from "node:assert/strict";

import {
  applyBiSalesmanScope,
  buildBiViewerMeta,
  canViewBiProfit,
  canViewBusinessDashboard,
  filterOutstandingForSalesScope,
  filterRowsBySalesmanCodes,
  filterRowsByUserIds,
  stripBiProfit,
  summarizeTeamAttendance,
  sumAmountField,
} from "../app/lib/businessDashboardAccess.js";

test("canViewBusinessDashboard allows management report viewers and salesman", () => {
  assert.equal(canViewBusinessDashboard({ role: "admin" }), true);
  assert.equal(canViewBusinessDashboard({ role: "manager" }), true);
  assert.equal(canViewBusinessDashboard({ role: "invoice-maker" }), true);
  assert.equal(canViewBusinessDashboard({ role: "report-user" }), true);
  assert.equal(canViewBusinessDashboard({ role: "salesman" }), true);
  assert.equal(canViewBusinessDashboard({ role: "collector" }), false);
});

test("canViewBiProfit and viewer meta follow management vs salesman", () => {
  assert.equal(canViewBiProfit({ role: "admin" }), true);
  assert.equal(canViewBiProfit({ role: "manager" }), true);
  assert.equal(canViewBiProfit({ role: "salesman" }), false);
  assert.deepEqual(buildBiViewerMeta({ role: "salesman" }), { canViewProfit: false, scoped: true });
  assert.deepEqual(buildBiViewerMeta({ role: "manager" }), { canViewProfit: true, scoped: false });
});

test("applyBiSalesmanScope leaves management filters alone", () => {
  const { filters, empty } = applyBiSalesmanScope(
    { groupBy: "category", values: { salesman_code: ["A1"] } },
    { hasAllAccess: false, visibleSalesmanCodes: ["B1"] },
    { role: "manager" },
  );
  assert.equal(empty, false);
  assert.deepEqual(filters.values.salesman_code, ["A1"]);
});

test("applyBiSalesmanScope forces visible salesman codes", () => {
  const { filters, empty } = applyBiSalesmanScope(
    { groupBy: "salesman", values: {} },
    { hasAllAccess: false, visibleSalesmanCodes: ["p1", "P2"] },
    { role: "salesman" },
  );
  assert.equal(empty, false);
  assert.deepEqual(filters.values.salesman_code, ["P1", "P2"]);
});

test("applyBiSalesmanScope intersects and rejects out-of-scope codes", () => {
  const ok = applyBiSalesmanScope(
    { values: { salesman_code: ["P1"] } },
    { hasAllAccess: false, visibleSalesmanCodes: ["P1", "P2"] },
    { role: "salesman" },
  );
  assert.deepEqual(ok.filters.values.salesman_code, ["P1"]);

  assert.throws(
    () => applyBiSalesmanScope(
      { values: { salesman_code: ["X9"] } },
      { hasAllAccess: false, visibleSalesmanCodes: ["P1"] },
      { role: "salesman" },
    ),
    /do not have access/i,
  );
});

test("applyBiSalesmanScope marks empty when viewer has no codes", () => {
  const { empty, filters } = applyBiSalesmanScope(
    { groupBy: "category" },
    { hasAllAccess: false, visibleSalesmanCodes: [] },
    { role: "salesman" },
  );
  assert.equal(empty, true);
  assert.deepEqual(filters.values.salesman_code, ["__no_bi_access__"]);
});

test("stripBiProfit removes measures.profit", () => {
  const stripped = stripBiProfit({
    measure: "profit",
    lifetimeTotal: 10,
    measures: {
      sales: { lifetimeTotal: 100 },
      profit: { lifetimeTotal: 40 },
    },
  });
  assert.equal(stripped.measure, "sales");
  assert.equal(stripped.measures.sales.lifetimeTotal, 100);
  assert.equal(stripped.measures.profit, undefined);
});

test("filterRowsBySalesmanCodes and user ids keep only in-scope rows", () => {
  const sales = filterRowsBySalesmanCodes(
    [
      { salesman_code: "A1", sales_amount: 10 },
      { salesman_code: "B2", sales_amount: 20 },
      { salesman_code: "a1", sales_amount: 5 },
    ],
    ["A1"],
  );
  assert.equal(sumAmountField(sales), 15);

  const visits = filterRowsByUserIds(
    [
      { user_id: "u1", entry_type: "VISIT_REPORT" },
      { created_by: "u2", amount_received: 50 },
      { user_id: "u3" },
    ],
    ["u1", "u3"],
  );
  assert.equal(visits.length, 2);

  const byCreator = filterRowsByUserIds(
    [
      { created_by: "u1", amount_received: 10 },
      { created_by: "u2", amount_received: 20 },
    ],
    ["u2"],
    "created_by",
  );
  assert.equal(sumAmountField(byCreator, "amount_received"), 20);
});

test("filterOutstandingForSalesScope keeps owned customer rows", () => {
  const outstanding = {
    uploadedAt: "2026-10-01T00:00:00Z",
    fileName: "os.xlsx",
    rows: [
      {
        customer_code: "C1",
        customer_name: "Alpha",
        salesman: "Parvez",
        total_outstanding: 100,
        buckets: { "0-30": 100 },
      },
      {
        customer_code: "C2",
        customer_name: "Beta",
        salesman: "Other",
        total_outstanding: 50,
        buckets: { "0-30": 50 },
      },
    ],
    invoices: [
      { customer_code: "C1", salesman: "Parvez", amount: 100 },
      { customer_code: "C2", salesman: "Other", amount: 50 },
    ],
  };

  const scoped = filterOutstandingForSalesScope(outstanding, {
    hasAllAccess: false,
    visibleMembers: [{ salesman_code: "P1", salesman_name: "Parvez" }],
    visibleSalesmanCodes: ["P1"],
  }, { scoped: true });

  assert.equal(scoped.rows.length, 1);
  assert.equal(scoped.rows[0].customer_code, "C1");
  assert.equal(scoped.summary.totalOutstanding, 100);

  const full = filterOutstandingForSalesScope(outstanding, { hasAllAccess: true }, { scoped: false });
  assert.equal(full.rows.length, 2);
});

test("summarizeTeamAttendance counts team login statuses", () => {
  const reportDate = "2026-10-30";
  const summary = summarizeTeamAttendance({
    profiles: [
      { id: "u1", role: "salesman", salesman_name: "A", salesman_code: "A1" },
      { id: "u2", role: "salesman", salesman_name: "B", salesman_code: "B1" },
    ],
    logs: [
      {
        user_id: "u1",
        entry_type: "MORNING_ATTENDANCE",
        created_at: "2026-10-30T05:00:00.000Z",
        note: "",
      },
    ],
    collections: [],
    orders: [],
    reportDate,
    isToday: false,
  });

  assert.equal(summary.fieldHeadcount, 2);
  assert.equal(summary.loggedInCount, 1);
  assert.deepEqual(summary.notLoggedInUsers, ["B (B1)"]);
});
