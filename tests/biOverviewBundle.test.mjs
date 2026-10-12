import test from "node:test";
import assert from "node:assert/strict";

import { loadBiOverviewBundle } from "../app/lib/categoryGrowthServer.js";
import { clearSalesBiCubeMemory } from "../app/lib/salesBiCubeServer.js";
import { serializeSalesBiCube } from "../app/lib/salesBiCube.js";

function overviewAdmin(cube) {
  const settings = [
    { setting_key: "active_sales_batch_id", setting_value: "batch-1" },
    { setting_key: "sales_bi_cube_v1", setting_value: JSON.stringify(serializeSalesBiCube(cube)) },
  ];
  return {
    from(table) {
      let rows = table === "system_settings" ? [...settings] : [];
      const query = {
        select() { return query; },
        eq(key, value) {
          rows = rows.filter((row) => row[key] === value);
          return query;
        },
        neq() { return query; },
        limit() { return query; },
        order() { return query; },
        range() { return query; },
        maybeSingle() {
          return Promise.resolve({ data: rows[0] || null, error: null });
        },
        then(resolve) {
          if (table === "import_batches") {
            return Promise.resolve({ data: null, error: null }).then(resolve);
          }
          if (table === "active_sales") {
            return Promise.resolve({ data: [], error: null }).then(resolve);
          }
          if (table === "sales_bi_monthly") {
            return Promise.resolve({
              data: null,
              error: { code: "42P01", message: "relation \"sales_bi_monthly\" does not exist" },
            }).then(resolve);
          }
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      return query;
    },
  };
}

test("BI overview bundle builds all report slices from one cube without customer cohorts", async () => {
  clearSalesBiCubeMemory();
  try {
    const bundle = await loadBiOverviewBundle(overviewAdmin({
      batchId: "batch-1",
      builtAt: new Date().toISOString(),
      sourceRowCount: 3,
      facts: [
        {
          month: "2026-08",
          category: "Building",
          salesman_code: "ALI",
          salesman_name: "Ali",
          customer_code: "C1",
          customer_name: "Shop A",
          item_code: "I1",
          item_name: "Paper",
          voucher_type: "Sales",
          local_import: "Local",
          abc_class: "A",
          sales_amount: 400,
          profit_amount: 40,
          quantity: 4,
          line_count: 2,
          cash_sales_amount: 100,
          credit_sales_amount: 300,
          local_sales_amount: 400,
          import_sales_amount: 0,
          unclassified_origin_sales_amount: 0,
          sales_adjustments_amount: 0,
        },
        {
          month: "2026-09",
          category: "Office",
          salesman_code: "ALI",
          salesman_name: "Ali",
          customer_code: "C2",
          customer_name: "Shop B",
          item_code: "I2",
          item_name: "Toner",
          voucher_type: "Sales",
          local_import: "Import",
          abc_class: "B",
          sales_amount: 200,
          profit_amount: 20,
          quantity: 2,
          line_count: 1,
          cash_sales_amount: 0,
          credit_sales_amount: 200,
          local_sales_amount: 0,
          import_sales_amount: 200,
          unclassified_origin_sales_amount: 0,
          sales_adjustments_amount: 0,
        },
      ],
    }), { asOfDate: "2026-09-15", filters: { dateFrom: "2026-08-01", dateTo: "2026-09-15" } });

    assert.equal(bundle.meta.source, "sales_bi_cube");
    assert.ok(bundle.growth?.groups?.length >= 1);
    assert.ok(bundle.customer?.groups?.length >= 1);
    assert.ok(bundle.item?.groups?.length >= 1);
    assert.ok(bundle.salesman?.groups?.length >= 1);
    assert.ok(bundle.growth.salesMix);
    assert.equal(bundle.customer.customerCohorts, undefined);
    assert.equal(bundle.customer.customerMonthlyCohorts, undefined);
    assert.equal(bundle.customer.customerBimonthlyCohorts, undefined);
    assert.equal(bundle.item.salesMix, undefined);
    assert.ok(Array.isArray(bundle.catalogs?.category));
  } finally {
    clearSalesBiCubeMemory();
  }
});
