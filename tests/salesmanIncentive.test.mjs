import test from "node:test";
import assert from "node:assert/strict";

import {
  INCENTIVE_RATES,
  buildCustomerIncentiveRows,
  buildInvoiceCategoryProfiles,
  buildSalesmanIncentiveReport,
  classifyIncentiveCategory,
  collectionIncentiveTier,
  computeGrowthIncentive,
  incentiveMonthRange,
  isExcludedIncentiveSalesman,
  parseIncentiveMonth,
  resolvePeakMonthlySales,
  shiftIncentiveMonth,
} from "../app/lib/salesmanIncentive.js";

function salesLine(overrides = {}) {
  return {
    transaction_date: "2026-03-02",
    voucher_number: "S/1",
    voucher_type: "Sales",
    customer_code: "C001",
    customer_name: "Alpha Trading",
    salesman_code: "S01",
    salesman_name: "Ali",
    item_code: "IT1",
    item_name: "A4 Paper",
    category: "Office Supplies",
    quantity: 1,
    sales_amount: 100,
    ...overrides,
  };
}

const MIXED_INVOICE = [
  salesLine(),
  salesLine({ item_code: "IT2", item_name: "Tissue Roll", category: "Tissue" }),
];

const ELECTRONICS_INVOICE = [
  salesLine({ item_code: "IT3", item_name: "Calculator", category: "Electronics", sales_amount: 100 }),
];

/** RC / DC / JC voucher prefixes mark a cash deal. */
const CASH_INVOICE = [
  salesLine({ voucher_number: "RC/12" }),
  salesLine({ voucher_number: "RC/12", item_code: "IT2", item_name: "Tissue Roll", category: "Tissue" }),
];

test("classifyIncentiveCategory separates office supplies, electronics and other", () => {
  assert.equal(classifyIncentiveCategory({ category: "Office Supplies" }), "officeSupplies");
  assert.equal(classifyIncentiveCategory({ category: "Electronics" }), "electronics");
  assert.equal(classifyIncentiveCategory({ category: "إلكترونيات" }), "electronics");
  assert.equal(classifyIncentiveCategory({ category: "Tissue" }), "other");
  assert.equal(classifyIncentiveCategory({}), "other");
});

test("collectionIncentiveTier follows the scheme day buckets", () => {
  assert.deepEqual(
    collectionIncentiveTier(35, { category: "officeSupplies" }),
    { key: "officeSuppliesFast", rate: INCENTIVE_RATES.officeSuppliesFast },
  );
  assert.equal(collectionIncentiveTier(36, { category: "officeSupplies" }).rate, 0);

  assert.equal(collectionIncentiveTier(35, { category: "electronics" }).rate, INCENTIVE_RATES.electronicsFast);
  assert.equal(collectionIncentiveTier(36, { category: "electronics" }).rate, INCENTIVE_RATES.electronicsSlow);
  assert.equal(collectionIncentiveTier(60, { category: "electronics" }).rate, INCENTIVE_RATES.electronicsSlow);
  assert.equal(collectionIncentiveTier(61, { category: "electronics" }).rate, 0);

  assert.equal(collectionIncentiveTier(0).rate, INCENTIVE_RATES.otherFast);
  assert.equal(collectionIncentiveTier(35).rate, INCENTIVE_RATES.otherFast);
  assert.equal(collectionIncentiveTier(36).rate, INCENTIVE_RATES.otherSlow);
  assert.equal(collectionIncentiveTier(60).rate, INCENTIVE_RATES.otherSlow);
  assert.equal(collectionIncentiveTier(61).rate, 0);
  assert.equal(collectionIncentiveTier(null).rate, 0);
});

test("cash deals ignore category rates and expire after 3 days", () => {
  assert.deepEqual(
    collectionIncentiveTier(3, { cashDeal: true, category: "other" }),
    { key: "cashFast", rate: INCENTIVE_RATES.cashFast },
  );
  assert.equal(collectionIncentiveTier(0, { cashDeal: true }).rate, INCENTIVE_RATES.cashFast);
  assert.equal(collectionIncentiveTier(4, { cashDeal: true, category: "other" }).rate, 0);
  assert.equal(collectionIncentiveTier(4, { cashDeal: true, category: "electronics" }).rate, 0);
});

test("buildInvoiceCategoryProfiles splits office supplies from other categories", () => {
  const profiles = buildInvoiceCategoryProfiles([...MIXED_INVOICE, ...ELECTRONICS_INVOICE]);
  const profile = profiles.get("2026-03-02::S/1");

  assert.equal(profile.office_excl, 100);
  assert.equal(profile.electronics_excl, 100);
  assert.equal(profile.other_excl, 100);
  assert.equal(profile.total_excl, 300);
  assert.equal(Number(profile.total_incl.toFixed(2)), 345);
  assert.equal(profile.is_cash, false);
  assert.equal(profile.salesman_code, "S01");
});

test("buildInvoiceCategoryProfiles flags RC / DC / JC vouchers as cash deals", () => {
  const profiles = buildInvoiceCategoryProfiles(CASH_INVOICE);
  assert.equal(profiles.get("2026-03-02::RC/12").is_cash, true);
});

test("buildInvoiceCategoryProfiles ignores credit notes", () => {
  const profiles = buildInvoiceCategoryProfiles([
    ...MIXED_INVOICE,
    salesLine({ voucher_number: "CN/7", voucher_type: "Credit Note", sales_amount: 50 }),
  ]);
  assert.equal(profiles.size, 1);
});

test("collection within 35 days pays 0.25% on office supplies and 1% on other categories", () => {
  const [row] = buildCustomerIncentiveRows({
    customerCode: "C001",
    customerName: "Alpha Trading",
    transactions: MIXED_INVOICE,
    receipts: [{ receipt_date: "2026-04-01", amount: 230, vch_no: "R/9" }],
    fromDate: "2026-04-01",
    toDate: "2026-04-30",
  });

  assert.equal(row.days, 30);
  assert.equal(row.collected_amount, 230);
  assert.equal(row.office_base, 100);
  assert.equal(row.other_base, 100);
  assert.equal(row.office_incentive, 0.25);
  assert.equal(row.other_incentive, 1);
  assert.equal(row.incentive, 1.25);
});

test("collection between 36 and 60 days pays 0.5% on other categories only", () => {
  const [row] = buildCustomerIncentiveRows({
    customerCode: "C001",
    transactions: MIXED_INVOICE,
    receipts: [{ receipt_date: "2026-04-21", amount: 230, vch_no: "R/9" }],
    fromDate: "2026-04-01",
    toDate: "2026-04-30",
  });

  assert.equal(row.days, 50);
  assert.equal(row.office_incentive, 0);
  assert.equal(row.other_incentive, 0.5);
  assert.equal(row.incentive, 0.5);
});

test("collection after 60 days earns nothing but is still reported", () => {
  const [row] = buildCustomerIncentiveRows({
    customerCode: "C001",
    transactions: MIXED_INVOICE,
    receipts: [{ receipt_date: "2026-05-11", amount: 230, vch_no: "R/9" }],
    fromDate: "2026-05-01",
    toDate: "2026-05-31",
  });

  assert.equal(row.days, 70);
  assert.equal(row.incentive, 0);
  assert.equal(row.office_base + row.other_base, 200);
});

test("only receipts inside the report month are counted", () => {
  const rows = buildCustomerIncentiveRows({
    customerCode: "C001",
    transactions: MIXED_INVOICE,
    receipts: [{ receipt_date: "2026-04-01", amount: 230, vch_no: "R/9" }],
    fromDate: "2026-05-01",
    toDate: "2026-05-31",
  });
  assert.equal(rows.length, 0);
});

test("electronics pays 0.40% within 35 days and 0.20% within 60 days", () => {
  const [fast] = buildCustomerIncentiveRows({
    customerCode: "C001",
    transactions: ELECTRONICS_INVOICE,
    receipts: [{ receipt_date: "2026-04-01", amount: 115, vch_no: "R/9" }],
    fromDate: "2026-04-01",
    toDate: "2026-04-30",
  });
  assert.equal(fast.days, 30);
  assert.equal(fast.electronics_base, 100);
  assert.equal(fast.electronics_incentive, 0.4);
  assert.equal(fast.incentive, 0.4);

  const [slow] = buildCustomerIncentiveRows({
    customerCode: "C001",
    transactions: ELECTRONICS_INVOICE,
    receipts: [{ receipt_date: "2026-04-21", amount: 115, vch_no: "R/9" }],
    fromDate: "2026-04-01",
    toDate: "2026-04-30",
  });
  assert.equal(slow.days, 50);
  assert.equal(slow.incentive, 0.2);

  const [late] = buildCustomerIncentiveRows({
    customerCode: "C001",
    transactions: ELECTRONICS_INVOICE,
    receipts: [{ receipt_date: "2026-05-11", amount: 115, vch_no: "R/9" }],
    fromDate: "2026-05-01",
    toDate: "2026-05-31",
  });
  assert.equal(late.incentive, 0);
  assert.equal(late.electronics_tier, "late");
});

test("cash deals pay 0.20% on the whole invoice within 3 days and nothing after", () => {
  const [fast] = buildCustomerIncentiveRows({
    customerCode: "C001",
    transactions: CASH_INVOICE,
    receipts: [{ receipt_date: "2026-03-04", amount: 230, vch_no: "R/1" }],
    fromDate: "2026-03-01",
    toDate: "2026-03-31",
  });
  assert.equal(fast.is_cash, true);
  assert.equal(fast.days, 2);
  assert.equal(fast.cash_base, 200);
  assert.equal(fast.office_base, 0);
  assert.equal(fast.other_base, 0);
  assert.equal(fast.incentive, 0.4);
  assert.equal(fast.primary_tier, "cashFast");

  const [late] = buildCustomerIncentiveRows({
    customerCode: "C001",
    transactions: CASH_INVOICE,
    receipts: [{ receipt_date: "2026-03-07", amount: 230, vch_no: "R/1" }],
    fromDate: "2026-03-01",
    toDate: "2026-03-31",
  });
  assert.equal(late.days, 5);
  assert.equal(late.cash_base, 200);
  assert.equal(late.incentive, 0);
  assert.equal(late.cash_tier, "late");
});

test("computeGrowthIncentive pays 0.5% of a positive delta only", () => {
  assert.deepEqual(computeGrowthIncentive(1000, 800), {
    currentMonthSales: 1000,
    benchmarkSales: 800,
    salesDelta: 200,
    growthIncentive: 1,
  });
  assert.equal(computeGrowthIncentive(800, 1000).growthIncentive, 0);
});

test("resolvePeakMonthlySales takes the best earlier month, never the current one", () => {
  const byMonth = new Map([
    ["2026-01", 500],
    ["2026-02", 900],
    ["2026-03", 300],
    ["2026-04", 5000],
  ]);
  assert.deepEqual(
    resolvePeakMonthlySales(byMonth, "2026-04"),
    { peakMonth: "2026-02", peakSales: 900, hasHistory: true },
  );
});

test("resolvePeakMonthlySales floors at zero when there is no positive history", () => {
  assert.deepEqual(
    resolvePeakMonthlySales(new Map([["2026-03", -200]]), "2026-04"),
    { peakMonth: "", peakSales: 0, hasHistory: true },
  );
  assert.deepEqual(
    resolvePeakMonthlySales(new Map(), "2026-04"),
    { peakMonth: "", peakSales: 0, hasHistory: false },
  );
});

test("a salesman's first month earns no growth incentive", () => {
  const report = buildSalesmanIncentiveReport({
    month: "2026-04",
    customers: [],
    monthlySalesBySalesman: new Map([["S99", new Map([["2026-04", 400000]])]]),
  });

  const [summary] = report.salesmen;
  assert.equal(summary.salesman_code, "S99");
  assert.equal(summary.has_sales_history, false);
  assert.equal(summary.current_month_sales, 400000);
  assert.equal(summary.peak_month_sales, 0);
  assert.equal(summary.sales_delta, 0);
  assert.equal(summary.growth_incentive, 0);
});

test("the month after the first one is measured against that first month", () => {
  const report = buildSalesmanIncentiveReport({
    month: "2026-05",
    customers: [],
    monthlySalesBySalesman: new Map([
      ["S99", new Map([["2026-04", 400000], ["2026-05", 450000]])],
    ]),
  });

  const [summary] = report.salesmen;
  assert.equal(summary.has_sales_history, true);
  assert.equal(summary.peak_month, "2026-04");
  assert.equal(summary.sales_delta, 50000);
  assert.equal(summary.growth_incentive, 250);
});

test("computeGrowthIncentive pays nothing without history", () => {
  assert.deepEqual(computeGrowthIncentive(1000, 0, { hasHistory: false }), {
    currentMonthSales: 1000,
    benchmarkSales: 0,
    salesDelta: 0,
    growthIncentive: 0,
  });
});

test("growth incentive is measured against the all-time best month", () => {
  const report = buildSalesmanIncentiveReport({
    month: "2026-04",
    customers: [],
    monthlySalesBySalesman: new Map([
      ["S01", new Map([["2025-06", 9000], ["2026-03", 1000], ["2026-04", 10000]])],
    ]),
  });

  const [summary] = report.salesmen;
  assert.equal(summary.peak_month, "2025-06");
  assert.equal(summary.peak_month_sales, 9000);
  assert.equal(summary.sales_delta, 1000);
  assert.equal(summary.growth_incentive, 5);
});

test("beating last month but not the record pays no growth incentive", () => {
  const report = buildSalesmanIncentiveReport({
    month: "2026-04",
    customers: [],
    monthlySalesBySalesman: new Map([
      ["S01", new Map([["2025-06", 9000], ["2026-03", 1000], ["2026-04", 2000]])],
    ]),
  });
  assert.equal(report.salesmen[0].growth_incentive, 0);
  assert.equal(report.salesmen[0].sales_delta, -7000);
});

test("TRENDYOL and NOON are excluded from the incentive report", () => {
  assert.equal(isExcludedIncentiveSalesman({ salesman_code: "TRENDYOL" }), true);
  assert.equal(isExcludedIncentiveSalesman({ salesman_name: "noon" }), true);
  assert.equal(isExcludedIncentiveSalesman({ salesman_code: "S01", salesman_name: "Ali" }), false);
  assert.equal(isExcludedIncentiveSalesman({}), false);

  const report = buildSalesmanIncentiveReport({
    month: "2026-04",
    customers: [{
      customerCode: "C001",
      transactions: MIXED_INVOICE.map((row) => ({
        ...row,
        salesman_code: "TRENDYOL",
        salesman_name: "TRENDYOL",
      })),
      receipts: [{ receipt_date: "2026-04-01", amount: 230, vch_no: "R/9" }],
    }],
  });
  assert.deepEqual(report.salesmen, []);
  assert.deepEqual(report.rows, []);
});

test("a receipt settles an old invoice regardless of how old the bill is", () => {
  const rows = buildCustomerIncentiveRows({
    customerCode: "C001",
    transactions: [salesLine({ transaction_date: "2023-01-10", voucher_number: "S/9" })],
    receipts: [{ receipt_date: "2026-04-15", amount: 115, vch_no: "R/9" }],
    fromDate: "2026-04-01",
    toDate: "2026-04-30",
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].invoice_date, "2023-01-10");
  assert.equal(rows[0].office_base, 100);
  assert.equal(rows[0].incentive, 0);
  assert.equal(rows[0].primary_tier, "late");
});

test("month helpers resolve the report window", () => {
  assert.equal(parseIncentiveMonth("2026-04-17"), "2026-04");
  assert.equal(parseIncentiveMonth("", "2026-02-09"), "2026-02");
  assert.throws(() => parseIncentiveMonth("nope"), /Invalid month/);
  assert.equal(shiftIncentiveMonth("2026-01", -1), "2025-12");
  assert.deepEqual(incentiveMonthRange("2026-02"), { from: "2026-02-01", to: "2026-02-28" });
});

test("buildSalesmanIncentiveReport combines collection and growth incentive", () => {
  const report = buildSalesmanIncentiveReport({
    month: "2026-04",
    customers: [
      {
        customerCode: "C001",
        customerName: "Alpha Trading",
        transactions: [
          ...MIXED_INVOICE,
          salesLine({ transaction_date: "2026-04-10", voucher_number: "S/2", sales_amount: 1000 }),
        ],
        receipts: [{ receipt_date: "2026-04-01", amount: 230, vch_no: "R/9" }],
      },
    ],
  });

  assert.equal(report.month, "2026-04");
  assert.equal(report.monthStart, "2026-04-01");
  assert.equal(report.monthEnd, "2026-04-30");
  assert.equal(report.rows.length, 1);

  const [summary] = report.salesmen;
  assert.equal(summary.salesman_code, "S01");
  assert.equal(summary.collection_incentive, 1.25);
  assert.equal(summary.current_month_sales, 1000);
  assert.equal(summary.peak_month, "2026-03");
  assert.equal(summary.peak_month_sales, 200);
  assert.equal(summary.sales_delta, 800);
  assert.equal(summary.growth_incentive, 4);
  assert.equal(summary.total_incentive, 5.25);
  assert.equal(summary.tier_base.officeSuppliesFast, 100);
  assert.equal(summary.tier_base.otherFast, 100);
  assert.equal(summary.tier_incentive.officeSuppliesFast, 0.25);
  assert.equal(summary.tier_incentive.otherFast, 1);
  assert.equal(summary.tier_incentive.late, 0);
  assert.equal(summary.eligible_base, 200);
  assert.equal(summary.late_base, 0);
  assert.equal(report.totals.total_incentive, 5.25);
  assert.equal(report.totals.tier_incentive.otherFast, 1);
});

test("buildSalesmanIncentiveReport can be scoped to one salesman", () => {
  const customers = [
    {
      customerCode: "C001",
      transactions: [
        ...MIXED_INVOICE,
        salesLine({
          transaction_date: "2026-04-05",
          voucher_number: "S/3",
          salesman_code: "S02",
          salesman_name: "Omar",
          sales_amount: 500,
        }),
      ],
      receipts: [{ receipt_date: "2026-04-01", amount: 230, vch_no: "R/9" }],
    },
  ];

  const all = buildSalesmanIncentiveReport({ month: "2026-04", customers });
  assert.deepEqual(all.salesmen.map((row) => row.salesman_code).sort(), ["S01", "S02"]);

  const scoped = buildSalesmanIncentiveReport({ month: "2026-04", customers, salesmanCodes: ["S02"] });
  assert.deepEqual(scoped.salesmen.map((row) => row.salesman_code), ["S02"]);
  assert.equal(scoped.rows.length, 0);
  // S02 only sells in the report month, so it is a first month and earns no growth.
  assert.equal(scoped.salesmen[0].has_sales_history, false);
  assert.equal(scoped.salesmen[0].growth_incentive, 0);
});

test("incentive report merges Thamer aliases from the cube and invoice rows", () => {
  const invoice = salesLine({
    transaction_date: "2026-03-02",
    salesman_code: "THAMER",
    salesman_name: "THAMER",
  });
  const report = buildSalesmanIncentiveReport({
    month: "2026-04",
    customers: [{
      customerCode: "C001",
      customerName: "Alpha Trading",
      transactions: [invoice],
      receipts: [{ receipt_date: "2026-04-01", amount: 115, vch_no: "R/9" }],
    }],
    monthlySalesBySalesman: new Map([
      ["THAMER", new Map([["2026-03", 100], ["2026-04", 200]])],
      ["THAMER MOHAMMAD AHMED QASEM", new Map([["2026-03", 150], ["2026-04", 300]])],
      ["SM002", new Map([["2026-03", 50], ["2026-04", 100]])],
    ]),
  });

  assert.equal(report.salesmen.length, 1);
  assert.equal(report.salesmen[0].salesman_code, "SM002");
  assert.equal(report.salesmen[0].salesman_name, "Thamer");
  assert.equal(report.salesmen[0].current_month_sales, 600);
  assert.equal(report.salesmen[0].peak_month_sales, 300);
  assert.equal(report.rows[0].salesman_code, "SM002");
});

test("incentive report combines Thamer aliases for sales and collection rows", () => {
  const legacyInvoice = salesLine({ salesman_code: "THAMER", salesman_name: "THAMER" });
  const report = buildSalesmanIncentiveReport({
    month: "2026-04",
    customers: [{
      customerCode: "C001",
      customerName: "Alpha Trading",
      transactions: [legacyInvoice],
      receipts: [{ receipt_date: "2026-04-01", amount: 115, vch_no: "R/9" }],
    }],
    monthlySalesBySalesman: new Map([
      ["THAMER", new Map([["2026-04", 100]])],
      ["THAMER MOHAMMAD AHMED QASEM", new Map([["2026-04", 200]])],
      ["SM002", new Map([["2026-03", 50]])],
    ]),
  });

  assert.equal(report.salesmen.length, 1);
  assert.equal(report.salesmen[0].salesman_code, "SM002");
  assert.equal(report.salesmen[0].salesman_name, "Thamer");
  assert.equal(report.salesmen[0].current_month_sales, 300);
  assert.equal(report.salesmen[0].peak_month_sales, 50);
  assert.equal(report.salesmen[0].sales_delta, 250);
  assert.equal(report.rows[0].salesman_code, "SM002");
});
