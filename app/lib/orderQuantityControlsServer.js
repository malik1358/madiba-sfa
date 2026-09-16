import {
  ORDER_QUANTITY_CONTROLS_CACHE_KEY,
  activeOrderQuantityControls,
  evaluateOrderQuantityControls,
  formatQuantityControlViolation,
  getRiyadhWeekBounds,
  normalizeOrderQuantityControls,
  resolveStoredOrderQuantityControls,
} from "./orderQuantityControls.js";

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

export async function loadOrderQuantityControls(admin) {
  const { data, error } = await admin
    .from("price_catalog_cache")
    .select("price_map,updated_at")
    .eq("cache_key", ORDER_QUANTITY_CONTROLS_CACHE_KEY)
    .maybeSingle();

  if (error) throw error;

  const configured = Boolean(data?.price_map && typeof data.price_map === "object");
  return {
    controls: configured
      ? resolveStoredOrderQuantityControls(data.price_map)
      : normalizeOrderQuantityControls(resolveStoredOrderQuantityControls(null)),
    configured,
    updatedAt: data?.updated_at || null,
  };
}

async function sumPriorItemQty({
  admin,
  customerCode,
  itemCodes,
  weekStartIso,
  weekEndIso,
  excludeOrderId = null,
}) {
  const codes = [...new Set((itemCodes || []).map(normalizeCode).filter(Boolean))];
  const priorQtyByItem = Object.fromEntries(codes.map((code) => [code, 0]));
  if (!customerCode || codes.length === 0) return priorQtyByItem;

  let ordersQuery = admin
    .from("sales_orders")
    .select("id")
    .eq("customer_code", customerCode)
    .neq("status", "CANCELLED")
    .gte("created_at", weekStartIso)
    .lt("created_at", weekEndIso);

  if (excludeOrderId) {
    ordersQuery = ordersQuery.neq("id", Number(excludeOrderId));
  }

  const { data: orders, error: ordersError } = await ordersQuery;
  if (ordersError) throw ordersError;

  const orderIds = (orders || []).map((row) => row.id).filter((id) => id != null);
  if (orderIds.length === 0) return priorQtyByItem;

  const { data: items, error: itemsError } = await admin
    .from("sales_order_items")
    .select("order_id,item_code,quantity")
    .in("order_id", orderIds);

  if (itemsError) throw itemsError;

  const codeSet = new Set(codes);
  (items || []).forEach((row) => {
    const code = normalizeCode(row.item_code);
    if (!codeSet.has(code)) return;
    priorQtyByItem[code] += Number(row.quantity || 0);
  });

  return priorQtyByItem;
}

export async function assertOrderQuantityControls({
  admin,
  customerCode,
  lines,
  excludeOrderId = null,
  language = "en",
}) {
  const { controls } = await loadOrderQuantityControls(admin);
  const active = activeOrderQuantityControls(controls);
  if (active.length === 0) return { ok: true, violations: [] };

  const relevantCodes = active.map((control) => control.itemCode);
  const hasRelevantLine = (lines || []).some((line) => {
    const code = normalizeCode(line?.item_code || line?.itemCode);
    return relevantCodes.includes(code) && Number(line?.quantity || 0) > 0;
  });
  if (!hasRelevantLine) return { ok: true, violations: [] };

  const { weekStartIso, weekEndIso } = getRiyadhWeekBounds(new Date());
  const priorQtyByItem = await sumPriorItemQty({
    admin,
    customerCode,
    itemCodes: relevantCodes,
    weekStartIso,
    weekEndIso,
    excludeOrderId,
  });

  const violations = evaluateOrderQuantityControls({
    lines,
    controls: active,
    priorQtyByItem,
  });

  if (violations.length === 0) {
    return { ok: true, violations: [], priorQtyByItem, weekStartIso, weekEndIso };
  }

  const error = violations.map((row) => formatQuantityControlViolation(row, language)).join(" ");
  return {
    ok: false,
    error,
    violations,
    priorQtyByItem,
    weekStartIso,
    weekEndIso,
  };
}
