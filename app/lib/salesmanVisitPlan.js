import { buildCollectionPriority } from "./paymentCollections.js";
import { parseEmailList, isLikelyEmail, normalizeDeliverableEmail } from "./mailer.js";
import { escapeHtml } from "./dailyVisitReportEmail.js";
import { getKsaDateString } from "./workdayActivity.js";

export const DEFAULT_VISITS_PER_SALESMAN = 12;
export const DEFAULT_SALESMAN_VISIT_PLAN_EMAIL_TO = "malik@pinasz.com";
export const SALESMAN_VISIT_PLAN_SNAPSHOT_KEY = "salesman_visit_plan_snapshot_v1";

function envFlagEnabled(value, defaultValue = false) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return defaultValue;
  return raw !== "0" && raw !== "false" && raw !== "no";
}

/** Master switch for visit-plan email cycles (cron / bulk send). On after approval; set false to pause. */
export function isSalesmanVisitPlanEmailEnabled(env = process.env) {
  return envFlagEnabled(env.SALESMAN_VISIT_PLAN_EMAIL_ENABLED, true);
}

/** When true (and email enabled), each salesman receives their own plan. On after approval. */
export function isSalesmanVisitPlanSendToUsersEnabled(env = process.env) {
  return envFlagEnabled(env.SALESMAN_VISIT_PLAN_EMAIL_SEND_TO_USERS, true);
}

export function resolveSalesmanVisitPlanDigestRecipients(env = process.env) {
  const configured = parseEmailList(env.SALESMAN_VISIT_PLAN_EMAIL_TO);
  const defaults = parseEmailList(DEFAULT_SALESMAN_VISIT_PLAN_EMAIL_TO).filter((email) => isLikelyEmail(email));
  return [...new Set([...defaults, ...configured])];
}

function recomputePlanTotals(visits = []) {
  const totals = (visits || []).reduce((acc, visit) => {
    acc.combinedScore += Number(visit.combined_score || 0);
    acc.dueAmount += Number(visit.total_due_amount || 0);
    acc.recentSales += Number(visit.recent_sales_value || 0);
    if (visit.focus === "Both" || visit.focus === "Collection") acc.collectionVisits += 1;
    if (visit.focus === "Both" || visit.focus === "Sales") acc.salesVisits += 1;
    return acc;
  }, {
    combinedScore: 0,
    dueAmount: 0,
    recentSales: 0,
    collectionVisits: 0,
    salesVisits: 0,
  });
  return {
    ...totals,
    averageCombinedScore: visits.length ? Math.round(totals.combinedScore / visits.length) : 0,
  };
}

/** Serve a previously built midnight snapshot without recomputing scores. */
export function filterVisitPlanSnapshot(snapshot, {
  salesmanCode = "",
  limit = 0,
} = {}) {
  if (!snapshot || !Array.isArray(snapshot.plans)) {
    return {
      reportDate: "",
      builtAt: "",
      visitLimit: DEFAULT_VISITS_PER_SALESMAN,
      salesmanCount: 0,
      visitCount: 0,
      plans: [],
      warnings: [],
      fromSnapshot: false,
      missingSnapshot: true,
    };
  }

  const filterCode = normalizeCode(salesmanCode);
  let plans = filterCode
    ? snapshot.plans.filter((plan) => normalizeCode(plan.salesmanCode) === filterCode)
    : [...snapshot.plans];

  const visitLimit = Number(limit) > 0
    ? Math.max(1, Math.min(50, Number(limit)))
    : Number(snapshot.visitLimit || DEFAULT_VISITS_PER_SALESMAN);

  plans = plans.map((plan) => {
    const visits = (plan.visits || [])
      .slice(0, visitLimit)
      .map((visit, index) => ({ ...visit, rank: index + 1 }));
    return {
      ...plan,
      visitCount: visits.length,
      visits,
      totals: recomputePlanTotals(visits),
    };
  }).filter((plan) => plan.visitCount > 0);

  return {
    reportDate: snapshot.reportDate || "",
    builtAt: snapshot.builtAt || "",
    visitLimit,
    salesmanCount: plans.length,
    visitCount: plans.reduce((sum, plan) => sum + plan.visitCount, 0),
    plans,
    warnings: Array.isArray(snapshot.warnings) ? snapshot.warnings : [],
    fromSnapshot: true,
    missingSnapshot: false,
  };
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function probabilityLabel(score) {
  if (score >= 70) return "High";
  if (score >= 40) return "Medium";
  return "Low";
}

export function daysSinceDate(value, todayIso = new Date().toISOString()) {
  const today = String(todayIso || "").slice(0, 10);
  const date = String(value || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const ms = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

export function buildSalesOpportunityScore(row = {}) {
  const recentSales = Math.max(toNumber(row.recent_sales_value), 0);
  const daysSince = Math.max(
    toNumber(row.days_since_last_invoice != null ? row.days_since_last_invoice : 45),
    0,
  );
  const avgMonthly = Math.max(toNumber(row.average_monthly_purchase), 0);
  const highest = Math.max(toNumber(row.highest_monthly_sales), 0);

  let score = 0;

  if (recentSales >= 100000) score += 35;
  else if (recentSales >= 50000) score += 28;
  else if (recentSales >= 20000) score += 22;
  else if (recentSales >= 5000) score += 14;
  else if (recentSales > 0) score += 8;

  if (daysSince >= 20 && daysSince <= 45) score += 30;
  else if (daysSince > 45 && daysSince <= 75) score += 24;
  else if (daysSince > 75 && daysSince <= 120) score += 16;
  else if (daysSince > 14 && daysSince < 20) score += 12;
  else if (daysSince > 120) score += 8;
  else score += 4;

  if (avgMonthly >= 20000) score += 20;
  else if (avgMonthly >= 10000) score += 15;
  else if (avgMonthly >= 3000) score += 10;
  else if (avgMonthly > 0) score += 5;

  if (highest >= 50000) score += 15;
  else if (highest >= 20000) score += 10;
  else if (highest > 0) score += 5;

  return Math.max(0, Math.min(100, score));
}

export function buildCollectionOpportunityFromRow(row = {}, todayIso = new Date().toISOString()) {
  const totalDue = Math.max(
    toNumber(row.total_due_amount),
    toNumber(row.outstanding_0_30)
      + toNumber(row.outstanding_30_60)
      + toNumber(row.outstanding_61_90)
      + toNumber(row.outstanding_above_90),
  );
  if (totalDue <= 0 && !(Number(row.probability_score) > 0)) {
    return { score: 0, label: "N/A" };
  }

  if (Number(row.probability_score) > 0 || String(row.probability_label || "").trim()) {
    const score = Math.max(0, Math.min(100, toNumber(row.probability_score)));
    return {
      score,
      label: String(row.probability_label || "").trim() || probabilityLabel(score),
    };
  }

  return buildCollectionPriority({
    ...row,
    total_due_amount: totalDue,
    max_overdue_days: Math.max(
      toNumber(row.max_overdue_days),
      toNumber(row.outstanding_above_90) > 0 ? 100
        : toNumber(row.outstanding_61_90) > 0 ? 75
          : toNumber(row.outstanding_30_60) > 0 ? 45
            : toNumber(row.outstanding_0_30) > 0 ? 15
              : 0,
    ),
    due_invoice_count: Math.max(toNumber(row.due_invoice_count), totalDue > 0 ? 1 : 0),
    outstanding_cash: toNumber(row.outstanding_cash),
    today: String(todayIso).slice(0, 10),
  });
}

export function buildCombinedVisitScore(salesScore, collectionScore) {
  const sales = Math.max(0, Math.min(100, toNumber(salesScore)));
  const collection = Math.max(0, Math.min(100, toNumber(collectionScore)));
  const synergy = Math.min(sales, collection);
  return Math.round((0.42 * sales) + (0.42 * collection) + (0.16 * synergy));
}

export function resolveVisitFocus(salesScore, collectionScore) {
  const sales = toNumber(salesScore);
  const collection = toNumber(collectionScore);
  const salesStrong = sales >= 40;
  const collectionStrong = collection >= 40;
  if (salesStrong && collectionStrong) return "Both";
  if (collectionStrong && collection >= sales) return "Collection";
  if (salesStrong) return "Sales";
  if (collection > 0) return "Collection";
  return "Sales";
}

export function scoreVisitPlanCustomer(row = {}, todayIso = new Date().toISOString()) {
  const salesScore = buildSalesOpportunityScore(row);
  const collection = buildCollectionOpportunityFromRow(row, todayIso);
  const combinedScore = buildCombinedVisitScore(salesScore, collection.score);
  const focus = resolveVisitFocus(salesScore, collection.score);
  const totalOutstanding = Math.max(
    toNumber(row.total_due_amount),
    toNumber(row.outstanding_0_30)
      + toNumber(row.outstanding_30_60)
      + toNumber(row.outstanding_61_90)
      + toNumber(row.outstanding_above_90),
  );

  return {
    customer_code: normalizeCode(row.customer_code),
    customer_name: String(row.customer_name || "").trim(),
    salesman_code: normalizeCode(row.salesman_code || row.current_salesman_code),
    salesman_name: String(row.salesman_name || "").trim(),
    city: String(row.city || "").trim(),
    area: String(row.area || "").trim(),
    recent_sales_value: Math.max(toNumber(row.recent_sales_value), 0),
    average_monthly_purchase: Math.max(toNumber(row.average_monthly_purchase), 0),
    days_since_last_invoice: row.days_since_last_invoice == null
      ? daysSinceDate(row.latest_transaction_date || row.last_invoice_date, todayIso)
      : Math.max(0, toNumber(row.days_since_last_invoice)),
    total_due_amount: totalOutstanding,
    sales_score: salesScore,
    sales_label: probabilityLabel(salesScore),
    collection_score: collection.score,
    collection_label: collection.label,
    combined_score: combinedScore,
    combined_label: probabilityLabel(combinedScore),
    focus,
  };
}

export function rankSalesmanVisitPlan(customers = [], {
  limit = DEFAULT_VISITS_PER_SALESMAN,
  todayIso = new Date().toISOString(),
} = {}) {
  const scored = (customers || [])
    .map((row) => scoreVisitPlanCustomer(row, todayIso))
    .filter((row) => row.customer_code && (row.sales_score > 0 || row.collection_score > 0))
    .sort((left, right) => {
      const byCombined = right.combined_score - left.combined_score;
      if (byCombined !== 0) return byCombined;
      const byDue = right.total_due_amount - left.total_due_amount;
      if (byDue !== 0) return byDue;
      const bySales = right.recent_sales_value - left.recent_sales_value;
      if (bySales !== 0) return bySales;
      return String(left.customer_name || left.customer_code).localeCompare(
        String(right.customer_name || right.customer_code),
      );
    });

  const capped = Math.max(1, Math.min(50, Number(limit) || DEFAULT_VISITS_PER_SALESMAN));
  return scored.slice(0, capped).map((row, index) => ({
    ...row,
    rank: index + 1,
  }));
}

export function salesmanVisitPlanDisplayName(plan = {}) {
  const name = String(plan.salesmanName || plan.salesman_name || "").trim();
  const code = String(plan.salesmanCode || plan.salesman_code || "").trim();
  if (name && code) return `${name} (${code})`;
  return name || code || "Unknown salesman";
}

export function groupVisitPlansBySalesman(customers = [], {
  limit = DEFAULT_VISITS_PER_SALESMAN,
  todayIso = new Date().toISOString(),
  salesmanProfiles = [],
} = {}) {
  const profileByCode = new Map();
  (salesmanProfiles || []).forEach((profile) => {
    const code = normalizeCode(profile?.salesman_code || profile?.salesmanCode);
    if (!code) return;
    profileByCode.set(code, profile);
  });

  const bySalesman = new Map();
  (customers || []).forEach((row) => {
    const code = normalizeCode(row.salesman_code || row.current_salesman_code);
    if (!code) return;
    if (!bySalesman.has(code)) bySalesman.set(code, []);
    bySalesman.get(code).push(row);
  });

  const plans = [...bySalesman.entries()].map(([salesmanCode, rows]) => {
    const profile = profileByCode.get(salesmanCode) || {};
    const visits = rankSalesmanVisitPlan(rows, { limit, todayIso });
    const totals = visits.reduce((acc, visit) => {
      acc.combinedScore += visit.combined_score;
      acc.dueAmount += visit.total_due_amount;
      acc.recentSales += visit.recent_sales_value;
      if (visit.focus === "Both" || visit.focus === "Collection") acc.collectionVisits += 1;
      if (visit.focus === "Both" || visit.focus === "Sales") acc.salesVisits += 1;
      return acc;
    }, {
      combinedScore: 0,
      dueAmount: 0,
      recentSales: 0,
      collectionVisits: 0,
      salesVisits: 0,
    });

    return {
      salesmanCode,
      salesmanName: String(profile.salesman_name || profile.salesmanName || rows[0]?.salesman_name || "").trim(),
      email: normalizeDeliverableEmail(profile.report_email || profile.reportEmail || profile.email),
      userId: String(profile.id || profile.userId || "").trim(),
      visitCount: visits.length,
      visits,
      totals: {
        ...totals,
        averageCombinedScore: visits.length ? Math.round(totals.combinedScore / visits.length) : 0,
      },
    };
  }).filter((plan) => plan.visitCount > 0);

  plans.sort((left, right) => {
    const byAvg = right.totals.averageCombinedScore - left.totals.averageCombinedScore;
    if (byAvg !== 0) return byAvg;
    return salesmanVisitPlanDisplayName(left).localeCompare(salesmanVisitPlanDisplayName(right));
  });

  return plans;
}

function formatMoney(value) {
  const number = toNumber(value);
  return number.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function scoreCellStyle(label) {
  const normalized = String(label || "").trim().toLowerCase();
  if (normalized === "high") return "background:#dcfce7;color:#166534;font-weight:700;";
  if (normalized === "medium") return "background:#fef9c3;color:#854d0e;font-weight:700;";
  if (normalized === "low") return "background:#fee2e2;color:#991b1b;font-weight:700;";
  return "background:#f8fafc;color:#334155;";
}

function focusCellStyle(focus) {
  const normalized = String(focus || "").trim().toLowerCase();
  if (normalized === "both") return "background:#dbeafe;color:#1e40af;font-weight:700;";
  if (normalized === "collection") return "background:#fff4d6;color:#92400e;font-weight:700;";
  return "background:#e8f7ee;color:#166534;font-weight:700;";
}

export function buildSalesmanVisitPlanEmail(plan, {
  reportDate = getKsaDateString(),
  previewOnly = false,
} = {}) {
  const titleName = salesmanVisitPlanDisplayName(plan);
  const visits = Array.isArray(plan?.visits) ? plan.visits : [];
  const rowsHtml = visits.map((visit, index) => {
    const rowBg = index % 2 === 0 ? "#ffffff" : "#eef6fb";
    return `<tr style="background:${rowBg};">
      <td style="border:1px solid #c5d4de;padding:6px;text-align:center;">${escapeHtml(visit.rank)}</td>
      <td style="border:1px solid #c5d4de;padding:6px;">${escapeHtml(visit.customer_name || "-")}<br/><span style="color:#64748b;font-size:12px;">${escapeHtml(visit.customer_code || "")}</span></td>
      <td style="border:1px solid #c5d4de;padding:6px;">${escapeHtml([visit.city, visit.area].filter(Boolean).join(" / ") || "-")}</td>
      <td style="border:1px solid #c5d4de;padding:6px;text-align:center;${focusCellStyle(visit.focus)}">${escapeHtml(visit.focus)}</td>
      <td style="border:1px solid #c5d4de;padding:6px;text-align:center;${scoreCellStyle(visit.combined_label)}">${escapeHtml(visit.combined_score)} · ${escapeHtml(visit.combined_label)}</td>
      <td style="border:1px solid #c5d4de;padding:6px;text-align:center;${scoreCellStyle(visit.sales_label)}">${escapeHtml(visit.sales_score)} · ${escapeHtml(visit.sales_label)}</td>
      <td style="border:1px solid #c5d4de;padding:6px;text-align:center;${scoreCellStyle(visit.collection_label)}">${escapeHtml(visit.collection_score)} · ${escapeHtml(visit.collection_label)}</td>
      <td style="border:1px solid #c5d4de;padding:6px;text-align:right;">${escapeHtml(formatMoney(visit.recent_sales_value))}</td>
      <td style="border:1px solid #c5d4de;padding:6px;text-align:right;">${escapeHtml(formatMoney(visit.total_due_amount))}</td>
      <td style="border:1px solid #c5d4de;padding:6px;text-align:center;">${escapeHtml(visit.days_since_last_invoice == null ? "-" : visit.days_since_last_invoice)}</td>
    </tr>`;
  }).join("");

  const previewBanner = previewOnly
    ? `<p style="background:#fff7ed;border:1px solid #fdba74;color:#9a3412;padding:10px 12px;border-radius:8px;"><strong>Admin preview</strong> — salesman copies and scheduled email are disabled until you approve them.</p>`
    : "";

  const subject = `Visit plan · ${titleName} · ${reportDate}`;
  const html = `<!DOCTYPE html>
<html>
<body style="font-family:Segoe UI,Arial,sans-serif;color:#0f172a;background:#f8fafc;padding:16px;">
  <div style="max-width:960px;margin:0 auto;background:#ffffff;border:1px solid #dbe3ea;border-radius:12px;overflow:hidden;">
    <div style="background:#0f4c5c;color:#ffffff;padding:16px 20px;">
      <h1 style="margin:0;font-size:20px;">Highest-probability visit plan</h1>
      <p style="margin:6px 0 0;opacity:0.9;">${escapeHtml(titleName)} · ${escapeHtml(reportDate)}</p>
    </div>
    <div style="padding:16px 20px;">
      ${previewBanner}
      <p style="margin:0 0 12px;">Recommended stops ranked for sales opportunity and collection probability. Aim for both where the focus is <strong>Both</strong>.</p>
      <p style="margin:0 0 16px;color:#475569;">
        Visits: <strong>${escapeHtml(visits.length)}</strong>
        · Avg combined: <strong>${escapeHtml(plan?.totals?.averageCombinedScore ?? 0)}</strong>
        · Due on plan: <strong>${escapeHtml(formatMoney(plan?.totals?.dueAmount || 0))}</strong>
        · Recent 6M sales on plan: <strong>${escapeHtml(formatMoney(plan?.totals?.recentSales || 0))}</strong>
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#0f4c5c;color:#ffffff;">
            <th style="border:1px solid #0c3d4a;padding:8px;">#</th>
            <th style="border:1px solid #0c3d4a;padding:8px;">Customer</th>
            <th style="border:1px solid #0c3d4a;padding:8px;">City / Area</th>
            <th style="border:1px solid #0c3d4a;padding:8px;">Focus</th>
            <th style="border:1px solid #0c3d4a;padding:8px;">Combined</th>
            <th style="border:1px solid #0c3d4a;padding:8px;">Sales</th>
            <th style="border:1px solid #0c3d4a;padding:8px;">Collection</th>
            <th style="border:1px solid #0c3d4a;padding:8px;">Recent 6M</th>
            <th style="border:1px solid #0c3d4a;padding:8px;">Due</th>
            <th style="border:1px solid #0c3d4a;padding:8px;">Days since invoice</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || `<tr><td colspan="10" style="padding:12px;border:1px solid #c5d4de;">No recommended visits.</td></tr>`}
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>`;

  const textLines = [
    `Highest-probability visit plan — ${titleName} — ${reportDate}`,
    previewOnly ? "Admin preview only — salesman email disabled until approved." : "",
    `Visits: ${visits.length}; avg combined ${plan?.totals?.averageCombinedScore ?? 0}`,
    "",
    ...visits.map((visit) => [
      `${visit.rank}. ${visit.customer_name || visit.customer_code} (${visit.customer_code})`,
      `  Focus ${visit.focus}; combined ${visit.combined_score} ${visit.combined_label}`,
      `  Sales ${visit.sales_score}; collection ${visit.collection_score}; due ${formatMoney(visit.total_due_amount)}`,
    ].join("\n")),
  ].filter(Boolean);

  return {
    subject,
    html,
    text: textLines.join("\n"),
  };
}

export function buildSalesmanVisitPlanDigestEmail(plans = [], {
  reportDate = getKsaDateString(),
  previewOnly = true,
} = {}) {
  const list = Array.isArray(plans) ? plans : [];
  const rowsHtml = list.map((plan, index) => {
    const rowBg = index % 2 === 0 ? "#ffffff" : "#eef6fb";
    return `<tr style="background:${rowBg};">
      <td style="border:1px solid #c5d4de;padding:6px;">${escapeHtml(salesmanVisitPlanDisplayName(plan))}</td>
      <td style="border:1px solid #c5d4de;padding:6px;text-align:right;">${escapeHtml(plan.visitCount || 0)}</td>
      <td style="border:1px solid #c5d4de;padding:6px;text-align:right;">${escapeHtml(plan.totals?.averageCombinedScore || 0)}</td>
      <td style="border:1px solid #c5d4de;padding:6px;text-align:right;">${escapeHtml(formatMoney(plan.totals?.dueAmount || 0))}</td>
      <td style="border:1px solid #c5d4de;padding:6px;text-align:right;">${escapeHtml(formatMoney(plan.totals?.recentSales || 0))}</td>
      <td style="border:1px solid #c5d4de;padding:6px;text-align:right;">${escapeHtml(plan.totals?.salesVisits || 0)}</td>
      <td style="border:1px solid #c5d4de;padding:6px;text-align:right;">${escapeHtml(plan.totals?.collectionVisits || 0)}</td>
    </tr>`;
  }).join("");

  const subject = `Visit plan digest · ${list.length} salesmen · ${reportDate}`;
  const previewBanner = previewOnly
    ? `<p style="background:#fff7ed;border:1px solid #fdba74;color:#9a3412;padding:10px 12px;border-radius:8px;"><strong>Admin preview digest</strong> — per-salesman email is off until approved.</p>`
    : "";

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:Segoe UI,Arial,sans-serif;color:#0f172a;background:#f8fafc;padding:16px;">
  <div style="max-width:900px;margin:0 auto;background:#ffffff;border:1px solid #dbe3ea;border-radius:12px;overflow:hidden;">
    <div style="background:#0f4c5c;color:#ffffff;padding:16px 20px;">
      <h1 style="margin:0;font-size:20px;">Salesman visit plan digest</h1>
      <p style="margin:6px 0 0;opacity:0.9;">${escapeHtml(reportDate)}</p>
    </div>
    <div style="padding:16px 20px;">
      ${previewBanner}
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#0f4c5c;color:#ffffff;">
            <th style="border:1px solid #0c3d4a;padding:8px;">Salesman</th>
            <th style="border:1px solid #0c3d4a;padding:8px;">Visits</th>
            <th style="border:1px solid #0c3d4a;padding:8px;">Avg combined</th>
            <th style="border:1px solid #0c3d4a;padding:8px;">Due on plan</th>
            <th style="border:1px solid #0c3d4a;padding:8px;">Recent 6M</th>
            <th style="border:1px solid #0c3d4a;padding:8px;">Sales focus</th>
            <th style="border:1px solid #0c3d4a;padding:8px;">Collection focus</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || `<tr><td colspan="7" style="padding:12px;border:1px solid #c5d4de;">No salesman plans.</td></tr>`}
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>`;

  return {
    subject,
    html,
    text: [
      `Salesman visit plan digest — ${reportDate}`,
      ...list.map((plan) => `${salesmanVisitPlanDisplayName(plan)}: ${plan.visitCount} visits, avg ${plan.totals?.averageCombinedScore || 0}`),
    ].join("\n"),
  };
}
