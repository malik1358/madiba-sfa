import { splitPartyByLeadingCode } from "./customerCode.js";

const BUYER_SECTION_MARKERS = [
  /^buyer$/i,
  /^bill\s*to$/i,
  /^customer$/i,
  /^المشتري$/,
];

const ADDRESS_OR_META_LINE = /^(building|district|region|country|vat|place\s*of\s*supply|secondary|commercial|crn|postal|zip|phone|tel|email|saudi\s*arabia)/i;

function looksLikeErpCustomerCode(value) {
  return /^\d{3,6}[A-Z]?$/i.test(String(value || "").trim());
}

function normalizePdfLines(pdfText) {
  return String(pdfText || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function parsePartyLine(line) {
  const parsed = splitPartyByLeadingCode(line);
  if (!parsed.customer_code || /^PROSPECT-/i.test(parsed.customer_code)) {
    return null;
  }
  if (!looksLikeErpCustomerCode(parsed.customer_code)) {
    return null;
  }
  if (!parsed.customer_name || parsed.customer_name.length < 3) {
    return null;
  }
  if (ADDRESS_OR_META_LINE.test(parsed.customer_name)) {
    return null;
  }
  return parsed;
}

function isBuyerMarkerLine(line) {
  if (!line) return false;
  if (BUYER_SECTION_MARKERS.some((pattern) => pattern.test(line))) {
    return true;
  }
  return /\bbuyer\b/i.test(line) && line.length <= 24;
}

function findPartyNearBuyerMarker(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    if (!isBuyerMarkerLine(lines[index])) continue;

    for (let offset = -1; offset >= -20; offset -= 1) {
      const candidate = lines[index + offset];
      if (!candidate || ADDRESS_OR_META_LINE.test(candidate)) continue;

      const parsed = parsePartyLine(candidate);
      if (parsed) {
        return { ...parsed, sourceLine: candidate };
      }
    }

    for (let offset = 1; offset <= 6; offset += 1) {
      const candidate = lines[index + offset];
      if (!candidate || ADDRESS_OR_META_LINE.test(candidate)) continue;

      const parsed = parsePartyLine(candidate);
      if (parsed) {
        return { ...parsed, sourceLine: candidate };
      }
    }
  }

  return null;
}

function findPartyFromBuyerBlock(pdfText) {
  const match = String(pdfText || "").match(
    /(\d{3,6}[A-Z]?\s+[A-Z][A-Z0-9\s&.,'-]{4,})[\s\S]{0,120}?(?:buyer|bill\s*to|المشتري)/i,
  );
  if (!match) return null;

  const parsed = parsePartyLine(match[1].trim());
  if (!parsed) return null;

  return { ...parsed, sourceLine: match[1].trim() };
}

export function extractInvoiceBuyerFromPdfText(pdfText) {
  const lines = normalizePdfLines(pdfText);

  const fromMarker = findPartyNearBuyerMarker(lines);
  if (fromMarker) return fromMarker;

  const fromBlock = findPartyFromBuyerBlock(pdfText);
  if (fromBlock) return fromBlock;

  return { customer_code: "", customer_name: "", sourceLine: "" };
}
