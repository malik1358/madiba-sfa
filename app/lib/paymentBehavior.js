import {
  parseOutstandingSheetDate,
  resolveInvoiceDays,
  resolveOverdueDaysFromDueDate,
  toNumber,
} from "./outstanding.js";
import { amountInclVatFromExcl, vatRateForProduct } from "./regionalPricing.js";

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

/** Same-day or next-day credit notes count as an immediate reverse (not payment). */
export const IMMEDIATE_REVERSAL_MAX_DAYS = 1;
const AMOUNT_TOLERANCE = 0.02;

function invoiceKey(invoiceDate, voucherNumber) {
  return `${dateOnly(invoiceDate)}::${String(voucherNumber || "").trim()}`;
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
 * grossed up at 15% unless it is a gloves (VAT-exempt) product.
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
    const key = `${invoiceDate}::${voucher || "NO-VOUCHER"}`;
    const current = map.get(key) || {
      invoice_date: invoiceDate,
      voucher_number: voucher,
      amount_excl_vat: 0,
      amount: 0,
      remaining: 0,
      items: [],
      item_codes: [],
    };
    current.amount_excl_vat += amountExclVat;
    current.amount += amountInclVat;
    current.remaining = current.amount;
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
    invoice.credit_notes.push({
      type: "credit_note",
      credit_date: note.credit_date,
      voucher_number: note.voucher_number,
      kind: note.kind || classifyCreditNoteKind(note.voucher_type, note.voucher_number),
      reference: note.reference || "",
      amount,
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
 * Pair invoices with credit notes within ±1 day for the same full amount.
 * Covers same-day / next-day voids and reissue pairs where the CN is dated
 * one day before the replacement invoice (e.g. CN 2384 on 31 Dec → invoice 2397 on 1 Jan).
 * These are voids/reversals, not customer payments — exclude from avg days to pay.
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

  for (const invoice of (Array.isArray(invoices) ? invoices : [])) {
    const invoiceAmount = toNumber(invoice.amount);
    if (invoiceAmount <= AMOUNT_TOLERANCE) continue;

    const candidates = unusedNotes
      .map((note, index) => {
        if (toNumber(note.remaining) <= AMOUNT_TOLERANCE) return null;

        const offset = isoDayOffset(invoice.invoice_date, note.credit_date);
        if (offset == null || Math.abs(offset) > maxDays) return null;
        const days = Math.abs(offset);

        const amountOk = amountsMatch(note.remaining, invoiceAmount)
          || amountsMatch(note.amount, invoiceAmount);
        // Full reverse only — partial credit notes stay in the normal ledger.
        if (!amountOk) return null;

        const noteRef = normalizeRef(note.reference || note.voucher_number);
        const invoiceRef = normalizeRef(invoice.voucher_number);
        const refHit = Boolean(
          invoiceRef
          && noteRef
          && (noteRef.includes(invoiceRef) || invoiceRef.includes(noteRef)),
        );
        const itemOverlap = itemCodeOverlapCount(note.item_codes, invoice.item_codes)
          || itemOverlapCount(note.items, invoice.items);
        const noteHasItems = (Array.isArray(note.item_codes) && note.item_codes.length > 0)
          || (Array.isArray(note.items) && note.items.length > 0);
        const invoiceHasItems = (Array.isArray(invoice.item_codes) && invoice.item_codes.length > 0)
          || (Array.isArray(invoice.items) && invoice.items.length > 0);
        // When both sides have items, require overlap so a same-amount CN does not
        // reverse the wrong bill within the ±1 day window.
        if (noteHasItems && invoiceHasItems && itemOverlap <= 0 && !refHit) return null;

        return {
          note,
          index,
          days,
          score: (refHit ? 1000 : 0)
            + (itemOverlap * 50)
            + (amountOk ? 100 : 0)
            - days
            // Prefer CN on/after the invoice when scores tie (classic void),
            // but still allow CN one day before (replacement invoice).
            + (offset >= 0 ? 5 : 0),
        };
      })
      .filter(Boolean)
      .sort((left, right) => right.score - left.score || left.index - right.index);

    const best = candidates[0];
    if (!best) continue;

    best.note.remaining = 0;
    const key = invoiceKey(invoice.invoice_date, invoice.voucher_number);
    reversedKeys.add(key);
    reversals.push({
      invoice_date: invoice.invoice_date,
      voucher_number: invoice.voucher_number,
      amount_excl_vat: toNumber(invoice.amount_excl_vat),
      amount_incl_vat: invoiceAmount,
      credit_note_date: best.note.credit_date,
      credit_note_voucher: best.note.voucher_number,
      credit_note_amount: toNumber(best.note.amount),
      credit_note_reference: best.note.reference || "",
      reversal_days: best.days,
      status: "Reversed",
    });
  }

  return { reversals, reversedKeys };
}

export function buildSortedReceipts(receipts = []) {
  return (Array.isArray(receipts) ? receipts : [])
    .map((row) => ({
      receipt_date: dateOnly(row?.receipt_date),
      amount: toNumber(row?.amount),
      vch_no: String(row?.vch_no || "").trim(),
    }))
    .filter((row) => row.receipt_date && row.amount > 0)
    .sort((left, right) => {
      if (left.receipt_date !== right.receipt_date) {
        return left.receipt_date.localeCompare(right.receipt_date);
      }
      return String(left.vch_no || "").localeCompare(String(right.vch_no || ""));
    });
}

/**
 * FIFO-match receipts onto sales invoices to estimate days-to-pay.
 * Receipts have no invoice ref, so oldest open invoice is paid first.
 * Invoices reversed immediately by credit notes are excluded from matching.
 */
export function matchPaymentsFifo(transactions = [], receipts = []) {
  const allInvoices = buildSalesInvoices(transactions).map((invoice) => ({ ...invoice }));
  const creditNotes = buildCreditNotes(transactions);
  const { reversals, reversedKeys } = findImmediateCreditNoteReversals(allInvoices, creditNotes);
  const invoices = allInvoices
    .filter((invoice) => !reversedKeys.has(invoiceKey(invoice.invoice_date, invoice.voucher_number)))
    .map((invoice) => ({ ...invoice, remaining: toNumber(invoice.amount) }));
  const paymentRows = buildSortedReceipts(receipts);
  const allocations = [];
  let unmatchedReceiptAmount = 0;

  for (const receipt of paymentRows) {
    let remaining = receipt.amount;

    for (const invoice of invoices) {
      if (remaining <= 0.009) break;
      if (invoice.remaining <= 0.009) continue;
      if (receipt.receipt_date < invoice.invoice_date) continue;

      const applied = Math.min(remaining, invoice.remaining);
      const days = isoDaysBetween(receipt.receipt_date, invoice.invoice_date);
      if (days != null && applied > 0) {
        allocations.push({
          invoice_date: invoice.invoice_date,
          voucher_number: invoice.voucher_number,
          receipt_date: receipt.receipt_date,
          vch_no: receipt.vch_no,
          amount: applied,
          days,
        });
      }
      invoice.remaining = Math.max(0, invoice.remaining - applied);
      remaining = Math.max(0, remaining - applied);
    }

    unmatchedReceiptAmount += Math.max(0, remaining);
  }

  return {
    invoices,
    allocations,
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
    const amount = toNumber(row?.amount);
    const days = Number(row?.days);
    if (amount > 0.009 && Number.isFinite(days) && days >= 0) {
      observations.push({ amount, days, source: "paid" });
    }
  });

  (Array.isArray(openInvoices) ? openInvoices : []).forEach((row) => {
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

export function emptyPaymentBehavior() {
  return {
    avgDaysToPay: null,
    avgDaysPaidOnly: null,
    medianDaysToPay: null,
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

/**
 * Combine sales+receipt FIFO days-to-pay with outstanding unpaid bill stats.
 * Avg days starts from paid receipts, then blends only open unpaid invoices
 * older than that paid-only avg (so open age can raise, never reduce, the avg).
 * Paid-only avg is kept as avgDaysPaidOnly for comparison.
 */
export function buildPaymentBehavior({
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
  // Prefer outstanding upload rows (book truth) for open age; else FIFO residual.
  const openForAvg = outstanding.invoices.length > 0
    ? outstanding.invoices
    : unpaidFromSales;

  const paidObservations = buildDaysToPayObservations({ allocations, openInvoices: [] });
  const paidAmount = paidObservations.reduce((total, row) => total + row.amount, 0);
  const paidAvgRaw = weightedAverageDays(paidObservations);
  const avgDaysPaidOnly = roundDays(paidAvgRaw);

  // Only open invoices older than paid-only avg can enter the blend.
  // With no paid history, all open invoices are included (no floor to spoil).
  const openFloor = paidAvgRaw != null ? paidAvgRaw : null;
  const blendedObservations = buildDaysToPayObservations({
    allocations,
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

export function formatPaymentDaysLabel(behavior) {
  if (!behavior || behavior.avgDaysToPay == null) return "—";
  return `${behavior.avgDaysToPay} days`;
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
      const salesIncl = toNumber(row.amount_incl_vat);
      const fifoPaid = toNumber(row.fifo_paid);
      const fifoOpen = row.fifo_remaining == null
        ? Math.max(0, salesIncl - fifoPaid)
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
    const salesIncl = toNumber(row.amount_incl_vat);
    const cashSettled = toNumber(row.fifo_paid);
    const creditChunks = (Array.isArray(row.credit_notes) ? row.credit_notes : []).map((chunk) => ({
      credit_date: chunk.credit_date,
      voucher_number: chunk.voucher_number || "",
      amount: toNumber(chunk.amount),
    }));
    const creditNoteSettled = creditChunks.reduce((total, chunk) => total + toNumber(chunk.amount), 0);
    const computedSettled = cashSettled + creditNoteSettled;
    const computedOpen = Math.max(0, salesIncl - computedSettled);
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
 * Paid / Open / Status follow cash FIFO (+ nested credit notes for display). Outstanding upload
 * is kept on each row for Tally comparison screens — it does not rewrite Paid/Open.
 * FIFO drives payment-days; avg days also includes open unpaid older than the paid-only avg
 * (open age can raise, never reduce, the metric).
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
    const fifoRemaining = toNumber(invoice.remaining);
    const amountInclVat = toNumber(invoice.amount);
    const outstandingMatch = outstandingByRef.get(normalizeRef(invoice.voucher_number)) || null;
    if (outstandingMatch) {
      matchedOutstandingRefs.add(normalizeRef(invoice.voucher_number));
    }

    // Paid / Open always follow FIFO cash allocation — never force to outstanding.
    const remaining = fifoRemaining;
    const paidAmount = fifoPaid;
    const outstandingPending = hasOutstandingRows
      ? (outstandingMatch ? toNumber(outstandingMatch.pending_amount) : 0)
      : null;
    const openSource = "fifo";

    const weightedDays = fifoPaid > 0
      ? settlements.reduce((total, row) => total + (Number(row.days || 0) * toNumber(row.amount)), 0) / fifoPaid
      : null;

    let status = "Open";
    if (remaining <= 0.009) {
      status = amountInclVat > 0.009 || fifoPaid > 0.009 ? "Paid" : "Open";
      if (remaining <= 0.009 && amountInclVat <= 0.009 && fifoPaid <= 0.009) status = "Paid";
    } else if (paidAmount > 0.009 && remaining > 0.009) {
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
      amount_excl_vat: toNumber(invoice.amount_excl_vat),
      amount_incl_vat: amountInclVat,
      paid_amount: paidAmount,
      fifo_paid: fifoPaid,
      remaining,
      fifo_remaining: fifoRemaining,
      outstanding_pending: outstandingPending,
      open_source: openSource,
      status,
      // Payment days only from cash receipt FIFO — credit notes never enter this average.
      payment_days: fifoPaid > 0.009 ? roundDays(weightedDays) : null,
      open_days: openDays,
      items: Array.isArray(invoice.items) ? [...invoice.items] : [],
      item_codes: Array.isArray(invoice.item_codes) ? [...invoice.item_codes] : [],
      settlements,
      credit_notes: [],
    };
  });

  // Outstanding refs not found in sales history still belong in Open.
  outstanding.invoices.forEach((row) => {
    const ref = normalizeRef(row.ref_no);
    if (!ref || matchedOutstandingRefs.has(ref)) return;
    invoiceRows.push({
      invoice_date: row.invoice_date || "",
      voucher_number: row.ref_no,
      amount_excl_vat: 0,
      amount_incl_vat: toNumber(row.pending_amount),
      paid_amount: 0,
      fifo_paid: 0,
      remaining: toNumber(row.pending_amount),
      fifo_remaining: null,
      outstanding_pending: toNumber(row.pending_amount),
      open_source: "outstanding",
      status: "Open",
      payment_days: null,
      open_days: row.open_days || 0,
      settlements: [],
      credit_notes: [],
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
    };
    current.invoice_count += 1;
    current.sales_excl_vat += row.amount_excl_vat;
    current.sales_incl_vat += row.amount_incl_vat;
    current.paid_amount += row.paid_amount;
    current.open_amount += row.remaining;
    salesByDateMap.set(row.invoice_date, current);
  });

  const collectionsByDateMap = new Map();
  buildSortedReceipts(receipts).forEach((row) => {
    const current = collectionsByDateMap.get(row.receipt_date) || {
      date: row.receipt_date,
      receipt_count: 0,
      collected_amount: 0,
    };
    current.receipt_count += 1;
    current.collected_amount += toNumber(row.amount);
    collectionsByDateMap.set(row.receipt_date, current);
  });

  const allDates = [...new Set([
    ...salesByDateMap.keys(),
    ...collectionsByDateMap.keys(),
  ])].sort();

  const datewise = allDates.map((date) => {
    const sales = salesByDateMap.get(date) || {
      date,
      invoice_count: 0,
      sales_excl_vat: 0,
      sales_incl_vat: 0,
      paid_amount: 0,
      open_amount: 0,
    };
    const collections = collectionsByDateMap.get(date) || {
      date,
      receipt_count: 0,
      collected_amount: 0,
    };
    return {
      date,
      invoice_count: sales.invoice_count,
      sales_excl_vat: sales.sales_excl_vat,
      sales_incl_vat: sales.sales_incl_vat,
      receipt_count: collections.receipt_count,
      collected_amount: collections.collected_amount,
      paid_against_sales: sales.paid_amount,
      open_sales_amount: sales.open_amount,
    };
  });

  const settlementEvents = [...allocations]
    .sort((left, right) => {
      if (left.receipt_date !== right.receipt_date) {
        return left.receipt_date.localeCompare(right.receipt_date);
      }
      if (left.invoice_date !== right.invoice_date) {
        return left.invoice_date.localeCompare(right.invoice_date);
      }
      return String(left.voucher_number || "").localeCompare(String(right.voucher_number || ""));
    });

  const openSalesAmount = invoiceRows.reduce((total, row) => total + toNumber(row.remaining), 0);
  const reversedRows = [...reversedInvoices].sort((left, right) => {
    if (left.invoice_date !== right.invoice_date) {
      return String(left.invoice_date || "").localeCompare(String(right.invoice_date || ""));
    }
    return String(left.voucher_number || "").localeCompare(String(right.voucher_number || ""));
  });

  const invoiceSalesExclVat = invoiceRows.reduce((total, row) => total + row.amount_excl_vat, 0);
  const invoiceSalesInclVat = invoiceRows.reduce((total, row) => total + row.amount_incl_vat, 0);
  const reversedSalesExclVat = reversedRows.reduce((total, row) => total + toNumber(row.amount_excl_vat), 0);
  const reversedSalesInclVat = reversedRows.reduce((total, row) => total + toNumber(row.amount_incl_vat), 0);
  // KPI Sales includes reversed invoices (still excluded from FIFO / avg days).
  const salesExclVat = invoiceSalesExclVat + reversedSalesExclVat;
  const salesInclVat = invoiceSalesInclVat + reversedSalesInclVat;
  const paidAmount = invoiceRows.reduce((total, row) => total + row.paid_amount, 0) + reversedSalesInclVat;
  const collectedAmount = buildSortedReceipts(receipts).reduce((total, row) => total + toNumber(row.amount), 0);

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

  // Display-only: nest partial CNs / returns under invoices next to cash receipts.
  // Never feeds FIFO payment-days or collected_amount.
  const creditNotes = attachCreditNotesToInvoices(invoiceRows, unmatchedCreditNotes);

  const creditNoteAmount = creditNotes.reduce((total, note) => total + toNumber(note.amount_incl_vat), 0);
  const unmatchedCreditNoteAmount = creditNotes
    .filter((note) => !String(note.applied_to_voucher || "").trim())
    .reduce((total, note) => total + toNumber(note.amount_incl_vat), 0);
  const netSalesInclVat = salesInclVat - creditNoteAmount;
  const balanceDelta = netSalesInclVat - collectedAmount - openSalesAmount;

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
    outstandingInvoices: outstanding.invoices,
  };
}

