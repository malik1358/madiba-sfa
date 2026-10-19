export function normalizeImportedItemName(value) {
  const lines = String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let name = lines[0] || "";
  if (!name) return null;

  name = name
    .replace(/\b(?:(?:[A-Za-z]\s*)?(?:repeat(?:ed)?|repet(?:e|i)?d)|(?:[A-Za-z]\s*)new)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return name || null;
}
