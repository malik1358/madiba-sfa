import { normalizeImportHeader, parseImportNumber } from "./salesImportHeaders.js";
import {
  formatMasterStockQty,
  lookupMasterUnitConv,
  resolveEodStockMasterDisplay,
} from "./masterUnitQty.js";

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

/** Tally Location Summary: Particulars in A, Closing Balance Quantity a few rows below, city in the title. */
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

  const qtySearchEnd = Math.min(particularsRow + 8, matrix.length - 1);
  let closingStart = -1;
  let closingEnd = -1;
  for (let index = particularsRow; index <= qtySearchEnd; index += 1) {
    const row = matrix[index] || [];
    for (let column = 0; column < row.length; column += 1) {
      if (normalizeImportHeader(row[column]) !== "closing balance") continue;
      closingStart = column;
      closingEnd = row.length - 1;
      for (let next = column + 1; next < row.length; next += 1) {
        const label = normalizeImportHeader(row[next]);
        if (!label) continue;
        if (
          label === "opening balance"
          || label === "inwards"
          || label === "outwards"
          || label === "closing balance"
          || label.endsWith(" balance")
        ) {
          closingEnd = next - 1;
          break;
        }
      }
    }
  }

  const qtyCandidates = [];
  for (let index = particularsRow; index <= qtySearchEnd; index += 1) {
    const row = matrix[index] || [];
    for (let column = 0; column < row.length; column += 1) {
      const label = normalizeImportHeader(row[column]);
      if (label !== "quantity" && label !== "qty") continue;
      qtyCandidates.push({ row: index, column });
    }
  }
  if (!qtyCandidates.length) return null;

  const underClosing = closingStart >= 0
    ? qtyCandidates.filter((candidate) => (
      candidate.column >= closingStart && candidate.column <= closingEnd
    ))
    : [];
  // Prefer Closing Balance Quantity. Older one-city exports only have Quantity in column B.
  const chosen = underClosing[0]
    || (qtyCandidates.length > 1 ? qtyCandidates[qtyCandidates.length - 1] : qtyCandidates[0]);

  const city = normalizeEodCity(sheetName) || findTitleCity(matrix, particularsRow);
  if (!city) return null;

  return {
    headerRow: chosen.row,
    nameIndex,
    qtyIndex: chosen.column,
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

/** Tally Location Summary section titles / godown lines — not stock items. */
export function isEodStockSectionLabel(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return false;
  const text = normalizeImportHeader(raw);
  if (!text) return false;
  if (isTotalLabel(raw)) return true;
  if (
    text === "non food division"
    || text === "food division"
    || text === "location summary"
    || text === "closing balance"
    || text === "fifo"
    || text === "quantity"
    || text === "alt units"
    || text === "altunits"
    || text === "building material"
    || text === "building materials"
    || text === "personal care"
    || text === "office supplies"
    || text === "stationery"
    || text === "stationary"
    || text === "electronics"
    || text === "sundry"
    || text === "fragrance"
    || text === "fragrances"
    || text === "body care"
    || text === "baby care"
    || text === "cosmetics"
    || text === "pos supplies"
    || text === "pos supply"
    || text === "unclassified"
  ) {
    return true;
  }
  if (/^location\b/.test(text)) return true;
  // Whole label is a city or godown title (RIYADH, RIYADH W/H 1). Product names that
  // merely mention a city (e.g. "Only Riyadh") must stay as items.
  if (!normalizeEodCity(raw)) return false;
  const remainder = text
    .replace(/\b(riyadh|riyad|ruh|dammam|damman|dmm|jeddah|jedda|jiddah|jed)\b/g, " ")
    .replace(/\b(w\s*h|wh|warehouse|godown|region)\b/g, " ")
    .replace(/\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return !remainder;
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
    if (!key || isEodStockSectionLabel(key) || isEodStockSectionLabel(name)) return null;
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

function uniqueCities(values) {
  const seen = new Set();
  const out = [];
  (values || []).forEach((city) => {
    const normalized = normalizeEodCity(city) || String(city || "").trim().toLowerCase();
    if (!EOD_STOCK_CITIES.includes(normalized) || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  });
  return out;
}

function countPositiveCityItems(rows, city) {
  return (rows || []).reduce((count, row) => (
    roundEodQty(row?.cities?.[city]?.qty || 0) > 0 ? count + 1 : count
  ), 0);
}

/** Infer Riyadh/Dammam/Jeddah from an uploaded Excel file name (dammam1, Riyadh.xlsx, …). */
export function inferEodCityFromFileName(fileName) {
  const base = String(fileName || "")
    .trim()
    .replace(/^.*[\\/]/, "")
    .replace(/\.(xlsx|xls)$/i, "");
  const text = normalizeImportHeader(base);
  if (!text) return "";
  if (/(?:^|[^a-z])(?:riyadh|riyad|ruh)(?:[^a-z]|$)/.test(` ${text} `)) return "riyadh";
  if (/(?:^|[^a-z])(?:dammam|damman|damma|damm|dmm)(?:[^a-z]|$)/.test(` ${text} `)) return "dammam";
  if (/(?:^|[^a-z])(?:jeddah|jedda|jiddah|jed)(?:[^a-z]|$)/.test(` ${text} `)) return "jeddah";
  return normalizeEodCity(base);
}

export function emptyEodCityUploads() {
  return {
    riyadh: null,
    dammam: null,
    jeddah: null,
  };
}

export function readEodCityUploads(value) {
  const source = value && typeof value === "object" ? value : {};
  const out = emptyEodCityUploads();
  EOD_STOCK_CITIES.forEach((city) => {
    const entry = source[city];
    if (!entry || typeof entry !== "object") return;
    const filePath = String(entry.filePath || "").trim();
    const fileName = String(entry.fileName || "").trim();
    if (!filePath && !fileName) return;
    out[city] = {
      fileName,
      filePath,
      uploadedAt: String(entry.uploadedAt || "").trim(),
      stockDate: String(entry.stockDate || "").trim(),
      itemCount: Math.max(0, Number(entry.itemCount) || 0),
      canDownload: Boolean(filePath),
    };
  });
  return out;
}

export function mergeEodCityUploads(previousUploads, citiesPresent, fileMeta = {}) {
  const next = readEodCityUploads(previousUploads);
  const cities = uniqueCities(citiesPresent);
  if (!cities.length) return next;

  const fileName = String(fileMeta.fileName || "").trim();
  const filePath = String(fileMeta.filePath || "").trim();
  const uploadedAt = String(fileMeta.uploadedAt || "").trim();
  const stockDate = String(fileMeta.stockDate || "").trim();
  const itemCounts = fileMeta.itemCounts && typeof fileMeta.itemCounts === "object"
    ? fileMeta.itemCounts
    : {};

  cities.forEach((city) => {
    next[city] = {
      fileName,
      filePath,
      uploadedAt,
      stockDate,
      itemCount: Math.max(0, Number(itemCounts[city]) || Number(fileMeta.itemCount) || 0),
      canDownload: Boolean(filePath),
    };
  });
  return next;
}

export function summarizeEodCityUploads(dataset) {
  const source = dataset && typeof dataset === "object" ? dataset : {};
  const uploads = readEodCityUploads(source.cityUploads);
  // Legacy datasets only kept the latest file pointer — still show it on matching cities.
  if (!EOD_STOCK_CITIES.some((city) => uploads[city])) {
    const legacyPath = String(source.filePath || "").trim();
    const legacyName = String(source.fileName || "").trim();
    const inferred = inferEodCityFromFileName(legacyName) || uniqueCities(source.citiesPresent)[0] || "";
    if (legacyPath && inferred) {
      uploads[inferred] = {
        fileName: legacyName,
        filePath: legacyPath,
        uploadedAt: String(source.uploadedAt || "").trim(),
        stockDate: String(source.stockDate || "").trim(),
        itemCount: countPositiveCityItems(source.rows, inferred),
        canDownload: true,
      };
    }
  }
  return uploads;
}

export function applyEodStockUpload(previousDataset, parsed) {
  const previous = previousDataset && typeof previousDataset === "object" ? previousDataset : {};
  const stockDate = parsed.stockDate;
  const fullFile = EOD_STOCK_CITIES.every((city) => parsed.citiesPresent.includes(city));
  // One-city / two-city files always keep the other cities from the current snapshot,
  // even when the incoming stock date is older than the snapshot date.
  const canCarryCities = !fullFile && Array.isArray(previous.rows) && previous.rows.length > 0;
  const baseRows = canCarryCities ? (previous.rows || []) : [];
  let previousStockDate = "";
  let previousRows = [];
  let nextStockDate = stockDate;

  if (previous.stockDate && stockDate > previous.stockDate) {
    previousStockDate = previous.stockDate;
    previousRows = previous.rows || [];
  } else if (previous.stockDate && stockDate === previous.stockDate) {
    previousStockDate = previous.previousStockDate || "";
    previousRows = previous.previousRows || [];
  } else if (previous.stockDate && stockDate < previous.stockDate && canCarryCities) {
    // Partial older file: keep the snapshot's stock date and day-over-day baseline.
    nextStockDate = previous.stockDate;
    previousStockDate = previous.previousStockDate || "";
    previousRows = previous.previousRows || [];
  }

  const rows = mergeStockRows(baseRows, parsed.rows, parsed.citiesPresent);
  const citiesPresent = canCarryCities
    ? uniqueCities([
      ...(previous.citiesPresent || []),
      ...EOD_STOCK_CITIES.filter((city) => countPositiveCityItems(rows, city) > 0),
      ...(parsed.citiesPresent || []),
    ])
    : uniqueCities(parsed.citiesPresent);

  return {
    stockDate: nextStockDate,
    previousStockDate,
    rows,
    previousRows: previousStockDate ? previousRows.map((row) => ({
      itemCode: row.itemCode,
      itemName: row.itemName,
      unit: row.unit || "",
      cities: copyCities(row.cities),
    })) : [],
    citiesPresent,
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
  const itemCounts = {
    riyadh: 0,
    dammam: 0,
    jeddah: 0,
  };
  (source.rows || []).forEach((row) => {
    EOD_STOCK_CITIES.forEach((city) => {
      const qty = roundEodQty(row.cities?.[city]?.qty || 0);
      totals[city].qty = roundEodQty(totals[city].qty + qty);
      totals[city].value = roundEodQty(totals[city].value + (row.cities?.[city]?.value || 0));
      if (qty > 0) itemCounts[city] += 1;
    });
  });
  const cityUploads = summarizeEodCityUploads(source);
  EOD_STOCK_CITIES.forEach((city) => {
    if (cityUploads[city] && !cityUploads[city].itemCount) {
      cityUploads[city] = { ...cityUploads[city], itemCount: itemCounts[city] };
    }
  });
  return {
    stockDate: source.stockDate || "",
    previousStockDate: source.previousStockDate || "",
    uploadedAt: source.uploadedAt || "",
    fileName: source.fileName || "",
    canDownload: Boolean(String(source.filePath || "").trim())
      || EOD_STOCK_CITIES.some((city) => cityUploads[city]?.canDownload),
    itemCount: Array.isArray(source.rows) ? source.rows.length : 0,
    cities: totals,
    cityItemCounts: itemCounts,
    cityUploads,
  };
}

export function buildEodStockReportRows(dataset, { masterUnits = null } = {}) {
  const source = dataset && typeof dataset === "object" ? dataset : {};
  const hasPrevious = Boolean(source.previousStockDate);
  const previous = new Map((hasPrevious ? source.previousRows || [] : []).map((row) => [row.itemCode, row]));
  const current = new Map((source.rows || []).map((row) => [row.itemCode, row]));
  const codes = new Set([...current.keys(), ...(hasPrevious ? previous.keys() : [])]);
  const masterMap = masterUnits && typeof masterUnits === "object" ? masterUnits : {};
  const rows = [];

  codes.forEach((code) => {
    const row = current.get(code);
    const prior = previous.get(code);
    const stockUnit = row?.unit || prior?.unit || "";
    const master = masterMap[String(code || "").trim().toUpperCase()] || null;
    const convert = (raw) => resolveEodStockMasterDisplay(
      { units: { [code]: stockUnit }, masterUnits: masterMap },
      code,
      raw,
    );
    const entry = {
      itemCode: code,
      itemName: row?.itemName || prior?.itemName || code,
      unit: master?.masterUom || stockUnit,
      stockUnit,
      total: 0,
      totalPrev: 0,
    };
    EOD_STOCK_CITIES.forEach((city) => {
      const qtyRaw = roundEodQty(row?.cities?.[city]?.qty || 0);
      const prevRaw = roundEodQty(prior?.cities?.[city]?.qty || 0);
      const qty = convert(qtyRaw).qty;
      const prev = convert(prevRaw).qty;
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

function normalizeMasterUnitsMap(value) {
  if (!value || typeof value !== "object") return {};
  const out = {};
  Object.entries(value).forEach(([rawCode, entry]) => {
    const code = String(rawCode || "").trim().toUpperCase();
    if (!code || !entry || typeof entry !== "object") return;
    const masterUom = String(entry.masterUom || entry.tally_alt_uom || "").trim();
    const conv = Number(entry.conv ?? entry.tally_master_unit_conv);
    if (!masterUom || !Number.isFinite(conv) || !(conv > 0)) return;
    out[code] = {
      masterUom,
      baseUom: String(entry.baseUom || entry.tally_base_uom || "").trim(),
      conv,
    };
  });
  return out;
}

function normalizeUnitsMap(value) {
  if (!value || typeof value !== "object") return {};
  const out = {};
  Object.entries(value).forEach(([rawCode, rawUnit]) => {
    const code = String(rawCode || "").trim().toUpperCase();
    const unit = String(rawUnit || "").trim();
    if (!code || !unit) return;
    out[code] = unit;
  });
  return out;
}

/** Compact city→item→qty map for pricing cache / offline order hints. Keeps the last upload until a newer file replaces it. */
export function buildEodStockAvailability(dataset, { masterUnits = null } = {}) {
  const source = dataset && typeof dataset === "object" ? dataset : null;
  const stockDate = String(source?.stockDate || "").trim();
  const uploadedAt = String(source?.uploadedAt || "").trim();
  if (!source || !/^\d{4}-\d{2}-\d{2}$/.test(stockDate) || !Array.isArray(source.rows) || source.rows.length === 0) {
    return {
      stockDate: "",
      uploadedAt: "",
      byCity: emptyCityQtyMaps(),
      units: {},
      masterUnits: normalizeMasterUnitsMap(masterUnits),
      active: false,
    };
  }

  const byCity = emptyCityQtyMaps();
  const units = {};
  source.rows.forEach((row) => {
    const code = String(row?.itemCode || row?.item_code || "").trim().toUpperCase();
    if (!code) return;
    const unit = String(row?.unit || "").trim();
    if (unit && !units[code]) units[code] = unit;
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
    units,
    masterUnits: normalizeMasterUnitsMap(masterUnits),
    active: true,
  };
}

export function normalizeEodStockAvailability(value) {
  if (!value || typeof value !== "object") {
    return {
      stockDate: "",
      uploadedAt: "",
      byCity: emptyCityQtyMaps(),
      units: {},
      masterUnits: {},
      active: false,
    };
  }
  if (value.active === false) {
    return {
      stockDate: "",
      uploadedAt: "",
      byCity: emptyCityQtyMaps(),
      units: {},
      masterUnits: normalizeMasterUnitsMap(value.masterUnits),
      active: false,
    };
  }
  const stockDate = String(value.stockDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stockDate)) {
    return {
      stockDate: "",
      uploadedAt: "",
      byCity: emptyCityQtyMaps(),
      units: {},
      masterUnits: {},
      active: false,
    };
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
    units: normalizeUnitsMap(value.units),
    masterUnits: normalizeMasterUnitsMap(value.masterUnits),
    active: true,
  };
}

/**
 * Countrywide available qty for display / over-stock checks.
 * Converts to master units when Master UOM + conversion are available and stock is not already master.
 */
export function countryEodStockDisplayQty(availability, itemCode) {
  const raw = countryEodStockQty(availability, itemCode);
  if (raw == null) return null;
  return resolveEodStockMasterDisplay(availability, itemCode, raw).qty;
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

/**
 * Countrywide (Riyadh + Dammam + Jeddah) available qty for an item.
 * Returns null when no end-of-day stock snapshot is loaded.
 */
export function countryEodStockQty(availability, itemCode) {
  const stock = normalizeEodStockAvailability(availability);
  if (!stock.active) return null;
  const code = String(itemCode || "").trim().toUpperCase();
  if (!code) return 0;
  let total = 0;
  for (const city of EOD_STOCK_CITIES) {
    total += Math.max(0, roundEodQty(stock.byCity?.[city]?.[code] || 0));
  }
  return roundEodQty(total);
}

/**
 * Catalogue browse/export: keep the item when no EOD snapshot is loaded, or when
 * countrywide qty (any city) is strictly greater than zero.
 */
export function hasPositiveCountryEodStockQty(availability, itemCode) {
  const available = countryEodStockQty(availability, itemCode);
  if (available == null) return true;
  return available > 0;
}

export function filterItemsWithPositiveCountryEodStock(items, availability) {
  return (items || []).filter((item) => hasPositiveCountryEodStockQty(availability, item?.item_code));
}

export function isEodStockQtyOverAvailable(orderedQty, available) {
  if (available == null) return false;
  const qty = Number(orderedQty || 0);
  return Number.isFinite(qty) && qty > available;
}

const EOD_CITY_SHORT = {
  riyadh: "R",
  dammam: "D",
  jeddah: "J",
};

/**
 * Compact city stock fragments, e.g. "R:30 D:6 J:0" (master units when conversion applies).
 * Empty when no EOD snapshot is loaded or the item code is blank.
 */
export function formatEodStockCityBreakdown(availability, itemCode) {
  const stock = normalizeEodStockAvailability(availability);
  if (!stock.active) return "";
  const code = String(itemCode || "").trim().toUpperCase();
  if (!code) return "";
  return EOD_STOCK_CITIES.map((city) => {
    const raw = Math.max(0, roundEodQty(stock.byCity?.[city]?.[code] || 0));
    const shown = resolveEodStockMasterDisplay(stock, code, raw).qty;
    return `${EOD_CITY_SHORT[city]}:${formatEodQty(shown)}`;
  }).join(" ");
}

/**
 * Label beside order qty. Keeps the last uploaded stock qty until a newer import replaces it.
 * Shows country total plus city breakdown (R:/D:/J:), stock date when older than 24 hours,
 * and warns when ordered qty exceeds available.
 * When Master UOM conversion is available, qty is shown in master units (0 decimals) with unit suffix.
 */
export function formatEodStockAvailableLabel(
  available,
  language = "en",
  orderedQty = null,
  availability = null,
  itemCode = "",
  nowMs = Date.now(),
) {
  if (available == null) return "";
  const stock = normalizeEodStockAvailability(availability);
  const display = resolveEodStockMasterDisplay(stock, itemCode, available);
  const showMasterUnit = Boolean(lookupMasterUnitConv(stock.masterUnits, itemCode) && display.unit);
  const qtyText = showMasterUnit
    ? formatMasterStockQty(display.qty, display.unit)
    : formatEodQty(display.qty);
  const stale = isEodStockOlderThanHours(stock, 24, nowMs);
  const asOf = stale ? formatEodStockAsOfDate(stock.stockDate, language) : "";
  const cities = formatEodStockCityBreakdown(stock, itemCode);
  const over = isEodStockQtyOverAvailable(orderedQty, display.qty);

  if (language === "ar") {
    let label = `المتاح: ${qtyText}`;
    if (cities) label = `${label} · ${cities}`;
    if (asOf) label = `${label} · ${asOf}`;
    if (over) label = `${label} — أكثر من المخزون`;
    return label;
  }

  let label = `Available: ${qtyText}`;
  if (cities) label = `${label} · ${cities}`;
  if (asOf) label = `${label} · ${asOf}`;
  if (over) label = `${label} — over stock`;
  return label;
}
