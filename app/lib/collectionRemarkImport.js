/** Parse Stale Overdue / Bills Receivable screenshot OCR or pasted tables into remark rows. */

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

/** Prefer codes with C suffix, or bare digits that introduce a customer/party name. */
const CUSTOMER_CODE_RE = /(?<![,\d])(\d{3,5}C)(?![A-Z0-9])|(?:^|[\n\r])\s*(\d{3,5})(?=\s*[—\-–:])|(?<![,\d.])(\d{3,5})(?=\s+[A-Za-z\u0600-\u06FF])/gi;
const CUSTOMER_CODE_ONLY_RE = /^(\d{3,5}C?)$/i;

const BILL_DATE_RE = /\b\d{1,2}-[A-Za-z]{3}-\d{2}\b/gi;
const BILL_REF_RE = /\b[A-Z]{2,8}\/\d{2,5}\b/gi;
const BILL_MONEY_RE = /\b\d{1,3}(?:,\d{3})*\.\d{2}\b/g;
const BILL_STATE_RE = /\b(?:Riyadh|Jeddah|Dammam|Makkah|Madinah|Khobar|Qassim|Asir|Tabuk|Hail|Jazan|Najran|Baha|Northern Borders|Aljouf)\b/gi;
const REMARK_CUE_RE = /\b(good return|follow[\s/-]?up|sunday|expected|blanace|balance\s+confirmation|stock\s+returns?|shop\s+closed|write\s*off|payment\s+\d|goods\s+will|if\s+not\s+then\s+legal|dealyed|delayed|wrong\s+credit|an\s+email|aproximately|approximately|taken\s+back|case\s+is|court\s+has|purchas|fallwing|following\s+up|client'?s?\s+file)\b/i;
const COMPANY_NAME_RE = /\b(?:Trading(?:\s+Co\.?|\s+Company|\s+Est\.?)?|Company|Est\.?|Ltd\.?|Limited|Wholesale|Lemted)\b/i;
/** Known field users / salesmen that OCR often bleeds into the Remarks column. */
const KNOWN_SALESMAN_NAME_PATTERN = String.raw`Ahmed\s+Nabil|ABDALLA\s+ANTHANATH|Abdulla\s+Anthanath|Abdul\s+Rehman|ABDUL\s+REHMAN|Moinudin(?:din)?|MOINUDIN(?:DIN)?|Parvez|PARVEZ|Junaid|JUNAID|Osama|OSAMA|Ahmed\s+Had(?:yah|ia|iya)|Ahmed\s+hadyah|Soyeb|Fazlur(?:\s+Rah(?:man|iman))?`;
/** At least two Title-Case tokens (First Last) before lowercase remark prose. */
const LEADING_PERSON_NAME_RE = /^(?:[A-Z][A-Za-z.'-]*)(?:\s+[A-Z][A-Za-z.']*){1,3}\s+(?=[a-z\u0600-\u06FF(])/;
const LEADING_PARTY_NAME_RE = /^(?:[A-Za-z\u0600-\u06FF][A-Za-z\u0600-\u06FF0-9 .,&'/-]{0,80}?\b(?:Trading(?:\s+Co\.?|\s+Company|\s+Est\.?)?|Company|Est\.?|Ltd\.?|Wholesale|Lemted)\.?\s*)+/i;
const TRAILING_BILL_NOISE_RE = /(?:\s+\d{1,2}-[A-Za-z]{3}-\d{2}|\s+[A-Z]{2,8}\/\d{2,5}|\s+\d{1,3}(?:,\d{3})*\.\d{2})+\s*$/g;

function knownSalesmanNameRe(flags = "i") {
  return new RegExp(`(?:${KNOWN_SALESMAN_NAME_PATTERN})`, flags);
}

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

/**
 * Keep only the collection comment: strip customer code/name and salesman name bleed.
 */
export function sanitizeCollectionRemarkComment(remark = "", { customerCode = "" } = {}) {
  let text = cleanCollectionRemarkText(remark);
  if (!text) return "";

  const code = normalizeCollectionRemarkCustomerCode(customerCode);
  if (code) {
    text = text.replace(new RegExp(`^${code}\\b\\s*[-—–:]?\\s*`, "i"), "");
  }
  text = text.replace(/^\d{3,5}C?\b\s*[-—–:]?\s*/i, "");

  // Drop "Name (Legal)" / party labels OCR leaves before the real comment.
  text = text.replace(LEADING_PARTY_NAME_RE, "");
  text = text.replace(/^[^]*?\((?:Legal|قانوني)\)\s*/i, "");
  text = text.replace(/^[-—–:,./\s]+/, "");

  // Drop salesman column values at the start (known names, then generic Title Case).
  text = text.replace(new RegExp(`^(?:${KNOWN_SALESMAN_NAME_PATTERN})\\s*[-:]?\\s*`, "i"), "");
  text = text.replace(LEADING_PERSON_NAME_RE, "");

  // If a remark cue appears after leftover name/noise, keep from the cue onward.
  const cueIdx = text.search(REMARK_CUE_RE);
  if (cueIdx > 0) {
    const before = text.slice(0, cueIdx).trim();
    if (
      !before
      || COMPANY_NAME_RE.test(before)
      || knownSalesmanNameRe("i").test(before)
      || /^[A-Z][A-Za-z .,'-]{2,60}$/.test(before)
    ) {
      text = text.slice(cueIdx);
    }
  }

  // Final pass: strip a leading known salesman token if still present.
  text = text.replace(new RegExp(`^(?:${KNOWN_SALESMAN_NAME_PATTERN})\\s*[-:]?\\s*`, "i"), "");
  // Drop trailing next-row bill noise (date / ref / money) that OCR glued on.
  text = text.replace(TRAILING_BILL_NOISE_RE, "");
  text = cleanCollectionRemarkText(text);
  return text;
}

export function suggestCollectionRemarkVisitOutcome(remark = "") {
  const text = String(remark || "");
  if (/\b(court|lawyer|legal|enforcement|write\s*off|محام|محكمة|قانون)\b/i.test(text)) {
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

export function looksLikeBillsReceivableText(text = "") {
  return /bills\s*receivable|pending\s*bills|party'?s?\s*name|overdue\s*\[?\s*days|ref\.?\s*no\.?|invoice\s*\[?\s*amount|sales\s*person/i.test(
    String(text || ""),
  );
}

function isNoiseRemark(text) {
  const value = cleanCollectionRemarkText(text);
  if (!value || value === "-" || value === "—") return true;
  if (/^(never|far|null|n\/a|riyadh|jeddah)$/i.test(value)) return true;
  if (OUTCOME_TOKENS.includes(value.toUpperCase())) return true;
  if (/^\d{4}-\d{2}-\d{2}(?:\s*FAR)?$/i.test(value)) return true;
  if (/^\d{1,2}-[A-Za-z]{3}-\d{2}$/i.test(value)) return true;
  if (/^[\d,.\s/-]+$/.test(value) && value.length < 16) return true;
  if (/^[A-Za-z\u0600-\u06FF][A-Za-z\u0600-\u06FF .'-]{1,40}$/.test(value) && value.length >= 3) {
    // Short alphabetic remarks like "Osama" are valid.
    return false;
  }
  return value.length < 6;
}

function extractRemarkFromSegment(segment) {
  let text = cleanCollectionRemarkText(segment);
  if (!text) return "";

  text = text.replace(/^\d{3,5}C?\s*[-—–:]?\s*/i, "");
  text = text.replace(/^[^]*?\((?:Legal|قانوني)\)\s*/i, "");

  for (const token of OUTCOME_TOKENS) {
    const idx = text.toUpperCase().lastIndexOf(token);
    if (idx >= 0) {
      text = text.slice(idx + token.length).trim();
      break;
    }
  }

  const afterDate = text.match(/(?:Never|\d{4}-\d{2}-\d{2}(?:\s*FAR)?)\s+(.+)$/i);
  if (afterDate?.[1] && afterDate[1].length > text.length * 0.35) {
    text = afterDate[1].trim();
  }

  text = text
    .replace(/^(?:[\d,]+\.\d{2}\s*)+/g, "")
    .replace(/^\d{1,4}\s+/g, "")
    .replace(/^(?:Never|FAR|-)\s+/gi, "")
    .trim();

  return isNoiseRemark(text) ? "" : text;
}

function extractRemarkFromBillsSegment(segment) {
  const raw = String(segment || "");
  if (!raw.trim()) return "";

  const cue = raw.search(REMARK_CUE_RE);
  if (cue >= 0) {
    const fromCue = cleanCollectionRemarkText(raw.slice(cue));
    if (!isNoiseRemark(fromCue)) return fromCue;
  }

  let text = raw
    .replace(BILL_DATE_RE, " ")
    .replace(BILL_REF_RE, " ")
    .replace(BILL_STATE_RE, " ")
    .replace(BILL_MONEY_RE, " ");

  // Drop leading party/company name tokens until we hit likely free-text remark.
  text = cleanCollectionRemarkText(text);
  const moneyEnd = [...String(segment).matchAll(BILL_MONEY_RE)].pop();
  if (moneyEnd) {
    let afterMoney = cleanCollectionRemarkText(String(segment).slice(moneyEnd.index + moneyEnd[0].length));
    // Strip 1–4 salesman name tokens (Title Case / ALL CAPS).
    afterMoney = afterMoney.replace(
      /^(?:[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.']*){0,3})\s+(?=[a-z\u0600-\u06FF(])/,
      "",
    );
    afterMoney = afterMoney.replace(
      /^(?:[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.']*){0,3})$/,
      "",
    );
    if (!isNoiseRemark(afterMoney)) return afterMoney;
  }

  // Fallback: last chunk with lowercase letters.
  const lowerChunk = text.match(/[a-z][a-zA-Z0-9 .,/&'%-]{4,}$/);
  if (lowerChunk) {
    const candidate = cleanCollectionRemarkText(lowerChunk[0]);
    if (!isNoiseRemark(candidate)) return candidate;
  }

  return isNoiseRemark(text) ? "" : text;
}

function buildRow(customerCode, remark, source = "ocr") {
  const code = normalizeCollectionRemarkCustomerCode(customerCode);
  const cleaned = sanitizeCollectionRemarkComment(remark, { customerCode: code });
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

function upsertRemarkRow(rowsByCode, row) {
  if (!row?.customerCode) return;
  const existing = rowsByCode.get(row.customerCode);
  if (!existing) {
    rowsByCode.set(row.customerCode, row);
    return;
  }
  if (row.remark.length > existing.remark.length) {
    rowsByCode.set(row.customerCode, { ...existing, ...row });
    return;
  }
  if (row.remark && !existing.remark.toLowerCase().includes(row.remark.toLowerCase())) {
    rowsByCode.set(row.customerCode, {
      ...existing,
      remark: `${existing.remark} | ${row.remark}`,
      visitOutcome: suggestCollectionRemarkVisitOutcome(`${existing.remark} | ${row.remark}`),
      paymentStatus: suggestCollectionRemarkPaymentStatus(
        suggestCollectionRemarkVisitOutcome(`${existing.remark} | ${row.remark}`),
      ),
    });
  }
}

/**
 * Bills Receivable / Pending Bills OCR: party code + name, remarks on the right.
 */
export function parseBillsReceivableOcrText(ocrText = "") {
  const text = String(ocrText || "").replace(/\r/g, "\n");
  if (!text.trim()) return [];

  const matches = [...text.matchAll(CUSTOMER_CODE_RE)];
  if (!matches.length) return [];

  const rowsByCode = new Map();
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const code = String(match[1] || match[2] || match[3] || "").toUpperCase();
    if (!code) continue;
    const codePos = text.toUpperCase().indexOf(code, match.index);
    const anchor = codePos >= 0 ? codePos : match.index;
    const nextMatch = matches[index + 1];
    const nextCode = nextMatch
      ? String(nextMatch[1] || nextMatch[2] || nextMatch[3] || "").toUpperCase()
      : "";
    const nextPos = nextMatch
      ? text.toUpperCase().indexOf(nextCode, nextMatch.index)
      : -1;
    const end = nextPos >= 0 ? nextPos : text.length;
    const segment = text.slice(anchor + code.length, end);
    const remark = extractRemarkFromBillsSegment(segment);
    const row = buildRow(code, remark, "ocr-bills");
    if (row) upsertRemarkRow(rowsByCode, row);
  }

  return [...rowsByCode.values()];
}

/**
 * Walk OCR text: split on customer codes and take the trailing remark for each.
 */
export function parseCollectionRemarkOcrText(ocrText = "") {
  const text = String(ocrText || "").replace(/\r/g, "\n");
  if (!text.trim()) return [];

  if (looksLikeBillsReceivableText(text)) {
    const billRows = parseBillsReceivableOcrText(text);
    if (billRows.length) return billRows;
  }

  const matches = [...text.matchAll(CUSTOMER_CODE_RE)];
  if (!matches.length) {
    // Last resort: treat as bills-style party rows even without header keywords.
    return parseBillsReceivableOcrText(text);
  }

  const rowsByCode = new Map();
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const code = String(match[1] || match[2] || match[3] || "").toUpperCase();
    if (!code) continue;
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
    const remark = extractRemarkFromSegment(segment)
      || extractRemarkFromSegment(text.slice(start, end))
      || extractRemarkFromBillsSegment(text.slice(start, end));
    const row = buildRow(code, remark, "ocr");
    if (row) upsertRemarkRow(rowsByCode, row);
  }

  if (!rowsByCode.size) {
    return parseBillsReceivableOcrText(text);
  }

  return [...rowsByCode.values()];
}

function splitDelimitedLine(line) {
  if (line.includes("\t")) return line.split("\t").map((part) => part.trim());
  if (line.includes("|")) return line.split("|").map((part) => part.trim());
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
  return /customer|code|party|عميل|كود|اسم/i.test(String(header || ""));
}

/**
 * Parse pasted TSV/CSV/pipe tables. Prefers Customer/Party + Remarks columns when headers exist.
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

  const rowsByCode = new Map();
  dataLines.forEach((line) => {
    const parts = splitDelimitedLine(line);
    if (!parts.length) return;
    const customerCell = parts[Math.min(customerIndex, parts.length - 1)] || parts[0];
    const remarkCell = remarkIndex >= 0
      ? (parts[Math.min(remarkIndex, parts.length - 1)] || "")
      : parts.slice(1).join(" ");
    const row = buildRow(customerCell, remarkCell, "paste");
    if (row) upsertRemarkRow(rowsByCode, row);
  });

  return [...rowsByCode.values()];
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
    const remark = sanitizeCollectionRemarkComment(
      row?.remark || row?.remark_english || row?.remarks,
      { customerCode },
    );
    if (!customerCode || !remark || isNoiseRemark(remark)) return;
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

export function formatCollectionRemarkActorLabel(profile = {}) {
  const name = String(profile.salesman_name || "").trim();
  const code = String(profile.salesman_code || "").trim();
  const email = String(profile.email || "").trim();
  const role = String(profile.role || "").trim();
  if (name && code) return `${name} (${code})`;
  if (name) return name;
  if (code) return code;
  if (email) return email;
  return role || String(profile.id || "").slice(0, 8);
}
