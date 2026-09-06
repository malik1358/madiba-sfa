import { isBuildingMaterialItem } from "./pricePayload.js";
import { customerCodeCandidates, resolveCustomerAccountCode } from "./outstanding.js";
import { isBuildingMaterialCustomer } from "../management/my-day/customerEligibility.js";

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

function isUnknownSale(row = {}, item = {}) {
  const category = String(row.category || item.category || "").trim().toUpperCase();
  const name = String(row.item_name || item.item_name || "").trim();
  return !name && UNKNOWN_CATEGORIES.has(category);
}

export function accumulateSalesMix(mix, row, item = {}) {
  const next = mix || emptySalesMix();
  if (isBuildingMaterialSale(row, item)) {
    return { hasBuildingMaterial: true, hasOther: next.hasOther };
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

export function isExcludedNewOrderCustomer(customer, salesMixByCode = new Map()) {
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
