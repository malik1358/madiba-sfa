import {
  parseOutstandingSheetDate,
  resolveInvoiceDays,
  resolveOverdueDaysFromDueDate,
  toNumber,
} from "./outstanding.js";
import { amountInclVatFromExcl, vatRateForProduct } from "./regionalPricing.js";
import {
  HISTORIC_PERFORMANCE_MONTHS,
  ksaMonthKey,
  shiftMonthKey,
} from "./monthlyPerformanceMonths.js";
import { getKsaDateString } from "./workdayActivity.js";
import { isPaymentVoucherType } from "./receiptRegister.js";

export const HISTORIC_PERFORMANCE_SHORT_LABEL = `${HISTORIC_PERFORMANCE_MONTHS}m`;
export const HISTORIC_PERFORMANCE_PERIOD_LABEL = `Last ${HISTORIC_PERFORMANCE_MONTHS} months`;

function dateOnly(value) {
  return parseOutstandingSheetDate(value) || String(value || "").slice(0, 10);
}

function isoDaysBetween(laterIso, earlierIso) {
  const offset = isoDayOffset(earlierIso, laterIso);
  if (offset == null) return null;
  return Math.max(0, offset);
}

/** Signed day gap from `fromIso` → `toIso` (negative when toIso is earlier). */
function isoDayOffset(fromIso, toIso) {
  const from = dateOnly(fromIso);
  const to = dateOnly(toIso);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
  return Math.round((toMs - fromMs) / 86400000);
}

function roundDays(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number);
}

function median(values) {
  const sorted = [...values].filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/** Same-day / next-day full CNs reverse immediately; exact item+qty mirrors reverse on any later date. */
export const IMMEDIATE_REVERSAL_MAX_DAYS = 1;
/** Two amounts count as the same bill (exact Payment↔Purchase, compare). Not a reason to drop money. */
const AMOUNT_TOLERANCE = 0.02;
/** Float noise only. A posted halala (0.01) is real money and must still settle. */
const SETTLEMENT_DUST = 0.0000005;

/**
 * Same halala rounding the settlement screen uses when it prints a money cell.
 * Invoice VAT is excl × 1.15, so the raw sum can be a halala away from the
 * sum of the rounded invoice amounts (customer 1073: 59,119.48 vs 59,119.49).
 */
function roundMoney(value) {
  const number = toNumber(value);
  if (!Number.isFinite(number)) return 0;
  return Number(number.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    useGrouping: false,
  }));
}

function sumMoney(values) {
  const cents = (Array.isArray(values) ? values : []).reduce(
    (total, value) => total + Math.round(roundMoney(value) * 100),
    0,
  );
  return cents / 100;
}

function hasSettlementAmount(amount) {
  return Math.abs(toNumber(amount)) > SETTLEMENT_DUST;
}

function invoiceKey(invoiceDate, voucherNumber) {
  return `${dateOnly(invoiceDate)}::${String(voucherNumber || "").trim()}`;
}

/**
 * Cash sales vouchers (RC / DC / JC / …): region letter(s) + C in the voucher
 * type/prefix (before /). Credit-style codes like CNFD / CN / RNFD are excluded.
 */
export function isCashSalesVoucher(voucherNumber = "") {
  const raw = String(voucherNumber || "").trim().toUpperCase();
  if (!raw) return false;
  if (
    /^(CN|SR)([\s\/-]|$)/.test(raw)
    || /\bCN\b/.test(raw)
    || raw.includes("CREDIT NOTE")
    || raw.includes("SALES RETURN")
  ) {
    return false;
  }
  const prefix = (raw.split(/[\/\-\s]/)[0] || raw).replace(/[^A-Z0-9]/g, "");
  // RC, DC, JC, C, RC100 — not CNFD / NFD / RNFD.
  return /^[A-Z]{0,2}C\d*$/.test(prefix);
}

/** Voucher type such as RIYADH CASH SALES or CASH SALES NON FOOD DIVISION. */
export function isCashSalesVoucherType(voucherType = "") {
  return String(voucherType || "").toUpperCase().includes("CASH");
}

/**
 * Left out of avg days only. FIFO Paid/Open is unchanged.
 * RC/DC/JC, a CASH voucher type (CNFD cash sales, Riyadh/Dammam cash), or a
 * voucher already marked from sales history.
 */
export function isExcludedFromAvgDays(row = {}, cashRefs = null) {
  if (row?.exclude_from_avg_days || row?.is_cash) return true;
  if (isCashSalesVoucherType(row?.voucher_type)) return true;
  const ref = String(row?.ref_no || row?.voucher_number || "").trim();
  if (isCashSalesVoucher(ref)) return true;
  const key = String(ref || "").trim().toUpperCase().replace(/\s+/g, "");
  return Boolean(key && cashRefs?.has?.(key));
}

function normalizeRef(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function amountsMatch(left, right, tolerance = AMOUNT_TOLERANCE) {
  return Math.abs(toNumber(left) - toNumber(right)) <= tolerance;
}

function lineVatInclAmount(row, amountExclVat) {
  const vatRate = vatRateForProduct({
    category: row?.category,
    item_name: row?.item_name,
    item_code: row?.item_code,
  });
  return amountInclVatFromExcl(amountExclVat, vatRate);
}

/** Stable line fingerprint for cross-matching CN ↔ invoice within ±1 day. */
function lineItemFingerprint(row = {}) {
  const code = normalizeRef(row.item_code || row.item_name || "");
  if (!code) return "";
  const qty = Math.abs(toNumber(row.quantity));
  const amount = Math.abs(toNumber(row.sales_amount));
  return `${code}|${qty.toFixed(3)}|${amount.toFixed(2)}`;
}

function pushItemFingerprint(target, row) {
  const code = normalizeRef(row?.item_code || row?.item_name || "");
  const fingerprint = lineItemFingerprint(row);
  if (!Array.isArray(target.items)) target.items = [];
  if (!Array.isArray(target.item_codes)) target.item_codes = [];
  if (fingerprint) target.items.push(fingerprint);
  if (code) target.item_codes.push(code);
}

function itemOverlapCount(leftItems = [], rightItems = []) {
  const right = new Map();
  (Array.isArray(rightItems) ? rightItems : []).forEach((key) => {
    right.set(key, (right.get(key) || 0) + 1);
  });
  let overlap = 0;
  (Array.isArray(leftItems) ? leftItems : []).forEach((key) => {
    const available = right.get(key) || 0;
    if (available <= 0) return;
    overlap += 1;
    right.set(key, available - 1);
  });
  return overlap;
}

/** Multiset equality for fingerprint lists (order-independent). */
function fingerprintMultisetsEqual(leftItems = [], rightItems = []) {
  const left = Array.isArray(leftItems) ? leftItems.filter(Boolean) : [];
  const right = Array.isArray(rightItems) ? rightItems.filter(Boolean) : [];
  if (left.length === 0 || right.length === 0) return false;
  if (left.length !== right.length) return false;
  return itemOverlapCount(left, right) === left.length;
}

/** code|qty only — ignores line amount so CN sign/abs differences still match. */
function itemQtyFingerprints(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((fingerprint) => {
      const parts = String(fingerprint || "").split("|");
      if (parts.length < 2) return "";
      return `${parts[0]}|${parts[1]}`;
    })
    .filter(Boolean);
}

/**
 * True when both vouchers share the same item codes and quantities
 * (full mirror return / reissue cancel), regardless of line-amount sign.
 */
export function itemsAndQtyExactlyMatch(leftItems = [], rightItems = []) {
  return fingerprintMultisetsEqual(
    itemQtyFingerprints(leftItems),
    itemQtyFingerprints(rightItems),
  );
}

function itemCodeOverlapCount(leftCodes = [], rightCodes = []) {
  const right = new Map();
  (Array.isArray(rightCodes) ? rightCodes : []).forEach((code) => {
    const key = normalizeRef(code);
    if (!key) return;
    right.set(key, (right.get(key) || 0) + 1);
  });
  let overlap = 0;
  (Array.isArray(leftCodes) ? leftCodes : []).forEach((code) => {
    const key = normalizeRef(code);
    if (!key) return;
    const available = right.get(key) || 0;
    if (available <= 0) return;
    overlap += 1;
    right.set(key, available - 1);
  });
  return overlap;
}

/** Credit notes / sales returns: typed voucher, CN/SR voucher codes, or negative amount/qty. */
export function isCreditNoteTransaction(row = {}) {
  const type = String(row?.voucher_type || "").trim().toUpperCase();
  if (
    type.includes("CREDIT NOTE")
    || type.includes("CREDITNOTE")
    || type === "CN"
    || type.includes("SALES RETURN")
    || /\bSR\b/.test(type)
    || type.includes("RETURN")
  ) {
    return true;
  }

  const voucher = String(row?.voucher_number || "").trim().toUpperCase();
  const reference = String(row?.reference || "").trim().toUpperCase();
  const haystack = `${voucher} ${reference}`.trim();
  // Common Tally-style codes: CN/149, SR-12, CN 88 — even when amount is stored positive.
  if (
    /^(CN|SR)([\s\/-]|$)/.test(voucher)
    || /\b(CN|SR)\b/.test(haystack)
    || haystack.includes("CREDIT NOTE")
    || haystack.includes("SALES RETURN")
  ) {
    return true;
  }

  if (toNumber(row?.sales_amount) < 0) return true;
  if (toNumber(row?.quantity) < 0) return true;
  return false;
}

function sortVoucherRows(rows) {
  return [...rows].sort((left, right) => {
    const leftDate = left.invoice_date || left.credit_date || "";
    const rightDate = right.invoice_date || right.credit_date || "";
    if (leftDate !== rightDate) return String(leftDate).localeCompare(String(rightDate));
    return String(left.voucher_number || "").localeCompare(String(right.voucher_number || ""));
  });
}

/**
 * Collapse sales history lines into invoice-level rows (voucher + date).
 * Sales amounts are exclusive of VAT; receipts are inclusive, so each line is
 * grossed up at 15% unless it is a catalog gloves product. Building-material
 * safety gloves stay at 15%.
 */
export function buildSalesInvoices(transactions = []) {
  const map = new Map();

  (Array.isArray(transactions) ? transactions : []).forEach((row) => {
    if (isCreditNoteTransaction(row)) return;
    const invoiceDate = dateOnly(row?.transaction_date);
    if (!invoiceDate) return;
    const amountExclVat = toNumber(row?.sales_amount);
    if (amountExclVat <= 0) return;

    const amountInclVat = lineVatInclAmount(row, amountExclVat);
    const voucher = String(row?.voucher_number || row?.reference || "").trim();
    const voucherType = String(row?.voucher_type || "").trim();
    const lineExcluded = isCashSalesVoucher(voucher) || isCashSalesVoucherType(voucherType);
    const key = `${invoiceDate}::${voucher || "NO-VOUCHER"}`;
    const current = map.get(key) || {
      invoice_date: invoiceDate,
      voucher_number: voucher,
      voucher_type: voucherType,
      amount_excl_vat: 0,
      amount: 0,
      remaining: 0,
      exclude_from_avg_days: lineExcluded,
      items: [],
      item_codes: [],
    };
    current.amount_excl_vat += amountExclVat;
    current.amount += amountInclVat;
    current.remaining = current.amount;
    current.exclude_from_avg_days = current.exclude_from_avg_days && lineExcluded;
    if (voucherType && !current.voucher_type) current.voucher_type = voucherType;
    pushItemFingerprint(current, row);
    map.set(key, current);
  });

  return sortVoucherRows([...map.values()]);
}

/**
 * Collapse credit-note / sales-return lines into vouchers (absolute amounts, VAT-incl).
 * Detects negative sales amounts and Credit Note / Sales Return voucher types
 * (even when the Excel amount is stored as a positive figure).
 */
export function buildCreditNotes(transactions = []) {
  const map = new Map();

  (Array.isArray(transactions) ? transactions : []).forEach((row) => {
    if (!isCreditNoteTransaction(row)) return;
    const creditDate = dateOnly(row?.transaction_date);
    if (!creditDate) return;
    const rawAmount = toNumber(row?.sales_amount);
    if (rawAmount === 0) return;
    const absExcl = Math.abs(rawAmount);

    const amountInclVat = lineVatInclAmount(row, absExcl);
    const voucher = String(row?.voucher_number || row?.reference || "").trim();
    const reference = String(row?.reference || "").trim();
    const voucherType = String(row?.voucher_type || "").trim();
    const key = `${creditDate}::${voucher || "NO-VOUCHER"}`;
    const current = map.get(key) || {
      credit_date: creditDate,
      voucher_number: voucher,
      reference,
      voucher_type: voucherType,
      kind: classifyCreditNoteKind(voucherType, voucher),
      amount_excl_vat: 0,
      amount: 0,
      remaining: 0,
      items: [],
      item_codes: [],
    };
    current.amount_excl_vat += absExcl;
    current.amount += amountInclVat;
    current.remaining = current.amount;
    pushItemFingerprint(current, row);
    if (reference && !current.reference) current.reference = reference;
    if (voucherType && !current.voucher_type) {
      current.voucher_type = voucherType;
      current.kind = classifyCreditNoteKind(voucherType, voucher);
    }
    map.set(key, current);
  });

  return sortVoucherRows([...map.values()]);
}

export function classifyCreditNoteKind(voucherType = "", voucherNumber = "") {
  const haystack = `${voucherType} ${voucherNumber}`.toUpperCase();
  if (/\bSR\b/.test(haystack) || haystack.includes("SALES RETURN") || haystack.includes("RETURN")) {
    return "Sales Return";
  }
  if (/\bCN\b/.test(haystack) || haystack.includes("CREDIT")) {
    return "Credit Note";
  }
  return "Credit Note / Return";
}

/**
 * Attach unpaired credit notes / sales returns under matching invoices for display.
 * Matching order:
 * 1) invoices that share the CN's item codes (reference preferred)
 * 2) reference → invoice when the CN has no item lines
 * 3) ±1 day same amount (+ item fingerprints) — reissue pairs
 * 4) oldest invoice on/before the credit date (capacity fill)
 * Does not affect payment-days / FIFO cash.
 */
export function attachCreditNotesToInvoices(invoiceRows = [], creditNotes = []) {
  const invoices = Array.isArray(invoiceRows) ? invoiceRows : [];
  invoices.forEach((invoice) => {
    if (!Array.isArray(invoice.credit_notes)) invoice.credit_notes = [];
  });

  const notes = (Array.isArray(creditNotes) ? creditNotes : []).map((note) => ({
    ...note,
    remaining: toNumber(note.amount_incl_vat ?? note.amount),
    applied_to_voucher: note.applied_to_voucher || "",
    applied_to_date: note.applied_to_date || "",
    applied_parts: Array.isArray(note.applied_parts) ? [...note.applied_parts] : [],
  }));

  function pushCreditChild(invoice, note, amount) {
    if (amount <= AMOUNT_TOLERANCE) return;
    const noteIncl = toNumber(note.amount_incl_vat ?? note.amount);
    const noteExcl = toNumber(note.amount_excl_vat);
    const exclShare = noteIncl > 0.009 ? amount * (noteExcl / noteIncl) : amount;
    invoice.credit_notes.push({
      type: "credit_note",
      credit_date: note.credit_date,
      voucher_number: note.voucher_number,
      kind: note.kind || classifyCreditNoteKind(note.voucher_type, note.voucher_number),
      reference: note.reference || "",
      amount,
      amount_excl_vat: exclShare,
      days: null,
    });
    note.remaining = Math.max(0, toNumber(note.remaining) - amount);
    note.applied_parts.push({
      voucher_number: invoice.voucher_number,
      invoice_date: invoice.invoice_date,
      amount,
    });
    note.applied_to_voucher = note.applied_parts
      .map((part) => part.voucher_number)
      .filter(Boolean)
      .join(", ");
    note.applied_to_date = note.applied_parts[0]?.invoice_date || invoice.invoice_date;
  }

  function invoiceCreditCapacity(invoice) {
    return Math.max(0, toNumber(invoice.amount_incl_vat) - (invoice.credit_notes || [])
      .reduce((total, row) => total + toNumber(row.amount), 0));
  }

  function invoiceMatchesRef(invoice, ref) {
    if (!ref) return false;
    const voucher = normalizeRef(invoice.voucher_number);
    if (!voucher) return false;
    return ref.includes(voucher) || voucher.includes(ref);
  }

  // Pass 1: item-code overlap (reference is preference only).
  notes.forEach((note) => {
    if (toNumber(note.remaining) <= AMOUNT_TOLERANCE) return;
    const noteCodes = Array.isArray(note.item_codes) ? note.item_codes : [];
    if (!noteCodes.length) return;

    const ref = normalizeRef(note.reference);
    const candidates = invoices
      .map((invoice, index) => {
        if (String(note.credit_date || "") < String(invoice.invoice_date || "")) return null;
        const capacity = invoiceCreditCapacity(invoice);
        if (capacity <= AMOUNT_TOLERANCE) return null;
        const overlap = itemCodeOverlapCount(noteCodes, invoice.item_codes);
        if (overlap <= 0) return null;
        const refHit = invoiceMatchesRef(invoice, ref);
        return {
          invoice,
          index,
          score: (refHit ? 1000 : 0) + (overlap * 10) - index,
        };
      })
      .filter(Boolean)
      .sort((left, right) => right.score - left.score || left.index - right.index);

    for (const candidate of candidates) {
      const remaining = toNumber(note.remaining);
      if (remaining <= AMOUNT_TOLERANCE) break;
      const capacity = invoiceCreditCapacity(candidate.invoice);
      if (capacity <= AMOUNT_TOLERANCE) continue;
      pushCreditChild(candidate.invoice, note, Math.min(remaining, capacity));
    }
  });

  // Pass 2: no item lines — trust Tally reference.
  notes.forEach((note) => {
    const remaining = toNumber(note.remaining);
    if (remaining <= AMOUNT_TOLERANCE) return;
    if (Array.isArray(note.item_codes) && note.item_codes.length > 0) return;
    const ref = normalizeRef(note.reference);
    if (!ref) return;
    const invoice = invoices.find((row) => {
      if (String(note.credit_date || "") < String(row.invoice_date || "")) return false;
      return invoiceMatchesRef(row, ref);
    });
    if (!invoice) return;
    const capacity = invoiceCreditCapacity(invoice);
    if (capacity <= AMOUNT_TOLERANCE) return;
    pushCreditChild(invoice, note, Math.min(remaining, capacity));
  });

  // Pass 3: ±1 day amount + items (reissue orphans).
  notes.forEach((note) => {
    const remaining = toNumber(note.remaining);
    if (remaining <= AMOUNT_TOLERANCE) return;

    const candidates = invoices
      .map((invoice, index) => {
        const offset = isoDayOffset(note.credit_date, invoice.invoice_date);
        if (offset == null || Math.abs(offset) > IMMEDIATE_REVERSAL_MAX_DAYS) return null;
        const invoiceAmount = toNumber(invoice.amount_incl_vat ?? invoice.amount);
        const amountOk = amountsMatch(remaining, invoiceAmount)
          || amountsMatch(note.amount_incl_vat ?? note.amount, invoiceAmount);
        if (!amountOk) return null;
        const capacity = invoiceCreditCapacity(invoice);
        if (capacity <= AMOUNT_TOLERANCE) return null;
        const overlap = itemOverlapCount(note.items, invoice.items);
        const codeOverlap = itemCodeOverlapCount(note.item_codes, invoice.item_codes);
        const noteHasItems = Array.isArray(note.items) && note.items.length > 0;
        const invoiceHasItems = Array.isArray(invoice.items) && invoice.items.length > 0;
        if (noteHasItems && invoiceHasItems && overlap <= 0 && codeOverlap <= 0) return null;
        return {
          invoice,
          index,
          score: (Math.max(overlap, codeOverlap) * 100) + 50 - Math.abs(offset),
        };
      })
      .filter(Boolean)
      .sort((left, right) => right.score - left.score || left.index - right.index);

    const best = candidates[0];
    if (!best) return;
    pushCreditChild(best.invoice, note, Math.min(remaining, invoiceCreditCapacity(best.invoice)));
  });

  // Pass 4: capacity fill oldest-first.
  const sortedInvoices = [...invoices].sort((left, right) => {
    if (left.invoice_date !== right.invoice_date) {
      return String(left.invoice_date || "").localeCompare(String(right.invoice_date || ""));
    }
    return String(left.voucher_number || "").localeCompare(String(right.voucher_number || ""));
  });

  notes.forEach((note) => {
    let remaining = toNumber(note.remaining);
    if (remaining <= AMOUNT_TOLERANCE) return;
    for (const invoice of sortedInvoices) {
      if (remaining <= AMOUNT_TOLERANCE) break;
      if (String(note.credit_date || "") < String(invoice.invoice_date || "")) continue;
      const capacity = invoiceCreditCapacity(invoice);
      if (capacity <= AMOUNT_TOLERANCE) continue;
      pushCreditChild(invoice, note, Math.min(remaining, capacity));
      remaining = toNumber(note.remaining);
    }
  });

  invoices.forEach((invoice) => {
    invoice.credit_notes.sort((left, right) => {
      if (left.credit_date !== right.credit_date) {
        return String(left.credit_date || "").localeCompare(String(right.credit_date || ""));
      }
      return String(left.voucher_number || "").localeCompare(String(right.voucher_number || ""));
    });
  });

  return notes.map((note) => {
    const { remaining, ...rest } = note;
    return rest;
  });
}

/**
 * Pair invoices with credit notes that fully reverse them.
 *
 * 1) Explicit Ref. No. → voucher (amount match) claims first — oldest CN first — so
 *    identical same-day baskets (e.g. 1818/1819/1820) do not steal each other's CN.
 *    A CN dated before its referenced invoice is still allowed when the reference
 *    names that voucher (Tally forward Ref. No.); blank / unreferenced early CNs
 *    must not reverse a later reissue.
 *    If the named voucher is the same day as the credit note and an exact
 *    amount-and-items invoice from the day before is still open, the credit note
 *    reverses that earlier invoice (customer 1486: CN 552 → RNFD/414). The
 *    same-day named voucher stays open as the reissue.
 * 2) Same-day or next-day full amount (classic void / reissue cancel).
 *    A CN that already names a different voucher is skipped here.
 * 3) Any later date when amount AND items+qty exactly match (full mirror CN).
 *    A named CN is skipped here too unless the mirror is the named voucher.
 *
 * Orphan / blank CNs stay unpaired when a vouchered CN already covers the void.
 */
export function findImmediateCreditNoteReversals(
  invoices = [],
  creditNotes = [],
  { maxDays = IMMEDIATE_REVERSAL_MAX_DAYS } = {},
) {
  const unusedNotes = (Array.isArray(creditNotes) ? creditNotes : []).map((note) => ({
    ...note,
    remaining: toNumber(note.amount),
  }));
  const reversals = [];
  const reversedKeys = new Set();
  const invoiceList = Array.isArray(invoices) ? invoices : [];

  function noteAmountMatchesInvoice(note, invoiceAmount) {
    return amountsMatch(note.remaining, invoiceAmount)
      || amountsMatch(note.amount, invoiceAmount);
  }

  function noteRefsInvoice(note, invoice) {
    const noteRef = normalizeRef(note.reference);
    const invoiceRef = normalizeRef(invoice.voucher_number);
    if (!noteRef || !invoiceRef) return false;
    return noteRef.includes(invoiceRef) || invoiceRef.includes(noteRef);
  }

  function pushReversal(invoice, note, days) {
    note.remaining = 0;
    const invoiceAmount = toNumber(invoice.amount);
    const key = invoiceKey(invoice.invoice_date, invoice.voucher_number);
    reversedKeys.add(key);
    reversals.push({
      invoice_date: invoice.invoice_date,
      voucher_number: invoice.voucher_number,
      amount_excl_vat: toNumber(invoice.amount_excl_vat),
      amount_incl_vat: invoiceAmount,
      credit_note_date: note.credit_date,
      credit_note_voucher: note.voucher_number,
      credit_note_amount: toNumber(note.amount),
      credit_note_reference: note.reference || "",
      reversal_days: days,
      status: "Reversed",
    });
  }

  // Pass 1: referenced CNs claim their named invoice before fingerprint matching.
  // Oldest credit note first so an earlier explicit void (e.g. CN 44 → 1820) wins
  // over a later same-ref mirror; the later CN can still void another same-amount bill.
  const notesByDate = [...unusedNotes].sort((left, right) => {
    const byDate = String(left.credit_date || "").localeCompare(String(right.credit_date || ""));
    if (byDate !== 0) return byDate;
    return String(left.voucher_number || "").localeCompare(String(right.voucher_number || ""));
  });

  for (const note of notesByDate) {
    if (toNumber(note.remaining) <= AMOUNT_TOLERANCE) continue;
    if (!normalizeRef(note.reference)) continue;

    const targets = invoiceList
      .map((invoice, index) => {
        const key = invoiceKey(invoice.invoice_date, invoice.voucher_number);
        if (reversedKeys.has(key)) return null;
        const invoiceAmount = toNumber(invoice.amount);
        if (invoiceAmount <= AMOUNT_TOLERANCE) return null;
        if (!noteRefsInvoice(note, invoice)) return null;
        if (!noteAmountMatchesInvoice(note, invoiceAmount)) return null;
        const offset = isoDayOffset(invoice.invoice_date, note.credit_date);
        if (offset == null) return null;
        const exactMirror = itemsAndQtyExactlyMatch(note.items, invoice.items);
        return {
          invoice,
          index,
          offset,
          score: (offset >= 0 ? 2000 : 0)
            + (exactMirror ? 500 : 0)
            - Math.abs(offset)
            - index,
        };
      })
      .filter(Boolean)
      .sort((left, right) => right.score - left.score || left.index - right.index);

    const best = targets[0];
    if (!best) continue;

    // Same-day named voucher is the reissue. Reverse the bill made the day
    // before the credit note when it is the same amount and the same items.
    let chosen = best;
    if (best.offset === 0) {
      const earlier = invoiceList
        .map((invoice, index) => {
          const key = invoiceKey(invoice.invoice_date, invoice.voucher_number);
          if (reversedKeys.has(key)) return null;
          const invoiceAmount = toNumber(invoice.amount);
          if (invoiceAmount <= AMOUNT_TOLERANCE) return null;
          if (!noteAmountMatchesInvoice(note, invoiceAmount)) return null;
          const offset = isoDayOffset(invoice.invoice_date, note.credit_date);
          if (offset == null || offset <= 0 || offset > maxDays) return null;
          if (!itemsAndQtyExactlyMatch(note.items, invoice.items)) return null;
          return { invoice, index, offset };
        })
        .filter(Boolean)
        .sort((left, right) => left.offset - right.offset || left.index - right.index)[0];
      if (earlier) chosen = earlier;
    }

    pushReversal(chosen.invoice, note, chosen.offset);
  }

  // Pass 2: fingerprint / ±1-day window for notes and invoices still free.
  const orderedInvoices = [...invoiceList].sort((left, right) => {
    const byDate = String(left.invoice_date || "").localeCompare(String(right.invoice_date || ""));
    if (byDate !== 0) return byDate;
    return String(left.voucher_number || "").localeCompare(String(right.voucher_number || ""));
  });

  for (const invoice of orderedInvoices) {
    const key = invoiceKey(invoice.invoice_date, invoice.voucher_number);
    if (reversedKeys.has(key)) continue;
    const invoiceAmount = toNumber(invoice.amount);
    if (invoiceAmount <= AMOUNT_TOLERANCE) continue;

    const candidates = unusedNotes
      .map((note, index) => {
        if (toNumber(note.remaining) <= AMOUNT_TOLERANCE) return null;

        const offset = isoDayOffset(invoice.invoice_date, note.credit_date);
        if (offset == null || offset < 0) return null;
        const days = offset;

        if (!noteAmountMatchesInvoice(note, invoiceAmount)) return null;

        const noteVoucher = String(note.voucher_number || "").trim();
        const explicitRef = normalizeRef(note.reference);
        const invoiceRef = normalizeRef(invoice.voucher_number);
        const refHit = Boolean(
          invoiceRef
          && explicitRef
          && (explicitRef.includes(invoiceRef) || invoiceRef.includes(explicitRef)),
        );
        // A named credit note may void only that voucher while the named bill
        // is still open. Once that bill is already reversed, a later CN with the
        // same Ref. No. may still clear a leftover same-amount twin.
        if (explicitRef && !refHit) {
          const namedStillOpen = invoiceList.some((candidate) => {
            const candidateKey = invoiceKey(candidate.invoice_date, candidate.voucher_number);
            if (reversedKeys.has(candidateKey)) return false;
            return noteRefsInvoice(note, candidate);
          });
          if (namedStillOpen) return null;
        }
        const itemOverlap = itemCodeOverlapCount(note.item_codes, invoice.item_codes)
          || itemOverlapCount(note.items, invoice.items);
        const noteHasItems = (Array.isArray(note.item_codes) && note.item_codes.length > 0)
          || (Array.isArray(note.items) && note.items.length > 0);
        const invoiceHasItems = (Array.isArray(invoice.item_codes) && invoice.item_codes.length > 0)
          || (Array.isArray(invoice.items) && invoice.items.length > 0);
        const exactMirror = noteHasItems
          && invoiceHasItems
          && itemsAndQtyExactlyMatch(note.items, invoice.items);
        const withinWindow = days <= maxDays;

        if (!withinWindow && !exactMirror) return null;
        if (withinWindow && noteHasItems && invoiceHasItems && itemOverlap <= 0 && !refHit) {
          return null;
        }

        return {
          note,
          index,
          days,
          score: (exactMirror ? 5000 : 0)
            + (refHit ? 1000 : 0)
            + (itemOverlap * 50)
            + 100
            + (noteVoucher ? 25 : 0)
            - days,
        };
      })
      .filter(Boolean)
      .sort((left, right) => right.score - left.score || left.index - right.index);

    const best = candidates[0];
    if (!best) continue;
    pushReversal(invoice, best.note, best.days);
  }

  return { reversals, reversedKeys };
}

/**
 * Purchase vouchers from a dual customer+supplier day book / party ledger.
 * They open supplier AP and must not be treated as cash collections.
 */
export function isPurchaseVoucherType(vchType) {
  const text = String(vchType || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!text) return false;
  if (text === "purchase") return true;
  if (text.startsWith("purchase ")) return true;
  if (text.includes("purchase voucher")) return true;
  return false;
}

/**
 * Credit notes belong in sales history. A Credit Note / Sales Return row in the
 * receipt register is not a collection — often one line of a sales credit note.
 */
export function isCreditNoteReceiptType(vchType) {
  const text = String(vchType || "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!text) return false;
  if (text.includes("CREDIT NOTE") || text.includes("CREDITNOTE") || text === "CN") return true;
  if (text.includes("SALES RETURN") || text === "SR" || /\bSR\b/.test(text)) return true;
  return false;
}

/** Purchase register rows (AP bills) sorted oldest-first. */
export function buildPurchaseRegisterRows(receipts = []) {
  return (Array.isArray(receipts) ? receipts : [])
    .filter((row) => isPurchaseVoucherType(row?.vch_type))
    .map((row) => ({
      purchase_date: dateOnly(row?.receipt_date),
      amount: Math.abs(toNumber(row?.amount)),
      vch_no: String(row?.vch_no || "").trim(),
      vch_type: String(row?.vch_type || "Purchase").trim() || "Purchase",
    }))
    .filter((row) => row.purchase_date && row.amount > 0)
    .sort((left, right) => {
      if (left.purchase_date !== right.purchase_date) {
        return left.purchase_date.localeCompare(right.purchase_date);
      }
      return String(left.vch_no || "").localeCompare(String(right.vch_no || ""));
    });
}

/**
 * Negative Payment vouchers (and older negatives with no voucher type) settle
 * purchases, then sales. Any other debit — Round Off Dr, for example — is a
 * payment against the receipt and must reduce Paid.
 */
export function receiptSettlementKind(row) {
  if (!(toNumber(row?.amount) < 0)) return "receipt";
  const type = String(row?.vch_type || "").trim();
  if (!type || isPaymentVoucherType(type)) return "payment";
  return "receipt_reversal";
}

export function buildSortedReceipts(receipts = []) {
  return (Array.isArray(receipts) ? receipts : [])
    // Purchases are AP bills, not cash collections / payments.
    // Credit notes are settled from sales history, not as cash.
    .filter((row) => !isPurchaseVoucherType(row?.vch_type) && !isCreditNoteReceiptType(row?.vch_type))
    .map((row) => ({
      receipt_date: dateOnly(row?.receipt_date),
      amount: toNumber(row?.amount),
      vch_no: String(row?.vch_no || "").trim(),
      vch_type: String(row?.vch_type || "").trim(),
    }))
    // Keep Payment vouchers stored as negative amounts so collected totals net correctly.
    .filter((row) => row.receipt_date && Math.abs(row.amount) > 0)
    .sort((left, right) => {
      if (left.receipt_date !== right.receipt_date) {
        return left.receipt_date.localeCompare(right.receipt_date);
      }
      // Same day: apply positive receipts before negative payment reversals.
      if (left.amount !== right.amount && (left.amount > 0) !== (right.amount > 0)) {
        return left.amount > 0 ? -1 : 1;
      }
      return String(left.vch_no || "").localeCompare(String(right.vch_no || ""));
    });
}

/**
 * FIFO-match receipts onto sales invoices to estimate days-to-pay.
 * Cash sales vouchers (RC / DC / JC — C in the voucher prefix) take the first
 * receipt on/after the invoice before older credit bills; any leftover then
 * follows normal oldest-open FIFO across remaining invoices. A receipt dated
 * before the cash invoice only takes that slot when no older bill is still open.
 * Invoices reversed immediately by credit notes are excluded from matching.
 * Unpaired credit notes settle open AR like receipts (VAT-incl) and count in Paid.
 * A CN with an explicit Ref. No. settles that named invoice first. Only what
 * the named bill cannot take (already paid, or the note is larger than the bill)
 * follows oldest-open FIFO on the other invoices. Sales on the named bill stay
 * the gross figure; the credit note shows in Paid.
 * Unreferenced orphans follow normal oldest-open FIFO with cash in date order.
 * Dual-party Payment vouchers (negative) settle open Purchase bills first; any
 * leftover then settles open sales invoices like a receipt (party-ledger netting).
 * A Purchase still open after those Payments settles sales invoices already
 * dated on or before the purchase (oldest first). It does not prepay a later
 * invoice, and it is not cash: it stays out of Collected and avg days.
 * A debit on any other voucher (Round Off Dr) is a negative receipt: after cash
 * is applied it reduces Paid on the newest invoice, so Machine Open stays on
 * the newest bill and older invoices stay paid.
 * A voucher is never discarded because it is SAR 0.02 or less.
 */
export function matchPaymentsFifo(transactions = [], receipts = [], options = {}) {
  // Incentive credits the collection month. A receipt must not settle a bill
  // dated after the money arrived, or a later sales upload rewrites an earlier
  // month by parking that receipt on an invoice that did not exist yet.
  const receiptOnOrAfterInvoice = Boolean(options.receiptOnOrAfterInvoice);
  const allInvoices = buildSalesInvoices(transactions).map((invoice) => ({ ...invoice }));
  const creditNotes = buildCreditNotes(transactions);
  const { reversals, reversedKeys } = findImmediateCreditNoteReversals(allInvoices, creditNotes);
  const invoices = allInvoices
    .filter((invoice) => !reversedKeys.has(invoiceKey(invoice.invoice_date, invoice.voucher_number)))
    .map((invoice) => ({
      ...invoice,
      remaining: toNumber(invoice.amount),
      is_cash: isCashSalesVoucher(invoice.voucher_number),
      exclude_from_avg_days: Boolean(invoice.exclude_from_avg_days)
        || isCashSalesVoucher(invoice.voucher_number),
      cash_first_receipt_used: false,
    }));
  const pairedCreditNoteKeys = new Set(
    reversals.map((row) => invoiceKey(row.credit_note_date, row.credit_note_voucher)),
  );
  const unpairedNotes = creditNotes.filter(
    (note) => !pairedCreditNoteKeys.has(invoiceKey(note.credit_date, note.voucher_number)),
  );

  const allocations = [];
  const creditNoteAllocations = [];
  const purchaseAllocations = [];
  const purchaseSalesAllocations = [];
  const matchedPurchasePayments = [];
  const purchases = [];
  let unmatchedReceiptAmount = 0;
  let paymentAppliedToPurchases = 0;
  let paymentAppliedToSales = 0;

  const events = [
    ...unpairedNotes.map((note) => ({
      kind: "credit_note",
      date: dateOnly(note.credit_date),
      amount: toNumber(note.amount),
      amount_excl_vat: toNumber(note.amount_excl_vat),
      voucher_number: note.voucher_number || "",
      reference: note.reference || "",
    })),
    ...buildPurchaseRegisterRows(receipts).map((row) => ({
      kind: "purchase",
      date: row.purchase_date,
      amount: row.amount,
      vch_no: row.vch_no,
    })),
    ...buildSortedReceipts(receipts).map((row) => ({
      kind: receiptSettlementKind(row),
      date: row.receipt_date,
      amount: Math.abs(row.amount),
      signed_amount: row.amount,
      vch_no: row.vch_no,
      vch_type: row.vch_type || "",
    })),
  ]
    .filter((row) => row.date && row.amount > 0)
    .sort((left, right) => {
      if (left.date !== right.date) return left.date.localeCompare(right.date);
      // Same day: CN → purchase (open AP) → receipts → payment (settle AP then AR).
      const kindRank = (kind) => (
        kind === "credit_note" ? 0
          : kind === "purchase" ? 1
            : kind === "receipt" ? 2
              : 3
      );
      const rankDelta = kindRank(left.kind) - kindRank(right.kind);
      if (rankDelta !== 0) return rankDelta;
      return String(left.vch_no || left.voucher_number || "").localeCompare(
        String(right.vch_no || right.voucher_number || ""),
      );
    });

  function hasOlderOpenInvoice(list, cashInvoice) {
    return list.some((other) => other !== cashInvoice
      && hasSettlementAmount(other.remaining)
      && other.invoice_date
      && other.invoice_date < cashInvoice.invoice_date);
  }

  function receiptBeforeInvoice(event, invoice) {
    return receiptOnOrAfterInvoice
      && event?.kind === "receipt"
      && event.date
      && invoice?.invoice_date
      && event.date < invoice.invoice_date;
  }

  function applyToInvoice(event, invoice, remaining) {
    if (!hasSettlementAmount(remaining) || !hasSettlementAmount(invoice.remaining)) return remaining;
    if (receiptBeforeInvoice(event, invoice)) return remaining;
    if (event.kind === "credit_note" && event.date < invoice.invoice_date) return remaining;
    const applied = Math.min(remaining, invoice.remaining);
    if (event.kind === "receipt" && applied > 0) {
      const days = isoDaysBetween(event.date, invoice.invoice_date);
      if (days != null) {
        allocations.push({
          invoice_date: invoice.invoice_date,
          voucher_number: invoice.voucher_number,
          receipt_date: event.date,
          vch_no: event.vch_no,
          amount: applied,
          days,
          exclude_from_avg_days: Boolean(invoice.exclude_from_avg_days || invoice.is_cash),
        });
      }
    } else if (event.kind === "credit_note" && applied > 0) {
      const exclRatio = hasSettlementAmount(event.amount)
        ? toNumber(event.amount_excl_vat) / toNumber(event.amount)
        : 1;
      creditNoteAllocations.push({
        invoice_date: invoice.invoice_date,
        voucher_number: invoice.voucher_number,
        credit_date: event.date,
        credit_voucher: event.voucher_number || "",
        amount: applied,
        amount_excl_vat: applied * exclRatio,
      });
    } else if (event.kind === "purchase_credit" && applied > 0) {
      purchaseSalesAllocations.push({
        invoice_date: invoice.invoice_date,
        voucher_number: invoice.voucher_number,
        purchase_date: event.date,
        purchase_voucher: event.vch_no || "",
        amount: applied,
      });
    }
    invoice.remaining = Math.max(0, invoice.remaining - applied);
    return Math.max(0, remaining - applied);
  }

  /**
   * Exact full-bill Payment↔Purchase pairs (same amount within tolerance), like
   * immediate CN reversals. Prefer same-day, then closest earlier purchase.
   */
  function claimExactPurchasePayment(event) {
    const candidates = purchases
      .filter((purchase) => (
        toNumber(purchase.remaining) > AMOUNT_TOLERANCE
        && amountsMatch(purchase.amount, event.amount)
        && amountsMatch(purchase.remaining, purchase.amount)
        && (!purchase.purchase_date || !event.date || purchase.purchase_date <= event.date)
      ))
      .map((purchase) => {
        const dayGap = Math.abs(isoDayOffset(purchase.purchase_date, event.date) ?? 9999);
        return {
          purchase,
          sameDay: purchase.purchase_date === event.date,
          dayGap,
        };
      })
      .sort((left, right) => {
        if (left.sameDay !== right.sameDay) return left.sameDay ? -1 : 1;
        if (left.dayGap !== right.dayGap) return left.dayGap - right.dayGap;
        if (left.purchase.purchase_date !== right.purchase.purchase_date) {
          return left.purchase.purchase_date.localeCompare(right.purchase.purchase_date);
        }
        return String(left.purchase.vch_no || "").localeCompare(String(right.purchase.vch_no || ""));
      });

    const best = candidates[0];
    if (!best) return event.amount;

    const purchase = best.purchase;
    const applied = toNumber(purchase.remaining);
    purchase.remaining = 0;
    purchase.exact_matched = true;
    paymentAppliedToPurchases += applied;
    matchedPurchasePayments.push({
      purchase_date: purchase.purchase_date,
      purchase_voucher: purchase.vch_no,
      purchase_amount: toNumber(purchase.amount),
      payment_date: event.date,
      payment_voucher: event.vch_no,
      amount: applied,
      match_days: isoDaysBetween(event.date, purchase.purchase_date),
      status: "Matched",
    });
    return 0;
  }

  /** Apply Payment to open Purchase bills: exact full match first, then oldest-open FIFO. */
  function applyPaymentToPurchases(event) {
    let remaining = claimExactPurchasePayment(event);
    if (!hasSettlementAmount(remaining)) return 0;

    for (const purchase of purchases) {
      if (!hasSettlementAmount(remaining)) break;
      if (!hasSettlementAmount(purchase.remaining)) continue;
      if (purchase.exact_matched) continue;
      const applied = Math.min(remaining, purchase.remaining);
      if (!hasSettlementAmount(applied)) continue;
      purchase.remaining = Math.max(0, purchase.remaining - applied);
      remaining = Math.max(0, remaining - applied);
      paymentAppliedToPurchases += applied;
      purchaseAllocations.push({
        purchase_date: purchase.purchase_date,
        purchase_voucher: purchase.vch_no,
        payment_date: event.date,
        vch_no: event.vch_no,
        amount: applied,
      });
    }
    return remaining;
  }

  /**
   * Leftover Payment after Purchases: settle open sales like a receipt so dual-party
   * Payments can reduce Machine Open toward Tally (party-ledger netting).
   * A Payment is not a customer prepayment — it only settles invoices already
   * dated on or before the payment. Later bills stay open for a real receipt.
   */
  function paymentCanSettleInvoice(event, invoice) {
    if (!event?.date || !invoice?.invoice_date) return true;
    return event.date >= invoice.invoice_date;
  }

  function applyPaymentLeftoverToSales(event, remaining) {
    let left = remaining;
    const settleEvent = {
      kind: "receipt",
      date: event.date,
      amount: left,
      vch_no: event.vch_no,
    };
    for (const invoice of invoices) {
      if (!hasSettlementAmount(left)) break;
      if (!invoice.is_cash || invoice.cash_first_receipt_used) continue;
      if (!hasSettlementAmount(invoice.remaining)) continue;
      if (!paymentCanSettleInvoice(event, invoice)) continue;
      if (receiptBeforeInvoice(settleEvent, invoice)) continue;
      if (settleEvent.date < invoice.invoice_date && hasOlderOpenInvoice(invoices, invoice)) continue;
      left = applyToInvoice(settleEvent, invoice, left);
      invoice.cash_first_receipt_used = true;
    }
    for (const invoice of invoices) {
      if (!hasSettlementAmount(left)) break;
      if (!paymentCanSettleInvoice(event, invoice)) continue;
      left = applyToInvoice(settleEvent, invoice, left);
    }
    const applied = Math.max(0, remaining - left);
    paymentAppliedToSales += applied;
    if (hasSettlementAmount(left)) unmatchedReceiptAmount += left;
    return left;
  }

  function unpayInvoice(event, invoice, requested) {
    const capacity = Math.max(0, toNumber(invoice.amount) - toNumber(invoice.remaining));
    const applied = Math.min(toNumber(requested), capacity);
    if (!(applied > SETTLEMENT_DUST)) return 0;
    invoice.remaining = toNumber(invoice.remaining) + applied;
    allocations.push({
      invoice_date: invoice.invoice_date,
      voucher_number: invoice.voucher_number,
      receipt_date: event.date,
      vch_no: event.vch_no,
      amount: -applied,
      days: isoDaysBetween(event.date, invoice.invoice_date),
      exclude_from_avg_days: Boolean(invoice.exclude_from_avg_days || invoice.is_cash),
    });
    return applied;
  }

  function applyDebitReceiptReversal(event) {
    let left = toNumber(event.amount);
    // Cash already paid the oldest invoices. A debit reduces the receipt, so
    // the open balance stays on the newest bill.
    const newestPaid = [...invoices].sort((leftInv, rightInv) => {
      const byDate = String(rightInv.invoice_date || "").localeCompare(String(leftInv.invoice_date || ""));
      if (byDate !== 0) return byDate;
      return String(rightInv.voucher_number || "").localeCompare(String(leftInv.voucher_number || ""));
    });
    for (const invoice of newestPaid) {
      if (!(left > SETTLEMENT_DUST)) break;
      left -= unpayInvoice(event, invoice, left);
    }
    if (left > SETTLEMENT_DUST) unmatchedReceiptAmount -= left;
  }

  // Payments close Purchases before any sales credit is replayed, so a covered
  // Purchase does not also reduce AR. The uncovered remainder is a party credit
  // on the purchase date and is applied with receipts, not after them.
  const paymentSalesEvents = [];
  for (const event of events) {
    if (event.kind === "purchase") {
      purchases.push({
        purchase_date: event.date,
        vch_no: event.vch_no || "",
        amount: event.amount,
        remaining: event.amount,
      });
      continue;
    }
    if (event.kind !== "payment") continue;
    const left = applyPaymentToPurchases(event);
    if (hasSettlementAmount(left)) {
      paymentSalesEvents.push({
        ...event,
        kind: "payment_sales",
        amount: left,
      });
    }
  }

  const arEvents = [
    ...events.filter((event) => (
      event.kind === "credit_note"
      || event.kind === "receipt"
      || event.kind === "receipt_reversal"
    )),
    ...purchases
      .filter((purchase) => hasSettlementAmount(purchase.remaining))
      .map((purchase) => ({
        kind: "purchase_credit",
        date: purchase.purchase_date,
        amount: toNumber(purchase.remaining),
        vch_no: purchase.vch_no || "",
        purchase,
      })),
    ...paymentSalesEvents,
  ].sort((left, right) => {
    if (left.date !== right.date) return left.date.localeCompare(right.date);
    const kindRank = (kind) => (
      kind === "credit_note" ? 0
        : kind === "purchase_credit" ? 1
          : kind === "receipt" ? 2
            : kind === "payment_sales" ? 3
              : 4
    );
    const rankDelta = kindRank(left.kind) - kindRank(right.kind);
    if (rankDelta !== 0) return rankDelta;
    return String(left.vch_no || left.voucher_number || "").localeCompare(
      String(right.vch_no || right.voucher_number || ""),
    );
  });

  for (const event of arEvents) {
    if (event.kind === "receipt_reversal") continue;
    let remaining = event.amount;

    if (event.kind === "purchase_credit") {
      for (const invoice of invoices) {
        if (!hasSettlementAmount(remaining)) break;
        if (invoice.invoice_date && event.date && invoice.invoice_date > event.date) continue;
        remaining = applyToInvoice(event, invoice, remaining);
      }
      if (event.purchase) event.purchase.remaining = remaining;
      continue;
    }

    if (event.kind === "payment_sales") {
      applyPaymentLeftoverToSales(event, remaining);
      continue;
    }

    // Referenced credit notes settle the named Ref. No. first. Leftover
    // (bill already paid, or the note is larger than the bill) then follows
    // oldest-open FIFO on the other invoices.
    if (event.kind === "credit_note") {
      const referencedVoucher = normalizeRef(event.reference);
      if (referencedVoucher) {
        for (const invoice of invoices) {
          if (!hasSettlementAmount(remaining)) break;
          if (normalizeRef(invoice.voucher_number) !== referencedVoucher) continue;
          remaining = applyToInvoice(event, invoice, remaining);
        }
        for (const invoice of invoices) {
          if (!hasSettlementAmount(remaining)) break;
          if (normalizeRef(invoice.voucher_number) === referencedVoucher) continue;
          remaining = applyToInvoice(event, invoice, remaining);
        }
        continue;
      }
    }

    // Receipts: first receipt after each cash invoice settles that cash bill first.
    if (event.kind === "receipt") {
      for (const invoice of invoices) {
        if (!hasSettlementAmount(remaining)) break;
        if (!invoice.is_cash || invoice.cash_first_receipt_used) continue;
        if (!hasSettlementAmount(invoice.remaining)) continue;
        if (receiptBeforeInvoice(event, invoice)) continue;
        // Money taken before the cash sale only belongs to it once every older bill is settled.
        if (event.date < invoice.invoice_date && hasOlderOpenInvoice(invoices, invoice)) continue;
        remaining = applyToInvoice(event, invoice, remaining);
        invoice.cash_first_receipt_used = true;
      }
    }

    // Balance (receipts + unreferenced CNs): normal oldest-open FIFO.
    for (const invoice of invoices) {
      if (!hasSettlementAmount(remaining)) break;
      remaining = applyToInvoice(event, invoice, remaining);
    }

    if (event.kind === "receipt" && hasSettlementAmount(remaining)) {
      unmatchedReceiptAmount += remaining;
    }
  }

  events
    .filter((event) => event.kind === "receipt_reversal")
    .forEach((event) => applyDebitReceiptReversal(event));

  return {
    invoices,
    allocations,
    creditNoteAllocations,
    purchaseAllocations,
    purchaseSalesAllocations,
    matchedPurchasePayments,
    purchases,
    paymentAppliedToPurchases,
    paymentAppliedToSales,
    unmatchedReceiptAmount,
    reversedInvoices: reversals,
  };
}

function summarizeOutstandingUnpaid(outstandingCustomer = null, outstandingInvoices = [], todayIso) {
  const invoices = (Array.isArray(outstandingInvoices) ? outstandingInvoices : [])
    .map((invoice) => {
      const pending = toNumber(invoice?.pending_amount);
      if (pending <= 0) return null;
      const invoiceDate = dateOnly(invoice?.invoice_date);
      const overdueDays = resolveOverdueDaysFromDueDate(invoice, todayIso);
      // Prefer the outstanding file's invoice age so Unpaid / oldest matches the upload table.
      const invoiceDays = resolveInvoiceDays(invoice, todayIso);
      const calendarDays = invoiceDate ? (isoDaysBetween(todayIso, invoiceDate) || 0) : 0;
      const openDays = invoiceDays > 0 ? invoiceDays : calendarDays;
      return {
        invoice_date: invoiceDate,
        ref_no: String(invoice?.ref_no || "").trim(),
        pending_amount: pending,
        open_days: openDays,
        overdue_days: overdueDays,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.open_days - left.open_days || right.pending_amount - left.pending_amount);

  // Prefer invoice / bucket totals so Unpaid Bills matches the outstanding tables
  // (customer total_outstanding can be a rounded/header figure off by ~1).
  const invoiceSum = invoices.reduce((total, row) => total + row.pending_amount, 0);
  const bucketSum = Object.values(outstandingCustomer?.buckets || {}).reduce(
    (total, value) => total + toNumber(value),
    0,
  );
  const headerTotal = toNumber(outstandingCustomer?.total_outstanding);
  const totalOutstanding = invoiceSum > 0
    ? invoiceSum
    : (bucketSum > 0 ? bucketSum : headerTotal);
  const openInvoiceCount = invoices.length > 0
    ? invoices.length
    : (toNumber(outstandingCustomer?.open_invoices) || 0);
  const oldestOpenDays = invoices.length ? invoices[0].open_days : 0;
  const overdueCount = invoices.filter((row) => row.overdue_days > 0).length;

  return {
    totalOutstanding,
    openInvoiceCount,
    oldestOpenDays,
    overdueCount,
    invoices,
  };
}

/**
 * Days observations for amount-weighted avg days to pay.
 * Paid chunks use sales→receipt days. Open unpaid use current age, but only
 * when older than the paid-only average so fresh large invoices cannot pull
 * the avg down — open age can raise the metric, never reduce it.
 * Cash vouchers (RC/DC/JC and CASH voucher types) are omitted.
 *
 * @param {number|null} [minOpenDaysExclusive] When set, open invoices with
 *   open_days <= this floor are excluded from the blend.
 */
export function buildDaysToPayObservations({
  allocations = [],
  openInvoices = [],
  minOpenDaysExclusive = null,
} = {}) {
  const observations = [];
  const openFloor = minOpenDaysExclusive == null ? null : Number(minOpenDaysExclusive);

  (Array.isArray(allocations) ? allocations : []).forEach((row) => {
    if (isExcludedFromAvgDays(row)) return;
    const amount = toNumber(row?.amount);
    const days = Number(row?.days);
    if (amount > 0.009 && Number.isFinite(days) && days >= 0) {
      observations.push({ amount, days, source: "paid" });
    }
  });

  (Array.isArray(openInvoices) ? openInvoices : []).forEach((row) => {
    if (isExcludedFromAvgDays(row)) return;
    const amount = toNumber(row?.pending_amount ?? row?.remaining);
    const days = Number(row?.open_days);
    if (!(amount > 0.009 && Number.isFinite(days) && days >= 0)) return;
    if (openFloor != null && Number.isFinite(openFloor) && !(days > openFloor)) return;
    observations.push({ amount, days, source: "open" });
  });

  return observations;
}

export function weightedAverageDays(observations = []) {
  const totalAmount = (Array.isArray(observations) ? observations : [])
    .reduce((total, row) => total + toNumber(row.amount), 0);
  if (totalAmount <= 0.009) return null;
  const weighted = observations.reduce(
    (total, row) => total + (Number(row.days) * toNumber(row.amount)),
    0,
  );
  return weighted / totalAmount;
}

/**
 * First day of the month that starts the rolling historic-performance avg-days
 * window (same span as the BI performance months helper).
 */
export function avgDaysHistoricPerformanceFromIso(todayIso = new Date().toISOString().slice(0, 10)) {
  const today = dateOnly(todayIso) || getKsaDateString();
  const currentMonth = /^\d{4}-\d{2}-\d{2}$/.test(today)
    ? today.slice(0, 7)
    : ksaMonthKey();
  const fromMonth = shiftMonthKey(currentMonth, -HISTORIC_PERFORMANCE_MONTHS);
  return fromMonth ? `${fromMonth}-01` : "";
}

export function filterPaymentLedgerFromDate({
  transactions = [],
  receipts = [],
  outstandingInvoices = [],
  fromIso = "",
} = {}) {
  const from = dateOnly(fromIso);
  if (!from) {
    return {
      transactions: Array.isArray(transactions) ? transactions : [],
      receipts: Array.isArray(receipts) ? receipts : [],
      outstandingInvoices: Array.isArray(outstandingInvoices) ? outstandingInvoices : [],
    };
  }
  const onOrAfter = (value) => {
    const iso = dateOnly(value);
    return iso && iso >= from;
  };
  return {
    transactions: (Array.isArray(transactions) ? transactions : [])
      .filter((row) => onOrAfter(row?.transaction_date)),
    receipts: (Array.isArray(receipts) ? receipts : [])
      .filter((row) => onOrAfter(row?.receipt_date)),
    outstandingInvoices: (Array.isArray(outstandingInvoices) ? outstandingInvoices : [])
      .filter((row) => onOrAfter(row?.invoice_date)),
  };
}

export function emptyPaymentBehavior() {
  return {
    avgDaysToPay: null,
    avgDaysPaidOnly: null,
    medianDaysToPay: null,
    avgDaysToPay6m: null,
    avgDaysPaidOnly6m: null,
    medianDaysToPay6m: null,
    openAmountInAvg6m: 0,
    avgDays6mFromDate: "",
    paidAllocationCount: 0,
    paidAmount: 0,
    openAmountInAvg: 0,
    matchedInvoiceCount: 0,
    unpaidFromSalesCount: 0,
    unpaidFromSalesAmount: 0,
    oldestUnpaidFromSalesDays: 0,
    outstandingTotal: 0,
    outstandingOpenInvoices: 0,
    outstandingOldestDays: 0,
    outstandingOverdueCount: 0,
    summaryLabel: "Payment days unavailable",
  };
}

function buildPaymentBehaviorCore({
  transactions = [],
  receipts = [],
  outstandingCustomer = null,
  outstandingInvoices = [],
  todayIso = new Date().toISOString().slice(0, 10),
} = {}) {
  const today = dateOnly(todayIso) || new Date().toISOString().slice(0, 10);
  const { invoices, allocations } = matchPaymentsFifo(transactions, receipts);
  const unpaidFromSales = invoices
    .filter((invoice) => toNumber(invoice.remaining) > 0.009)
    .map((invoice) => ({
      ...invoice,
      pending_amount: toNumber(invoice.remaining),
      open_days: isoDaysBetween(today, invoice.invoice_date) || 0,
    }))
    .sort((left, right) => right.open_days - left.open_days);

  const outstanding = summarizeOutstandingUnpaid(outstandingCustomer, outstandingInvoices, today);
  const cashRefs = new Set(
    invoices
      .filter((invoice) => invoice.exclude_from_avg_days || invoice.is_cash)
      .map((invoice) => normalizeRef(invoice.voucher_number))
      .filter(Boolean),
  );
  const keepForAvgDays = (row) => !isExcludedFromAvgDays(row, cashRefs);
  // Prefer outstanding upload rows (book truth) for open age; else FIFO residual.
  const openForAvg = (
    outstanding.invoices.length > 0 ? outstanding.invoices : unpaidFromSales
  ).filter(keepForAvgDays);

  const paidObservations = buildDaysToPayObservations({
    allocations: allocations.filter(keepForAvgDays),
    openInvoices: [],
  });
  const paidAmount = paidObservations.reduce((total, row) => total + row.amount, 0);
  const paidAvgRaw = weightedAverageDays(paidObservations);
  const avgDaysPaidOnly = roundDays(paidAvgRaw);

  // Only open invoices older than paid-only avg can enter the blend.
  // With no paid history, all open invoices are included (no floor to spoil).
  const openFloor = paidAvgRaw != null ? paidAvgRaw : null;
  const blendedObservations = buildDaysToPayObservations({
    allocations: allocations.filter(keepForAvgDays),
    openInvoices: openForAvg,
    minOpenDaysExclusive: openFloor,
  });

  const openAmountInAvg = blendedObservations
    .filter((row) => row.source === "open")
    .reduce((total, row) => total + row.amount, 0);

  const avgDaysToPay = roundDays(weightedAverageDays(blendedObservations));
  const medianDaysToPay = roundDays(median(blendedObservations.map((row) => row.days)));
  const matchedInvoiceCount = new Set(
    allocations.map((row) => `${row.invoice_date}::${row.voucher_number}`),
  ).size;

  let summaryLabel = "Payment days unavailable";
  if (avgDaysToPay != null) {
    summaryLabel = `Avg ${avgDaysToPay} days to pay`;
    if (openAmountInAvg > 0.009) {
      summaryLabel += " (paid + open older than paid avg)";
    } else {
      summaryLabel += " from receipts";
    }
    if (medianDaysToPay != null && medianDaysToPay !== avgDaysToPay) {
      summaryLabel += ` · median ${medianDaysToPay}`;
    }
    if (
      avgDaysPaidOnly != null
      && openAmountInAvg > 0.009
      && avgDaysPaidOnly !== avgDaysToPay
    ) {
      summaryLabel += ` · paid-only ${avgDaysPaidOnly}d`;
    }
  }

  if (outstanding.totalOutstanding > 0) {
    summaryLabel += avgDaysToPay != null ? " · " : "";
    summaryLabel += `Unpaid ${outstanding.totalOutstanding.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    if (outstanding.oldestOpenDays > 0) {
      summaryLabel += ` / oldest open ${outstanding.oldestOpenDays}d`;
    }
  } else if (unpaidFromSales.length > 0) {
    const unpaidAmount = unpaidFromSales.reduce((total, row) => total + toNumber(row.remaining), 0);
    summaryLabel += avgDaysToPay != null ? " · " : "";
    summaryLabel += `Open sales ${unpaidAmount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    if (unpaidFromSales[0]?.open_days > 0) {
      summaryLabel += ` / oldest open ${unpaidFromSales[0].open_days}d`;
    }
  }

  return {
    avgDaysToPay,
    avgDaysPaidOnly,
    medianDaysToPay,
    avgDaysToPay6m: null,
    avgDaysPaidOnly6m: null,
    medianDaysToPay6m: null,
    openAmountInAvg6m: 0,
    avgDays6mFromDate: "",
    paidAllocationCount: allocations.length,
    paidAmount,
    openAmountInAvg,
    matchedInvoiceCount,
    unpaidFromSalesCount: unpaidFromSales.length,
    unpaidFromSalesAmount: unpaidFromSales.reduce((total, row) => total + toNumber(row.remaining), 0),
    oldestUnpaidFromSalesDays: unpaidFromSales[0]?.open_days || 0,
    outstandingTotal: outstanding.totalOutstanding,
    outstandingOpenInvoices: outstanding.openInvoiceCount,
    outstandingOldestDays: outstanding.oldestOpenDays,
    outstandingOverdueCount: outstanding.overdueCount,
    summaryLabel,
  };
}

/**
 * Combine sales+receipt FIFO days-to-pay with outstanding unpaid bill stats.
 * Avg days starts from paid receipts, then blends only open unpaid invoices
 * older than that paid-only avg (so open age can raise, never reduce, the avg).
 * Paid-only avg is kept as avgDaysPaidOnly for comparison.
 * Also computes a parallel 6-month window (sales + receipts + open from that
 * from-date) exposed as avgDaysToPay6m / avgDaysPaidOnly6m.
 */
export function buildPaymentBehavior({
  transactions = [],
  receipts = [],
  outstandingCustomer = null,
  outstandingInvoices = [],
  todayIso = new Date().toISOString().slice(0, 10),
  includeSixMonthWindow = true,
} = {}) {
  const lifetime = buildPaymentBehaviorCore({
    transactions,
    receipts,
    outstandingCustomer,
    outstandingInvoices,
    todayIso,
  });

  if (!includeSixMonthWindow) {
    return lifetime;
  }

  const fromIso = avgDaysHistoricPerformanceFromIso(todayIso);
  const windowed = filterPaymentLedgerFromDate({
    transactions,
    receipts,
    outstandingInvoices,
    fromIso,
  });
  const six = buildPaymentBehaviorCore({
    transactions: windowed.transactions,
    receipts: windowed.receipts,
    outstandingCustomer,
    outstandingInvoices: windowed.outstandingInvoices,
    todayIso,
  });

  let summaryLabel = lifetime.summaryLabel;
  if (six.avgDaysToPay != null) {
    const hasLifetime = lifetime.avgDaysToPay != null
      || (summaryLabel && summaryLabel !== "Payment days unavailable");
    summaryLabel += hasLifetime
      ? ` · ${HISTORIC_PERFORMANCE_SHORT_LABEL} ${six.avgDaysToPay}`
      : `Avg ${six.avgDaysToPay} days to pay (${HISTORIC_PERFORMANCE_SHORT_LABEL})`;
  }

  return {
    ...lifetime,
    avgDaysToPay6m: six.avgDaysToPay,
    avgDaysPaidOnly6m: six.avgDaysPaidOnly,
    medianDaysToPay6m: six.medianDaysToPay,
    openAmountInAvg6m: six.openAmountInAvg,
    avgDays6mFromDate: fromIso,
    summaryLabel,
  };
}

export function formatPaymentDaysLabel(behavior) {
  if (!behavior || behavior.avgDaysToPay == null) {
    if (behavior?.avgDaysToPay6m != null) return `${HISTORIC_PERFORMANCE_SHORT_LABEL} ${behavior.avgDaysToPay6m} days`;
    return "—";
  }
  if (behavior.avgDaysToPay6m != null) {
    return `${behavior.avgDaysToPay} days · ${HISTORIC_PERFORMANCE_SHORT_LABEL} ${behavior.avgDaysToPay6m}`;
  }
  return `${behavior.avgDaysToPay} days`;
}

/** Compact dual label for PDF / one-line summaries. */
export function formatAvgDaysDualLine(behavior, {
  lifetimePrefix = "Avg days to pay",
  sixMonthLabel = HISTORIC_PERFORMANCE_SHORT_LABEL,
} = {}) {
  if (!behavior) return "";
  const lifetime = behavior.avgDaysToPay;
  const six = behavior.avgDaysToPay6m;
  if (lifetime == null && six == null) return "";
  if (lifetime != null && six != null) {
    return `${lifetimePrefix}: ${lifetime} lifetime · ${six} (${sixMonthLabel})`;
  }
  if (lifetime != null) return `${lifetimePrefix}: ${lifetime}`;
  return `${lifetimePrefix}: ${six} (${sixMonthLabel})`;
}

/**
 * Compare Tally/outstanding book settlement vs FIFO receipt allocation per invoice.
 * paid_delta > 0 means FIFO put more cash on this bill than outstanding implies.
 * The counterpart usually appears as paid_delta < 0 on other invoices (or unmatched receipts).
 */
export function buildTallyFifoDiscrepancies(invoiceRows = [], {
  unmatchedReceiptAmount = 0,
  hasOutstandingRows = false,
} = {}) {
  if (!hasOutstandingRows) {
    return {
      rows: [],
      totals: {
        book_paid: 0,
        fifo_paid: 0,
        paid_delta: 0,
        book_open: 0,
        fifo_open: 0,
        open_delta: 0,
        over_allocated: 0,
        under_allocated: 0,
        unmatched_receipt_amount: toNumber(unmatchedReceiptAmount),
        discrepancy_count: 0,
      },
    };
  }

  const rows = (Array.isArray(invoiceRows) ? invoiceRows : [])
    .map((row) => {
      const salesIncl = toNumber(row.gross_amount_incl_vat ?? row.amount_incl_vat);
      const fifoPaid = toNumber(row.fifo_paid);
      const fifoOpen = row.fifo_remaining == null
        ? Math.max(0, salesIncl - fifoPaid - toNumber(row.credit_note_settled))
        : toNumber(row.fifo_remaining);
      // Book side comes from outstanding upload when present — not from forced Paid/Open.
      const hasBookOpen = row.outstanding_pending != null;
      const bookOpen = hasBookOpen ? toNumber(row.outstanding_pending) : fifoOpen;
      const bookPaid = hasBookOpen ? Math.max(0, salesIncl - bookOpen) : fifoPaid;
      const paidDelta = fifoPaid - bookPaid;
      const openDelta = fifoOpen - bookOpen;
      if (Math.abs(paidDelta) <= 0.02 && Math.abs(openDelta) <= 0.02) return null;

      let note = "";
      if (paidDelta > 0.02) {
        note = "FIFO over-allocated cash to this bill vs Tally outstanding";
      } else if (paidDelta < -0.02) {
        note = "FIFO under-allocated cash to this bill vs Tally outstanding";
      } else if (openDelta > 0.02) {
        note = "FIFO open higher than Tally outstanding";
      } else {
        note = "FIFO open lower than Tally outstanding";
      }

      const receiptChunks = (Array.isArray(row.settlements) ? row.settlements : []).map((chunk) => ({
        receipt_date: chunk.receipt_date,
        vch_no: chunk.vch_no || "",
        amount: toNumber(chunk.amount),
        days: chunk.days,
      }));

      return {
        invoice_date: row.invoice_date,
        voucher_number: row.voucher_number,
        sales_incl_vat: salesIncl,
        book_paid: bookPaid,
        fifo_paid: fifoPaid,
        paid_delta: paidDelta,
        book_open: bookOpen,
        fifo_open: fifoOpen,
        open_delta: openDelta,
        note,
        receipt_chunks: receiptChunks,
      };
    })
    .filter(Boolean)
    .sort((left, right) => Math.abs(right.paid_delta) - Math.abs(left.paid_delta)
      || Math.abs(right.open_delta) - Math.abs(left.open_delta)
      || String(left.invoice_date || "").localeCompare(String(right.invoice_date || "")));

  const overAllocated = rows
    .filter((row) => row.paid_delta > 0.02)
    .reduce((total, row) => total + row.paid_delta, 0);
  const underAllocated = rows
    .filter((row) => row.paid_delta < -0.02)
    .reduce((total, row) => total + row.paid_delta, 0);

  return {
    rows,
    totals: {
      book_paid: rows.reduce((total, row) => total + row.book_paid, 0),
      fifo_paid: rows.reduce((total, row) => total + row.fifo_paid, 0),
      paid_delta: rows.reduce((total, row) => total + row.paid_delta, 0),
      book_open: rows.reduce((total, row) => total + row.book_open, 0),
      fifo_open: rows.reduce((total, row) => total + row.fifo_open, 0),
      open_delta: rows.reduce((total, row) => total + row.open_delta, 0),
      over_allocated: overAllocated,
      under_allocated: underAllocated,
      unmatched_receipt_amount: toNumber(unmatchedReceiptAmount),
      discrepancy_count: rows.length,
    },
  };
}

/**
 * Tally outstanding vs computed outstanding (cash FIFO + allocated credit notes).
 * computed_open = max(0, sales − cash_fifo − credit_notes).
 * Gaps that remain after CN are true book vs calculation differences.
 */
export function buildTallyVsComputedOutstanding(invoiceRows = [], {
  unmatchedReceiptAmount = 0,
  unmatchedCreditNoteAmount = 0,
  hasOutstandingRows = false,
} = {}) {
  const emptyTotals = {
    sales_incl_vat: 0,
    cash_settled: 0,
    credit_note_settled: 0,
    computed_settled: 0,
    computed_open: 0,
    tally_open: 0,
    open_delta: 0,
    computed_higher: 0,
    computed_lower: 0,
    discrepancy_count: 0,
    unmatched_receipt_amount: toNumber(unmatchedReceiptAmount),
    unmatched_credit_note_amount: toNumber(unmatchedCreditNoteAmount),
    has_outstanding_rows: Boolean(hasOutstandingRows),
  };

  const allRows = (Array.isArray(invoiceRows) ? invoiceRows : []).map((row) => {
    const salesIncl = toNumber(row.gross_amount_incl_vat ?? row.amount_incl_vat);
    const cashSettled = toNumber(row.fifo_paid);
    const creditChunks = (Array.isArray(row.fifo_credit_notes)
      ? row.fifo_credit_notes
      : Array.isArray(row.credit_notes) ? row.credit_notes : []).map((chunk) => ({
      credit_date: chunk.credit_date,
      voucher_number: chunk.voucher_number || "",
      amount: toNumber(chunk.amount),
    }));
    const creditNoteSettled = creditChunks.reduce((total, chunk) => total + toNumber(chunk.amount), 0);
    const computedSettled = cashSettled + creditNoteSettled;
    const computedOpen = row.fifo_remaining == null
      ? Math.max(0, salesIncl - computedSettled)
      : Math.max(0, toNumber(row.fifo_remaining));
    const tallyOpen = hasOutstandingRows && row.outstanding_pending != null
      ? toNumber(row.outstanding_pending)
      : computedOpen;
    const openDelta = computedOpen - tallyOpen;
    const receiptChunks = (Array.isArray(row.settlements) ? row.settlements : []).map((chunk) => ({
      receipt_date: chunk.receipt_date,
      vch_no: chunk.vch_no || "",
      amount: toNumber(chunk.amount),
      days: chunk.days,
    }));

    let status = "Match";
    let note = "Computed open (cash + CN) matches Tally outstanding";
    if (!hasOutstandingRows) {
      status = "Computed only";
      note = "No outstanding upload rows — showing computed open only";
    } else if (openDelta > 0.02) {
      status = "Computed higher";
      note = "Computed open is higher than Tally — missing cash/CN in history, or Tally settled this bill differently";
    } else if (openDelta < -0.02) {
      status = "Computed lower";
      note = "Computed open is lower than Tally — extra cash/CN applied here, or Tally still shows pending";
    } else if (creditNoteSettled > 0.02 && Math.abs(toNumber(row.fifo_remaining ?? (salesIncl - cashSettled)) - tallyOpen) > 0.02) {
      note = "Cash FIFO alone would differ; credit notes close the gap to Tally";
    }

    return {
      invoice_date: row.invoice_date,
      voucher_number: row.voucher_number,
      sales_incl_vat: salesIncl,
      cash_settled: cashSettled,
      credit_note_settled: creditNoteSettled,
      computed_settled: computedSettled,
      computed_open: computedOpen,
      tally_open: tallyOpen,
      open_delta: openDelta,
      status,
      note,
      receipt_chunks: receiptChunks,
      credit_chunks: creditChunks,
      has_gap: Math.abs(openDelta) > 0.02,
    };
  });

  const gapRows = hasOutstandingRows
    ? allRows.filter((row) => row.has_gap)
    : [];

  const rowsForTotals = hasOutstandingRows ? allRows : allRows;
  const discrepancyRows = hasOutstandingRows
    ? [...gapRows].sort((left, right) => Math.abs(right.open_delta) - Math.abs(left.open_delta)
      || String(left.invoice_date || "").localeCompare(String(right.invoice_date || "")))
    : [...allRows].sort((left, right) => String(left.invoice_date || "").localeCompare(String(right.invoice_date || ""))
      || String(left.voucher_number || "").localeCompare(String(right.voucher_number || "")));

  const computedHigher = gapRows
    .filter((row) => row.open_delta > 0.02)
    .reduce((total, row) => total + row.open_delta, 0);
  const computedLower = gapRows
    .filter((row) => row.open_delta < -0.02)
    .reduce((total, row) => total + row.open_delta, 0);

  return {
    rows: discrepancyRows,
    allRows: rowsForTotals,
    totals: {
      sales_incl_vat: rowsForTotals.reduce((total, row) => total + row.sales_incl_vat, 0),
      cash_settled: rowsForTotals.reduce((total, row) => total + row.cash_settled, 0),
      credit_note_settled: rowsForTotals.reduce((total, row) => total + row.credit_note_settled, 0),
      computed_settled: rowsForTotals.reduce((total, row) => total + row.computed_settled, 0),
      computed_open: rowsForTotals.reduce((total, row) => total + row.computed_open, 0),
      tally_open: rowsForTotals.reduce((total, row) => total + row.tally_open, 0),
      open_delta: rowsForTotals.reduce((total, row) => total + row.open_delta, 0),
      computed_higher: computedHigher,
      computed_lower: computedLower,
      discrepancy_count: gapRows.length,
      unmatched_receipt_amount: toNumber(unmatchedReceiptAmount),
      unmatched_credit_note_amount: toNumber(unmatchedCreditNoteAmount),
      has_outstanding_rows: Boolean(hasOutstandingRows),
    },
  };
}

/**
 * Detailed customer settlement view: invoices, FIFO payment chunks, and datewise sales/collections.
 * Referenced credit notes settle the named Ref. No. first, then leftover oldest-open FIFO.
 * Paid = cash FIFO + CN settlements; nested credit notes under an invoice show in the Paid column.
 * Unreferenced orphans follow oldest-open FIFO with cash. Outstanding upload is kept on each row
 * for Tally comparison — it does not rewrite Paid/Open.
 * Cash FIFO alone drives payment-days; avg days also includes open unpaid older than the paid-only
 * avg (open age can raise, never reduce, the metric).
 * Invoices reversed immediately by credit notes are listed separately and excluded from avg days.
 */
export function buildPaymentSettlementLedger({
  transactions = [],
  receipts = [],
  outstandingCustomer = null,
  outstandingInvoices = [],
  todayIso = new Date().toISOString().slice(0, 10),
} = {}) {
  const today = dateOnly(todayIso) || new Date().toISOString().slice(0, 10);
  const {
    invoices,
    allocations,
    creditNoteAllocations,
    purchaseAllocations = [],
    purchaseSalesAllocations = [],
    matchedPurchasePayments = [],
    purchases = [],
    paymentAppliedToPurchases = 0,
    paymentAppliedToSales = 0,
    unmatchedReceiptAmount,
    reversedInvoices = [],
  } = matchPaymentsFifo(transactions, receipts);
  const summary = buildPaymentBehavior({
    transactions,
    receipts,
    outstandingCustomer,
    outstandingInvoices,
    todayIso: today,
  });
  const outstanding = summarizeOutstandingUnpaid(outstandingCustomer, outstandingInvoices, today);
  const outstandingByRef = new Map();
  outstanding.invoices.forEach((row) => {
    const key = normalizeRef(row.ref_no);
    if (!key) return;
    outstandingByRef.set(key, row);
  });
  const hasOutstandingRows = outstanding.invoices.length > 0;

  const settlementsByInvoice = new Map();
  allocations.forEach((row) => {
    const key = invoiceKey(row.invoice_date, row.voucher_number);
    const list = settlementsByInvoice.get(key) || [];
    list.push({ ...row });
    settlementsByInvoice.set(key, list);
  });

  const purchaseSettlementsByInvoice = new Map();
  purchaseSalesAllocations.forEach((row) => {
    const key = invoiceKey(row.invoice_date, row.voucher_number);
    const list = purchaseSettlementsByInvoice.get(key) || [];
    list.push({
      purchase_date: row.purchase_date,
      voucher_number: row.purchase_voucher || "",
      amount: toNumber(row.amount),
    });
    purchaseSettlementsByInvoice.set(key, list);
  });

  const fifoCreditNotesByInvoice = new Map();
  creditNoteAllocations.forEach((row) => {
    const key = invoiceKey(row.invoice_date, row.voucher_number);
    const list = fifoCreditNotesByInvoice.get(key) || [];
    list.push({
      type: "credit_note",
      kind: "Credit Note",
      credit_date: row.credit_date,
      voucher_number: row.credit_voucher,
      amount: toNumber(row.amount),
      amount_excl_vat: toNumber(row.amount_excl_vat ?? row.amount),
      days: null,
    });
    fifoCreditNotesByInvoice.set(key, list);
  });

  const matchedOutstandingRefs = new Set();

  const invoiceRows = invoices.map((invoice) => {
    const key = invoiceKey(invoice.invoice_date, invoice.voucher_number);
    const settlements = (settlementsByInvoice.get(key) || []).sort((left, right) => {
      if (left.receipt_date !== right.receipt_date) {
        return left.receipt_date.localeCompare(right.receipt_date);
      }
      return String(left.vch_no || "").localeCompare(String(right.vch_no || ""));
    });
    const fifoPaid = settlements.reduce((total, row) => total + toNumber(row.amount), 0);
    const fifoCreditNotes = fifoCreditNotesByInvoice.get(key) || [];
    const fifoCreditSettled = fifoCreditNotes.reduce((total, row) => total + toNumber(row.amount), 0);
    const purchaseSettlements = purchaseSettlementsByInvoice.get(key) || [];
    const purchaseSettled = purchaseSettlements.reduce((total, row) => total + toNumber(row.amount), 0);
    const fifoRemaining = toNumber(invoice.remaining);
    const amountExclVat = toNumber(invoice.amount_excl_vat);
    const amountInclVat = toNumber(invoice.amount);
    const grossExclVat = amountExclVat;
    const grossInclVat = amountInclVat;
    const fifoCreditExcl = fifoCreditNotes.reduce(
      (total, row) => total + toNumber(row.amount_excl_vat ?? row.amount),
      0,
    );
    const outstandingMatch = outstandingByRef.get(normalizeRef(invoice.voucher_number)) || null;
    if (outstandingMatch) {
      matchedOutstandingRefs.add(normalizeRef(invoice.voucher_number));
    }

    // Paid = cash FIFO + credit-note settlements + purchase credits. Purchase
    // credits show on the invoice but stay out of avg days.
    const remaining = fifoRemaining;
    const paidAmount = fifoPaid + fifoCreditSettled + purchaseSettled;
    const outstandingPending = hasOutstandingRows
      ? (outstandingMatch ? toNumber(outstandingMatch.pending_amount) : 0)
      : null;
    const openSource = "fifo";

    const positiveFifoPaid = settlements.reduce((total, row) => {
      const amount = toNumber(row.amount);
      return amount > 0 ? total + amount : total;
    }, 0);
    const weightedDays = positiveFifoPaid > 0
      ? settlements.reduce((total, row) => {
        const amount = toNumber(row.amount);
        if (amount <= 0) return total;
        return total + (Number(row.days || 0) * amount);
      }, 0) / positiveFifoPaid
      : null;

    let status = "Open";
    if (remaining <= 0.009) {
      status = amountInclVat > 0.009 || paidAmount > 0.009 || fifoCreditSettled > 0.009
        ? "Paid"
        : "Open";
      if (remaining <= 0.009 && amountInclVat <= 0.009 && paidAmount <= 0.009) status = "Paid";
    } else if ((paidAmount > 0.009 || fifoCreditSettled > 0.009) && remaining > 0.009) {
      status = "Partial";
    }

    const openDays = remaining > 0.009
      ? (
        outstandingMatch?.open_days
        || isoDaysBetween(today, invoice.invoice_date)
        || 0
      )
      : 0;

    return {
      invoice_date: invoice.invoice_date,
      voucher_number: invoice.voucher_number,
      amount_excl_vat: amountExclVat,
      amount_incl_vat: amountInclVat,
      gross_amount_excl_vat: grossExclVat,
      gross_amount_incl_vat: grossInclVat,
      paid_amount: paidAmount,
      fifo_paid: fifoPaid,
      credit_note_settled: fifoCreditSettled,
      credit_note_excl_settled: fifoCreditExcl,
      remaining,
      fifo_remaining: fifoRemaining,
      outstanding_pending: outstandingPending,
      open_source: openSource,
      status,
      // Payment days only from receipt FIFO. Cash vouchers and credit notes stay out of the avg.
      payment_days: invoice.exclude_from_avg_days || invoice.is_cash || positiveFifoPaid <= 0.009
        ? null
        : roundDays(weightedDays),
      open_days: openDays,
      items: Array.isArray(invoice.items) ? [...invoice.items] : [],
      item_codes: Array.isArray(invoice.item_codes) ? [...invoice.item_codes] : [],
      settlements,
      purchase_settlements: purchaseSettlements,
      credit_notes: [],
      fifo_credit_notes: fifoCreditNotes,
    };
  });

  // Outstanding refs not found in sales history still belong in Open.
  // A reversed voucher is not a sales invoice. If Tally still has it pending,
  // keep a Tally-only line so Tally Open matches the outstanding file.
  const reversedOutstandingRefs = new Set(
    (Array.isArray(reversedInvoices) ? reversedInvoices : [])
      .map((row) => normalizeRef(row.voucher_number))
      .filter(Boolean),
  );
  outstanding.invoices.forEach((row) => {
    const ref = normalizeRef(row.ref_no);
    if (!ref || matchedOutstandingRefs.has(ref)) return;
    if (reversedOutstandingRefs.has(ref)) {
      invoiceRows.push({
        invoice_date: row.invoice_date || "",
        voucher_number: row.ref_no,
        amount_excl_vat: 0,
        amount_incl_vat: 0,
        gross_amount_excl_vat: 0,
        gross_amount_incl_vat: 0,
        paid_amount: 0,
        fifo_paid: 0,
        credit_note_settled: 0,
        credit_note_excl_settled: 0,
        remaining: 0,
        fifo_remaining: 0,
        outstanding_pending: toNumber(row.pending_amount),
        open_source: "outstanding_reversed",
        tally_only: true,
        status: "Tally",
        payment_days: null,
        open_days: 0,
        settlements: [],
        credit_notes: [],
        fifo_credit_notes: [],
      });
      return;
    }
    invoiceRows.push({
      invoice_date: row.invoice_date || "",
      voucher_number: row.ref_no,
      amount_excl_vat: 0,
      amount_incl_vat: toNumber(row.pending_amount),
      paid_amount: 0,
      fifo_paid: 0,
      credit_note_settled: 0,
      credit_note_excl_settled: 0,
      remaining: toNumber(row.pending_amount),
      fifo_remaining: null,
      outstanding_pending: toNumber(row.pending_amount),
      open_source: "outstanding",
      status: "Open",
      payment_days: null,
      open_days: row.open_days || 0,
      settlements: [],
      credit_notes: [],
      fifo_credit_notes: [],
    });
  });

  invoiceRows.sort((left, right) => {
    if (left.invoice_date !== right.invoice_date) {
      return String(left.invoice_date || "").localeCompare(String(right.invoice_date || ""));
    }
    return String(left.voucher_number || "").localeCompare(String(right.voucher_number || ""));
  });

  const salesByDateMap = new Map();
  invoiceRows.forEach((row) => {
    if (!row.invoice_date) return;
    const current = salesByDateMap.get(row.invoice_date) || {
      date: row.invoice_date,
      invoice_count: 0,
      sales_excl_vat: 0,
      sales_incl_vat: 0,
      paid_amount: 0,
      open_amount: 0,
      invoices: [],
    };
    current.invoice_count += 1;
    current.sales_excl_vat += row.amount_excl_vat;
    current.sales_incl_vat += roundMoney(row.amount_incl_vat);
    current.paid_amount += row.paid_amount;
    current.open_amount += row.remaining;
    current.invoices.push({
      voucher_number: row.voucher_number,
      amount_excl_vat: row.amount_excl_vat,
      amount_incl_vat: row.amount_incl_vat,
      paid_amount: row.paid_amount,
      remaining: row.remaining,
      status: row.status,
    });
    salesByDateMap.set(row.invoice_date, current);
  });

  const applicationsByReceipt = new Map();
  const pushReceiptApplication = (date, vchNo, application) => {
    const key = `${dateOnly(date)}::${String(vchNo || "").trim()}`;
    const list = applicationsByReceipt.get(key) || [];
    list.push(application);
    applicationsByReceipt.set(key, list);
  };
  matchedPurchasePayments.forEach((row) => {
    pushReceiptApplication(row.payment_date, row.payment_voucher, {
      target_kind: "purchase",
      voucher_number: row.purchase_voucher || "",
      target_date: row.purchase_date || "",
      amount: toNumber(row.amount),
      status: row.status || "Matched",
    });
  });
  purchaseAllocations.forEach((row) => {
    pushReceiptApplication(row.payment_date, row.vch_no, {
      target_kind: "purchase",
      voucher_number: row.purchase_voucher || "",
      target_date: row.purchase_date || "",
      amount: toNumber(row.amount),
      status: "Applied",
    });
  });
  allocations.forEach((row) => {
    pushReceiptApplication(row.receipt_date, row.vch_no, {
      target_kind: "sales",
      voucher_number: row.voucher_number || "",
      target_date: row.invoice_date || "",
      amount: toNumber(row.amount),
      status: "Applied",
    });
  });

  const collectionsByDateMap = new Map();
  buildSortedReceipts(receipts).forEach((row) => {
    const signed = toNumber(row.amount);
    const applications = applicationsByReceipt.get(
      `${dateOnly(row.receipt_date)}::${String(row.vch_no || "").trim()}`,
    ) || [];
    const salesApplied = applications
      .filter((application) => application.target_kind === "sales")
      .reduce((total, application) => total + toNumber(application.amount), 0);
    // Datewise Collected is AR only. A Payment spent on Purchases is not a
    // negative sales collection; its bills are listed on the expanded row.
    const arAmount = signed < 0 ? salesApplied : signed;
    const current = collectionsByDateMap.get(row.receipt_date) || {
      date: row.receipt_date,
      receipt_count: 0,
      collected_amount: 0,
      receipts: [],
    };
    current.receipt_count += 1;
    current.collected_amount += arAmount;
    current.receipts.push({
      vch_no: row.vch_no,
      amount: signed,
      ar_amount: arAmount,
      vch_type: row.vch_type || (signed < 0 ? "Payment" : "Receipt"),
      kind: signed < 0 ? "payment" : "receipt",
      applications,
    });
    collectionsByDateMap.set(row.receipt_date, current);
  });

  const purchaseSalesByKey = new Map();
  purchaseSalesAllocations.forEach((row) => {
    const key = `${row.purchase_date}::${row.purchase_voucher}`;
    const list = purchaseSalesByKey.get(key) || [];
    list.push({
      target_kind: "sales",
      voucher_number: row.voucher_number || "",
      target_date: row.invoice_date || "",
      amount: toNumber(row.amount),
      status: "Applied",
    });
    purchaseSalesByKey.set(key, list);
  });

  const purchasesByDateMap = new Map();
  buildPurchaseRegisterRows(receipts).forEach((row) => {
    const current = purchasesByDateMap.get(row.purchase_date) || {
      date: row.purchase_date,
      purchase_count: 0,
      purchase_amount: 0,
      purchases: [],
    };
    current.purchase_count += 1;
    current.purchase_amount += toNumber(row.amount);
    current.purchases.push({
      vch_no: row.vch_no,
      amount: toNumber(row.amount),
      vch_type: row.vch_type || "Purchase",
      kind: "purchase",
      applications: purchaseSalesByKey.get(`${row.purchase_date}::${row.vch_no}`) || [],
    });
    purchasesByDateMap.set(row.purchase_date, current);
  });

  const allDates = [...new Set([
    ...salesByDateMap.keys(),
    ...collectionsByDateMap.keys(),
    ...purchasesByDateMap.keys(),
  ])].sort();

  const datewise = allDates.map((date) => {
    const sales = salesByDateMap.get(date) || {
      date,
      invoice_count: 0,
      sales_excl_vat: 0,
      sales_incl_vat: 0,
      paid_amount: 0,
      open_amount: 0,
      invoices: [],
    };
    const collections = collectionsByDateMap.get(date) || {
      date,
      receipt_count: 0,
      collected_amount: 0,
      receipts: [],
    };
    const dayPurchases = purchasesByDateMap.get(date) || {
      date,
      purchase_count: 0,
      purchase_amount: 0,
      purchases: [],
    };
    return {
      date,
      invoice_count: sales.invoice_count,
      sales_excl_vat: sales.sales_excl_vat,
      sales_incl_vat: sales.sales_incl_vat,
      receipt_count: collections.receipt_count,
      collected_amount: collections.collected_amount,
      purchase_count: dayPurchases.purchase_count,
      purchase_amount: dayPurchases.purchase_amount,
      paid_against_sales: sales.paid_amount,
      open_sales_amount: sales.open_amount,
      invoices: sales.invoices || [],
      receipts: collections.receipts || [],
      purchases: dayPurchases.purchases || [],
    };
  });

  const purchaseSettlementEvents = purchaseAllocations.map((row) => ({
    kind: "payment_purchase",
    target_kind: "purchase",
    receipt_date: row.payment_date,
    vch_no: row.vch_no,
    invoice_date: row.purchase_date,
    voucher_number: row.purchase_voucher,
    amount: toNumber(row.amount),
    days: null,
  }));

  const settlementEvents = [
    ...allocations.map((row) => ({ ...row, kind: "receipt", target_kind: "sales" })),
    ...purchaseSettlementEvents,
  ].sort((left, right) => {
    if (left.receipt_date !== right.receipt_date) {
      return left.receipt_date.localeCompare(right.receipt_date);
    }
    if (left.invoice_date !== right.invoice_date) {
      return String(left.invoice_date || "").localeCompare(String(right.invoice_date || ""));
    }
    return String(left.voucher_number || "").localeCompare(String(right.voucher_number || ""));
  });

  const matchedPurchasePaymentRows = [
    ...matchedPurchasePayments.map((row) => ({ ...row, status: row.status || "Matched" })),
    // Non-exact FIFO slices so payments like Sep//Bpmt0125 appear as adjusted to Purchases.
    ...purchaseAllocations.map((row) => ({
      purchase_date: row.purchase_date,
      purchase_voucher: row.purchase_voucher,
      purchase_amount: null,
      payment_date: row.payment_date,
      payment_voucher: row.vch_no,
      amount: toNumber(row.amount),
      match_days: isoDaysBetween(row.payment_date, row.purchase_date),
      status: "Applied",
    })),
  ].sort((left, right) => {
    if (left.payment_date !== right.payment_date) {
      return String(left.payment_date || "").localeCompare(String(right.payment_date || ""));
    }
    return String(left.payment_voucher || "").localeCompare(String(right.payment_voucher || ""));
  });

  // Exact Payment↔Purchase pairs live in their own table (like CN reversals).
  const purchaseRows = purchases
    .filter((row) => !row.exact_matched)
    .map((row) => {
      const paid = toNumber(row.amount) - toNumber(row.remaining);
      let status = "Open";
      if (toNumber(row.remaining) <= 0.009) status = "Paid";
      else if (paid > 0.009) status = "Partial";
      return {
        purchase_date: row.purchase_date,
        voucher_number: row.vch_no,
        amount: toNumber(row.amount),
        paid_amount: paid,
        remaining: toNumber(row.remaining),
        status,
      };
    });

  const openSalesAmount = invoiceRows.reduce((total, row) => total + toNumber(row.remaining), 0);
  const reversedRows = [...reversedInvoices].sort((left, right) => {
    if (left.invoice_date !== right.invoice_date) {
      return String(left.invoice_date || "").localeCompare(String(right.invoice_date || ""));
    }
    return String(left.voucher_number || "").localeCompare(String(right.voucher_number || ""));
  });

  const invoiceSalesExclVat = invoiceRows.reduce(
    (total, row) => total + toNumber(row.gross_amount_excl_vat ?? row.amount_excl_vat),
    0,
  );
  const invoiceSalesInclVat = sumMoney(
    invoiceRows.map((row) => row.gross_amount_incl_vat ?? row.amount_incl_vat),
  );
  const reversedSalesExclVat = reversedRows.reduce((total, row) => total + toNumber(row.amount_excl_vat), 0);
  const reversedSalesInclVat = sumMoney(reversedRows.map((row) => row.amount_incl_vat));
  // KPI Sales includes reversed invoices (still excluded from FIFO / avg days).
  const salesExclVat = invoiceSalesExclVat + reversedSalesExclVat;
  const salesInclVat = sumMoney([invoiceSalesInclVat, reversedSalesInclVat]);
  const paidAmount = invoiceRows.reduce((total, row) => total + row.paid_amount, 0) + reversedSalesInclVat;
  // AR collected = positive collection receipts + Payment leftovers that settled sales.
  // Purchase-side Payments stay on AP and do not reduce AR collected.
  const cashRows = buildSortedReceipts(receipts);
  const positiveReceiptSum = cashRows
    .filter((row) => toNumber(row.amount) > 0)
    .reduce((total, row) => total + toNumber(row.amount), 0);
  const debitReceiptSum = allocations
    .filter((row) => toNumber(row.amount) < 0)
    .reduce((total, row) => total + toNumber(row.amount), 0);
  const collectedAmount = positiveReceiptSum + toNumber(paymentAppliedToSales) + debitReceiptSum;

  // Credit notes already paired as immediate reversals are not deducted again.
  // Remaining credit notes reduce billable sales so: Sales − CN − Collected = Open.
  const pairedCreditNoteKeys = new Set(
    reversedRows.map((row) => invoiceKey(row.credit_note_date, row.credit_note_voucher)),
  );
  const unmatchedCreditNotes = buildCreditNotes(transactions)
    .filter((note) => !pairedCreditNoteKeys.has(invoiceKey(note.credit_date, note.voucher_number)))
    .map((note) => ({
      credit_date: note.credit_date,
      voucher_number: note.voucher_number,
      reference: note.reference || "",
      voucher_type: note.voucher_type || "",
      kind: note.kind || classifyCreditNoteKind(note.voucher_type, note.voucher_number),
      amount_excl_vat: toNumber(note.amount_excl_vat),
      amount_incl_vat: toNumber(note.amount),
      items: Array.isArray(note.items) ? [...note.items] : [],
      item_codes: Array.isArray(note.item_codes) ? [...note.item_codes] : [],
      status: "Credit",
    }))
    .sort((left, right) => {
      if (left.credit_date !== right.credit_date) {
        return String(left.credit_date || "").localeCompare(String(right.credit_date || ""));
      }
      return String(left.voucher_number || "").localeCompare(String(right.voucher_number || ""));
    });

  // Credit-note table "Applied to" follows the same FIFO as the invoice Paid column.
  const creditNotes = attachCreditNotesToInvoices(invoiceRows, unmatchedCreditNotes);
  invoiceRows.forEach((row) => {
    row.credit_notes = (Array.isArray(row.fifo_credit_notes) ? row.fifo_credit_notes : []).map((note) => ({
      ...note,
      kind: note.kind || "Credit Note",
    }));
  });
  const appliedByNote = new Map();
  invoiceRows.forEach((row) => {
    (row.fifo_credit_notes || []).forEach((chunk) => {
      const key = `${chunk.credit_date}::${chunk.voucher_number}`;
      const list = appliedByNote.get(key) || [];
      if (row.voucher_number && !list.includes(row.voucher_number)) list.push(row.voucher_number);
      appliedByNote.set(key, list);
    });
  });
  creditNotes.forEach((note) => {
    const targets = appliedByNote.get(`${note.credit_date}::${note.voucher_number}`);
    if (targets?.length) {
      note.applied_to_voucher = targets.join(", ");
      note.applied_to_date = note.applied_to_date || "";
    }
  });

  const creditNoteAmount = sumMoney(creditNotes.map((note) => note.amount_incl_vat));
  const unmatchedCreditNoteAmount = creditNotes
    .filter((note) => !String(note.applied_to_voucher || "").trim())
    .reduce((total, note) => total + toNumber(note.amount_incl_vat), 0);
  const netSalesInclVat = sumMoney([salesInclVat, -creditNoteAmount]);
  const purchaseAppliedToSales = purchaseSalesAllocations.reduce(
    (total, row) => total + toNumber(row.amount),
    0,
  );
  // Purchase credits reduce Open and are not cash, so they sit beside Collected.
  const balanceDelta = netSalesInclVat - collectedAmount - purchaseAppliedToSales - openSalesAmount;

  const tallyFifo = buildTallyFifoDiscrepancies(invoiceRows, {
    unmatchedReceiptAmount,
    hasOutstandingRows,
  });
  const outstandingCompare = buildTallyVsComputedOutstanding(invoiceRows, {
    unmatchedReceiptAmount,
    unmatchedCreditNoteAmount,
    hasOutstandingRows,
  });

  const totals = {
    sales_excl_vat: salesExclVat,
    sales_incl_vat: salesInclVat,
    invoice_sales_excl_vat: invoiceSalesExclVat,
    invoice_sales_incl_vat: invoiceSalesInclVat,
    credit_note_amount: creditNoteAmount,
    credit_note_excl_vat: creditNotes.reduce((total, note) => total + toNumber(note.amount_excl_vat), 0),
    net_sales_incl_vat: netSalesInclVat,
    collected_amount: collectedAmount,
    paid_amount: paidAmount,
    open_sales_amount: openSalesAmount,
    outstanding_unpaid: hasOutstandingRows ? outstanding.totalOutstanding : openSalesAmount,
    open_matches_outstanding: hasOutstandingRows
      ? Math.abs(openSalesAmount - outstanding.totalOutstanding) <= 0.02
      : true,
    sales_minus_collected: netSalesInclVat - collectedAmount,
    balance_delta: balanceDelta,
    sales_collected_matches_open: Math.abs(balanceDelta) <= 0.02,
    unmatched_receipt_amount: toNumber(unmatchedReceiptAmount),
    payment_applied_to_purchases: toNumber(paymentAppliedToPurchases),
    payment_applied_to_sales: toNumber(paymentAppliedToSales),
    purchase_applied_to_sales: purchaseAppliedToSales,
    open_purchase_amount: purchaseRows.reduce((total, row) => total + toNumber(row.remaining), 0),
    purchase_count: purchaseRows.length,
    matched_purchase_payment_count: matchedPurchasePaymentRows.length,
    matched_purchase_payment_amount: matchedPurchasePaymentRows.reduce(
      (total, row) => total + toNumber(row.amount),
      0,
    ),
    invoice_count: invoiceRows.length,
    paid_invoice_count: invoiceRows.filter((row) => row.status === "Paid").length,
    partial_invoice_count: invoiceRows.filter((row) => row.status === "Partial").length,
    open_invoice_count: invoiceRows.filter((row) => row.status === "Open").length,
    reversed_invoice_count: reversedRows.length,
    reversed_sales_excl_vat: reversedSalesExclVat,
    reversed_sales_incl_vat: reversedSalesInclVat,
    credit_note_count: creditNotes.length,
    tally_fifo_discrepancy_count: tallyFifo.totals.discrepancy_count,
    tally_fifo_over_allocated: tallyFifo.totals.over_allocated,
    tally_fifo_under_allocated: tallyFifo.totals.under_allocated,
    computed_open: outstandingCompare.totals.computed_open,
    tally_open: outstandingCompare.totals.tally_open,
    outstanding_open_delta: outstandingCompare.totals.open_delta,
    outstanding_discrepancy_count: outstandingCompare.totals.discrepancy_count,
  };

  return {
    summary,
    totals,
    invoices: invoiceRows,
    reversedInvoices: reversedRows,
    creditNotes,
    tallyFifoDiscrepancies: tallyFifo.rows,
    tallyFifoTotals: tallyFifo.totals,
    outstandingCompareRows: outstandingCompare.rows,
    outstandingCompareAllRows: outstandingCompare.allRows,
    outstandingCompareTotals: outstandingCompare.totals,
    datewise,
    settlementEvents,
    purchases: purchaseRows,
    purchaseAllocations,
    matchedPurchasePayments: matchedPurchasePaymentRows,
    outstandingInvoices: outstanding.invoices,
  };
}
