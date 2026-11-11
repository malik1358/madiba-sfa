/**
 * Exact Nov-10 Method A reconciliation: backtest algorithm vs production helpers.
 */
import fs from "node:fs";
import {
  averageCumulativeDayShares,
  expectedPacePercent,
  monthEndPaceEstimate,
  ksaWorkdayProgressRatio,
  netKpiSalesAmount,
} from "../../app/lib/performanceKpis.js";
import { normalizeReportSalesmanCode } from "../../app/lib/salesmanReportIdentity.js";

const INPUT = "scripts/analysis/daily-sales.json";
const AS_OF = "2026-11-10";
const YM = "2026-11";
const EXCLUDE = new Set([
  "ADMIN", "NOT IN VOUCHER", "NOT ADDED IN VOUCHER", "NOON", "TRENDYOL", "",
]);

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
function monthEnd(iso) {
  const { y, m } = parseIso(iso);
  return isoFromParts(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate());
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
function median(values) {
  const arr = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function loadBySalesman() {
  const rows = JSON.parse(fs.readFileSync(INPUT, "utf8"));
  const by = new Map();
  for (const r of rows) {
    const code = normalizeReportSalesmanCode(r.salesman);
    if (!code || EXCLUDE.has(code)) continue;
    const d = String(r.d).slice(0, 10);
    const net = Number(r.net_sales) || 0;
    if (!by.has(code)) by.set(code, new Map());
    const m = by.get(code);
    m.set(d, (m.get(d) || 0) + net);
  }
  return by;
}

function monthTotal(days, ym) {
  let s = 0;
  for (const [d, v] of days) if (d.startsWith(ym)) s += v;
  return s;
}
function mtdThrough(days, asOf) {
  const start = `${asOf.slice(0, 7)}-01`;
  let s = 0;
  for (const [d, v] of days) if (d >= start && d <= asOf) s += v;
  return s;
}
function priorMonths(days, beforeYm, lookback = 6) {
  const months = [...new Set([...days.keys()].map((d) => d.slice(0, 7)).filter((m) => m < beforeYm))].sort();
  return months.filter((m) => Math.abs(monthTotal(days, m)) >= 1).slice(-lookback);
}

/** Backtest Method A: workday-indexed median share + workday floor. */
function backtestMethodA(days, asOf) {
  const ym = asOf.slice(0, 7);
  const { elapsed, total } = workdayIndexOnOrBefore(ym, asOf);
  const workdayFrac = total > 0 ? elapsed / total : 0;
  const workdayN = Math.max(1, elapsed);
  const prior = priorMonths(days, ym, 6);
  const shares = [];
  for (const histYm of prior) {
    const tot = monthTotal(days, histYm);
    if (!(Math.abs(tot) > 0)) continue;
    const wdays = workdaysInMonth(histYm);
    let cum = 0;
    const start = `${histYm}-01`;
    for (let i = 0; i < Math.min(workdayN, wdays.length); i += 1) {
      const asOfHist = wdays[i];
      const prev = i === 0 ? addDays(start, -1) : wdays[i - 1];
      for (let d = addDays(prev, 1); d <= asOfHist; d = addDays(d, 1)) {
        cum += days.get(d) || 0;
      }
    }
    shares.push(cum / tot);
  }
  const histShare = median(shares);
  const actual = mtdThrough(days, asOf);
  if (!(actual > 0)) return { actual, forecast: actual, histShare, workdayFrac, mode: "backtest" };
  const fallback = histShare == null || !(histShare > 0) ? workdayFrac : histShare;
  const effective = Math.max(fallback, workdayFrac);
  return {
    actual,
    forecast: actual / effective,
    histShare: fallback,
    workdayFrac,
    effective,
    mode: "backtest",
  };
}

/** Production Method A via app helpers (workday-indexed median + floor). */
function productionMethodA(days, asOf) {
  const ym = asOf.slice(0, 7);
  const historyRows = [];
  for (const [d, v] of days) {
    if (d.slice(0, 7) >= ym) continue;
    historyRows.push({ transaction_date: d, sales_amount: v });
  }
  const curve = averageCumulativeDayShares(historyRows, { aggregator: "median", maxMonths: 6 });
  const actual = mtdThrough(days, asOf);
  const expected = expectedPacePercent(asOf, curve.shares);
  const forecast = monthEndPaceEstimate({ actual, expected });
  return {
    actual,
    forecast: forecast == null ? 0 : forecast,
    expectedPct: expected,
    workdayFrac: ksaWorkdayProgressRatio(asOf),
    mode: "production-workday",
  };
}

function main() {
  const by = loadBySalesman();
  let backtest = 0;
  let production = 0;
  let mtd = 0;
  const per = [];
  for (const [code, days] of [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const prior = priorMonths(days, YM, 6);
    const actual = mtdThrough(days, AS_OF);
    if (prior.length < 1 && Math.abs(actual) < 1) continue;
    const b = backtestMethodA(days, AS_OF);
    const p = productionMethodA(days, AS_OF);
    mtd += actual;
    backtest += b.forecast;
    production += p.forecast;
    if (Math.abs(b.forecast - p.forecast) > 1) {
      per.push({
        code,
        actual,
        backtest: Math.round(b.forecast),
        production: Math.round(p.forecast),
        delta: Math.round(p.forecast - b.forecast),
        histShareB: b.histShare,
        effectiveB: b.effective,
        expectedP: p.expectedPct,
      });
    }
  }
  console.log(JSON.stringify({
    asOf: AS_OF,
    mtd: Math.round(mtd * 100) / 100,
    backtestWorkdayIndexed: Math.round(backtest * 100) / 100,
    productionWorkdayIndexed: Math.round(production * 100) / 100,
    target: 1206045,
    deltaBacktestVsTarget: Math.round((backtest - 1206045) * 100) / 100,
    deltaProductionVsTarget: Math.round((production - 1206045) * 100) / 100,
    deltaProductionVsBacktest: Math.round((production - backtest) * 100) / 100,
    workdayFrac: workdayIndexOnOrBefore(YM, AS_OF),
    topDeltas: per.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 12),
  }, null, 2));
}

main();
