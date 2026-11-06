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
  };
  const priceMap = {};
  const regionPriceMaps = { riyadh: {}, dammam: {}, jeddah: {} };
  const retailRegionPriceMaps = { riyadh: {}, dammam: {}, jeddah: {} };
  const cashDiscountMap = {};
  const valueDiscountMap = {};
  const sheetItems = [];

  for (let rowIndex = header.rowIndex + 1; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex];
    const itemCode = String(row[col.code] || "").trim().toUpperCase();
    if (!itemCode || itemCode.indexOf("LP") === 0) continue;
    if (!/^[A-Z][A-Z0-9/.-]{3,20}$/.test(itemCode)) continue;
    const itemName = String(row[col.name] || itemCode).trim();
    const category = String(row[col.category] || "").trim();
    const riyadh = toNumber_(row[col.riyadh]);
    const dammam = toNumber_(row[col.dammam]);
    const jeddah = toNumber_(row[col.jeddah]);
    const retailRiyadh = toNumber_(row[col.retailRiyadh]);
    const retailDammam = toNumber_(row[col.retailDammam]);
    const retailJeddah = toNumber_(row[col.retailJeddah]);
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
