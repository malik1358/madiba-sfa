import {
  PERFORMANCE_DISPLAY_KPI_KEYS,
  achievementPercent,
  buildPerformanceKpi,
  estimateFromPaceGap,
  normalizePerformanceTargets,
  normalizeSalesmanCode,
} from "./performanceKpis.js";
import { isCollectionOnlyAccess } from "./moduleAccess.js";
import {
  normalizeReportSalesmanCode,
  normalizeReportSalesmanName,
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
  return (rows || []).reduce((totals, row) => {
    (row?.kpis || []).forEach((kpi) => {
      const key = kpi?.key;
      if (!key) return;
      totals[key] = (totals[key] || 0) + (Number(kpi.actual || 0) || 0);
    });
    return totals;
  }, {});
}

export function rowTargetValue(row, key) {
  if (key === "totalSales") {
    return (Number(row?.officeSupplies || 0) || 0)
      + (Number(row?.localItemSales || 0) || 0)
      + (Number(row?.otherSales || 0) || 0)
      || Number(row?.totalSales || 0)
      || 0;
  }
  return Number(row?.[key] || 0) || 0;
}

export function sumFilteredKpiColumns(rows = [], columns = PERFORMANCE_DISPLAY_KPI_KEYS) {
  const totals = {};
  columns.forEach((key) => {
    totals[key] = { actual: 0, target: 0 };
  });

  (rows || []).forEach((row) => {
    if (row?.isTeam) return;
    columns.forEach((key) => {
      const kpi = (row.kpis || []).find((item) => item.key === key);
      totals[key].actual += Number(kpi?.actual || 0) || 0;
      totals[key].target += rowTargetValue(row, key);
    });
  });

  columns.forEach((key) => {
    totals[key].achievement = achievementPercent(totals[key].actual, totals[key].target);
  });
  return totals;
}

export function sumFilteredKpiPaceEstimates(
  rows = [],
  columns = PERFORMANCE_DISPLAY_KPI_KEYS,
  { reportDate, todayIso } = {},
) {
  const totals = sumFilteredKpiColumns(rows, columns);
  const estimates = {};

  columns.forEach((key) => {
    const column = totals[key] || { actual: 0, target: 0 };
    const liveKpi = buildPerformanceKpi(key, {
      actual: column.actual,
      target: column.target,
      reportDate,
      todayIso,
    });
    const estimate = estimateFromPaceGap(column.target, liveKpi.paceGap);
    estimates[key] = {
      estimate,
      target: column.target,
      expected: liveKpi.expected,
      paceGap: liveKpi.paceGap,
      achievement: achievementPercent(estimate, column.target),
    };
  });

  return estimates;
}

export function hasExplicitTargets(targets = {}) {
  const normalized = normalizePerformanceTargets(targets);
  return PERFORMANCE_DISPLAY_KPI_KEYS.some((key) => Number(normalized[key] || 0) > 0);
}

export function teamRowLabel(bossName, teamLabel = "team") {
  const name = String(bossName || "").trim();
  return name ? `${name} — ${teamLabel}` : teamLabel;
}
