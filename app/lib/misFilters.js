import {
  createGrowthCatalogs,
  addRowToGrowthCatalogs,
  finalizeGrowthCatalogs,
  hasActiveGrowthFilters,
  normalizeGrowthFilters,
  rowMatchesGrowthFilters,
} from "./categoryGrowth.js";

function normCode(value) {
  return String(value || "").trim().toUpperCase();
}

/**
 * Apply BI-style growth filters to MIS source rows.
 * Sales use full growth matching; receipts/outstanding keep customers present in filtered sales;
 * inventory byCategory is limited when category filters are set.
 */
export function applyMisGrowthFilters({
  salesRows = [],
  receiptRows = [],
  outstandingRows = [],
  inventoryPhysical = null,
  filters = null,
} = {}) {
  const normalized = normalizeGrowthFilters(filters || {});
  if (!hasActiveGrowthFilters(normalized)) {
    return {
      salesRows,
      receiptRows,
      outstandingRows,
      inventoryPhysical,
      filters: normalized,
      filtered: false,
    };
  }

  const filteredSales = (salesRows || []).filter((row) => rowMatchesGrowthFilters(row, normalized));
  const customerCodes = new Set(
    filteredSales.map((row) => normCode(row.customer_code)).filter(Boolean),
  );

  const filteredReceipts = (receiptRows || []).filter((row) => {
    const code = normCode(row.customer_code || row.party_code || row.code);
    return code && customerCodes.has(code);
  });

  const filteredOutstanding = (outstandingRows || []).filter((row) => {
    const code = normCode(row.customer_code || row.party_code || row.code);
    return code && customerCodes.has(code);
  });

  let inventory = inventoryPhysical;
  const categorySelected = normalized.values?.category || [];
  if (inventory && Array.isArray(inventory.byCategory) && categorySelected.length) {
    const wanted = new Set(categorySelected.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
    const byCategory = inventory.byCategory.filter((row) => (
      wanted.has(String(row.category || "").trim().toLowerCase())
    ));
    const physical = byCategory.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    inventory = {
      ...inventory,
      physical,
      byCategory,
    };
  } else if (inventory && inventory.byCategory && typeof inventory.byCategory === "object" && !Array.isArray(inventory.byCategory) && categorySelected.length) {
    const wanted = new Set(categorySelected.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
    const next = {};
    Object.entries(inventory.byCategory).forEach(([category, amount]) => {
      if (wanted.has(String(category || "").trim().toLowerCase())) next[category] = amount;
    });
    inventory = {
      ...inventory,
      physical: Object.values(next).reduce((sum, amount) => sum + (Number(amount) || 0), 0),
      byCategory: next,
    };
  }

  return {
    salesRows: filteredSales,
    receiptRows: filteredReceipts,
    outstandingRows: filteredOutstanding,
    inventoryPhysical: inventory,
    filters: normalized,
    filtered: true,
  };
}

export function buildMisFilterCatalogs(salesRows = []) {
  const catalogs = createGrowthCatalogs();
  (salesRows || []).forEach((row) => addRowToGrowthCatalogs(catalogs, row));
  return finalizeGrowthCatalogs(catalogs);
}

export { hasActiveGrowthFilters, normalizeGrowthFilters };
