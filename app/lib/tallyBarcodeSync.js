import { parseCsvToRows } from "./pricePayload.js";
import { normalizeItemCode } from "./tallyItemUnits.js";

export const TALLY_BARCODE_SHEET_ID = "1vXUem61icj7Gv8wBNx5_Sc-oXNDm-wZiLZCjTjGtXww";
export const TALLY_BARCODE_SHEET_GID = "612911319";
/** Column AP is the master barcode on the price sheet. */
export const TALLY_BARCODE_COLUMN_INDEX = 41;
export const TALLY_BARCODE_SYNC_HOURS = 8;

export function tallyBarcodeSheetUrl(
  sheetId = TALLY_BARCODE_SHEET_ID,
  sheetGid = TALLY_BARCODE_SHEET_GID,
) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${sheetGid}`;
}

function headerKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeTallyBarcode(value) {
  const digits = String(value || "").replace(/\s+/g, "").trim();
  if (!/^\d{8,18}$/.test(digits)) return "";
  return digits;
}

export function parseTallyBarcodeRows(matrix = []) {
  const rows = Array.isArray(matrix) ? matrix : [];
  let headerIndex = -1;
  let codeIndex = 1;

  for (let index = 0; index < Math.min(rows.length, 20); index += 1) {
    const row = rows[index] || [];
    const productIndex = row.findIndex((cell) => headerKey(cell) === "product code");
    const barcodeHeader = headerKey(row[TALLY_BARCODE_COLUMN_INDEX]);
    if (productIndex >= 0 && barcodeHeader.includes("barcode")) {
      headerIndex = index;
      codeIndex = productIndex;
      break;
    }
  }

  if (headerIndex < 0) return [];

  const byCode = new Map();
  rows.slice(headerIndex + 1).forEach((row) => {
    const itemCode = normalizeItemCode(row?.[codeIndex]);
    const barcode = normalizeTallyBarcode(row?.[TALLY_BARCODE_COLUMN_INDEX]);
    if (!itemCode || !barcode) return;
    byCode.set(itemCode, barcode);
  });

  return [...byCode.entries()].map(([item_code, tally_barcode]) => ({
    item_code,
    tally_barcode,
  }));
}

export function parseTallyBarcodeCsv(csvText) {
  return parseTallyBarcodeRows(parseCsvToRows(csvText));
}

export async function fetchTallyBarcodeSheetCsv() {
  const response = await fetch(tallyBarcodeSheetUrl(), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Barcode sheet download failed (${response.status}).`);
  }
  const text = await response.text();
  if (!text || /<html/i.test(text.slice(0, 200))) {
    throw new Error("Barcode sheet did not return a CSV.");
  }
  return text;
}

function isMissingBarcodeColumn(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return message.includes("tally_barcode");
}

async function loadExistingItemCodes(admin) {
  const existingByUpper = new Map();
  let from = 0;
  const pageSize = 1000;

  for (;;) {
    const { data, error } = await admin
      .from("items_master")
      .select("item_code")
      .range(from, from + pageSize - 1);

    if (error) throw error;
    const page = data || [];
    page.forEach((row) => {
      const code = String(row.item_code || "").trim();
      if (!code) return;
      existingByUpper.set(normalizeItemCode(code), code);
    });
    if (page.length < pageSize) break;
    from += pageSize;
  }

  return existingByUpper;
}

export async function applyTallyBarcodeUpdates(admin, rows = []) {
  const byCode = new Map();
  (rows || []).forEach((row) => {
    const itemCode = normalizeItemCode(row?.item_code);
    const barcode = normalizeTallyBarcode(row?.tally_barcode);
    if (!itemCode || !barcode) return;
    byCode.set(itemCode, barcode);
  });

  if (!byCode.size) {
    return { updated: 0, skipped: 0 };
  }

  const existingByUpper = await loadExistingItemCodes(admin);
  const nowIso = new Date().toISOString();
  const updates = [];
  let skipped = 0;

  byCode.forEach((barcode, upperCode) => {
    const existingCode = existingByUpper.get(upperCode);
    if (!existingCode) {
      skipped += 1;
      return;
    }
    updates.push({
      item_code: existingCode,
      tally_barcode: barcode,
      tally_barcode_synced_at: nowIso,
    });
  });

  for (let index = 0; index < updates.length; index += 100) {
    const chunk = updates.slice(index, index + 100);
    const { error } = await admin
      .from("items_master")
      .upsert(chunk, { onConflict: "item_code" });
    if (error) {
      if (isMissingBarcodeColumn(error)) {
        throw new Error("Run sql/setup_tally_item_barcodes.sql in Supabase to store item barcodes.");
      }
      throw error;
    }
  }

  return { updated: updates.length, skipped };
}

export async function syncTallyBarcodes(admin, { csvText = "" } = {}) {
  const text = csvText || await fetchTallyBarcodeSheetCsv();
  const parsed = parseTallyBarcodeCsv(text);
  if (!parsed.length) {
    throw new Error("No master barcodes found in price sheet column AP.");
  }
  const result = await applyTallyBarcodeUpdates(admin, parsed);
  return {
    parsed: parsed.length,
    ...result,
    syncedAt: new Date().toISOString(),
  };
}
