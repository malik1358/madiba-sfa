function asText(value) {
  return String(value ?? "").replace(/[\u200b-\u200d\ufeff]/g, "").trim();
}

export function normalizeImportHeader(value) {
  return asText(value)
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[%％]/g, " pct")
    .replace(/[\s_\-./\\()[\]:#*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function compactImportHeader(value) {
  return normalizeImportHeader(value).replace(/\s+/g, "");
}

export function parseImportNumber(value) {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value instanceof Date) return 0;

  const text = asText(value);
  if (!text) return 0;

  const wrappedNegative = /^\(.*\)$/.test(text);
  const stripped = text
    .replace(/[()]/g, "")
    .replace(/,/g, "")
    .replace(/[%％]/g, "")
    .replace(/[^\d.\-]/g, "")
    .trim();

  if (!stripped || stripped === "-" || stripped === ".") return 0;

  const parsed = Number(stripped);
  if (!Number.isFinite(parsed)) return 0;
  return wrappedNegative && parsed > 0 ? -parsed : parsed;
}

export function findImportValue(row, possibilities = []) {
  const keys = Object.keys(row || {});
  const wanted = possibilities.map((name) => normalizeImportHeader(name)).filter(Boolean);

  for (const key of keys) {
    if (wanted.includes(normalizeImportHeader(key))) return row[key];
  }

  const wantedCompact = possibilities.map((name) => compactImportHeader(name)).filter(Boolean);
  for (const key of keys) {
    if (wantedCompact.includes(compactImportHeader(key))) return row[key];
  }

  return null;
}

const PROFIT_HEADERS = [
  "gp",
  "g p",
  "g.p",
  "g.p.",
  "gp amount",
  "gp amt",
  "gp value",
  "gp amt.",
  "gross profit",
  "gross profit amount",
  "gross profit amt",
  "gross profit value",
  "gross profit amt.",
  "gross p l",
  "gross pl",
  "profit",
  "profit amount",
  "profit amt",
  "profit value",
  "profit loss",
  "p l",
  "pnl",
  "contribution",
  "contribution amount",
  "مجمل الربح",
  "الربح الإجمالي",
  "قيمة الربح",
  "ربح",
];

const PROFIT_COMPACT = new Set(PROFIT_HEADERS.map((name) => compactImportHeader(name)));
const MARGIN_COMPACT = new Set(["margin", "marginamount", "marginamt", "marginvalue"]);

function isPercentHeader(key) {
  const compact = compactImportHeader(key);
  return compact.includes("pct") || compact.endsWith("percent") || compact.endsWith("percentage");
}

function isProfitHeader(key) {
  if (isPercentHeader(key)) return false;
  const compact = compactImportHeader(key);
  if (PROFIT_COMPACT.has(compact)) return true;
  if (compact.includes("grossprofit")) return true;
  if (compact.includes("gpamount") || compact.includes("gpamt") || compact.includes("gpvalue")) return true;
  if (compact.includes("profitamount") || compact.includes("profitamt") || compact.includes("profitvalue")) {
    return true;
  }
  return false;
}

function isMarginAmountHeader(key) {
  if (isPercentHeader(key)) return false;
  return MARGIN_COMPACT.has(compactImportHeader(key));
}

export function detectProfitColumn(row = {}) {
  const keys = Object.keys(row || {});
  const profitKey = keys.find((key) => isProfitHeader(key));
  if (profitKey) return profitKey;
  return keys.find((key) => isMarginAmountHeader(key)) || null;
}

export function findProfitAmount(row = {}) {
  const key = detectProfitColumn(row);
  return key ? row[key] : null;
}

export function summarizeProfitImport(sourceRows = [], mappedRows = []) {
  const first = sourceRows[0] || {};
  const profitColumn = detectProfitColumn(first);
  const profitRows = (mappedRows || []).filter((row) => Number(row?.profit_amount || 0) !== 0).length;
  const profitSum = (mappedRows || []).reduce((sum, row) => sum + Number(row?.profit_amount || 0), 0);

  return {
    profitColumn,
    excelHeaders: Object.keys(first),
    profitRows,
    profitSum,
  };
}
