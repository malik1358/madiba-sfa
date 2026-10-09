import test from "node:test";
import assert from "node:assert/strict";
import { buildSalesmanIncentiveReportFromDb } from "../app/lib/salesmanIncentiveServer.js";
import { listIncentiveSalesmen } from "../app/lib/salesmanIncentiveServer.js";
import { splitSalesActuals } from "../app/lib/performanceKpis.js";

function mockAdmin(salesRows) {
  return {
    from(table) {
      let rows = table === "active_sales" ? [...salesRows] : [];
      const orders = [];
      let start = 0;
      let end = 999;
      const query = {
        select() { return query; },
        gte(key, value) { rows = rows.filter((row) => row[key] >= value); return query; },
        lte(key, value) { rows = rows.filter((row) => row[key] <= value); return query; },
        in(key, values) { rows = rows.filter((row) => values.includes(row[key])); return query; },
        eq() { return query; },
        order(key, { ascending = true } = {}) { orders.push({ key, ascending }); return query; },
        range(from, to) { start = from; end = to; return query; },
        delete() { return query; },
        insert() { return Promise.resolve({ error: null }); },
        upsert() { return Promise.resolve({ error: null }); },
        maybeSingle() { return Promise.resolve({ data: null, error: null }); },
        then(resolve, reject) {
          if (table === "active_sales") {
            assert.ok(orders.some(({ key }) => key === "id"), "sales pagination needs a unique id tie-breaker");
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