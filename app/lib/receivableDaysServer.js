import {
  RECEIPT_DATASET_KEY,
  normalizeReceiptDataset,
} from "./receiptRegister.js";
import { mergeSalesSnapshots } from "./salesHistory.js";
import { matchPaymentsFifo } from "./paymentBehavior.js";
import { loadSalesBiCube } from "./salesBiCubeServer.js";
import { salesMixMeasuresForRow } from "./salesMix.js";
import {
  forEachCustomerSalesHistory,
  indexReceiptsByCustomer,
} from "./outstandingReconcileServer.js";
import {
  RECEIVABLE_DAYS_DATASET_KEY,
  accumulateMonthEndReceivables,
  buildReceivableDaysReport,
  collectReceivableMonthKeys,
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
    receiptUploadedAt: String(raw?.receiptUploadedAt || ""),
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
  receiptUploadedAt = "",
  asOfDate = "",
} = {}) {
  if (!dataset?.builtAt) return false;
  if (!dataset.monthlyReceivables || !Object.keys(dataset.monthlyReceivables).length) {
    if (!dataset.monthlyCreditSales || !Object.keys(dataset.monthlyCreditSales).length) return false;
  }
  if (batchId && dataset.batchId && dataset.batchId !== batchId) return false;
  if (String(dataset.receiptUploadedAt || "") !== String(receiptUploadedAt || "")) return false;
  if (asOfDate && dataset.asOfDate && dataset.asOfDate !== asOfDate) return false;
  return true;
}

export async function buildReceivableDaysDataset(admin, { asOfDate = "", trigger = "manual" } = {}) {
  const asOf = String(asOfDate || getKsaDateString()).slice(0, 10);
  const receiptDataset = normalizeReceiptDataset(await readSettingJson(admin, RECEIPT_DATASET_KEY));
  const receiptsByCode = indexReceiptsByCustomer(receiptDataset);
  const credit = await loadMonthlyCreditSales(admin);
  const monthKeys = collectReceivableMonthKeys(credit.monthlyCreditSales, asOf);
  const monthlyReceivables = new Map(monthKeys.map((month) => [month, 0]));
  let scannedCount = 0;
  let failedCount = 0;

  await forEachCustomerSalesHistory(admin, async (code, salesRows) => {
    scannedCount += 1;
    try {
      const transactions = mergeSalesSnapshots(salesRows);
      const receipts = receiptsByCode.get(code) || [];
      if (!transactions.length && !receipts.length) return;
      const fifo = matchPaymentsFifo(transactions, receipts);
      accumulateMonthEndReceivables(fifo, monthKeys, monthlyReceivables, asOf);
    } catch (error) {
      failedCount += 1;
      console.error(`Receivable days rebuild failed for ${code}:`, error);
    }
  });

  // Receipt-only customers (no sales history) can still clear AR via unmatched cash; skip —
  // open AR requires invoices. No extra pass needed.

  return {
    builtAt: new Date().toISOString(),
    trigger: String(trigger || "manual"),
    batchId: credit.batchId || await activeSalesBatchId(admin),
    receiptUploadedAt: String(receiptDataset?.uploadedAt || ""),
    asOfDate: asOf,
    creditSalesSource: credit.source,
    monthlyReceivables: Object.fromEntries(monthlyReceivables),
    monthlyCreditSales: credit.monthlyCreditSales,
    scannedCount,
    failedCount,
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
  const [batchId, receiptDataset, cached] = await Promise.all([
    activeSalesBatchId(admin),
    readSettingJson(admin, RECEIPT_DATASET_KEY).then((raw) => normalizeReceiptDataset(raw)),
    readReceivableDaysDataset(admin),
  ]);
  const receiptUploadedAt = String(receiptDataset?.uploadedAt || "");
  let dataset = cached;
  let rebuilt = false;

  if (!receivableDaysDatasetIsFresh(dataset, { batchId, receiptUploadedAt, asOfDate: asOf })) {
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
      receiptUploadedAt: dataset.receiptUploadedAt,
      creditSalesSource: dataset.creditSalesSource,
      scannedCount: dataset.scannedCount,
      failedCount: dataset.failedCount,
      rebuilt,
      source: "receivable_days_monthly_v1",
    },
  };
}
