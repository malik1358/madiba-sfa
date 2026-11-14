import * as XLSX from "xlsx";
import {
  EOD_STOCK_CITIES,
  EOD_STOCK_LOCATIONS,
  applyEodStockUpload,
  emptyEodCityUploads,
  inferEodCityFromFileName,
  mergeEodCityUploads,
  parseEodStockSheets,
  readEodCityUploads,
  summarizeEodStock,
} from "./eodStock.js";
import { UPLOAD_FILES_BUCKET, downloadStoredUpload } from "./uploadFilesStorage.js";
import { getKsaDateString } from "./workdayActivity.js";

function positiveCityItemCounts(rows) {
  const counts = { riyadh: 0, dammam: 0, jeddah: 0, store: 0 };
  EOD_STOCK_LOCATIONS.forEach((city) => {
    counts[city] = (rows || []).reduce((total, row) => (
      Number(row?.cities?.[city]?.qty || 0) > 0 ? total + 1 : total
    ), 0);
  });
  return counts;
}

export async function listRecentEodStockStorageFiles(admin, { limit = 100 } = {}) {
  const { data, error } = await admin.storage.from(UPLOAD_FILES_BUCKET).list("eod-stock", {
    limit,
    sortBy: { column: "created_at", order: "desc" },
  });
  if (error) throw error;
  return (data || [])
    .filter((entry) => entry?.name && !String(entry.name).endsWith("/"))
    .map((entry) => {
      const fileName = String(entry.name || "").trim();
      return {
        fileName,
        filePath: `eod-stock/${fileName}`,
        uploadedAt: String(entry.created_at || entry.updated_at || "").trim(),
        city: inferEodCityFromFileName(fileName),
      };
    });
}

export async function discoverEodCityUploadsFromStorage(admin, dataset = {}) {
  const existing = readEodCityUploads(dataset?.cityUploads);
  const discovered = emptyEodCityUploads();
  let files = [];
  try {
    files = await listRecentEodStockStorageFiles(admin, { limit: 120 });
  } catch (error) {
    console.error("Could not list end-of-day stock files:", error);
    return existing;
  }

  for (const file of files) {
    if (!file.city || discovered[file.city]) continue;
    discovered[file.city] = {
      fileName: file.fileName,
      filePath: file.filePath,
      uploadedAt: file.uploadedAt,
      stockDate: "",
      itemCount: 0,
      canDownload: Boolean(file.filePath),
    };
  }

  const merged = emptyEodCityUploads();
  EOD_STOCK_LOCATIONS.forEach((city) => {
    merged[city] = existing[city] || discovered[city] || null;
  });
  return merged;
}

async function parseStoredEodStockFile(admin, filePath, fallbackDate) {
  const blob = await downloadStoredUpload(admin, filePath);
  const buffer = Buffer.from(await blob.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheets = (workbook.SheetNames || []).map((name) => ({
    name,
    matrix: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: "", raw: true }),
  }));
  return parseEodStockSheets(sheets, { fallbackDate });
}

/**
 * Rebuild missing city qty from the latest stored one-city Excel when the snapshot
 * lost sibling cities (legacy date-gated merge) but the file is still in storage.
 */
export async function repairEodStockDatasetFromCityFiles(admin, dataset) {
  const source = dataset && typeof dataset === "object" ? dataset : {};
  let cityUploads = await discoverEodCityUploadsFromStorage(admin, source);
  let next = {
    ...source,
    cityUploads,
  };
  const counts = positiveCityItemCounts(next.rows);
  const fallbackDate = getKsaDateString();
  let repairedCities = [];
  // Legacy date-gated merges could leave a city nearly empty (1 plywood line) while
  // the real one-city Excel is still in storage — re-apply when the city looks thin.
  const thinCityThreshold = 25;

  for (const city of EOD_STOCK_LOCATIONS) {
    // Store can be sparse; still re-parse when missing. City warehouses use the thin threshold.
    const threshold = city === "store" ? 1 : thinCityThreshold;
    if ((counts[city] || 0) >= threshold) continue;
    const upload = cityUploads[city];
    if (!upload?.filePath) continue;

    let parsed;
    try {
      parsed = await parseStoredEodStockFile(admin, upload.filePath, fallbackDate);
    } catch (error) {
      console.error(`Could not parse stored ${city} end-of-day stock file:`, error);
      continue;
    }
    if (!parsed?.ok || !(parsed.citiesPresent || []).includes(city)) continue;

    const applied = applyEodStockUpload(next, parsed);
    const itemCounts = positiveCityItemCounts(applied.rows);
    cityUploads = mergeEodCityUploads(cityUploads, parsed.citiesPresent, {
      fileName: upload.fileName,
      filePath: upload.filePath,
      uploadedAt: upload.uploadedAt || next.uploadedAt || new Date().toISOString(),
      stockDate: applied.stockDate,
      itemCounts,
    });
    next = {
      ...next,
      stockDate: applied.stockDate,
      previousStockDate: applied.previousStockDate,
      rows: applied.rows,
      previousRows: applied.previousRows,
      citiesPresent: applied.citiesPresent,
      cityUploads,
    };
    repairedCities.push(city);
  }

  // Persist discovered download pointers even when qty did not need repair.
  const summary = summarizeEodStock(next);
  const pointersChanged = EOD_STOCK_LOCATIONS.some((city) => {
    const before = readEodCityUploads(source.cityUploads)[city];
    const after = summary.cityUploads?.[city];
    return String(before?.filePath || "") !== String(after?.filePath || "");
  });

  return {
    dataset: {
      ...next,
      cityUploads: summary.cityUploads,
    },
    repairedCities,
    changed: repairedCities.length > 0 || pointersChanged,
    summary,
  };
}
