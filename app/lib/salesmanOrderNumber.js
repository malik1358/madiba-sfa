/**
 * Salesman-wise order numbers that can be allotted offline and never change after sync.
 * Format: {SALESMANCODE}-{NNNN} e.g. PARVEZ-0042
 */

export const SALESMAN_ORDER_NUMBER_SEP = "-";
const SEQ_PAD = 4;

export function normalizeSalesmanOrderPrefix(salesmanCode = "") {
  return String(salesmanCode || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 16);
}

export function formatSalesmanOrderNumber(salesmanCode, sequence) {
  const prefix = normalizeSalesmanOrderPrefix(salesmanCode);
  const seq = Number(sequence);
  if (!prefix || !Number.isFinite(seq) || seq < 1) return "";
  return `${prefix}${SALESMAN_ORDER_NUMBER_SEP}${String(Math.floor(seq)).padStart(SEQ_PAD, "0")}`;
}

export function parseSalesmanOrderNumber(orderNumber = "") {
  const text = String(orderNumber || "").trim().toUpperCase();
  const match = text.match(/^([A-Z0-9]{1,16})-(\d{1,8})$/);
  if (!match) return null;
  return {
    prefix: match[1],
    sequence: Number(match[2]),
    orderNumber: `${match[1]}${SALESMAN_ORDER_NUMBER_SEP}${match[2].padStart(SEQ_PAD, "0")}`,
  };
}

export function isSalesmanOrderNumber(orderNumber = "") {
  return Boolean(parseSalesmanOrderNumber(orderNumber));
}

export function isSalesmanOrderNumberForCode(orderNumber, salesmanCode) {
  const parsed = parseSalesmanOrderNumber(orderNumber);
  if (!parsed) return false;
  const prefix = normalizeSalesmanOrderPrefix(salesmanCode);
  return Boolean(prefix) && parsed.prefix === prefix;
}

export function maxSequenceFromOrderNumbers(orderNumbers = [], salesmanCode = "") {
  const prefix = normalizeSalesmanOrderPrefix(salesmanCode);
  let max = 0;
  (Array.isArray(orderNumbers) ? orderNumbers : []).forEach((value) => {
    const parsed = parseSalesmanOrderNumber(value);
    if (!parsed) return;
    if (prefix && parsed.prefix !== prefix) return;
    if (parsed.sequence > max) max = parsed.sequence;
  });
  return max;
}

export function nextSalesmanOrderSequence(currentMax = 0) {
  const max = Number(currentMax);
  if (!Number.isFinite(max) || max < 0) return 1;
  return Math.floor(max) + 1;
}
