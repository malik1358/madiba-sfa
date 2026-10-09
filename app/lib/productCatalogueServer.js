import { isMissingRelationError } from "./schemaGuards.js";
import { cataloguePacking, cataloguePermissions, normalizeCatalogueCode } from "./productCatalogue.js";

export async function requireCatalogueAccess(admin, request) {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) throw Object.assign(new Error("Please login again."), { status: 401 });
  const { data: { user }, error } = await admin.auth.getUser(header.slice(7));
  if (error || !user) throw Object.assign(new Error("Please login again."), { status: 401 });
  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("id,role,salesman_code,is_active").eq("id", user.id).single();
  if (profileError) throw profileError;
  const permissions = cataloguePermissions(profile, user);
  if (!permissions.canView) throw Object.assign(new Error("Product catalogue access denied."), { status: 403 });
  return permissions;
}

async function readAll(admin, table, columns) {
  const rows = [];
  for (let start = 0; ; start += 1000) {
    const result = await admin.from(table).select(columns).order("item_code").range(start, start + 999);
    if (result.error) throw result.error;
    rows.push(...(result.data || []));
    if ((result.data || []).length < 1000) return rows;
  }
}

export async function loadCatalogueDetails(admin) {
  const warnings = [];
  async function optionalRows(table, columns) {
    try {
      return await readAll(admin, table, columns);
    } catch (error) {
      if (!isMissingRelationError(error)) throw error;
      warnings.push(`Packing source ${table} is not installed.`);
      return [];
    }
  }
  const [products, stockItems, items] = await Promise.all([
    optionalRows("products", "item_code,unit"),
    optionalRows("stock_take_items", "item_code,base_uom,mid_uom,master_uom,base_uom_pack_size,mid_uom_pack_size"),
    readAll(admin, "items_master", "*"),
  ]);
  const details = {};
  const productsByCode = new Map(products.map((item) => [normalizeCatalogueCode(item.item_code), item]));
  const stockByCode = new Map(stockItems.map((item) => [normalizeCatalogueCode(item.item_code), item]));
  const itemsByCode = new Map(items.map((item) => [normalizeCatalogueCode(item.item_code), item]));
  for (const code of new Set([...productsByCode.keys(), ...stockByCode.keys(), ...itemsByCode.keys()])) {
    details[code] = cataloguePacking(itemsByCode.get(code), productsByCode.get(code), stockByCode.get(code));
  }
  return { details, warnings };
}
