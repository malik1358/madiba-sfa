import { isBuildingMaterialItem } from "./pricePayload.js";
import { customerAccountCodesMatch, customerCodeCandidates, resolveCustomerAccountCode } from "./outstanding.js";
import { isBuildingMaterialCustomer } from "../management/my-day/customerEligibility.js";

const EXCLUDED_NEW_ORDER_CUSTOMER_CODES = ["1020C", "1020"];

const FMCG_CATEGORIES = new Set([
  "fragrance",
  "fragrances",
  "perfume",
  "perfumes",
  "stationery",
  "sundry",
  "sundries",
  "bodycare",
  "personalcare",
  "cosmetics",
  "cosmetic",
  "electronics",
  "electronic",
  "food",
  "foods",
  "beverage",
  "beverages",
  "pos",
]);

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function customerMixKeys(value) {
  return [...new Set([
    normalizeCode(value),
    resolveCustomerAccountCode(value),
    ...customerCodeCandidates(value).map((code) => normalizeCode(code)),
  ].filter(Boolean))];
}

const UNKNOWN_CATEGORIES = new Set([
  "",
  "UNCLASSIFIED",
  "TO_MAP",
  "TBD",
  "TODO",
  "N/A",
  "NA",
  "-",
  "MISSING CATEGORY",
]);

export function emptySalesMix() {
  return { hasBuildingMaterial: false, hasOther: false };
}

export function isBuildingMaterialSale(row = {}, item = {}) {
  return isBuildingMaterialItem({
    item_code: row.item_code || item.item_code,
    item_name: row.item_name || item.item_name,
    category: row.category || item.category,
  }) || isBuildingMaterialItem(item);
}

function compactCategory(value) {
  return String(value || "").toLowerCase().replace(/[^a-z]/g, "");
}

function isFmcgSale(row = {}, item = {}) {
  return FMCG_CATEGORIES.has(compactCategory(row.category || item.category));
}

function isUnknownSale(row = {}, item = {}) {
  const category = String(row.category || item.category || "").trim().toUpperCase();
  return UNKNOWN_CATEGORIES.has(category) || !category;
}

export function accumulateSalesMix(mix, row, item = {}) {
  const next = mix || emptySalesMix();
  if (isBuildingMaterialSale(row, item)) {
    return { hasBuildingMaterial: true, hasOther: next.hasOther };
  }
  if (isFmcgSale(row, item)) {
    return { hasBuildingMaterial: next.hasBuildingMaterial, hasOther: true };
  }
  if (isUnknownSale(row, item)) return next;
  return { hasBuildingMaterial: next.hasBuildingMaterial, hasOther: true };
}

export function isBuildingMaterialOnlySalesMix(mix) {
  return Boolean(mix?.hasBuildingMaterial && !mix?.hasOther);
}

export function buildSalesMixByCustomer(rows, itemLookup = new Map()) {
  const mixByCode = new Map();

  (rows || []).forEach((row) => {
    const keys = customerMixKeys(row?.customer_code);
    if (keys.length === 0) return;
    const item = itemLookup.get(normalizeCode(row.item_code)) || {};
    keys.forEach((code) => {
      mixByCode.set(code, accumulateSalesMix(mixByCode.get(code), row, item));
    });
  });

  return mixByCode;
}

export function isExcludedNewOrderCustomerCode(value) {
  return EXCLUDED_NEW_ORDER_CUSTOMER_CODES.some((code) => customerAccountCodesMatch(code, value));
}

export function isExcludedNewOrderCustomer(customer, salesMixByCode = new Map()) {
  if (isExcludedNewOrderCustomerCode(customer?.customer_code || customer)) return true;
  if (isBuildingMaterialCustomer(customer)) return true;

  const mix = customerMixKeys(customer?.customer_code).reduce((current, code) => {
    const next = salesMixByCode.get(code);
    if (!next) return current;
    return {
      hasBuildingMaterial: current.hasBuildingMaterial || next.hasBuildingMaterial,
      hasOther: current.hasOther || next.hasOther,
    };
  }, emptySalesMix());

  return isBuildingMaterialOnlySalesMix(mix);
}

export function excludeBuildingMaterialCustomers(customers, salesMixByCode = new Map()) {
  return (customers || []).filter((customer) => !isExcludedNewOrderCustomer(customer, salesMixByCode));
}
