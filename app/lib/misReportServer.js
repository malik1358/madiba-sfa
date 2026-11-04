import { OUTSTANDING_DATASET_KEY, buildOutstandingRow } from "./outstanding.js";
import { RECEIPT_DATASET_KEY } from "./receiptRegister.js";
import { buildMisReport } from "./misReport.js";
import {
  MIS_PREPARED_KEY,
  defaultMisAsOfDate,
  deserializePreparedMis,
  serializePreparedMis,
} from "./misPrepared.js";
import { salesBiFactToGrowthRow } from "./salesBiCube.js";
import { loadSalesBiCube, pageActiveSales } from "./salesBiCubeServer.js";
import { getKsaDateString } from "./workdayActivity.js";

const MIS_INVENTORY_SETTING_KEY = "mis_inventory_physical_v1";
const SALES_SELECT = "transaction_date,category,sales_amount,profit_amount,salesman_code,salesman_name,customer_code,item_code,item_name";
const MAX_PREPARED_CHARS = 3500000;

let memoryPrepared = null;

function isMissingTableError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42P01"
    || message.includes("could not find the table")
    || (message.includes("relation") && message.includes("does not exist"));
}

function parseSettingJsonValue(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

async function readSettingJson(admin, key) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", key)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  return parseSettingJsonValue(data?.setting_value);
}

async function writeSettingJson(admin, key, value) {
  const { error } = await admin.from("system_settings").upsert({
    setting_key: key,
    setting_value: JSON.stringify(value),
  }, { onConflict: "setting_key" });
  if (error) {
    if (isMissingTableError(error)) return false;
    throw error;
  }
  return true;
}

function monthKey(value) {
  const raw = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}/.test(raw) ? raw.slice(0, 7) : "";
}

function cubeFactsList(cube) {
  if (Array.isArray(cube?.facts)) return cube.facts;
  if (cube?.facts instanceof Map) return [...cube.facts.values()];
  return [];
}

function salesRowsFromCube(cube, { asOfYm }) {
  const rows = [];
  for (const fact of cubeFactsList(cube)) {
    const ym = monthKey(fact?.month);
    if (!ym || ym > asOfYm) continue;
    rows.push(salesBiFactToGrowthRow(fact));
  }
  return rows;
}

async function activeSalesBatchId(admin) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", "active_sales_batch_id")
    .maybeSingle();
  if (error && !isMissingTableError(error)) throw error;
  return String(data?.setting_value || "").trim();
}

/** Fallback only when the prepared BI cube is empty / unavailable. */
export async function loadMisSalesRowsFromActiveSales(admin, { toDateExclusive }) {
  const rows = [];
  const selectAttempts = [
    SALES_SELECT,
    "transaction_date,category,sales_amount,salesman_code,salesman_name,customer_code,item_code,item_name",
    "transaction_date,category,sales_amount,customer_code,item_name,salesman_name",
  ];

  let lastError = null;
  for (const select of selectAttempts) {
    try {
      rows.length = 0;
      await pageActiveSales(admin, select, async (page) => {
        for (const row of page || []) {
          const day = String(row.transaction_date || "").slice(0, 10);
          if (!day || day >= toDateExclusive) continue;
          rows.push(row);
        }
      });
      return rows;
    } catch (error) {
      lastError = error;
      const message = String(error?.message || "");
      if (!/column/i.test(message)) throw error;
    }
  }
  throw lastError || new Error("Unable to load active_sales for MIS");
}

export async function loadMisSalesRows(admin, { asOfYm, toDateExclusive, cube = null }) {
  try {
    const salesCube = cube || await loadSalesBiCube(admin, { allowStale: true });
    const rows = salesRowsFromCube(salesCube, { asOfYm });
    if (rows.length) {
      return { rows, source: salesCube.source || "sales_bi_cube", preparedAt: salesCube.builtAt || null };
    }
  } catch (error) {
    console.error("MIS: sales BI cube unavailable, scanning active_sales:", error);
  }
  const rows = await loadMisSalesRowsFromActiveSales(admin, { toDateExclusive });
  return { rows, source: "active_sales", preparedAt: null };
}

export async function loadMisReceiptRows(admin) {
  const payload = await readSettingJson(admin, RECEIPT_DATASET_KEY);
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.receipts)) return payload.receipts;
  return [];
}

export async function loadMisOutstandingRows(admin) {
  const payload = await readSettingJson(admin, OUTSTANDING_DATASET_KEY);
  const rawRows = Array.isArray(payload?.rows) ? payload.rows : [];
  return rawRows.map((row) => buildOutstandingRow(row)).filter(Boolean);
}

function normalizeInventoryPayload(payload, asOfMonth) {
  if (!payload || typeof payload !== "object") return null;
  const month = String(asOfMonth || "").slice(0, 7);
  let entry = payload;
  if (payload.byMonth && typeof payload.byMonth === "object" && month) {
    entry = payload.byMonth[month] || payload.byMonth[month.replace("-", "")] || null;
  } else if (payload.months && typeof payload.months === "object" && month) {
    entry = payload.months[month] || null;
  } else if (payload.month && String(payload.month).slice(0, 7) !== month) {
    return null;
  }
  if (!entry || typeof entry !== "object") return null;
  const value = Number(entry.physical ?? entry.amount ?? entry.total);
  if (!Number.isFinite(value)) return null;
  const previousPhysical = Number(
    entry.previousPhysical
    ?? entry.previous?.physical
    ?? entry.previous_amount
    ?? entry.sep_physical
    ?? payload.previousPhysical,
  );
  const byCategory = entry.byCategory || entry.by_category || entry.categories
    || payload.byCategory || payload.by_category || null;
  return {
    physical: value,
    previousPhysical: Number.isFinite(previousPhysical) ? previousPhysical : null,
    byCategory: byCategory && typeof byCategory === "object" && !Array.isArray(byCategory)
      ? byCategory
      : null,
  };
}

export async function loadMisInventoryPhysical(admin, asOfMonth) {
  const payload = await readSettingJson(admin, MIS_INVENTORY_SETTING_KEY);
  return normalizeInventoryPayload(payload, asOfMonth);
}

function priorOutstandingFromPrepared(prepared, asOfYm) {
  const headline = prepared?.report?.headline;
  if (!headline) return null;
  const preparedYm = String(prepared.asOfDate || prepared.report?.asOfMonth || "").slice(0, 7);
  if (preparedYm && preparedYm < asOfYm) {
    return {
      totalAr: headline.totalAr,
      gt90Ar: headline.gt90Ar,
      arBuckets: headline.arBuckets || null,
    };
  }
  if (preparedYm === asOfYm && (headline.previousTotalAr != null || headline.previousArBuckets)) {
    return {
      totalAr: headline.previousTotalAr,
      gt90Ar: headline.previousGt90Ar,
      arBuckets: headline.previousArBuckets || null,
    };
  }
  return null;
}

async function priorOutstandingFromReceivableDays(admin, prevYm) {
  if (!prevYm) return null;
  try {
    const { RECEIVABLE_DAYS_DATASET_KEY } = await import("./receivableDays.js");
    const dataset = await readSettingJson(admin, RECEIVABLE_DAYS_DATASET_KEY);
    const total = Number(dataset?.monthlyReceivables?.[prevYm]);
    if (!Number.isFinite(total)) return null;
    return { totalAr: total, gt90Ar: null, arBuckets: null };
  } catch {
    return null;
  }
}

/** Build MIS metrics from cube + register datasets (used only while preparing). */
export async function buildMisReportFromSources(admin, { asOfDate, cube = null } = {}) {
  const asOf = String(asOfDate || defaultMisAsOfDate(getKsaDateString())).slice(0, 10);
  const year = asOf.slice(0, 4);
  const asOfYm = asOf.slice(0, 7);
  const [y, m] = asOfYm.split("-").map(Number);
  const prevYm = m > 1
    ? `${y}-${String(m - 1).padStart(2, "0")}`
    : `${y - 1}-12`;
  const nextDay = new Date(`${asOf}T12:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const toDateExclusive = nextDay.toISOString().slice(0, 10);
  const ytdFromDate = `${year}-01-01`;

  const existingPrepared = await readPreparedMisReport(admin).catch(() => null);
  const [salesLoad, receiptRows, outstandingRows, inventoryPhysical, receivablePrior] = await Promise.all([
    loadMisSalesRows(admin, { asOfYm, toDateExclusive, cube }),
    loadMisReceiptRows(admin),
    loadMisOutstandingRows(admin),
    loadMisInventoryPhysical(admin, asOfYm),
    priorOutstandingFromReceivableDays(admin, prevYm),
  ]);

  const priorOutstanding = priorOutstandingFromPrepared(existingPrepared, asOfYm) || receivablePrior;

  const salesRows = salesLoad.rows || [];
  const report = buildMisReport({
    salesRows,
    receiptRows,
    outstandingRows,
    asOfDate: asOf,
    inventoryPhysical,
    priorOutstanding,
  });

  return {
    ...report,
    meta: {
      salesRowCount: salesRows.length,
      receiptRowCount: receiptRows.length,
      outstandingRowCount: outstandingRows.length,
      inventorySource: inventoryPhysical == null ? null : MIS_INVENTORY_SETTING_KEY,
      salesSource: salesLoad.source || null,
      salesPreparedAt: salesLoad.preparedAt || null,
      ytdFromDate,
      toDateExclusive,
      source: "prepared_build",
    },
  };
}

export async function readPreparedMisReport(admin) {
  if (memoryPrepared?.report) return memoryPrepared;
  const payload = await readSettingJson(admin, MIS_PREPARED_KEY);
  const prepared = deserializePreparedMis(payload);
  if (prepared) memoryPrepared = prepared;
  return prepared;
}

export async function rebuildPreparedMisReport(admin, { asOfDate = "", cube = null } = {}) {
  const asOf = String(asOfDate || defaultMisAsOfDate(getKsaDateString())).slice(0, 10);
  const report = await buildMisReportFromSources(admin, { asOfDate: asOf, cube });
  const batchId = await activeSalesBatchId(admin).catch(() => "");
  const prepared = serializePreparedMis({
    asOfDate: asOf,
    builtAt: new Date().toISOString(),
    batchId,
    report: {
      ...report,
      meta: {
        ...report.meta,
        source: "mis_report_prepared",
        preparedAt: new Date().toISOString(),
        preparedKey: MIS_PREPARED_KEY,
      },
    },
  });
  const encoded = JSON.stringify(prepared);
  if (encoded.length > MAX_PREPARED_CHARS) {
    throw new Error("Prepared MIS is too large to store. Reduce as-of history or contact support.");
  }
  await writeSettingJson(admin, MIS_PREPARED_KEY, prepared);
  memoryPrepared = prepared;
  return prepared;
}

/** Serve the prepared month-end pack only (no live rebuild). */
export async function loadPreparedMisReport(admin, { asOfDate = "" } = {}) {
  const prepared = await readPreparedMisReport(admin);
  if (!prepared?.report) {
    return { prepared: false, report: null, asOfDate: String(asOfDate || "").slice(0, 10) || null };
  }
  const requested = String(asOfDate || "").slice(0, 10);
  if (requested && requested !== prepared.asOfDate) {
    return {
      prepared: true,
      staleRequest: true,
      report: prepared.report,
      asOfDate: prepared.asOfDate,
      builtAt: prepared.builtAt,
      message: `Prepared pack is as of ${prepared.asOfDate}. Tap Refresh to rebuild for ${requested}.`,
    };
  }
  return {
    prepared: true,
    report: prepared.report,
    asOfDate: prepared.asOfDate,
    builtAt: prepared.builtAt,
  };
}

/** @deprecated use loadPreparedMisReport / rebuildPreparedMisReport */
export async function loadLiveMisReport(admin, { asOfDate }) {
  const prepared = await loadPreparedMisReport(admin, { asOfDate });
  if (prepared.report) return prepared.report;
  const rebuilt = await rebuildPreparedMisReport(admin, { asOfDate });
  return rebuilt.report;
}

export function clearPreparedMisMemory() {
  memoryPrepared = null;
}

export { MIS_INVENTORY_SETTING_KEY, MIS_PREPARED_KEY, defaultMisAsOfDate };
