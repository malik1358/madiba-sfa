import * as XLSX from "xlsx";
import {
  OUTSTANDING_DATASET_KEY,
  findOutstandingHeaderRow,
  mergeParsedOutstandingSheets,
  parseOutstandingRows,
  prioritizeOutstandingSheets,
  selectPreferredOutstandingParses,
} from "./outstanding.js";
import { UPLOAD_FILES_BUCKET, downloadStoredUpload } from "./uploadFilesStorage.js";

/** Uploads this small almost always wipe the company book (single-customer OS). */
export const PARTIAL_OUTSTANDING_ROW_CEILING = 25;

/** Prior book must be at least this large before we treat a tiny upload as a wipe. */
export const FULL_OUTSTANDING_ROW_FLOOR = 100;

/** Prefer stored workbooks larger than a single-customer OS (~9 KB). */
export const FULL_OUTSTANDING_FILE_MIN_BYTES = 50_000;

export function outstandingDatasetRowCount(parsed) {
  if (!parsed || typeof parsed !== "object") return 0;
  const rows = Array.isArray(parsed.rows) ? parsed.rows.length : 0;
  const invoices = Array.isArray(parsed.invoices) ? parsed.invoices.length : 0;
  return Math.max(rows, invoices > 0 ? new Set(
    (parsed.invoices || [])
      .map((invoice) => String(invoice?.customer_code || "").trim().toUpperCase())
      .filter(Boolean),
  ).size : 0);
}

export function isPartialOutstandingDataset(parsed) {
  const count = outstandingDatasetRowCount(parsed);
  return count > 0 && count <= PARTIAL_OUTSTANDING_ROW_CEILING;
}

export function shouldRejectOutstandingUpload(previousParsed, nextParsed) {
  const previousCount = outstandingDatasetRowCount(previousParsed);
  const nextCount = outstandingDatasetRowCount(nextParsed);
  if (previousCount < FULL_OUTSTANDING_ROW_FLOOR) return null;
  if (nextCount >= Math.max(PARTIAL_OUTSTANDING_ROW_CEILING + 1, Math.floor(previousCount * 0.2))) {
    return null;
  }
  return (
    `This file only has ${nextCount} customer${nextCount === 1 ? "" : "s"}, `
    + `but the current outstanding book has ${previousCount}. `
    + "Upload the full company outstanding sheet, not a single-customer OS."
  );
}

export function parseOutstandingWorkbookBytes(bytes, fileName = "outstanding.xlsx") {
  const workbook = XLSX.read(Buffer.from(bytes), { type: "buffer" });
  if (!Array.isArray(workbook.SheetNames) || workbook.SheetNames.length === 0) {
    throw new Error("Excel file does not contain any sheet.");
  }

  const candidateSheetNames = prioritizeOutstandingSheets(workbook.SheetNames);
  const parsedBySheetName = [];
  let workbookHasRows = false;

  for (const sheetName of candidateSheetNames) {
    const sheetRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
    if (Array.isArray(sheetRows) && sheetRows.length > 0) workbookHasRows = true;
    const sheetHeaderRowIndex = findOutstandingHeaderRow(sheetRows);
    if (sheetHeaderRowIndex < 0) continue;
    parsedBySheetName.push({
      sheetName,
      parsed: parseOutstandingRows(sheetRows, sheetHeaderRowIndex),
    });
  }

  if (!workbookHasRows) {
    throw new Error("Excel file is empty.");
  }

  const parsedSheets = selectPreferredOutstandingParses(parsedBySheetName);
  if (parsedSheets.length === 0) {
    throw new Error(`Unable to detect header row in ${fileName}.`);
  }

  return parsedSheets.length === 1
    ? parsedSheets[0]
    : mergeParsedOutstandingSheets(parsedSheets);
}

async function listOutstandingStoredFiles(admin) {
  const { data, error } = await admin.storage
    .from(UPLOAD_FILES_BUCKET)
    .list("outstanding", {
      limit: 40,
      sortBy: { column: "created_at", order: "desc" },
    });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

function storedFileSize(entry) {
  const metaSize = Number(entry?.metadata?.size);
  if (Number.isFinite(metaSize) && metaSize > 0) return metaSize;
  return Number(entry?.size) || 0;
}

/**
 * When a single-customer OS wiped the live book, re-parse the newest full
 * stored workbook and write it back to system_settings.
 */
export async function recoverPartialOutstandingDataset(admin, currentParsed = null) {
  if (!admin || !isPartialOutstandingDataset(currentParsed)) return null;

  const currentPath = String(currentParsed?.filePath || "").trim();
  const files = await listOutstandingStoredFiles(admin);
  const candidates = files
    .filter((entry) => {
      const name = String(entry?.name || "").trim();
      if (!name || name.endsWith("/")) return false;
      const path = `outstanding/${name}`;
      if (currentPath && path === currentPath) return false;
      return storedFileSize(entry) >= FULL_OUTSTANDING_FILE_MIN_BYTES;
    });

  for (const entry of candidates) {
    const filePath = `outstanding/${entry.name}`;
    const fileName = String(entry.name || "").replace(/^\d{4}-\d{2}-\d{2}T[^_]*_/, "") || entry.name;
    try {
      const blob = await downloadStoredUpload(admin, filePath);
      const bytes = Buffer.from(await blob.arrayBuffer());
      const parsed = parseOutstandingWorkbookBytes(bytes, fileName);
      if (isPartialOutstandingDataset({ rows: parsed.rows, invoices: parsed.invoices })) {
        continue;
      }

      const payload = {
        uploadedAt: String(currentParsed?.uploadedAt || new Date().toISOString()),
        fileName: String(fileName || entry.name).trim(),
        filePath,
        bucketLabels: parsed.bucketLabels,
        rows: parsed.rows,
        invoices: parsed.invoices,
        rowsCount: parsed.rows.length,
        recoveredFromPartialUpload: true,
        recoveredAt: new Date().toISOString(),
        recoveredFromFilePath: filePath,
        replacedFileName: String(currentParsed?.fileName || "").trim(),
        replacedFilePath: currentPath,
      };

      const { error: upsertError } = await admin
        .from("system_settings")
        .upsert({
          setting_key: OUTSTANDING_DATASET_KEY,
          setting_value: JSON.stringify(payload),
        }, { onConflict: "setting_key" });
      if (upsertError) throw upsertError;

      return payload;
    } catch (error) {
      console.error(`Unable to recover outstanding from ${filePath}:`, error);
    }
  }

  return null;
}
