import test from "node:test";
import assert from "node:assert/strict";

import {
  clearPreparedBiOverviewMemory,
  loadBiOverviewBundle,
  loadCategoryGrowthReport,
} from "../app/lib/categoryGrowthServer.js";
import { clearSalesBiCubeMemory } from "../app/lib/salesBiCubeServer.js";
import { serializeSalesBiCube } from "../app/lib/salesBiCube.js";
import {
  BI_OVERVIEW_BUNDLE_KEY,
  serializePreparedOverviewBundle,
  preparedOverviewFingerprint,
} from "../app/lib/biPreparedBundle.js";

const sampleFacts = [
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
    clerical_adjustments_amount: 0,
    sales_returns_amount: 0,
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
    clerical_adjustments_amount: 0,
    sales_returns_amount: 0,
    sales_adjustments_amount: 0,
  },
];

function overviewAdmin(cube, extraSettings = []) {
  const settings = [
    { setting_key: "active_sales_batch_id", setting_value: "batch-1" },
    { setting_key: "sales_bi_cube_v1", setting_value: JSON.stringify(serializeSalesBiCube(cube)) },
    ...extraSettings,
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
        upsert(row) {
          const key = row.setting_key;
          const index = settings.findIndex((item) => item.setting_key === key);
          if (index >= 0) settings[index] = row;
          else settings.push(row);
          return Promise.resolve({ data: row, error: null });
        },
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

test("BI overview bundle builds all report slices from one cube including customer cohorts", async () => {
  clearSalesBiCubeMemory();
  clearPreparedBiOverviewMemory();
  try {
    const bundle = await loadBiOverviewBundle(overviewAdmin({
      batchId: "batch-1",
      builtAt: new Date().toISOString(),
      sourceRowCount: 3,
      facts: sampleFacts,
    }), { asOfDate: "2026-09-15", filters: { dateFrom: "2026-08-01", dateTo: "2026-09-15" } });

    assert.equal(bundle.meta.source, "sales_bi_cube");
    assert.ok(bundle.growth?.groups?.length >= 1);
    assert.ok(bundle.customer?.groups?.length >= 1);
    assert.ok(bundle.item?.groups?.length >= 1);
    assert.ok(bundle.salesman?.groups?.length >= 1);
    assert.ok(bundle.madiba);
    assert.ok(bundle.growth.salesMix);
    assert.ok(bundle.customer.customerCohorts);
    assert.ok(bundle.customer.customerMonthlyCohorts);
    assert.ok(bundle.customer.customerBimonthlyCohorts);
    assert.equal(bundle.item.salesMix, undefined);
    assert.ok(Array.isArray(bundle.catalogs?.category));
  } finally {
    clearSalesBiCubeMemory();
    clearPreparedBiOverviewMemory();
  }
});

test("team-scoped BI overview early-filters salesman rows and reuses memory cache", async () => {
  clearSalesBiCubeMemory();
  clearPreparedBiOverviewMemory();
  try {
    const facts = [
      ...sampleFacts,
      {
        ...sampleFacts[0],
        month: "2026-08",
        category: "Building",
        salesman_code: "NABIL",
        salesman_name: "Nabil",
        customer_code: "C9",
        customer_name: "Team shop",
        item_code: "I9",
        item_name: "Cement",
        sales_amount: 50,
        profit_amount: 5,
        quantity: 1,
        line_count: 1,
        cash_sales_amount: 50,
        credit_sales_amount: 0,
        local_sales_amount: 50,
        import_sales_amount: 0,
      },
    ];
    const admin = overviewAdmin({
      batchId: "batch-1",
      builtAt: new Date().toISOString(),
      sourceRowCount: facts.length,
      facts,
    });
    const filters = {
      values: { salesman_code: ["NABIL"] },
    };

    const first = await loadBiOverviewBundle(admin, {
      asOfDate: "2026-09-15",
      filters,
      catalogMatchedOnly: true,
      includeProfit: false,
    });
    assert.equal(first.meta.servedFromScopedMemory, undefined);
    assert.equal(first.growth.measures?.profit, undefined);
    assert.equal(first.growth.lifetimeTotal, 50);
    assert.ok((first.salesman?.groups || []).length >= 1);
    assert.ok((first.salesman?.groups || []).every((row) => /nabil/i.test(String(row.label || row.key || ""))));
    assert.equal(first.madiba?.meta?.skippedForScope, true);

    const second = await loadBiOverviewBundle(admin, {
      asOfDate: "2026-09-15",
      filters,
      catalogMatchedOnly: true,
      includeProfit: false,
    });
    assert.equal(second.meta.servedFromScopedMemory, true);
    assert.equal(second.growth.lifetimeTotal, first.growth.lifetimeTotal);
  } finally {
    clearSalesBiCubeMemory();
    clearPreparedBiOverviewMemory();
  }
});

test("BI overview serves the prepared all-time bundle without recomputing", async () => {
  clearSalesBiCubeMemory();
  clearPreparedBiOverviewMemory();
  try {
    const preparedBundle = {
      growth: { groups: [{ label: "Prepared" }], salesMix: { months: [] } },
      customer: { groups: [{ label: "Cust" }], customerCohorts: { periods: [] } },
      item: { groups: [{ label: "Item" }] },
      salesman: { groups: [{ label: "Ali" }] },
      madiba: { groups: [] },
      catalogs: { category: ["Prepared"] },
      meta: { source: "bi_overview_bundle", preparedAt: "2026-11-01T10:00:00.000Z" },
    };
    const admin = overviewAdmin({
      batchId: "batch-1",
      builtAt: "2026-11-01T09:00:00.000Z",
      sourceRowCount: 2,
      facts: sampleFacts,
    }, [{
      setting_key: BI_OVERVIEW_BUNDLE_KEY,
      setting_value: JSON.stringify(serializePreparedOverviewBundle(preparedBundle, {
        batchId: "batch-1",
        builtAt: "2026-11-01T10:00:00.000Z",
        asOfDate: "2026-11-01",
        cubeBuiltAt: "2026-11-01T09:00:00.000Z",
        fingerprint: preparedOverviewFingerprint({}),
      })),
    }]);

    const bundle = await loadBiOverviewBundle(admin, { asOfDate: "2026-11-01", filters: {} });
    assert.equal(bundle.meta.servedFromPrepared, true);
    assert.equal(bundle.meta.source, "bi_overview_bundle");
    assert.equal(bundle.growth.groups[0].label, "Prepared");
    assert.equal(bundle.customer.groups[0].label, "Cust");

    const category = await loadCategoryGrowthReport(admin, {
      asOfDate: "2026-11-01",
      filters: { groupBy: "category" },
    });
    assert.equal(category.meta.servedFromPrepared, true);
    assert.equal(category.groups[0].label, "Prepared");

    const salesman = await loadCategoryGrowthReport(admin, {
      asOfDate: "2026-11-01",
      filters: { groupBy: "salesman" },
    });
    assert.equal(salesman.meta.servedFromPrepared, true);
    assert.equal(salesman.groups[0].label, "Ali");
  } finally {
    clearSalesBiCubeMemory();
    clearPreparedBiOverviewMemory();
  }
});
