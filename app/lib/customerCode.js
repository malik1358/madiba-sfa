import { customerAccountCodesMatch, extractLeadingCustomerCodeAndName, normalizeCode } from "./outstanding.js";

export function parsePartyName(partyRaw) {
  const text = String(partyRaw || "").trim();
  if (!text) {
    return { customer_code: "", customer_name: "" };
  }

  const match = text.match(/^([A-Za-z0-9]+)\s*[_\-\s]+(.*)$/);
  if (match) {
    return {
      customer_code: normalizeCode(match[1]),
      customer_name: String(match[2] || "").trim(),
    };
  }

  const leading = extractLeadingCustomerCodeAndName(text);
  if (leading.customer_code) {
    return {
      customer_code: normalizeCode(leading.customer_code),
      customer_name: leading.customer_name || text,
    };
  }

  return { customer_code: "", customer_name: text };
}

export function canonicalCustomerCode(value) {
  const raw = normalizeCode(value);
  if (!raw) return "";

  const numericPrefix = raw.match(/^(\d{3,6}[A-Z]?)[-\s_]/);
  if (numericPrefix) return numericPrefix[1];

  const parsed = parsePartyName(raw);
  if (parsed.customer_code) return parsed.customer_code;

  const extracted = normalizeCode(extractLeadingCustomerCodeAndName(raw).customer_code);
  return extracted || raw.split(/\s+/)[0] || raw;
}

export function resolveExistingCollectionCustomerCode(candidates, targetCode) {
  const normalizedTarget = canonicalCustomerCode(targetCode);
  if (!normalizedTarget) return "";

  const matchingCandidates = (candidates || [])
    .map((candidate) => canonicalCustomerCode(candidate))
    .filter((candidate) => customerAccountCodesMatch(candidate, normalizedTarget));

  if (matchingCandidates.length === 0) return "";

  return matchingCandidates.reduce((bestMatch, candidate) => {
    if (
      !bestMatch
      || candidate.length > bestMatch.length
      || (candidate.length === bestMatch.length && candidate.localeCompare(bestMatch) < 0)
    ) {
      return candidate;
    }
    return bestMatch;
  }, "");
}

export function normalizeCustomerNameKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isProspectCustomerCode(value) {
  return /^PROSPECT-\d+$/i.test(String(value || "").trim());
}

export function firstWordLooksLikeCustomerCode(word) {
  return /\d/.test(String(word || ""));
}

export function splitPartyByLeadingCode(partyRaw) {
  const text = String(partyRaw || "").trim();
  if (!text) {
    return { customer_code: "", customer_name: "" };
  }

  // Treat 1409_RAWA'I / 1409-BRANCH as code 1409 (same account).
  const embedded = text.match(/^(\d{3,6}[A-Za-z]?)[_\-]+(.+)$/i);
  if (embedded) {
    return {
      customer_code: normalizeCode(embedded[1]),
      customer_name: String(embedded[2] || "").trim(),
    };
  }

  const [firstWord, ...restWords] = text.split(/\s+/);
  if (firstWordLooksLikeCustomerCode(firstWord)) {
    return {
      customer_code: normalizeCode(canonicalCustomerCode(firstWord) || firstWord),
      customer_name: restWords.join(" ").trim(),
    };
  }

  return { customer_code: "", customer_name: text };
}

export function buildCustomerPartyRaw(row) {
  const code = String(row?.customer_code || "").trim();
  const name = String(row?.customer_name || "").trim();

  if (!code && !name) return "";
  if (!code) return name;
  if (!name) return code;
  if (code === name) return code;
  if (name.startsWith(`${code} `) || name.startsWith(`${code}_`) || name.startsWith(`${code}-`)) {
    return name;
  }
  if (code.includes(" ")) return code;
  return `${code} ${name}`.trim();
}

export function resolveCustomerMasterExportFields(row) {
  const partyRaw = buildCustomerPartyRaw(row);
  const parsed = splitPartyByLeadingCode(partyRaw);
  const rawCode = String(row?.customer_code || "").trim();
  const rawName = String(row?.customer_name || "").trim();

  const customer_code =
    canonicalCustomerCode(parsed.customer_code) ||
    canonicalCustomerCode(rawCode) ||
    parsed.customer_code ||
    "";

  let customer_name = "";
  if (rawName) {
    const nameParsed = splitPartyByLeadingCode(rawName);
    const nameCode = canonicalCustomerCode(nameParsed.customer_code || rawName);
    if (nameCode && customer_code && nameCode === customer_code) {
      customer_name = nameParsed.customer_name || "";
    } else if (!nameCode || nameCode !== customer_code) {
      customer_name = rawName;
    }
  }
  if (!customer_name) {
    customer_name = parsed.customer_name || (customer_code ? "" : partyRaw);
  }

  return {
    partyName: customer_code ? `${customer_code} ${customer_name}`.trim() : (customer_name || partyRaw),
    customer_code,
    customer_name,
  };
}
