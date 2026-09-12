import { buildCollectionQueues } from "./paymentCollections.js";
import { isCollectionOnlyAccess } from "./moduleAccess.js";
import { getMailerConfig, isEmailConfigured, normalizeDeliverableEmail, sendEmail } from "./mailer.js";
import {
  DEFAULT_VISITS_PER_SALESMAN,
  buildSalesmanVisitPlanDigestEmail,
  buildSalesmanVisitPlanEmail,
  daysSinceDate,
  groupVisitPlansBySalesman,
  isSalesmanVisitPlanEmailEnabled,
  isSalesmanVisitPlanSendToUsersEnabled,
  resolveSalesmanVisitPlanDigestRecipients,
  salesmanVisitPlanDisplayName,
} from "./salesmanVisitPlan.js";
import { getKsaDateString } from "./workdayActivity.js";

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function formatSupabaseError(error) {
  if (!error) return "Unknown Supabase error";
  if (typeof error === "string") return error;
  const message = String(error.message || "Supabase request failed").trim();
  const details = [error.code, error.details, error.hint]
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  return details.length ? `${message} (${details.join(" | ")})` : message;
}

function isMissingTableError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42P01"
    || message.includes("could not find the table")
    || (message.includes("relation") && message.includes("does not exist"));
}

export async function loadSalesmanVisitPlanProfiles(admin) {
  const preferred = await admin
    .from("profiles")
    .select("id,role,salesman_code,salesman_name,email,report_email,is_active");

  let rows = preferred.data || [];
  if (preferred.error) {
    if (!isMissingTableError(preferred.error) && !/report_email/i.test(String(preferred.error.message || ""))) {
      throw new Error(formatSupabaseError(preferred.error));
    }
    const fallback = await admin
      .from("profiles")
      .select("id,role,salesman_code,salesman_name,email,is_active");
    if (fallback.error) throw new Error(formatSupabaseError(fallback.error));
    rows = fallback.data || [];
  }

  return rows.filter((row) => {
    if (row?.is_active === false) return false;
    const code = normalizeCode(row.salesman_code);
    if (!code) return false;
    return !isCollectionOnlyAccess({ role: row.role, salesmanCode: code });
  });
}

export function mergeVisitPlanCustomerCandidates(visibleCustomers, collectionRecords, todayIso = new Date().toISOString()) {
  const byCode = new Map();

  (visibleCustomers || []).forEach((customer) => {
    const code = normalizeCode(customer?.customer_code);
    if (!code) return;
    byCode.set(code, {
      ...customer,
      customer_code: code,
      salesman_code: normalizeCode(customer.current_salesman_code || customer.salesman_code),
      days_since_last_invoice: daysSinceDate(
        customer.latest_transaction_date || customer.last_invoice_date,
        todayIso,
      ),
    });
  });

  const queues = buildCollectionQueues(collectionRecords || [], todayIso);
  const dueByCode = new Map();
  [...(queues.dueCustomers || []), ...(queues.notDueCustomers || [])].forEach((row) => {
    const code = normalizeCode(row?.customer_code);
    if (!code) return;
    dueByCode.set(code, row);
  });

  (collectionRecords || []).forEach((record) => {
    const code = normalizeCode(record?.customer_code);
    if (!code) return;
    const due = dueByCode.get(code);
    const existing = byCode.get(code) || {};
    byCode.set(code, {
      ...existing,
      ...record,
      customer_code: code,
      customer_name: record.customer_name || existing.customer_name || "",
      salesman_code: normalizeCode(
        record.current_salesman_code
        || record.salesman_code
        || existing.salesman_code
        || existing.current_salesman_code,
      ),
      salesman_name: record.salesman_name || existing.salesman_name || "",
      city: record.city || existing.city || "",
      area: record.area || existing.area || "",
      recent_sales_value: Math.max(Number(existing.recent_sales_value || 0), 0),
      average_monthly_purchase: Math.max(Number(existing.average_monthly_purchase || 0), 0),
      highest_monthly_sales: Math.max(Number(existing.highest_monthly_sales || 0), 0),
      days_since_last_invoice: existing.days_since_last_invoice
        ?? daysSinceDate(existing.latest_transaction_date, todayIso),
      total_due_amount: Number(due?.total_due_amount || 0),
      max_overdue_days: Number(due?.max_overdue_days || 0),
      due_invoice_count: Number(due?.due_invoice_count || 0),
      outstanding_cash: Number(due?.outstanding_cash || 0),
      probability_score: Number(due?.probability_score || 0),
      probability_label: due?.probability_label || "",
      latest_collection: due?.latest_collection || record.latest_collection || null,
    });
  });

  dueByCode.forEach((due, code) => {
    if (byCode.has(code)) return;
    byCode.set(code, {
      ...due,
      customer_code: code,
      salesman_code: normalizeCode(due.current_salesman_code || due.salesman_code),
      recent_sales_value: 0,
      average_monthly_purchase: 0,
      highest_monthly_sales: 0,
      days_since_last_invoice: null,
    });
  });

  return [...byCode.values()];
}

export function buildSalesmanVisitPlanPayload({
  visibleCustomers = [],
  collectionRecords = [],
  salesmanProfiles = [],
  salesmanCode = "",
  limit = DEFAULT_VISITS_PER_SALESMAN,
  todayIso = new Date().toISOString(),
  warnings = [],
} = {}) {
  const candidates = mergeVisitPlanCustomerCandidates(visibleCustomers, collectionRecords, todayIso);
  const filterCode = normalizeCode(salesmanCode);
  const filtered = filterCode
    ? candidates.filter((row) => normalizeCode(row.salesman_code || row.current_salesman_code) === filterCode)
    : candidates;

  const plans = groupVisitPlansBySalesman(filtered, {
    limit,
    todayIso,
    salesmanProfiles,
  });

  return {
    reportDate: getKsaDateString(new Date(todayIso)),
    visitLimit: Math.max(1, Math.min(50, Number(limit) || DEFAULT_VISITS_PER_SALESMAN)),
    salesmanCount: plans.length,
    visitCount: plans.reduce((sum, plan) => sum + plan.visitCount, 0),
    plans,
    warnings,
  };
}

export async function sendSalesmanVisitPlanEmailsFromPayload(payload, {
  salesmanCode = "",
  forcePreview = false,
  env = process.env,
} = {}) {
  const emailEnabled = isSalesmanVisitPlanEmailEnabled(env);
  const sendToUsers = isSalesmanVisitPlanSendToUsersEnabled(env) && emailEnabled && !forcePreview;
  const previewOnly = !sendToUsers;

  if (!emailEnabled && !forcePreview) {
    return {
      skipped: true,
      reason: "email_disabled_until_approved",
      sentCount: 0,
      failedCount: 0,
      previewOnly: true,
    };
  }

  if (!isEmailConfigured(getMailerConfig(env))) {
    throw new Error("Email is not configured (SMTP_FROM / RESEND_API_KEY).");
  }

  const digestRecipients = resolveSalesmanVisitPlanDigestRecipients(env);
  const results = [];
  const plans = Array.isArray(payload?.plans) ? payload.plans : [];

  if (digestRecipients.length) {
    const digest = buildSalesmanVisitPlanDigestEmail(plans, {
      reportDate: payload.reportDate,
      previewOnly,
    });
    try {
      await sendEmail({
        to: digestRecipients,
        subject: digest.subject,
        html: digest.html,
        text: digest.text,
      });
      results.push({ type: "digest", ok: true, to: digestRecipients });
    } catch (error) {
      results.push({ type: "digest", ok: false, to: digestRecipients, error: String(error?.message || error) });
    }
  }

  if (sendToUsers) {
    for (const plan of plans) {
      const to = normalizeDeliverableEmail(plan.email);
      if (!to) {
        results.push({
          type: "salesman",
          ok: false,
          salesmanCode: plan.salesmanCode,
          error: "No deliverable report email",
        });
        continue;
      }
      const message = buildSalesmanVisitPlanEmail(plan, {
        reportDate: payload.reportDate,
        previewOnly: false,
      });
      try {
        await sendEmail({
          to: [to],
          cc: digestRecipients.filter((email) => email !== to),
          subject: message.subject,
          html: message.html,
          text: message.text,
        });
        results.push({ type: "salesman", ok: true, salesmanCode: plan.salesmanCode, to: [to] });
      } catch (error) {
        results.push({
          type: "salesman",
          ok: false,
          salesmanCode: plan.salesmanCode,
          error: String(error?.message || error),
        });
      }
    }
  } else if (forcePreview && normalizeCode(salesmanCode) && plans[0]) {
    const plan = plans[0];
    const message = buildSalesmanVisitPlanEmail(plan, {
      reportDate: payload.reportDate,
      previewOnly: true,
    });
    try {
      await sendEmail({
        to: digestRecipients,
        subject: `[Preview] ${message.subject}`,
        html: message.html,
        text: message.text,
      });
      results.push({
        type: "salesman_preview",
        ok: true,
        salesmanCode: plan.salesmanCode,
        to: digestRecipients,
        label: salesmanVisitPlanDisplayName(plan),
      });
    } catch (error) {
      results.push({
        type: "salesman_preview",
        ok: false,
        salesmanCode: plan.salesmanCode,
        error: String(error?.message || error),
      });
    }
  }

  const failedCount = results.filter((row) => !row.ok).length;
  return {
    skipped: false,
    previewOnly,
    sendToUsers,
    reportDate: payload.reportDate,
    salesmanCount: payload.salesmanCount,
    visitCount: payload.visitCount,
    sentCount: results.filter((row) => row.ok).length,
    failedCount,
    results,
  };
}
