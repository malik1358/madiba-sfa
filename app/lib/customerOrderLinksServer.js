import { randomBytes } from "crypto";
import {
  CUSTOMER_ORDER_LINK_TTL_HOURS,
  buildCustomerFacingCatalogItems,
  buildCustomerOrderLinkUrl,
  customerOrderLinkExpiresAt,
  isCustomerOrderLinkExpired,
  isValidOrderLinkTokenShape,
  normalizeOrderLinkToken,
  requireCustomerOrderLinkPricing,
  sanitizeCustomerOrderLinkCatalogPayload,
} from "./customerOrderLinks.js";
import { resolveAppOrigin } from "./inactivityEmail.js";
import { ensureCustomerVisibleToScope } from "./customerAccess.js";
import { isProspectCustomerCode } from "./customerCode.js";
import { resolveOrderMakerFromProfile } from "./orderSalesman.js";
import { loadCachedPricingCatalog, priceOrderLines, resolveCatalogForOrder } from "./orderPricing.js";
import { normalizePaymentType, normalizePricingRegion, normalizePricingType } from "./regionalPricing.js";
import { loadRetailPriceMaps } from "./retailPricingServer.js";
import { loadCatalogueDetails, readCataloguePhoto } from "./productCatalogueServer.js";
import { normalizeCatalogueCode } from "./productCatalogue.js";
import {
  EOD_STOCK_DATASET_KEY,
  assertOrderLinesWithinEodStock,
  buildEodStockAvailability,
  readEodStockDataset,
} from "./eodStock.js";
import { loadMasterUnitConvMap } from "./masterUnitQtyServer.js";
import { assertOrderQuantityControls } from "./orderQuantityControlsServer.js";
import {
  formatSalesmanOrderNumber,
  maxSequenceForPrefix,
  nextSalesmanOrderSequence,
  resolveSalesmanOrderPrefix,
} from "./salesmanOrderNumber.js";
import { ORDER_STATUS_PENDING_INVOICE_CREATION } from "./orderApproval.js";
import {
  findProspectByOfflineId,
  parseOfflineProspectIdFromCustomerCode,
  parseProspectIdFromCustomerCode,
  resolveProspectCustomerCode,
} from "./prospects.js";

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

function toNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

export function createCustomerOrderLinkToken() {
  return randomBytes(24).toString("base64url");
}

async function resolvePersistedCustomerCode(admin, customerCode) {
  const requested = String(customerCode || "").trim();
  const offlineId = parseOfflineProspectIdFromCustomerCode(requested);
  if (!offlineId) return requested;
  const prospect = await findProspectByOfflineId(admin, offlineId);
  return resolveProspectCustomerCode(prospect) || requested;
}

async function loadSalesmanPeerCodes(admin) {
  const { data, error } = await admin.from("profiles").select("salesman_code").limit(5000);
  if (error) throw error;
  return (data || []).map((row) => row.salesman_code).filter(Boolean);
}

async function readMaxSalesmanOrderSequence(admin, salesmanCode, peerCodes = []) {
  const prefix = resolveSalesmanOrderPrefix(salesmanCode, peerCodes);
  if (!prefix) return 0;
  const pageSize = 1000;
  let offset = 0;
  let max = 0;
  for (;;) {
    const { data, error } = await admin
      .from("sales_orders")
      .select("order_number")
      .ilike("order_number", `${prefix}%`)
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    max = Math.max(max, maxSequenceForPrefix(rows.map((row) => row.order_number), prefix));
    if (rows.length < pageSize) break;
    offset += pageSize;
    if (offset > 50000) break;
  }
  return max;
}

async function allocateServerSalesmanOrderNumber(admin, salesmanCode) {
  const peers = await loadSalesmanPeerCodes(admin);
  const prefix = resolveSalesmanOrderPrefix(salesmanCode, peers);
  if (!prefix) return "";
  const maxSeq = await readMaxSalesmanOrderSequence(admin, salesmanCode, peers);
  return formatSalesmanOrderNumber(salesmanCode, nextSalesmanOrderSequence(maxSeq), {
    prefix,
    peerCodes: peers,
  });
}

async function writeOrderPricingMeta(admin, orderId, meta) {
  const { error } = await admin.from("system_settings").upsert({
    setting_key: `order_pricing_meta:${orderId}`,
    setting_value: JSON.stringify(meta),
  }, { onConflict: "setting_key" });
  if (error) throw error;
}

async function appendCustomerLinkOrderHistory(admin, {
  orderId,
  customerCode,
  userId,
  action,
  previousStatus,
  nextStatus,
  changes,
  changedAt,
  paymentType,
  pricingRegion,
  pricingType,
}) {
  const entry = {
    orderId,
    customerCode,
    action,
    previousStatus,
    nextStatus,
    paymentType: normalizePaymentType(paymentType),
    pricingRegion: normalizePricingRegion(pricingRegion),
    pricingType: normalizePricingType(pricingType),
    changes: Array.isArray(changes) ? changes : [],
    changedAt,
    changedBy: userId,
    source: "customer_order_link",
  };

  const { error: latestError } = await admin.from("system_settings").upsert({
    setting_key: `order_history_latest:${orderId}`,
    setting_value: JSON.stringify(entry),
  }, { onConflict: "setting_key" });
  if (latestError) throw latestError;

  const { error: historyError } = await admin.from("system_settings").upsert({
    setting_key: `order_history:${orderId}:${changedAt}`,
    setting_value: JSON.stringify(entry),
  }, { onConflict: "setting_key" });
  if (historyError) throw historyError;
}

async function markOrderInvoiceQueueStatus(admin, orderId, userId, status) {
  const key = `order_invoice_meta:${String(orderId || "").trim()}`;
  const { data: existingRow } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", key)
    .maybeSingle();

  let existing = { orderId: String(orderId) };
  try {
    const parsed = JSON.parse(existingRow?.setting_value || "null");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      existing = { ...parsed, orderId: String(orderId) };
    }
  } catch {
    // Keep default when stored JSON is invalid.
  }
  if (String(existing.status || "").trim()) return;

  const nowIso = new Date().toISOString();
  const updated = {
    ...existing,
    orderId: String(orderId),
    status,
    updatedAt: nowIso,
    statusUpdatedAt: nowIso,
    statusUpdatedBy: userId || "",
    source: "customer_order_link",
  };
  const { error } = await admin.from("system_settings").upsert({
    setting_key: key,
    setting_value: JSON.stringify(updated),
  }, { onConflict: "setting_key" });
  if (error) throw error;
}

async function loadEodAvailability(admin) {
  const [{ data, error }, masterUnits] = await Promise.all([
    admin
      .from("system_settings")
      .select("setting_value")
      .eq("setting_key", EOD_STOCK_DATASET_KEY)
      .maybeSingle(),
    loadMasterUnitConvMap(admin).catch(() => ({})),
  ]);
  if (error) throw error;
  try {
    return buildEodStockAvailability(readEodStockDataset(data?.setting_value), { masterUnits });
  } catch {
    return buildEodStockAvailability(null, { masterUnits });
  }
}

export async function createCustomerOrderLink(admin, {
  scope,
  userId,
  profile,
  customerCode,
  customerName = "",
  pricingRegion = "",
  paymentType = "credit",
  pricingType = "wholesale",
  env = process.env,
} = {}) {
  if (!admin) fail("Server configuration is incomplete.", 500);
  if (!userId) fail("Not authenticated", 401);

  const pricingChoice = requireCustomerOrderLinkPricing({ pricingRegion, pricingType });
  if (!pricingChoice.ok) fail(pricingChoice.error);

  const code = await resolvePersistedCustomerCode(admin, customerCode);
  if (!code) fail("Customer is required.");

  let customer;
  try {
    customer = await ensureCustomerVisibleToScope(admin, code, scope);
  } catch (error) {
    const message = String(error?.message || "Unable to access this customer.");
    if (/not found/i.test(message)) fail(message, 404);
    if (/access/i.test(message)) fail(message, 403);
    fail(message, 400);
  }
  const orderMaker = resolveOrderMakerFromProfile(profile);
  if (!orderMaker.salesmanCode) {
    fail("Your profile is missing a salesman code. Ask admin to set it before creating order links.");
  }

  const displayName = String(
    customerName
    || customer?.customer_name
    || customer?.company_name
    || customer?.shop_name
    || code,
  ).trim();
  const isProspect = isProspectCustomerCode(code) || Boolean(customer?.is_prospect);
  const prospectId = Number(
    customer?.id
    || customer?.prospect_id
    || parseProspectIdFromCustomerCode(code)
    || 0,
  ) || null;
  const token = createCustomerOrderLinkToken();
  const now = new Date();
  const expiresAt = customerOrderLinkExpiresAt(now, CUSTOMER_ORDER_LINK_TTL_HOURS);
  const region = pricingChoice.pricingRegion;
  const type = pricingChoice.pricingType;

  const insertRow = {
    token,
    customer_code: code,
    customer_name: displayName,
    is_prospect: isProspect,
    prospect_id: isProspect && prospectId ? prospectId : null,
    created_by: userId,
    salesman_code: orderMaker.salesmanCode,
    salesman_name: orderMaker.salesmanName || orderMaker.salesmanCode,
    pricing_region: region,
    payment_type: normalizePaymentType(paymentType),
    pricing_type: type,
    expires_at: expiresAt.toISOString(),
  };

  const { data, error } = await admin
    .from("customer_order_links")
    .insert(insertRow)
    .select("id,token,customer_code,customer_name,is_prospect,expires_at,created_at")
    .single();
  if (error) {
    if (/relation .*customer_order_links.* does not exist/i.test(String(error.message || ""))) {
      fail("Order links are not ready. Apply migration 20261118120000_customer_order_links.sql in Supabase.", 503);
    }
    throw error;
  }

  const origin = resolveAppOrigin(env);
  const url = buildCustomerOrderLinkUrl(origin, data.token);
  return {
    id: data.id,
    token: data.token,
    url,
    customerCode: data.customer_code,
    customerName: data.customer_name,
    isProspect: Boolean(data.is_prospect),
    pricingRegion: region,
    pricingType: type,
    expiresAt: data.expires_at,
    createdAt: data.created_at,
    ttlHours: CUSTOMER_ORDER_LINK_TTL_HOURS,
  };
}

async function loadLinkByToken(admin, token) {
  const safe = normalizeOrderLinkToken(token);
  if (!isValidOrderLinkTokenShape(safe)) fail("This order link is invalid.", 404);

  const { data, error } = await admin
    .from("customer_order_links")
    .select("*")
    .eq("token", safe)
    .maybeSingle();
  if (error) {
    if (/relation .*customer_order_links.* does not exist/i.test(String(error.message || ""))) {
      fail("Order links are not ready. Apply migration 20261118120000_customer_order_links.sql in Supabase.", 503);
    }
    throw error;
  }
  if (!data) fail("This order link was not found.", 404);
  if (isCustomerOrderLinkExpired(data)) fail("This order link has expired.", 410);
  return data;
}

async function loadSubmittedOrderSnapshot(admin, link) {
  const orderId = Number(link.submitted_order_id);
  if (!Number.isFinite(orderId) || orderId <= 0) return null;

  const [{ data: order, error: orderError }, { data: lines, error: linesError }] = await Promise.all([
    admin
      .from("sales_orders")
      .select("id,order_number,total_value,submitted_at,status")
      .eq("id", orderId)
      .maybeSingle(),
    admin
      .from("sales_order_items")
      .select("item_code,item_name,quantity,rate,line_value")
      .eq("order_id", orderId)
      .order("item_name"),
  ]);
  if (orderError) throw orderError;
  if (linesError) throw linesError;
  if (!order) return null;

  return {
    orderId: order.id,
    orderNumber: order.order_number || "",
    submittedAt: order.submitted_at || link.submitted_at || "",
    totalValue: Number(order.total_value) || 0,
    lines: lines || [],
  };
}

export async function loadCustomerOrderLinkCatalog(admin, token) {
  const link = await loadLinkByToken(admin, token);
  const [catalog, eodStock, catalogueDetails] = await Promise.all([
    loadCachedPricingCatalog(admin),
    loadEodAvailability(admin),
    loadCatalogueDetails(admin).catch(() => ({ details: {} })),
  ]);

  if (normalizePricingType(link.pricing_type) === "retail"
    && !Object.values(catalog.retailRegionPriceMaps || {}).some((map) => Object.keys(map).length > 0)) {
    catalog.retailRegionPriceMaps = await loadRetailPriceMaps();
  }

  const pricedCatalog = resolveCatalogForOrder(catalog, {
    selectedRegion: link.pricing_region,
    customerSalesmanCode: link.salesman_code,
    paymentType: link.payment_type,
    pricingType: link.pricing_type,
  });

  const items = buildCustomerFacingCatalogItems({
    sheetItems: catalog.sheetItems || [],
    regionPriceMap: pricedCatalog.regionPriceMap,
    eodStock,
    masterUnits: eodStock?.masterUnits,
  }).map((item) => {
    const detail = catalogueDetails?.details?.[item.item_code]
      || catalogueDetails?.details?.[normalizeCatalogueCode(item.item_code)]
      || {};
    return {
      ...item,
      packing: String(detail.packing || "").trim(),
      photos: Array.isArray(detail.photos) ? detail.photos : [],
    };
  });

  // Only expose cash/value discounts for items in this filtered catalog.
  const allowed = new Set(items.map((item) => item.item_code));
  const cashDiscountMap = {};
  const valueDiscountMap = {};
  for (const code of allowed) {
    const cash = Number(pricedCatalog.cashDiscountMap?.[code] || 0);
    if (cash > 0) cashDiscountMap[code] = cash;
    const slabs = pricedCatalog.valueDiscountMap?.[code];
    if (slabs && typeof slabs === "object") valueDiscountMap[code] = slabs;
  }

  const schemes = (pricedCatalog.schemes || []).filter((scheme) => {
    if (!scheme || scheme.active === false) return false;
    const reward = normalizeCode(scheme.rewardItemCode);
    if (allowed.has(reward)) return true;
    return (scheme.qualifierItemCodes || []).some((code) => allowed.has(normalizeCode(code)));
  });

  const submittedOrder = await loadSubmittedOrderSnapshot(admin, link);

  return sanitizeCustomerOrderLinkCatalogPayload({
    customerCode: link.customer_code,
    customerName: link.customer_name,
    isProspect: Boolean(link.is_prospect),
    paymentType: link.payment_type,
    pricingRegion: link.pricing_region,
    pricingType: link.pricing_type,
    expiresAt: link.expires_at,
    submittedOrder,
    readOnly: Boolean(submittedOrder),
    cashDiscountMap,
    valueDiscountMap,
    schemes,
    items,
  });
}

export async function readCustomerOrderLinkPhoto(admin, token, photoId) {
  const link = await loadLinkByToken(admin, token);
  const catalog = await loadCustomerOrderLinkCatalog(admin, link.token);
  const allowedPhotoIds = new Set();
  for (const item of catalog.items || []) {
    for (const photo of item.photos || []) {
      if (photo?.id) allowedPhotoIds.add(String(photo.id));
    }
  }
  const id = String(photoId || "").trim();
  if (!id || !allowedPhotoIds.has(id)) fail("Photo not found for this order link.", 404);
  return readCataloguePhoto(admin, id);
}

export async function submitCustomerOrderLinkOrder(admin, token, {
  lines = [],
  requestId = "",
} = {}) {
  const link = await loadLinkByToken(admin, token);

  if (link.submitted_order_id) {
    const existing = await loadSubmittedOrderSnapshot(admin, link);
    fail(
      existing?.orderNumber
        ? `This link already has submitted order ${existing.orderNumber}. Ask your salesman for a new link to change it.`
        : "This link already has a submitted order. Ask your salesman for a new link to change it.",
      409,
    );
  }

  const requestedLines = (Array.isArray(lines) ? lines : [])
    .map((line) => ({
      item_code: normalizeCode(line?.item_code || line?.itemCode),
      item_name: String(line?.item_name || line?.itemName || "").trim(),
      category: String(line?.category || "").trim(),
      quantity: toNumber(line?.quantity ?? line?.order_quantity),
    }))
    .filter((line) => line.item_code && line.quantity > 0);

  if (requestedLines.length === 0) {
    fail("Add at least one item quantity before submitting.");
  }

  // Quantities are master-unit only — reject fractional base-unit style values that look like pcs when master conv exists.
  for (const line of requestedLines) {
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      fail(`Invalid quantity for ${line.item_code}.`);
    }
  }

  const catalogPayload = await loadCustomerOrderLinkCatalog(admin, link.token);
  const allowed = new Map((catalogPayload.items || []).map((item) => [item.item_code, item]));
  for (const line of requestedLines) {
    if (!allowed.has(line.item_code)) {
      fail(`${line.item_code} is not available on this order link.`);
    }
  }

  const pricingCatalog = await loadCachedPricingCatalog(admin);
  if (normalizePricingType(link.pricing_type) === "retail"
    && !Object.values(pricingCatalog.retailRegionPriceMaps || {}).some((map) => Object.keys(map).length > 0)) {
    pricingCatalog.retailRegionPriceMaps = await loadRetailPriceMaps();
  }
  const pricedCatalog = resolveCatalogForOrder(pricingCatalog, {
    selectedRegion: link.pricing_region,
    customerSalesmanCode: link.salesman_code,
    paymentType: link.payment_type,
    pricingType: link.pricing_type,
  });

  const enrichedLines = requestedLines.map((line) => {
    const item = allowed.get(line.item_code);
    return {
      item_code: line.item_code,
      item_name: line.item_name || item?.item_name || line.item_code,
      category: line.category || item?.category || "",
      quantity: line.quantity,
    };
  });

  const pricedLines = priceOrderLines(enrichedLines, pricedCatalog);

  const eodStock = await loadEodAvailability(admin);
  const stockCheck = assertOrderLinesWithinEodStock(pricedLines, eodStock, "en");
  if (!stockCheck.ok) {
    // Never reveal available qty to the customer.
    const codes = (stockCheck.violations || []).map((row) => row.itemCode).filter(Boolean);
    fail(
      codes.length
        ? `Quantity is too high for: ${codes.join(", ")}. Please reduce the quantity and try again.`
        : "One or more quantities are too high. Please reduce them and try again.",
      400,
    );
  }

  const quantityControlCheck = await assertOrderQuantityControls({
    admin,
    customerCode: link.customer_code,
    lines: pricedLines,
  });
  if (!quantityControlCheck.ok) {
    fail(quantityControlCheck.error || "Quantity limit exceeded for one or more items.", 400);
  }

  if (requestId && !/^[0-9a-f-]{36}$/i.test(requestId)) {
    fail("Invalid order request id.");
  }

  if (requestId) {
    const { data: replay, error: replayError } = await admin
      .from("sales_orders")
      .select("id,order_number,status,customer_code")
      .eq("request_id", requestId)
      .eq("created_by", link.created_by)
      .maybeSingle();
    if (replayError) throw replayError;
    if (replay) {
      if (normalizeCode(replay.customer_code) !== normalizeCode(link.customer_code)) {
        fail("Order request belongs to another customer.", 409);
      }
      return {
        orderId: replay.id,
        orderNumber: replay.order_number,
        status: replay.status,
        customerCode: link.customer_code,
        customerName: link.customer_name,
      };
    }
  }

  const nowIso = new Date().toISOString();
  let orderNumber = await allocateServerSalesmanOrderNumber(admin, link.salesman_code);
  if (!orderNumber) {
    fail("Unable to allot an order number. Please ask your salesman for help.", 500);
  }

  const insertRow = {
    customer_code: link.customer_code,
    customer_name: link.customer_name,
    salesman_code: link.salesman_code,
    salesman_name: link.salesman_name || link.salesman_code,
    status: "DRAFT",
    created_by: link.created_by,
    order_number: orderNumber,
    updated_at: nowIso,
  };
  if (requestId) insertRow.request_id = requestId;

  let order = null;
  let orderError = null;
  ({ data: order, error: orderError } = await admin
    .from("sales_orders")
    .insert(insertRow)
    .select("id,order_number")
    .single());

  if (orderError && /duplicate|unique/i.test(String(orderError.message || ""))) {
    orderNumber = await allocateServerSalesmanOrderNumber(admin, link.salesman_code);
    insertRow.order_number = orderNumber;
    ({ data: order, error: orderError } = await admin
      .from("sales_orders")
      .insert(insertRow)
      .select("id,order_number")
      .single());
  }
  if (orderError) throw orderError;

  const orderId = order.id;
  const normalizedLines = pricedLines.map((line) => ({
    order_id: orderId,
    item_code: String(line.item_code || "").trim(),
    item_name: String(line.item_name || line.item_code || "").trim(),
    category: String(line.category || "").trim(),
    quantity: toNumber(line.quantity),
    rate: toNumber(line.rate),
    line_value: toNumber(line.line_value),
  }));

  if (normalizedLines.length > 0) {
    const { error: lineError } = await admin.from("sales_order_items").insert(normalizedLines);
    if (lineError) throw lineError;
  }

  const totalQuantity = normalizedLines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
  const totalValue = normalizedLines.reduce((sum, line) => {
    const lineValue = Number(line.line_value);
    if (Number.isFinite(lineValue) && lineValue > 0) return sum + lineValue;
    return sum + (Number(line.quantity || 0) * Number(line.rate || 0));
  }, 0);
  const roundedTotal = Math.round(totalValue * 100) / 100;

  const { error: submitError } = await admin
    .from("sales_orders")
    .update({
      status: "SUBMITTED",
      submitted_at: nowIso,
      updated_at: nowIso,
      total_items: normalizedLines.length,
      total_quantity: totalQuantity,
      total_value: roundedTotal,
    })
    .eq("id", orderId);
  if (submitError) throw submitError;

  await writeOrderPricingMeta(admin, orderId, {
    paymentType: normalizePaymentType(link.payment_type),
    pricingRegion: pricedCatalog.region,
    pricingType: normalizePricingType(link.pricing_type),
    source: "customer_order_link",
  });

  await appendCustomerLinkOrderHistory(admin, {
    orderId,
    customerCode: link.customer_code,
    userId: link.created_by,
    action: "SUBMITTED_ORDER",
    previousStatus: "DRAFT",
    nextStatus: "SUBMITTED",
    changes: normalizedLines.map((line) => ({
      item_code: line.item_code,
      item_name: line.item_name,
      quantity: line.quantity,
      rate: line.rate,
      change: "ADDED",
    })),
    changedAt: nowIso,
    paymentType: link.payment_type,
    pricingRegion: pricedCatalog.region,
    pricingType: link.pricing_type,
  });

  await markOrderInvoiceQueueStatus(
    admin,
    orderId,
    link.created_by,
    ORDER_STATUS_PENDING_INVOICE_CREATION,
  );

  const { error: linkUpdateError } = await admin
    .from("customer_order_links")
    .update({
      submitted_order_id: orderId,
      submitted_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", link.id)
    .is("submitted_order_id", null);
  if (linkUpdateError) throw linkUpdateError;

  return {
    orderId,
    orderNumber: order.order_number || orderNumber,
    status: "SUBMITTED",
    customerCode: link.customer_code,
    customerName: link.customer_name,
    totalValue: roundedTotal,
    expiresAt: link.expires_at,
  };
}
