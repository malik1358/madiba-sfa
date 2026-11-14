import { isEodStockSectionLabel, normalizeEodCity, roundEodQty } from "./eodStock.js";
import { lookupMasterUnitConv, toMasterStockQty } from "./masterUnitQty.js";
import { isBuildingMaterialItem } from "./pricePayload.js";
import { isCatalogueProductCode } from "./productCatalogue.js";
import { isReturnsAboveSalesReturn } from "./returnsAboveSales.js";
import { addKsaCalendarDays, getKsaDateString, getKsaWeekdayIndexForDateString } from "./workdayActivity.js";

export const INTER_CITY_TRANSFER_CITIES = ["riyadh", "dammam"];
export const INTER_CITY_TRANSFER_COVER_DAYS = 15;
export const INTER_CITY_TRANSFER_SALES_MONTHS = 6;
/** Minimum destination stock (cartons/units) when the destination has no sales in the 6-month window. */
export const INTER_CITY_TRANSFER_UNSOLD_MIN_QTY = 5;
export const INTER_CITY_TRANSFER_DIRECTIONS = {
  riyadhToDammam: { key: "riyadhToDammam", source: "riyadh", destination: "dammam" },
  dammamToRiyadh: { key: "dammamToRiyadh", source: "dammam", destination: "riyadh" },
};

const CITY_LABELS = {
  riyadh: "Riyadh",
  dammam: "Dammam",
};

export function interCityTransferCityLabel(city) {
  return CITY_LABELS[city] || String(city || "").trim();
}

export function normalizeInterCityItemCode(value) {
  return String(value || "").trim().toUpperCase();
}

/**
 * Drop Tally section titles (e.g. NON FOOD DIVISION, RIYADH W/H 1), non-catalogue
 * codes, and building-material items (same rules as catalogue / Missing Catalogue Photos).
 */
export function isInterCityExcludedItem({
  itemCode = "",
  itemName = "",
  category = "",
} = {}) {
  if (!isCatalogueProductCode(itemCode)) return true;
  if (isEodStockSectionLabel(itemCode) || isEodStockSectionLabel(itemName)) return true;
  return isBuildingMaterialItem({
    item_code: itemCode,
    item_name: itemName,
    category,
  });
}

export function categoryByItemCodeFromSales(saleRows = []) {
  const byCode = new Map();
  (saleRows || []).forEach((row) => {
    const code = normalizeInterCityItemCode(row?.item_code || row?.itemCode);
    const category = String(row?.category || "").trim();
    if (!code || !category || byCode.has(code)) return;
    byCode.set(code, category);
  });
  return byCode;
}

export function resolveInterCitySalesWindow({ now = new Date(), months = INTER_CITY_TRANSFER_SALES_MONTHS } = {}) {
  const toDate = getKsaDateString(now);
  const monthCount = Math.max(1, Math.floor(Number(months) || INTER_CITY_TRANSFER_SALES_MONTHS));
  // Approximate 6 months as ~183 calendar days so the window stays inclusive and stable.
  const daySpan = Math.max(28, Math.round(monthCount * 30.5));
  const fromDate = addKsaCalendarDays(toDate, -(daySpan - 1));
  return {
    fromDate,
    toDate,
    months: monthCount,
    coverDays: INTER_CITY_TRANSFER_COVER_DAYS,
  };
}

/** Monday-start week key (YYYY-MM-DD of that Monday) for a KSA calendar date. */
export function interCityWeekKey(dateString) {
  const text = String(dateString || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  const weekday = getKsaWeekdayIndexForDateString(text); // 0 Sun … 6 Sat
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  return addKsaCalendarDays(text, mondayOffset);
}

export function salesCityFromVoucherType(voucherType = "") {
  return normalizeEodCity(voucherType);
}

export function isInterCitySaleLine(row = {}) {
  if (isReturnsAboveSalesReturn(row)) return false;
  const qty = Number(row?.quantity);
  if (!Number.isFinite(qty) || qty <= 0) return false;
  const amount = Number(row?.sales_amount);
  if (Number.isFinite(amount) && amount < 0) return false;
  return true;
}

export function stockQtyPositive(value) {
  return roundEodQty(value) > 0;
}

/**
 * Items with stock in one city and none in the other (Riyadh ↔ Dammam).
 * Building-material items (category, name pattern, or LP* codes) are omitted.
 * @returns {{ riyadhToDammam: object[], dammamToRiyadh: object[] }}
 */
export function findInterCityStockImbalances(stockRows = [], { categoryByCode = null } = {}) {
  const riyadhToDammam = [];
  const dammamToRiyadh = [];
  const categories = categoryByCode instanceof Map ? categoryByCode : null;

  (stockRows || []).forEach((row) => {
    const itemCode = normalizeInterCityItemCode(row?.itemCode || row?.item_code);
    if (!itemCode) return;
    const riyadhQty = roundEodQty(row?.cities?.riyadh?.qty ?? row?.riyadh ?? 0);
    const dammamQty = roundEodQty(row?.cities?.dammam?.qty ?? row?.dammam ?? 0);
    const itemName = String(row?.itemName || row?.item_name || itemCode).trim() || itemCode;
    const category = String(
      row?.category
      || categories?.get(itemCode)
      || "",
    ).trim();
    if (isInterCityExcludedItem({ itemCode, itemName, category })) return;
    const unit = String(row?.unit || "").trim();
    const base = { itemCode, itemName, unit, category, riyadhQty, dammamQty };

    if (stockQtyPositive(riyadhQty) && !stockQtyPositive(dammamQty)) {
      riyadhToDammam.push({
        ...base,
        sourceCity: "riyadh",
        destinationCity: "dammam",
        sourceQty: riyadhQty,
        destinationQty: dammamQty,
        direction: INTER_CITY_TRANSFER_DIRECTIONS.riyadhToDammam.key,
      });
    }
    if (stockQtyPositive(dammamQty) && !stockQtyPositive(riyadhQty)) {
      dammamToRiyadh.push({
        ...base,
        sourceCity: "dammam",
        destinationCity: "riyadh",
        sourceQty: dammamQty,
        destinationQty: riyadhQty,
        direction: INTER_CITY_TRANSFER_DIRECTIONS.dammamToRiyadh.key,
      });
    }
  });

  riyadhToDammam.sort((a, b) => a.itemCode.localeCompare(b.itemCode));
  dammamToRiyadh.sort((a, b) => a.itemCode.localeCompare(b.itemCode));
  return { riyadhToDammam, dammamToRiyadh };
}

/**
 * Peak weekly positive qty by item + city from sale lines.
 * @returns {Map<string, { peakWeeklyQty: number, peakWeekKey: string, totalQty: number }>}
 * key = `${itemCode}|${city}`
 */
export function buildPeakWeeklySalesByItemCity(saleRows = []) {
  const weekly = new Map();

  (saleRows || []).forEach((row) => {
    if (!isInterCitySaleLine(row)) return;
    const itemCode = normalizeInterCityItemCode(row?.item_code || row?.itemCode);
    const city = salesCityFromVoucherType(row?.voucher_type || row?.voucherType);
    if (!itemCode || !INTER_CITY_TRANSFER_CITIES.includes(city)) return;
    const date = String(row?.transaction_date || "").trim().slice(0, 10);
    const weekKey = interCityWeekKey(date);
    if (!weekKey) return;
    const qty = roundEodQty(row?.quantity);
    const mapKey = `${itemCode}|${city}|${weekKey}`;
    weekly.set(mapKey, roundEodQty((weekly.get(mapKey) || 0) + qty));
  });

  const peaks = new Map();
  weekly.forEach((qty, mapKey) => {
    const [itemCode, city, weekKey] = mapKey.split("|");
    const peakKey = `${itemCode}|${city}`;
    const current = peaks.get(peakKey) || { peakWeeklyQty: 0, peakWeekKey: "", totalQty: 0 };
    current.totalQty = roundEodQty(current.totalQty + qty);
    if (qty > current.peakWeeklyQty) {
      current.peakWeeklyQty = roundEodQty(qty);
      current.peakWeekKey = weekKey;
    }
    peaks.set(peakKey, current);
  });

  return peaks;
}

export function suggestTransferQty({
  sourceQty = 0,
  destinationQty = 0,
  peakWeeklyQty = 0,
  coverDays = INTER_CITY_TRANSFER_COVER_DAYS,
  unsoldMinQty = INTER_CITY_TRANSFER_UNSOLD_MIN_QTY,
} = {}) {
  const source = Math.max(0, roundEodQty(sourceQty));
  const destination = Math.max(0, roundEodQty(destinationQty));
  const peakWeekly = Math.max(0, roundEodQty(peakWeeklyQty));
  const days = Math.max(1, Number(coverDays) || INTER_CITY_TRANSFER_COVER_DAYS);
  const minUnsold = Math.max(0, roundEodQty(unsoldMinQty));
  const dailyDemand = roundEodQty(peakWeekly / 7);
  // Ceil to whole units when demand is fractional so cover is at least the requested days.
  // Never-sold at destination still gets a starter stock of unsoldMinQty (default 5 CTN).
  let targetCoverQty = dailyDemand > 0 ? Math.ceil(dailyDemand * days - 1e-9) : 0;
  if (peakWeekly <= 0 && minUnsold > 0) {
    targetCoverQty = Math.max(targetCoverQty, minUnsold);
  }
  const shortfall = Math.max(0, roundEodQty(targetCoverQty - destination));
  const suggestedQty = roundEodQty(Math.min(source, shortfall));
  const remainingAtSource = roundEodQty(source - suggestedQty);
  const afterAtDestination = roundEodQty(destination + suggestedQty);
  const daysCoverAfter = dailyDemand > 0
    ? roundEodQty(afterAtDestination / dailyDemand)
    : (afterAtDestination > 0 ? null : 0);

  return {
    peakWeeklyQty: peakWeekly,
    dailyDemand,
    coverDays: days,
    unsoldMinQty: minUnsold,
    targetCoverQty,
    suggestedQty,
    remainingAtSource,
    afterAtDestination,
    daysCoverAfter,
    cappedBySource: shortfall > source && shortfall > 0,
    usedUnsoldMinimum: peakWeekly <= 0 && minUnsold > 0 && suggestedQty > 0,
  };
}

export function decorateInterCityTransferRows(imbalanceRows = [], peakMap = new Map()) {
  return (imbalanceRows || []).map((row) => {
    const peakKey = `${row.itemCode}|${row.destinationCity}`;
    const peak = peakMap.get(peakKey) || { peakWeeklyQty: 0, peakWeekKey: "", totalQty: 0 };
    const suggestion = suggestTransferQty({
      sourceQty: row.sourceQty,
      destinationQty: row.destinationQty,
      peakWeeklyQty: peak.peakWeeklyQty,
      coverDays: INTER_CITY_TRANSFER_COVER_DAYS,
    });
    return {
      ...row,
      peakWeeklyQty: suggestion.peakWeeklyQty,
      peakWeekKey: peak.peakWeekKey || "",
      destinationSalesQty6m: roundEodQty(peak.totalQty || 0),
      dailyDemand: suggestion.dailyDemand,
      coverDays: suggestion.coverDays,
      targetCoverQty: suggestion.targetCoverQty,
      suggestedQty: suggestion.suggestedQty,
      remainingAtSource: suggestion.remainingAtSource,
      afterAtDestination: suggestion.afterAtDestination,
      daysCoverAfter: suggestion.daysCoverAfter,
      cappedBySource: suggestion.cappedBySource,
      usedUnsoldMinimum: suggestion.usedUnsoldMinimum,
      sourceLabel: interCityTransferCityLabel(row.sourceCity),
      destinationLabel: interCityTransferCityLabel(row.destinationCity),
    };
  }).sort((a, b) => {
    const qtyDiff = Number(b.suggestedQty || 0) - Number(a.suggestedQty || 0);
    if (qtyDiff) return qtyDiff;
    return String(a.itemCode).localeCompare(String(b.itemCode));
  });
}

export function summarizeInterCityStockCoverage(stockRows = []) {
  let riyadhItems = 0;
  let dammamItems = 0;
  let bothItems = 0;
  let skippedNonCatalogue = 0;
  (stockRows || []).forEach((row) => {
    const itemCode = normalizeInterCityItemCode(row?.itemCode || row?.item_code);
    const itemName = String(row?.itemName || row?.item_name || itemCode).trim() || itemCode;
    if (!itemCode) return;
    if (isInterCityExcludedItem({ itemCode, itemName, category: row?.category || "" })) {
      skippedNonCatalogue += 1;
      return;
    }
    const riyadhQty = roundEodQty(row?.cities?.riyadh?.qty ?? row?.riyadh ?? 0);
    const dammamQty = roundEodQty(row?.cities?.dammam?.qty ?? row?.dammam ?? 0);
    const hasR = stockQtyPositive(riyadhQty);
    const hasD = stockQtyPositive(dammamQty);
    if (hasR) riyadhItems += 1;
    if (hasD) dammamItems += 1;
    if (hasR && hasD) bothItems += 1;
  });
  return { riyadhItems, dammamItems, bothItems, skippedNonCatalogue };
}

export function buildInterCityStockTransferReport({
  stockRows = [],
  saleRows = [],
  now = new Date(),
  stockDate = "",
  citiesPresent = [],
  fileName = "",
} = {}) {
  const window = resolveInterCitySalesWindow({ now });
  const categoryByCode = categoryByItemCodeFromSales(saleRows);
  const coverage = summarizeInterCityStockCoverage(stockRows);
  const imbalances = findInterCityStockImbalances(stockRows, { categoryByCode });
  const peaks = buildPeakWeeklySalesByItemCity(saleRows);
  const riyadhToDammam = decorateInterCityTransferRows(imbalances.riyadhToDammam, peaks);
  const dammamToRiyadh = decorateInterCityTransferRows(imbalances.dammamToRiyadh, peaks);

  const sumSuggested = (rows) => roundEodQty(
    rows.reduce((total, row) => total + Number(row.suggestedQty || 0), 0),
  );

  return {
    stockDate: String(stockDate || "").trim(),
    fileName: String(fileName || "").trim(),
    citiesPresent: Array.isArray(citiesPresent) ? citiesPresent.map((city) => String(city || "").trim()).filter(Boolean) : [],
    window,
    coverDays: INTER_CITY_TRANSFER_COVER_DAYS,
    coverage,
    directions: {
      riyadhToDammam: {
        ...INTER_CITY_TRANSFER_DIRECTIONS.riyadhToDammam,
        label: "Riyadh → Dammam",
        rows: riyadhToDammam,
        itemCount: riyadhToDammam.length,
        suggestedTotalQty: sumSuggested(riyadhToDammam),
      },
      dammamToRiyadh: {
        ...INTER_CITY_TRANSFER_DIRECTIONS.dammamToRiyadh,
        label: "Dammam → Riyadh",
        rows: dammamToRiyadh,
        itemCount: dammamToRiyadh.length,
        suggestedTotalQty: sumSuggested(dammamToRiyadh),
      },
    },
    summary: {
      riyadhToDammamItems: riyadhToDammam.length,
      dammamToRiyadhItems: dammamToRiyadh.length,
      riyadhToDammamSuggestedQty: sumSuggested(riyadhToDammam),
      dammamToRiyadhSuggestedQty: sumSuggested(dammamToRiyadh),
      riyadhStockItems: coverage.riyadhItems,
      dammamStockItems: coverage.dammamItems,
      bothCityStockItems: coverage.bothItems,
    },
  };
}

function convertInterCityQty(raw, stockUnit, master) {
  if (!master) return roundEodQty(raw);
  return toMasterStockQty(raw, {
    stockUnit,
    masterUom: master.masterUom,
    baseUom: master.baseUom,
    conv: master.conv,
  }).qty;
}

function applyMasterUnitsToInterCityRows(rows = [], masterUnits = {}) {
  return (rows || []).map((row) => {
    const master = lookupMasterUnitConv(masterUnits, row.itemCode);
    if (!master) return row;
    const unit = row.unit || "";
    return {
      ...row,
      unit: master.masterUom || unit,
      sourceQty: convertInterCityQty(row.sourceQty, unit, master),
      destinationQty: convertInterCityQty(row.destinationQty, unit, master),
      riyadhQty: convertInterCityQty(row.riyadhQty, unit, master),
      dammamQty: convertInterCityQty(row.dammamQty, unit, master),
      peakWeeklyQty: convertInterCityQty(row.peakWeeklyQty, unit, master),
      destinationSalesQty6m: convertInterCityQty(row.destinationSalesQty6m, unit, master),
      dailyDemand: convertInterCityQty(row.dailyDemand, unit, master),
      targetCoverQty: convertInterCityQty(row.targetCoverQty, unit, master),
      suggestedQty: convertInterCityQty(row.suggestedQty, unit, master),
      remainingAtSource: convertInterCityQty(row.remainingAtSource, unit, master),
      afterAtDestination: convertInterCityQty(row.afterAtDestination, unit, master),
    };
  });
}

/** Convert stock/sales qty columns to master units for display (math already done in raw units). */
export function applyMasterUnitsToInterCityReport(report, masterUnits = {}) {
  if (!report || typeof report !== "object") return report;
  const map = masterUnits && typeof masterUnits === "object" ? masterUnits : {};
  const riyadhToDammam = applyMasterUnitsToInterCityRows(
    report.directions?.riyadhToDammam?.rows || [],
    map,
  );
  const dammamToRiyadh = applyMasterUnitsToInterCityRows(
    report.directions?.dammamToRiyadh?.rows || [],
    map,
  );
  const sumSuggested = (rows) => roundEodQty(
    rows.reduce((total, row) => total + Number(row.suggestedQty || 0), 0),
  );
  return {
    ...report,
    directions: {
      ...report.directions,
      riyadhToDammam: {
        ...report.directions?.riyadhToDammam,
        rows: riyadhToDammam,
        suggestedTotalQty: sumSuggested(riyadhToDammam),
      },
      dammamToRiyadh: {
        ...report.directions?.dammamToRiyadh,
        rows: dammamToRiyadh,
        suggestedTotalQty: sumSuggested(dammamToRiyadh),
      },
    },
    summary: {
      ...report.summary,
      riyadhToDammamSuggestedQty: sumSuggested(riyadhToDammam),
      dammamToRiyadhSuggestedQty: sumSuggested(dammamToRiyadh),
    },
  };
}
