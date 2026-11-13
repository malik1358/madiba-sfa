import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import {
  fetchItemMasterAnalysisFromPowerBi,
  getPowerBiConfig,
} from "./powerBiClient.js";

export const ITEM_MASTER_ANALYSIS_SYNC_SETTING_KEY = "item_master_analysis_sync_v1";
export const ITEM_MASTER_ANALYSIS_TABLE = "item_master_analysis";
const INSERT_CHUNK = 500;

export function normalizeText(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").trim();
}

export function normalizeCode(value) {
  return normalizeText(value).toUpperCase();
}

export function parseAltUomConv(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = normalizeText(value).replace(/,/g, "");
  if (!text) return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

function normalizeHeaderKey(key) {
  return normalizeText(key)
    .toLowerCase()
    .replace(/[\[\]]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Map a Power BI / Excel row object onto mirror columns using flexible header matching.
 */
export function mapRawItemMasterRow(raw = {}) {
  const entries = Object.entries(raw || {}).map(([key, value]) => [normalizeHeaderKey(key), value]);
  const byKey = new Map(entries);

  function pick(...candidates) {
    for (const candidate of candidates) {
      const needle = normalizeHeaderKey(candidate);
      if (byKey.has(needle)) return byKey.get(needle);
      for (const [key, value] of byKey) {
        if (key.endsWith(needle) || key.includes(needle)) return value;
      }
    }
    return "";
  }

  const tallyItemCode = normalizeCode(
    pick(
      "mst_stock_item[item code]",
      "mst_stock_item.item code",
      "item code",
      "tally item code",
      "tally_item_code",
    ),
  );
  const googleArticleNo = normalizeCode(
    pick(
      "item master (google sheet)[article no]",
      "article no",
      "google sheet item code",
      "google_article_no",
    ),
  );

  return {
    import_or_local: normalizeText(
      pick(
        "item master (google sheet)[import or local]",
        "import or local",
        "g_import/export",
        "import_or_local",
      ),
    ),
    main_group: normalizeText(
      pick("item master (google sheet)[main group]", "main group", "g_main group", "main_group"),
    ),
    sub_group: normalizeText(
      pick("item master (google sheet)[sub group]", "sub group", "g_sub group", "sub_group"),
    ),
    category: normalizeText(
      pick("item master (google sheet)[category]", "category", "g_category"),
    ),
    tally_item_code: tallyItemCode,
    tally_item_name: normalizeText(
      pick(
        "mst_stock_item[item_name]",
        "mst_stock_item[item name]",
        "item_name",
        "tally item name",
        "tally_item_name",
      ),
    ),
    google_article_no: googleArticleNo,
    google_article_common_name: normalizeText(
      pick(
        "item master (google sheet)[article common name]",
        "article common name",
        "google sheet item common name",
        "google_article_common_name",
      ),
    ),
    brand_name: normalizeText(
      pick("item master (google sheet)[brand name]", "brand name", "brand_name"),
    ),
    tally_base_uom: normalizeText(
      pick("mst_stock_item[uom]", "uom", "t_base uom", "tally_base_uom"),
    ),
    tally_alt_uom: normalizeText(
      pick(
        "mst_stock_item[alternate_uom]",
        "alternate_uom",
        "t_alt uom",
        "tally_alt_uom",
      ),
    ),
    tally_alt_uom_conv: parseAltUomConv(
      pick(
        "alt_uom_conv",
        "[alt_uom_conv]",
        "sum(mst_stock_item.alt_uom_conv)",
        "t_alt uom conv",
        "tally_alt_uom_conv",
      ),
    ),
  };
}

export function buildItemMasterRowKey(row) {
  const parts = [
    normalizeCode(row.tally_item_code),
    normalizeCode(row.google_article_no),
    normalizeText(row.tally_item_name).toLowerCase(),
    normalizeText(row.google_article_common_name).toLowerCase(),
    normalizeText(row.import_or_local).toLowerCase(),
    normalizeText(row.category).toLowerCase(),
    normalizeText(row.tally_base_uom).toLowerCase(),
    normalizeText(row.tally_alt_uom).toLowerCase(),
    row.tally_alt_uom_conv == null ? "" : String(row.tally_alt_uom_conv),
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export function mapRawRowsToMirrorRows(rawRows, syncedAt = new Date().toISOString()) {
  const byKey = new Map();
  for (const raw of Array.isArray(rawRows) ? rawRows : []) {
    const mapped = mapRawItemMasterRow(raw);
    if (!mapped.tally_item_code && !mapped.google_article_no && !mapped.tally_item_name) {
      continue;
    }
    const row_key = buildItemMasterRowKey(mapped);
    byKey.set(row_key, {
      ...mapped,
      row_key,
      synced_at: syncedAt,
    });
  }
  return [...byKey.values()];
}

/**
 * Parse the first worksheet of a Power BI XLSX export into raw row objects.
 */
export function parseItemMasterExportWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheetName = workbook.SheetNames?.[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
  return Array.isArray(rows) ? rows : [];
}

async function readSyncStamp(admin) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", ITEM_MASTER_ANALYSIS_SYNC_SETTING_KEY)
    .maybeSingle();
  if (error) throw new Error(`system_settings read failed: ${error.message}`);
  return data?.setting_value && typeof data.setting_value === "object"
    ? data.setting_value
    : null;
}

async function writeSyncStamp(admin, stamp) {
  const { error } = await admin.from("system_settings").upsert(
    {
      setting_key: ITEM_MASTER_ANALYSIS_SYNC_SETTING_KEY,
      setting_value: stamp,
    },
    { onConflict: "setting_key" },
  );
  if (error) throw new Error(`system_settings write failed: ${error.message}`);
}

async function replaceMirrorRows(admin, rows) {
  const { error: deleteError } = await admin
    .from(ITEM_MASTER_ANALYSIS_TABLE)
    .delete()
    .neq("id", 0);
  if (deleteError) {
    throw new Error(`item_master_analysis clear failed: ${deleteError.message}`);
  }

  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK);
    const { error: insertError } = await admin
      .from(ITEM_MASTER_ANALYSIS_TABLE)
      .insert(chunk);
    if (insertError) {
      throw new Error(`item_master_analysis insert failed: ${insertError.message}`);
    }
  }
}

export async function loadItemMasterAnalysisReport(admin) {
  const [{ data, error }, stamp] = await Promise.all([
    admin
      .from(ITEM_MASTER_ANALYSIS_TABLE)
      .select(
        [
          "row_key",
          "import_or_local",
          "main_group",
          "sub_group",
          "category",
          "tally_item_code",
          "tally_item_name",
          "google_article_no",
          "google_article_common_name",
          "brand_name",
          "tally_base_uom",
          "tally_alt_uom",
          "tally_alt_uom_conv",
          "synced_at",
        ].join(","),
      )
      .order("tally_item_code", { ascending: true })
      .order("google_article_no", { ascending: true }),
    readSyncStamp(admin),
  ]);

  if (error) {
    if (/relation .*item_master_analysis.* does not exist|Could not find the table/i.test(error.message)) {
      throw new Error(
        "item_master_analysis is not migrated yet. Apply supabase/migrations/20261113140000_item_master_analysis.sql in Supabase.",
      );
    }
    throw new Error(`item_master_analysis read failed: ${error.message}`);
  }

  const rows = (data || []).map((row) => ({
    rowKey: row.row_key,
    importOrLocal: row.import_or_local || "",
    mainGroup: row.main_group || "",
    subGroup: row.sub_group || "",
    category: row.category || "",
    tallyItemCode: row.tally_item_code || "",
    tallyItemName: row.tally_item_name || "",
    googleArticleNo: row.google_article_no || "",
    googleArticleCommonName: row.google_article_common_name || "",
    brandName: row.brand_name || "",
    tallyBaseUom: row.tally_base_uom || "",
    tallyAltUom: row.tally_alt_uom || "",
    tallyAltUomConv: row.tally_alt_uom_conv == null ? null : Number(row.tally_alt_uom_conv),
    syncedAt: row.synced_at || null,
  }));

  return {
    rows,
    rowCount: rows.length,
    sync: stamp,
  };
}

export async function syncItemMasterAnalysis(admin, {
  fetchImpl = fetch,
  config = getPowerBiConfig(),
  now = new Date(),
} = {}) {
  const syncedAt = now.toISOString();
  let source = "executeQueries";
  let rawRows = [];

  try {
    const fetched = await fetchItemMasterAnalysisFromPowerBi({
      config,
      fetchImpl,
      parseExportWorkbook: parseItemMasterExportWorkbook,
    });
    source = fetched.source || "executeQueries";
    rawRows = fetched.rows || [];
  } catch (error) {
    const failedStamp = {
      ok: false,
      source: null,
      rowCount: 0,
      syncedAt,
      error: String(error?.message || error || "Power BI sync failed"),
    };
    try {
      await writeSyncStamp(admin, failedStamp);
    } catch {
      // Prefer the original Power BI error.
    }
    throw error;
  }

  const mirrorRows = mapRawRowsToMirrorRows(rawRows, syncedAt);
  await replaceMirrorRows(admin, mirrorRows);

  const stamp = {
    ok: true,
    source,
    rowCount: mirrorRows.length,
    syncedAt,
    error: null,
  };
  await writeSyncStamp(admin, stamp);

  return {
    success: true,
    ...stamp,
  };
}
