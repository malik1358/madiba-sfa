import { getMailerConfig, isEmailConfigured, sendEmail } from "./mailer.js";
import {
  MISSING_INVOICE_EMAIL_LAST_SENT_KEY,
  MISSING_INVOICE_GRACE_MS,
  buildMissingInvoiceAlertEmail,
  invoiceMetaKey,
  missingInvoiceCreatedFromIso,
  isWithinMissingInvoiceEmailWindow,
  parseInvoiceMeta,
  parseLastSentAt,
  resolveMissingInvoiceEmailCc,
  resolveMissingInvoiceEmailRecipients,
  selectMissingInvoiceOrders,
  wasMissingInvoiceEmailSentRecently,
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

export async function loadSubmittedOrdersOlderThan(admin, cutoffIso, createdFromIso = missingInvoiceCreatedFromIso()) {
  const rows = [];
  let from = 0;

  while (true) {
    const { data, error } = await admin
      .from("sales_orders")
      .select(ORDERS_SELECT)
      .eq("status", "SUBMITTED")
      .gte("created_at", createdFromIso)
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

export async function loadLastMissingInvoiceEmailSentAt(admin) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", MISSING_INVOICE_EMAIL_LAST_SENT_KEY)
    .maybeSingle();
  if (error) throw error;
  return parseLastSentAt(data?.setting_value);
}

export async function saveLastMissingInvoiceEmailSentAt(admin, now = new Date()) {
  const { error } = await admin.from("system_settings").upsert({
    setting_key: MISSING_INVOICE_EMAIL_LAST_SENT_KEY,
    setting_value: JSON.stringify({ lastSentAt: now.toISOString() }),
  }, { onConflict: "setting_key" });
  if (error) throw error;
}

export async function syncMissingInvoiceCronVault(admin, env = process.env) {
  const secret = String(env.CRON_SECRET || "").trim();
  const origin = String(env.APP_ORIGIN || "https://madiba-sfa.vercel.app").trim().replace(/\/+$/, "");
  if (!secret || !admin?.rpc) return { skipped: true, reason: "missing_secret_or_client" };
  const { error } = await admin.rpc("upsert_missing_invoice_cron_vault", {
    p_secret: secret,
    p_url: `${origin}/api/cron/missing-invoice-email`,
  });
  if (error) return { skipped: false, ok: false, error: error.message };
  return { skipped: false, ok: true };
}

export async function loadMissingInvoiceOrders(admin, now = new Date()) {
  const cutoffIso = new Date(now.getTime() - MISSING_INVOICE_GRACE_MS).toISOString();
  const orders = await loadSubmittedOrdersOlderThan(admin, cutoffIso, missingInvoiceCreatedFromIso());
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
  loadLastSentAt = loadLastMissingInvoiceEmailSentAt,
  saveLastSentAt = saveLastMissingInvoiceEmailSentAt,
  syncVault = syncMissingInvoiceCronVault,
} = {}) {
  if (typeof syncVault === "function") {
    try {
      await syncVault(admin, env);
    } catch {
      // Vault sync is best-effort so a missing RPC cannot block the alert.
    }
  }

  if (!isWithinMissingInvoiceEmailWindow(now)) {
    return {
      skipped: true,
      reason: "outside_india_back_office_hours",
      sentCount: 0,
      orderCount: 0,
    };
  }

  if (!isEmailConfigured(getMailerConfig(env))) {
    return {
      skipped: true,
      reason: "email_not_configured",
      sentCount: 0,
      orderCount: 0,
    };
  }

  const to = resolveMissingInvoiceEmailRecipients(env);
  const cc = resolveMissingInvoiceEmailCc(env, to);
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
      cc,
    };
  }

  const lastSentAt = await loadLastSentAt(admin);
  if (wasMissingInvoiceEmailSentRecently(lastSentAt, now)) {
    return {
      skipped: true,
      reason: "sent_recently",
      sentCount: 0,
      orderCount: orders.length,
      to,
      cc,
    };
  }

  const message = buildMissingInvoiceAlertEmail({ now, orders, metaByOrder });

  try {
    const sent = await send({ ...message, to, cc }, env);
    await saveLastSentAt(admin, now);
    return {
      skipped: false,
      sentCount: 1,
      failedCount: 0,
      orderCount: message.orderCount,
      to,
      cc,
      provider: sent?.provider || null,
    };
  } catch (error) {
    return {
      skipped: false,
      sentCount: 0,
      failedCount: 1,
      orderCount: message.orderCount,
      to,
      cc,
      error: error.message || "Unable to send email",
    };
  }
}
