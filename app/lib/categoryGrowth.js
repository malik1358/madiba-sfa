export const UNCLASSIFIED_CATEGORY = "Unclassified";
export const DEFAULT_GROWTH_GROUP_BY = "category";

export const GROWTH_DIMENSIONS = [
  { key: "category", label: { en: "Category", ar: "الفئة" } },
  { key: "salesman", label: { en: "Salesman", ar: "المندوب" } },
  { key: "salesman_code", label: { en: "Salesman code", ar: "رمز المندوب" } },
  { key: "salesman_name", label: { en: "Salesman name", ar: "اسم المندوب" } },
  { key: "customer", label: { en: "Customer", ar: "العميل" } },
  { key: "customer_code", label: { en: "Customer code", ar: "رمز العميل" } },
  { key: "customer_name", label: { en: "Customer name", ar: "اسم العميل" } },
  { key: "item", label: { en: "Item", ar: "الصنف" } },
  { key: "item_code", label: { en: "Item code", ar: "رمز الصنف" } },
  { key: "item_name", label: { en: "Item name", ar: "اسم الصنف" } },
  { key: "voucher_type", label: { en: "Voucher type", ar: "نوع السند" } },
  { key: "voucher_number", label: { en: "Voucher number", ar: "رقم السند" } },
  { key: "reference", label: { en: "Reference", ar: "المرجع" } },
  { key: "local_import", label: { en: "Local / Import", ar: "محلي / مستورد" } },
  { key: "abc_class", label: { en: "ABC class", ar: "تصنيف ABC" } },
  { key: "year", label: { en: "Year", ar: "السنة" } },
  { key: "month", label: { en: "Month", ar: "الشهر" } },
  { key: "year_month", label: { en: "Year-month", ar: "سنة-شهر" } },
];

export const GROWTH_DIMENSION_KEYS = GROWTH_DIMENSIONS.map((item) => item.key);

export function growthDimensionLabel(key, language = "en") {
  const dimension = GROWTH_DIMENSIONS.find((item) => item.key === key);
  if (!dimension) return key;
  return dimension.label[language] || dimension.label.en;
}

export function normalizeCategoryName(value) {
  const text = String(value ?? "").trim();
  return text || UNCLASSIFIED_CATEGORY;
}

function joinNameCode(name, code) {
  const display = String(name || "").trim();
  const id = String(code || "").trim();
  if (display && id) return `${display} · ${id}`;
  return display || id || UNCLASSIFIED_CATEGORY;
}

function optionalNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function dimensionValue(row = {}, key) {
  const dateKey = salesDateKey(row.transaction_date);
  switch (String(key || "")) {
    case "category":
      return normalizeCategoryName(row.category);
    case "salesman":
      return joinNameCode(row.salesman_name, row.salesman_code);
    case "customer":
      return joinNameCode(row.customer_name, row.customer_code);
    case "item":
      return joinNameCode(row.item_name, row.item_code);
    case "year":
      return dateKey.slice(0, 4) || UNCLASSIFIED_CATEGORY;
    case "month":
    case "year_month":
      return monthKeyFromDateKey(dateKey) || UNCLASSIFIED_CATEGORY;
    default:
      return normalizeCategoryName(row[key]);
  }
}

export function emptyGrowthFilters() {
  return {
    groupBy: DEFAULT_GROWTH_GROUP_BY,
    dateFrom: "",
    dateTo: "",
    amountMin: "",
    amountMax: "",
    quantityMin: "",
    quantityMax: "",
    values: Object.fromEntries(GROWTH_DIMENSION_KEYS.map((key) => [key, []])),
  };
}

export function normalizeGrowthFilters(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const valuesSource = source.values && typeof source.values === "object" ? source.values : source;
  const groupBy = GROWTH_DIMENSION_KEYS.includes(source.groupBy) ? source.groupBy : DEFAULT_GROWTH_GROUP_BY;
  const values = {};

  GROWTH_DIMENSION_KEYS.forEach((key) => {
    const selected = Array.isArray(valuesSource[key]) ? valuesSource[key] : [];
    values[key] = [...new Set(selected.map((item) => String(item ?? "").trim()).filter(Boolean))];
  });

  return {
    groupBy,
    dateFrom: salesDateKey(source.dateFrom),
    dateTo: salesDateKey(source.dateTo),
    amountMin: optionalNumber(source.amountMin),
    amountMax: optionalNumber(source.amountMax),
    quantityMin: optionalNumber(source.quantityMin),
    quantityMax: optionalNumber(source.quantityMax),
    values,
  };
}

export function hasActiveGrowthFilters(input = {}) {
  const filters = normalizeGrowthFilters(input);
  if (filters.dateFrom || filters.dateTo) return true;
  if (filters.amountMin != null || filters.amountMax != null) return true;
  if (filters.quantityMin != null || filters.quantityMax != null) return true;
  return GROWTH_DIMENSION_KEYS.some((key) => (filters.values[key] || []).length > 0);
}

function selectedValueSet(values) {
  return new Set((values || []).map((item) => String(item).trim().toLowerCase()));
}

export function rowMatchesGrowthFilters(row = {}, input = {}) {
  const filters = input?.values ? input : normalizeGrowthFilters(input);
  const dateKey = salesDateKey(row.transaction_date);
  if (filters.dateFrom && (!dateKey || dateKey < filters.dateFrom)) return false;
  if (filters.dateTo && (!dateKey || dateKey > filters.dateTo)) return false;

  const amount = Number(row.sales_amount || 0);
  if (filters.amountMin != null && (!(amount >= filters.amountMin))) return false;
  if (filters.amountMax != null && (!(amount <= filters.amountMax))) return false;

  const quantity = Number(row.quantity || 0);
  if (filters.quantityMin != null && (!(quantity >= filters.quantityMin))) return false;
  if (filters.quantityMax != null && (!(quantity <= filters.quantityMax))) return false;

  return GROWTH_DIMENSION_KEYS.every((key) => {
    const selected = selectedValueSet(filters.values?.[key]);
    if (selected.size === 0) return true;
    return selected.has(String(dimensionValue(row, key)).trim().toLowerCase());
  });
}

export function createGrowthCatalogs() {
  return Object.fromEntries(GROWTH_DIMENSION_KEYS.map((key) => [key, new Set()]));
}

export function addRowToGrowthCatalogs(catalogs, row) {
  GROWTH_DIMENSION_KEYS.forEach((key) => {
    catalogs[key].add(dimensionValue(row, key));
  });
  return catalogs;
}

export function finalizeGrowthCatalogs(catalogs = {}) {
  return Object.fromEntries(
    GROWTH_DIMENSION_KEYS.map((key) => {
      const values = [...(catalogs[key] || [])].filter(Boolean).sort((left, right) => left.localeCompare(right));
      return [key, values];
    }),
  );
}

export function salesDateKey(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return "";
}

export function monthKeyFromDateKey(dateKey) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey.slice(0, 7) : "";
}

export function previousMonthKey(monthKey) {
  const match = String(monthKey || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  return `${String(prev.year).padStart(4, "0")}-${String(prev.month).padStart(2, "0")}`;
}

export function nextMonthKey(monthKey) {
  const match = String(monthKey || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return `${String(next.year).padStart(4, "0")}-${String(next.month).padStart(2, "0")}`;
}

export function enumerateMonths(startMonth, endMonth) {
  const start = String(startMonth || "").slice(0, 7);
  const end = String(endMonth || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(start) || !/^\d{4}-\d{2}$/.test(end) || start > end) return [];

  const months = [];
  let cursor = start;
  while (cursor && cursor <= end) {
    months.push(cursor);
    cursor = nextMonthKey(cursor);
  }
  return months;
}

export function enumerateYears(startYear, endYear) {
  const start = Number(String(startYear || "").slice(0, 4));
  const end = Number(String(endYear || "").slice(0, 4));
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return [];

  const years = [];
  for (let year = start; year <= end; year += 1) {
    years.push(String(year));
  }
  return years;
}

export function growthPercent(current, previous) {
  const now = Number(current || 0);
  const prior = Number(previous || 0);
  if (!(prior > 0) || !Number.isFinite(now)) return null;
  return ((now - prior) / prior) * 100;
}

export function cagrPercent(startValue, endValue, periods) {
  const start = Number(startValue || 0);
  const end = Number(endValue || 0);
  const count = Number(periods || 0);
  if (!(start > 0) || !(end > 0) || count < 1) return null;
  return ((end / start) ** (1 / count) - 1) * 100;
}

export function formatGrowthPercent(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toFixed(1)}%`;
}

export function formatMoneyAmount(value) {
  return Number(value || 0).toLocaleString("en-SA", { maximumFractionDigits: 0 });
}

export function formatSharePercent(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(Math.round(value * 10) / 10).toFixed(1)}%`;
}

export function createCategoryGrowthAccumulator() {
  return {
    byGroup: new Map(),
    companyByMonth: new Map(),
    firstDate: "",
    lastDate: "",
    rowCount: 0,
    sourceRowCount: 0,
  };
}

function addAmount(map, key, amount) {
  map.set(key, Number(map.get(key) || 0) + amount);
}

function ensureGroup(acc, label, dateKey) {
  let entry = acc.byGroup.get(label);
  if (entry) return entry;
  entry = {
    label,
    category: label,
    byMonth: new Map(),
    firstDate: dateKey,
    lastDate: dateKey,
  };
  acc.byGroup.set(label, entry);
  return entry;
}

export function ingestCategoryGrowthRows(acc, rows = [], options = {}) {
  const filters = normalizeGrowthFilters(options.filters || options);
  const groupBy = filters.groupBy || DEFAULT_GROWTH_GROUP_BY;
  const catalogs = options.catalogs;

  (rows || []).forEach((row) => {
    const dateKey = salesDateKey(row.transaction_date);
    const month = monthKeyFromDateKey(dateKey);
    if (!month) return;

    const amount = Number(row.sales_amount || 0);
    if (!Number.isFinite(amount)) return;

    acc.sourceRowCount += 1;
    if (catalogs) addRowToGrowthCatalogs(catalogs, row);
    if (!rowMatchesGrowthFilters(row, filters)) return;

    const label = dimensionValue(row, groupBy);
    const entry = ensureGroup(acc, label, dateKey);
    addAmount(entry.byMonth, month, amount);
    if (dateKey < entry.firstDate) entry.firstDate = dateKey;
    if (dateKey > entry.lastDate) entry.lastDate = dateKey;

    addAmount(acc.companyByMonth, month, amount);
    if (!acc.firstDate || dateKey < acc.firstDate) acc.firstDate = dateKey;
    if (!acc.lastDate || dateKey > acc.lastDate) acc.lastDate = dateKey;
    acc.rowCount += 1;
  });

  return acc;
}

export function sumMonths(byMonth, months = []) {
  return (months || []).reduce((sum, month) => sum + Number(byMonth.get(month) || 0), 0);
}

export function monthsInYearThrough(year, throughMonth) {
  const yearText = String(year || "");
  const limit = String(throughMonth || "").slice(0, 7);
  if (!/^\d{4}$/.test(yearText)) return [];
  const start = `${yearText}-01`;
  const yearEnd = `${yearText}-12`;
  const end = !/^\d{4}-\d{2}$/.test(limit)
    ? yearEnd
    : limit.startsWith(`${yearText}-`)
      ? limit
      : limit < start
        ? ""
        : yearEnd;
  return end ? enumerateMonths(start, end) : [];
}

export function consecutiveDecliningMonths(byMonth, latestCompleteMonth, lookback = 3) {
  if (!latestCompleteMonth) return 0;
  let count = 0;
  let cursor = latestCompleteMonth;

  for (let index = 0; index < lookback; index += 1) {
    const prior = previousMonthKey(cursor);
    if (!prior) break;
    const current = Number(byMonth.get(cursor) || 0);
    const previous = Number(byMonth.get(prior) || 0);
    if (!(previous > 0) || current >= previous) break;
    count += 1;
    cursor = prior;
  }

  return count;
}

export function silentMonthCount(lastSaleMonth, latestDataMonth) {
  if (!lastSaleMonth || !latestDataMonth || lastSaleMonth >= latestDataMonth) return 0;
  const gap = enumerateMonths(nextMonthKey(lastSaleMonth), latestDataMonth);
  return gap.length;
}

export function classifyCategoryStatus({
  yoyPercent = null,
  momPercent = null,
  silentMonths = 0,
  decliningMonths = 0,
  yearCount = 0,
} = {}) {
  if (silentMonths >= 2) {
    return { status: "red", code: "silent", label: "No recent sales" };
  }
  if (yoyPercent != null && yoyPercent <= -15) {
    return { status: "red", code: "yoy_down", label: "Down vs last year" };
  }
  if (decliningMonths >= 3) {
    return { status: "red", code: "streak_down", label: "Falling 3 months" };
  }
  if (momPercent != null && momPercent <= -15) {
    return { status: "red", code: "mom_down", label: "Latest month down" };
  }
  if ((yoyPercent != null && yoyPercent < -5) || (momPercent != null && momPercent < -5)) {
    return { status: "orange", code: "softening", label: "Softening" };
  }
  if ((yoyPercent != null && yoyPercent >= 5) || (momPercent != null && momPercent >= 5)) {
    return { status: "green", code: "growing", label: "Growing" };
  }
  if (yearCount < 2 && yoyPercent == null) {
    return { status: "neutral", code: "new", label: "New / limited history" };
  }
  return { status: "orange", code: "flat", label: "Flat" };
}

function buildYearSeries(byMonth, years, throughMonth) {
  const series = {};
  years.forEach((year) => {
    series[year] = sumMonths(byMonth, monthsInYearThrough(year, throughMonth));
  });
  return series;
}

function buildMonthSeries(byMonth, months) {
  const series = {};
  months.forEach((month) => {
    series[month] = Number(byMonth.get(month) || 0);
  });
  return series;
}

export function buildCategoryGrowthReport(acc, { asOfDate = "" } = {}) {
  const lastDate = acc.lastDate || "";
  const firstDate = acc.firstDate || "";
  const lastDataMonth = lastDate ? lastDate.slice(0, 7) : "";
  const firstMonth = firstDate ? firstDate.slice(0, 7) : "";
  const asOfMonth = /^\d{4}-\d{2}-\d{2}$/.test(asOfDate) ? asOfDate.slice(0, 7) : lastDataMonth;
  const latestMonthIsPartial = Boolean(asOfMonth && lastDataMonth && lastDataMonth === asOfMonth);
  const latestCompleteMonth = latestMonthIsPartial ? previousMonthKey(lastDataMonth) : lastDataMonth;
  const priorCompleteMonth = previousMonthKey(latestCompleteMonth);
  const latestYear = lastDataMonth ? lastDataMonth.slice(0, 4) : "";
  const firstYear = firstMonth ? firstMonth.slice(0, 4) : "";
  const years = enumerateYears(firstYear, latestYear);
  const recentMonths = lastDataMonth
    ? enumerateMonths(
      enumerateMonths(firstMonth, lastDataMonth).slice(-12)[0] || lastDataMonth,
      lastDataMonth,
    )
    : [];

  const lifetimeTotal = sumMonths(acc.companyByMonth, enumerateMonths(firstMonth, lastDataMonth));
  const currentYtdMonths = latestYear ? monthsInYearThrough(latestYear, lastDataMonth) : [];
  const priorYear = latestYear ? String(Number(latestYear) - 1) : "";
  const priorYtdMonths = priorYear ? monthsInYearThrough(priorYear, `${priorYear}-${lastDataMonth.slice(5, 7)}`) : [];

  const categories = [...acc.byGroup.values()].map((entry) => {
    const lifetime = sumMonths(entry.byMonth, enumerateMonths(entry.firstDate.slice(0, 7), lastDataMonth));
    const yearValues = buildYearSeries(entry.byMonth, years, lastDataMonth);
    const monthValues = buildMonthSeries(entry.byMonth, recentMonths);
    const currentYtd = sumMonths(entry.byMonth, currentYtdMonths);
    const priorYtd = sumMonths(entry.byMonth, priorYtdMonths);
    const latestMonthAmount = Number(entry.byMonth.get(latestCompleteMonth) || 0);
    const priorMonthAmount = Number(entry.byMonth.get(priorCompleteMonth) || 0);
    const yoyPercent = growthPercent(currentYtd, priorYtd);
    const momPercent = growthPercent(latestMonthAmount, priorMonthAmount);
    const firstFullYear = years.find((year) => yearValues[year] > 0) || "";
    const lastFullYear = latestMonthIsPartial
      ? years.filter((year) => year < latestYear && yearValues[year] > 0).at(-1) || ""
      : years.filter((year) => yearValues[year] > 0).at(-1) || "";
    const cagrPeriods = firstFullYear && lastFullYear
      ? Number(lastFullYear) - Number(firstFullYear)
      : 0;
    const lastSaleMonth = entry.lastDate.slice(0, 7);
    const status = classifyCategoryStatus({
      yoyPercent,
      momPercent,
      silentMonths: silentMonthCount(lastSaleMonth, lastDataMonth),
      decliningMonths: consecutiveDecliningMonths(entry.byMonth, latestCompleteMonth),
      yearCount: years.filter((year) => yearValues[year] > 0).length,
    });

    return {
      label: entry.label || entry.category,
      category: entry.label || entry.category,
      firstDate: entry.firstDate,
      lastDate: entry.lastDate,
      lifetime,
      sharePercent: lifetimeTotal > 0 ? (lifetime / lifetimeTotal) * 100 : 0,
      currentYtd,
      priorYtd,
      yoyPercent,
      latestMonth: latestCompleteMonth,
      latestMonthAmount,
      priorMonthAmount,
      momPercent,
      cagrPercent: cagrPercent(
        firstFullYear ? yearValues[firstFullYear] : 0,
        lastFullYear ? yearValues[lastFullYear] : 0,
        cagrPeriods,
      ),
      yearValues,
      monthValues,
      status: status.status,
      statusCode: status.code,
      statusLabel: status.label,
    };
  }).sort((left, right) => {
    if (right.lifetime !== left.lifetime) return right.lifetime - left.lifetime;
    return left.category.localeCompare(right.category);
  });

  const alerts = categories
    .filter((row) => row.status === "red")
    .map((row) => ({
      code: `category-${row.statusCode}-${row.category}`,
      severity: "red",
      title: row.label || row.category,
      detail: `${row.statusLabel}. Lifetime ${formatMoneyAmount(row.lifetime)}, YTD ${formatGrowthPercent(row.yoyPercent)} vs last year.`,
    }));

  const growing = categories.filter((row) => row.status === "green").length;
  const declining = categories.filter((row) => row.status === "red").length;

  return {
    firstDate,
    lastDate,
    years,
    recentMonths,
    latestCompleteMonth,
    latestMonthIsPartial,
    lifetimeTotal,
    currentYtd: sumMonths(acc.companyByMonth, currentYtdMonths),
    priorYtd: sumMonths(acc.companyByMonth, priorYtdMonths),
    yoyPercent: growthPercent(
      sumMonths(acc.companyByMonth, currentYtdMonths),
      sumMonths(acc.companyByMonth, priorYtdMonths),
    ),
    groups: categories,
    categories,
    alerts,
    meta: {
      rowCount: acc.rowCount,
      sourceRowCount: acc.sourceRowCount,
      categoryCount: categories.length,
      groupCount: categories.length,
      growingCount: growing,
      decliningCount: declining,
      warningCount: categories.filter((row) => row.status === "orange").length,
      asOfDate: asOfDate || lastDate,
    },
  };
}
