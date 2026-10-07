import test from "node:test";
import assert from "node:assert/strict";

import { listIncentiveSalesmen } from "../app/lib/salesmanIncentiveServer.js";

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