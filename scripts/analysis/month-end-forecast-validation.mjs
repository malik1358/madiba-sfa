/**
 * Final pre-implementation validation (read-only).
 * Adds Method D, floor diagnostics, A+zero-MTD fallback, prediction intervals.
 *
 * Usage: node scripts/analysis/month-end-forecast-validation.mjs
 */
import fs from "node:fs";

const INPUT = "scripts/analysis/daily-sales.json";
const OUTPUT = "scripts/analysis/forecast-validation.json";
const HISTORY_START = "2025-04-01";
const CURRENT_MONTH = "2026-11";
const AS_OF_NOV = "2026-11-10";
const LOOKBACK = 6;
const CONF_POWER = 1.2;

const EXCLUDE_CODES = new Set([
  "ADMIN", "NOT IN VOUCHER", "NOT ADDED IN VOUCHER", "NOON", "TRENDYOL",
  "9001", "IV001", "IV002", "IV003", "IV004", "IV005", "PP001", "SM001",
  "", "(BLANK)",
]);

const THAMER_ALIASES = new Set([
  "SM002", "THAMER", "THAMER SM002",
  "THAMER MOHAMMAD AHMED QASEM", "THAMER MOHAMMAD AHMED QASEM SM002",
]);

function normalizeSalesman(value) {
  const code = String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
  return THAMER_ALIASES.has(code) ? "SM002" : code;
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
  return new Date(Date.UTC(y, m - 1, day + n)).toISOString().slice(0, 10);
}
function monthStart(iso) {
  const { y, m } = parseIso(iso);
  return isoFromParts(y, m, 1);
}
function monthEnd(iso) {
  const { y, m } = parseIso(iso);
  return isoFromParts(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate());
}
function monthKey(iso) {
  return String(iso).slice(0, 7);
}
function weekdayIndex(iso) {
  const { y, m, day } = parseIso(iso);
  return new Date(Date.UTC(y, m - 1, day, 12)).getUTCDay();
}
function isKsaWorkday(iso) {
  return weekdayIndex(iso) !== 5;
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
function quantile(values, q) {
  const arr = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!arr.length) return null;
  if (arr.length === 1) return arr[0];
  const pos = (arr.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return arr[lo];
  return arr[lo] * (hi - pos) + arr[hi] * (pos - lo);
}

function loadRows() {
  return JSON.parse(fs.readFileSync(INPUT, "utf8"))
    .map((r) => ({
      d: String(r.d).slice(0, 10),
      salesman: normalizeSalesman(r.salesman),
      net: Number(r.net_sales) || 0,
    }))
    .filter((r) => r.d >= HISTORY_START && r.salesman && !EXCLUDE_CODES.has(r.salesman));
}

function buildSeries(rows) {
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
  for (let i = 0; i < days.length; i += 1) {
    const asOf = days[i];
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
  return { mean: mean(values), median: median(values), n: values.length, values };
}

function averageMonthBaseline(salesmanDays, priorYms) {
  const totals = priorYms.map((ym) => monthTotal(salesmanDays, ym)).filter((v) => Number.isFinite(v));
  return { mean: mean(totals), median: median(totals), n: totals.length, totals };
}

function methodARaw({ actualMtd, histShare, workdayFrac, useFloor }) {
  if (!(actualMtd > 0)) return { forecast: actualMtd, rawShare: histShare, usedFloor: false, guardedShare: histShare };
  let share = histShare;
  if (!(share > 0) || !Number.isFinite(share)) share = workdayFrac;
  const rawShare = share;
  let guarded = share;
  let usedFloor = false;
  if (useFloor && workdayFrac > 0 && share < workdayFrac) {
    guarded = workdayFrac;
    usedFloor = true;
  }
  if (!(guarded > 0)) return { forecast: actualMtd, rawShare, usedFloor: false, guardedShare: guarded };
  return { forecast: actualMtd / guarded, rawShare, usedFloor, guardedShare: guarded };
}

function methodB({ actualMtd, baseline, histShare }) {
  const share = Number.isFinite(histShare) && histShare > 0 ? Math.min(1, Math.max(0, histShare)) : null;
  if (!(baseline > 0) || share == null) return actualMtd > 0 ? actualMtd : 0;
  return actualMtd + baseline * Math.max(0, 1 - share);
}

function methodC({ actualMtd, baseline, histShare, workdayFrac }) {
  if (!(baseline > 0) || !(histShare > 0)) {
    return methodB({ actualMtd, baseline: baseline || 0, histShare: histShare || workdayFrac });
  }
  const share = Math.min(0.999, Math.max(0.001, histShare));
  const expectedToDate = baseline * share;
  let ratio = expectedToDate > 0 ? actualMtd / expectedToDate : 1;
  if (!Number.isFinite(ratio)) ratio = 1;
  ratio = Math.min(2.5, Math.max(0.35, ratio));
  const confidence = Math.min(1, Math.max(0, workdayFrac)) ** CONF_POWER;
  const adjust = (1 - confidence) * 1 + confidence * ratio;
  return actualMtd + Math.max(0, baseline * (1 - share) * adjust);
}

function methodD({ actualMtd, elapsed, total }) {
  if (!(actualMtd > 0) || !(elapsed > 0) || !(total > 0)) return actualMtd > 0 ? actualMtd : 0;
  return actualMtd / elapsed * total;
}

function methodAPlusZeroFallback({ actualMtd, histShare, workdayFrac, baseline, useFloor }) {
  if (actualMtd > 0) {
    return methodARaw({ actualMtd, histShare, workdayFrac, useFloor }).forecast;
  }
  // Zero / negative MTD: Method B remaining (cannot divide)
  return methodB({ actualMtd: Math.max(0, actualMtd), baseline, histShare });
}

function errorMetrics(pairs) {
  const usable = pairs.filter((p) => Number.isFinite(p.actual) && Number.isFinite(p.forecast) && Math.abs(p.actual) > 1);
  if (!usable.length) return { n: 0, wape: null, bias: null, biasPct: null, mae: null };
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
    bias: signed / usable.length,
    biasPct: absAct > 0 ? signed / absAct : null,
    mae: mae / usable.length,
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

function resolveInputs(salesmanDays, teamDays, ym, asOf, lookback) {
  const { elapsed, total } = workdayIndexOnOrBefore(ym, asOf);
  const workdayFrac = total > 0 ? elapsed / total : 0;
  const workdayN = Math.max(1, elapsed);
  const prior = priorMonths(salesmanDays, ym, { lookback });
  let shareStats = averageShareAtWorkdayN(salesmanDays, prior, workdayN);
  let baseStats = averageMonthBaseline(salesmanDays, prior);
  let histShare = shareStats.median ?? shareStats.mean;
  let baseline = baseStats.median ?? baseStats.mean;
  let usedTeam = false;

  if ((prior.length < 2 || histShare == null || baseline == null) && teamDays) {
    const teamPrior = priorMonths(teamDays, ym, { lookback });
    if (histShare == null) {
      const teamShare = averageShareAtWorkdayN(teamDays, teamPrior, workdayN);
      histShare = teamShare.median ?? teamShare.mean;
      usedTeam = true;
    }
    if (baseline == null) {
      const teamBase = averageMonthBaseline(teamDays, teamPrior);
      const teamMed = teamBase.median ?? teamBase.mean;
      if (teamMed != null && prior.length >= 1) {
        baseline = mean(prior.map((m) => monthTotal(salesmanDays, m)));
      } else if (teamMed != null) {
        baseline = teamMed * 0.05;
      }
      usedTeam = true;
    }
  }

  const fallbackShare = histShare == null ? workdayFrac : histShare;
  const fallbackBase = baseline == null
    ? (prior.length ? mean(prior.map((m) => monthTotal(salesmanDays, m))) : 0)
    : baseline;

  return {
    elapsed,
    total,
    workdayFrac,
    workdayN,
    priorMonths: prior.length,
    histShare: fallbackShare,
    baseline: fallbackBase || 0,
    actualMtd: mtdThrough(salesmanDays, asOf),
    usedTeam,
  };
}

function emptyMethodBucket(checkpoints) {
  const byCheckpoint = {};
  for (const cp of checkpoints) byCheckpoint[cp.key] = [];
  return { all: [], byCheckpoint, salesmanAll: [] };
}

function runValidation(bySalesman, completedMonths) {
  const checkpoints = [
    { key: "wd5", pick: (ym) => nthWorkday(ym, 5) },
    { key: "wd10", pick: (ym) => nthWorkday(ym, 10) },
    { key: "wd15", pick: (ym) => nthWorkday(ym, 15) },
    { key: "wd20", pick: (ym) => nthWorkday(ym, 20) },
    { key: "wd_m5", pick: (ym) => workdayFromEnd(ym, 5) },
  ];
  const teamDays = buildTeamDays(bySalesman);
  const methods = ["A", "A_nofloor", "B", "C", "D", "A_zero"];
  const salesmanBuckets = Object.fromEntries(methods.map((m) => [m, emptyMethodBucket(checkpoints)]));
  const companyBuckets = Object.fromEntries(methods.map((m) => [m, emptyMethodBucket(checkpoints)]));

  // Floor diagnostics
  let floorObs = 0;
  let floorActive = 0;
  let forecastSalesTotal = 0;
  let forecastSalesFloorAffected = 0;
  const floorByCheckpoint = Object.fromEntries(checkpoints.map((c) => [c.key, { obs: 0, active: 0 }]));

  // Relative errors for prediction intervals (company-level, Method A_zero preferred)
  const companyRelErrors = Object.fromEntries(checkpoints.map((c) => [c.key, []]));
  const companyAbsPctErrors = Object.fromEntries(checkpoints.map((c) => [c.key, []]));

  for (const ym of completedMonths) {
    for (const cp of checkpoints) {
      const asOf = cp.pick(ym);
      if (!asOf || monthKey(asOf) !== ym) continue;

      const company = {
        actual: 0,
        A: 0, A_nofloor: 0, B: 0, C: 0, D: 0, A_zero: 0,
      };

      for (const [salesman, days] of bySalesman.entries()) {
        const finalActual = monthTotal(days, ym);
        const prior = priorMonths(days, ym, { lookback: LOOKBACK });
        if (prior.length < 1 && Math.abs(finalActual) < 1) continue;

        const inp = resolveInputs(days, teamDays, ym, asOf, LOOKBACK);
        const aFloor = methodARaw({
          actualMtd: inp.actualMtd,
          histShare: inp.histShare,
          workdayFrac: inp.workdayFrac,
          useFloor: true,
        });
        const aNo = methodARaw({
          actualMtd: inp.actualMtd,
          histShare: inp.histShare,
          workdayFrac: inp.workdayFrac,
          useFloor: false,
        });
        const b = methodB({
          actualMtd: inp.actualMtd,
          baseline: inp.baseline,
          histShare: inp.histShare,
        });
        const c = methodC({
          actualMtd: inp.actualMtd,
          baseline: inp.baseline,
          histShare: inp.histShare,
          workdayFrac: inp.workdayFrac,
        });
        const d = methodD({
          actualMtd: inp.actualMtd,
          elapsed: inp.elapsed,
          total: inp.total,
        });
        const aZero = methodAPlusZeroFallback({
          actualMtd: inp.actualMtd,
          histShare: inp.histShare,
          workdayFrac: inp.workdayFrac,
          baseline: inp.baseline,
          useFloor: true,
        });

        // Floor stats: only when Method A can scale (positive MTD)
        if (inp.actualMtd > 0 && Number.isFinite(aFloor.rawShare)) {
          floorObs += 1;
          floorByCheckpoint[cp.key].obs += 1;
          forecastSalesTotal += Math.abs(aFloor.forecast);
          if (aFloor.usedFloor) {
            floorActive += 1;
            floorByCheckpoint[cp.key].active += 1;
            forecastSalesFloorAffected += Math.abs(aFloor.forecast);
          }
        }

        const forecasts = {
          A: aFloor.forecast,
          A_nofloor: aNo.forecast,
          B: b,
          C: c,
          D: d,
          A_zero: aZero,
        };

        for (const m of methods) {
          const pair = {
            actual: finalActual,
            forecast: forecasts[m],
            ym,
            salesman,
            asOf,
            checkpoint: cp.key,
            zeroMtd: !(inp.actualMtd > 0),
          };
          salesmanBuckets[m].all.push(pair);
          salesmanBuckets[m].byCheckpoint[cp.key].push(pair);
          salesmanBuckets[m].salesmanAll.push(pair);
        }

        company.actual += finalActual;
        company.A += aFloor.forecast;
        company.A_nofloor += aNo.forecast;
        company.B += b;
        company.C += c;
        company.D += d;
        company.A_zero += aZero;
      }

      for (const m of methods) {
        const pair = {
          actual: company.actual,
          forecast: company[m],
          ym,
          asOf,
          checkpoint: cp.key,
        };
        companyBuckets[m].all.push(pair);
        companyBuckets[m].byCheckpoint[cp.key].push(pair);
      }

      // Relative error for recommended model at this checkpoint
      if (Math.abs(company.actual) > 1) {
        const rel = (company.A_zero - company.actual) / company.actual;
        companyRelErrors[cp.key].push(rel);
        companyAbsPctErrors[cp.key].push(Math.abs(rel));
      }
    }
  }

  const summarize = (bucket) => ({
    overall: errorMetrics(bucket.all),
    byCheckpoint: Object.fromEntries(
      Object.entries(bucket.byCheckpoint).map(([k, v]) => [k, errorMetrics(v)]),
    ),
    all: bucket.all,
  });

  return {
    company: Object.fromEntries(methods.map((m) => [m, summarize(companyBuckets[m])])),
    salesman: Object.fromEntries(methods.map((m) => [m, summarize(salesmanBuckets[m])])),
    floor: {
      observations: floorObs,
      floorActive,
      pctObservations: floorObs > 0 ? floorActive / floorObs : null,
      forecastSalesTotal,
      forecastSalesFloorAffected,
      pctForecastSales: forecastSalesTotal > 0 ? forecastSalesFloorAffected / forecastSalesTotal : null,
      byCheckpoint: Object.fromEntries(
        Object.entries(floorByCheckpoint).map(([k, v]) => [
          k,
          { ...v, pct: v.obs > 0 ? v.active / v.obs : null },
        ]),
      ),
    },
    companyPairs: companyBuckets,
    companyRelErrors,
  };
}

function novemberForecasts(bySalesman) {
  const ym = CURRENT_MONTH;
  const asOf = AS_OF_NOV;
  const teamDays = buildTeamDays(bySalesman);
  const per = [];
  for (const [salesman, days] of [...bySalesman.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const prior = priorMonths(days, ym, { lookback: LOOKBACK });
    const mtd = mtdThrough(days, asOf);
    if (prior.length < 1 && Math.abs(mtd) < 1) continue;
    const inp = resolveInputs(days, teamDays, ym, asOf, LOOKBACK);
    const aFloor = methodARaw({
      actualMtd: inp.actualMtd,
      histShare: inp.histShare,
      workdayFrac: inp.workdayFrac,
      useFloor: true,
    });
    const aNo = methodARaw({
      actualMtd: inp.actualMtd,
      histShare: inp.histShare,
      workdayFrac: inp.workdayFrac,
      useFloor: false,
    });
    per.push({
      salesman,
      actualMtd: inp.actualMtd,
      histShare: inp.histShare,
      workdayFrac: inp.workdayFrac,
      baseline: inp.baseline,
      usedFloor: aFloor.usedFloor,
      A: aFloor.forecast,
      A_nofloor: aNo.forecast,
      B: methodB({ actualMtd: inp.actualMtd, baseline: inp.baseline, histShare: inp.histShare }),
      C: methodC({
        actualMtd: inp.actualMtd,
        baseline: inp.baseline,
        histShare: inp.histShare,
        workdayFrac: inp.workdayFrac,
      }),
      D: methodD({ actualMtd: inp.actualMtd, elapsed: inp.elapsed, total: inp.total }),
      A_zero: methodAPlusZeroFallback({
        actualMtd: inp.actualMtd,
        histShare: inp.histShare,
        workdayFrac: inp.workdayFrac,
        baseline: inp.baseline,
        useFloor: true,
      }),
    });
  }
  const sum = (key) => per.reduce((s, r) => s + (Number(r[key]) || 0), 0);
  const wd = workdayIndexOnOrBefore(ym, asOf);
  return {
    asOf,
    workday: { elapsed: wd.elapsed, total: wd.total },
    perSalesman: per,
    company: {
      actualMtd: sum("actualMtd"),
      A: sum("A"),
      A_nofloor: sum("A_nofloor"),
      B: sum("B"),
      C: sum("C"),
      D: sum("D"),
      A_zero: sum("A_zero"),
    },
  };
}

function predictionInterval(companyRelErrors, checkpointKey, centralForecast) {
  const errs = companyRelErrors[checkpointKey] || [];
  if (errs.length < 5) {
    return {
      n: errs.length,
      insufficient: true,
      central: centralForecast,
      low80: null,
      high80: null,
      note: "Fewer than 5 comparable out-of-sample company errors",
    };
  }
  // 80% interval from empirical relative-error distribution (10th–90th percentile)
  const p10 = quantile(errs, 0.10);
  const p90 = quantile(errs, 0.90);
  return {
    n: errs.length,
    insufficient: false,
    central: centralForecast,
    // forecast = actual * (1 + rel) => actual ≈ forecast / (1 + rel)
    // For interval on the forecast outcome (true month-end), invert:
    // true ≈ forecast / (1 + rel_error_of_forecast)
    // Using additive on forecast scale: forecast * (1 - p90) ... if rel = (f-a)/a then a = f/(1+rel)
    low80: centralForecast / (1 + p90),
    high80: centralForecast / (1 + p10),
    relP10: p10,
    relP90: p90,
    method: "empirical company relative-error quantiles at same checkpoint (out-of-sample)",
  };
}

function novemberPaceDiagnostics(bySalesman) {
  const team = buildTeamDays(bySalesman);
  const thru = (ym, endDay) => {
    const end = `${ym}-${String(endDay).padStart(2, "0")}`;
    return mtdThrough(team, end);
  };
  const full = (ym) => monthTotal(team, ym);
  return {
    oct2026_thru10: thru("2026-10", 10),
    nov2026_thru10: thru("2026-11", 10),
    nov2025_thru10: thru("2025-11", 10),
    nov2025_full: full("2025-11"),
    oct2026_full: full("2026-10"),
    sep2026_full: full("2026-09"),
    aug2026_full: full("2026-08"),
    nov2025_impliedFromEarly:
      thru("2025-11", 10) > 0 ? full("2025-11") / thru("2025-11", 10) : null,
    nov2026_methodA_multiple:
      thru("2026-11", 10) > 0 ? null : null, // filled by caller
  };
}

function main() {
  const rows = loadRows();
  const { bySalesman, months } = buildSeries(rows);
  const completedFull = months.filter((ym) => ym < CURRENT_MONTH && ym >= "2025-05" && ym !== "2025-04");
  const backtestMonths = completedFull.filter((ym) => ym >= "2025-11");

  const validation = runValidation(bySalesman, backtestMonths);
  const nov = novemberForecasts(bySalesman);
  const pace = novemberPaceDiagnostics(bySalesman);
  pace.nov2026_methodA_multiple = nov.company.actualMtd > 0
    ? nov.company.A / nov.company.actualMtd
    : null;
  pace.nov2025_implied_multiple = pace.nov2025_thru10 > 0
    ? pace.nov2025_full / pace.nov2025_thru10
    : null;

  // Relative errors by method for calibrated intervals
  const relByMethod = {};
  for (const m of ["A", "D", "A_zero", "B", "C"]) {
    relByMethod[m] = {};
    for (const [cp, pairs] of Object.entries(validation.companyPairs[m].byCheckpoint)) {
      relByMethod[m][cp] = pairs
        .filter((p) => Math.abs(p.actual) > 1)
        .map((p) => (p.forecast - p.actual) / p.actual);
    }
  }

  // Nov workday 9 ≈ nearest checkpoint WD10 for interval
  const novInterval = predictionInterval(relByMethod.A_zero, "wd10", nov.company.A_zero);
  const novIntervalA = predictionInterval(relByMethod.A, "wd10", nov.company.A);
  const novIntervalD = predictionInterval(relByMethod.D, "wd10", nov.company.D);

  const comparison = {
    A: {
      overallWape: validation.company.A.overall.wape,
      wd5: validation.company.A.byCheckpoint.wd5.wape,
      wd10: validation.company.A.byCheckpoint.wd10.wape,
      wd20: validation.company.A.byCheckpoint.wd20.wape,
      biasPct: validation.company.A.overall.biasPct,
      nov: nov.company.A,
    },
    B: {
      overallWape: validation.company.B.overall.wape,
      wd5: validation.company.B.byCheckpoint.wd5.wape,
      wd10: validation.company.B.byCheckpoint.wd10.wape,
      wd20: validation.company.B.byCheckpoint.wd20.wape,
      biasPct: validation.company.B.overall.biasPct,
      nov: nov.company.B,
    },
    C: {
      overallWape: validation.company.C.overall.wape,
      wd5: validation.company.C.byCheckpoint.wd5.wape,
      wd10: validation.company.C.byCheckpoint.wd10.wape,
      wd20: validation.company.C.byCheckpoint.wd20.wape,
      biasPct: validation.company.C.overall.biasPct,
      nov: nov.company.C,
    },
    D: {
      overallWape: validation.company.D.overall.wape,
      wd5: validation.company.D.byCheckpoint.wd5.wape,
      wd10: validation.company.D.byCheckpoint.wd10.wape,
      wd20: validation.company.D.byCheckpoint.wd20.wape,
      biasPct: validation.company.D.overall.biasPct,
      nov: nov.company.D,
    },
    A_zero: {
      overallWape: validation.company.A_zero.overall.wape,
      wd5: validation.company.A_zero.byCheckpoint.wd5.wape,
      wd10: validation.company.A_zero.byCheckpoint.wd10.wape,
      wd20: validation.company.A_zero.byCheckpoint.wd20.wape,
      biasPct: validation.company.A_zero.overall.biasPct,
      nov: nov.company.A_zero,
    },
  };

  // Zero-MTD subset accuracy: among salesman-months where MTD was 0 at checkpoint
  const zeroSubset = {};
  for (const m of ["A", "A_zero", "B"]) {
    const pairs = validation.salesman[m].all.filter((p) => p.zeroMtd);
    zeroSubset[m] = errorMetrics(pairs);
  }

  const result = {
    meta: {
      generatedAt: new Date().toISOString(),
      lookback: LOOKBACK,
      asOfNov: AS_OF_NOV,
      backtestMonths,
      note: "Transaction-date as-of backtests only; upload as-of unavailable.",
    },
    comparison,
    companyDetail: validation.company,
    salesmanDetail: {
      A: validation.salesman.A.overall,
      B: validation.salesman.B.overall,
      C: validation.salesman.C.overall,
      D: validation.salesman.D.overall,
      A_zero: validation.salesman.A_zero.overall,
      A_nofloor: validation.salesman.A_nofloor.overall,
    },
    floor: validation.floor,
    floorAccuracy: {
      withFloor: validation.company.A,
      withoutFloor: validation.company.A_nofloor,
    },
    zeroMtdFallback: {
      zeroSubset,
      overallCompanyA: validation.company.A.overall,
      overallCompanyAZero: validation.company.A_zero.overall,
      improvesCompanyWape:
        validation.company.A_zero.overall.wape < validation.company.A.overall.wape,
    },
    november: {
      company: nov.company,
      workday: nov.workday,
      pace,
      sqlExternal: {
        oct_thru_10: 483235.81,
        nov_thru_10: 426577.82,
        nov25_thru_10: 392264.89,
        nov25_full: 1105019.85,
        oct_full: 2458682.2,
        oct_invoices_ge_50k: 6,
        oct_sum_ge_50k: 847545,
        nov_invoices_ge_50k: 0,
      },
      interval80_A_zero_wd10: novInterval,
      interval80_A_wd10: novIntervalA,
      interval80_D_wd10: novIntervalD,
      zeroMtdSalesmen: nov.perSalesman.filter((r) => !(r.actualMtd > 0)).map((r) => ({
        salesman: r.salesman,
        A: r.A,
        A_zero: r.A_zero,
        B: r.B,
      })),
      floorActiveSalesmen: nov.perSalesman.filter((r) => r.usedFloor).map((r) => ({
        salesman: r.salesman,
        histShare: r.histShare,
        workdayFrac: r.workdayFrac,
        A: r.A,
      })),
    },
    recommendation: null,
  };

  // Build recommendation textually
  const ranked = Object.entries(comparison)
    .map(([k, v]) => ({ method: k, wape: v.overallWape }))
    .filter((r) => r.wape != null)
    .sort((a, b) => a.wape - b.wape);
  result.recommendation = {
    bestByCompanyWape: ranked[0]?.method,
    ranking: ranked,
    notes: [
      "Prefer lowest company WAPE with acceptable late-month stability.",
      "Method D tests whether historical curves beat pure workday extrapolation.",
      "A_zero = Method A with workday floor + Method B remaining when MTD<=0.",
    ],
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({
    wrote: OUTPUT,
    comparison,
    floor: result.floor,
    floorWape: {
      with: validation.company.A.overall.wape,
      without: validation.company.A_nofloor.overall.wape,
      byCpWith: validation.company.A.byCheckpoint,
      byCpWithout: validation.company.A_nofloor.byCheckpoint,
    },
    zeroFallback: result.zeroMtdFallback,
    nov: nov.company,
    interval: novInterval,
    salesman: result.salesmanDetail,
    ranking: ranked,
  }, null, 2));
}

main();
