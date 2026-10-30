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

/**
 * Prefer 4-digit party codes (Madiba master is almost entirely 4 digits ± C).
 * Keep `\d{3,5}C` so 1054C still matches; bare digits require 4 to avoid overdue-day noise.
 */
const CUSTOMER_CODE_RE = /(?<![,\d])(\d{3,5}C)(?![A-Z0-9])|(?:^|[\n\r])\s*(\d{4})(?=\s*[—\-–:])|(?<![,\d.])(\d{4})(?=\s+[A-Za-z\u0600-\u06FF])/gi;
const CUSTOMER_CODE_ONLY_RE = /^(\d{3,5}C?)$/i;
/**
 * Ledger / Party's Name cell: code then space/underscore/hyphen then the trading name.
 * Example: `1058 Al -Rowad…`, `1468_Bahr Al-Takhfid…`, `1297C Zahrat…`.
 */
const LEDGER_PARTY_CODE_RE = /\b(\d{3,5}C?)(?:[_\-\s]+)(?=[A-Za-z\u0600-\u06FF])/gi;
/**
 * Bills Receivable: Ref. No. then Party's Name code.
 * OCR often inserts brackets/pipes: `NFD/986 [1468 Bohr AlTakhfid…` → party `1468` (not ref `986`).
 * ASCII-only character classes (unicode dashes break under some Vercel/SWC minifiers).
 */
const BILL_REF_PARTY_CODE_RE = /\b[A-Z]{2,8}\/\d{2,5}[\s\[\|_-]+(\d{3,5}C?)(?:[_\-\s\[]+)(?=[A-Za-z\u0600-\u06FF])/gi;
/** Year-like tokens from OCR headers (1-Jan-26 to 28-Oct-26) are not party codes. */
const YEAR_LIKE_CODE_RE = /^20[2-3]\d(?:C)?$/i;
export const COLLECTION_REMARK_PARSER_VERSION = "ocr-bills-before-pipes-v3";

const BILL_DATE_RE = /\b\d{1,2}-[A-Za-z]{3}-\d{2}\b/gi;
const BILL_REF_RE = /\b[A-Z]{2,8}\/\d{2,5}\b/gi;

/** True when a digit run is the numeric tail of a Ref. No. like NFD/986 — never a customer code. */
export function isBillRefNumberFragment(text = "", index = 0) {
  const before = String(text || "").slice(Math.max(0, Number(index) - 12), Math.max(0, Number(index)));
  return /(?:^|[^A-Z0-9])[A-Z]{1,8}\/$/i.test(before);
}

/** Blank out Ref. No. tokens so their digits cannot be mistaken for Party's Name codes. */
export function stripBillRefNumbers(text = "") {
  return String(text || "").replace(/\b[A-Z]{2,8}\/\d{2,5}\b/gi, " ");
}
const BILL_MONEY_RE = /\b\d{1,3}(?:,\d{3})*\.\d{2}\b/g;
const BILL_STATE_RE = /\b(?:Riyadh|Jeddah|Dammam|Makkah|Madinah|Khobar|Qassim|Asir|Tabuk|Hail|Jazan|Najran|Baha|Northern Borders|Aljouf)\b/gi;
const REMARK_CUE_RE = /\b(good return|follow[\s/-]?up|sunday|expected|blanace|balance\s+confirmation|stock\s+returns?|shop\s+closed|write\s*off|payment\s+\d|goods\s+will|if\s+not\s+then\s+legal|dealyed|delayed|wrong\s+credit|an\s+email|aproximately|approximately|taken\s+back|case\s+is|court\s+has|purchas|fallwing|following\s+up|client'?s?\s+file)\b/i;
const COMPANY_NAME_RE = /\b(?:Trading(?:\s+Co\.?|\s+Company|\s+Est\.?)?|Company|Est\.?|Ltd\.?|Limited|Wholesale|Lemted)\b/i;
/** Known field users / salesmen that OCR often bleeds into the Remarks column (spaced or glued). */
const KNOWN_SALESMAN_NAME_PATTERN = String.raw`Ahmed\s*Nabil|ABDALLA\s*ANTHANATH|Abdulla\s*Anthanath|Abdul\s*Rehman|ABDUL\s*REHMAN|Moinudin(?:din)?|MOINUDIN(?:DIN)?|Parvez|PARVEZ|Junaid|JUNAID|Osama|OSAMA|Ahmed\s*Had(?:yah|ia|iya)|Ahmed\s*hadyah|Soyeb|Fazlur(?:\s*Rah(?:man|iman))?`;
/** At least two Title-Case tokens (First Last) before lowercase remark prose. */
const LEADING_PERSON_NAME_RE = /^(?:[A-Z][A-Za-z.'-]*)(?:\s+[A-Z][A-Za-z.']*){1,3}\s+(?=[a-z\u0600-\u06FF(])/;
/** OCR often glues the salesman cell then pads with underscores before the remark. */
const LEADING_GLUED_NAME_PAD_RE = /^(?:[A-Z][A-Za-z]{2,40})\s*_+\s*(?=[a-z\u0600-\u06FF(])/;
const LEADING_PARTY_NAME_RE = /^(?:[A-Za-z\u0600-\u06FF][A-Za-z\u0600-\u06FF0-9 .,&'/-]{0,80}?\b(?:Trading(?:\s+Co\.?|\s+Company|\s+Est\.?)?|Company|Est\.?|Ltd\.?|Wholesale|Lemted)\.?\s*)+/i;
const TRAILING_BILL_NOISE_RE = /(?:\s+\d{1,2}-[A-Za-z]{3}-\d{2}|\s+[A-Z]{2,8}\/\d{2,5}|\s+\d{1,3}(?:,\d{3})*\.\d{2})+\s*$/g;
/** Prefix before a remark cue that is only a name (letters/spaces) plus OCR underscore padding. */
const NAME_LIKE_BEFORE_CUE_RE = /^(?:[A-Za-z][A-Za-z .,'-]{1,60}|[A-Z][A-Za-z]{2,40})[\s_=\-]{0,20}$/;

function knownSalesmanNameRe(flags = "i") {
  return new RegExp(`(?:${KNOWN_SALESMAN_NAME_PATTERN})`, flags);
}

function textAfterAnchor(text, anchor, code, length = 100) {
  const start = Math.max(0, Number(anchor) || 0) + String(code || "").length;
  return cleanCollectionRemarkText(String(text || "").slice(start, start + length));
}

/**
 * True when the text after a digit run looks like a Party's Name / ledger label,
 * not Invoice→Sales person noise (`7258 Ahmed Nabil…`).
 */
export function looksLikeLedgerPartyNameAfterCode(after = "") {
  const snippet = cleanCollectionRemarkText(after)
    .replace(/^(?:[_\-\s—–\[\|]+)/, "")
    .slice(0, 120);
  if (!snippet) return false;

  const leadingName = snippet.match(/^([A-Za-z\u0600-\u06FF][A-Za-z\u0600-\u06FF .,'-]{0,60})/);
  const nameHead = String(leadingName?.[1] || "").trim();
  if (!nameHead) return false;
  if (knownSalesmanNameRe("i").test(nameHead)) return false;
  if (/^(Riyadh|Jeddah|Dammam|Never|FAR|Pending|Overdue)\b/i.test(nameHead)) return false;

  if (COMPANY_NAME_RE.test(snippet)) return true;

  const beforeNoise = snippet.split(
    /\b(?:Riyadh|Jeddah|Dammam|Makkah|Madinah|Khobar|\d{1,3}(?:,\d{3})*\.\d{2}|Never|FAR)\b/i,
  )[0] || snippet;
  const words = beforeNoise.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2 && /^[A-Za-z\u0600-\u06FF]/.test(words[0])) return true;
  // Underscore-glued ledger: "Bahr" alone after 1468_ still counts with company later,
  // or a long first token that is not a salesman.
  if (words.length >= 1 && /[A-Za-z\u0600-\u06FF]{4,}/.test(words[0]) && !/^(Ahmed|Osama|Parvez|Junaid|Soyeb|Fazlur|ABDALLA|ABDUL|MOIN)/i.test(words[0])) {
    return true;
  }
  return false;
}

/** Pull the human ledger/party label that follows a leading account code. */
export function extractLedgerPartyNameAfterCode(after = "") {
  const snippet = cleanCollectionRemarkText(after).replace(/^(?:[_\-\s—–\[\|]+)/, "");
  if (!snippet) return "";
  const cut = snippet.split(
    /\b(?:Riyadh|Jeddah|Dammam|Makkah|Madinah|Khobar|Qassim|Asir|Tabuk|Hail|Jazan|Najran|Baha|Northern Borders|Aljouf|Rivach|Riyach|\d{1,3}(?:,\d{3})*\.\d{2}|Never|FAR)\b/i,
  )[0] || snippet;
  const name = cleanCollectionRemarkText(cut)
    .replace(/[\[\]|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!name || knownSalesmanNameRe("i").test(name) || name.length < 4) return "";
  return name.slice(0, 120);
}

export function normalizeCollectionRemarkCustomerCode(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "";
  // Allow ledger forms like 1468_Bahr… / 1058 Al… (underscore is a word char, so \b fails).
  const fromPrefix = raw.match(/^(\d{3,5}C?)(?=$|[^A-Z0-9])/i);
  if (fromPrefix) return fromPrefix[1].toUpperCase();
  const anywhere = raw.match(/(?:^|[^A-Z0-9])(\d{3,5}C?)(?=$|[^A-Z0-9])/i);
  return anywhere ? anywhere[1].toUpperCase() : "";
}

/**
 * OCR often drops a leading 1 or pads zeros (055 → 1055, 478 → 1478).
 * Expand lookup candidates without inventing codes that are not in the master.
 */
export function expandCollectionRemarkCustomerCodeCandidates(value) {
  const raw = normalizeCollectionRemarkCustomerCode(value);
  if (!raw) return [];

  const hasC = /C$/i.test(raw);
  const digits = raw.replace(/C$/i, "");
  const stem = digits.replace(/^0+/, "") || digits;
  const out = new Set();

  const add = (code) => {
    const normalized = String(code || "").trim().toUpperCase();
    if (/^\d{3,5}C?$/.test(normalized)) out.add(normalized);
  };

  add(raw);
  add(digits);
  add(stem);
  add(`${stem}C`);
  if (hasC) add(`${digits}C`);

  // Common OCR miss: leading 1 dropped from a 4-digit Madiba code.
  if (stem.length === 3) {
    add(`1${stem}`);
    add(`1${stem}C`);
  }
  if (/^0\d{3}$/.test(digits)) {
    add(`1${digits.slice(1)}`);
    add(`1${digits.slice(1)}C`);
  }
  if (/^0\d{2}$/.test(digits)) {
    add(`1${digits}`);
    add(`1${digits}C`);
    add(`1${stem}`);
    add(`1${stem}C`);
  }

  return [...out];
}

/**
 * Pick a unique known master code that matches the OCR/parsed value.
 * Prefers exact, then C-suffix, then longer canonical forms.
 */
export function resolveCollectionRemarkCustomerCodeFromKnown(value, knownCodes = []) {
  const candidates = expandCollectionRemarkCustomerCodeCandidates(value);
  if (!candidates.length) return "";

  const known = [...new Set(
    (knownCodes || [])
      .map((code) => String(code || "").trim().toUpperCase())
      .filter(Boolean),
  )];
  if (!known.length) return "";

  const exact = candidates.find((code) => known.includes(code));
  if (exact) return exact;

  const matches = known.filter((knownCode) => {
    const knownStem = knownCode.replace(/C$/i, "").replace(/^0+/, "") || knownCode;
    return candidates.some((candidate) => {
      const candidateStem = candidate.replace(/C$/i, "").replace(/^0+/, "") || candidate;
      if (knownCode === candidate || knownStem === candidateStem) return true;
      // 1058 ↔ 1058C
      if (knownStem === candidateStem && (/C$/i.test(knownCode) || /C$/i.test(candidate))) return true;
      return false;
    });
  });

  if (matches.length === 1) return matches[0];
  if (!matches.length) return "";

  // Prefer bare/C forms that equal a candidate; else longest canonical code.
  const preferred = matches.find((code) => candidates.includes(code));
  if (preferred) return preferred;
  return matches.slice().sort((left, right) => {
    if (right.length !== left.length) return right.length - left.length;
    return left.localeCompare(right);
  })[0] || "";
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

  // Drop salesman column values at the start (known names, glued OCR, then Title Case).
  text = text.replace(
    new RegExp(`^(?:${KNOWN_SALESMAN_NAME_PATTERN})[\\s_=:\\-]{0,20}`, "i"),
    "",
  );
  text = text.replace(LEADING_GLUED_NAME_PAD_RE, "");
  text = text.replace(LEADING_PERSON_NAME_RE, "");
  text = text.replace(/^[_=\-\s]+/, "");

  // If a remark cue appears after leftover name/noise, keep from the cue onward.
  const cueIdx = text.search(REMARK_CUE_RE);
  if (cueIdx > 0) {
    const before = text.slice(0, cueIdx).trim();
    if (
      !before
      || COMPANY_NAME_RE.test(before)
      || knownSalesmanNameRe("i").test(before)
      || NAME_LIKE_BEFORE_CUE_RE.test(before)
    ) {
      text = text.slice(cueIdx);
    }
  }

  // Final pass: strip a leading known salesman token (spaced or glued) if still present.
  text = text.replace(
    new RegExp(`^(?:${KNOWN_SALESMAN_NAME_PATTERN})[\\s_=:\\-]{0,20}`, "i"),
    "",
  );
  text = text.replace(LEADING_GLUED_NAME_PAD_RE, "");
  text = text.replace(/^[_=\-\s]+/, "");
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

function trimRemarkRowBleed(text = "") {
  return cleanCollectionRemarkText(text)
    .replace(/\s+\d{1,2}[-_/]?[A-Za-z]{0,3}[-_/]?\d{0,2}\s*[\[|_].*$/i, "")
    .replace(/\s+\d{1,2}-[A-Za-z]{3}-\d{2}\b.*$/i, "")
    .replace(/\s+\b[A-Z]{2,8}\/\d{2,5}\b.*$/i, "")
    .replace(/\s*\[[\s|_]*$/g, "")
    .trim();
}

function extractRemarkFromBillsSegment(segment) {
  const raw = String(segment || "");
  if (!raw.trim()) return "";

  const cue = raw.search(REMARK_CUE_RE);
  if (cue >= 0) {
    const fromCue = trimRemarkRowBleed(raw.slice(cue));
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
    const candidate = trimRemarkRowBleed(lowerChunk[0]);
    if (!isNoiseRemark(candidate)) return candidate;
  }

  const cleaned = trimRemarkRowBleed(text);
  return isNoiseRemark(cleaned) ? "" : cleaned;
}

function mergeCodeCandidates(...lists) {
  const out = [];
  const seen = new Set();
  lists.flat().forEach((value) => {
    const code = normalizeCollectionRemarkCustomerCode(value);
    if (!code || seen.has(code)) return;
    if (YEAR_LIKE_CODE_RE.test(code)) return;
    seen.add(code);
    out.push(code);
  });
  return out;
}

/**
 * After each Ref. No., take the next account code that is not the ref's own digits.
 * Handles OCR: `NFD/986 [1468 Bohr…`, `NFD/986 1468_Bahr…`.
 */
export function extractPartyCodesAfterBillRefs(segment = "") {
  const text = String(segment || "");
  const out = [];
  for (const match of text.matchAll(/\b[A-Z]{2,8}\/(\d{2,5})\b([\s\S]{0,48})/gi)) {
    const refDigits = String(match[1] || "").toUpperCase();
    const after = String(match[2] || "");
    const party = after.match(/^[\s\[\|_-]+(\d{3,5}C?)(?=$|[^A-Z0-9])/i);
    const code = String(party?.[1] || "").toUpperCase();
    if (!code || code === refDigits || YEAR_LIKE_CODE_RE.test(code)) continue;
    out.push(code);
  }
  return out;
}

/**
 * Collect every code-like token on a Bills Receivable row:
 * Party's Name after Ref. No. first, then other ledger/invoice-style numbers.
 * Never treat Ref. No. digits (NFD/986 → 986) as a customer code.
 * Server keeps whichever candidate exists in the customer master.
 */
export function extractBillRowCodeCandidates(segment = "", { primaryCode = "" } = {}) {
  const text = String(segment || "");
  const withoutRefs = stripBillRefNumbers(text);
  const afterRef = extractPartyCodesAfterBillRefs(text);
  const ledger = [];
  const other = [];

  // Strongest signal: number immediately after Ref. No. that starts the party/ledger name.
  for (const match of text.matchAll(BILL_REF_PARTY_CODE_RE)) {
    const code = String(match[1] || "").toUpperCase();
    if (code) afterRef.push(code);
  }
  // Underscore / bracket party forms: NFD/986 [1468 Bohr… or 1468_Bahr…
  for (const match of text.matchAll(/\b[A-Z]{2,8}\/\d{2,5}[\s\[\|_-]+(\d{3,5}C?)(?=[_\-\s\[]*[A-Za-z\u0600-\u06FF])/gi)) {
    const code = String(match[1] || "").toUpperCase();
    if (code) afterRef.push(code);
  }

  for (const match of withoutRefs.matchAll(LEDGER_PARTY_CODE_RE)) {
    const code = String(match[1] || "").toUpperCase();
    if (!code) continue;
    // Map match index back roughly via search in original when possible.
    const codePos = text.toUpperCase().indexOf(code);
    if (codePos >= 0 && isBillRefNumberFragment(text, codePos)) continue;
    const after = textAfterAnchor(withoutRefs, match.index, code);
    if (looksLikeLedgerPartyNameAfterCode(after)) ledger.push(code);
    else other.push(code);
  }

  // Invoice / overdue fragments before a name — still ignore Ref. No. tails.
  for (const match of withoutRefs.matchAll(/(?<![,\d.])(\d{3,5}C?)(?=\s+[A-Za-z\u0600-\u06FF])/gi)) {
    const code = String(match[1] || "").toUpperCase();
    if (!code) continue;
    const codePos = text.toUpperCase().indexOf(code);
    if (codePos >= 0 && isBillRefNumberFragment(text, codePos)) continue;
    other.push(code);
  }

  return mergeCodeCandidates([primaryCode], afterRef, ledger, other);
}

function buildRow(customerCode, remark, source = "ocr", partyName = "", extraCandidates = []) {
  const code = normalizeCollectionRemarkCustomerCode(customerCode);
  const cleaned = sanitizeCollectionRemarkComment(remark, { customerCode: code });
  if ((!code && !extraCandidates?.length) || isNoiseRemark(cleaned)) return null;
  const visitOutcome = suggestCollectionRemarkVisitOutcome(cleaned);
  const ledgerName = extractLedgerPartyNameAfterCode(partyName) || extractLedgerPartyNameAfterCode(
    String(partyName || "").replace(new RegExp(`^${code}\\b[_\-\\s—–]*`, "i"), ""),
  );
  const customerCodeCandidates = mergeCodeCandidates([code], extraCandidates);
  const primary = code || customerCodeCandidates[0] || "";
  if (!primary) return null;
  return {
    customerCode: primary,
    customerCodeCandidates,
    partyName: ledgerName,
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
  const mergedCandidates = mergeCodeCandidates(
    existing.customerCodeCandidates,
    row.customerCodeCandidates,
    [existing.customerCode, row.customerCode],
  );
  const partyName = row.partyName?.length > (existing.partyName?.length || 0)
    ? row.partyName
    : existing.partyName;
  if (row.remark.length > existing.remark.length) {
    rowsByCode.set(row.customerCode, {
      ...existing,
      ...row,
      customerCodeCandidates: mergedCandidates,
      partyName,
    });
    return;
  }
  if (row.remark && !existing.remark.toLowerCase().includes(row.remark.toLowerCase())) {
    const combinedRemark = `${existing.remark} | ${row.remark}`;
    rowsByCode.set(row.customerCode, {
      ...existing,
      remark: combinedRemark,
      customerCodeCandidates: mergedCandidates,
      partyName,
      visitOutcome: suggestCollectionRemarkVisitOutcome(combinedRemark),
      paymentStatus: suggestCollectionRemarkPaymentStatus(
        suggestCollectionRemarkVisitOutcome(combinedRemark),
      ),
    });
    return;
  }
  rowsByCode.set(row.customerCode, {
    ...existing,
    customerCodeCandidates: mergedCandidates,
    partyName,
  });
}

function collectCustomerCodeMatchAnchors(text, regex, { requireLedgerName = false } = {}) {
  return [...String(text || "").matchAll(regex)]
    .map((match) => {
      const code = String(match[1] || match[2] || match[3] || "").toUpperCase();
      if (!code) return null;
      // For Ref→party patterns, group 1 is already the party code (after NFD/986).
      // For bare ledger matches, skip digits that are the Ref. No. tail itself.
      const codeInMatch = String(match[0] || "").toUpperCase().indexOf(code);
      const absoluteCodeIndex = match.index + Math.max(0, codeInMatch);
      if (isBillRefNumberFragment(text, absoluteCodeIndex)) return null;
      const codePos = String(text).toUpperCase().indexOf(code, match.index);
      const anchor = codePos >= 0 ? codePos : match.index;
      const after = textAfterAnchor(text, anchor, code);
      if (requireLedgerName && !looksLikeLedgerPartyNameAfterCode(after)) return null;
      return {
        code,
        anchor,
        index: match.index,
        partyName: extractLedgerPartyNameAfterCode(after),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.anchor - right.anchor);
}

function splitBillsReceivableRowSegments(text = "") {
  const source = String(text || "");
  // OCR mangledates (`131un-26`) often; Ref. No. (NFD/986) survives and is the best row splitter.
  const refStarts = [...source.matchAll(/\b[A-Z]{2,8}\/\d{2,5}\b/gi)]
    .map((match) => match.index)
    .filter((index) => Number.isInteger(index));
  if (refStarts.length >= 1) {
    return refStarts.map((start, index) => {
      const end = index + 1 < refStarts.length ? refStarts[index + 1] : source.length;
      const lookBehind = source.slice(Math.max(0, start - 18), start);
      const prefix = lookBehind.match(/(\d{1,2}[-_/]?[A-Za-z]{0,3}[-_/]?\d{0,2}|[A-Za-z]{1,3}\d{1,2})[\s\[|_]*$/);
      const segStart = prefix ? start - prefix[0].length : start;
      return source.slice(Math.max(0, segStart), end);
    }).filter((segment) => segment.trim());
  }

  // Only bill-row start dates (line start / after newline), never the Due-on date mid-row.
  const dateStarts = [...source.matchAll(/(?:^|[\n\r])\s*(\d{1,2}-[A-Za-z]{3}-\d{2})\b/gi)]
    .map((match) => {
      const full = match[0] || "";
      const date = match[1] || "";
      const offset = full.indexOf(date);
      return match.index + Math.max(0, offset);
    })
    .filter((index) => Number.isInteger(index));
  if (dateStarts.length >= 2) {
    return dateStarts.map((start, index) => {
      const end = index + 1 < dateStarts.length ? dateStarts[index + 1] : source.length;
      return source.slice(start, end);
    }).filter((segment) => segment.trim());
  }

  const ledgerAnchors = collectCustomerCodeMatchAnchors(source, LEDGER_PARTY_CODE_RE, {
    requireLedgerName: true,
  });
  const refAnchors = collectCustomerCodeMatchAnchors(source, BILL_REF_PARTY_CODE_RE, {
    requireLedgerName: true,
  });
  const fallbackAnchors = ledgerAnchors.length
    ? ledgerAnchors
    : (refAnchors.length
      ? refAnchors
      : collectCustomerCodeMatchAnchors(source, CUSTOMER_CODE_RE, { requireLedgerName: false }));
  if (!fallbackAnchors.length) return source.trim() ? [source] : [];

  return fallbackAnchors.map((entry, index) => {
    const end = index + 1 < fallbackAnchors.length ? fallbackAnchors[index + 1].anchor : source.length;
    return source.slice(entry.anchor, end);
  }).filter((segment) => segment.trim());
}

/**
 * Bills Receivable / Pending Bills OCR.
 * Per row, collect ledger Party's Name codes AND Invoice/overdue-style numbers;
 * the API keeps whichever candidate exists in the customer master.
 */
export function parseBillsReceivableOcrText(ocrText = "") {
  const text = String(ocrText || "").replace(/\r/g, "\n");
  if (!text.trim()) return [];

  const segments = splitBillsReceivableRowSegments(text);
  if (!segments.length) return [];

  const rowsByCode = new Map();
  segments.forEach((segment) => {
    const afterRefCodes = extractPartyCodesAfterBillRefs(segment);
    const refPartyAnchors = collectCustomerCodeMatchAnchors(segment, BILL_REF_PARTY_CODE_RE, {
      requireLedgerName: true,
    });
    const ledgerAnchors = collectCustomerCodeMatchAnchors(stripBillRefNumbers(segment), LEDGER_PARTY_CODE_RE, {
      requireLedgerName: true,
    });
    const primaryCode = afterRefCodes[0] || refPartyAnchors[0]?.code || ledgerAnchors[0]?.code || "";
    const partyName = (() => {
      if (!primaryCode) {
        return extractLedgerPartyNameAfterCode(stripBillRefNumbers(segment));
      }
      const idx = segment.toUpperCase().indexOf(primaryCode);
      if (idx >= 0) return extractLedgerPartyNameAfterCode(textAfterAnchor(segment, idx, primaryCode));
      return refPartyAnchors[0]?.partyName
        || ledgerAnchors[0]?.partyName
        || extractLedgerPartyNameAfterCode(stripBillRefNumbers(segment));
    })();
    const candidates = extractBillRowCodeCandidates(segment, { primaryCode });
    if (!candidates.length) return;
    const remark = extractRemarkFromBillsSegment(segment);
    const row = buildRow(
      primaryCode || candidates[0],
      remark,
      "ocr-bills",
      partyName || segment,
      candidates,
    );
    if (row) upsertRemarkRow(rowsByCode, row);
  });

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

  // WhatsApp Bills OCR fills rows with `|` noise (`|AhmedNabil______|sunday…`).
  // That must NOT route through the paste-table parser (it grabs Ref. No. digits like 986).
  if (prefer !== "table" && looksLikeBillsReceivableText(text)) {
    const billRows = parseBillsReceivableOcrText(text);
    if (billRows.length) return billRows;
  }

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
    const customerCodeCandidates = mergeCodeCandidates(
      [customerCode],
      row?.customerCodeCandidates || row?.customer_code_candidates || [],
    );
    const partyName = extractLedgerPartyNameAfterCode(row?.partyName || row?.party_name || "")
      || extractLedgerPartyNameAfterCode(String(row?.customerCode || row?.customer_code || ""));
    const remark = sanitizeCollectionRemarkComment(
      row?.remark || row?.remark_english || row?.remarks,
      { customerCode },
    );
    const primary = customerCode || customerCodeCandidates[0] || "";
    if (!primary || !remark || isNoiseRemark(remark)) return;
    if (seen.has(primary)) return;
    seen.add(primary);

    let visitOutcome = String(row?.visitOutcome || row?.visit_outcome || "").trim().toUpperCase();
    if (!COLLECTION_REMARK_IMPORT_OUTCOMES.includes(visitOutcome)) {
      visitOutcome = suggestCollectionRemarkVisitOutcome(remark);
    }
    const paymentStatus = String(row?.paymentStatus || row?.payment_status || "")
      .trim()
      .toUpperCase()
      || suggestCollectionRemarkPaymentStatus(visitOutcome);

    out.push({
      id: String(row?.id || `${primary}-${index}`),
      customerCode: primary,
      customerCodeCandidates,
      partyName,
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
