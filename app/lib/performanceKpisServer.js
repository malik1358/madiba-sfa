import { currentMonthDateRange } from "./salesInvoices.js";
import {
  buildPerformanceSnapshot,
  buildPaceCurveFromHistory,
  buyingCustomerCodesFromSales,
  classifyBuyingCustomers,
  cumulativeByDay,
  emptyPerformanceActuals,
  emptyPerformanceTargets,
  isMissingSchemaColumn,
  normalizePerformanceTargets,
  normalizeSalesmanCode,
  splitSalesActuals,
  sumCollectionAmount,
  summarizeHistoricalMonth,
} from "./performanceKpis.js";
import { ksaDayBounds } from "./workdayActivity.js";

// Trailing months used to derive each salesman's personal sales pace.
const PACE_HISTORY_MONTHS = 3;

const TARGET_SELECTS = [
  "id,salesman_code,target_month,sales_target,office_supplies_sales_target,other_sales_target,collection_target,new_buying_customers_target,existing_customers_buying_target,is_approved,updated_at,updated_by",
  "id,salesman_code,target_month,sales_target,office_supplies_sales_target,other_sales_target,new_buying_customers_target,existing_customers_buying_target,is_approved,updated_at",
  "id,salesman_code,target_month,sales_target,new_buying_customers_target,existing_customers_buying_target,is_approved,updated_at",
];

function isMissingColumnError(error) {
  return isMissingSchemaColumn(error);
}

function isMissingTableError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42P01"
    || message.includes("could not find the table")
    || (message.includes("relation") && message.includes("does not exist"));
}

function chunkList(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function fetchPagedRows(admin, table, select, applyFilters) {
  const pageSize = 1000;
  const rows = [];
  let from = 0;

  while (true) {
    let query = admin.from(table).select(select).range(from, from + pageSize - 1);
    query = applyFilters(query);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

export function monthWindow(reportDate) {
  const range = currentMonthDateRange(reportDate);
  const start = ksaDayBounds(range.from);
  const end = ksaDayBounds(range.to);
  return {
    from: range.from,
    to: range.to,
    startIso: start.startIso,
    endIso: end.endIso,
  };
}

// Calendar window for a past month relative to the report date.
// offset 1 = previous month, 2 = two months back, etc.
export function trailingMonthWindow(reportDate, offset) {
  const base = String(reportDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) throw new Error("Invalid report date.");
  const year = Number(base.slice(0, 4));
  const month = Number(base.slice(5, 7)) - offset;
  const shifted = new Date(Date.UTC(year, month, 1));
  const shiftedYear = shifted.getUTCFullYear();
  const shiftedMonth = shifted.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(shiftedYear, shiftedMonth, 0)).getUTCDate();
  const from = `${String(shiftedYear).padStart(4, "0")}-${String(shiftedMonth).padStart(2, "0")}-01`;
  const to = `${String(shiftedYear).padStart(4, "0")}-${String(shiftedMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const start = ksaDayBounds(from);
  const end = ksaDayBounds(to);
  return { from, to, daysInMonth: lastDay, startIso: start.startIso, endIso: end.endIso };
}

async function fetchHistorySalesRows(admin, { salesmanCode, from, to }) {
  const select = "transaction_date,customer_code,sales_amount,category,item_name";
  try {
    return await fetchPagedRows(
      admin,
      "active_sales",
      select,
      (query) => query
        .eq("salesman_code", salesmanCode)
        .gte("transaction_date", from)
        .lte("transaction_date", to),
    );
  } catch (error) {
    if (!isMissingColumnError(error)) throw error;
    return fetchPagedRows(
      admin,
      "active_sales",
      "transaction_date,customer_code,sales_amount",
      (query) => query
        .eq("salesman_code", salesmanCode)
        .gte("transaction_date", from)
        .lte("transaction_date", to),
    );
  }
}

async function fetchHistoryCollectionRows(admin, { customerCodes, window }) {
  const visits = [];
  for (const chunk of chunkList(customerCodes, 200)) {
    const rows = await fetchPagedRows(
      admin,
      "collection_visits",
      "saved_at,amount_received",
      (query) => query
        .in("customer_code", chunk)
        .gte("saved_at", window.startIso)
        .lte("saved_at", window.endIso),
    );
    visits.push(...rows.map((row) => ({
      ...row,
      transaction_date: String(row.saved_at || "").slice(0, 10),
    })));
  }
  return visits;
}

// Collects per-month KPI totals and cumulative daily curves for the trailing
// PACE_HISTORY_MONTHS months for one salesman. Months where the salesman had
// no activity at all are skipped, so new joiners simply end up with fewer (or
// zero) usable months and fall back to team/calendar pace downstream.
export async function loadHistoricalMonthData(admin, { salesmanCode, reportDate }) {
  const code = normalizeSalesmanCode(salesmanCode);
  if (!code) return [];

  const windows = [];
  for (let offset = 1; offset <= PACE_HISTORY_MONTHS; offset += 1) {
    windows.push(trailingMonthWindow(reportDate, offset));
  }
  // Earliest boundary lets us classify new vs repeat customers per month.
  const earliestPriorTo = windows[windows.length - 1].from;

  const customers = await fetchPagedRows(
    admin,
    "customers",
    "customer_code",
    (query) => query.eq("current_salesman_code", code),
  );
  const customerCodes = [...new Set(
    (customers || []).map((row) => normalizeSalesmanCode(row.customer_code)).filter(Boolean),
  )];

  const months = [];
  for (const window of windows) {
    const salesRows = await fetchHistorySalesRows(admin, {
      salesmanCode: code,
      from: window.from,
      to: window.to,
    });
    const collectionRows = customerCodes.length
      ? await fetchHistoryCollectionRows(admin, { customerCodes, window })
      : [];

    const officeDaily = new Map();
    const otherDaily = new Map();
    let officeTotal = 0;
    let otherTotal = 0;
    salesRows.forEach((row) => {
      const amount = Number(row?.sales_amount || 0);
      if (!(amount > 0)) return;
      const raw = String(row?.transaction_date || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return;
      const day = Number(raw.slice(8, 10));
      if (!day) return;
      if (splitSalesActuals([row]).officeSupplies > 0) {
        officeDaily.set(day, (officeDaily.get(day) || 0) + amount);
        officeTotal += amount;
      } else {
        otherDaily.set(day, (otherDaily.get(day) || 0) + amount);
        otherTotal += amount;
      }
    });
    const buildCumulative = (daily, total) => {
      if (!(total > 0)) return null;
      const list = [];
      let running = 0;
      for (let day = 1; day <= window.daysInMonth; day += 1) {
        running += daily.get(day) || 0;
        list.push(running);
      }
      return list;
    };

    const priorCustomerCodes = [];
    const monthCustomerCodes = buyingCustomerCodesFromSales(salesRows);
    const uniqueMonthCodes = [...new Set(monthCustomerCodes)];
    for (const chunk of chunkList(uniqueMonthCodes, 200)) {
      const priorRows = await fetchPagedRows(
        admin,
        "active_sales",
        "customer_code",
        (query) => query
          .in("customer_code", chunk)
          .lt("transaction_date", earliestPriorTo),
      );
      priorRows.forEach((row) => {
        const customerCode = normalizeSalesmanCode(row.customer_code);
        if (customerCode) priorCustomerCodes.push(customerCode);
      });
    }

    const totals = summarizeHistoricalMonth([...salesRows, ...collectionRows], {
      priorCustomerCodes,
    });
    const hasActivity = Object.values(totals).some((value) => value > 0);
    if (!hasActivity) continue;

    const officeCurve = buildCumulative(officeDaily, officeTotal);
    const otherCurve = buildCumulative(otherDaily, otherTotal);
    const collectionCurve = cumulativeByDay(collectionRows);

    months.push({
      month: window.from.slice(0, 7),
      daysInMonth: window.daysInMonth,
      mtdDays: window.daysInMonth,
      totals,
      dailyCumulative: {
        officeSupplies: officeCurve,
        otherSales: otherCurve,
        collection: collectionCurve.length ? collectionCurve : null,
        newCustomers: null,
        repeatCustomers: null,
      },
    });
  }
  return months;
}

// Reshapes months whose per-KPI curves differ into flat per-KPI month lists so
// buildPaceCurveFromHistory can average each KPI's share curve independently.
export function toPaceHistoryMonths(months = []) {
  const result = {};
  ["officeSupplies", "otherSales", "collection", "newCustomers", "repeatCustomers"].forEach((key) => {
    result[key] = months
      .map((month) => ({
        daysInMonth: month.daysInMonth,
        mtdDays: month.mtdDays,
        total: Number(month.totals?.[key] || 0),
        dailyCumulative: month.dailyCumulative?.[key] || null,
      }))
      .filter((month) => month.total > 0);
  });
  return result;
}

function buildCurvesFromPerKpiMonths(perKpiMonths) {
  const curves = {};
  Object.entries(perKpiMonths || {}).forEach(([key, months]) => {
    const perKeyFlat = months.map((month) => ({
      daysInMonth: month.daysInMonth,
      mtdDays: month.mtdDays,
      totals: { [key]: month.total },
      dailyCumulative: month.dailyCumulative,
    }));
    curves[key] = buildPaceCurveFromHistory(perKeyFlat).perKpi[key];
  });
  return { monthsUsed: Object.values(perKpiMonths || {}).reduce((max, list) => Math.max(max, list.length), 0), perKpi: curves };
}

// Averages individual pace curves across salesmen into a team-level curve used
// as fallback for new joiners without personal history.
export function buildTeamPaceCurve(individualCurves = []) {
  const keys = ["officeSupplies", "otherSales", "collection", "newCustomers", "repeatCustomers"];
  const perKpi = {};
  keys.forEach((key) => {
    const contributions = individualCurves
      .map((curve) => curve?.perKpi?.[key])
      .filter((entry) => entry && entry.baselineTotal > 0 && entry.points.length);
    if (!contributions.length) {
      perKpi[key] = { points: [], baselineTotal: 0 };
      return;
    }
    const sums = new Map();
    const counts = new Map();
    contributions.forEach((entry) => {
      entry.points.forEach((point) => {
        sums.set(point.day, (sums.get(point.day) || 0) + point.share);
        counts.set(point.day, (counts.get(point.day) || 0) + 1);
      });
    });
    const points = [];
    for (let day = 1; day <= 31; day += 1) {
      if (!counts.has(day)) continue;
      points.push({ day, share: sums.get(day) / counts.get(day) });
    }
    perKpi[key] = {
      points,
      baselineTotal: contributions.reduce((sum, entry) => sum + entry.baselineTotal, 0),
    };
  });
  return {
    monthsUsed: Math.max(0, ...individualCurves.map((curve) => curve?.monthsUsed || 0)),
    perKpi,
  };
}

function buildIndividualPaceCurve(months = []) {
  const perKpiMonths = toPaceHistoryMonths(months);
  const anyHistory = Object.values(perKpiMonths).some((list) => list.length > 0);
  if (!anyHistory) return null;
  return buildCurvesFromPerKpiMonths(perKpiMonths);
}

export async function loadSalesActuals(admin, { salesmanCode, reportDate }) {
  const code = normalizeSalesmanCode(salesmanCode);
  if (!code) {
    return { officeSupplies: 0, otherSales: 0, monthCustomerCodes: [], priorCustomerCodes: [] };
  }

  const { from, to } = monthWindow(reportDate);
  let monthRows;
  try {
    monthRows = await fetchPagedRows(
      admin,
      "active_sales",
      "customer_code,sales_amount,category,item_name",
      (query) => query
        .eq("salesman_code", code)
        .gte("transaction_date", from)
        .lte("transaction_date", to),
    );
  } catch (error) {
    if (!isMissingColumnError(error)) throw error;
    monthRows = await fetchPagedRows(
      admin,
      "active_sales",
      "customer_code,sales_amount",
      (query) => query
        .eq("salesman_code", code)
        .gte("transaction_date", from)
        .lte("transaction_date", to),
    );
  }

  const monthCustomerCodes = buyingCustomerCodesFromSales(monthRows);
  const uniqueMonthCodes = [...new Set(monthCustomerCodes)];
  const priorCustomerCodes = [];

  for (const chunk of chunkList(uniqueMonthCodes, 200)) {
    if (!chunk.length) continue;
    const priorRows = await fetchPagedRows(
      admin,
      "active_sales",
      "customer_code",
      (query) => query
        .in("customer_code", chunk)
        .lt("transaction_date", from),
    );
    priorRows.forEach((row) => {
      const customerCode = normalizeSalesmanCode(row.customer_code);
      if (customerCode) priorCustomerCodes.push(customerCode);
    });
  }

  const split = splitSalesActuals(monthRows);
  return {
    officeSupplies: split.officeSupplies,
    otherSales: split.otherSales,
    monthCustomerCodes,
    priorCustomerCodes,
  };
}

export async function loadCollectionActual(admin, { salesmanCode, reportDate }) {
  const code = normalizeSalesmanCode(salesmanCode);
  if (!code) return 0;

  const { startIso, endIso } = monthWindow(reportDate);
  const customers = await fetchPagedRows(
    admin,
    "customers",
    "customer_code",
    (query) => query.eq("current_salesman_code", code),
  );
  const customerCodes = [...new Set(
    (customers || []).map((row) => normalizeSalesmanCode(row.customer_code)).filter(Boolean),
  )];
  if (!customerCodes.length) return 0;

  const visits = [];
  for (const chunk of chunkList(customerCodes, 200)) {
    const rows = await fetchPagedRows(
      admin,
      "collection_visits",
      "amount_received,customer_code",
      (query) => query
        .in("customer_code", chunk)
        .gte("saved_at", startIso)
        .lte("saved_at", endIso),
    );
    visits.push(...rows);
  }

  return sumCollectionAmount(visits);
}

export async function loadKpiTargetsBySalesman(admin, { salesmanCodes, reportDate }) {
  const codes = [...new Set((salesmanCodes || []).map(normalizeSalesmanCode).filter(Boolean))];
  const empty = new Map();
  if (!codes.length) return empty;

  const targetMonth = monthWindow(reportDate).from;
  let result = { data: [], error: null };

  for (const select of TARGET_SELECTS) {
    result = await admin
      .from("kpi_targets")
      .select(select)
      .eq("target_month", targetMonth)
      .in("salesman_code", codes);

    if (!result.error) break;
    if (isMissingTableError(result.error)) return empty;
    if (!isMissingColumnError(result.error)) throw result.error;
  }

  if (result.error) throw result.error;

  const updaterIds = [...new Set(
    (result.data || []).map((row) => String(row.updated_by || "").trim()).filter(Boolean),
  )];
  const updaterNames = new Map();
  if (updaterIds.length) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id,salesman_name")
      .in("id", updaterIds);
    (profiles || []).forEach((profile) => {
      updaterNames.set(profile.id, String(profile.salesman_name || "").trim());
    });
  }

  const byCode = new Map();
  (result.data || []).forEach((row) => {
    const code = normalizeSalesmanCode(row.salesman_code);
    if (!code) return;
    byCode.set(code, {
      targets: normalizePerformanceTargets(row),
      updatedAt: row.updated_at || null,
      updatedByName: updaterNames.get(String(row.updated_by || "").trim()) || "",
    });
  });
  return byCode;
}

export async function loadPerformanceSnapshot(admin, {
  salesmanCode,
  salesmanName = "",
  reportDate,
  targetRow = null,
  paceCurve = null,
  teamPaceCurve = null,
  historyMonthsUsed = 0,
} = {}) {
  const code = normalizeSalesmanCode(salesmanCode);
  const [salesActuals, collection] = await Promise.all([
    loadSalesActuals(admin, { salesmanCode: code, reportDate }),
    loadCollectionActual(admin, { salesmanCode: code, reportDate }),
  ]);
  const classified = classifyBuyingCustomers(
    salesActuals.monthCustomerCodes,
    salesActuals.priorCustomerCodes,
  );
  const actuals = {
    ...emptyPerformanceActuals(),
    officeSupplies: salesActuals.officeSupplies,
    otherSales: salesActuals.otherSales,
    collection,
    newCustomers: classified.newCustomers,
    repeatCustomers: classified.repeatCustomers,
  };

  let resolvedTarget = targetRow;
  if (!resolvedTarget && code) {
    const targets = await loadKpiTargetsBySalesman(admin, { salesmanCodes: [code], reportDate });
    resolvedTarget = targets.get(code) || null;
  }

  return buildPerformanceSnapshot({
    reportDate,
    salesmanCode: code,
    salesmanName,
    actuals,
    targets: resolvedTarget?.targets || emptyPerformanceTargets(),
    paceCurve: paceCurve || null,
    teamPaceCurve: teamPaceCurve || null,
    historyMonthsUsed,
    updatedAt: resolvedTarget?.updatedAt || null,
    updatedByName: resolvedTarget?.updatedByName || "",
  });
}

export async function loadPerformanceSnapshotsForSalesmen(admin, {
  salesmen = [],
  reportDate,
} = {}) {
  const codes = [...new Set(
    (salesmen || []).map((row) => normalizeSalesmanCode(row.salesmanCode || row.salesman_code)).filter(Boolean),
  )];
  const targetsByCode = await loadKpiTargetsBySalesman(admin, { salesmanCodes: codes, reportDate });

  // Personal pace from the last 3 months of each salesman's own performance.
  // New joiners without history get no curve here and fall back to the
  // team-average curve (or plain calendar pace for solo views).
  const historyByCode = new Map();
  await Promise.all(codes.map(async (code) => {
    try {
      const months = await loadHistoricalMonthData(admin, { salesmanCode: code, reportDate });
      historyByCode.set(code, {
        months,
        curve: buildIndividualPaceCurve(months),
      });
    } catch (error) {
      if (!isMissingColumnError(error) && !isMissingTableError(error)) throw error;
      historyByCode.set(code, { months: [], curve: null });
    }
  }));

  const individualCurves = codes
    .map((code) => historyByCode.get(code)?.curve)
    .filter(Boolean);
  const teamPaceCurve = individualCurves.length ? buildTeamPaceCurve(individualCurves) : null;

  return Promise.all((salesmen || []).map((salesman) => {
    const code = normalizeSalesmanCode(salesman.salesmanCode || salesman.salesman_code);
    const history = historyByCode.get(code);
    return loadPerformanceSnapshot(admin, {
      salesmanCode: code,
      salesmanName: salesman.salesmanName || salesman.salesman_name || "",
      reportDate,
      targetRow: targetsByCode.get(code) || null,
      paceCurve: history?.curve || null,
      teamPaceCurve,
      historyMonthsUsed: history?.months?.length || 0,
    });
  }));
}
