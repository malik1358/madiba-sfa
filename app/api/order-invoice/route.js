import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  attachComparisonToMeta,
  compareInvoiceBufferWithOrder,
  compareStoredInvoiceWithOrder,
  INVOICE_BUCKET,
} from "../../lib/orderInvoiceComparison.js";
import { attachProspectLinkToMeta, backfillProspectInvoiceLinks } from "../../lib/prospectInvoiceLink.js";
import { isProspectCustomerCode } from "../../lib/customerCode.js";
import { expandMutualGroupScopeIdentities } from "../../lib/mutualSalesmanGroups.js";

export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const STATUS_PENDING_CREDIT = "Pending for credit approval";
const STATUS_WAITING_CREDIT_APPLICATION = "Waiting for credit application";
const STATUS_REJECTED = "Rejected by management";
const STATUS_STOCK_UNAVAILABLE = "Stock unavailable";
const STATUS_INVOICE_MADE = "Invoice made";

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function isInvoiceMakerRole(role) {
  const normalized = String(role || "").trim().toLowerCase();
  return normalized === "invoice_maker" || normalized === "invoice-maker";
}

function metaKey(orderId) {
  return `order_invoice_meta:${String(orderId || "").trim()}`;
}

function parseJson(value) {
  try {
    return JSON.parse(value || "null");
  } catch {
    return null;
  }
}

function safeFileName(name) {
  return String(name || "invoice.pdf")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "invoice.pdf";
}

function parseIso(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

async function resolveScope(admin, token) {
  const {
    data: { user },
    error: userError,
  } = await admin.auth.getUser(token);

  if (userError || !user) {
    throw new Error("Invalid login session");
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,role,salesman_code,salesman_name")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    throw new Error("Profile not found.");
  }

  const role = String(profile.role || "").toLowerCase();
  const currentSalesmanCode = normalizeCode(profile.salesman_code);

  const [profilesRes, usersRes] = await Promise.all([
    admin
      .from("profiles")
      .select("id,role,salesman_code,salesman_name")
      .in("role", ["salesman", "manager", "admin", "invoice-maker", "invoice_maker"]),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  if (profilesRes.error) throw profilesRes.error;
  if (usersRes.error) throw usersRes.error;

  const authUsers = usersRes.data?.users || [];
  const subordinateIds = new Set();

  if (!["admin", "manager"].includes(role) && !isInvoiceMakerRole(role)) {
    authUsers.forEach((authUser) => {
      const metadata = authUser?.user_metadata || authUser?.app_metadata || {};
      if (normalizeCode(metadata.head_salesman_code) === currentSalesmanCode) {
        subordinateIds.add(authUser.id);
      }
    });
  }

  const allProfiles = profilesRes.data || [];
  const visibleProfiles = allProfiles.filter((entry) => {
    if (["admin", "manager"].includes(role) || isInvoiceMakerRole(role)) return true;
    return entry.id === profile.id || subordinateIds.has(entry.id);
  });

  const mutualGroupCodes = expandMutualGroupScopeIdentities(allProfiles, profile);

  return {
    userId: user.id,
    role,
    hasAllAccess: ["admin", "manager"].includes(role) || isInvoiceMakerRole(role),
    visibleUserIds: [...new Set(visibleProfiles.map((entry) => entry.id).filter(Boolean))],
    visibleSalesmanCodes: [...new Set([
      ...visibleProfiles.map((entry) => normalizeCode(entry.salesman_code)).filter(Boolean),
      ...mutualGroupCodes,
    ])],
  };
}

async function loadOrders(admin, orderIds) {
  const ids = [...new Set((orderIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (ids.length === 0) return [];

  const { data, error } = await admin
    .from("sales_orders")
    .select("id,customer_code,created_by,salesman_code")
    .in("id", ids);

  if (error) throw error;
  return data || [];
}

function canSeeOrder(order, scope) {
  if (scope.hasAllAccess) return true;

  const createdByVisible = (scope.visibleUserIds || []).includes(order.created_by);
  const salesmanVisible = (scope.visibleSalesmanCodes || []).includes(normalizeCode(order.salesman_code));

  return createdByVisible || salesmanVisible;
}

async function ensureOrderVisible(admin, orderId, scope) {
  const { data: order, error } = await admin
    .from("sales_orders")
    .select("id,customer_code,created_by,salesman_code,created_at")
    .eq("id", orderId)
    .maybeSingle();

  if (error) throw error;
  if (!order) throw new Error("Order not found.");
  if (!canSeeOrder(order, scope)) throw new Error("You do not have access to this order.");

  return order;
}

async function ensureBucket(admin) {
  const { data: bucket, error: bucketError } = await admin.storage.getBucket(INVOICE_BUCKET);
  if (!bucketError && bucket) return;

  const { error: createError } = await admin.storage.createBucket(INVOICE_BUCKET, {
    public: false,
    fileSizeLimit: 20 * 1024 * 1024,
    allowedMimeTypes: ["application/pdf"],
  });

  if (createError && !String(createError.message || "").toLowerCase().includes("already exists")) {
    throw createError;
  }
}

async function readMetaMap(admin, orderIds) {
  const keys = (orderIds || []).map((id) => metaKey(id));
  if (keys.length === 0) return new Map();

  const { data, error } = await admin
    .from("system_settings")
    .select("setting_key,setting_value")
    .in("setting_key", keys);

  if (error) throw error;

  const map = new Map();
  (data || []).forEach((row) => {
    const payload = parseJson(row.setting_value);
    if (!payload) return;
    const id = String(payload.orderId || "").trim();
    if (!id) return;
    map.set(id, payload);
  });

  return map;
}

async function hydrateMetaWithComparison(admin, meta, { forceCompare = false } = {}) {
  if (!meta?.invoiceFilePath) return meta;
  if (!forceCompare && meta.comparisonCheckedAt) return meta;

  try {
    const comparison = await compareStoredInvoiceWithOrder(admin, meta.orderId, meta.invoiceFilePath);
    const enriched = attachComparisonToMeta(meta, comparison);
    await upsertMeta(admin, enriched);
    return enriched;
  } catch {
    return meta;
  }
}

async function withSignedUrl(admin, meta) {
  if (!meta?.invoiceFilePath) return meta;

  const signed = await admin.storage.from(INVOICE_BUCKET).createSignedUrl(meta.invoiceFilePath, 60 * 60 * 24 * 30);
  return {
    ...meta,
    invoiceFileUrl: signed?.data?.signedUrl || "",
  };
}

async function upsertMeta(admin, meta) {
  const payload = {
    setting_key: metaKey(meta.orderId),
    setting_value: JSON.stringify(meta),
  };

  const { error } = await admin.from("system_settings").upsert(payload, { onConflict: "setting_key" });
  if (error) throw error;
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const scope = await resolveScope(admin, authHeader.replace("Bearer ", ""));
    const url = new URL(request.url);
    const singleOrderId = String(url.searchParams.get("orderId") || "").trim();
    const orderIdsCsv = String(url.searchParams.get("orderIds") || "").trim();

    const compare = String(url.searchParams.get("compare") || "").trim() === "1";
    const linkProspects = String(url.searchParams.get("linkProspects") || "").trim() === "1";

    if (singleOrderId) {
      const order = await ensureOrderVisible(admin, singleOrderId, scope);
      const metaMap = await readMetaMap(admin, [singleOrderId]);
      let meta = metaMap.get(singleOrderId) || { orderId: singleOrderId };
      meta = await hydrateMetaWithComparison(admin, meta, { forceCompare: compare });

      if (compare && isProspectCustomerCode(order.customer_code)) {
        const linked = await attachProspectLinkToMeta(admin, order, meta);
        if (linked.meta !== meta) {
          await upsertMeta(admin, linked.meta);
        }
        meta = linked.meta;
      }

      const hydrated = await withSignedUrl(admin, meta);
      return NextResponse.json({ success: true, item: hydrated });
    }

    const requestedIds = orderIdsCsv
      .split(",")
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .slice(0, 500);

    if (requestedIds.length === 0) {
      return NextResponse.json({ success: true, items: {} });
    }

    const orders = await loadOrders(admin, requestedIds);
    const visibleIds = orders
      .filter((order) => canSeeOrder(order, scope))
      .map((order) => String(order.id || "").trim())
      .filter(Boolean);

    const metaMap = await readMetaMap(admin, visibleIds);

    if (linkProspects) {
      const backfill = await backfillProspectInvoiceLinks(admin, orders.filter((order) => canSeeOrder(order, scope)), metaMap, {
        limit: 20,
      });
      for (const meta of Object.values(backfill.updatedMeta)) {
        await upsertMeta(admin, meta);
      }
    }

    const items = {};

    for (const orderId of visibleIds) {
      const base = metaMap.get(orderId) || { orderId };
      items[orderId] = await withSignedUrl(admin, base);
    }

    return NextResponse.json({ success: true, items });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || "Unable to load invoice metadata." }, { status: 500 });
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

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const scope = await resolveScope(admin, authHeader.replace("Bearer ", ""));
    const contentType = request.headers.get("content-type") || "";

    if (contentType.toLowerCase().includes("multipart/form-data")) {
      if (!isInvoiceMakerRole(scope.role)) {
        return NextResponse.json({ success: false, error: "Only invoice maker can upload invoices." }, { status: 403 });
      }

      const form = await request.formData();
      const mode = String(form.get("mode") || "").trim();
      if (mode !== "upload") {
        return NextResponse.json({ success: false, error: "Unsupported action." }, { status: 400 });
      }

      const orderId = String(form.get("orderId") || "").trim();
      if (!orderId) {
        return NextResponse.json({ success: false, error: "Order id is required." }, { status: 400 });
      }

      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ success: false, error: "PDF file is required." }, { status: 400 });
      }

      const mimeType = String(file.type || "").toLowerCase();
      const fileName = String(file.name || "").toLowerCase();
      if (mimeType !== "application/pdf" && !fileName.endsWith(".pdf")) {
        return NextResponse.json({ success: false, error: "Only PDF invoices are allowed." }, { status: 400 });
      }

      const order = await ensureOrderVisible(admin, orderId, scope);
      await ensureBucket(admin);

      const now = new Date();
      const nowIso = now.toISOString();
      const customerCode = normalizeCode(order.customer_code) || "UNKNOWN";
      const safeName = safeFileName(file.name || "invoice.pdf");
      const storagePath = `${customerCode}/${orderId}/${Date.now()}-${safeName}`;

      const arrayBuffer = await file.arrayBuffer();
      const uploadRes = await admin.storage.from(INVOICE_BUCKET).upload(storagePath, arrayBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });

      if (uploadRes.error) throw uploadRes.error;

      const existingMap = await readMetaMap(admin, [orderId]);
      const existing = existingMap.get(orderId) || { orderId };

      const orderCreatedAt = parseIso(order.created_at);
      const diffSeconds = orderCreatedAt ? Math.max(0, Math.round((now.getTime() - orderCreatedAt.getTime()) / 1000)) : null;

      const updated = {
        ...existing,
        orderId,
        status: STATUS_INVOICE_MADE,
        invoiceUploadedAt: nowIso,
        invoiceUploadedBy: scope.userId,
        invoiceFilePath: storagePath,
        updatedAt: nowIso,
        statusUpdatedAt: nowIso,
        statusUpdatedBy: scope.userId,
      };

      if (Number.isFinite(diffSeconds)) {
        updated.invoiceBuildSeconds = diffSeconds;
      }

      let enriched = updated;
      let prospectLink = null;
      try {
        const comparison = await compareInvoiceBufferWithOrder(admin, orderId, arrayBuffer);
        enriched = attachComparisonToMeta(updated, comparison);
      } catch {
        // Keep upload successful even if PDF text extraction fails.
      }

      if (isProspectCustomerCode(order.customer_code)) {
        const linked = await attachProspectLinkToMeta(admin, order, enriched, arrayBuffer);
        enriched = linked.meta;
        prospectLink = linked.prospectLink;
      }

      await upsertMeta(admin, enriched);
      const hydrated = await withSignedUrl(admin, enriched);

      return NextResponse.json({ success: true, item: hydrated, prospectLink });
    }

    const body = await request.json();
    const mode = String(body?.mode || "").trim();

    if (mode === "backfill-comparisons") {
      const orderIds = (Array.isArray(body?.orderIds) ? body.orderIds : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .slice(0, 15);

      const orders = await loadOrders(admin, orderIds);
      const visibleOrders = orders.filter((order) => canSeeOrder(order, scope));
      const visibleIds = visibleOrders.map((order) => String(order.id || "").trim()).filter(Boolean);
      const metaMap = await readMetaMap(admin, visibleIds);

      const items = {};
      const prospectLinks = {};

      for (const orderId of visibleIds) {
        const order = visibleOrders.find((entry) => String(entry.id) === orderId);
        const meta = metaMap.get(orderId) || { orderId };
        const compared = await hydrateMetaWithComparison(admin, meta, { forceCompare: true });
        metaMap.set(orderId, compared);

        if (order && isProspectCustomerCode(order.customer_code)) {
          const linked = await attachProspectLinkToMeta(admin, order, compared);
          if (linked.meta !== compared) {
            await upsertMeta(admin, linked.meta);
            metaMap.set(orderId, linked.meta);
          }
          prospectLinks[orderId] = linked.prospectLink;
          items[orderId] = await withSignedUrl(admin, linked.meta);
          continue;
        }

        items[orderId] = await withSignedUrl(admin, compared);
      }

      return NextResponse.json({ success: true, items, prospectLinks });
    }

    if (mode === "backfill-prospect-links") {
      const orderIds = (Array.isArray(body?.orderIds) ? body.orderIds : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .slice(0, 20);

      const orders = await loadOrders(admin, orderIds);
      const visibleOrders = orders.filter((order) => canSeeOrder(order, scope));
      const visibleIds = visibleOrders.map((order) => String(order.id || "").trim()).filter(Boolean);
      const metaMap = await readMetaMap(admin, visibleIds);
      const backfill = await backfillProspectInvoiceLinks(admin, visibleOrders, metaMap, { limit: 20 });

      for (const meta of Object.values(backfill.updatedMeta)) {
        await upsertMeta(admin, meta);
      }

      const items = {};
      for (const orderId of visibleIds) {
        const meta = metaMap.get(orderId) || { orderId };
        items[orderId] = await withSignedUrl(admin, meta);
      }

      return NextResponse.json({
        success: true,
        processed: backfill.processed,
        results: backfill.results,
        items,
      });
    }

    if (mode === "compare") {
      const orderId = String(body?.orderId || "").trim();
      if (!orderId) {
        return NextResponse.json({ success: false, error: "Order id is required." }, { status: 400 });
      }

      const order = await ensureOrderVisible(admin, orderId, scope);
      const metaMap = await readMetaMap(admin, [orderId]);
      const meta = metaMap.get(orderId) || { orderId };
      const compared = await hydrateMetaWithComparison(admin, meta, { forceCompare: true });
      const linked = await attachProspectLinkToMeta(admin, order, compared);
      if (linked.meta !== compared) {
        await upsertMeta(admin, linked.meta);
      }
      const hydrated = await withSignedUrl(admin, linked.meta);
      return NextResponse.json({ success: true, item: hydrated, prospectLink: linked.prospectLink });
    }

    if (mode !== "set-status") {
      return NextResponse.json({ success: false, error: "Unsupported action." }, { status: 400 });
    }

    if (!isInvoiceMakerRole(scope.role)) {
      return NextResponse.json({ success: false, error: "Only invoice maker can set invoice status." }, { status: 403 });
    }

    const orderId = String(body?.orderId || "").trim();
    const status = String(body?.status || "").trim();

    if (!orderId) {
      return NextResponse.json({ success: false, error: "Order id is required." }, { status: 400 });
    }

    if (![STATUS_PENDING_CREDIT, STATUS_WAITING_CREDIT_APPLICATION, STATUS_REJECTED, STATUS_STOCK_UNAVAILABLE, STATUS_INVOICE_MADE].includes(status)) {
      return NextResponse.json({ success: false, error: "Unsupported status value." }, { status: 400 });
    }

    await ensureOrderVisible(admin, orderId, scope);
    const existingMap = await readMetaMap(admin, [orderId]);
    const existing = existingMap.get(orderId) || { orderId };

    if (status === STATUS_INVOICE_MADE && !existing.invoiceFilePath) {
      return NextResponse.json({ success: false, error: "Upload invoice PDF before setting status to Invoice made." }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const updated = {
      ...existing,
      orderId,
      status,
      updatedAt: nowIso,
      statusUpdatedAt: nowIso,
      statusUpdatedBy: scope.userId,
    };

    await upsertMeta(admin, updated);
    const hydrated = await withSignedUrl(admin, updated);

    return NextResponse.json({ success: true, item: hydrated });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || "Unable to update invoice metadata." }, { status: 500 });
  }
}
