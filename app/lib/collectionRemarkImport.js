/** Parse Stale Overdue screenshot OCR / pasted tables into collection remark rows. */

export const COLLECTION_REMARK_IMPORT_OUTCOMES = [
  "ASKED_COME_LATER",
  "RESPONSIBLE_NOT_AVAILABLE",
  "TRANSFER_TO_LEGAL",
  "NO_DUE_AS_PER_CUSTOMER",
  "WRONG_CREDIT_DAYS",
];

const OUTCOME_TOKENS = [
  "TRANSFER_TO_LEGAL",
  "FUNDS_RECEIVED",
  "ASKED_COME_LATER",
  "RESPONSIBLE_NOT_AVAILABLE",
  "WRONG_CREDIT_DAYS",
  "NO_DUE_AS_PER_CUSTOMER",
];

/** Prefer codes with C suffix, or bare digits that introduce a customer name (dash), not money. */
const CUSTOMER_CODE_RE = /(?<![,\d])(\d{3,5}C)(?![A-Z0-9])|(?:^|[\n\r])\s*(\d{3,5})(?=\s*[—\-–:])|(?<![,\d])(\d{3,5})(?=\s+[A-Za-z\u0600-\u06FF])/gi;
const CUSTOMER_CODE_ONLY_RE = /^(\d{3,5}C?)$/i;

export function normalizeCollectionRemarkCustomerCode(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "";
  const fromPrefix = raw.match(/^(\d{3,5}C?)\b/);
  if (fromPrefix) return fromPrefix[1].toUpperCase();
  const anywhere = raw.match(/\b(\d{3,5}C?)\b/);
  return anywhere ? anywhere[1].toUpperCase() : "";
}

export function cleanCollectionRemarkText(value) {
  return String(value || "")
    .replace(/\u2014|\u2013/g, "-")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n+\s*/g, " ")
    .trim();
}

export function suggestCollectionRemarkVisitOutcome(remark = "") {
  const text = String(remark || "");
  if (/\b(court|lawyer|legal|enforcement|محام|محكمة|قانون)\b/i.test(text)) {
    return "TRANSFER_TO_LEGAL";
  }
  return "ASKED_COME_LATER";
}

export function suggestCollectionRemarkPaymentStatus(visitOutcome) {
  const outcome = String(visitOutcome || "").trim().toUpperCase();
  if (outcome === "TRANSFER_TO_LEGAL") return "NOT_PAID";
  if (outcome === "FUNDS_RECEIVED") return "PARTIAL";
  return "PROMISED";
}

function isNoiseRemark(text) {
  const value = cleanCollectionRemarkText(text);
  if (!value || value === "-" || value === "—") return true;
  if (/^(never|far|null|n\/a)$/i.test(value)) return true;
  if (OUTCOME_TOKENS.includes(value.toUpperCase())) return true;
  if (/^\d{4}-\d{2}-\d{2}(?:\s*FAR)?$/i.test(value)) return true;
  if (/^[\d,.\s]+$/.test(value) && value.length < 16) return true;
  return value.length < 8;
}

function extractRemarkFromSegment(segment) {
  let text = cleanCollectionRemarkText(segment);
  if (!text) return "";

  // Drop leading "code — customer name (Legal)"
  text = text.replace(/^\d{3,5}C?\s*[-—–:]?\s*/i, "");
  text = text.replace(/^[^]*?\((?:Legal|قانوني)\)\s*/i, "");

  // Prefer text after the last known outcome token (table column before Remarks).
  for (const token of OUTCOME_TOKENS) {
    const idx = text.toUpperCase().lastIndexOf(token);
    if (idx >= 0) {
      text = text.slice(idx + token.length).trim();
      break;
    }
  }

  // Or after a trailing date / Never column.
  const afterDate = text.match(/(?:Never|\d{4}-\d{2}-\d{2}(?:\s*FAR)?)\s+(.+)$/i);
  if (afterDate?.[1] && afterDate[1].length > text.length * 0.35) {
    text = afterDate[1].trim();
  }

  // Strip leftover money / day noise at the start.
  text = text
    .replace(/^(?:[\d,]+\.\d{2}\s*)+/g, "")
    .replace(/^\d{1,4}\s+/g, "")
    .replace(/^(?:Never|FAR|-)\s+/gi, "")
    .trim();

  return isNoiseRemark(text) ? "" : text;
}

function buildRow(customerCode, remark, source = "ocr") {
  const code = normalizeCollectionRemarkCustomerCode(customerCode);
  const cleaned = cleanCollectionRemarkText(remark);
  if (!code || isNoiseRemark(cleaned)) return null;
  const visitOutcome = suggestCollectionRemarkVisitOutcome(cleaned);
  return {
    customerCode: code,
    remark: cleaned,
    visitOutcome,
    paymentStatus: suggestCollectionRemarkPaymentStatus(visitOutcome),
    selected: true,
    source,
  };
}

/**
 * Walk OCR text: split on customer codes and take the trailing remark for each.
 */
export function parseCollectionRemarkOcrText(ocrText = "") {
  const text = String(ocrText || "").replace(/\r/g, "\n");
  if (!text.trim()) return [];

  const matches = [...text.matchAll(CUSTOMER_CODE_RE)];
  if (!matches.length) return [];

  const rows = [];
  const seen = new Set();

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const code = String(match[1] || match[2] || match[3] || "").toUpperCase();
    if (!code) continue;
    // Locate the actual code token inside the match (line-start pattern may include newline).
    const codePos = text.toUpperCase().indexOf(code, match.index);
    const anchor = codePos >= 0 ? codePos : match.index;
    const start = anchor + code.length;
    const nextMatch = matches[index + 1];
    const nextCode = nextMatch
      ? String(nextMatch[1] || nextMatch[2] || nextMatch[3] || "").toUpperCase()
      : "";
    const nextPos = nextMatch
      ? text.toUpperCase().indexOf(nextCode, nextMatch.index)
      : -1;
    const end = nextPos >= 0 ? nextPos : text.length;
    const segment = text.slice(anchor, end);
    const remark = extractRemarkFromSegment(segment) || extractRemarkFromSegment(text.slice(start, end));
    const row = buildRow(code, remark, "ocr");
    if (!row || seen.has(row.customerCode)) continue;
    seen.add(row.customerCode);
    rows.push(row);
  }

  return rows;
}

function splitDelimitedLine(line) {
  if (line.includes("\t")) return line.split("\t").map((part) => part.trim());
  if (line.includes("|")) return line.split("|").map((part) => part.trim());
  // CSV with simple quotes
  if (/,/.test(line)) {
    const parts = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === "," && !inQuotes) {
        parts.push(current.trim());
        current = "";
        continue;
      }
      current += ch;
    }
    parts.push(current.trim());
    return parts;
  }
  return [line.trim()];
}

function headerLooksLikeRemark(header) {
  return /remark|comment|ملاحظة|تعليق/i.test(String(header || ""));
}

function headerLooksLikeCustomer(header) {
  return /customer|code|عميل|كود/i.test(String(header || ""));
}

/**
 * Parse pasted TSV/CSV/pipe tables. Prefers Customer + Remarks columns when headers exist.
 */
export function parseCollectionRemarkTableText(tableText = "") {
  const lines = String(tableText || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const firstParts = splitDelimitedLine(lines[0]);
  const hasHeader = firstParts.some((part) => headerLooksLikeRemark(part) || headerLooksLikeCustomer(part));
  let remarkIndex = -1;
  let customerIndex = 0;
  let dataLines = lines;

  if (hasHeader) {
    remarkIndex = firstParts.findIndex((part) => headerLooksLikeRemark(part));
    customerIndex = firstParts.findIndex((part) => headerLooksLikeCustomer(part));
    if (customerIndex < 0) customerIndex = 0;
    if (remarkIndex < 0) remarkIndex = firstParts.length - 1;
    dataLines = lines.slice(1);
  } else if (firstParts.length >= 2) {
    remarkIndex = firstParts.length - 1;
    customerIndex = 0;
  }

  const rows = [];
  const seen = new Set();
  dataLines.forEach((line) => {
    const parts = splitDelimitedLine(line);
    if (!parts.length) return;
    const customerCell = parts[Math.min(customerIndex, parts.length - 1)] || parts[0];
    const remarkCell = remarkIndex >= 0
      ? (parts[Math.min(remarkIndex, parts.length - 1)] || "")
      : parts.slice(1).join(" ");
    const row = buildRow(customerCell, remarkCell, "paste");
    if (!row || seen.has(row.customerCode)) return;
    seen.add(row.customerCode);
    rows.push(row);
  });

  return rows;
}

export function parseCollectionRemarkImportText(rawText = "", { prefer = "auto" } = {}) {
  const text = String(rawText || "");
  if (!text.trim()) return [];

  const looksTabular = /\t/.test(text)
    || text.split(/\n/).filter(Boolean).some((line) => (line.match(/\|/g) || []).length >= 2)
    || /remarks?/i.test(text.split(/\n/)[0] || "");

  if (prefer === "table" || (prefer === "auto" && looksTabular)) {
    const tableRows = parseCollectionRemarkTableText(text);
    if (tableRows.length) return tableRows;
  }

  return parseCollectionRemarkOcrText(text);
}

export function normalizeCollectionRemarkImportRows(rows = []) {
  const seen = new Set();
  const out = [];
  (Array.isArray(rows) ? rows : []).forEach((row, index) => {
    const customerCode = normalizeCollectionRemarkCustomerCode(row?.customerCode || row?.customer_code);
    const remark = cleanCollectionRemarkText(row?.remark || row?.remark_english || row?.remarks);
    if (!customerCode || !remark) return;
    if (seen.has(customerCode)) return;
    seen.add(customerCode);

    let visitOutcome = String(row?.visitOutcome || row?.visit_outcome || "").trim().toUpperCase();
    if (!COLLECTION_REMARK_IMPORT_OUTCOMES.includes(visitOutcome)) {
      visitOutcome = suggestCollectionRemarkVisitOutcome(remark);
    }
    const paymentStatus = String(row?.paymentStatus || row?.payment_status || "")
      .trim()
      .toUpperCase()
      || suggestCollectionRemarkPaymentStatus(visitOutcome);

    out.push({
      id: String(row?.id || `${customerCode}-${index}`),
      customerCode,
      remark,
      visitOutcome,
      paymentStatus,
      selected: row?.selected === false ? false : true,
      source: String(row?.source || "manual").trim() || "manual",
    });
  });
  return out;
}

export function isValidCollectionRemarkCustomerCode(value) {
  return CUSTOMER_CODE_ONLY_RE.test(String(value || "").trim());
}
