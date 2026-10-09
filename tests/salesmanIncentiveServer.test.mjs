import test from "node:test";
import assert from "node:assert/strict";
import { buildSalesmanIncentiveReportFromDb } from "../app/lib/salesmanIncentiveServer.js";
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
        order(key) { orders.push(key); return query; },
        range(from, to) { start = from; end = to; return query; },
        maybeSingle() { return Promise.resolve({ data: null, error: null }); },
        then(resolve, reject) {
          if (table === "active_sales") {
            assert.ok(orders.includes("id"), "sales pagination needs a unique id tie-breaker");
          }
          return Promise.resolve({ data: rows.slice(start, end + 1), error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

test("incentive sales match KPI sales across pages sharing one transaction date", async () => {
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
});

test("incentive sales include missing customer codes and net returns like KPI actuals", async () => {
  const salesRows = [
    { id: 1, transaction_date: "2026-09-10", customer_code: "C001", sales_amount: 54478.86 },
    { id: 2, transaction_date: "2026-09-10", customer_code: "", sales_amount: 23000 },
    { id: 3, transaction_date: "2026-09-11", customer_code: null, sales_amount: 1338.86, voucher_type: "Credit Note" },
    { id: 4, transaction_date: "2026-08-10", customer_code: "", sales_amount: 70000 },
    { id: 5, transaction_date: "2026-10-10", customer_code: "C001", sales_amount: 99999 },
    { id: 6, transaction_date: "2026-09-10", customer_code: "C001", sales_amount: 99999, salesman_code: "SM002" },
  ].map((row) => ({ salesman_code: "SM001", salesman_name: "George", voucher_type: "Sales", ...row }));
  for (const salesmanCodes of [["SM001"], []]) {
    const report = await buildSalesmanIncentiveReportFromDb(mockAdmin(salesRows), {
      month: "2026-09", salesmanCodes,
    });
    const kpi = splitSalesActuals(salesRows.filter((row) => (
      row.salesman_code === "SM001" && row.transaction_date.startsWith("2026-09")
    )));
    const george = report.salesmen.find((row) => row.salesman_code === "SM001");
    assert.equal(george.current_month_sales, 76140);
    assert.equal(george.current_month_sales, kpi.officeSupplies + kpi.otherSales);
    assert.equal(george.previous_month_sales, 70000);
    assert.equal(george.growth_incentive, 30.7);
    assert.equal(report.rows.length, 0);
    if (salesmanCodes.length) assert.equal(report.salesmen.length, 1);
  }
});