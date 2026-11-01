import { hasActiveGrowthFilters, normalizeGrowthFilters } from "./categoryGrowth.js";

export const BI_OVERVIEW_BUNDLE_KEY = "bi_overview_bundle_v1";
export const BI_OVERVIEW_BUNDLE_VERSION = 1;

/** Default Dashboard / Sales mix / growth tabs use all-time with no field filters. */
export function isPreparedOverviewFilters(input = {}) {
  const filters = normalizeGrowthFilters(input);
  if (hasActiveGrowthFilters(filters)) return false;
  if (filters.dateFrom || filters.dateTo) return false;
  if (filters.itemNameContains) return false;
  return true;
}

/** All-time empty filters, or the prepared MADIBA brand slice (item name only). */
export function canServePreparedOverviewSlice(input = {}) {
  const filters = normalizeGrowthFilters(input);
  const brand = String(filters.itemNameContains || "").trim().toUpperCase();
  if (brand === "MADIBA") {
    return isPreparedOverviewFilters({ ...filters, itemNameContains: "" });
  }
  return isPreparedOverviewFilters(filters);
}

/** Pick the matching report from a prepared / computed overview bundle. */
export function pickPreparedOverviewSlice(bundle, input = {}) {
  if (!bundle || typeof bundle !== "object") return null;
  const filters = normalizeGrowthFilters(input);
  const brand = String(filters.itemNameContains || "").trim().toUpperCase();
  if (brand === "MADIBA") return bundle.madiba || null;
  switch (String(filters.groupBy || "category")) {
    case "customer":
      return bundle.customer || null;
    case "item":
      return bundle.item || null;
    case "salesman":
      return bundle.salesman || null;
    default:
      return bundle.growth || null;
  }
}

export function preparedOverviewFingerprint(filters = {}) {
  const normalized = normalizeGrowthFilters(filters);
  return JSON.stringify({
    v: BI_OVERVIEW_BUNDLE_VERSION,
    dateFrom: normalized.dateFrom || "",
    dateTo: normalized.dateTo || "",
    itemNameContains: normalized.itemNameContains || "",
    values: normalized.values,
    amountMin: normalized.amountMin,
    amountMax: normalized.amountMax,
    quantityMin: normalized.quantityMin,
    quantityMax: normalized.quantityMax,
  });
}

export function serializePreparedOverviewBundle(bundle, {
  batchId = "",
  builtAt = "",
  asOfDate = "",
  cubeBuiltAt = "",
  fingerprint = "",
} = {}) {
  return {
    version: BI_OVERVIEW_BUNDLE_VERSION,
    batchId: String(batchId || ""),
    builtAt: String(builtAt || new Date().toISOString()),
    asOfDate: String(asOfDate || ""),
    cubeBuiltAt: String(cubeBuiltAt || ""),
    fingerprint: String(fingerprint || preparedOverviewFingerprint({})),
    bundle,
  };
}

export function deserializePreparedOverviewBundle(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (Number(payload.version || 0) !== BI_OVERVIEW_BUNDLE_VERSION) return null;
  if (!payload.bundle || typeof payload.bundle !== "object") return null;
  return {
    version: BI_OVERVIEW_BUNDLE_VERSION,
    batchId: String(payload.batchId || ""),
    builtAt: String(payload.builtAt || ""),
    asOfDate: String(payload.asOfDate || ""),
    cubeBuiltAt: String(payload.cubeBuiltAt || ""),
    fingerprint: String(payload.fingerprint || ""),
    bundle: payload.bundle,
  };
}

export function preparedOverviewBundleIsFresh(prepared, {
  batchId = "",
  cubeBuiltAt = "",
  fingerprint = "",
} = {}) {
  if (!prepared?.bundle) return false;
  if (fingerprint && prepared.fingerprint && prepared.fingerprint !== fingerprint) return false;
  if (batchId && prepared.batchId && prepared.batchId !== batchId) return false;
  if (cubeBuiltAt && prepared.cubeBuiltAt && prepared.cubeBuiltAt !== cubeBuiltAt) return false;
  return true;
}
