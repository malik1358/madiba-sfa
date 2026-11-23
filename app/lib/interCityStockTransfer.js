import { isEodStockSectionLabel, normalizeEodCity, roundEodQty } from "./eodStock.js";
import { lookupMasterUnitConv, toMasterStockQty } from "./masterUnitQty.js";
import { isBuildingMaterialItem } from "./pricePayload.js";
import { isCatalogueProductCode } from "./productCatalogue.js";
import { isReturnsAboveSalesReturn } from "./returnsAboveSales.js";
import { addKsaCalendarDays, getKsaDateString, getKsaWeekdayIndexForDateString } from "./workdayActivity.js";

export const INTER_CITY_TRANSFER_CITIES = ["riyadh", "dammam"];
export const INTER_CITY_TRANSFER_COVER_DAYS = 15;
/** Lookback for peak weekly sales (5 weeks). */
export const INTER_CITY_TRANSFER_SALES_DAYS = 35;
/** Keep at least this many days of source-city sales stock before transferring. */
export const INTER_CITY_TRANSFER_SOURCE_RESERVE_DAYS = 30;
/** @deprecated Use INTER_CITY_TRANSFER_SALES_DAYS. Kept so older imports do not break. */
export const INTER_CITY_TRANSFER_SALES_MONTHS = 1;
/** Minimum destination stock (cartons/units) when the destination has no sales in the sales window. */
export const INTER_CITY_TRANSFER_UNSOLD_MIN_QTY = 5;
export const INTER_CITY_TRANSFER_DIRECTIONS = {
  riyadhToDammam: { key: "riyadhToDammam", source: "riyadh", destination: "dammam" },
  dammamToRiyadh: { key: "dammamToRiyadh", source: "dammam", destination: "riyadh" },
  riyadhToStore: { key: "riyadhToStore", source: "riyadh", destination: "store" },
};

const CITY_LABELS = {
  riyadh: "Riyadh",
  dammam: "Dammam",
  store: "Store",
};

/** Warehouse Riyadh qty only (excludes Store/Dukan). */
export function interCityRiyadhWarehouseQty(row = {}) {
  return roundEodQty(row?.cities?.riyadh?.qty ?? row?.riyadh ?? 0);
}

/** Store / Dukan qty. */
export function interCityStoreQty(row = {}) {
  return roundEodQty(row?.cities?.store?.qty ?? row?.store ?? 0);
}

/** Riyadh region for city-vs-city compare = warehouse + store. */
export function interCityRiyadhRegionQty(row = {}) {
  return roundEodQty(interCityRiyadhWarehouseQty(row) + interCityStoreQty(row));
}

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

export function resolveInterCitySalesWindow({
  now = new Date(),
  days = INTER_CITY_TRANSFER_SALES_DAYS,
} = {}) {
  const toDate = getKsaDateString(now);
  const daySpan = Math.max(1, Math.floor(Number(days) || INTER_CITY_TRANSFER_SALES_DAYS));
  const fromDate = addKsaCalendarDays(toDate, -(daySpan - 1));
  return {
    fromDate,
    toDate,
    days: daySpan,
    months: 1,
    coverDays: INTER_CITY_TRANSFER_COVER_DAYS,
    sourceReserveDays: INTER_CITY_TRANSFER_SOURCE_RESERVE_DAYS,
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
 * Items with stock in one place and none in the other:
 * Riyadh ↔ Dammam, and Riyadh warehouse → Store (Dukan).
 * Building-material items (category, name pattern, or LP* codes) are omitted.
 * @returns {{ riyadhToDammam: object[], dammamToRiyadh: object[], riyadhToStore: object[] }}
 */
export function findInterCityStockImbalances(stockRows = [], { categoryByCode = null } = {}) {
  const riyadhToDammam = [];
  const dammamToRiyadh = [];
  const riyadhToStore = [];
  const categories = categoryByCode instanceof Map ? categoryByCode : null;

  (stockRows || []).forEach((row) => {
    const itemCode = normalizeInterCityItemCode(row?.itemCode || row?.item_code);
    if (!itemCode) return;
    const riyadhWarehouseQty = interCityRiyadhWarehouseQty(row);
    const storeQty = interCityStoreQty(row);
    const riyadhQty = interCityRiyadhRegionQty(row);
    const dammamQty = roundEodQty(row?.cities?.dammam?.qty ?? row?.dammam ?? 0);
    const itemName = String(row?.itemName || row?.item_name || itemCode).trim() || itemCode;
    const category = String(
      row?.category
      || categories?.get(itemCode)
      || "",
    ).trim();
    if (isInterCityExcludedItem({ itemCode, itemName, category })) return;
    const unit = String(row?.unit || "").trim();
    const base = {
      itemCode,
      itemName,
      unit,
      category,
      riyadhQty,
      dammamQty,
      storeQty,
      riyadhWarehouseQty,
    };

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
    if (stockQtyPositive(riyadhWarehouseQty) && !stockQtyPositive(storeQty)) {
      riyadhToStore.push({
        ...base,
        sourceCity: "riyadh",
        destinationCity: "store",
        sourceQty: riyadhWarehouseQty,
        destinationQty: storeQty,
        direction: INTER_CITY_TRANSFER_DIRECTIONS.riyadhToStore.key,
      });
    }
  });

  riyadhToDammam.sort((a, b) => a.itemCode.localeCompare(b.itemCode));
  dammamToRiyadh.sort((a, b) => a.itemCode.localeCompare(b.itemCode));
  riyadhToStore.sort((a, b) => a.itemCode.localeCompare(b.itemCode));
  return { riyadhToDammam, dammamToRiyadh, riyadhToStore };
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
  sourcePeakWeeklyQty = 0,
  coverDays = INTER_CITY_TRANSFER_COVER_DAYS,
  sourceReserveDays = INTER_CITY_TRANSFER_SOURCE_RESERVE_DAYS,
  unsoldMinQty = INTER_CITY_TRANSFER_UNSOLD_MIN_QTY,
} = {}) {
  const source = Math.max(0, roundEodQty(sourceQty));
  const destination = Math.max(0, roundEodQty(destinationQty));
  const peakWeekly = Math.max(0, roundEodQty(peakWeeklyQty));
  const sourcePeak = Math.max(0, roundEodQty(sourcePeakWeeklyQty));
  const days = Math.max(1, Number(coverDays) || INTER_CITY_TRANSFER_COVER_DAYS);
  const reserveDays = Math.max(0, Number(sourceReserveDays) || 0);
  const minUnsold = Math.max(0, roundEodQty(unsoldMinQty));
  const dailyDemand = roundEodQty(peakWeekly / 7);
  // Ceil to whole units when demand is fractional so cover is at least the requested days.
  // Never-sold at destination still gets a starter stock of unsoldMinQty (default 5 CTN).
  let targetCoverQty = dailyDemand > 0 ? Math.ceil(dailyDemand * days - 1e-9) : 0;
  if (peakWeekly <= 0 && minUnsold > 0) {
    targetCoverQty = Math.max(targetCoverQty, minUnsold);
  }
  const shortfall = Math.max(0, roundEodQty(targetCoverQty - destination));

  // Source keeps ≥30 days of its own peak-week pace before anything is sent out.
  const sourceMonthReserveQty = sourcePeak > 0 && reserveDays > 0
    ? Math.ceil((sourcePeak / 7) * reserveDays - 1e-9)
    : 0;
  const maxTransferable = Math.max(0, roundEodQty(source - sourceMonthReserveQty));
  const suggestedQty = roundEodQty(Math.min(shortfall, maxTransferable));
  const remainingAtSource = roundEodQty(source - suggestedQty);
  const afterAtDestination = roundEodQty(destination + suggestedQty);
  const sourceDailyDemand = roundEodQty(sourcePeak / 7);
  const daysCoverAfterAtDestination = dailyDemand > 0
    ? roundEodQty(afterAtDestination / dailyDemand)
    : (afterAtDestination > 0 ? null : 0);
  const daysCoverAfterAtSource = sourceDailyDemand > 0
    ? roundEodQty(remainingAtSource / sourceDailyDemand)
    : (remainingAtSource > 0 ? null : 0);
  // Keep legacy alias for destination cover.
  const daysCoverAfter = daysCoverAfterAtDestination;
  const blockedBySourceReserve = sourceMonthReserveQty > 0 && shortfall > 0 && maxTransferable <= 0;
  const cappedBySourceReserve = sourceMonthReserveQty > 0
    && shortfall > maxTransferable
    && maxTransferable > 0;

  return {
    peakWeeklyQty: peakWeekly,
    sourcePeakWeeklyQty: sourcePeak,
    sourceReserveDays: reserveDays,
    sourceMonthReserveQty,
    maxTransferable,
    dailyDemand,
    sourceDailyDemand,
    coverDays: days,
    unsoldMinQty: minUnsold,
    targetCoverQty,
    suggestedQty,
    remainingAtSource,
    afterAtDestination,
    daysCoverAfter,
    daysCoverAfterAtDestination,
    daysCoverAfterAtSource,
    cappedBySource: shortfall > source && shortfall > 0,
    cappedBySourceReserve,
    blockedBySourceReserve,
    usedUnsoldMinimum: peakWeekly <= 0 && minUnsold > 0 && suggestedQty > 0,
  };
}

export function decorateInterCityTransferRows(imbalanceRows = [], peakMap = new Map()) {
  return (imbalanceRows || []).map((row) => {
    // Store has no voucher city — use Riyadh sales pace as demand proxy for stocking the shop.
    const peakCity = row.destinationCity === "store" ? "riyadh" : row.destinationCity;
    const peakKey = `${row.itemCode}|${peakCity}`;
    const peak = peakMap.get(peakKey) || { peakWeeklyQty: 0, peakWeekKey: "", totalQty: 0 };
    const sourcePeak = peakMap.get(`${row.itemCode}|${row.sourceCity}`)
      || { peakWeeklyQty: 0, peakWeekKey: "", totalQty: 0 };
    const suggestion = suggestTransferQty({
      sourceQty: row.sourceQty,
      destinationQty: row.destinationQty,
      peakWeeklyQty: peak.peakWeeklyQty,
      sourcePeakWeeklyQty: sourcePeak.peakWeeklyQty,
      coverDays: INTER_CITY_TRANSFER_COVER_DAYS,
      sourceReserveDays: INTER_CITY_TRANSFER_SOURCE_RESERVE_DAYS,
    });
    const destinationSalesQty = roundEodQty(peak.totalQty || 0);
    return {
      ...row,
      peakWeeklyQty: suggestion.peakWeeklyQty,
      peakWeekKey: peak.peakWeekKey || "",
      destinationSalesQty,
      destinationSalesQty6m: destinationSalesQty,
      sourcePeakWeeklyQty: suggestion.sourcePeakWeeklyQty,
      sourceReserveDays: suggestion.sourceReserveDays,
      sourceMonthReserveQty: suggestion.sourceMonthReserveQty,
      maxTransferableQty: suggestion.maxTransferable,
      dailyDemand: suggestion.dailyDemand,
      sourceDailyDemand: suggestion.sourceDailyDemand,
      coverDays: suggestion.coverDays,
      targetCoverQty: suggestion.targetCoverQty,
      suggestedQty: suggestion.suggestedQty,
      remainingAtSource: suggestion.remainingAtSource,
      afterAtDestination: suggestion.afterAtDestination,
      daysCoverAfter: suggestion.daysCoverAfter,
      daysCoverAfterAtDestination: suggestion.daysCoverAfterAtDestination,
      daysCoverAfterAtSource: suggestion.daysCoverAfterAtSource,
      cappedBySource: suggestion.cappedBySource,
      cappedBySourceReserve: suggestion.cappedBySourceReserve,
      blockedBySourceReserve: suggestion.blockedBySourceReserve,
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
  let storeItems = 0;
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
    const riyadhQty = interCityRiyadhRegionQty(row);
    const dammamQty = roundEodQty(row?.cities?.dammam?.qty ?? row?.dammam ?? 0);
    const storeQty = interCityStoreQty(row);
    const hasR = stockQtyPositive(riyadhQty);
    const hasD = stockQtyPositive(dammamQty);
    const hasStore = stockQtyPositive(storeQty);
    if (hasR) riyadhItems += 1;
    if (hasD) dammamItems += 1;
    if (hasStore) storeItems += 1;
    if (hasR && hasD) bothItems += 1;
  });
  return { riyadhItems, dammamItems, storeItems, bothItems, skippedNonCatalogue };
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
  const windowSaleRows = (saleRows || []).filter((row) => {
    const date = String(row?.transaction_date || "").trim().slice(0, 10);
    return date && date >= window.fromDate && date <= window.toDate;
  });
  const coverage = summarizeInterCityStockCoverage(stockRows);
  const imbalances = findInterCityStockImbalances(stockRows, { categoryByCode });
  const peaks = buildPeakWeeklySalesByItemCity(windowSaleRows);
  const riyadhToDammam = decorateInterCityTransferRows(imbalances.riyadhToDammam, peaks);
  const dammamToRiyadh = decorateInterCityTransferRows(imbalances.dammamToRiyadh, peaks);
  const riyadhToStore = decorateInterCityTransferRows(imbalances.riyadhToStore, peaks);

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
      riyadhToStore: {
        ...INTER_CITY_TRANSFER_DIRECTIONS.riyadhToStore,
        label: "Riyadh → Store",
        rows: riyadhToStore,
        itemCount: riyadhToStore.length,
        suggestedTotalQty: sumSuggested(riyadhToStore),
      },
    },
    summary: {
      riyadhToDammamItems: riyadhToDammam.length,
      dammamToRiyadhItems: dammamToRiyadh.length,
      riyadhToStoreItems: riyadhToStore.length,
      riyadhToDammamSuggestedQty: sumSuggested(riyadhToDammam),
      dammamToRiyadhSuggestedQty: sumSuggested(dammamToRiyadh),
      riyadhToStoreSuggestedQty: sumSuggested(riyadhToStore),
      riyadhStockItems: coverage.riyadhItems,
      dammamStockItems: coverage.dammamItems,
      storeStockItems: coverage.storeItems,
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

/**
 * Unsold-min (5) is a display/carton floor. Re-apply after master-unit conversion so
 * "Min 5" never becomes 1 CTN when conv turns 5 pcs into 1 carton.
 * Negative destination qty stays visible but is treated as 0 for cover math.
 */
function finalizeInterCityDisplayRow(row = {}) {
  const source = Math.max(0, roundEodQty(row.sourceQty));
  const destinationDisplayed = roundEodQty(row.destinationQty);
  const destinationForCalc = Math.max(0, destinationDisplayed);
  const sourcePeak = Math.max(0, roundEodQty(row.sourcePeakWeeklyQty));
  const peakWeekly = Math.max(0, roundEodQty(row.peakWeeklyQty));
  const reserveDays = Math.max(0, Number(row.sourceReserveDays) || INTER_CITY_TRANSFER_SOURCE_RESERVE_DAYS);
  const sourceDaily = roundEodQty(sourcePeak / 7);
  const destDaily = roundEodQty(peakWeekly / 7);
  let sourceMonthReserveQty = sourceDaily > 0 && reserveDays > 0
    ? Math.ceil(sourceDaily * reserveDays - 1e-9)
    : 0;
  sourceMonthReserveQty = roundEodQty(sourceMonthReserveQty);
  const maxTransferable = Math.max(0, roundEodQty(source - sourceMonthReserveQty));

  let targetCoverQty = roundEodQty(row.targetCoverQty);
  const usedUnsoldMinimum = Boolean(row.usedUnsoldMinimum) || (peakWeekly <= 0 && INTER_CITY_TRANSFER_UNSOLD_MIN_QTY > 0);
  if (usedUnsoldMinimum) {
    targetCoverQty = Math.max(targetCoverQty, INTER_CITY_TRANSFER_UNSOLD_MIN_QTY);
  }

  const shortfall = Math.max(0, roundEodQty(targetCoverQty - destinationForCalc));
  const suggestedQty = roundEodQty(Math.min(shortfall, maxTransferable, source));
  const remainingAtSource = roundEodQty(source - suggestedQty);
  const afterAtDestination = roundEodQty(destinationForCalc + suggestedQty);
  const daysCoverAfterAtDestination = destDaily > 0
    ? roundEodQty(afterAtDestination / destDaily)
    : (afterAtDestination > 0 ? null : 0);
  const daysCoverAfterAtSource = sourceDaily > 0
    ? roundEodQty(remainingAtSource / sourceDaily)
    : (remainingAtSource > 0 ? null : 0);

  return {
    ...row,
    // Keep signed destination for display; math above used destinationForCalc.
    destinationQty: destinationDisplayed,
    sourceMonthReserveQty,
    maxTransferableQty: maxTransferable,
    targetCoverQty,
    suggestedQty,
    remainingAtSource,
    afterAtDestination,
    daysCoverAfter: daysCoverAfterAtDestination,
    daysCoverAfterAtDestination,
    daysCoverAfterAtSource,
    cappedBySource: shortfall > source && shortfall > 0 && maxTransferable >= source,
    cappedBySourceReserve: sourceMonthReserveQty > 0 && shortfall > maxTransferable && maxTransferable > 0,
    blockedBySourceReserve: sourceMonthReserveQty > 0 && shortfall > 0 && maxTransferable <= 0,
    usedUnsoldMinimum: usedUnsoldMinimum && suggestedQty > 0,
  };
}

function applyMasterUnitsToInterCityRows(rows = [], masterUnits = {}) {
  return (rows || []).map((row) => {
    const master = lookupMasterUnitConv(masterUnits, row.itemCode);
    let next = row;
    if (!master) {
      const unit = String(row.unit || "").trim();
      if (/^(ctn|carton|cartons|cx)$/i.test(unit)) {
        next = { ...row, unit: "CTN" };
      }
    } else {
      const unit = row.unit || "";
      const masterUnit = /^(ctn|carton|cartons|cx|box|boxes)$/i.test(master.masterUom)
        ? "CTN"
        : (master.masterUom || unit);
      next = {
        ...row,
        unit: masterUnit,
        sourceQty: convertInterCityQty(row.sourceQty, unit, master),
        destinationQty: convertInterCityQty(row.destinationQty, unit, master),
        riyadhQty: convertInterCityQty(row.riyadhQty, unit, master),
        dammamQty: convertInterCityQty(row.dammamQty, unit, master),
        storeQty: convertInterCityQty(row.storeQty, unit, master),
        riyadhWarehouseQty: convertInterCityQty(row.riyadhWarehouseQty, unit, master),
        peakWeeklyQty: convertInterCityQty(row.peakWeeklyQty, unit, master),
        sourcePeakWeeklyQty: convertInterCityQty(row.sourcePeakWeeklyQty, unit, master),
        sourceMonthReserveQty: convertInterCityQty(row.sourceMonthReserveQty, unit, master),
        maxTransferableQty: convertInterCityQty(row.maxTransferableQty, unit, master),
        destinationSalesQty: convertInterCityQty(row.destinationSalesQty, unit, master),
        destinationSalesQty6m: convertInterCityQty(row.destinationSalesQty6m, unit, master),
        dailyDemand: convertInterCityQty(row.dailyDemand, unit, master),
        targetCoverQty: convertInterCityQty(row.targetCoverQty, unit, master),
        suggestedQty: convertInterCityQty(row.suggestedQty, unit, master),
        remainingAtSource: convertInterCityQty(row.remainingAtSource, unit, master),
        afterAtDestination: convertInterCityQty(row.afterAtDestination, unit, master),
      };
    }
    return finalizeInterCityDisplayRow(next);
  });
}

/** Convert stock/sales qty columns to master units (cartons when Master UOM is CTN). */
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
  const riyadhToStore = applyMasterUnitsToInterCityRows(
    report.directions?.riyadhToStore?.rows || [],
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
      riyadhToStore: {
        ...report.directions?.riyadhToStore,
        rows: riyadhToStore,
        itemCount: riyadhToStore.length,
        suggestedTotalQty: sumSuggested(riyadhToStore),
      },
    },
    summary: {
      ...report.summary,
      riyadhToDammamSuggestedQty: sumSuggested(riyadhToDammam),
      dammamToRiyadhSuggestedQty: sumSuggested(dammamToRiyadh),
      riyadhToStoreSuggestedQty: sumSuggested(riyadhToStore),
      riyadhToStoreItems: riyadhToStore.length,
    },
  };
}

function roundCbm(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
}

function lookupCbmPerCtn(cbmPerCtnMap, itemCode) {
  if (!cbmPerCtnMap || typeof cbmPerCtnMap !== "object") return null;
  const code = normalizeInterCityItemCode(itemCode);
  if (!code) return null;
  const direct = cbmPerCtnMap[code] ?? cbmPerCtnMap[String(itemCode || "").trim()];
  const value = Number(direct);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Add CBM per carton (from the costing sheet "CBM/Ctn" column) and total CBM
 * (suggested cartons × CBM/Ctn) to each row. Call after master-unit conversion so
 * suggestedQty is in cartons.
 */
export function applyCbmToInterCityReport(report, cbmPerCtnMap = {}) {
  if (!report || typeof report !== "object") return report;
  const decorate = (rows) => (rows || []).map((row) => {
    const cbmPerCtn = lookupCbmPerCtn(cbmPerCtnMap, row.itemCode);
    return {
      ...row,
      cbmPerCtn,
      totalCbm: cbmPerCtn == null ? null : roundCbm(Number(row.suggestedQty || 0) * cbmPerCtn),
    };
  });
  const sumCbm = (rows) => roundCbm(
    rows.reduce((total, row) => total + Number(row.totalCbm || 0), 0),
  );
  const riyadhToDammam = decorate(report.directions?.riyadhToDammam?.rows);
  const dammamToRiyadh = decorate(report.directions?.dammamToRiyadh?.rows);
  const riyadhToStore = decorate(report.directions?.riyadhToStore?.rows);
  return {
    ...report,
    directions: {
      ...report.directions,
      riyadhToDammam: {
        ...report.directions?.riyadhToDammam,
        rows: riyadhToDammam,
        totalCbm: sumCbm(riyadhToDammam),
      },
      dammamToRiyadh: {
        ...report.directions?.dammamToRiyadh,
        rows: dammamToRiyadh,
        totalCbm: sumCbm(dammamToRiyadh),
      },
      riyadhToStore: {
        ...report.directions?.riyadhToStore,
        rows: riyadhToStore,
        totalCbm: sumCbm(riyadhToStore),
      },
    },
    summary: {
      ...report.summary,
      riyadhToDammamTotalCbm: sumCbm(riyadhToDammam),
      dammamToRiyadhTotalCbm: sumCbm(dammamToRiyadh),
      riyadhToStoreTotalCbm: sumCbm(riyadhToStore),
    },
  };
}
