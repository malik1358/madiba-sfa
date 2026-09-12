import { VAT_RATE } from "./regionalPricing.js";
import { normalizeItemCode } from "./invoiceOrderCompare.js";

function roundMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number * 100) / 100;
}

export function parseMoneyAmount(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const cleaned = text.replace(/[^\d.,-]/g, "");
  if (!cleaned) return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;
  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastComma > lastDot
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const decimals = cleaned.length - lastComma - 1;
    normalized = decimals === 3 ? cleaned.replace(/,/g, "") : cleaned.replace(",", ".");
  } else {
    normalized = cleaned.replace(/,/g, "");
  }

  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function firstAmountAfter(text, pattern) {
  const source = String(text || "");
  const match = source.match(pattern);
  if (!match) return null;
  const from = match.index + match[0].length;
  const window = source.slice(from, from + 80);
  const numberMatch = window.match(/-?\d[\d.,]*/);
  return parseMoneyAmount(numberMatch?.[0]);
}

function exclVatFromIncl(incl, vatRate = VAT_RATE) {
  const total = Number(incl);
  const rate = Number(vatRate);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(rate) || rate <= 0) return null;
  return roundMoney(total / (1 + rate));
}

export function amountInclVat(excl, vatRate = VAT_RATE) {
  const amount = Number(excl);
  const rate = Number(vatRate);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(rate) || rate < 0) return null;
  return roundMoney(amount * (1 + rate));
}

export function invoiceAmountExclVatFromLines(orderLines = [], diffs = []) {
  const diffByCode = new Map();
  (diffs || []).forEach((diff) => {
    const code = normalizeItemCode(diff?.item_code);
    if (!code || diffByCode.has(code)) return;
    diffByCode.set(code, diff);
  });

  let sum = 0;
  let counted = false;
  (orderLines || []).forEach((line) => {
    const code = normalizeItemCode(line?.item_code);
    const diff = diffByCode.get(code);
    if (diff?.type === "missing_item") return;

    const qty = Number(diff?.invoice_quantity ?? line?.quantity ?? 0);
    const rate = Number(diff?.invoice_rate ?? line?.rate ?? 0);
    if (!Number.isFinite(qty) || !Number.isFinite(rate)) return;
    sum += qty * rate;
    counted = true;
  });

  return counted ? roundMoney(sum) : null;
}

function extractInvoiceAmountExclVatFromText(text, vatRate) {
  const excl = firstAmountAfter(text, /amount\s+without\s+vat|amount\s+excl(?:usive|\.)?\s*(?:of\s+)?vat|amount\s+before\s+(?:vat|tax)|taxable\s+(?:amount|value)|net\s+(?:amount|value)(?!\s+incl)|sub[\s-]?total|total\s+(?:excl|excluding|before)|المبلغ\s+بدون\s+ضريبة|القيمة\s+الخاضعة/i);
  if (Number.isFinite(excl) && excl > 0) return roundMoney(excl);

  const vatAmount = firstAmountAfter(text, /vat\s*15\s*%|vat\s+amount|value added tax|ضريبة\s+القيمة\s+المضافة|ضريبة\s*15\s*%/i);
  const incl = firstAmountAfter(text, /amount\s+(?:incl|including|with)\s+vat|total\s+(?:incl|including|with)\s+vat|grand\s+total|total\s+amount|الإجمالي\s+شامل|المبلغ\s+شامل/i);
  if (Number.isFinite(incl) && incl > 0 && Number.isFinite(vatAmount) && vatAmount >= 0) {
    return roundMoney(incl - vatAmount);
  }
  if (Number.isFinite(incl) && incl > 0) {
    return exclVatFromIncl(incl, vatRate);
  }
  if (Number.isFinite(vatAmount) && vatAmount > 20) {
    return roundMoney(vatAmount / vatRate);
  }

  return null;
}

export function extractInvoiceAmountExclVat(pdfText, { vatRate = VAT_RATE } = {}) {
  const text = String(pdfText || "");
  if (!text.trim()) return null;
  return extractInvoiceAmountExclVatFromText(text.slice(-2000), vatRate)
    ?? extractInvoiceAmountExclVatFromText(text, vatRate);
}

export function resolveInvoiceAmountExclVat({
  pdfText = "",
  orderLines = [],
  diffs = [],
  vatRate = VAT_RATE,
} = {}) {
  const fromPdf = extractInvoiceAmountExclVat(pdfText, { vatRate });
  if (Number.isFinite(fromPdf) && fromPdf > 0) return fromPdf;
  return invoiceAmountExclVatFromLines(orderLines, diffs);
}
