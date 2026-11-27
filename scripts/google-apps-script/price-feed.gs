var COSTING_SHEET_ID = "15DFVFiwKkv3rNdHZkxYzOpGdfFgpc7AkyQGUq6QIzJc";

function doGet() {
  const ss = getCostingSpreadsheet_();
  const sheet = ss.getSheetByName("Final Costing") || ss.getSheets()[0];
  const values = sheet.getDataRange().getDisplayValues();
  const header = findHeaderRow_(values);
  const col = {
    code: header.index("product code", "item code", "sku") ?? letterIndex_("B"),
    name: header.index("item name", "product name") ?? letterIndex_("C"),
    category: header.index("product category") ?? letterIndex_("CP"),
    riyadh: letterIndex_("CB"),
    dammam: letterIndex_("CF"),
    jeddah: letterIndex_("CJ"),
    retailRiyadh: letterIndex_("CD"),
    retailDammam: letterIndex_("CH"),
    retailJeddah: letterIndex_("CJ"),
    value2000: findSalesValueColumn_(values, 2000, "CL"),
    value5000: findSalesValueColumn_(values, 5000, "CM"),
    value10000: findSalesValueColumn_(values, 10000, "CN"),
    cashDiscount: findLabeledColumn_(values, ["cash discount", "cash disc"], "CO"),
    // Saudi Costing Sheet: CBM/Ctn is column F.
    cbmPerCtn: findLabeledColumn_(values, ["cbm ctn", "cbm per ctn"], "F"),
  };
  const priceMap = {};
  const regionPriceMaps = { riyadh: {}, dammam: {}, jeddah: {} };
  const retailRegionPriceMaps = { riyadh: {}, dammam: {}, jeddah: {} };
  const cashDiscountMap = {};
  const valueDiscountMap = {};
  const cbmPerCtnMap = {};
  const sheetItems = [];

  for (let rowIndex = header.rowIndex + 1; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex];
    const itemCode = String(row[col.code] || "").trim().toUpperCase();
    if (!itemCode) continue;
    if (!/^[A-Z][A-Z0-9/.-]{3,20}$/.test(itemCode)) continue;
    const itemName = String(row[col.name] || itemCode).trim();
    const category = String(row[col.category] || "").trim();
    // Keep non-building-material LP* codes (e.g. LP00656 trolley). BM still drops.
    if (isBuildingMaterialItem_(itemCode, itemName, category)) continue;
    const riyadh = toNumber_(row[col.riyadh]);
    const dammam = toNumber_(row[col.dammam]);
    const jeddah = toNumber_(row[col.jeddah]);
    const retailRiyadh = toNumber_(row[col.retailRiyadh]);
    const retailDammam = toNumber_(row[col.retailDammam]);
    const retailJeddah = toNumber_(row[col.retailJeddah]);
    const cbmPerCtn = toNumber_(row[col.cbmPerCtn]);
    const cashDiscount = String(row[col.cashDiscount] || "").trim();
    const valueSlabs = {};
    const value2000 = String(row[col.value2000] || "").trim();
    const value5000 = String(row[col.value5000] || "").trim();
    const value10000 = String(row[col.value10000] || "").trim();
    if (value2000 && value2000.indexOf("#") === -1) valueSlabs["2000"] = value2000;
    if (value5000 && value5000.indexOf("#") === -1) valueSlabs["5000"] = value5000;
    if (value10000 && value10000.indexOf("#") === -1) valueSlabs["10000"] = value10000;

    if (riyadh > 0) {
      priceMap[itemCode] = riyadh;
      regionPriceMaps.riyadh[itemCode] = riyadh;
    }
    if (dammam > 0) regionPriceMaps.dammam[itemCode] = dammam;
    if (jeddah > 0) regionPriceMaps.jeddah[itemCode] = jeddah;
    if (retailRiyadh > 0) retailRegionPriceMaps.riyadh[itemCode] = retailRiyadh;
    if (retailDammam > 0) retailRegionPriceMaps.dammam[itemCode] = retailDammam;
    if (retailJeddah > 0) retailRegionPriceMaps.jeddah[itemCode] = retailJeddah;
    if (cbmPerCtn > 0) cbmPerCtnMap[itemCode] = cbmPerCtn;
    if (cashDiscount && cashDiscount.indexOf("#") === -1) cashDiscountMap[itemCode] = cashDiscount;
    if (Object.keys(valueSlabs).length) valueDiscountMap[itemCode] = valueSlabs;
    sheetItems.push({ item_code: itemCode, item_name: itemName, category: category, source: "GOOGLE_SHEET" });
  }

  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    generatedAt: new Date().toISOString(),
    priceMap,
    regionPriceMaps,
    retailRegionPriceMaps,
    cashDiscountMap,
    valueDiscountMap,
    cbmPerCtnMap,
    sheetItems,
    itemCount: sheetItems.length,
  })).setMimeType(ContentService.MimeType.JSON);
}

function getCostingSpreadsheet_() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  const sheetId = String(COSTING_SHEET_ID || "").trim();
  if (!sheetId) throw new Error("Set COSTING_SHEET_ID to the ID from the costing spreadsheet URL.");
  return SpreadsheetApp.openById(sheetId);
}

function findHeaderRow_(values) {
  const limit = Math.min(8, values.length);
  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const cells = values[rowIndex].map(function (cell) {
      return normalizeHeader_(cell);
    });
    if (cells.some(function (cell) { return cell.indexOf("product code") >= 0 || cell.indexOf("item code") >= 0; })) {
      return {
        rowIndex,
        index: function () {
          for (let a = 0; a < arguments.length; a += 1) {
            const needle = String(arguments[a] || "");
            const found = cells.findIndex(function (cell) { return cell.indexOf(needle) >= 0 && cell.indexOf("prev") < 0; });
            if (found >= 0) return found;
          }
          return null;
        },
      };
    }
  }
  return { rowIndex: 0, index: function () { return null; } };
}

function findLabeledColumn_(values, needles, fallbackLetter) {
  const limit = Math.min(8, values.length);
  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const row = values[rowIndex] || [];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const cell = normalizeHeader_(row[columnIndex]);
      if (!cell || cell.indexOf("prev") >= 0) continue;
      for (let n = 0; n < needles.length; n += 1) {
        if (cell.indexOf(needles[n]) >= 0) return columnIndex;
      }
    }
  }
  return letterIndex_(fallbackLetter);
}

function findSalesValueColumn_(values, amount, fallbackLetter) {
  const target = String(amount);
  const limit = Math.min(8, values.length);
  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const row = values[rowIndex] || [];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const cell = normalizeHeader_(row[columnIndex]);
      if (cell.indexOf("sales value") < 0) continue;
      const match = cell.match(/(\d[\d ]*)/);
      if (match && match[1].replace(/ /g, "") === target) return columnIndex;
    }
  }
  return letterIndex_(fallbackLetter);
}

function normalizeHeader_(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9>]+/g, " ").trim();
}

function letterIndex_(letter) {
  const name = String(letter || "").toUpperCase();
  let index = 0;
  for (let i = 0; i < name.length; i += 1) index = (index * 26) + (name.charCodeAt(i) - 64);
  return index - 1;
}

function toNumber_(value) {
  const parsed = Number(String(value || "").replace(/,/g, "").replace(/[^\d.-]/g, ""));
  return parsed > 0 ? parsed : 0;
}

function compactCategory_(value) {
  return String(value || "").toLowerCase().replace(/[^a-z]/g, "");
}

function isExcludedCategory_(value) {
  const compact = compactCategory_(value);
  return compact === "buildingmaterial"
    || compact === "buildingmaterials"
    || compact === "buidingmaterial"
    || compact === "buidingmaterials";
}

function isMissingOrderCategory_(value) {
  return compactCategory_(value) === "missingcategory";
}

function isPaperStationeryName_(value) {
  return /photocopy|copy\s*paper|\bgsm\b|\breams?\b|(?:\ba4\b.{0,24}\bpaper\b)|(?:\bpaper\b.{0,24}\ba4\b)|\btissues?\b|\btoilet\s*papers?\b|\bkitchen\s*towels?\b|\bnapkins?\b|\bjumbo\s*(?:tissue|roll|papers?)\b|\bpaper\s*jumbo\b/i.test(String(value || ""));
}

function isBuildingMaterialName_(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (isPaperStationeryName_(text)) return false;
  const compact = text.toLowerCase().replace(/[^a-z]/g, "");
  if (compact.indexOf("buildingmaterial") >= 0 || compact.indexOf("buidingmaterial") >= 0) return true;
  if (/(?:^|[^a-z0-9])(?:mdf|hdf|osb|hmr|lvl|grade[\s-]*e2|plywood|chipboard|particle\s*boards?|gypsum|plasterboards?|ventilation|ladders?|melamine|blockboards?|sandwich\s*panels?|rebar|concrete|steel\s*mesh|steel\s*bars?|angle\s*irons?|cement\s*boards?|tie\s*rods?|welding\s*rods?|wing\s*nuts?|hessian|jute|curing|mesh)(?:[^a-z0-9]|$)/i.test(text)) return true;
  if (/\bcement\b/i.test(text)) return true;
  if (/(?:\b\d+\s*-?\s*inch\b|\bportable\b|\bindustrial\b).{0,24}\bfans?\b|\bfans?\b.{0,24}(?:\b\d+\s*-?\s*inch\b|\bportable\b|\bindustrial\b|\bventilation\b)/i.test(text)) return true;
  if (/\b1220\s*mm\b/i.test(text) && /\b2440\s*mm\b/i.test(text)) return true;
  return /\b\d+(?:\.\d+)?\s*(?:mm|cm|mtr|meter|metre|inch|in)?\s*[x×*]\s*\d+(?:\.\d+)?\s*(?:mm|cm|mtr|meter|metre|inch|in)(?:\s*[x×*]\s*\d+(?:\.\d+)?\s*(?:mm|cm|mtr|meter|metre|inch|in))?\b/i.test(text);
}

/** Match app/lib/pricePayload.js isBuildingMaterialItem — LP* alone is not BM. */
function isBuildingMaterialItem_(itemCode, itemName, category) {
  if (isPaperStationeryName_(itemName)) return false;
  return isExcludedCategory_(category)
    || isMissingOrderCategory_(category)
    || isBuildingMaterialName_(itemName);
}
