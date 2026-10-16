export const CATALOGUE_CAROUSEL_MS = 3500;
export const CATALOGUE_SHARE_PHOTO_LIMIT = 8;

export function nextCataloguePhotoIndex(index, count) {
  const total = Number(count) || 0;
  if (total <= 1) return 0;
  const current = Number.isFinite(Number(index)) ? Number(index) : 0;
  return ((current % total) + total + 1) % total;
}

export function catalogueShareFileName(code, index) {
  const safe = String(code || "item").trim().replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "item";
  const position = Number.isFinite(Number(index)) ? Number(index) : 0;
  return `${safe}-${position + 1}.jpg`;
}

export function buildCatalogueShareLines({
  name = "",
  code = "",
  packing = "",
  sellingUnit = "",
  priceText = "",
  originalPriceText = "",
  discountText = "",
  metaText = "",
  language = "en",
} = {}) {
  const ar = language === "ar";
  const lines = [
    { role: "name", text: String(name || "").trim() },
    { role: "code", text: String(code || "").trim() },
    {
      role: "packing",
      text: `${ar ? "التعبئة" : "Packing"}: ${String(packing || "").trim() || (ar ? "غير متوفر" : "Not available")}`,
    },
  ];
  if (String(sellingUnit || "").trim()) {
    lines.push({ role: "unit", text: `${ar ? "وحدة البيع" : "Selling unit"}: ${String(sellingUnit).trim()}` });
  }
  if (String(priceText || "").trim()) lines.push({ role: "price", text: String(priceText).trim() });
  if (String(originalPriceText || "").trim()) {
    lines.push({ role: "was", text: `${ar ? "قبل الخصم" : "Before discount"}: ${String(originalPriceText).trim()}` });
  }
  if (String(discountText || "").trim()) lines.push({ role: "discount", text: String(discountText).trim() });
  if (String(metaText || "").trim()) lines.push({ role: "meta", text: String(metaText).trim() });
  return lines.filter((line) => line.text);
}

export function catalogueShareFallbackText(lines = []) {
  return lines.map((line) => String(line?.text || "").trim()).filter(Boolean).join("\n");
}

export function wrapShareText(text, maxWidth, measure) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  const width = Number(maxWidth);
  if (!value || !Number.isFinite(width) || width <= 0 || typeof measure !== "function") return value ? [value] : [];
  if (measure(value) <= width) return [value];

  const lines = [];
  let current = "";
  const pushLongWord = (word) => {
    let chunk = "";
    for (const char of word) {
      const next = chunk + char;
      if (chunk && measure(next) > width) {
        lines.push(chunk);
        chunk = char;
      } else {
        chunk = next;
      }
    }
    return chunk;
  };

  for (const word of value.split(" ")) {
    const next = current ? `${current} ${word}` : word;
    if (measure(next) <= width) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = measure(word) <= width ? word : pushLongWord(word);
  }
  if (current) lines.push(current);
  return lines.length ? lines : [value];
}
