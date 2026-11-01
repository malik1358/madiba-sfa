export const UNCLASSIFIED_CATEGORY = "Unclassified";

/** Display merges for imported / catalogue category labels (case-insensitive). */
const CATEGORY_DISPLAY_ALIASES = Object.freeze({
  "body care": "Personal Care",
});

export function normalizeCategoryName(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!text) return UNCLASSIFIED_CATEGORY;
  const alias = CATEGORY_DISPLAY_ALIASES[text.toLowerCase()];
  return alias || text;
}
