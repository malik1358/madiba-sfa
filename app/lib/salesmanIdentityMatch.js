import {
  applySalesmanSpellingAliases,
  expandSalesmanSpellingComparableVariants,
  SALESMAN_SPELLING_CANONICAL_BY_TOKEN,
} from "./salesmanSpellingAliases.js";

export function isMissingRpcError(error) {
  const message = String(error?.message || error?.details || error?.hint || "").toLowerCase();
  const code = String(error?.code || "");
  return code === "42883"
    || code === "PGRST202"
    || message.includes("could not find the function")
    || message.includes("schema cache")
    || (message.includes("function") && message.includes("does not exist"));
}

function comparableIdentityForSearch(value) {
  return applySalesmanSpellingAliases(
    String(value || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function patternFromComparable(comparable) {
  return String(comparable || "")
    .replace(/[^A-Z0-9]+/g, "%")
    .replace(/^%+|%+$/g, "");
}

/** Same pattern as the customer-list and customer-history access checks. */
export function identitySearchPattern(value) {
  return patternFromComparable(comparableIdentityForSearch(value));
}

/** Canonical pattern plus spelling variants (Moinudin / Moinuddin) for ILIKE filters. */
export function identitySearchPatternsFor(value) {
  const comparable = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!comparable) return [];
  return [...new Set(
    expandSalesmanSpellingComparableVariants(comparable)
      .map(patternFromComparable)
      .filter(Boolean),
  )];
}

function canonicalizeIdentityPattern(pattern) {
  return String(pattern || "").replace(/[A-Za-z]+/g, (word) => {
    const upper = word.toUpperCase();
    return SALESMAN_SPELLING_CANONICAL_BY_TOKEN[upper] || word;
  });
}

/**
 * Postgres `column ilike '%pattern%'` for patterns made of letters, digits, and %.
 * % matches any length, including empty. Matching is case-insensitive.
 */
export function valueMatchesIdentityPattern(value, pattern) {
  const source = canonicalizeIdentityPattern(pattern);
  if (!source) return false;
  const expression = source
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/%/g, ".*")
    .replace(/_/g, ".");
  const regex = new RegExp(expression, "i");
  const raw = String(value ?? "");
  if (regex.test(raw)) return true;
  // Spelling aliases: Moinuddin must match a Moinudin pattern and vice versa.
  const canonicalValue = applySalesmanSpellingAliases(
    raw.trim().toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim(),
  );
  return Boolean(canonicalValue) && regex.test(canonicalValue);
}

export function rowMatchesSalesmanIdentity(row, patterns) {
  return (patterns || []).some((pattern) => (
    valueMatchesIdentityPattern(row?.salesman_code, pattern)
    || valueMatchesIdentityPattern(row?.salesman_name, pattern)
  ));
}

/**
 * Stored salesman_code values whose code or name matches a pattern.
 * A code is included when any of its pairs match. On the live batch each
 * code has one name, so this equals the old OR ILIKE. If a code later has
 * two names and only one matches, the code is included.
 */
export function exactSalesmanCodesFromPairs(pairs, patterns) {
  const codes = [];
  const seen = new Set();
  (pairs || []).forEach((pair) => {
    const code = String(pair?.salesman_code || "").trim();
    if (!code || seen.has(code)) return;
    if (!rowMatchesSalesmanIdentity(pair, patterns)) return;
    seen.add(code);
    codes.push(code);
  });
  return codes;
}

export async function loadActiveSalesmanPairs(admin) {
  if (typeof admin?.rpc !== "function") return { missing: true, pairs: [] };
  const { data, error } = await admin.rpc("active_salesman_pairs");
  if (error) {
    if (isMissingRpcError(error)) return { missing: true, pairs: [] };
    throw error;
  }
  return { missing: false, pairs: Array.isArray(data) ? data : [] };
}

/** Existence check on one customer, using customer_code equality rather than a leading wildcard. */
export async function customerHasMatchingSalesman(admin, table, customerCode, patterns, { nameOnly = false } = {}) {
  const wanted = (patterns || []).map((pattern) => String(pattern || "")).filter(Boolean);
  if (!customerCode || wanted.length === 0) return false;

  let afterId = null;
  const pageSize = 1000;
  while (true) {
    let query = admin
      .from(table)
      .select(nameOnly ? "id,salesman_name" : "id,salesman_code,salesman_name")
      .eq("customer_code", customerCode)
      .order("id", { ascending: true })
      .limit(pageSize);
    if (afterId != null) query = query.gt("id", afterId);

    const { data, error } = await query;
    if (error) throw error;
    const rows = data || [];
    const matched = rows.some((row) => (
      nameOnly
        ? wanted.some((pattern) => valueMatchesIdentityPattern(row?.salesman_name, pattern))
        : rowMatchesSalesmanIdentity(row, wanted)
    ));
    if (matched) return true;
    if (rows.length < pageSize) return false;
    afterId = rows[rows.length - 1]?.id;
    if (afterId == null) return false;
  }
}
