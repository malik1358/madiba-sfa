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
  incentiveHistoryStartDate,
  incentiveMonthRange,
  parseIncentiveMonth,
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
    previousMonthSales: 800,
    salesDelta: 200,
    growthIncentive: 1,
  });
  assert.equal(computeGrowthIncentive(800, 1000).growthIncentive, 0);
});

test("month helpers resolve the report window and history start", () => {
  assert.equal(parseIncentiveMonth("2026-04-17"), "2026-04");
  assert.equal(parseIncentiveMonth("", "2026-02-09"), "2026-02");
  assert.throws(() => parseIncentiveMonth("nope"), /Invalid month/);
  assert.equal(shiftIncentiveMonth("2026-01", -1), "2025-12");
  assert.deepEqual(incentiveMonthRange("2026-02"), { from: "2026-02-01", to: "2026-02-28" });
  assert.equal(incentiveHistoryStartDate("2026-04", 12), "2025-04-01");
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
  assert.equal(report.previousMonth, "2026-03");
  assert.equal(report.monthStart, "2026-04-01");
  assert.equal(report.monthEnd, "2026-04-30");
  assert.equal(report.rows.length, 1);

  const [summary] = report.salesmen;
  assert.equal(summary.salesman_code, "S01");
  assert.equal(summary.collection_incentive, 1.25);
  assert.equal(summary.current_month_sales, 1000);
  assert.equal(summary.previous_month_sales, 200);
  assert.equal(summary.sales_delta, 800);
  assert.equal(summary.growth_incentive, 4);
  assert.equal(summary.total_incentive, 5.25);
  assert.equal(summary.tier_base.officeSuppliesFast, 100);
  assert.equal(summary.tier_base.otherFast, 100);
  assert.equal(summary.eligible_base, 200);
  assert.equal(summary.late_base, 0);
  assert.equal(report.totals.total_incentive, 5.25);
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
  assert.equal(scoped.salesmen[0].growth_incentive, 2.5);
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
    salesTransactions: [
      { ...legacyInvoice, transaction_date: "2026-04-05", sales_amount: 100 },
      { ...legacyInvoice, transaction_date: "2026-04-06", salesman_code: "THAMER MOHAMMAD AHMED QASEM", salesman_name: "THAMER MOHAMMAD AHMED QASEM", sales_amount: 200 },
      { ...legacyInvoice, transaction_date: "2026-03-05", salesman_code: "SM002", salesman_name: "Thamer", sales_amount: 50 },
    ],
  });

  assert.equal(report.salesmen.length, 1);
  assert.equal(report.salesmen[0].salesman_code, "SM002");
  assert.equal(report.salesmen[0].salesman_name, "Thamer");
  assert.equal(report.salesmen[0].current_month_sales, 300);
  assert.equal(report.salesmen[0].previous_month_sales, 50);
  assert.equal(report.rows[0].salesman_code, "SM002");
});
