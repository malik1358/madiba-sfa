export const UNCLASSIFIED_CATEGORY = "Unclassified";

/** Display merges for imported / catalogue category labels (case-insensitive). */
const CATEGORY_DISPLAY_ALIASES = Object.freeze({
  "body care": "Personal Care",
});

/**
 * Canonical English → Arabic labels for guest-facing catalogues.
 * Keys are lowercase canonical English names after title-case + alias.
 */
const CATEGORY_ARABIC_LABELS = Object.freeze({
  "baby care": "العناية بالطفل",
  "building material": "مواد البناء",
  cosmetics: "مستحضرات التجميل",
  electronics: "إلكترونيات",
  fragrance: "العطور",
  "office supplies": "مستلزمات المكتب",
  "personal care": "العناية الشخصية",
  "pos supplies": "مستلزمات نقاط البيع",
  stationery: "القرطاسية",
  sundry: "متنوع",
  unclassified: "غير مصنف",
});

/** Title-case words; keep POS as POS. */
export function titleCaseCategoryLabel(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  return text
    .split(" ")
    .map((word) => (
      word.toUpperCase() === "POS"
        ? "POS"
        : `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`
    ))
    .join(" ");
}

/**
 * Trim + collapse spaces. Empty → Unclassified. Applies display aliases.
 * Preserves original casing when no alias matches (legacy BI / import behavior).
 */
export function normalizeCategoryName(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!text) return UNCLASSIFIED_CATEGORY;
  const alias = CATEGORY_DISPLAY_ALIASES[text.toLowerCase()];
  return alias || text;
}

/**
 * Stable display label: title-case then alias (Body Care → Personal Care).
 * Use for dropdowns / cards so "baby Care" and "Baby Care" collapse to one row.
 */
export function canonicalizeCategoryLabel(value) {
  const titled = titleCaseCategoryLabel(value);
  if (!titled) return UNCLASSIFIED_CATEGORY;
  return normalizeCategoryName(titled);
}

export function categoryArabicLabel(value) {
  const canonical = canonicalizeCategoryLabel(value);
  return CATEGORY_ARABIC_LABELS[canonical.toLowerCase()] || "";
}

/**
 * Guest UI: always show English / Arabic when an Arabic label exists.
 * Example: "Baby Care / العناية بالطفل"
 */
export function formatCategoryBilingual(value) {
  const english = canonicalizeCategoryLabel(value);
  const arabic = categoryArabicLabel(english);
  if (!arabic || arabic === english) return english;
  return `${english} / ${arabic}`;
}
