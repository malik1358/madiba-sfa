import {
  buildMasterUnitConvMap,
  mergePackingMasterUnitConvMap,
  mergeStockTakeMasterUnitConvMap,
} from "./masterUnitQty.js";

async function readAll(admin, table, columns) {
  const rows = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await admin
      .from(table)
      .select(columns)
      .range(start, start + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < 1000) return rows;
  }
}

/**
 * Load Master UOM conversion map for stock display.
 * Preference: item_master_analysis → stock_take_items → catalogue packing text.
 * Missing sources → skipped (feature not migrated / sheet unavailable).
 */
export async function loadMasterUnitConvMap(admin, {
  loadSheetPacking = null,
} = {}) {
  if (!admin) return {};

  let map = {};

  try {
    const rows = await readAll(
      admin,
      "item_master_analysis",
      "tally_item_code, google_article_no, tally_base_uom, tally_alt_uom, tally_master_unit_conv",
    );
    map = buildMasterUnitConvMap(rows);
  } catch (error) {
    if (!/item_master_analysis|tally_master_unit_conv|tally_alt_uom/i.test(String(error?.message || error || ""))) {
      throw error;
    }
  }

  try {
    const stockRows = await readAll(
      admin,
      "stock_take_items",
      "item_code, base_uom, master_uom, base_uom_pack_size",
    );
    map = mergeStockTakeMasterUnitConvMap(map, stockRows);
  } catch (error) {
    if (!/stock_take_items|base_uom_pack_size|master_uom/i.test(String(error?.message || error || ""))) {
      throw error;
    }
  }

  if (typeof loadSheetPacking === "function") {
    try {
      const packingByCode = await loadSheetPacking();
      map = mergePackingMasterUnitConvMap(map, packingByCode || {});
    } catch {
      // Packing sheet is optional.
    }
  }

  return map;
}
