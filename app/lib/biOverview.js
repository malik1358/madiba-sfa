import { buildContributionGridRows, formatContributionPercent, formatGrowthPercent, formatMoneyAmount } from "./categoryGrowth.js";
import { buildSalesmanMomRows, summarizeSalesmanMom } from "./salesmanMom.js";
import { buildTeamMomRows } from "./salesmanTeamMom.js";

function rankByLifetime(rows = [], limit = 8) {
  return [...(rows || [])]
    .sort((left, right) => Number(right.lifetime || 0) - Number(left.lifetime || 0))
    .slice(0, limit);
}

export function buildBiOverviewModel({ growth = null, salesman = null } = {}) {
  const categories = growth?.groups || growth?.categories || [];
  const topCategories = rankByLifetime(categories, 8);
  const recentMonths = (growth?.recentMonths || []).slice(-6);
  const salesmanRows = buildSalesmanMomRows(salesman || {});
  const teamRows = buildTeamMomRows(salesman || {});
  const salesmanSummary = summarizeSalesmanMom(salesmanRows);
  const teamSummary = summarizeSalesmanMom(teamRows);

  return {
    lifetimeTotal: Number(growth?.lifetimeTotal || 0),
    currentYtd: Number(growth?.currentYtd || 0),
    priorYtd: Number(growth?.priorYtd || 0),
    yoyPercent: growth?.yoyPercent ?? null,
    growingCount: Number(growth?.meta?.growingCount || 0),
    decliningCount: Number(growth?.meta?.decliningCount || 0),
    warningCount: Number(growth?.meta?.warningCount || 0),
    categoryCount: categories.length,
    topCategories,
    contributionRows: buildContributionGridRows(topCategories, recentMonths),
    recentMonths,
    currentMonth: growth?.currentMonth || "",
    salesmanSummary,
    teamSummary,
    topSalesmen: [...salesmanRows]
      .sort((left, right) => Number(right.latestCompleteAmount || 0) - Number(left.latestCompleteAmount || 0))
      .slice(0, 8),
    teams: [...teamRows]
      .sort((left, right) => Number(right.latestCompleteAmount || 0) - Number(left.latestCompleteAmount || 0))
      .slice(0, 8),
    preparedAt: growth?.meta?.preparedAt || salesman?.meta?.preparedAt || "",
  };
}

export function overviewKpiTone(percent) {
  if (percent == null || !Number.isFinite(Number(percent))) return "";
  if (Number(percent) > 0) return "up";
  if (Number(percent) < 0) return "down";
  return "";
}

export function formatOverviewKpi(value, kind = "money") {
  if (kind === "percent") return formatGrowthPercent(value);
  if (kind === "share") return formatContributionPercent(value);
  if (kind === "count") return String(Number(value || 0));
  return formatMoneyAmount(value);
}
