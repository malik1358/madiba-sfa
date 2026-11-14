import { buildMasterUnitConvMap } from "./masterUnitQty.js";

/**
 * Load Master UOM conversion map from item_master_analysis (service-role client).
 * Missing table/column → empty map (feature not migrated yet).
 */
export async function loadMasterUnitConvMap(admin) {
  if (!admin) return {};
  try {
    const { data, error } = await admin
      .from("item_master_analysis")
      .select("tally_item_code, google_article_no, tally_base_uom, tally_alt_uom, tally_master_unit_conv");
    if (error) {
      if (/item_master_analysis|tally_master_unit_conv|tally_alt_uom/i.test(error.message || "")) {
        return {};
      }
      throw error;
    }
    return buildMasterUnitConvMap(data || []);
  } catch (error) {
    if (/item_master_analysis|tally_master_unit_conv/i.test(String(error?.message || error || ""))) {
      return {};
    }
    throw error;
  }
}
