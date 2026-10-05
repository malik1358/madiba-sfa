import { enumerateMonths, enumerateQuarters, normalizeGrowthFilters, quarterKeyFromMonthKey, rowMatchesGrowthFilters, salesDateKey } from "./categoryGrowth.js";
import { isCreditNoteTransaction } from "./paymentBehavior.js";

export function formatCustomerCohortCell(count, size, mode = "count", { isNew = false, newLabel = "New" } = {}) {
  if (count == null) return "-";
  const customers = Number(count).toLocaleString("en-SA");
  if (mode === "count") return customers;
  if (isNew) return `${customers} (${newLabel})`;
  return size > 0 ? `${customers} (${(count / size * 100).toFixed(1)}%)` : `${customers} (N/A)`;
}

export function customerCohortRetentionTotal(cohorts = [], period = "") {
  return (cohorts || []).reduce((total, cohort) => {
    if (!(cohort.quarter < period)) return total;
    total.count += Number(cohort.counts?.[period] || 0);
    total.eligible += Number(cohort.customerCount || 0);
    return total;
  }, { count: 0, eligible: 0 });
}

function purchaseAmount(row) {
  if (isCreditNoteTransaction(row)) return 0;
  const amount = row.cash_sales_amount != null && row.credit_sales_amount != null
    ? Number(row.cash_sales_amount) + Number(row.credit_sales_amount)
    : Number(row.sales_amount);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function bimonthKeyFromDate(date) {
  const match = String(date || "").match(/^(\d{4})-(\d{2})/);
  if (!match) return "";
  const month = Number(match[2]);
  if (month < 1 || month > 12) return "";
  return `${match[1]}-B${Math.ceil(month / 2)}`;
}

function enumerateBimonths(start, end) {
  const parse = (value) => {
    const match = String(value || "").match(/^(\d{4})-B([1-6])$/);
    return match ? Number(match[1]) * 6 + Number(match[2]) - 1 : null;
  };
  const first = parse(start);
  const last = parse(end);
  if (first == null || last == null || first > last) return [];
  const periods = [];
  for (let value = first; value <= last; value += 1) {
    periods.push(`${Math.floor(value / 6)}-B${(value % 6) + 1}`);
  }
  return periods;
}

export function buildCustomerCohortReport(rows = [], { filters = {}, asOfDate = "", period = "quarter" } = {}) {
  const applied = normalizeGrowthFilters(filters);
  const monthly = period === "month";
  const bimonthly = period === "bimonth";
  const periodOf = (date) => monthly
    ? date.slice(0, 7)
    : bimonthly ? bimonthKeyFromDate(date) : quarterKeyFromMonthKey(date.slice(0, 7));
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
    const amount = purchaseAmount(row);
    if (!code || !quarter || (asOfDate && date > asOfDate) || !(amount > 0)) continue;
    if (!customers.has(code)) customers.set(code, { firstQuarter: quarter, included: false, purchases: new Set(), salesByPeriod: new Map() });
    const customer = customers.get(code);
    if (quarter < customer.firstQuarter) customer.firstQuarter = quarter;
    if (rowMatchesGrowthFilters(row, membershipFilters)) {
      customer.included = true;
      customer.purchases.add(quarter);
      customer.salesByPeriod.set(quarter, (customer.salesByPeriod.get(quarter) || 0) + amount);
    }
    if (!firstQuarter || quarter < firstQuarter) firstQuarter = quarter;
    if (!lastQuarter || quarter > lastQuarter) lastQuarter = quarter;
  }
  const currentQuarter = asOfDate ? periodOf(asOfDate) : "";
  const start = applied.dateFrom ? periodOf(applied.dateFrom) : firstQuarter;
  const end = (applied.dateTo ? periodOf(applied.dateTo) : "") || currentQuarter || lastQuarter;
  const visibleEnd = currentQuarter && end > currentQuarter ? currentQuarter : end;
  const quarters = monthly
    ? enumerateMonths(start, visibleEnd)
    : bimonthly ? enumerateBimonths(start, visibleEnd) : enumerateQuarters(start, visibleEnd);
  const cohorts = new Map();
  for (const customer of customers.values()) {
    if (!customer.included) continue;
    const key = customer.firstQuarter;
    if (!cohorts.has(key)) cohorts.set(key, {
      quarter: key,
      customerCount: 0,
      counts: Object.fromEntries(quarters.map((quarter) => [quarter, quarter < key ? null : 0])),
      salesValues: Object.fromEntries(quarters.map((quarter) => [quarter, 0])),
    });
    const cohort = cohorts.get(key);
    cohort.customerCount += 1;
    for (const quarter of customer.purchases) {
      if (Object.hasOwn(cohort.counts, quarter)) cohort.counts[quarter] += 1;
    }
    for (const [quarter, value] of customer.salesByPeriod) {
      if (Object.hasOwn(cohort.salesValues, quarter)) cohort.salesValues[quarter] += value;
    }
  }
  const cohortRows = [...cohorts.values()].filter((row) => !end || row.quarter <= end).sort((left, right) => left.quarter.localeCompare(right.quarter));
  return {
    quarters,
    currentQuarter,
    rows: cohortRows,
    customerCount: cohortRows.reduce((sum, row) => sum + row.customerCount, 0),
    totals: Object.fromEntries(quarters.map((quarter) => [quarter, cohortRows.reduce((sum, row) => sum + Number(row.counts[quarter] || 0), 0)])),
    valueTotals: Object.fromEntries(quarters.map((quarter) => [quarter, cohortRows.reduce((sum, row) => sum + Number(row.salesValues[quarter] || 0), 0)])),
  };
}