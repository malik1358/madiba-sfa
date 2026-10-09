import { enumerateMonths, enumerateQuarters, normalizeGrowthFilters, quarterKeyFromMonthKey, rowMatchesGrowthFilters, salesDateKey } from "./categoryGrowth.js";
import { isCreditNoteTransaction } from "./paymentBehavior.js";

export function formatCustomerCohortCell(count, size, mode = "count") {
  if (count == null) return "-";
  const customers = Number(count).toLocaleString("en-SA");
  return mode === "count" ? customers : `${customers} (${(size ? count / size * 100 : 0).toFixed(1)}%)`;
}

function isPurchase(row) {
  if (isCreditNoteTransaction(row)) return false;
  const amount = row.cash_sales_amount != null && row.credit_sales_amount != null
    ? Number(row.cash_sales_amount) + Number(row.credit_sales_amount)
    : Number(row.sales_amount);
  return Number.isFinite(amount) && amount > 0;
}

export function buildCustomerCohortReport(rows = [], { filters = {}, asOfDate = "", period = "quarter" } = {}) {
  const applied = normalizeGrowthFilters(filters);
  const monthly = period === "month";
  const periodOf = (date) => monthly ? date.slice(0, 7) : quarterKeyFromMonthKey(date.slice(0, 7));
  const membershipFilters = {
    ...applied,
    dateFrom: "",
    dateTo: "",
    values: { ...applied.values, year: [], month: [], year_month: [] },
  };
  const customers = new Map();
  let firstQuarter = "";
  let lastQuarter = "";
  for (const row of rows) {
    const date = salesDateKey(row.transaction_date);
    const code = String(row.customer_code || "").trim().toUpperCase();
    const quarter = periodOf(date);
    if (!code || !quarter || (asOfDate && date > asOfDate) || !isPurchase(row)) continue;
    if (!customers.has(code)) customers.set(code, { firstQuarter: quarter, included: false, purchases: new Set() });
    const customer = customers.get(code);
    if (quarter < customer.firstQuarter) customer.firstQuarter = quarter;
    if (rowMatchesGrowthFilters(row, membershipFilters)) customer.included = true;
    if (rowMatchesGrowthFilters(row, membershipFilters)) customer.purchases.add(quarter);
    if (!firstQuarter || quarter < firstQuarter) firstQuarter = quarter;
    if (!lastQuarter || quarter > lastQuarter) lastQuarter = quarter;
  }
  const currentQuarter = asOfDate ? periodOf(asOfDate) : "";
  const start = applied.dateFrom ? periodOf(applied.dateFrom) : firstQuarter;
  const end = (applied.dateTo ? periodOf(applied.dateTo) : "") || currentQuarter || lastQuarter;
  const quarters = (monthly ? enumerateMonths : enumerateQuarters)(start, currentQuarter && end > currentQuarter ? currentQuarter : end);
  const cohorts = new Map();
  for (const customer of customers.values()) {
    if (!customer.included) continue;
    const key = customer.firstQuarter;
    if (!cohorts.has(key)) cohorts.set(key, { quarter: key, customerCount: 0, counts: Object.fromEntries(quarters.map((quarter) => [quarter, quarter < key ? null : 0])) });
    const cohort = cohorts.get(key);
    cohort.customerCount += 1;
    for (const quarter of customer.purchases) {
      if (Object.hasOwn(cohort.counts, quarter)) cohort.counts[quarter] += 1;
    }
  }
  const cohortRows = [...cohorts.values()].filter((row) => !end || row.quarter <= end).sort((left, right) => left.quarter.localeCompare(right.quarter));
  return {
    quarters,
    currentQuarter,
    rows: cohortRows,
    customerCount: cohortRows.reduce((sum, row) => sum + row.customerCount, 0),
    totals: Object.fromEntries(quarters.map((quarter) => [quarter, cohortRows.reduce((sum, row) => sum + Number(row.counts[quarter] || 0), 0)])),
  };
}