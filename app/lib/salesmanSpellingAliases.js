/**
 * Upload/profile spelling variants that must resolve to one salesman everywhere.
 * Canonical token is the map value (uppercase).
 */
export const SALESMAN_SPELLING_CANONICAL_BY_TOKEN = {
  MOINUDDIN: "MOINUDIN",
};

/** Canonical token → every accepted spelling (canonical first). */
export const SALESMAN_SPELLING_VARIANTS_BY_CANONICAL = {
  MOINUDIN: ["MOINUDIN", "MOINUDDIN"],
};

/** Rewrite known misspellings inside an already-uppercased salesman code/name. */
export function applySalesmanSpellingAliasesToUpper(value) {
  let text = String(value || "").toUpperCase();
  if (!text) return "";
  Object.entries(SALESMAN_SPELLING_CANONICAL_BY_TOKEN).forEach(([from, to]) => {
    text = text.replace(new RegExp(`\\b${from}\\b`, "g"), to);
  });
  return text;
}

/** Same rewrite on a space-separated comparable identity (uppercase tokens). */
export function applySalesmanSpellingAliases(comparable) {
  return String(comparable || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => SALESMAN_SPELLING_CANONICAL_BY_TOKEN[token] || token)
    .join(" ");
}

/**
 * Expand a comparable identity so ILIKE / pattern search finds every spelling.
 * Example: "MOINUDIN KHAJA" → also "MOINUDDIN KHAJA".
 */
export function expandSalesmanSpellingComparableVariants(comparable) {
  const raw = String(comparable || "").trim();
  if (!raw) return [];
  const canonical = applySalesmanSpellingAliases(raw);
  const variants = new Set([raw, canonical].filter(Boolean));
  const tokens = canonical.split(/\s+/).filter(Boolean);

  tokens.forEach((token, index) => {
    const group = SALESMAN_SPELLING_VARIANTS_BY_CANONICAL[token];
    if (!group) return;
    group.forEach((alt) => {
      const next = [...tokens];
      next[index] = alt;
      variants.add(next.join(" "));
    });
  });

  return [...variants];
}

/** Display-facing rewrite: Moinuddin → Moinudin (preserves ALL CAPS / Title case). */
export function canonicalizeSalesmanDisplayText(value) {
  return String(value ?? "").replace(/\bMoinuddin\b/gi, (match) => {
    if (match === match.toUpperCase()) return "MOINUDIN";
    if (match[0] === match[0].toUpperCase()) return "Moinudin";
    return "moinudin";
  });
}
