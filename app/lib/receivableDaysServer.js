import { OUTSTANDING_DATASET_KEY, buildOutstandingRow } from "./outstanding.js";
import { mergeSalesSnapshots } from "./salesHistory.js";
import { loadSalesBiCube } from "./salesBiCubeServer.js";
import { salesMixMeasuresForRow } from "./salesMix.js";
import { forEachCustomerSalesHistory } from "./outstandingReconcileServer.js";
import {
  RECEIVABLE_DAYS_DATASET_KEY,
  buildReceivableDaysReport,
  sumTallyOutstandingRows,
  tallyReceivablesByMonth,
} from "./receivableDays.js";
import { getKsaDateString } from "./workdayActivity.js";

function parseJson(value) {
  try {
    return JSON.parse(value || "null");
  } catch {
    return null;
  }
}

function isMissingTableError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42P01"
    || message.includes("could not find the table")
    || (message.includes("relation") && message.includes("does not exist"));
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
  return parseJson(data?.setting_value);
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

function sumMonthlyCreditSalesFromFacts(facts = []) {
  const byMonth = new Map();
  (Array.isArray(facts) ? facts : []).forEach((fact) => {
    const month = String(fact?.month || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    const credit = Number(fact?.credit_sales_amount);
    const amount = Number.isFinite(credit)
      ? credit
      : Number(salesMixMeasuresForRow(fact).credit_sales_amount || 0);
    byMonth.set(month, Math.round((Number(byMonth.get(month) || 0) + amount) * 100) / 100);
  });
  return Object.fromEntries(byMonth);
}

async function loadMonthlyCreditSales(admin) {
  try {
    const cube = await loadSalesBiCube(admin, { allowStale: true });
    if (cube?.facts?.length) {
      return {
        monthlyCreditSales: sumMonthlyCreditSalesFromFacts(cube.facts),
        source: cube.source || "sales_bi_cube",
        batchId: String(cube.batchId || ""),
      };
    }
  } catch (error) {
    console.error("Receivable days: sales cube unavailable, scanning active_sales:", error);
  }

  const byMonth = new Map();
  await forEachCustomerSalesHistory(admin, async (_code, salesRows) => {
    mergeSalesSnapshots(salesRows).forEach((row) => {
      const month = String(row?.transaction_date || "").slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) return;
      const amount = Number(salesMixMeasuresForRow(row).credit_sales_amount || 0);
      if (!(amount > 0)) return;
      byMonth.set(month, Math.round((Number(byMonth.get(month) || 0) + amount) * 100) / 100);
    });
  });
  return {
    monthlyCreditSales: Object.fromEntries(byMonth),
    source: "active_sales",
    batchId: await activeSalesBatchId(admin),
  };
}

export function normalizeReceivableDaysDataset(raw) {
  const monthlyReceivables = raw?.monthlyReceivables && typeof raw.monthlyReceivables === "object"
    ? raw.monthlyReceivables
    : {};
  const monthlyCreditSales = raw?.monthlyCreditSales && typeof raw.monthlyCreditSales === "object"
    ? raw.monthlyCreditSales
    : {};
  return {
    builtAt: String(raw?.builtAt || ""),
    batchId: String(raw?.batchId || ""),
    outstandingUploadedAt: String(raw?.outstandingUploadedAt || raw?.receiptUploadedAt || ""),
    receivablesSource: String(raw?.receivablesSource || ""),
    tallyOutstanding: Number(raw?.tallyOutstanding || 0),
    asOfDate: String(raw?.asOfDate || ""),
    creditSalesSource: String(raw?.creditSalesSource || ""),
    monthlyReceivables,
    monthlyCreditSales,
    scannedCount: Number(raw?.scannedCount || 0),
    failedCount: Number(raw?.failedCount || 0),
  };
}

export function receivableDaysDatasetIsFresh(dataset, {
  batchId = "",
  outstandingUploadedAt = "",
  asOfDate = "",
} = {}) {
  if (!dataset?.builtAt) return false;
  if (dataset.receivablesSource !== "tally_outstanding") return false;
  if (batchId && dataset.batchId && dataset.batchId !== batchId) return false;
  if (String(dataset.outstandingUploadedAt || "") !== String(outstandingUploadedAt || "")) return false;
  if (asOfDate && dataset.asOfDate && dataset.asOfDate !== asOfDate) return false;
  return true;
}

function tallyOutstandingFromDataset(dataset) {
  const rows = (Array.isArray(dataset?.rows) ? dataset.rows : []).map((row) => buildOutstandingRow(row));
  return {
    total: sumTallyOutstandingRows(rows),
    uploadedAt: String(dataset?.uploadedAt || ""),
    customerCount: rows.length,
  };
}

export async function buildReceivableDaysDataset(admin, { asOfDate = "", trigger = "manual" } = {}) {
  const asOf = String(asOfDate || getKsaDateString()).slice(0, 10);
  const outstandingDataset = await readSettingJson(admin, OUTSTANDING_DATASET_KEY);
  const tally = tallyOutstandingFromDataset(outstandingDataset);
  const credit = await loadMonthlyCreditSales(admin);

  return {
    builtAt: new Date().toISOString(),
    trigger: String(trigger || "manual"),
    batchId: credit.batchId || await activeSalesBatchId(admin),
    outstandingUploadedAt: tally.uploadedAt,
    receivablesSource: "tally_outstanding",
    tallyOutstanding: tally.total,
    asOfDate: asOf,
    creditSalesSource: credit.source,
    monthlyReceivables: tallyReceivablesByMonth(tally.total, asOf),
    monthlyCreditSales: credit.monthlyCreditSales,
    scannedCount: tally.customerCount,
    failedCount: 0,
  };
}

export async function saveReceivableDaysDataset(admin, dataset) {
  const { error } = await admin
    .from("system_settings")
    .upsert({
      setting_key: RECEIVABLE_DAYS_DATASET_KEY,
      setting_value: JSON.stringify(dataset),
    }, { onConflict: "setting_key" });
  if (error) throw error;
  return dataset;
}

export async function readReceivableDaysDataset(admin) {
  const raw = await readSettingJson(admin, RECEIVABLE_DAYS_DATASET_KEY);
  if (!raw) return null;
  return normalizeReceivableDaysDataset(raw);
}

export async function rebuildReceivableDaysDataset(admin, { asOfDate = "", trigger = "manual" } = {}) {
  const dataset = await buildReceivableDaysDataset(admin, { asOfDate, trigger });
  await saveReceivableDaysDataset(admin, dataset);
  return dataset;
}

export async function loadReceivableDaysReport(admin, {
  asOfDate = "",
  dateFrom = "",
  dateTo = "",
} = {}) {
  const asOf = String(asOfDate || getKsaDateString()).slice(0, 10);
  const [batchId, outstandingDataset, cached] = await Promise.all([
    activeSalesBatchId(admin),
    readSettingJson(admin, OUTSTANDING_DATASET_KEY),
    readReceivableDaysDataset(admin),
  ]);
  const outstandingUploadedAt = String(outstandingDataset?.uploadedAt || "");
  let dataset = cached;
  let rebuilt = false;

  if (!receivableDaysDatasetIsFresh(dataset, { batchId, outstandingUploadedAt, asOfDate: asOf })) {
    dataset = await rebuildReceivableDaysDataset(admin, { asOfDate: asOf, trigger: "report-load" });
    rebuilt = true;
  }

  const report = buildReceivableDaysReport({
    monthlyCreditSales: dataset.monthlyCreditSales,
    monthlyReceivables: dataset.monthlyReceivables,
    asOfDate: asOf,
    dateFrom,
    dateTo,
  });

  return {
    ...report,
    meta: {
      preparedAt: dataset.builtAt,
      batchId: dataset.batchId,
      outstandingUploadedAt: dataset.outstandingUploadedAt,
      receivablesSource: dataset.receivablesSource,
      tallyOutstanding: dataset.tallyOutstanding,
      creditSalesSource: dataset.creditSalesSource,
      scannedCount: dataset.scannedCount,
      failedCount: dataset.failedCount,
      rebuilt,
      source: "receivable_days_monthly_v1",
    },
  };
}
