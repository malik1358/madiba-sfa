import {
  PERFORMANCE_DISPLAY_KPI_KEYS,
  achievementPercent,
  averageSkusPerRepeatCustomer,
  buildPerformanceKpi,
  monthEndPaceEstimate,
  normalizePerformanceTargets,
  normalizeSalesmanCode,
  resolveExpectedPacePercent,
} from "./performanceKpis.js";
import { isCollectionOnlyAccess } from "./moduleAccess.js";
import {
  normalizeReportSalesmanCode,
  normalizeReportSalesmanName,
  reportSalesmanCodeAliases,
  THAMER_REPORT_CODE,
} from "./salesmanReportIdentity.js";

export const NO_BOSS_KEY = "__NO_BOSS__";
export const TEAM_TARGET_PREFIX = "TEAM:";

export function isKpiTargetProfile(profile) {
  const code = normalizeSalesmanCode(profile?.salesman_code);
  if (!code) return false;
  const name = String(profile?.salesman_name || "").trim().toUpperCase().replace(/\s+/g, " ");
  const namedException = ["ZIA", "ASRAR", "ASRAR AHMED"].includes(name);
  if (profile?.is_active === false && !namedException) return false;
  return namedException
    || !isCollectionOnlyAccess({ role: profile?.role, salesmanCode: code });
}

export function mergeKpiTargetProfiles(profiles = []) {
  const byCode = new Map();

  (profiles || []).forEach((profile) => {
    const storedCode = normalizeSalesmanCode(profile?.salesman_code);
    const code = normalizeReportSalesmanCode(storedCode);
    if (!code) return;

    const current = byCode.get(code);
    const priority = code === THAMER_REPORT_CODE && storedCode === code ? 1 : 0;
    if (current && current.priority >= priority) return;

    byCode.set(code, {
      ...profile,
      salesman_code: code,
      salesman_name: normalizeReportSalesmanName(profile?.salesman_name)
        || normalizeReportSalesmanName(storedCode)
        || code,
      priority,
    });
  });

  return [...byCode.values()].map(({ priority, ...profile }) => profile);
}

export function teamTargetSalesmanCode(bossCode) {
  const code = normalizeSalesmanCode(bossCode);
  return code ? `${TEAM_TARGET_PREFIX}${code}` : "";
}

export function isTeamTargetSalesmanCode(value) {
  return String(value || "").trim().toUpperCase().startsWith(TEAM_TARGET_PREFIX);
}

export function bossCodeFromTeamTarget(value) {
  const raw = String(value || "").trim();
  if (!isTeamTargetSalesmanCode(raw)) return "";
  return normalizeSalesmanCode(raw.slice(TEAM_TARGET_PREFIX.length));
}

export function salesmanFilterKey(row) {
  return normalizeSalesmanCode(row?.salesmanCode || row?.salesman_code);
}

export function bossFilterKey(row) {
  return normalizeSalesmanCode(row?.bossCode || row?.boss_code) || NO_BOSS_KEY;
}

export function matchesSelectedKeys(selectedKeys, actualKey) {
  if (!Array.isArray(selectedKeys) || selectedKeys.length === 0) return true;
  return selectedKeys.includes(String(actualKey || "").trim());
}

export function rowMatchesKpiFilters(row, { selectedSalesmen = [], selectedBosses = [] } = {}) {
  const salesmanKey = salesmanFilterKey(row);
  const bossKey = bossFilterKey(row);
  const isSelectedBossPerson = selectedBosses.includes(salesmanKey);

  if (row?.isTeam) {
    const teamBossKey = normalizeSalesmanCode(row.bossCode) || salesmanKey;
    const bossMatch = !selectedBosses.length
      || selectedBosses.includes(teamBossKey)
      || selectedBosses.includes(bossKey)
      || isSelectedBossPerson;
    if (!bossMatch) return false;
    if (!selectedSalesmen.length) return true;
    return selectedSalesmen.includes(teamBossKey) || selectedSalesmen.includes(salesmanKey);
  }

  const salesmanMatch = matchesSelectedKeys(selectedSalesmen, salesmanKey) || isSelectedBossPerson;
  const bossMatch = matchesSelectedKeys(selectedBosses, bossKey) || isSelectedBossPerson;
  return salesmanMatch && bossMatch;
}

export function filterKpiTargetRows(rows, filters) {
  return (rows || []).filter((row) => rowMatchesKpiFilters(row, filters));
}

export function uniqueBossesFromRows(rows = []) {
  const seen = new Set();
  const bosses = [];
  (rows || []).forEach((row) => {
    if (row?.isTeam) return;
    const code = normalizeSalesmanCode(row?.bossCode);
    if (!code || seen.has(code)) return;
    seen.add(code);
    bosses.push({
      bossCode: code,
      bossName: String(row.bossName || code).trim(),
    });
  });
  return bosses.sort((left, right) => left.bossName.localeCompare(right.bossName));
}

export function teamMemberRows(rows, bossCode) {
  const code = normalizeSalesmanCode(bossCode);
  if (!code) return [];
  return (rows || []).filter((row) => {
    if (row?.isTeam) return false;
    const salesmanKey = salesmanFilterKey(row);
    const bossKey = normalizeSalesmanCode(row?.bossCode);
    return salesmanKey === code || bossKey === code;
  });
}

export function sumKpiActuals(rows = []) {
  const totals = (rows || []).reduce((result, row) => {
    (row?.kpis || []).forEach((kpi) => {
      const key = kpi?.key;
      if (!key || key === "avgSkusPerRepeatCustomer") return;
      result[key] = (result[key] || 0) + (Number(kpi.actual || 0) || 0);
    });
    result.repeatCustomerSkuCount = (result.repeatCustomerSkuCount || 0)
      + (Number(row?.actuals?.repeatCustomerSkuCount || 0) || 0);
    return result;
  }, {});
  totals.avgSkusPerRepeatCustomer = averageSkusPerRepeatCustomer(
    totals.repeatCustomerSkuCount,
    totals.repeatCustomers,
  );
  return totals;
}

export function rowTargetValue(row, key) {
  if (key === "totalSales") {
    return (Number(row?.officeSupplies || 0) || 0)
      + (Number(row?.localItemSales || 0) || 0)
      + (Number(row?.otherSales || 0) || 0)
      || Number(row?.totalSales || 0)
      || 0;
  }
  if (
    key === "cashCollection"
    || key === "totalCashCollected"
    || key === "avgSkusPerRepeatCustomer"
  ) return 0;
  return Number(row?.[key] || 0) || 0;
}

export function sumFilteredKpiColumns(rows = [], columns = PERFORMANCE_DISPLAY_KPI_KEYS) {
  const totals = {};
  columns.forEach((key) => {
    totals[key] = { actual: 0, target: 0 };
  });
  let repeatCustomerSkuCount = 0;

  (rows || []).forEach((row) => {
    if (row?.isTeam) return;
    repeatCustomerSkuCount += Number(row?.actuals?.repeatCustomerSkuCount || 0) || 0;
    columns.forEach((key) => {
      if (key === "avgSkusPerRepeatCustomer") return;
      const kpi = (row.kpis || []).find((item) => item.key === key);
      totals[key].actual += Number(kpi?.actual || 0) || 0;
      totals[key].target += rowTargetValue(row, key);
    });
  });

  if (totals.avgSkusPerRepeatCustomer) {
    totals.avgSkusPerRepeatCustomer.actual = averageSkusPerRepeatCustomer(
      repeatCustomerSkuCount,
      totals.repeatCustomers?.actual,
    );
    totals.avgSkusPerRepeatCustomer.target = 0;
  }

  columns.forEach((key) => {
    totals[key].achievement = achievementPercent(totals[key].actual, totals[key].target);
  });
  return totals;
}

export function sumFilteredKpiPaceEstimates(
  rows = [],
  columns = PERFORMANCE_DISPLAY_KPI_KEYS,
  { reportDate, todayIso, salesAsOfDate, receiptAsOfDate } = {},
) {
  const totals = sumFilteredKpiColumns(rows, columns);
  const estimates = {};
  const keysToCompute = [...new Set(columns || [])];
  if (keysToCompute.includes("totalCashCollected")) {
    if (!keysToCompute.includes("collection")) keysToCompute.push("collection");
    if (!keysToCompute.includes("cashCollection")) keysToCompute.push("cashCollection");
  }

  keysToCompute.forEach((key) => {
    if (key === "totalCashCollected") return;
    let estimateSum = 0;
    let hasEstimate = false;
    (rows || []).forEach((row) => {
      if (row?.isTeam) return;
      const target = rowTargetValue(row, key);
      const kpi = (row.kpis || []).find((item) => item.key === key);
      const actual = Number(kpi?.actual || 0) || 0;
      const rowSalesAsOf = row?.salesAsOfDate ?? salesAsOfDate;
      const rowReceiptAsOf = row?.receiptAsOfDate ?? receiptAsOfDate;
      const liveKpi = buildPerformanceKpi(key, {
        actual,
        target,
        reportDate,
        todayIso,
        paceShares: row?.paceShares || null,
        salesAsOfDate: rowSalesAsOf,
        receiptAsOfDate: rowReceiptAsOf,
      });
      const expected = liveKpi.expected != null
        ? liveKpi.expected
        : resolveExpectedPacePercent(key, {
          reportDate,
          todayIso,
          paceShares: row?.paceShares || null,
          salesAsOfDate: rowSalesAsOf,
          receiptAsOfDate: rowReceiptAsOf,
        });
      const estimate = monthEndPaceEstimate({
        actual,
        target,
        expected,
        paceGap: liveKpi.paceGap,
      });
      if (estimate == null) return;
      estimateSum += estimate;
      hasEstimate = true;
    });
    const column = totals[key] || { target: 0 };
    estimates[key] = {
      estimate: hasEstimate ? estimateSum : null,
      target: column.target,
      achievement: hasEstimate ? achievementPercent(estimateSum, column.target) : null,
    };
  });

  // Total cash collected is Collection + Cash collection (info) for actuals and for pace estimates.
  if ((columns || []).includes("totalCashCollected")) {
    const collectionEstimate = estimates.collection?.estimate;
    const cashEstimate = estimates.cashCollection?.estimate;
    const hasEstimate = collectionEstimate != null || cashEstimate != null;
    const estimateSum = hasEstimate
      ? (Number(collectionEstimate) || 0) + (Number(cashEstimate) || 0)
      : null;
    estimates.totalCashCollected = {
      estimate: estimateSum,
      target: 0,
      achievement: null,
    };
  }

  return estimates;
}

/**
 * Pace-estimate vs last month's actual for one KPI.
 * Delta and % are estimate − prior; direction is up / down / flat.
 */
export function compareKpiEstimateToPriorMonth(estimate, priorActual) {
  if (estimate == null || estimate === "") return null;
  const value = Number(estimate);
  if (!Number.isFinite(value)) return null;
  const prior = Number(priorActual || 0) || 0;
  const delta = value - prior;
  const percent = prior > 0
    ? (delta / prior) * 100
    : (value === 0 ? 0 : null);
  return {
    estimate: value,
    priorActual: prior,
    delta,
    percent,
    direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
  };
}

/** Resolve prior-month actuals for a salesman code, including report aliases (Thamer). */
export function priorMonthActualsForCode(priorActualsByCode = {}, salesmanCode = "") {
  const code = normalizeSalesmanCode(salesmanCode);
  if (!code || !priorActualsByCode || typeof priorActualsByCode !== "object") return null;
  const direct = priorActualsByCode[code] || priorActualsByCode[String(code).toUpperCase()];
  if (direct && typeof direct === "object") return direct;
  for (const alias of reportSalesmanCodeAliases(code)) {
    const found = priorActualsByCode[alias] || priorActualsByCode[String(alias).toUpperCase()];
    if (found && typeof found === "object") return found;
  }
  return null;
}

/**
 * Prefer component sales when the cache stored totalSales as 0 (common in
 * performance_kpi_actuals_v2 rows before withDerivedKpiActuals).
 */
export function priorMonthTotalSalesFromActuals(actuals = {}) {
  const office = Number(actuals?.officeSupplies || 0) || 0;
  const local = Number(actuals?.localItemSales || 0) || 0;
  const other = Number(actuals?.otherSales || 0) || 0;
  const components = office + local + other;
  const stored = actuals?.totalSales != null ? Number(actuals.totalSales || 0) || 0 : null;
  if (stored != null && stored !== 0) return stored;
  if (components !== 0) return components;
  return stored == null ? 0 : stored;
}

/** Sum last-month actuals for the same filtered (non-team) salesmen. */
export function sumFilteredPriorMonthActuals(
  rows = [],
  priorActualsByCode = {},
  columns = PERFORMANCE_DISPLAY_KPI_KEYS,
) {
  const keys = new Set(columns || []);
  if (keys.has("totalCashCollected")) {
    keys.add("collection");
    keys.add("cashCollection");
  }
  if (keys.has("avgSkusPerRepeatCustomer")) {
    keys.add("repeatCustomers");
  }
  const totals = {};
  keys.forEach((key) => {
    totals[key] = 0;
  });
  let matched = false;
  let repeatCustomerSkuCount = 0;
  (rows || []).forEach((row) => {
    if (row?.isTeam) return;
    const code = normalizeSalesmanCode(row?.salesmanCode);
    if (!code) return;
    const actuals = priorMonthActualsForCode(priorActualsByCode, code);
    if (!actuals || typeof actuals !== "object") return;
    matched = true;
    repeatCustomerSkuCount += Number(actuals.repeatCustomerSkuCount || 0) || 0;
    keys.forEach((key) => {
      if (key === "totalCashCollected" || key === "avgSkusPerRepeatCustomer") return;
      if (key === "totalSales") {
        totals.totalSales = (totals.totalSales || 0) + priorMonthTotalSalesFromActuals(actuals);
        return;
      }
      totals[key] = (totals[key] || 0) + (Number(actuals[key] || 0) || 0);
    });
  });
  if (keys.has("totalCashCollected")) {
    totals.totalCashCollected = (Number(totals.collection) || 0)
      + (Number(totals.cashCollection) || 0);
  }
  if (keys.has("avgSkusPerRepeatCustomer")) {
    totals.avgSkusPerRepeatCustomer = averageSkusPerRepeatCustomer(
      repeatCustomerSkuCount,
      totals.repeatCustomers,
    );
  }
  return matched ? totals : null;
}

export function sumFilteredKpiEstimateVsPriorMonth(
  rows = [],
  columns = PERFORMANCE_DISPLAY_KPI_KEYS,
  estimates = {},
  priorActualsByCode = {},
) {
  const priorTotals = sumFilteredPriorMonthActuals(rows, priorActualsByCode, columns);
  const comparisons = {};
  (columns || []).forEach((key) => {
    if (!priorTotals) {
      comparisons[key] = null;
      return;
    }
    comparisons[key] = compareKpiEstimateToPriorMonth(
      estimates?.[key]?.estimate,
      priorTotals[key],
    );
  });
  return comparisons;
}

export function hasExplicitTargets(targets = {}) {
  const normalized = normalizePerformanceTargets(targets);
  return PERFORMANCE_DISPLAY_KPI_KEYS.some((key) => Number(normalized[key] || 0) > 0);
}

export function teamRowLabel(bossName, teamLabel = "team") {
  const name = String(bossName || "").trim();
  return name ? `${name} — ${teamLabel}` : teamLabel;
}
