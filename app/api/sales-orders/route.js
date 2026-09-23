import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { GPS_REQUIRED_ERROR, buildGpsActivityNote, hasGpsCoordinates, normalizeGpsCapturePlatform } from "../../lib/geo.js";
import { shouldRequireTransactionGps } from "../../lib/moduleAccess.js";
import { queueTransactionBossAlerts } from "../../lib/transactionBossAlerts.js";
import { loadCachedPricingCatalog, priceOrderLines, resolveCatalogForOrder } from "../../lib/orderPricing.js";
import { normalizePaymentType, normalizePricingRegion } from "../../lib/regionalPricing.js";
import {
  findProspectByOfflineId,
  parseOfflineProspectIdFromCustomerCode,
  resolveProspectCustomerCode,
} from "../../lib/prospects.js";
import { resolveSalesScopeForUserId } from "../user/sales-scope/route.js";
import {
  ORDER_STATUS_PENDING_APPROVAL,
  ORDER_STATUS_PENDING_INVOICE_CREATION,
} from "../../lib/orderApproval.js";
import { assertOrderQuantityControls } from "../../lib/orderQuantityControlsServer.js";
import {
  blockedByAvgDaysMessage,
  orderBlockOverrideKey,
  parseOrderBlockOverride,
  resolveOrderBlockStatus,
} from "../../lib/customerOrderBlock.js";
import { resolveTrustedAvgDaysToPayForCustomer } from "../../lib/customerOrderBlockServer.js";
import {
  formatSalesmanOrderNumber,
  isSalesmanOrderNumberForCode,
  maxSequenceFromOrderNumbers,
  nextSalesmanOrderSequence,
  normalizeSalesmanOrderPrefix,
  parseSalesmanOrderNumber,
} from "../../lib/salesmanOrderNumber.js";

export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function invoiceMetaKey(orderId) {
  return `order_invoice_meta:${String(orderId || "").trim()}`;
}

async function markOrderInvoiceQueueStatus(admin, orderId, userId, status) {
  const key = invoiceMetaKey(orderId);
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
    // Keep default meta when stored JSON is invalid.
  }

  if (String(existing.status || "").trim()) {
    return;
  }

  const nowIso = new Date().toISOString();
  const updated = {
    ...existing,
    orderId: String(orderId),
    status,
    updatedAt: nowIso,
    statusUpdatedAt: nowIso,
    statusUpdatedBy: userId || "",
  };

  const { error } = await admin.from("system_settings").upsert({
    setting_key: key,
    setting_value: JSON.stringify(updated),
  }, { onConflict: "setting_key" });
  if (error) throw error;
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function toNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildChangeSet(beforeLines = [], afterLines = []) {
  const beforeMap = new Map();
  const afterMap = new Map();

  beforeLines.forEach((line) => {
    const code = normalizeCode(line.item_code);
    if (!code) return;
    beforeMap.set(code, {
      item_code: code,
      item_name: String(line.item_name || code),
      quantity: toNumber(line.quantity),
      rate: toNumber(line.rate),
    });
  });

  afterLines.forEach((line) => {
    const code = normalizeCode(line.item_code);
    if (!code) return;
    afterMap.set(code, {
      item_code: code,
      item_name: String(line.item_name || code),
      quantity: toNumber(line.quantity),
      rate: toNumber(line.rate),
    });
  });

  const allCodes = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const changes = [];

  allCodes.forEach((code) => {
    const before = beforeMap.get(code) || null;
    const after = afterMap.get(code) || null;

    if (!before && after) {
      changes.push({
        type: "ADDED",
        item_code: code,
        item_name: after.item_name,
        before_quantity: 0,
        after_quantity: after.quantity,
        before_rate: 0,
        after_rate: after.rate,
      });
      return;
    }

    if (before && !after) {
      changes.push({
        type: "REMOVED",
        item_code: code,
        item_name: before.item_name,
        before_quantity: before.quantity,
        after_quantity: 0,
        before_rate: before.rate,
        after_rate: 0,
      });
      return;
    }

    if (!before || !after) return;

    const qtyChanged = before.quantity !== after.quantity;
    const rateChanged = before.rate !== after.rate;
    if (!qtyChanged && !rateChanged) return;

    changes.push({
      type: "UPDATED",
      item_code: code,
      item_name: after.item_name || before.item_name,
      before_quantity: before.quantity,
      after_quantity: after.quantity,
      before_rate: before.rate,
      after_rate: after.rate,
    });
  });

  return changes.sort((a, b) => String(a.item_code).localeCompare(String(b.item_code)));
}

function latestKey(orderId) {
  return `order_history_latest:${String(orderId || "").trim()}`;
}

function historyKey(orderId, changedAt) {
  return `order_history:${String(orderId || "").trim()}:${String(changedAt || new Date().toISOString())}`;
}

function parseValue(value) {
  try {
    return JSON.parse(value || "null");
  } catch {
    return null;
  }
}

async function readHistory(admin, orderId) {
  const [latestRes, historyRes] = await Promise.all([
    admin.from("system_settings").select("setting_value").eq("setting_key", latestKey(orderId)).maybeSingle(),
    admin.from("system_settings").select("setting_key,setting_value").like("setting_key", `order_history:${orderId}:%`),
  ]);

  if (latestRes.error) throw latestRes.error;
  if (historyRes.error) throw historyRes.error;

  const history = (historyRes.data || [])
    .map((row) => ({ ...parseValue(row.setting_value), historyKey: row.setting_key }))
    .filter(Boolean)
    .sort((a, b) => String(a.changedAt || "").localeCompare(String(b.changedAt || "")));

  return history;
}

async function writeOrderPricingMeta(admin, orderId, meta) {
  const { error } = await admin.from("system_settings").upsert({
    setting_key: `order_pricing_meta:${orderId}`,
    setting_value: JSON.stringify(meta),
  }, { onConflict: "setting_key" });
  if (error) throw error;
}

async function appendOrderHistory(admin, {
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
}) {
  const entry = {
    orderId,
    customerCode,
    action,
    previousStatus,
    nextStatus,
    paymentType: normalizePaymentType(paymentType),
    pricingRegion: normalizePricingRegion(pricingRegion),
    changes: Array.isArray(changes) ? changes : [],
    changedAt,
    changedBy: userId,
  };

  const { error: latestError } = await admin.from("system_settings").upsert({
    setting_key: latestKey(orderId),
    setting_value: JSON.stringify(entry),
  }, { onConflict: "setting_key" });
  if (latestError) throw latestError;

  const { error: historyError } = await admin.from("system_settings").upsert({
    setting_key: historyKey(orderId, changedAt),
    setting_value: JSON.stringify(entry),
  }, { onConflict: "setting_key" });
  if (historyError) throw historyError;

  return readHistory(admin, orderId);
}

async function insertGpsActivityLog(admin, userId, entryType, location, extra = {}) {
  const { error } = await admin.from("daily_activity_logs").insert({
    user_id: userId,
    entry_type: entryType,
    note: buildGpsActivityNote(entryType, location, extra),
  });
  if (error) throw error;
}

async function getAuthUser(admin, token) {
  const {
    data: { user },
    error,
  } = await admin.auth.getUser(token);
  if (error || !user) throw new Error("Invalid login session");
  return user;
}

function canAccessOrder(order, scope, userId) {
  if (!order) return false;
  if (scope?.hasAllAccess) return true;
  if (order.created_by === userId) return true;
  if ((scope?.visibleUserIds || []).includes(order.created_by)) return true;

  const salesmanCode = normalizeCode(order.salesman_code);
  return Boolean(salesmanCode) && (scope?.visibleSalesmanCodes || []).includes(salesmanCode);
}

async function ensureOrderAccess(admin, orderId, userId) {
  const { data: order, error } = await admin
    .from("sales_orders")
    .select("id,created_by,salesman_code,status,customer_code")
    .eq("id", orderId)
    .maybeSingle();

  if (error) throw error;
  if (!order) throw new Error("Order not found.");

  const scope = await resolveSalesScopeForUserId(admin, userId);
  if (!canAccessOrder(order, scope, userId)) {
    throw new Error("You do not have access to edit this order.");
  }
  return order;
}

async function resolvePersistedCustomerCode(admin, customerCode) {
  const requested = String(customerCode || "").trim();
  const offlineId = parseOfflineProspectIdFromCustomerCode(requested);
  if (!offlineId) return requested;

  const prospect = await findProspectByOfflineId(admin, offlineId);
  return resolveProspectCustomerCode(prospect) || requested;
}

function storedOrderNumber(order) {
  const orderNumber = String(order?.order_number || "").trim();
  if (orderNumber) return orderNumber;
  if (order?.id == null || order.id === "") return "";
  return String(order.id);
}

async function readMaxSalesmanOrderSequence(admin, salesmanCode) {
  const prefix = normalizeSalesmanOrderPrefix(salesmanCode);
  if (!prefix || !admin) return 0;

  const { data, error } = await admin
    .from("sales_orders")
    .select("order_number")
    .ilike("order_number", `${prefix}-%`)
    .limit(5000);
  if (error) throw error;
  return maxSequenceFromOrderNumbers((data || []).map((row) => row.order_number), salesmanCode);
}

async function allocateServerSalesmanOrderNumber(admin, salesmanCode) {
  const prefix = normalizeSalesmanOrderPrefix(salesmanCode);
  if (!prefix) return "";
  const maxSeq = await readMaxSalesmanOrderSequence(admin, salesmanCode);
  return formatSalesmanOrderNumber(salesmanCode, nextSalesmanOrderSequence(maxSeq));
}

function normalizeClientOrderNumber(rawOrderNumber, salesmanCode) {
  const text = String(rawOrderNumber || "").trim();
  if (!text) return "";
  const parsed = parseSalesmanOrderNumber(text);
  if (!parsed) return "";
  if (salesmanCode && !isSalesmanOrderNumberForCode(parsed.orderNumber, salesmanCode)) {
    return "";
  }
  return parsed.orderNumber;
}

async function ensureStoredOrderNumber(admin, orderId, existingOrderNumber = "", {
  salesmanCode = "",
  preferredOrderNumber = "",
} = {}) {
  const current = String(existingOrderNumber || "").trim();
  if (current) return current;

  const preferred = normalizeClientOrderNumber(preferredOrderNumber, salesmanCode);
  if (preferred) {
    const { error } = await admin
      .from("sales_orders")
      .update({ order_number: preferred })
      .eq("id", orderId);
    if (!error) return preferred;
    if (!/duplicate|unique/i.test(String(error.message || ""))) {
      throw error;
    }
  }

  if (salesmanCode) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const next = await allocateServerSalesmanOrderNumber(admin, salesmanCode);
      if (!next) break;
      const { error } = await admin
        .from("sales_orders")
        .update({ order_number: next })
        .eq("id", orderId);
      if (!error) return next;
      if (!/duplicate|unique/i.test(String(error.message || ""))) {
        throw error;
      }
    }
  }

  const fallback = String(orderId);
  const { error } = await admin
    .from("sales_orders")
    .update({ order_number: fallback })
    .eq("id", orderId);
  if (error && !/duplicate|unique/i.test(String(error.message || ""))) {
    throw error;
  }
  return fallback;
}

async function persistDraftOrder(admin, {
  userId,
  orderId,
  customerCode,
  customerName,
  salesmanCode,
  lines,
  capturedAt,
  clientOrderNumber = "",
}) {
  const nowIso = capturedAt || new Date().toISOString();
  const resolvedCustomerCode = await resolvePersistedCustomerCode(admin, customerCode);
  let existingLines = [];
  let resolvedOrderId = orderId ? Number(orderId) : null;
  let resolvedOrderNumber = "";
  const preferredOrderNumber = normalizeClientOrderNumber(clientOrderNumber, salesmanCode);

  if (resolvedOrderId) {
    await ensureOrderAccess(admin, resolvedOrderId, userId);
    const { data: beforeLines, error: beforeLinesError } = await admin
      .from("sales_order_items")
      .select("item_code,item_name,quantity,rate")
      .eq("order_id", resolvedOrderId);
    if (beforeLinesError) throw beforeLinesError;
    existingLines = beforeLines || [];
  }

  if (!resolvedOrderId) {
    const insertRow = {
      customer_code: resolvedCustomerCode,
      customer_name: customerName,
      salesman_code: salesmanCode,
      status: "DRAFT",
      created_by: userId,
      updated_at: nowIso,
    };
    if (preferredOrderNumber) {
      insertRow.order_number = preferredOrderNumber;
    }

    let newOrder = null;
    let orderError = null;
    ({ data: newOrder, error: orderError } = await admin
      .from("sales_orders")
      .insert(insertRow)
      .select("id,order_number")
      .single());

    if (orderError && preferredOrderNumber && /duplicate|unique/i.test(String(orderError.message || ""))) {
      // Rare multi-device collision: keep creating the order, then allot the next
      // free salesman number. Prefer never rewriting a number that already printed.
      delete insertRow.order_number;
      ({ data: newOrder, error: orderError } = await admin
        .from("sales_orders")
        .insert(insertRow)
        .select("id,order_number")
        .single());
    }

    if (orderError) throw orderError;
    resolvedOrderId = newOrder.id;
    resolvedOrderNumber = storedOrderNumber(newOrder);
  } else {
    const { data: updatedOrder, error: updateError } = await admin
      .from("sales_orders")
      .update({
        customer_code: resolvedCustomerCode,
        customer_name: customerName,
        salesman_code: salesmanCode,
        updated_at: nowIso,
      })
      .eq("id", resolvedOrderId)
      .select("id,order_number")
      .maybeSingle();

    if (updateError) throw updateError;
    resolvedOrderNumber = storedOrderNumber(updatedOrder);
  }

  // Never replace an order number that already exists on the row.
  resolvedOrderNumber = await ensureStoredOrderNumber(
    admin,
    resolvedOrderId,
    resolvedOrderNumber,
    {
      salesmanCode,
      preferredOrderNumber: resolvedOrderNumber ? "" : preferredOrderNumber,
    },
  );

  const { error: deleteError } = await admin
    .from("sales_order_items")
    .delete()
    .eq("order_id", resolvedOrderId);
  if (deleteError) throw deleteError;

  const normalizedLines = (lines || []).map((line) => ({
    order_id: resolvedOrderId,
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
    const fallback = Number(line.quantity || 0) * Number(line.rate || 0);
    return sum + (Number.isFinite(fallback) ? fallback : 0);
  }, 0);
  const { error: totalsError } = await admin
    .from("sales_orders")
    .update({
      total_items: normalizedLines.length,
      total_quantity: totalQuantity,
      total_value: Math.round(totalValue * 100) / 100,
    })
    .eq("id", resolvedOrderId);
  if (totalsError) throw totalsError;

  const changeSet = buildChangeSet(
    existingLines,
    normalizedLines.map((line) => ({
      item_code: line.item_code,
      item_name: line.item_name,
      quantity: line.quantity,
      rate: line.rate,
    })),
  );

  return {
    orderId: resolvedOrderId,
    orderNumber: resolvedOrderNumber,
    customerCode: resolvedCustomerCode,
    existingLines,
    changeSet,
    nowIso,
  };
}

const RECENT_ORDER_LOOKUP_MS = 20 * 60 * 1000;

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    const url = new URL(request.url);
    const requestedOrderId = String(url.searchParams.get("orderId") || "").trim();
    const customerCode = String(url.searchParams.get("customerCode") || "").trim();
    const latest = String(url.searchParams.get("latest") || "") === "1";

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const user = await getAuthUser(admin, authHeader.replace("Bearer ", ""));

    let order = null;

    if (requestedOrderId && !requestedOrderId.startsWith("pending:")) {
      const numericId = Number(requestedOrderId);
      if (!Number.isFinite(numericId) || numericId <= 0) {
        return NextResponse.json({ success: false, error: "Invalid order id." }, { status: 400 });
      }

      const { data, error } = await admin
        .from("sales_orders")
        .select("id,order_number,status,customer_code,customer_name,created_by,salesman_code,updated_at")
        .eq("id", numericId)
        .maybeSingle();
      if (error) throw error;
      order = data;
    } else if (latest && customerCode) {
      const sinceIso = new Date(Date.now() - RECENT_ORDER_LOOKUP_MS).toISOString();
      const { data, error } = await admin
        .from("sales_orders")
        .select("id,order_number,status,customer_code,customer_name,created_by,updated_at")
        .eq("customer_code", customerCode)
        .eq("created_by", user.id)
        .gte("updated_at", sinceIso)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      order = data;
    } else {
      return NextResponse.json({ success: false, error: "Order id or latest customer lookup is required." }, { status: 400 });
    }

    if (!order) {
      return NextResponse.json({ success: true, found: false });
    }

    const scope = await resolveSalesScopeForUserId(admin, user.id);
    if (!canAccessOrder(order, scope, user.id)) {
      return NextResponse.json({ success: false, error: "You do not have access to this order." }, { status: 403 });
    }

    const orderNumber = await ensureStoredOrderNumber(admin, order.id, order.order_number);
    const liveCustomerCode = await resolvePersistedCustomerCode(admin, order.customer_code);
    if (liveCustomerCode && liveCustomerCode !== order.customer_code) {
      await admin.from("sales_orders").update({ customer_code: liveCustomerCode }).eq("id", order.id);
    }
    return NextResponse.json({
      success: true,
      found: true,
      orderId: order.id,
      orderNumber,
      customerCode: liveCustomerCode || order.customer_code || "",
      customerName: order.customer_name || "",
      status: order.status,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message || "Unable to load order number.",
    }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const action = String(body?.action || "save_draft").trim().toLowerCase();
    const customerCode = String(body?.customerCode || "").trim();
    const customerName = String(body?.customerName || "").trim();
    const salesmanCode = String(body?.salesmanCode || "").trim();
    const requestedPaymentType = normalizePaymentType(body?.paymentType);
    const requestedPricingRegion = normalizePricingRegion(body?.pricingRegion);
    const lines = Array.isArray(body?.lines) ? body.lines : [];
    const location = body?.location || null;
    const capturedAt = String(body?.capturedAt || new Date().toISOString());
    const capturePlatform = normalizeGpsCapturePlatform(body?.platform);
    const loadedOrderStatus = String(body?.loadedOrderStatus || "DRAFT").trim().toUpperCase();
    const requestedOrderId = body?.orderId ? Number(body.orderId) : null;
    const clientOrderNumber = String(body?.orderNumber || body?.order_number || "").trim();
    const creditApprovalRequired = Boolean(body?.creditApprovalRequired);
    const orderBlockThreshold = body?.orderBlockSnapshot?.threshold ?? null;

    if (!customerCode) {
      return NextResponse.json({ success: false, error: "Customer is required." }, { status: 400 });
    }
    if (lines.length === 0) {
      return NextResponse.json({ success: false, error: "Add at least one item before saving the order." }, { status: 400 });
    }

    const latitude = Number(location?.latitude);
    const longitude = Number(location?.longitude);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const user = await getAuthUser(admin, authHeader.replace("Bearer ", ""));
    const userMetadata = user.user_metadata || user.app_metadata || {};
    const scope = await resolveSalesScopeForUserId(admin, user.id);

    const { data: blockOverrideRow, error: blockOverrideError } = await admin
      .from("system_settings")
      .select("setting_value")
      .eq("setting_key", orderBlockOverrideKey(customerCode))
      .maybeSingle();
    if (blockOverrideError) throw blockOverrideError;

    if (action === "submit" && !scope.hasAllAccess) {
      const avgDays = await resolveTrustedAvgDaysToPayForCustomer({
        request,
        authHeader,
        customerCode,
        customerName,
      });
      const blockStatus = resolveOrderBlockStatus({
        ...avgDays,
        threshold: orderBlockThreshold,
        override: parseOrderBlockOverride(blockOverrideRow?.setting_value),
      });
      if (blockStatus.blocked) {
        return NextResponse.json({
          success: false,
          error: blockedByAvgDaysMessage({
            threshold: blockStatus.threshold,
            avgDaysToPay: blockStatus.avgDaysToPay,
          }),
        }, { status: 400 });
      }
    }

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) throw profileError;

    const requireGps = shouldRequireTransactionGps(profile?.role);
    if (requireGps && (!Number.isFinite(latitude) || !Number.isFinite(longitude))) {
      return NextResponse.json({ success: false, error: GPS_REQUIRED_ERROR }, { status: 400 });
    }

    const catalog = await loadCachedPricingCatalog(admin);
    const pricedCatalog = resolveCatalogForOrder(catalog, {
      selectedRegion: requestedPricingRegion,
      currentUserRegion: userMetadata.pricing_region,
      currentUserRegions: userMetadata.pricing_regions,
      customerSalesmanCode: salesmanCode,
      pricingRegionBySalesmanCode: salesmanCode
        ? { [String(salesmanCode).trim().toUpperCase()]: requestedPricingRegion || userMetadata.pricing_region }
        : {},
      paymentType: requestedPaymentType,
    });
    const pricedLines = priceOrderLines(lines, pricedCatalog);

    const controlCustomerCode = await resolvePersistedCustomerCode(admin, customerCode);
    const quantityControlCheck = await assertOrderQuantityControls({
      admin,
      customerCode: controlCustomerCode,
      lines: pricedLines,
      excludeOrderId: requestedOrderId,
    });
    if (!quantityControlCheck.ok) {
      return NextResponse.json({
        success: false,
        error: quantityControlCheck.error,
        quantityControlViolations: quantityControlCheck.violations,
      }, { status: 400 });
    }

    const { orderId, orderNumber, customerCode: persistedCustomerCode, changeSet, nowIso } = await persistDraftOrder(admin, {
      userId: user.id,
      orderId: requestedOrderId,
      customerCode,
      customerName,
      salesmanCode,
      lines: pricedLines,
      capturedAt,
      clientOrderNumber,
    });
    const historyCustomerCode = persistedCustomerCode || customerCode;

    await writeOrderPricingMeta(admin, orderId, {
      paymentType: requestedPaymentType,
      pricingRegion: pricedCatalog.region,
    });

    const isNewOrder = !requestedOrderId;
    const draftHistoryAction = isNewOrder ? "CREATED_ORDER" : "EDITED_ORDER";

    let history = await appendOrderHistory(admin, {
      orderId,
      customerCode: historyCustomerCode,
      userId: user.id,
      action: draftHistoryAction,
      previousStatus: loadedOrderStatus || "DRAFT",
      nextStatus: loadedOrderStatus || "DRAFT",
      changes: changeSet,
      changedAt: nowIso,
      paymentType: requestedPaymentType,
      pricingRegion: pricedCatalog.region,
    });

    if (action !== "submit" && requireGps && hasGpsCoordinates(location)) {
      await insertGpsActivityLog(
        admin,
        user.id,
        isNewOrder ? "ORDER_DRAFT" : "ORDER_EDITED",
        location,
        {
          order_id: orderId,
          customer_code: historyCustomerCode,
          customer_name: customerName,
          platform: capturePlatform,
        },
      );
    }

    let status = "DRAFT";

    if (action === "submit") {
      const { error: submitError } = await admin
        .from("sales_orders")
        .update({
          status: "SUBMITTED",
          submitted_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", orderId);

      if (submitError) throw submitError;

      history = await appendOrderHistory(admin, {
        orderId,
        customerCode: historyCustomerCode,
        userId: user.id,
        action: "SUBMITTED_ORDER",
        previousStatus: loadedOrderStatus || "DRAFT",
        nextStatus: "SUBMITTED",
        changes: [],
        changedAt: nowIso,
        paymentType: requestedPaymentType,
        pricingRegion: pricedCatalog.region,
      });

      if (requireGps && hasGpsCoordinates(location)) {
        await insertGpsActivityLog(admin, user.id, "ORDER_SUBMITTED", location, {
          order_id: orderId,
          customer_code: historyCustomerCode,
          platform: capturePlatform,
        });
      }

      // Queue for approval when required; otherwise wait for invoice creation.
      await markOrderInvoiceQueueStatus(
        admin,
        orderId,
        user.id,
        creditApprovalRequired
          ? ORDER_STATUS_PENDING_APPROVAL
          : ORDER_STATUS_PENDING_INVOICE_CREATION,
      );

      status = "SUBMITTED";
    }

    queueTransactionBossAlerts(admin, {
      actorUserId: user.id,
      transactionType: action === "submit"
        ? "ORDER_SUBMITTED"
        : (isNewOrder ? "ORDER_DRAFT" : "ORDER_EDITED"),
      referenceKey: action === "submit"
        ? `order:${orderId}:submit`
        : (isNewOrder ? `order:${orderId}:draft` : `order:${orderId}:edit:${nowIso}`),
      details: {
        customerCode: historyCustomerCode,
        customerName,
        referenceId: orderId,
      },
    });

    return NextResponse.json({
      success: true,
      orderId,
      orderNumber,
      customerCode: historyCustomerCode,
      status,
      history,
      action,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message || "Unable to save order.",
    }, { status: 500 });
  }
}
