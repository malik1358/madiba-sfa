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

const REGION_LABELS = {
  riyadh: ["Riyadh", "الرياض"],
  dammam: ["Dammam", "الدمام"],
  jeddah: ["Jeddah", "جدة"],
};

function bilingual(role, english, arabic) {
  return [
    { role, text: String(english || "").trim(), dir: "ltr" },
    { role, text: String(arabic || "").trim(), dir: "rtl" },
  ].filter((line) => line.text);
}

export function buildCatalogueShareLines({
  name = "",
  code = "",
  packing = "",
  sellingUnit = "",
  priceAmount = "",
  originalAmount = "",
  cashDiscount = false,
  valueDiscount = false,
  schemeDiscount = false,
  pricingType = "wholesale",
  region = "riyadh",
} = {}) {
  const packingValue = String(packing || "").trim() || "Not available";
  const packingArabic = String(packing || "").trim() || "غير متوفر";
  const lines = [
    { role: "name", text: String(name || "").trim(), dir: "ltr" },
    { role: "code", text: String(code || "").trim(), dir: "ltr" },
    ...bilingual("packing", `Packing: ${packingValue}`, `التعبئة: ${packingArabic}`),
  ];
  const unit = String(sellingUnit || "").trim();
  if (unit) lines.push(...bilingual("unit", `Selling unit: ${unit}`, `وحدة البيع: ${unit}`));
  const price = String(priceAmount || "").trim();
  if (price) lines.push(...bilingual("price", `${price} SAR`, `${price} ر.س`));
  else lines.push(...bilingual("price", "Price unavailable", "السعر غير متوفر"));
  const previous = String(originalAmount || "").trim();
  if (previous) lines.push(...bilingual("was", `Before discount: ${previous} SAR`, `قبل الخصم: ${previous} ر.س`));
  const discountEnglish = [
    cashDiscount && "Cash discount",
    valueDiscount && "Volume discount",
    schemeDiscount && "Scheme",
  ].filter(Boolean).join(" + ");
  const discountArabic = [
    cashDiscount && "خصم نقدي",
    valueDiscount && "خصم الكمية",
    schemeDiscount && "عرض",
  ].filter(Boolean).join(" + ");
  if (discountEnglish) lines.push(...bilingual("discount", discountEnglish, discountArabic));
  const city = REGION_LABELS[String(region || "").trim().toLowerCase()] || REGION_LABELS.riyadh;
  const wholesale = pricingType === "retail" ? ["Retail", "التجزئة"] : ["Wholesale", "الجملة"];
  lines.push(...bilingual("meta", `${wholesale[0]} · ${city[0]} · Ex VAT`, `${wholesale[1]} · ${city[1]} · قبل الضريبة`));
  return lines.filter((line) => line.text);
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
