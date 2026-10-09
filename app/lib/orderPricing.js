import { lookupPositiveRate } from "./itemCodeAliases.js";
import { parsePricePayload } from "./pricePayload.js";
import {
  evaluateOrderSchemes,
  lookupSchemeApplication,
  ORDER_SCHEMES_CACHE_KEY,
  resolveStoredOrderSchemes,
} from "./orderSchemes.js";
import {
  getPricedOrderLine,
  lookupDiscountRate,
  normalizePaymentType,
  normalizePricingType,
  orderPriceMapFor,
  resolveOrderPricingRegion,
} from "./regionalPricing.js";

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function toNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function priceOrderLines(lines, {
  regionPriceMap = {},
  cashDiscountMap = {},
  valueDiscountMap = {},
  paymentType = "credit",
  schemes = [],
  pricingType = "wholesale",
} = {}) {
  const schemeApplications = evaluateOrderSchemes(lines, schemes);
  return (Array.isArray(lines) ? lines : []).map((line) => {
    const code = normalizeCode(line?.item_code);
    const quantity = toNumber(line?.quantity ?? line?.order_quantity);
    const publishedRate = lookupPositiveRate(regionPriceMap, code, 0);
    if (pricingType === "retail" && !(publishedRate > 0)) {
      throw Object.assign(new Error(`Retail price unavailable for ${code}. Choose wholesale pricing or remove this item.`), { status: 400 });
    }
    const scheme = lookupSchemeApplication(schemeApplications, code);
    const priced = getPricedOrderLine({
      wholesaleRate: lookupPositiveRate(regionPriceMap, code, line?.rate ?? line?.wholesaleRate),
      quantity,
      paymentType,
      cashDiscountRate: lookupDiscountRate(cashDiscountMap, code),
      valueDiscountRate: lookupDiscountRate(valueDiscountMap, code),
      schemeUnitDiscount: scheme.unitDiscount,
      schemeDiscountedQty: scheme.discountedQty,
      excludeCashDiscount: scheme.excludeCashDiscount === true,
      item_code: code,
      item_name: line?.item_name,
      category: line?.category,
      vatExempt: line?.vatExempt,
      vatRate: line?.vatRate,
    });

    return {
      ...line,
      item_code: code || String(line?.item_code || "").trim(),
      quantity,
      rate: priced.rate,
      line_value: priced.lineValue,
      vatRate: priced.vatRate,
      vatAmount: priced.vatAmount,
      lineTotalInclVat: priced.lineTotalInclVat,
    };
  });
}

export async function loadCachedPricingCatalog(admin) {
  const [{ data: defaultRow, error: defaultError }, { data: rulesRow }, { data: schemesRow }] = await Promise.all([
    admin
      .from("price_catalog_cache")
      .select("price_map,sheet_items")
      .eq("cache_key", "default")
      .maybeSingle(),
    admin
      .from("price_catalog_cache")
      .select("price_map")
      .eq("cache_key", "pricing_rules")
      .maybeSingle(),
    admin
      .from("price_catalog_cache")
      .select("price_map")
      .eq("cache_key", ORDER_SCHEMES_CACHE_KEY)
      .maybeSingle(),
  ]);

  if (defaultError) throw defaultError;

  const rules = rulesRow?.price_map && typeof rulesRow.price_map === "object" ? rulesRow.price_map : {};
  const parsed = parsePricePayload({
    priceMap: defaultRow?.price_map || {},
    regionPriceMaps: rules.regionPriceMaps || {},
    retailRegionPriceMaps: rules.retailRegionPriceMaps || {},
    cashDiscountMap: rules.cashDiscountMap || {},
    valueDiscountMap: rules.valueDiscountMap || {},
    sheetItems: Array.isArray(defaultRow?.sheet_items) ? defaultRow.sheet_items : [],
  });

  return {
    ...parsed,
    schemes: resolveStoredOrderSchemes(schemesRow?.price_map),
  };
}

export function resolveCatalogForOrder(catalog, {
  selectedRegion,
  currentUserRegion,
  currentUserRegions,
  customerSalesmanCode,
  pricingRegionBySalesmanCode,
  paymentType,
  pricingType,
} = {}) {
  const region = resolveOrderPricingRegion({
    selectedRegion,
    currentUserRegion,
    currentUserRegions,
    customerSalesmanCode,
    pricingRegionBySalesmanCode,
  });

  return {
    region,
    paymentType: normalizePaymentType(paymentType),
    pricingType: normalizePricingType(pricingType),
    regionPriceMap: orderPriceMapFor(catalog, region, pricingType),
    cashDiscountMap: catalog?.cashDiscountMap || {},
    valueDiscountMap: catalog?.valueDiscountMap || {},
    schemes: catalog?.schemes || [],
  };
}
