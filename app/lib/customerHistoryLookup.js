import { canonicalCustomerCode } from "./customerCode.js";
import {
  customerAccountCodesMatch,
  customerCodeCandidates,
  resolveCustomerAccountCode,
} from "./outstanding.js";

function normalizeHistoryCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function normalizeHistoryName(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

/** True when a stored "code" is really a party name (no account digits). */
export function customerCodeLooksLikeName(value) {
  const code = normalizeHistoryCode(value);
  if (!code) return false;
  if (/\d/.test(code)) return false;
  return /\s/.test(code) || code.length > 12;
}

/**
 * Expand dirty customer-master codes into lookup keys that can hit sales_raw.
 * Examples:
 * - "1409_RAWA'I" → ["1409_RAWA'I", "1409"]
 * - "1409 Rawa'i Al-Furs..." → ["1409 RAWA'I AL-FURS...", "1409"]
 */
export function buildCustomerHistoryCodeCandidates(...values) {
  const candidates = [];

  values.forEach((value) => {
    const normalized = normalizeHistoryCode(value);
    if (!normalized) return;

    customerCodeCandidates(normalized).forEach((candidate) => candidates.push(candidate));

    const accountCode = normalizeHistoryCode(resolveCustomerAccountCode(normalized));
    if (accountCode) candidates.push(accountCode);

    const canonical = normalizeHistoryCode(canonicalCustomerCode(normalized));
    if (canonical) candidates.push(canonical);

    const leadingToken = normalizeHistoryCode((normalized.match(/^([A-Z0-9]+)/) || [])[1] || "");
    if (leadingToken && /\d/.test(leadingToken)) candidates.push(leadingToken);
  });

  return [...new Set(candidates.filter(Boolean))];
}

export function historyRowMatchesCodeCandidates(rowCode, codeCandidates) {
  const normalizedRowCode = normalizeHistoryCode(rowCode);
  if (!normalizedRowCode || !Array.isArray(codeCandidates) || codeCandidates.length === 0) {
    return false;
  }

  return codeCandidates.some((candidate) => {
    if (!candidate) return false;
    if (normalizedRowCode === candidate) return true;

    const rowNoZeros = normalizedRowCode.replace(/^0+/, "");
    const candidateNoZeros = String(candidate).replace(/^0+/, "");
    if (rowNoZeros && candidateNoZeros && rowNoZeros === candidateNoZeros) return true;

    if (normalizedRowCode.startsWith(`${candidate} `) || normalizedRowCode.startsWith(`${candidate}_`)) {
      return true;
    }

    return customerAccountCodesMatch(normalizedRowCode, candidate);
  });
}

/**
 * Resolve the best customer name to use for sales_raw name fallback.
 * If the master code itself is a name (common dirty import), use that too.
 */
export function resolveCustomerHistoryName(customerCode, customerName, masterCustomerName = "") {
  const explicitName = normalizeHistoryName(customerName);
  if (explicitName) return explicitName;

  const masterName = normalizeHistoryName(masterCustomerName);
  if (masterName) return masterName;

  if (customerCodeLooksLikeName(customerCode)) {
    return normalizeHistoryName(customerCode);
  }

  return "";
}
