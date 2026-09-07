import { getMailerConfig, isEmailConfigured, sendEmail } from "./mailer.js";
import {
  MISSING_INVOICE_GRACE_MS,
  buildMissingInvoiceAlertEmail,
  invoiceMetaKey,
  parseInvoiceMeta,
  resolveMissingInvoiceEmailRecipients,
  selectMissingInvoiceOrders,
} from "./missingInvoiceEmail.js";

const ORDERS_SELECT = "id,order_number,customer_code,customer_name,salesman_code,salesman_name,status,created_at,total_value";
const PAGE_SIZE = 1000;
const META_CHUNK = 200;

function chunkList(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export async function loadSubmittedOrdersOlderThan(admin, cutoffIso) {
  const rows = [];
  let from = 0;

  while (true) {
    const { data, error } = await admin
      .from("sales_orders")
      .select(ORDERS_SELECT)
      .eq("status", "SUBMITTED")
      .lte("created_at", cutoffIso)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;

    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

export async function loadInvoiceMetaMap(admin, orderIds) {
  const ids = [...new Set((orderIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;

  for (const chunk of chunkList(ids, META_CHUNK)) {
    const keys = chunk.map((id) => invoiceMetaKey(id));
    const { data, error } = await admin
      .from("system_settings")
      .select("setting_key,setting_value")
      .in("setting_key", keys);

    if (error) throw error;

    (data || []).forEach((row) => {
      const payload = parseInvoiceMeta(row.setting_value);
      const orderId = String(payload?.orderId || String(row.setting_key || "").replace(/^order_invoice_meta:/, "")).trim();
      if (!orderId || !payload) return;
      map.set(orderId, payload);
    });
  }

  return map;
}

export async function loadMissingInvoiceOrders(admin, now = new Date()) {
  const cutoffIso = new Date(now.getTime() - MISSING_INVOICE_GRACE_MS).toISOString();
  const orders = await loadSubmittedOrdersOlderThan(admin, cutoffIso);
  const metaByOrder = await loadInvoiceMetaMap(admin, orders.map((order) => order.id));
  return {
    orders: selectMissingInvoiceOrders(orders, metaByOrder, now),
    metaByOrder,
  };
}

export async function runMissingInvoiceEmailCycle(admin, {
  now = new Date(),
  env = process.env,
  send = sendEmail,
  loadOrders = loadMissingInvoiceOrders,
} = {}) {
  if (!isEmailConfigured(getMailerConfig(env))) {
    return {
      skipped: true,
      reason: "email_not_configured",
      sentCount: 0,
      orderCount: 0,
    };
  }

  const to = resolveMissingInvoiceEmailRecipients(env);
  if (!to.length) {
    return {
      skipped: true,
      reason: "no_recipients",
      sentCount: 0,
      orderCount: 0,
    };
  }

  const loaded = await loadOrders(admin, now);
  const orders = loaded?.orders || [];
  const metaByOrder = loaded?.metaByOrder || new Map();

  if (!orders.length) {
    return {
      skipped: true,
      reason: "no_overdue_orders",
      sentCount: 0,
      orderCount: 0,
      to,
    };
  }

  const message = buildMissingInvoiceAlertEmail({ now, orders, metaByOrder });

  try {
    const sent = await send({ ...message, to }, env);
    return {
      skipped: false,
      sentCount: 1,
      failedCount: 0,
      orderCount: message.orderCount,
      to,
      provider: sent?.provider || null,
    };
  } catch (error) {
    return {
      skipped: false,
      sentCount: 0,
      failedCount: 1,
      orderCount: message.orderCount,
      to,
      error: error.message || "Unable to send email",
    };
  }
}
