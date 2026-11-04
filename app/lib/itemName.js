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

/**
 * Split Tally-style "CODE_NAME" (and CODE-NAME / CODE NAME) labels.
 * Codes may include slash variants such as A005215/1.
 */
export function parseCodePrefixedItemLabel(value) {
  const text = String(value || "").replace(/^`/, "").trim();
  if (!text) {
    return { itemCode: "", itemName: "", split: false };
  }

  const match = text.match(/^([A-Za-z0-9][A-Za-z0-9./]*)[_\-\s]+(.+)$/);
  if (match) {
    return {
      itemCode: match[1].trim().toUpperCase(),
      itemName: match[2].trim(),
      split: true,
    };
  }

  return {
    itemCode: text.toUpperCase(),
    itemName: text,
    split: false,
  };
}
