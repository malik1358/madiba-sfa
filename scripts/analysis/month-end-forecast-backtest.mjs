/**
 * Isolated read-only analysis: Methods A/B/C month-end sales forecasts.
 * Does not modify production KPI code or databases.
 *
 * Usage: node scripts/analysis/month-end-forecast-backtest.mjs
 * Input: scripts/analysis/daily-sales.json  [{d, salesman, net_sales}, ...]
 * Output: scripts/analysis/forecast-results.json
 */
import fs from "node:fs";

const INPUT = "scripts/analysis/daily-sales.json";
const OUTPUT = "scripts/analysis/forecast-results.json";
const HISTORY_START = "2025-04-01";
const CURRENT_MONTH = "2026-11";
const AS_OF_NOV = "2026-11-10";

// Exclude non-field / alias / inactive reporting noise from company totals when possible.
const EXCLUDE_CODES = new Set([
  "ADMIN", "NOT IN VOUCHER", "NOT ADDED IN VOUCHER", "NOON", "TRENDYOL",
  "9001", "IV001", "IV002", "IV003", "IV004", "IV005", "PP001", "SM001",
  "", "(BLANK)",
]);

const THAMER_ALIASES = new Set([
  "SM002",
  "THAMER",
  "THAMER SM002",
  "THAMER MOHAMMAD AHMED QASEM",
  "THAMER MOHAMMAD AHMED QASEM SM002",
]);

function normalizeSalesman(value) {
  const code = String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
  if (THAMER_ALIASES.has(code)) return "SM002";
  return code;
}

function parseIso(d) {
  const [y, m, day] = String(d).slice(0, 10).split("-").map(Number);
  return { y, m, day };
}

function isoFromParts(y, m, day) {
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDays(iso, n) {
  const { y, m, day } = parseIso(iso);
  const dt = new Date(Date.UTC(y, m - 1, day + n));
  return dt.toISOString().slice(0, 10);
}

function monthStart(iso) {
  const { y, m } = parseIso(iso);
  return isoFromParts(y, m, 1);
}

function monthEnd(iso) {
  const { y, m } = parseIso(iso);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return isoFromParts(y, m, last);
}

function monthKey(iso) {
  return String(iso).slice(0, 7);
}

/** Friday = 5 in JS getUTCDay when noon UTC is used for KSA calendar dates (date-only). */
function weekdayIndex(iso) {
  const { y, m, day } = parseIso(iso);
  return new Date(Date.UTC(y, m - 1, day, 12)).getUTCDay();
}

function isKsaWorkday(iso) {
  return weekdayIndex(iso) !== 5; // Friday off
}

function workdaysInMonth(ym) {
  const start = `${ym}-01`;
  const end = monthEnd(start);
  const days = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (isKsaWorkday(d)) days.push(d);
  }
  return days;
}

function workdayIndexOnOrBefore(ym, asOf) {
  const days = workdaysInMonth(ym);
  let idx = 0;
  for (const d of days) {
    if (d <= asOf) idx += 1;
    else break;
  }
  return { elapsed: idx, total: days.length, days };
}

function nthWorkday(ym, n) {
  const days = workdaysInMonth(ym);
  if (n <= 0) return days[0];
  if (n >= days.length) return days[days.length - 1];
  return days[n - 1];
}

function workdayFromEnd(ym, nFromEnd) {
  const days = workdaysInMonth(ym);
  return days[Math.max(0, days.length - nFromEnd)];
}

function median(values) {
  const arr = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function mean(values) {
  const arr = values.filter((v) => Number.isFinite(v));
  if (!arr.length) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function loadRows() {
  const rows = JSON.parse(fs.readFileSync(INPUT, "utf8"));
  return rows
    .map((r) => ({
      d: String(r.d).slice(0, 10),
      salesman: normalizeSalesman(r.salesman),
      net: Number(r.net_sales) || 0,
    }))
    .filter((r) => r.d >= HISTORY_START && r.salesman && !EXCLUDE_CODES.has(r.salesman));
}

function buildSeries(rows) {
  /** Map salesman -> Map date -> net */
  const bySalesman = new Map();
  const months = new Set();
  for (const row of rows) {
    months.add(monthKey(row.d));
    if (!bySalesman.has(row.salesman)) bySalesman.set(row.salesman, new Map());
    const m = bySalesman.get(row.salesman);
    m.set(row.d, (m.get(row.d) || 0) + row.net);
  }
  return { bySalesman, months: [...months].sort() };
}

function monthTotal(salesmanDays, ym) {
  const start = `${ym}-01`;
  const end = monthEnd(start);
  let sum = 0;
  for (const [d, v] of salesmanDays.entries()) {
    if (d >= start && d <= end) sum += v;
  }
  return sum;
}

function mtdThrough(salesmanDays, asOf) {
  const start = monthStart(asOf);
  let sum = 0;
  for (const [d, v] of salesmanDays.entries()) {
    if (d >= start && d <= asOf) sum += v;
  }
  return sum;
}

/**
 * Historical completed months for a salesman strictly before `beforeYm`.
 * Optionally require positive month total.
 */
function priorMonths(salesmanDays, beforeYm, { minAbs = 1, lookback = null } = {}) {
  const months = [];
  for (const [d] of salesmanDays.entries()) {
    const ym = monthKey(d);
    if (ym < beforeYm && !months.includes(ym)) months.push(ym);
  }
  months.sort();
  let list = months.filter((ym) => Math.abs(monthTotal(salesmanDays, ym)) >= minAbs);
  if (lookback != null && lookback > 0) list = list.slice(-lookback);
  return list;
}

function cumulativeShareByWorkdayProgress(salesmanDays, ym) {
  const total = monthTotal(salesmanDays, ym);
  if (!(Math.abs(total) > 0)) return null;
  const { days } = workdayIndexOnOrBefore(ym, monthEnd(`${ym}-01`));
  const shares = [];
  let cum = 0;
  const start = `${ym}-01`;
  // Include calendar days but index by workday count elapsed.
  for (let i = 0; i < days.length; i += 1) {
    const asOf = days[i];
    // add sales from previous workday+1 through this workday (and intervening non-workdays)
    const prev = i === 0 ? addDays(start, -1) : days[i - 1];
    for (let d = addDays(prev, 1); d <= asOf; d = addDays(d, 1)) {
      cum += salesmanDays.get(d) || 0;
    }
    shares.push({ workdayN: i + 1, asOf, share: cum / total, cum, total });
  }
  return { total, shares };
}

function averageShareAtWorkdayN(salesmanDays, priorYms, workdayN) {
  const values = [];
  for (const ym of priorYms) {
    const curve = cumulativeShareByWorkdayProgress(salesmanDays, ym);
    if (!curve) continue;
    const point = curve.shares.find((s) => s.workdayN === workdayN)
      || curve.shares[Math.min(workdayN - 1, curve.shares.length - 1)];
    if (point && Number.isFinite(point.share)) values.push(point.share);
  }
  return {
    mean: mean(values),
    median: median(values),
    n: values.length,
    values,
  };
}

function averageMonthBaseline(salesmanDays, priorYms) {
  const totals = priorYms.map((ym) => monthTotal(salesmanDays, ym)).filter((v) => Number.isFinite(v));
  return {
    mean: mean(totals),
    median: median(totals),
    n: totals.length,
    totals,
  };
}

/** Safeguard options for Method A denominator. */
const SAFEGUARDS = {
  none: (share) => share,
  floor_1pct: (share) => Math.max(share, 0.01),
  floor_5pct: (share) => Math.max(share, 0.05),
  floor_half_workday: (share, workdayFrac) => Math.max(share, workdayFrac * 0.5),
  floor_workday: (share, workdayFrac) => Math.max(share, workdayFrac),
  floor_max_5_or_25pct_wd: (share, workdayFrac) => {
    const pathology = Math.max(0.05, workdayFrac * 0.25);
    if (share >= pathology) return share;
    return Math.max(share, workdayFrac * 0.5);
  },
};

function methodA({ actualMtd, histShare, workdayFrac, safeguard = "floor_max_5_or_25pct_wd" }) {
  if (!(actualMtd > 0)) return actualMtd; // cannot scale zero
  let share = histShare;
  if (!(share > 0) || !Number.isFinite(share)) share = workdayFrac; // fallback
  const guarded = SAFEGUARDS[safeguard](share, workdayFrac);
  if (!(guarded > 0)) return actualMtd;
  return actualMtd / guarded;
}

function methodB({ actualMtd, baseline, histShare }) {
  const share = Number.isFinite(histShare) && histShare > 0 ? Math.min(1, Math.max(0, histShare)) : null;
  if (!(baseline > 0) || share == null) {
    // Fallback: if no history, return actual only
    return actualMtd > 0 ? actualMtd : 0;
  }
  const remainingShare = Math.max(0, 1 - share);
  return actualMtd + baseline * remainingShare;
}

/**
 * Method C adaptive hybrid.
 * expected_to_date = baseline * histShare
 * performance_ratio = actual / expected_to_date (capped)
 * remaining = baseline * (1 - histShare) * blend(1, performance_ratio, confidence)
 * confidence grows with workdayFrac
 */
function methodC({
  actualMtd,
  baseline,
  histShare,
  workdayFrac,
  confPower = 1.2,
  ratioCap = [0.35, 2.5],
}) {
  if (!(baseline > 0) || !(histShare > 0)) {
    return methodB({ actualMtd, baseline: baseline || 0, histShare: histShare || workdayFrac });
  }
  const share = Math.min(0.999, Math.max(0.001, histShare));
  const expectedToDate = baseline * share;
  let ratio = expectedToDate > 0 ? actualMtd / expectedToDate : 1;
  if (!Number.isFinite(ratio)) ratio = 1;
  ratio = Math.min(ratioCap[1], Math.max(ratioCap[0], ratio));
  const confidence = Math.min(1, Math.max(0, workdayFrac)) ** confPower;
  const adjust = (1 - confidence) * 1 + confidence * ratio;
  const remaining = baseline * (1 - share) * adjust;
  return actualMtd + Math.max(0, remaining);
}

function companySum(map) {
  let s = 0;
  for (const v of Object.values(map)) s += v;
  return s;
}

function errorMetrics(pairs) {
  // pairs: [{actual, forecast}]
  const usable = pairs.filter((p) => Number.isFinite(p.actual) && Number.isFinite(p.forecast) && Math.abs(p.actual) > 1);
  if (!usable.length) {
    return { n: 0, wape: null, bias: null, mae: null };
  }
  let absErr = 0;
  let absAct = 0;
  let signed = 0;
  let mae = 0;
  for (const p of usable) {
    const e = p.forecast - p.actual;
    absErr += Math.abs(e);
    absAct += Math.abs(p.actual);
    signed += e;
    mae += Math.abs(e);
  }
  return {
    n: usable.length,
    wape: absAct > 0 ? absErr / absAct : null,
    bias: signed / usable.length, // mean error (positive = over-forecast)
    biasPct: absAct > 0 ? signed / absAct : null,
    mae: mae / usable.length,
  };
}

function forecastOne({
  salesmanDays,
  ym,
  asOf,
  lookback,
  safeguard,
  confPower,
  teamDays = null,
}) {
  const { elapsed, total } = workdayIndexOnOrBefore(ym, asOf);
  const workdayFrac = total > 0 ? elapsed / total : 0;
  const workdayN = Math.max(1, elapsed);
  const prior = priorMonths(salesmanDays, ym, { lookback });
  const shareStats = averageShareAtWorkdayN(salesmanDays, prior, workdayN);
  const baseStats = averageMonthBaseline(salesmanDays, prior);
  let histShare = shareStats.median ?? shareStats.mean;
  let baseline = baseStats.median ?? baseStats.mean;
  const actualMtd = mtdThrough(salesmanDays, asOf);
  let usedFallback = false;

  // Team / company fallback when personal history is thin.
  if ((prior.length < 2 || histShare == null || baseline == null) && teamDays) {
    const teamPrior = priorMonths(teamDays, ym, { lookback });
    if (histShare == null) {
      const teamShare = averageShareAtWorkdayN(teamDays, teamPrior, workdayN);
      histShare = teamShare.median ?? teamShare.mean;
      usedFallback = true;
    }
    if (baseline == null) {
      const teamBase = averageMonthBaseline(teamDays, teamPrior);
      // Scale team median month by salesman's share of recent team sales if available.
      const teamMed = teamBase.median ?? teamBase.mean;
      if (teamMed != null && prior.length >= 1) {
        const personalAvg = mean(prior.map((m) => monthTotal(salesmanDays, m)));
        const teamAvg = mean(prior.map((m) => monthTotal(teamDays, m)));
        baseline = teamAvg > 0 ? personalAvg : teamMed * 0.05;
      } else if (teamMed != null) {
        baseline = teamMed * 0.05; // conservative new-hire share
      }
      usedFallback = true;
    }
  }

  const fallbackShare = histShare == null ? workdayFrac : histShare;
  const fallbackBase = baseline == null
    ? (prior.length ? mean(prior.map((m) => monthTotal(salesmanDays, m))) : 0)
    : baseline;

  const insufficient = prior.length < 2 || usedFallback;

  const a = methodA({
    actualMtd,
    histShare: fallbackShare,
    workdayFrac,
    safeguard,
  });
  const b = methodB({
    actualMtd,
    baseline: fallbackBase || 0,
    histShare: fallbackShare,
  });
  const c = methodC({
    actualMtd,
    baseline: fallbackBase || 0,
    histShare: fallbackShare,
    workdayFrac,
    confPower,
  });

  return {
    actualMtd,
    histShare: fallbackShare,
    baseline: fallbackBase,
    workdayFrac,
    workdayN,
    priorMonths: prior.length,
    insufficient,
    usedFallback,
    methodA: a,
    methodB: b,
    methodC: c,
    remainingA: a - actualMtd,
    remainingB: b - actualMtd,
    remainingC: c - actualMtd,
  };
}

function buildTeamDays(bySalesman) {
  const companyDays = new Map();
  for (const days of bySalesman.values()) {
    for (const [d, v] of days.entries()) {
      companyDays.set(d, (companyDays.get(d) || 0) + v);
    }
  }
  return companyDays;
}

function runBacktest({ bySalesman, completedMonths, lookback, safeguard, confPower }) {
  const checkpoints = [
    { key: "wd5", pick: (ym) => nthWorkday(ym, 5) },
    { key: "wd10", pick: (ym) => nthWorkday(ym, 10) },
    { key: "wd15", pick: (ym) => nthWorkday(ym, 15) },
    { key: "wd20", pick: (ym) => nthWorkday(ym, 20) },
    { key: "wd_m5", pick: (ym) => workdayFromEnd(ym, 5) },
  ];
  const teamDays = buildTeamDays(bySalesman);

  const byMethod = {
    A: { all: [], byCheckpoint: {}, bySalesman: {} },
    B: { all: [], byCheckpoint: {}, bySalesman: {} },
    C: { all: [], byCheckpoint: {}, bySalesman: {} },
  };
  for (const m of ["A", "B", "C"]) {
    for (const cp of checkpoints) byMethod[m].byCheckpoint[cp.key] = [];
  }

  const companyByCheckpoint = {
    A: {}, B: {}, C: {},
  };
  for (const cp of checkpoints) {
    companyByCheckpoint.A[cp.key] = [];
    companyByCheckpoint.B[cp.key] = [];
    companyByCheckpoint.C[cp.key] = [];
  }

  for (const ym of completedMonths) {
    // Need enough prior history globally
    for (const cp of checkpoints) {
      const asOf = cp.pick(ym);
      if (!asOf || monthKey(asOf) !== ym) continue;

      let companyActual = 0;
      let companyA = 0;
      let companyB = 0;
      let companyC = 0;

      for (const [salesman, days] of bySalesman.entries()) {
        const finalActual = monthTotal(days, ym);
        // Skip salesman-months with no activity all month and no prior (noise)
        const prior = priorMonths(days, ym, { lookback });
        if (prior.length < 1 && Math.abs(finalActual) < 1) continue;

        const f = forecastOne({
          salesmanDays: days,
          ym,
          asOf,
          lookback,
          safeguard,
          confPower,
          teamDays,
        });
        companyActual += finalActual;
        companyA += f.methodA;
        companyB += f.methodB;
        companyC += f.methodC;

        const push = (method, forecast) => {
          const pair = { actual: finalActual, forecast, ym, salesman, asOf, checkpoint: cp.key };
          byMethod[method].all.push(pair);
          byMethod[method].byCheckpoint[cp.key].push(pair);
          if (!byMethod[method].bySalesman[salesman]) byMethod[method].bySalesman[salesman] = [];
          byMethod[method].bySalesman[salesman].push(pair);
        };
        push("A", f.methodA);
        push("B", f.methodB);
        push("C", f.methodC);
      }

      companyByCheckpoint.A[cp.key].push({ actual: companyActual, forecast: companyA, ym, asOf });
      companyByCheckpoint.B[cp.key].push({ actual: companyActual, forecast: companyB, ym, asOf });
      companyByCheckpoint.C[cp.key].push({ actual: companyActual, forecast: companyC, ym, asOf });
    }
  }

  const summarize = (bucket) => ({
    salesmanLevel: {
      overall: errorMetrics(bucket.all),
      byCheckpoint: Object.fromEntries(
        Object.entries(bucket.byCheckpoint).map(([k, v]) => [k, errorMetrics(v)]),
      ),
    },
  });

  return {
    salesmanLevel: {
      A: summarize(byMethod.A).salesmanLevel,
      B: summarize(byMethod.B).salesmanLevel,
      C: summarize(byMethod.C).salesmanLevel,
    },
    companyLevel: {
      A: {
        byCheckpoint: Object.fromEntries(
          Object.entries(companyByCheckpoint.A).map(([k, v]) => [k, errorMetrics(v)]),
        ),
        overall: errorMetrics(Object.values(companyByCheckpoint.A).flat()),
      },
      B: {
        byCheckpoint: Object.fromEntries(
          Object.entries(companyByCheckpoint.B).map(([k, v]) => [k, errorMetrics(v)]),
        ),
        overall: errorMetrics(Object.values(companyByCheckpoint.B).flat()),
      },
      C: {
        byCheckpoint: Object.fromEntries(
          Object.entries(companyByCheckpoint.C).map(([k, v]) => [k, errorMetrics(v)]),
        ),
        overall: errorMetrics(Object.values(companyByCheckpoint.C).flat()),
      },
    },
    companyPairsByCheckpoint: companyByCheckpoint,
  };
}

function novemberForecast({ bySalesman, lookback, safeguard, confPower }) {
  const ym = CURRENT_MONTH;
  const asOf = AS_OF_NOV;
  const teamDays = buildTeamDays(bySalesman);
  const perSalesman = [];
  for (const [salesman, days] of [...bySalesman.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const prior = priorMonths(days, ym, { lookback });
    const mtd = mtdThrough(days, asOf);
    if (prior.length < 1 && Math.abs(mtd) < 1) continue;
    const f = forecastOne({
      salesmanDays: days,
      ym,
      asOf,
      lookback,
      safeguard,
      confPower,
      teamDays,
    });
    perSalesman.push({ salesman, ...f });
  }
  const sum = (key) => perSalesman.reduce((s, r) => s + (Number(r[key]) || 0), 0);
  return {
    asOf,
    workday: workdayIndexOnOrBefore(ym, asOf),
    perSalesman,
    company: {
      actualMtd: sum("actualMtd"),
      methodA: sum("methodA"),
      methodB: sum("methodB"),
      methodC: sum("methodC"),
      remainingA: sum("remainingA"),
      remainingB: sum("remainingB"),
      remainingC: sum("remainingC"),
    },
  };
}

function historicalExamples({ bySalesman, lookback, safeguard, confPower, months }) {
  const out = [];
  const teamDays = buildTeamDays(bySalesman);
  for (const ym of months) {
    for (const wd of [10, 20]) {
      const asOf = nthWorkday(ym, wd);
      let actual = 0;
      let a = 0;
      let b = 0;
      let c = 0;
      for (const [, days] of bySalesman.entries()) {
        const prior = priorMonths(days, ym, { lookback });
        const finalActual = monthTotal(days, ym);
        if (prior.length < 1 && Math.abs(finalActual) < 1) continue;
        actual += finalActual;
        const f = forecastOne({
          salesmanDays: days,
          ym,
          asOf,
          lookback,
          safeguard,
          confPower,
          teamDays,
        });
        a += f.methodA;
        b += f.methodB;
        c += f.methodC;
      }
      out.push({
        ym,
        forecastDate: asOf,
        workdayN: wd,
        actualFinal: actual,
        methodA: a,
        methodB: b,
        methodC: c,
        errA: a - actual,
        errB: b - actual,
        errC: c - actual,
      });
    }
  }
  return out;
}

function pickExampleMonths(bySalesman, completedMonths) {
  // Prefer denser 2026 roster months with clear weak / mid / strong contrast.
  const preferred = {
    weak: "2026-02",
    normal: "2026-05",
    strong: "2026-09",
  };
  const available = new Set(completedMonths);
  const picked = [];
  for (const ym of Object.values(preferred)) {
    if (available.has(ym)) picked.push(ym);
  }
  if (picked.length === 3) return picked;
  const totals = completedMonths.map((ym) => {
    let t = 0;
    for (const days of bySalesman.values()) t += monthTotal(days, ym);
    return { ym, total: t };
  }).filter((r) => r.ym >= "2025-11" && r.ym <= "2026-10");
  const sorted = [...totals].sort((a, b) => a.total - b.total);
  return [
    sorted[0]?.ym,
    sorted[Math.floor(sorted.length / 2)]?.ym,
    sorted[sorted.length - 1]?.ym,
  ].filter(Boolean);
}

function coverageReport(bySalesman, completedMonths) {
  const rows = [];
  for (const [salesman, days] of [...bySalesman.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const months = priorMonths(days, "2099-01", { lookback: null });
    const completed = months.filter((m) => completedMonths.includes(m));
    rows.push({
      salesman,
      completedMonths: completed.length,
      firstMonth: completed[0] || null,
      lastMonth: completed[completed.length - 1] || null,
      months: completed,
    });
  }
  return rows;
}

function main() {
  const rows = loadRows();
  const { bySalesman, months } = buildSeries(rows);
  const completedMonths = months.filter((ym) => ym < CURRENT_MONTH && ym >= "2025-05");
  // Apr 2025 is partial (starts 20th) — exclude from completed baseline months for fairness
  const completedFull = completedMonths.filter((ym) => ym !== "2025-04");

  const lookbacks = [3, 6, 12, null];
  const safeguards = [
    "none",
    "floor_1pct",
    "floor_5pct",
    "floor_half_workday",
    "floor_workday",
    "floor_max_5_or_25pct_wd",
  ];

  const tuning = [];
  for (const lookback of lookbacks) {
    for (const safeguard of safeguards) {
      const bt = runBacktest({
        bySalesman,
        completedMonths: completedFull.filter((ym) => ym >= "2025-11"), // need prior history
        lookback,
        safeguard,
        confPower: 1.2,
      });
      tuning.push({
        lookback: lookback == null ? "all" : lookback,
        safeguard,
        companyWapeA: bt.companyLevel.A.overall.wape,
        companyWapeB: bt.companyLevel.B.overall.wape,
        companyWapeC: bt.companyLevel.C.overall.wape,
        companyBiasA: bt.companyLevel.A.overall.biasPct,
        companyBiasB: bt.companyLevel.B.overall.biasPct,
        companyBiasC: bt.companyLevel.C.overall.biasPct,
        salesmanWapeA: bt.salesmanLevel.A.overall.wape,
        salesmanWapeB: bt.salesmanLevel.B.overall.wape,
        salesmanWapeC: bt.salesmanLevel.C.overall.wape,
      });
    }
  }

  // Choose best by company WAPE across methods (lower better), prefer Method with lowest
  const scored = [];
  for (const t of tuning) {
    for (const method of ["A", "B", "C"]) {
      const wape = t[`companyWape${method}`];
      if (wape == null) continue;
      scored.push({ ...t, method, wape });
    }
  }
  scored.sort((a, b) => a.wape - b.wape);
  const best = scored[0];

  const chosenLookback = best.lookback === "all" ? null : best.lookback;
  const chosenSafeguard = best.safeguard;
  const primary = runBacktest({
    bySalesman,
    completedMonths: completedFull.filter((ym) => ym >= "2025-11"),
    lookback: chosenLookback,
    safeguard: chosenSafeguard,
    confPower: 1.2,
  });

  // Also evaluate early vs late using chosen config
  const earlyLate = {
    early: {
      A: errorMetrics([
        ...primary.companyPairsByCheckpoint.A.wd5,
        ...primary.companyPairsByCheckpoint.A.wd10,
      ]),
      B: errorMetrics([
        ...primary.companyPairsByCheckpoint.B.wd5,
        ...primary.companyPairsByCheckpoint.B.wd10,
      ]),
      C: errorMetrics([
        ...primary.companyPairsByCheckpoint.C.wd5,
        ...primary.companyPairsByCheckpoint.C.wd10,
      ]),
    },
    late: {
      A: errorMetrics([
        ...primary.companyPairsByCheckpoint.A.wd20,
        ...primary.companyPairsByCheckpoint.A.wd_m5,
      ]),
      B: errorMetrics([
        ...primary.companyPairsByCheckpoint.B.wd20,
        ...primary.companyPairsByCheckpoint.B.wd_m5,
      ]),
      C: errorMetrics([
        ...primary.companyPairsByCheckpoint.C.wd20,
        ...primary.companyPairsByCheckpoint.C.wd_m5,
      ]),
    },
  };

  const nov = novemberForecast({
    bySalesman,
    lookback: chosenLookback,
    safeguard: chosenSafeguard,
    confPower: 1.2,
  });

  const octoberActual = [...bySalesman.values()]
    .reduce((s, days) => s + monthTotal(days, "2026-10"), 0);

  const exampleMonths = pickExampleMonths(bySalesman, completedFull);
  const examples = historicalExamples({
    bySalesman,
    lookback: chosenLookback,
    safeguard: chosenSafeguard,
    confPower: 1.2,
    months: exampleMonths,
  });

  // Production-like Method A with full workday floor (current prod) for comparison on Nov
  const novProdFloor = novemberForecast({
    bySalesman,
    lookback: 3,
    safeguard: "floor_workday",
    confPower: 1.2,
  });

  // Hybrid: average of A+C and B+C at company checkpoint pairs
  const hybridPairs = {
    AC: Object.fromEntries(
      ["wd5", "wd10", "wd15", "wd20", "wd_m5"].map((cp) => [
        cp,
        primary.companyPairsByCheckpoint.A[cp].map((p, i) => {
          const b = primary.companyPairsByCheckpoint.C[cp][i];
          return { actual: p.actual, forecast: (p.forecast + b.forecast) / 2, ym: p.ym };
        }),
      ]),
    ),
    BC: Object.fromEntries(
      ["wd5", "wd10", "wd15", "wd20", "wd_m5"].map((cp) => [
        cp,
        primary.companyPairsByCheckpoint.B[cp].map((p, i) => {
          const b = primary.companyPairsByCheckpoint.C[cp][i];
          return { actual: p.actual, forecast: (p.forecast + b.forecast) / 2, ym: p.ym };
        }),
      ]),
    ),
    ABC: Object.fromEntries(
      ["wd5", "wd10", "wd15", "wd20", "wd_m5"].map((cp) => [
        cp,
        primary.companyPairsByCheckpoint.A[cp].map((p, i) => {
          const b = primary.companyPairsByCheckpoint.B[cp][i];
          const c = primary.companyPairsByCheckpoint.C[cp][i];
          return { actual: p.actual, forecast: (p.forecast + b.forecast + c.forecast) / 3, ym: p.ym };
        }),
      ]),
    ),
  };
  const hybridMetrics = Object.fromEntries(
    Object.entries(hybridPairs).map(([name, byCp]) => [
      name,
      {
        overall: errorMetrics(Object.values(byCp).flat()),
        byCheckpoint: Object.fromEntries(
          Object.entries(byCp).map(([k, v]) => [k, errorMetrics(v)]),
        ),
      },
    ]),
  );

  // Direct company-level Method A/B/C (pool all sales into one curve) vs sum-of-salesmen
  const companyDays = new Map();
  for (const days of bySalesman.values()) {
    for (const [d, v] of days.entries()) {
      companyDays.set(d, (companyDays.get(d) || 0) + v);
    }
  }
  const companyDirectPairs = { A: [], B: [], C: [] };
  for (const ym of completedFull.filter((m) => m >= "2025-11")) {
    for (const [key, pick] of [
      ["wd5", (m) => nthWorkday(m, 5)],
      ["wd10", (m) => nthWorkday(m, 10)],
      ["wd15", (m) => nthWorkday(m, 15)],
      ["wd20", (m) => nthWorkday(m, 20)],
      ["wd_m5", (m) => workdayFromEnd(m, 5)],
    ]) {
      const asOf = pick(ym);
      const finalActual = monthTotal(companyDays, ym);
      const f = forecastOne({
        salesmanDays: companyDays,
        ym,
        asOf,
        lookback: chosenLookback,
        safeguard: chosenSafeguard,
        confPower: 1.2,
      });
      companyDirectPairs.A.push({ actual: finalActual, forecast: f.methodA, ym, checkpoint: key });
      companyDirectPairs.B.push({ actual: finalActual, forecast: f.methodB, ym, checkpoint: key });
      companyDirectPairs.C.push({ actual: finalActual, forecast: f.methodC, ym, checkpoint: key });
    }
  }

  const result = {
    meta: {
      generatedAt: new Date().toISOString(),
      historyStart: HISTORY_START,
      dataMin: rows[0]?.d,
      dataMax: rows[rows.length - 1]?.d,
      currentMonth: CURRENT_MONTH,
      asOfNov: AS_OF_NOV,
      note: "Backtests use transaction_date as-of (not upload timestamps). created_at exists but is insert time into current DB, not reliable historical as-of.",
      excludedCodes: [...EXCLUDE_CODES],
      chosen: {
        lookback: best.lookback,
        safeguard: chosenSafeguard,
        bestMethodByCompanyWape: best.method,
        bestWape: best.wape,
      },
      monthlyNetRecent: {
        "2026-08": [...bySalesman.values()].reduce((s, d) => s + monthTotal(d, "2026-08"), 0),
        "2026-09": [...bySalesman.values()].reduce((s, d) => s + monthTotal(d, "2026-09"), 0),
        "2026-10": octoberActual,
      },
    },
    coverage: coverageReport(bySalesman, completedFull),
    monthlyCompanyNet: completedFull.map((ym) => ({
      ym,
      net: [...bySalesman.values()].reduce((s, d) => s + monthTotal(d, ym), 0),
    })),
    tuningTop10: scored.slice(0, 10),
    tuningAll: tuning,
    backtest: {
      salesmanLevel: primary.salesmanLevel,
      companyLevel: primary.companyLevel,
      earlyLate,
      hybrid: hybridMetrics,
      companyDirect: {
        A: errorMetrics(companyDirectPairs.A),
        B: errorMetrics(companyDirectPairs.B),
        C: errorMetrics(companyDirectPairs.C),
      },
      companySumOfSalesmen: {
        A: primary.companyLevel.A.overall,
        B: primary.companyLevel.B.overall,
        C: primary.companyLevel.C.overall,
      },
    },
    november: {
      recommendedConfig: nov,
      productionLikeWorkdayFloor: {
        company: novProdFloor.company,
      },
      octoberActual,
    },
    examples,
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({
    wrote: OUTPUT,
    chosen: result.meta.chosen,
    novCompany: nov.company,
    novProdFloor: novProdFloor.company,
    octoberActual,
    exampleMonths,
    companyWape: {
      A: primary.companyLevel.A.overall,
      B: primary.companyLevel.B.overall,
      C: primary.companyLevel.C.overall,
    },
  }, null, 2));
}

main();
