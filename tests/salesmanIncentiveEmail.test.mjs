import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSalesmanIncentiveEmailRows,
  buildSalesmanIncentiveEmailSection,
  formatIncentiveMonthLabel,
} from "../app/lib/salesmanIncentiveEmail.js";
import { INCENTIVE_RATES, INCENTIVE_TIER_KEYS } from "../app/lib/salesmanIncentive.js";

const OPTIONS = { month: "2026-09", rates: INCENTIVE_RATES, tierKeys: INCENTIVE_TIER_KEYS };

function summary(overrides = {}) {
  return {
    salesman_code: "OSAMA",
    salesman_name: "Osama",
    tier_base: { cashFast: 0, officeSuppliesFast: 5000, electronicsFast: 0, electronicsSlow: 0, otherFast: 10000, otherSlow: 0, late: 0 },
    tier_incentive: { cashFast: 0, officeSuppliesFast: 12.5, electronicsFast: 0, electronicsSlow: 0, otherFast: 100, otherSlow: 0, late: 0 },
    collection_incentive: 112.5,
    current_month_sales: 150000,
    has_sales_history: true,
    peak_month: "2026-08",
    peak_month_sales: 140000,
    sales_delta: 10000,
    growth_incentive: 50,
    total_incentive: 162.5,
    ...overrides,
  };
}

function labels(rows) {
  return rows.map((row) => row.label);
}

function valueFor(rows, label) {
  return rows.find((row) => row.label === label)?.value;
}

test("formatIncentiveMonthLabel renders a readable month", () => {
  assert.equal(formatIncentiveMonthLabel("2026-09"), "September 2026");
  assert.equal(formatIncentiveMonthLabel(""), "");
});

test("rows are label/value pairs laid out vertically", () => {
  const rows = buildSalesmanIncentiveEmailRows(summary(), OPTIONS);

  assert.equal(rows[0].label, "Month");
  assert.equal(rows[0].value, "September 2026");
  rows.forEach((row) => {
    assert.equal(typeof row.label, "string");
    assert.equal(typeof row.value, "string");
  });

  assert.equal(valueFor(rows, "Collection incentive"), "112.50 SAR");
  assert.equal(valueFor(rows, "Growth incentive"), "50.00 SAR");
  assert.equal(valueFor(rows, "Total incentive"), "162.50 SAR");
  assert.equal(rows.at(-1).total, true);
});

test("only tiers that actually earned are listed, with their rate", () => {
  const rows = buildSalesmanIncentiveEmailRows(summary(), OPTIONS);
  const shown = labels(rows);

  assert.ok(shown.includes("Office ≤35d @ 0.25%"));
  assert.ok(shown.includes("Other ≤35d @ 1%"));
  assert.ok(!shown.some((label) => label.startsWith("Cash ≤3d")));
  assert.ok(!shown.some((label) => label.startsWith("Electronics")));

  const office = rows.find((row) => row.label.startsWith("Office"));
  assert.equal(office.value, "12.50 SAR");
  assert.equal(office.note, "on 5,000.00 collected");
});

test("late collections are called out as earning nothing", () => {
  const rows = buildSalesmanIncentiveEmailRows(
    summary({ tier_base: { ...summary().tier_base, late: 7500 } }),
    OPTIONS,
  );
  const late = rows.find((row) => row.label === "Collected too late to earn");
  assert.equal(late.value, "7,500.00 SAR");
  assert.equal(late.warn, true);
});

test("a first month says so instead of showing a best month", () => {
  const rows = buildSalesmanIncentiveEmailRows(
    summary({ has_sales_history: false, peak_month: "", peak_month_sales: 0, sales_delta: 0, growth_incentive: 0 }),
    OPTIONS,
  );
  assert.equal(valueFor(rows, "Best month ever"), "First month — no growth incentive");
  assert.ok(!labels(rows).includes("Above best month"));
  assert.equal(valueFor(rows, "Growth incentive"), "0.00 SAR");
});

test("a salesman with no settled collections still gets a readable section", () => {
  const rows = buildSalesmanIncentiveEmailRows(
    summary({
      tier_base: { cashFast: 0, officeSuppliesFast: 0, electronicsFast: 0, electronicsSlow: 0, otherFast: 0, otherSlow: 0, late: 0 },
      collection_incentive: 0,
      total_incentive: 50,
    }),
    OPTIONS,
  );
  assert.equal(valueFor(rows, "Collections settled this month"), "None yet");
});

test("section renders escaped html and a matching plain-text block", () => {
  const section = buildSalesmanIncentiveEmailSection(summary({ salesman_name: "<script>" }), OPTIONS);

  assert.ok(section.html.includes("Your incentive"));
  assert.ok(section.html.includes("All amounts exclude VAT"));
  assert.ok(section.html.includes("162.50 SAR"));
  assert.ok(!section.html.includes("<script>"));
  assert.ok(section.text.startsWith("Your incentive:"));
  assert.ok(section.text.includes("- Total incentive: 162.50 SAR"));
});

test("no summary means no section", () => {
  assert.equal(buildSalesmanIncentiveEmailSection(null, OPTIONS), null);
});
