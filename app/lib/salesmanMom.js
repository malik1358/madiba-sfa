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

export function buildSalesmanMomRows(report = {}) {
  const months = report.recentMonths || [];
  const currentMonth = report.currentMonth || "";
  const latestCompleteMonth = report.latestCompleteMonth || "";

  const rows = (report.groups || report.categories || []).map((row) => {
    const series = monthOverMonthSeries(row.monthValues, months, currentMonth);
    const lastSix = series.slice(-6);
    const upMonths = lastSix.filter((item) => item.tone === "up").length;
    const downMonths = lastSix.filter((item) => item.tone === "down").length;
    const improvingStreak = trailingToneStreak(series, "up");
    const decliningStreak = trailingToneStreak(series, "down");
    const trajectory = classifySalesmanMom({
      momPercent: row.momPercent,
      improvingStreak,
      decliningStreak,
      upMonths,
      comparedMonths: lastSix.length,
    });

    return {
      ...row,
      upMonths,
      downMonths,
      comparedMonths: lastSix.length,
      improvingStreak,
      decliningStreak,
      avgMomPercent: averageMomPercent(lastSix),
      hitRate: lastSix.length ? upMonths / lastSix.length : 0,
      trajectory,
      latestCompleteAmount: Number(row.monthValues?.[latestCompleteMonth] || row.latestMonthAmount || 0),
      mtdAmount: Number(row.monthValues?.[currentMonth] || 0),
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
