import { normalizeImportHeader, parseImportNumber } from "./salesImportHeaders.js";

export const EOD_STOCK_DATASET_KEY = "eod_stock_citywise_v1";
export const EOD_STOCK_CITIES = ["riyadh", "dammam", "jeddah"];

const CITY_LABELS = {
  riyadh: "Riyadh",
  dammam: "Dammam",
  jeddah: "Jeddah",
};

const ITEM_CODE_HEADERS = ["item code", "product code", "stock code", "sku", "code", "itemcode"];
const ITEM_NAME_HEADERS = [
  "item name",
  "product name",
  "stock item",
  "name of item",
  "particulars",
  "item",
  "name",
  "product",
  "particular",
];
const UNIT_HEADERS = ["unit", "uom", "base unit", "stock unit"];
const QTY_HEADERS = [
  "closing qty",
  "closing quantity",
  "closing balance",
  "closing stock",
  "end qty",
  "eod qty",
  "stock qty",
  "qty",
  "quantity",
  "balance qty",
];
const VALUE_HEADERS = ["closing value", "stock value", "value", "amount"];
const CITY_COLUMN_HEADERS = ["city", "godown", "warehouse", "location", "branch", "godown name"];
const DATE_HEADERS = ["stock date", "as on", "as on date", "closing date", "date", "eod date"];

const MONTHS = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function pad(value) {
  return String(value).padStart(2, "0");
}

function isoDate(year, month, day) {
  let y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return "";
  if (y < 100) y += y < 70 ? 2000 : 1900;
  if (m < 1 || m > 12 || d < 1 || d > 31) return "";
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return "";
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function parseEodStockDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return isoDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  if (typeof value === "number" && value >= 40000 && value <= 60000) {
    const utc = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
    return isoDate(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
  }

  const text = String(value ?? "").trim();
  if (!text) return "";

  const isoMatch = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return isoDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));

  const found = [];
  for (const match of text.matchAll(/\b(\d{1,2})[\s\-/]+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,\-/]+(\d{2,4})\b/ig)) {
    found.push(isoDate(Number(match[3]), MONTHS[match[2].slice(0, 3).toLowerCase()], Number(match[1])));
  }
  for (const match of text.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-/]+(\d{1,2})(?:st|nd|rd|th)?[\s,\-/]+(\d{2,4})\b/ig)) {
    found.push(isoDate(Number(match[3]), MONTHS[match[1].slice(0, 3).toLowerCase()], Number(match[2])));
  }
  for (const match of text.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/g)) {
    const left = Number(match[1]);
    const right = Number(match[2]);
    const year = Number(match[3]);
    if (right > 12 && left >= 1 && left <= 12) found.push(isoDate(year, left, right));
    else if (left > 12 && right >= 1 && right <= 12) found.push(isoDate(year, right, left));
    else if (left >= 1 && left <= 12 && right >= 1 && right <= 12) found.push(isoDate(year, right, left));
  }

  const dates = found.filter(Boolean);
  return dates.length ? dates[dates.length - 1] : "";
}

export function normalizeEodCity(value) {
  const text = normalizeImportHeader(value);
  if (!text) return "";
  if (/\briyadh\b|\briyad\b|\bruh\b/.test(text)) return "riyadh";
  if (/\bdammam\b|\bdamman\b|\bdmm\b/.test(text)) return "dammam";
  if (/\bjeddah\b|\bjedda\b|\bjiddah\b|\bjed\b/.test(text)) return "jeddah";
  return "";
}

export function eodCityLabel(city) {
  return CITY_LABELS[city] || "";
}

export function roundEodQty(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 1e6) / 1e6;
}

export function formatEodQty(value) {
  const numeric = roundEodQty(value);
  return numeric.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

export function formatEodDelta(current, previous) {
  const diff = roundEodQty(Number(current) - Number(previous));
  if (!diff) return "";
  const text = formatEodQty(Math.abs(diff));
  return diff > 0 ? `+${text}` : `-${text}`;
}

export function eodQtyMovement(current, previous, hasPrevious) {
  if (!hasPrevious) return "current";
  const qty = roundEodQty(current);
  const prior = roundEodQty(previous);
  if (qty > prior) return "up";
  if (qty < prior) return "down";
  return "current";
}

function emptyCities() {
  return {
    riyadh: { qty: 0, value: 0 },
    dammam: { qty: 0, value: 0 },
    jeddah: { qty: 0, value: 0 },
  };
}

function headerIndex(headers, names) {
  const normalized = headers.map((header) => normalizeImportHeader(header));
  for (const name of names) {
    const wanted = normalizeImportHeader(name);
    const index = normalized.findIndex((header) => header === wanted);
    if (index >= 0) return index;
  }
  return -1;
}

function classifyCityHeader(header) {
  const norm = normalizeImportHeader(header);
  if (!norm || /\brate\b/.test(norm)) return null;
  const city = normalizeEodCity(norm);
  if (!city) return null;
  const measure = /\b(value|amount|amt)\b/.test(norm) && !/\b(qty|quantity)\b/.test(norm)
    ? "value"
    : "qty";
  const explicit = measure === "value" || /\b(qty|quantity|closing|balance|stock)\b/.test(norm);
  return { city, measure, explicit };
}

function selectCityColumns(headers) {
  const columns = headers
    .map((header, index) => {
      const classified = classifyCityHeader(header);
      return classified ? { index, ...classified } : null;
    })
    .filter(Boolean);

  const explicitQtyCities = new Set(
    columns.filter((column) => column.measure === "qty" && column.explicit).map((column) => column.city),
  );

  return columns.filter((column) => (
    column.measure === "value"
    || column.explicit
    || !explicitQtyCities.has(column.city)
  ));
}

function findEodHeaderRow(matrix, sheetName = "") {
  const sheetCity = normalizeEodCity(sheetName);
  let best = { index: -1, score: 0 };
  const limit = Math.min(matrix.length, 25);
  for (let index = 0; index < limit; index += 1) {
    const headers = (matrix[index] || []).map((cell) => String(cell ?? ""));
    const hasCode = headerIndex(headers, ITEM_CODE_HEADERS) >= 0;
    const hasName = headerIndex(headers, ITEM_NAME_HEADERS) >= 0;
    if (!hasCode && !hasName) continue;
    const cityColumns = selectCityColumns(headers);
    const hasCityQty = cityColumns.some((column) => column.measure === "qty");
    const hasCityColumn = headerIndex(headers, CITY_COLUMN_HEADERS) >= 0;
    const hasQty = headerIndex(headers, QTY_HEADERS) >= 0;
    if (!hasCityQty && !(hasCityColumn && hasQty) && !(sheetCity && hasQty)) continue;
    const score = 5 + (hasCode ? 2 : 0) + cityColumns.length + (hasQty ? 1 : 0);
    if (score > best.score) best = { index, score };
  }
  return best.index;
}

function findTitleCity(matrix, beforeIndex) {
  const limit = Math.min(Math.max(beforeIndex, 0), matrix.length);
  for (let index = 0; index < limit; index += 1) {
    for (const cell of matrix[index] || []) {
      const city = normalizeEodCity(cell);
      if (city) return city;
    }
  }
  return "";
}

function titleDate(matrix, headerIndexValue) {
  let found = "";
  for (let index = 0; index < headerIndexValue; index += 1) {
    for (const cell of matrix[index] || []) {
      const parsed = parseEodStockDate(cell);
      if (parsed) found = parsed;
    }
  }
  return found;
}

/** Tally Location Summary: Particulars in A, Quantity in B a few rows below, city in the title. */
function findTallyLocationLayout(matrix, sheetName = "") {
  const limit = Math.min(matrix.length, 30);
  let particularsRow = -1;
  let nameIndex = 0;
  for (let index = 0; index < limit; index += 1) {
    const row = matrix[index] || [];
    for (let column = 0; column < row.length; column += 1) {
      if (normalizeImportHeader(row[column]) === "particulars") {
        particularsRow = index;
        nameIndex = column;
        break;
      }
    }
    if (particularsRow >= 0) break;
  }
  if (particularsRow < 0) return null;

  let qtyRow = -1;
  let qtyIndex = -1;
  const qtySearchEnd = Math.min(particularsRow + 8, matrix.length - 1);
  for (let index = particularsRow; index <= qtySearchEnd; index += 1) {
    const row = matrix[index] || [];
    for (let column = 0; column < row.length; column += 1) {
      const label = normalizeImportHeader(row[column]);
      if (label !== "quantity" && label !== "qty") continue;
      if (qtyIndex < 0 || column === 1) {
        qtyRow = index;
        qtyIndex = column;
      }
      if (column === 1) break;
    }
    if (qtyIndex === 1) break;
  }
  if (qtyIndex < 0) return null;

  const city = normalizeEodCity(sheetName) || findTitleCity(matrix, particularsRow);
  if (!city) return null;

  return {
    headerRow: qtyRow,
    nameIndex,
    qtyIndex,
    city,
    particularsRow,
  };
}

export function splitEodItemLabel(value) {
  const text = String(value ?? "").trim();
  if (!text) return { code: "", name: "" };
  const match = text.match(/^([A-Za-z][A-Za-z0-9-]{2,30})_+\s*(.+)$/);
  if (match) {
    return {
      code: match[1].toUpperCase(),
      name: match[2].trim(),
    };
  }
  return { code: "", name: text };
}

export function parseEodQtyCell(value) {
  const qty = parseImportNumber(value);
  let unit = "";
  if (typeof value === "string") {
    const parts = value.trim().match(/[A-Za-z][A-Za-z./]*/g);
    if (parts?.length) unit = String(parts[parts.length - 1] || "").toUpperCase();
  }
  return { qty, unit };
}

function isTotalLabel(value) {
  const text = normalizeImportHeader(value);
  return text === "total" || text === "grand total" || text === "particulars" || text === "item name";
}

function addMeasure(target, measure, amount) {
  if (measure === "value") target.value = roundEodQty(target.value + amount);
  else target.qty = roundEodQty(target.qty + amount);
}

function parseEodStockMatrix(matrix, { sheetName = "" } = {}) {
  const rows = (Array.isArray(matrix) ? matrix : []).filter((row) => Array.isArray(row));
  let headerRow = findEodHeaderRow(rows, sheetName);
  const tallyLayout = headerRow < 0 ? findTallyLocationLayout(rows, sheetName) : null;
  if (headerRow < 0 && !tallyLayout) return { ok: false };
  if (tallyLayout) headerRow = tallyLayout.headerRow;

  const headers = (rows[headerRow] || []).map((cell) => String(cell ?? ""));
  const cityColumns = tallyLayout ? [] : selectCityColumns(headers);
  const codeIndex = tallyLayout ? -1 : headerIndex(headers, ITEM_CODE_HEADERS);
  const nameIndex = tallyLayout ? tallyLayout.nameIndex : headerIndex(headers, ITEM_NAME_HEADERS);
  const unitIndex = tallyLayout ? -1 : headerIndex(headers, UNIT_HEADERS);
  const cityIndex = tallyLayout ? -1 : headerIndex(headers, CITY_COLUMN_HEADERS);
  const qtyIndex = tallyLayout ? tallyLayout.qtyIndex : headerIndex(headers, QTY_HEADERS);
  const valueIndex = tallyLayout ? -1 : headerIndex(headers, VALUE_HEADERS);
  const dateIndex = tallyLayout ? -1 : headerIndex(headers, DATE_HEADERS);
  const sheetCity = tallyLayout
    ? tallyLayout.city
    : (cityColumns.some((column) => column.measure === "qty") ? "" : normalizeEodCity(sheetName));
  const wide = cityColumns.some((column) => column.measure === "qty");
  const long = !wide && (
    Boolean(tallyLayout)
    || (cityIndex >= 0 && (qtyIndex >= 0 || valueIndex >= 0))
    || (sheetCity && qtyIndex >= 0)
  );
  if (!wide && !long) return { ok: false };

  const items = new Map();
  const citiesPresent = new Set(wide ? cityColumns.filter((column) => column.measure === "qty").map((column) => column.city) : []);
  if (sheetCity) citiesPresent.add(sheetCity);
  let skippedZero = 0;
  let skippedUnknownCity = 0;
  let skippedOtherDates = 0;
  const body = rows.slice(headerRow + 1);
  let maxDate = "";
  body.forEach((row) => {
    const rowDate = dateIndex >= 0 ? parseEodStockDate(row[dateIndex]) : "";
    if (rowDate && (!maxDate || rowDate > maxDate)) maxDate = rowDate;
  });
  const stockDate = maxDate || titleDate(rows, Math.max(headerRow, tallyLayout?.particularsRow || 0));

  function ensureItem(code, name, unit) {
    const key = String(code || "").trim().toUpperCase() || String(name || "").trim().toUpperCase().replace(/\s+/g, " ");
    if (!key || isTotalLabel(key) || isTotalLabel(name)) return null;
    if (!items.has(key)) {
      items.set(key, {
        itemCode: key,
        itemName: String(name || code || key).trim() || key,
        unit: String(unit || "").trim().toUpperCase(),
        cities: emptyCities(),
      });
    }
    const item = items.get(key);
    if (name && (!item.itemName || item.itemName === item.itemCode)) item.itemName = String(name).trim() || item.itemName;
    if (!item.unit && unit) item.unit = String(unit).trim().toUpperCase();
    return item;
  }

  body.forEach((row) => {
    let code = codeIndex >= 0 ? row[codeIndex] : "";
    let name = nameIndex >= 0 ? row[nameIndex] : "";
    let unit = unitIndex >= 0 ? row[unitIndex] : "";
    if (tallyLayout || (codeIndex < 0 && nameIndex >= 0)) {
      const split = splitEodItemLabel(name || code);
      if (split.code) {
        code = split.code;
        name = split.name || name;
      }
    }
    const rowDate = dateIndex >= 0 ? parseEodStockDate(row[dateIndex]) : "";
    if (stockDate && rowDate && rowDate !== stockDate) {
      skippedOtherDates += 1;
      return;
    }
    if (wide) {
      const item = ensureItem(code, name, unit);
      if (!item) return;
      cityColumns.forEach((column) => {
        addMeasure(item.cities[column.city], column.measure, parseImportNumber(row[column.index]));
      });
      return;
    }

    const city = normalizeEodCity(cityIndex >= 0 ? row[cityIndex] : "") || sheetCity;
    if (!city) {
      if (String(code || name || "").trim()) skippedUnknownCity += 1;
      return;
    }
    citiesPresent.add(city);
    const qtyCell = qtyIndex >= 0 ? parseEodQtyCell(row[qtyIndex]) : { qty: 0, unit: "" };
    if (!unit && qtyCell.unit) unit = qtyCell.unit;
    const item = ensureItem(code, name, unit);
    if (!item) return;
    if (qtyIndex >= 0) addMeasure(item.cities[city], "qty", qtyCell.qty);
    if (valueIndex >= 0) addMeasure(item.cities[city], "value", parseImportNumber(row[valueIndex]));
  });

  const kept = [];
  items.forEach((item) => {
    const hasAmount = EOD_STOCK_CITIES.some((city) => item.cities[city].qty || item.cities[city].value);
    if (!hasAmount) {
      skippedZero += 1;
      return;
    }
    kept.push(item);
  });

  return {
    ok: kept.length > 0,
    rows: kept,
    citiesPresent: [...citiesPresent],
    stockDate,
    skippedZero,
    skippedUnknownCity,
    skippedOtherDates,
  };
}

function mergeParsedSheets(parsedSheets, fallbackDate) {
  const dated = parsedSheets.map((sheet) => sheet.stockDate).filter(Boolean).sort();
  const stockDate = dated.at(-1) || parseEodStockDate(fallbackDate);
  const used = parsedSheets.filter((sheet) => !sheet.stockDate || !stockDate || sheet.stockDate === stockDate);
  const skippedSheets = parsedSheets.length - used.length;
  const items = new Map();
  const citiesPresent = new Set();
  let skippedZero = 0;
  let skippedUnknownCity = 0;
  let skippedOtherDates = 0;

  used.forEach((sheet) => {
    skippedZero += sheet.skippedZero || 0;
    skippedUnknownCity += sheet.skippedUnknownCity || 0;
    skippedOtherDates += sheet.skippedOtherDates || 0;
    sheet.citiesPresent.forEach((city) => citiesPresent.add(city));
    sheet.rows.forEach((row) => {
      if (!items.has(row.itemCode)) {
        items.set(row.itemCode, {
          itemCode: row.itemCode,
          itemName: row.itemName,
          unit: row.unit,
          cities: emptyCities(),
        });
      }
      const target = items.get(row.itemCode);
      if (!target.itemName) target.itemName = row.itemName;
      if (!target.unit) target.unit = row.unit;
      EOD_STOCK_CITIES.forEach((city) => {
        target.cities[city].qty = roundEodQty(target.cities[city].qty + (row.cities[city]?.qty || 0));
        target.cities[city].value = roundEodQty(target.cities[city].value + (row.cities[city]?.value || 0));
      });
    });
  });

  const rows = [...items.values()]
    .filter((row) => EOD_STOCK_CITIES.some((city) => row.cities[city].qty || row.cities[city].value))
    .sort((a, b) => a.itemCode.localeCompare(b.itemCode));

  return {
    ok: rows.length > 0 && citiesPresent.size > 0 && Boolean(stockDate),
    rows,
    citiesPresent: EOD_STOCK_CITIES.filter((city) => citiesPresent.has(city)),
    stockDate,
    skippedZero,
    skippedUnknownCity,
    skippedOtherDates: skippedOtherDates + skippedSheets,
  };
}

export function parseEodStockSheets(sheets, { fallbackDate = "" } = {}) {
  const parsedSheets = (sheets || [])
    .map((sheet) => parseEodStockMatrix(sheet?.matrix, { sheetName: sheet?.name || "" }))
    .filter((sheet) => sheet.ok);
  if (!parsedSheets.length) {
    return {
      ok: false,
      error: "No end-of-day stock rows found. Use an item code or name, and Riyadh, Dammam, and Jeddah quantities, or a City / Godown column.",
    };
  }
  const merged = mergeParsedSheets(parsedSheets, fallbackDate);
  if (!merged.ok) {
    return {
      ok: false,
      error: "The file has stock rows, but no stock date. Add a Stock Date column or choose the stock date before uploading.",
    };
  }
  return merged;
}

function copyCities(cities = {}) {
  const next = emptyCities();
  EOD_STOCK_CITIES.forEach((city) => {
    next[city] = {
      qty: roundEodQty(cities?.[city]?.qty || 0),
      value: roundEodQty(cities?.[city]?.value || 0),
    };
  });
  return next;
}

function mergeStockRows(baseRows, incomingRows, citiesPresent) {
  const base = new Map((baseRows || []).map((row) => [row.itemCode, row]));
  const incoming = new Map((incomingRows || []).map((row) => [row.itemCode, row]));
  const present = new Set(citiesPresent || []);
  const rows = [];

  for (const code of new Set([...base.keys(), ...incoming.keys()])) {
    const fromBase = base.get(code);
    const fromIncoming = incoming.get(code);
    const cities = emptyCities();
    EOD_STOCK_CITIES.forEach((city) => {
      const source = present.has(city) ? fromIncoming : fromBase;
      cities[city] = {
        qty: roundEodQty(source?.cities?.[city]?.qty || 0),
        value: roundEodQty(source?.cities?.[city]?.value || 0),
      };
    });
    if (!EOD_STOCK_CITIES.some((city) => cities[city].qty || cities[city].value)) continue;
    rows.push({
      itemCode: code,
      itemName: fromIncoming?.itemName || fromBase?.itemName || code,
      unit: fromIncoming?.unit || fromBase?.unit || "",
      cities,
    });
  }

  rows.sort((a, b) => a.itemCode.localeCompare(b.itemCode));
  return rows;
}

export function applyEodStockUpload(previousDataset, parsed) {
  const previous = previousDataset && typeof previousDataset === "object" ? previousDataset : {};
  const stockDate = parsed.stockDate;
  const fullFile = EOD_STOCK_CITIES.every((city) => parsed.citiesPresent.includes(city));
  const canCarryCities = Boolean(previous.stockDate) && stockDate >= previous.stockDate && !fullFile;
  const baseRows = canCarryCities ? (previous.rows || []) : [];
  let previousStockDate = "";
  let previousRows = [];

  if (previous.stockDate && stockDate > previous.stockDate) {
    previousStockDate = previous.stockDate;
    previousRows = previous.rows || [];
  } else if (previous.stockDate && stockDate === previous.stockDate) {
    previousStockDate = previous.previousStockDate || "";
    previousRows = previous.previousRows || [];
  }

  return {
    stockDate,
    previousStockDate,
    rows: mergeStockRows(baseRows, parsed.rows, parsed.citiesPresent),
    previousRows: previousStockDate ? previousRows.map((row) => ({
      itemCode: row.itemCode,
      itemName: row.itemName,
      unit: row.unit || "",
      cities: copyCities(row.cities),
    })) : [],
    citiesPresent: parsed.citiesPresent,
  };
}

export function readEodStockDataset(value) {
  const parsed = typeof value === "string" ? JSON.parse(value || "null") : value;
  if (!parsed || typeof parsed !== "object") return null;
  return parsed;
}

export function summarizeEodStock(dataset) {
  const source = dataset && typeof dataset === "object" ? dataset : {};
  const totals = {
    riyadh: { qty: 0, value: 0 },
    dammam: { qty: 0, value: 0 },
    jeddah: { qty: 0, value: 0 },
  };
  (source.rows || []).forEach((row) => {
    EOD_STOCK_CITIES.forEach((city) => {
      totals[city].qty = roundEodQty(totals[city].qty + (row.cities?.[city]?.qty || 0));
      totals[city].value = roundEodQty(totals[city].value + (row.cities?.[city]?.value || 0));
    });
  });
  return {
    stockDate: source.stockDate || "",
    previousStockDate: source.previousStockDate || "",
    uploadedAt: source.uploadedAt || "",
    fileName: source.fileName || "",
    canDownload: Boolean(String(source.filePath || "").trim()),
    itemCount: Array.isArray(source.rows) ? source.rows.length : 0,
    cities: totals,
  };
}

export function buildEodStockReportRows(dataset) {
  const source = dataset && typeof dataset === "object" ? dataset : {};
  const hasPrevious = Boolean(source.previousStockDate);
  const previous = new Map((hasPrevious ? source.previousRows || [] : []).map((row) => [row.itemCode, row]));
  const current = new Map((source.rows || []).map((row) => [row.itemCode, row]));
  const codes = new Set([...current.keys(), ...(hasPrevious ? previous.keys() : [])]);
  const rows = [];

  codes.forEach((code) => {
    const row = current.get(code);
    const prior = previous.get(code);
    const entry = {
      itemCode: code,
      itemName: row?.itemName || prior?.itemName || code,
      unit: row?.unit || prior?.unit || "",
      total: 0,
      totalPrev: 0,
    };
    EOD_STOCK_CITIES.forEach((city) => {
      const qty = roundEodQty(row?.cities?.[city]?.qty || 0);
      const prev = roundEodQty(prior?.cities?.[city]?.qty || 0);
      entry[city] = qty;
      entry[`${city}Prev`] = prev;
      entry[`${city}Value`] = roundEodQty(row?.cities?.[city]?.value || 0);
      entry.total = roundEodQty(entry.total + qty);
      entry.totalPrev = roundEodQty(entry.totalPrev + prev);
    });
    rows.push(entry);
  });

  rows.sort((a, b) => a.itemCode.localeCompare(b.itemCode));
  return rows;
}

export function eodStockTemplateMatrix() {
  return [
    ["Item Code", "Item Name", "Unit", "Riyadh Qty", "Dammam Qty", "Jeddah Qty", "Riyadh Value", "Dammam Value", "Jeddah Value", "Stock Date"],
    ["LP00318", "Latex gloves", "CTN", 12, 4, 0, 1500, 500, 0, "2026-10-26"],
    ["AB100", "A4 paper", "CTN", 30, 18, 9, 900, 540, 270, "2026-10-26"],
  ];
}

function emptyCityQtyMaps() {
  return {
    riyadh: {},
    dammam: {},
    jeddah: {},
  };
}

/** Compact city→item→qty map for pricing cache / offline order hints. Keeps the last upload until a newer file replaces it. */
export function buildEodStockAvailability(dataset) {
  const source = dataset && typeof dataset === "object" ? dataset : null;
  const stockDate = String(source?.stockDate || "").trim();
  const uploadedAt = String(source?.uploadedAt || "").trim();
  if (!source || !/^\d{4}-\d{2}-\d{2}$/.test(stockDate) || !Array.isArray(source.rows) || source.rows.length === 0) {
    return {
      stockDate: "",
      uploadedAt: "",
      byCity: emptyCityQtyMaps(),
      active: false,
    };
  }

  const byCity = emptyCityQtyMaps();
  source.rows.forEach((row) => {
    const code = String(row?.itemCode || row?.item_code || "").trim().toUpperCase();
    if (!code) return;
    EOD_STOCK_CITIES.forEach((city) => {
      const qty = Math.max(0, roundEodQty(row?.cities?.[city]?.qty || 0));
      if (!qty) return;
      byCity[city][code] = roundEodQty((byCity[city][code] || 0) + qty);
    });
  });

  return {
    stockDate,
    uploadedAt,
    byCity,
    active: true,
  };
}

export function normalizeEodStockAvailability(value) {
  if (!value || typeof value !== "object") {
    return { stockDate: "", uploadedAt: "", byCity: emptyCityQtyMaps(), active: false };
  }
  if (value.active === false) {
    return { stockDate: "", uploadedAt: "", byCity: emptyCityQtyMaps(), active: false };
  }
  const stockDate = String(value.stockDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stockDate)) {
    return { stockDate: "", uploadedAt: "", byCity: emptyCityQtyMaps(), active: false };
  }
  const byCity = emptyCityQtyMaps();
  EOD_STOCK_CITIES.forEach((city) => {
    const source = value.byCity?.[city] && typeof value.byCity[city] === "object" ? value.byCity[city] : {};
    Object.entries(source).forEach(([rawCode, rawQty]) => {
      const code = String(rawCode || "").trim().toUpperCase();
      const qty = Math.max(0, roundEodQty(rawQty));
      if (!code || !qty) return;
      byCity[city][code] = qty;
    });
  });
  return {
    stockDate,
    uploadedAt: String(value.uploadedAt || "").trim(),
    byCity,
    active: true,
  };
}

/** Prefer upload time; otherwise start of the stock date in Asia/Riyadh. */
export function eodStockReferenceTimeMs(availability) {
  const stock = availability && typeof availability === "object" ? availability : {};
  const uploaded = Date.parse(String(stock.uploadedAt || "").trim());
  if (Number.isFinite(uploaded)) return uploaded;
  const stockDate = String(stock.stockDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stockDate)) return NaN;
  return Date.parse(`${stockDate}T00:00:00+03:00`);
}

export function isEodStockOlderThanHours(availability, hours = 24, nowMs = Date.now()) {
  const stock = normalizeEodStockAvailability(availability);
  if (!stock.active) return false;
  const referenceMs = eodStockReferenceTimeMs(stock);
  if (!Number.isFinite(referenceMs)) return false;
  const limitMs = Math.max(0, Number(hours) || 0) * 3600 * 1000;
  return (Number(nowMs) - referenceMs) > limitMs;
}

export function formatEodStockAsOfDate(stockDate, language = "en") {
  const text = String(stockDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleDateString(language === "ar" ? "ar-SA" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Riyadh",
  });
}

/**
 * Available order qty for an item in a pricing region.
 * Returns null when no end-of-day stock snapshot is loaded (no stock hint).
 * Returns 0 when stock is loaded but the item has no positive qty in that city.
 */
export function availableEodStockQty(availability, pricingRegion, itemCode) {
  const stock = normalizeEodStockAvailability(availability);
  if (!stock.active) return null;
  const city = String(pricingRegion || "").trim().toLowerCase();
  if (!EOD_STOCK_CITIES.includes(city)) return null;
  const code = String(itemCode || "").trim().toUpperCase();
  if (!code) return 0;
  return Math.max(0, roundEodQty(stock.byCity?.[city]?.[code] || 0));
}

export function isEodStockQtyOverAvailable(orderedQty, available) {
  if (available == null) return false;
  const qty = Number(orderedQty || 0);
  return Number.isFinite(qty) && qty > available;
}

/**
 * Label beside order qty. Keeps the last uploaded stock qty until a newer import replaces it.
 * Shows the stock date when that snapshot is older than 24 hours. Warns when ordered qty exceeds available.
 */
export function formatEodStockAvailableLabel(available, language = "en", orderedQty = null, availability = null, nowMs = Date.now()) {
  if (available == null) return "";
  const qtyText = formatEodQty(available);
  const stock = normalizeEodStockAvailability(availability);
  const stale = isEodStockOlderThanHours(stock, 24, nowMs);
  const asOf = stale ? formatEodStockAsOfDate(stock.stockDate, language) : "";
  const over = isEodStockQtyOverAvailable(orderedQty, available);

  if (language === "ar") {
    let label = asOf ? `المتاح: ${qtyText} · ${asOf}` : `المتاح: ${qtyText}`;
    if (over) label = `${label} — أكثر من المخزون`;
    return label;
  }

  let label = asOf ? `Available: ${qtyText} · ${asOf}` : `Available: ${qtyText}`;
  if (over) label = `${label} — over stock`;
  return label;
}
