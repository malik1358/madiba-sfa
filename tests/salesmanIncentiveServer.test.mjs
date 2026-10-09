import test from "node:test";
import assert from "node:assert/strict";
import { buildSalesmanIncentiveReportFromDb } from "../app/lib/salesmanIncentiveServer.js";
import { listIncentiveSalesmen } from "../app/lib/salesmanIncentiveServer.js";
import { splitSalesActuals } from "../app/lib/performanceKpis.js";
import { clearSalesBiCubeMemory } from "../app/lib/salesBiCubeServer.js";
import { serializeSalesBiCube } from "../app/lib/salesBiCube.js";

function mockAdmin(salesRows, settingsRows = []) {
  return {
    from(table) {
      let rows = table === "active_sales" ? [...salesRows]
        : table === "system_settings" ? [...settingsRows]
          : [];
      const orders = [];
      let start = 0;
      let end = 999;
      const query = {
        select() { return query; },
        gte(key, value) { rows = rows.filter((row) => row[key] >= value); return query; },
        lte(key, value) { rows = rows.filter((row) => row[key] <= value); return query; },
        in(key, values) { rows = rows.filter((row) => values.includes(row[key])); return query; },
        eq(key, value) { rows = rows.filter((row) => row[key] === value); return query; },
        neq(key, value) { rows = rows.filter((row) => row[key] != null && row[key] !== value); return query; },
        limit(count) { end = Math.min(end, start + count - 1); return query; },
        order(key, { ascending = true } = {}) { orders.push({ key, ascending }); return query; },
        range(from, to) { start = from; end = to; return query; },
        delete() { return query; },
        insert() { return Promise.resolve({ error: null }); },
        upsert() { return Promise.resolve({ error: null }); },
        maybeSingle() { return Promise.resolve({ data: rows[0] || null, error: null }); },
        then(resolve, reject) {
          if (table === "active_sales") {
            if (orders.some(({ key }) => key === "transaction_date")) {
              assert.ok(orders.some(({ key }) => key === "id"), "sales pagination needs a unique id tie-breaker");
            }
            rows.sort((left, right) => {
              for (const { key, ascending } of orders) {
                const comparison = String(left[key] ?? "").localeCompare(String(right[key] ?? ""), undefined, { numeric: true });
                if (comparison) return ascending ? comparison : -comparison;
              }
              return 0;
            });
          }
          return Promise.resolve({ data: rows.slice(start, end + 1), error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

test("incentive sales retain every row across pages with the same transaction date", async () => {
  const salesRows = Array.from({ length: 1005 }, (_, index) => ({
    id: index + 1,
    transaction_date: "2026-09-10",
    customer_code: "C001",
    salesman_code: "SM001",
    salesman_name: "George",
    voucher_number: `S/${index + 1}`,
    voucher_type: "Sales",
    sales_amount: 100,
    category: "Other",
  }));
  const report = await buildSalesmanIncentiveReportFromDb(mockAdmin(salesRows), {
    month: "2026-09",
    salesmanCodes: ["SM001"],
  });

  const kpi = splitSalesActuals(salesRows);
  assert.equal(report.totals.current_month_sales, kpi.officeSupplies + kpi.otherSales);
  assert.equal(report.totals.current_month_sales, 100500);
});

test("incentive current-month sales refresh a stale cube from active sales", async () => {
  clearSalesBiCubeMemory();
  const salesRows = [
    {
      id: 1,
      transaction_date: "2026-09-10",
      customer_code: "C001",
      salesman_code: "GEORGE",
      salesman_name: "George",
      voucher_number: "S/1",
      voucher_type: "Sales",
      sales_amount: 80000,
    },
    {
      id: 2,
      transaction_date: "2026-09-11",
      customer_code: "C001",
      salesman_code: "GEORGE",
      salesman_name: "George",
      voucher_number: "CN/1",
      voucher_type: "Credit Note",
      sales_amount: 3860.14,
    },
  ];
  const staleCube = serializeSalesBiCube({
    batchId: "active-batch",
    builtAt: new Date().toISOString(),
    facts: [
      { month: "2026-08", salesman_code: "GEORGE", sales_amount: 137519.3 },
      { month: "2026-09", salesman_code: "GEORGE", sales_amount: 72039.86 },
    ],
  });
  const admin = mockAdmin(salesRows, [
    { setting_key: "active_sales_batch_id", setting_value: "active-batch" },
    { setting_key: "sales_bi_cube_v1", setting_value: JSON.stringify(staleCube) },
  ]);

  try {
    const report = await buildSalesmanIncentiveReportFromDb(admin, {
      month: "2026-09",
      salesmanCodes: ["GEORGE"],
    });
    const george = report.salesmen.find((row) => row.salesman_code === "GEORGE");

    assert.equal(george.current_month_sales, 76139.86);
    assert.equal(george.peak_month_sales, 137519.3);
    assert.equal(george.peak_month, "2026-08");
    assert.equal(george.current_month_sales, splitSalesActuals(salesRows).officeSupplies
      + splitSalesActuals(salesRows).otherSales);
  } finally {
    clearSalesBiCubeMemory();
  }
});

function salesAdmin(rows) {
  return {
    from: () => ({
      select: () => {
        const filters = [];
        const query = {
          gte: (column, value) => { filters.push((row) => row[column] >= value); return query; },
          lte: (column, value) => { filters.push((row) => row[column] <= value); return query; },
          order: () => query,
          range: () => query,
          then: (resolve) => resolve({ data: rows.filter((row) => filters.every((filter) => filter(row))), error: null }),
        };
        return query;
      },
    }),
  };
}

test("incentive salesman list merges Thamer's imported code variants", async () => {
  const salesmen = await listIncentiveSalesmen(salesAdmin([
    { transaction_date: "2026-03-02", salesman_code: "SM002", salesman_name: "Thamer" },
    { transaction_date: "2026-03-03", salesman_code: "THAMER", salesman_name: "THAMER" },
    { transaction_date: "2026-04-03", salesman_code: "THAMER MOHAMMAD AHMED QASEM", salesman_name: "THAMER MOHAMMAD AHMED QASEM" },
  ]), { month: "2026-04" });

  assert.deepEqual(salesmen, [{ salesman_code: "SM002", salesman_name: "Thamer" }]);
});