import { getMailerConfig, isEmailConfigured, sendEmail } from "./mailer.js";
import {
  MISSING_INVOICE_EMAIL_LAST_SENT_KEY,
  MISSING_INVOICE_GRACE_MS,
  buildMissingInvoiceAlertEmail,
  getMissingInvoiceEmailIndiaDate,
  getMissingInvoiceEmailMidnightKsaDate,
  isMissingInvoiceEmailDailySummarySlot,
  isMissingInvoiceEmailOfficeHoliday,
  isMissingInvoiceEmailWithinOfficeHours,
  invoiceMetaKey,
  missingInvoiceCreatedFromIso,
  parseInvoiceMeta,
  parseMissingInvoiceEmailState,
  resolveMissingInvoiceEmailCc,
  resolveMissingInvoiceEmailDailySummary,
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
  return parseMissingInvoiceEmailState(data?.setting_value);
}

export async function saveLastMissingInvoiceEmailSentAt(
  admin,
  now = new Date(),
  previousState = {},
  {
    markFrequentSent = true,
    markMidnight = true,
    markDailySummary = false,
  } = {},
) {
  const state = parseMissingInvoiceEmailState(previousState);
  const midnightDate = markMidnight ? getMissingInvoiceEmailMidnightKsaDate(now) : null;
  const indiaDate = getMissingInvoiceEmailIndiaDate(now);
  const { error } = await admin.from("system_settings").upsert({
    setting_key: MISSING_INVOICE_EMAIL_LAST_SENT_KEY,
    setting_value: JSON.stringify({
      lastSentAt: markFrequentSent ? now.toISOString() : (
        typeof state.lastSentAt === "number"
          ? new Date(state.lastSentAt).toISOString()
          : state.lastSentAt
            ? new Date(state.lastSentAt).toISOString()
            : null
      ),
      lastMidnightKsaDate: midnightDate || state.lastMidnightKsaDate,
      lastDailySummaryIndiaDate: markDailySummary ? indiaDate : state.lastDailySummaryIndiaDate,
    }),
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

function uniqueEmails(...lists) {
  return [...new Set(lists.flat().map((email) => String(email || "").trim().toLowerCase()).filter(Boolean))];
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
  if (isMissingInvoiceEmailOfficeHoliday(now)) {
    return {
      skipped: true,
      reason: "office_holiday",
      sentCount: 0,
      orderCount: 0,
    };
  }

  if (typeof syncVault === "function") {
    try {
      await syncVault(admin, env);
    } catch {
      // Vault sync is best-effort so a missing RPC cannot block the alert.
    }
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
  const dailySummaryTo = resolveMissingInvoiceEmailDailySummary(env, [...to, ...cc]);
  if (!to.length && !dailySummaryTo.length) {
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

  const message = buildMissingInvoiceAlertEmail({ now, orders, metaByOrder });
  const hasFrequentReminderOrders = message.pendingApprovalCount > 0 || message.pendingInvoiceCreationCount > 0;
  const midnightKsaDate = getMissingInvoiceEmailMidnightKsaDate(now);
  const withinOfficeHours = isMissingInvoiceEmailWithinOfficeHours(now);
  const dailySummarySlot = isMissingInvoiceEmailDailySummarySlot(now);
  const indiaDate = getMissingInvoiceEmailIndiaDate(now);
  const wantFrequent = hasFrequentReminderOrders && withinOfficeHours;
  const wantMidnight = !hasFrequentReminderOrders && Boolean(midnightKsaDate);
  const mayNeedDaily = Boolean(dailySummaryTo.length && dailySummarySlot);

  if (!wantFrequent && !wantMidnight && !mayNeedDaily) {
    if (hasFrequentReminderOrders && !withinOfficeHours) {
      return {
        skipped: true,
        reason: "outside_office_hours",
        sentCount: 0,
        orderCount: message.orderCount,
        to,
        cc,
      };
    }
    return {
      skipped: true,
      reason: "no_pending_approval_or_invoice_creation",
      sentCount: 0,
      orderCount: message.orderCount,
      to,
      cc,
    };
  }

  const sendState = parseMissingInvoiceEmailState(await loadLastSentAt(admin));
  const dailySummaryPending = mayNeedDaily && sendState.lastDailySummaryIndiaDate !== indiaDate;

  if (wantMidnight && sendState.lastMidnightKsaDate === midnightKsaDate && !dailySummaryPending) {
    return {
      skipped: true,
      reason: "midnight_digest_already_sent",
      sentCount: 0,
      orderCount: message.orderCount,
      to,
      cc,
    };
  }

  if (wantFrequent && wasMissingInvoiceEmailSentRecently(sendState.lastSentAt, now) && !dailySummaryPending) {
    return {
      skipped: true,
      reason: "sent_recently",
      sentCount: 0,
      orderCount: message.orderCount,
      to,
      cc,
    };
  }

  if (!wantFrequent && !(wantMidnight && sendState.lastMidnightKsaDate !== midnightKsaDate) && !dailySummaryPending) {
    if (hasFrequentReminderOrders && !withinOfficeHours) {
      return {
        skipped: true,
        reason: "outside_office_hours",
        sentCount: 0,
        orderCount: message.orderCount,
        to,
        cc,
      };
    }
    return {
      skipped: true,
      reason: wantMidnight ? "midnight_digest_already_sent" : "no_pending_approval_or_invoice_creation",
      sentCount: 0,
      orderCount: message.orderCount,
      to,
      cc,
    };
  }

  const sends = [];
  const includeDailyOnOperational = wantFrequent
    && dailySummaryPending
    && withinOfficeHours
    && dailySummarySlot;

  if ((wantFrequent || (wantMidnight && sendState.lastMidnightKsaDate !== midnightKsaDate)) && to.length) {
    if (!(wantFrequent && wasMissingInvoiceEmailSentRecently(sendState.lastSentAt, now))) {
      const operationalCc = includeDailyOnOperational
        ? uniqueEmails(cc, dailySummaryTo)
        : cc;
      sends.push({
        kind: includeDailyOnOperational ? "frequent_with_daily_summary" : (wantFrequent ? "frequent" : "midnight"),
        payload: { ...message, to, cc: operationalCc },
        markFrequentSent: wantFrequent,
        markMidnight: wantMidnight,
        markDailySummary: includeDailyOnOperational,
      });
    }
  }

  if (dailySummaryPending && !includeDailyOnOperational) {
    sends.push({
      kind: "daily_summary",
      payload: { ...message, to: dailySummaryTo, cc: [] },
      markFrequentSent: false,
      markMidnight: false,
      markDailySummary: true,
    });
  }

  if (!sends.length) {
    return {
      skipped: true,
      reason: wantFrequent ? "sent_recently" : "no_pending_approval_or_invoice_creation",
      sentCount: 0,
      orderCount: message.orderCount,
      to,
      cc,
    };
  }

  let sentCount = 0;
  let failedCount = 0;
  let lastError = null;
  let provider = null;
  let nextState = sendState;
  const kinds = [];

  for (const entry of sends) {
    try {
      const sent = await send(entry.payload, env);
      sentCount += 1;
      provider = sent?.provider || provider;
      kinds.push(entry.kind);
      await saveLastSentAt(admin, now, nextState, {
        markFrequentSent: entry.markFrequentSent,
        markMidnight: entry.markMidnight,
        markDailySummary: entry.markDailySummary,
      });
      nextState = {
        ...nextState,
        lastSentAt: entry.markFrequentSent ? now.getTime() : nextState.lastSentAt,
        lastMidnightKsaDate: entry.markMidnight
          ? (getMissingInvoiceEmailMidnightKsaDate(now) || nextState.lastMidnightKsaDate)
          : nextState.lastMidnightKsaDate,
        lastDailySummaryIndiaDate: entry.markDailySummary ? indiaDate : nextState.lastDailySummaryIndiaDate,
      };
    } catch (error) {
      failedCount += 1;
      lastError = error.message || "Unable to send email";
    }
  }

  if (!sentCount) {
    return {
      skipped: false,
      sentCount: 0,
      failedCount,
      orderCount: message.orderCount,
      to,
      cc,
      dailySummaryTo,
      error: lastError,
    };
  }

  return {
    skipped: false,
    sentCount,
    failedCount,
    orderCount: message.orderCount,
    to,
    cc,
    dailySummaryTo,
    kinds,
    provider,
    ...(lastError ? { error: lastError } : {}),
  };
}
