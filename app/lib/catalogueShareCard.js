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

const SHARE_ABBREVIATIONS = {
  CTN: "carton",
  CARTON: "carton",
  CARTONS: "cartons",
  PKT: "packet",
  PACK: "pack",
  PACKS: "packs",
  PC: "piece",
  PCS: "pieces",
  GM: "gram",
  GMS: "grams",
  GRM: "gram",
  KG: "kilogram",
  KGS: "kilograms",
  ML: "milliliter",
  MLS: "milliliters",
  LTR: "liter",
  LT: "liter",
  BTL: "bottle",
  BTLS: "bottles",
  BOX: "box",
  BAG: "bag",
  SET: "set",
  PR: "pair",
  PAIR: "pair",
  ROLL: "roll",
  JAR: "jar",
  TIN: "tin",
  CAN: "can",
  DOZ: "dozen",
  TUBE: "tube",
  TRAY: "tray",
};

const CATALOGUE_WORD_AR = {
  carton: "كرتون",
  cartons: "كراتين",
  pack: "عبوة",
  packs: "عبوات",
  packet: "عبوة",
  packets: "عبوات",
  piece: "قطعة",
  pieces: "قطع",
  gram: "جم",
  grams: "جم",
  kilogram: "كجم",
  kilograms: "كجم",
  milliliter: "مل",
  milliliters: "مل",
  liter: "لتر",
  liters: "لتر",
  bottle: "زجاجة",
  bottles: "زجاجات",
  box: "صندوق",
  boxes: "صناديق",
  bag: "كيس",
  bags: "أكياس",
  set: "طقم",
  pair: "زوج",
  roll: "رول",
  jar: "برطمان",
  tin: "علبة",
  can: "علبة",
  dozen: "دستة",
  tube: "أنبوب",
  tray: "صينية",
  of: "من",
  and: "و",
  with: "مع",
  for: "لـ",
  white: "أبيض",
  black: "أسود",
  blue: "أزرق",
  red: "أحمر",
  green: "أخضر",
  yellow: "أصفر",
  pink: "وردي",
  large: "كبير",
  small: "صغير",
  medium: "وسط",
};

export function expandCatalogueShareWords(text) {
  return String(text || "").replace(/[A-Za-z]+/g, (word) => SHARE_ABBREVIATIONS[word.toUpperCase()] || word);
}

export function catalogueShareLatinWords(text) {
  return (String(text || "").match(/[A-Za-z]{2,}/g) || []).filter((word) => !/\d/.test(word));
}

export function catalogueGlossaryArabic(text) {
  return expandCatalogueShareWords(text).replace(/[A-Za-z]+/g, (word) => CATALOGUE_WORD_AR[word.toLowerCase()] || word);
}

export function catalogueShareUnknownWords(texts) {
  const words = new Set();
  for (const text of texts || []) {
    for (const word of catalogueShareLatinWords(expandCatalogueShareWords(text))) {
      if (!CATALOGUE_WORD_AR[word.toLowerCase()]) words.add(word.toUpperCase());
    }
  }
  return [...words];
}

export function catalogueShareTextFromDictionary(text, dictionary = new Map()) {
  const source = String(text || "").trim();
  if (!source) return "";
  return expandCatalogueShareWords(source).replace(/\s+/g, " ").trim().replace(/[A-Za-z]+/g, (word) => (
    dictionary.get(word.toUpperCase()) || CATALOGUE_WORD_AR[word.toLowerCase()] || word
  )).replace(/\s+/g, " ").trim();
}

export async function translateCatalogueShareText(text, translate) {
  const source = String(text || "").trim();
  if (!source) return "";
  const expanded = expandCatalogueShareWords(source).replace(/\s+/g, " ").trim();
  let arabic = "";
  if (typeof translate === "function") {
    try {
      arabic = String(await translate(expanded) || "").trim();
    } catch {
      arabic = "";
    }
  }
  const pending = catalogueShareLatinWords(arabic || expanded);
  if (!arabic || pending.length) {
    const replacements = new Map();
    for (const word of pending) {
      const local = CATALOGUE_WORD_AR[word.toLowerCase()];
      if (local) {
        replacements.set(word.toUpperCase(), local);
        continue;
      }
      if (typeof translate !== "function") continue;
      try {
        const one = String(await translate(word) || "").trim();
        if (one && catalogueShareLatinWords(one).length === 0) replacements.set(word.toUpperCase(), one);
      } catch {
        // The next word can still be translated.
      }
    }
    arabic = (arabic || expanded).replace(/[A-Za-z]+/g, (word) => (
      replacements.get(word.toUpperCase()) || CATALOGUE_WORD_AR[word.toLowerCase()] || word
    ));
  }
  return arabic.replace(/\s+/g, " ").trim();
}

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
  nameArabic = "",
  packingArabic = "",
  unitArabic = "",
  includePrice = true,
} = {}) {
  const packingValue = String(packing || "").trim() || "Not available";
  const translatedPacking = String(packingArabic || "").trim()
    || (String(packing || "").trim() ? catalogueGlossaryArabic(packing) : "غير متوفر");
  const unit = String(sellingUnit || "").trim();
  const translatedUnit = unit ? (String(unitArabic || "").trim() || catalogueGlossaryArabic(unit)) : "";
  const translatedName = String(nameArabic || "").trim();
  const lines = [
    { role: "name", text: String(name || "").trim(), dir: "ltr" },
    ...(translatedName && /[\u0600-\u06FF]/.test(translatedName)
      ? [{ role: "name", text: translatedName, dir: "rtl" }]
      : []),
    { role: "code", text: String(code || "").trim(), dir: "ltr" },
    ...bilingual("packing", `Packing: ${packingValue}`, `التعبئة: ${translatedPacking}`),
  ];
  if (unit) lines.push(...bilingual("unit", `Selling unit: ${unit}`, `وحدة البيع: ${translatedUnit}`));
  if (includePrice) {
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
  }
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
