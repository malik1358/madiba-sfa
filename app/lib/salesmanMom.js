import {
  formatGrowthPercent,
  formatMoneyAmount,
  growthPercent,
  monthChangeTone,
  previousMonthKey,
} from "./categoryGrowth.js";

export function monthOverMonthSeries(monthValues = {}, months = [], currentMonth = "") {
  const completeMonths = (months || []).filter((month) => month && month !== currentMonth);
  return completeMonths.map((month, index) => {
    const previous = index > 0 ? completeMonths[index - 1] : previousMonthKey(month);
    const amount = Number(monthValues?.[month] || 0);
    const priorAmount = previous ? Number(monthValues?.[previous] || 0) : 0;
    const hasPrevious = index > 0 || Boolean(previous && monthValues && Object.prototype.hasOwnProperty.call(monthValues, previous));
    return {
      month,
      amount,
      previous,
      priorAmount,
      percent: hasPrevious ? growthPercent(amount, priorAmount) : null,
      tone: monthChangeTone(amount, priorAmount, hasPrevious),
    };
  });
}

export function resolveMomComparisonMonths(report = {}) {
  const months = report.recentMonths || [];
  const currentMonth = report.currentMonth || "";
  const completeMonths = (months || []).filter((month) => month && month !== currentMonth);
  const latestCompleteMonth = completeMonths.at(-1)
    || (currentMonth ? previousMonthKey(currentMonth) : "")
    || report.latestCompleteMonth
    || "";
  const priorCompleteMonth = completeMonths.at(-2) || previousMonthKey(latestCompleteMonth);
  return {
    currentMonth,
    completeMonths,
    latestCompleteMonth,
    priorCompleteMonth,
  };
}

export function monthSeriesAmount(monthValues, monthKey) {
  if (!monthKey) return 0;
  const values = monthValues || {};
  if (Object.prototype.hasOwnProperty.call(values, monthKey)) {
    return Number(values[monthKey] || 0);
  }
  const asDate = `${monthKey}-01`;
  if (Object.prototype.hasOwnProperty.call(values, asDate)) {
    return Number(values[asDate] || 0);
  }
  return 0;
}

export function trailingToneStreak(series = [], tone) {
  let count = 0;
  for (let index = (series || []).length - 1; index >= 0; index -= 1) {
    if (series[index]?.tone !== tone) break;
    count += 1;
  }
  return count;
}

export function averageMomPercent(series = []) {
  const values = (series || [])
    .map((row) => row?.percent)
    .filter((value) => value != null && Number.isFinite(value));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function classifySalesmanMom({
  momPercent = null,
  improvingStreak = 0,
  decliningStreak = 0,
  upMonths = 0,
  comparedMonths = 0,
} = {}) {
  if (comparedMonths < 2) {
    return { status: "neutral", code: "new", label: "Limited history" };
  }
  if (decliningStreak >= 3 || (momPercent != null && momPercent <= -15)) {
    return { status: "red", code: "not_improving", label: "Not improving" };
  }
  if (improvingStreak >= 2 || (momPercent != null && momPercent >= 5 && upMonths >= 3)) {
    return { status: "green", code: "improving", label: "Improving" };
  }
  if (momPercent != null && momPercent > 0) {
    return { status: "green", code: "up", label: "Up vs last month" };
  }
  if (momPercent != null && momPercent < 0) {
    return { status: "orange", code: "slipping", label: "Slipping" };
  }
  return { status: "orange", code: "flat", label: "Flat" };
}

function statusRank(status) {
  if (status === "red") return 0;
  if (status === "orange") return 1;
  if (status === "neutral") return 2;
  return 3;
}

function normalizeSalesmanMomToken(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

const EXCLUDED_SALESMAN_MOM_NAMES = new Set([
  "RAHID",
  "AHMED HADIA",
  "VILYATH",
  "NOT ADDED IN VOUCHER",
  "NOON",
  "TRENDYOL",
  "AWAD MOHOMED",
  "FAZLUR RAHMAN",
]);

export function isExcludedSalesmanMomRow(row = {}) {
  const label = normalizeSalesmanMomToken(row.label || row.category);
  if (!label) return true;
  const parts = label.split(/\s*·\s*/).map((part) => normalizeSalesmanMomToken(part)).filter(Boolean);
  const tokens = parts.length ? parts : [label];
  return tokens.some((token) => EXCLUDED_SALESMAN_MOM_NAMES.has(token));
}

export function decorateMomRows(groups = [], report = {}) {
  const months = report.recentMonths || [];
  const { currentMonth, latestCompleteMonth, priorCompleteMonth } = resolveMomComparisonMonths(report);

  const rows = (groups || []).map((row) => {
    const series = monthOverMonthSeries(row.monthValues, months, currentMonth);
    const lastSix = series.slice(-6);
    const latest = series.at(-1);
    const latestCompleteAmount = latest
      ? Number(latest.amount || 0)
      : monthSeriesAmount(row.monthValues, latestCompleteMonth);
    const priorCompleteAmount = latest
      ? Number(latest.priorAmount || 0)
      : monthSeriesAmount(row.monthValues, priorCompleteMonth);
    const momPercent = latest?.percent ?? growthPercent(latestCompleteAmount, priorCompleteAmount);
    const upMonths = lastSix.filter((item) => item.tone === "up").length;
    const downMonths = lastSix.filter((item) => item.tone === "down").length;
    const improvingStreak = trailingToneStreak(series, "up");
    const decliningStreak = trailingToneStreak(series, "down");
    const trajectory = classifySalesmanMom({
      momPercent,
      improvingStreak,
      decliningStreak,
      upMonths,
      comparedMonths: lastSix.length,
    });

    return {
      ...row,
      latestCompleteMonth,
      priorCompleteMonth,
      priorMonthAmount: priorCompleteAmount,
      momPercent,
      upMonths,
      downMonths,
      comparedMonths: lastSix.length,
      improvingStreak,
      decliningStreak,
      avgMomPercent: averageMomPercent(lastSix),
      hitRate: lastSix.length ? upMonths / lastSix.length : 0,
      trajectory,
      latestCompleteAmount,
      mtdAmount: monthSeriesAmount(row.monthValues, currentMonth),
    };
  });

  rows.sort((left, right) => {
    const rank = statusRank(left.trajectory.status) - statusRank(right.trajectory.status);
    if (rank !== 0) return rank;
    const leftMom = left.momPercent == null ? -Infinity : left.momPercent;
    const rightMom = right.momPercent == null ? -Infinity : right.momPercent;
    if (leftMom !== rightMom) return leftMom - rightMom;
    return (right.lifetime || 0) - (left.lifetime || 0);
  });

  return rows;
}

export function buildSalesmanMomRows(report = {}) {
  const groups = (report.groups || report.categories || []).filter((row) => !isExcludedSalesmanMomRow(row));
  return decorateMomRows(groups, report);
}

export function summarizeSalesmanMom(rows = []) {
  return {
    salesmanCount: rows.length,
    improvingCount: rows.filter((row) => row.trajectory?.status === "green").length,
    slippingCount: rows.filter((row) => row.trajectory?.status === "orange").length,
    notImprovingCount: rows.filter((row) => row.trajectory?.status === "red").length,
    limitedCount: rows.filter((row) => row.trajectory?.status === "neutral").length,
    alerts: rows
      .filter((row) => row.trajectory?.status === "red")
      .map((row) => ({
        code: `salesman-${row.trajectory.code}-${row.label}`,
        severity: "red",
        title: row.label,
        detail: `${row.trajectory.label}. Latest month ${formatGrowthPercent(row.momPercent)} vs prior, ${row.decliningStreak} down month${row.decliningStreak === 1 ? "" : "s"} in a row.`,
      })),
  };
}

export function salesmanMomExportHint(row) {
  return `${row.label}: ${row.trajectory?.label || ""} ${formatGrowthPercent(row.momPercent)} last complete month ${formatMoneyAmount(row.latestCompleteAmount)}`;
}
