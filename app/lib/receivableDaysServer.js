import * as XLSX from "xlsx";
import {
  OUTSTANDING_DATASET_KEY,
  buildOutstandingRow,
  findOutstandingHeaderRow,
  mergeParsedOutstandingSheets,
  parseOutstandingRows,
  prioritizeOutstandingSheets,
  selectPreferredOutstandingParses,
} from "./outstanding.js";
import { normalizeGrowthFilters, rowMatchesGrowthFilters } from "./categoryGrowth.js";
import { mergeSalesSnapshots } from "./salesHistory.js";
import { loadSalesBiCube } from "./salesBiCubeServer.js";
import { salesBiFactToGrowthRow, salesBiFactsFromCube } from "./salesBiCube.js";
import { salesMixMeasuresForRow } from "./salesMix.js";
import { forEachCustomerSalesHistory } from "./outstandingReconcileServer.js";
import {
  RECEIVABLE_DAYS_DATASET_KEY,
  buildReceivableDaysReport,
  filterOutstandingRowsForReceivableFilters,
  hasReceivableFieldFilters,
  ksaMonthKey,
  lastOutstandingUploadByMonth,
  outstandingHistoryKey,
  parseStoredOutstandingUploadedAt,
  planOutstandingMonthUploads,
  receivablesFromOutstandingPlan,
  sumFilteredTallyOutstandingRows,
  summarizeOutstandingAr,
  sumTallyOutstandingRows,
} from "./receivableDays.js";
import { UPLOAD_FILES_BUCKET, downloadStoredUpload } from "./uploadFilesStorage.js";
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

function sumMonthlyCreditSalesFromFacts(facts = [], filters = null) {
  const byMonth = new Map();
  const customerCodes = new Set();
  const normalized = filters
    ? normalizeGrowthFilters({ ...filters, dateFrom: "", dateTo: "" })
    : null;
  (Array.isArray(facts) ? facts : []).forEach((fact) => {
    const month = String(fact?.month || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    if (normalized && !rowMatchesGrowthFilters(salesBiFactToGrowthRow(fact), normalized)) return;
    const credit = Number(fact?.credit_sales_amount);
    const amount = Number.isFinite(credit)
      ? credit
      : Number(salesMixMeasuresForRow(fact).credit_sales_amount || 0);
    byMonth.set(month, Math.round((Number(byMonth.get(month) || 0) + amount) * 100) / 100);
    const code = String(fact?.customer_code || "").trim().toUpperCase();
    if (code) customerCodes.add(code);
  });
  return {
    monthlyCreditSales: Object.fromEntries(byMonth),
    customerCodes,
  };
}

async function loadMonthlyCreditSales(admin, filters = null) {
  const useFilters = filters && hasReceivableFieldFilters(filters);
  try {
    const cube = await loadSalesBiCube(admin, { allowStale: true });
    const facts = salesBiFactsFromCube(cube);
    if (facts.length) {
      const summed = sumMonthlyCreditSalesFromFacts(facts, useFilters ? filters : null);
      return {
        monthlyCreditSales: summed.monthlyCreditSales,
        customerCodes: summed.customerCodes,
        source: cube.source || "sales_bi_cube",
        batchId: String(cube.batchId || ""),
      };
    }
  } catch (error) {
    console.error("Receivable days: sales cube unavailable, scanning active_sales:", error);
  }

  const byMonth = new Map();
  const customerCodes = new Set();
  const normalized = useFilters
    ? normalizeGrowthFilters({ ...filters, dateFrom: "", dateTo: "" })
    : null;
  await forEachCustomerSalesHistory(admin, async (_code, salesRows) => {
    mergeSalesSnapshots(salesRows).forEach((row) => {
      const month = String(row?.transaction_date || "").slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) return;
      if (normalized && !rowMatchesGrowthFilters(row, normalized)) return;
      const amount = Number(salesMixMeasuresForRow(row).credit_sales_amount || 0);
      if (!(amount > 0)) return;
      byMonth.set(month, Math.round((Number(byMonth.get(month) || 0) + amount) * 100) / 100);
      const code = String(row?.customer_code || "").trim().toUpperCase();
      if (code) customerCodes.add(code);
    });
  });
  return {
    monthlyCreditSales: Object.fromEntries(byMonth),
    customerCodes,
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
    outstandingHistoryKey: String(raw?.outstandingHistoryKey || ""),
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
  outstandingHistoryKey: historyKey = "",
  asOfDate = "",
} = {}) {
  if (!dataset?.builtAt) return false;
  if (dataset.receivablesSource !== "tally_outstanding") return false;
  if (String(dataset.outstandingHistoryKey || "") !== String(historyKey || "")) return false;
  if (batchId && dataset.batchId && dataset.batchId !== batchId) return false;
  if (String(dataset.outstandingUploadedAt || "") !== String(outstandingUploadedAt || "")) return false;
  // asOfDate is applied when building the report from the prepared monthly series.
  // Do not rebuild the heavy dataset just because the KSA calendar day changed.
  void asOfDate;
  return true;
}

function tallyOutstandingFromDataset(dataset, filters = null, customerCodesFromSales = null) {
  const rows = (Array.isArray(dataset?.rows) ? dataset.rows : []).map((row) => buildOutstandingRow(row));
  const filtered = filters && hasReceivableFieldFilters(filters)
    ? filterOutstandingRowsForReceivableFilters(rows, filters, customerCodesFromSales)
    : rows;
  return {
    total: sumTallyOutstandingRows(filtered),
    uploadedAt: String(dataset?.uploadedAt || ""),
    customerCount: filtered.length,
  };
}

async function listOutstandingStoredFiles(admin) {
  const files = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 10000; offset += pageSize) {
    const { data, error } = await admin.storage.from(UPLOAD_FILES_BUCKET).list("outstanding", {
      limit: pageSize,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw error;
    const batch = Array.isArray(data) ? data : [];
    for (const item of batch) {
      const uploadedAt = parseStoredOutstandingUploadedAt(item?.name);
      if (!uploadedAt || !item?.name) continue;
      files.push({
        uploadedAt,
        filePath: `outstanding/${item.name}`,
        total: null,
      });
    }
    if (batch.length < pageSize) break;
  }
  return files;
}

export function outstandingRowsFromWorkbook(bytes) {
  const workbook = XLSX.read(Buffer.from(bytes), { type: "buffer" });
  const sheetNames = prioritizeOutstandingSheets(workbook.SheetNames || []);
  const parsedBySheetName = [];
  for (const sheetName of sheetNames) {
    const sheetRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
    const headerRowIndex = findOutstandingHeaderRow(sheetRows);
    if (headerRowIndex < 0) continue;
    parsedBySheetName.push({
      sheetName,
      parsed: parseOutstandingRows(sheetRows, headerRowIndex),
    });
  }
  const parsedSheets = selectPreferredOutstandingParses(parsedBySheetName);
  if (!parsedSheets.length) throw new Error("Unable to read an outstanding sheet.");
  const parsed = parsedSheets.length === 1 ? parsedSheets[0] : mergeParsedOutstandingSheets(parsedSheets);
  return (parsed.rows || []).map((row) => buildOutstandingRow(row)).filter(Boolean);
}

export function totalOutstandingFromWorkbook(bytes, filters = null, customerCodesFromSales = null) {
  const rows = outstandingRowsFromWorkbook(bytes);
  if (filters && hasReceivableFieldFilters(filters)) {
    return sumFilteredTallyOutstandingRows(rows, filters, customerCodesFromSales);
  }
  return sumTallyOutstandingRows(rows);
}

/**
 * Prior-month AR for MIS MoM: last daily outstanding upload in that KSA month
 * (same month-end file selection as Net receivable days).
 */
export async function loadMonthEndOutstandingSnapshot(admin, monthYm, {
  liveDataset = null,
} = {}) {
  const month = String(monthYm || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return null;

  const liveUploadedAt = String(liveDataset?.uploadedAt || "");
  if (liveUploadedAt && ksaMonthKey(liveUploadedAt) === month) {
    const liveRows = (Array.isArray(liveDataset?.rows) ? liveDataset.rows : [])
      .map((row) => buildOutstandingRow(row))
      .filter(Boolean);
    if (liveRows.length) return summarizeOutstandingAr(liveRows);
  }

  let storedFiles = [];
  try {
    storedFiles = await listOutstandingStoredFiles(admin);
  } catch (error) {
    console.error("Month-end outstanding: could not list stored files:", error);
    return null;
  }
  const match = lastOutstandingUploadByMonth(storedFiles).find((row) => row.month === month);
  if (!match?.filePath) return null;
  try {
    const file = await downloadStoredUpload(admin, match.filePath);
    const bytes = Buffer.from(await file.arrayBuffer());
    return summarizeOutstandingAr(outstandingRowsFromWorkbook(bytes));
  } catch (error) {
    console.error(`Month-end outstanding: could not read ${match.filePath}:`, error);
    return null;
  }
}

async function outstandingUploadsByMonth(admin, currentUpload, filters = null, customerCodesFromSales = null) {
  let storedFiles = [];
  try {
    storedFiles = await listOutstandingStoredFiles(admin);
  } catch (error) {
    console.error("Receivable days: could not list stored outstanding files:", error);
  }
  const plan = planOutstandingMonthUploads(storedFiles, currentUpload);
  const useFilters = filters && hasReceivableFieldFilters(filters);
  let failedCount = 0;
  for (const row of plan) {
    if (!useFilters && (row.total != null || !row.filePath)) continue;
    if (useFilters && !row.filePath) {
      // Live month total is already filtered in currentUpload.total.
      continue;
    }
    if (useFilters && row.filePath) {
      row.total = null;
    }
    if (row.total != null || !row.filePath) continue;
    try {
      const file = await downloadStoredUpload(admin, row.filePath);
      const bytes = Buffer.from(await file.arrayBuffer());
      row.total = totalOutstandingFromWorkbook(bytes, useFilters ? filters : null, customerCodesFromSales);
    } catch (error) {
      failedCount += 1;
      console.error(`Receivable days: could not read ${row.filePath}:`, error);
    }
  }
  return {
    plan,
    monthlyReceivables: receivablesFromOutstandingPlan(plan),
    historyKey: outstandingHistoryKey(plan),
    failedCount,
  };
}

export async function buildReceivableDaysDataset(admin, { asOfDate = "", trigger = "manual" } = {}) {
  const asOf = String(asOfDate || getKsaDateString()).slice(0, 10);
  const outstandingDataset = await readSettingJson(admin, OUTSTANDING_DATASET_KEY);
  const tally = tallyOutstandingFromDataset(outstandingDataset);
  const [credit, history] = await Promise.all([
    loadMonthlyCreditSales(admin),
    outstandingUploadsByMonth(admin, tally),
  ]);

  return {
    builtAt: new Date().toISOString(),
    trigger: String(trigger || "manual"),
    batchId: credit.batchId || await activeSalesBatchId(admin),
    outstandingUploadedAt: tally.uploadedAt,
    outstandingHistoryKey: history.historyKey,
    receivablesSource: "tally_outstanding",
    tallyOutstanding: tally.total,
    asOfDate: asOf,
    creditSalesSource: credit.source,
    monthlyReceivables: history.monthlyReceivables,
    monthlyCreditSales: credit.monthlyCreditSales,
    scannedCount: tally.customerCount,
    failedCount: history.failedCount,
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
  filters = {},
} = {}) {
  const asOf = String(asOfDate || getKsaDateString()).slice(0, 10);
  const normalizedFilters = normalizeGrowthFilters(filters);
  const fieldFilters = hasReceivableFieldFilters(normalizedFilters);

  if (fieldFilters) {
    const outstandingDataset = await readSettingJson(admin, OUTSTANDING_DATASET_KEY);
    const credit = await loadMonthlyCreditSales(admin, normalizedFilters);
    const tally = tallyOutstandingFromDataset(
      outstandingDataset,
      normalizedFilters,
      credit.customerCodes,
    );
    const history = await outstandingUploadsByMonth(
      admin,
      tally,
      normalizedFilters,
      credit.customerCodes,
    );
    const report = buildReceivableDaysReport({
      monthlyCreditSales: credit.monthlyCreditSales,
      monthlyReceivables: history.monthlyReceivables,
      asOfDate: asOf,
      dateFrom,
      dateTo,
    });
    return {
      ...report,
      meta: {
        preparedAt: new Date().toISOString(),
        batchId: credit.batchId,
        outstandingUploadedAt: tally.uploadedAt,
        receivablesSource: "tally_outstanding",
        tallyOutstanding: tally.total,
        creditSalesSource: credit.source,
        scannedCount: tally.customerCount,
        failedCount: history.failedCount,
        rebuilt: false,
        filtered: true,
        source: "receivable_days_filtered",
      },
    };
  }

  const [batchId, outstandingDataset, cached] = await Promise.all([
    activeSalesBatchId(admin),
    readSettingJson(admin, OUTSTANDING_DATASET_KEY),
    readReceivableDaysDataset(admin),
  ]);
  const outstandingUploadedAt = String(outstandingDataset?.uploadedAt || "");
  let historyKey = "";
  try {
    const storedFiles = await listOutstandingStoredFiles(admin);
    historyKey = outstandingHistoryKey(planOutstandingMonthUploads(storedFiles, {
      uploadedAt: outstandingUploadedAt,
    }));
  } catch (error) {
    console.error("Receivable days: outstanding history check failed:", error);
    historyKey = cached?.outstandingHistoryKey || "unavailable";
  }
  let dataset = cached;
  let rebuilt = false;

  if (!receivableDaysDatasetIsFresh(dataset, { batchId, outstandingUploadedAt, outstandingHistoryKey: historyKey, asOfDate: asOf })) {
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
      filtered: false,
      source: "receivable_days_monthly_v1",
    },
  };
}
