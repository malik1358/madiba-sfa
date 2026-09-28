import { isFarFromCustomer } from "./customerLocation.js";
import { resolveAppOrigin } from "./inactivityEmail.js";
import { isLikelyEmail, parseEmailList } from "./mailer.js";
import { getCollectionSalesmanLabel, sumCollectionReceivedInLastDays } from "./paymentCollections.js";
import { addKsaCalendarDays, getKsaDateString } from "./workdayActivity.js";

export const COLLECTION_STALE_OVERDUE_EMAIL_LAST_SENT_KEY = "collection_stale_overdue_email_last_sent";
export const DEFAULT_COLLECTION_STALE_OVERDUE_EMAIL_TO = "malik@pinasz.com";
export const DEFAULT_COLLECTION_STALE_OVERDUE_EMAIL_CC = [
  "soyeb@noorshukran.com",
  "fazlur.rahiman@noorshukran.com",
];
export const COLLECTION_STALE_OVERDUE_MIN_VISIT_AGE_DAYS = 7;
export const COLLECTION_STALE_OVERDUE_RECEIPT_LOOKBACK_DAYS = 8;
export const COLLECTION_STALE_OVERDUE_DEFAULT_AGING_DAYS = 60;
export const COLLECTION_STALE_OVERDUE_SOFT_AGING_DAYS = 30;
export const COLLECTION_STALE_OVERDUE_SOFT_AGING_SALESMEN = ["PARVEZ", "JUNAID"];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function mergeEmailList(defaults, extraValue) {
  const extras = parseEmailList(extraValue);
  const base = (defaults || [])
    .flatMap((value) => parseEmailList(value))
    .filter((email) => isLikelyEmail(email));
  return [...new Set([...base, ...extras])];
}

export function comparableSalesmanIdentity(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function collectSalesmanIdentities(source = {}) {
  const identities = new Set();
  [
    source?.salesman_code,
    source?.salesman_name,
    source?.current_salesman_code,
    source?.userName,
    getCollectionSalesmanLabel(source),
  ].forEach((value) => {
    const comparable = comparableSalesmanIdentity(value);
    if (!comparable) return;
    identities.add(comparable);
    comparable.split(/\s+/).forEach((token) => {
      if (token.length >= 3) identities.add(token);
    });
    const parenthetical = String(value || "").match(/\(([^)]+)\)/);
    if (parenthetical) {
      const alias = comparableSalesmanIdentity(parenthetical[1]);
      if (alias) identities.add(alias);
    }
  });
  return identities;
}

export function isSoftAgingSalesman(source = {}) {
  const identities = collectSalesmanIdentities(source);
  return COLLECTION_STALE_OVERDUE_SOFT_AGING_SALESMEN.some((name) => identities.has(name));
}

export function resolveOverdueAgingThresholdDays(source = {}) {
  return isSoftAgingSalesman(source)
    ? COLLECTION_STALE_OVERDUE_SOFT_AGING_DAYS
    : COLLECTION_STALE_OVERDUE_DEFAULT_AGING_DAYS;
}

export function resolveCollectionStaleOverdueDigestRecipients(env = process.env) {
  const configured = mergeEmailList([], env.COLLECTION_STALE_OVERDUE_EMAIL_TO);
  if (configured.length) return configured;
  return [DEFAULT_COLLECTION_STALE_OVERDUE_EMAIL_TO];
}

export function resolveCollectionStaleOverdueDigestCc(env = process.env, to = []) {
  const recipients = new Set((to || []).map((email) => String(email || "").trim().toLowerCase()));
  return mergeEmailList(DEFAULT_COLLECTION_STALE_OVERDUE_EMAIL_CC, env.COLLECTION_STALE_OVERDUE_EMAIL_CC)
    .filter((email) => !recipients.has(email));
}

export function overdueOver60Amount(row = {}) {
  return Number(row?.outstanding_61_90 || 0)
    + Number(row?.outstanding_91_120 || 0)
    + Number(row?.outstanding_above_120 || 0);
}

export function overdueAboveThresholdAmount(row = {}, thresholdDays = COLLECTION_STALE_OVERDUE_DEFAULT_AGING_DAYS) {
  const over60 = overdueOver60Amount(row);
  if (Number(thresholdDays) <= 30) {
    return Number(row?.outstanding_30_60 || 0) + over60;
  }
  return over60;
}

export function resolveReceivedInLookbackDays(row = {}, {
  todayIso = new Date().toISOString(),
  days = COLLECTION_STALE_OVERDUE_RECEIPT_LOOKBACK_DAYS,
} = {}) {
  const history = Array.isArray(row?.collection_history)
    ? row.collection_history
    : (row?.latest_collection ? [row.latest_collection] : []);
  return sumCollectionReceivedInLastDays(history, { todayIso, days });
}

export function resolveLastCollectionVisitDateKey(row = {}) {
  const savedAt = row?.latest_collection?.saved_at;
  if (!savedAt) return "";
  const parsed = new Date(savedAt);
  if (Number.isNaN(parsed.getTime())) return "";
  return getKsaDateString(parsed);
}

export function isCollectionVisitOlderThanDays(row = {}, {
  todayKey = "",
  minAgeDays = COLLECTION_STALE_OVERDUE_MIN_VISIT_AGE_DAYS,
} = {}) {
  const today = String(todayKey || "").trim() || getKsaDateString();
  const visitKey = resolveLastCollectionVisitDateKey(row);
  if (!visitKey) return true;
  const cutoff = addKsaCalendarDays(today, -Math.max(1, Number(minAgeDays) || 7));
  return visitKey < cutoff;
}

export function resolveNearVisitWithoutOrderDateKey(row = {}) {
  const raw = row?.last_near_visit_without_order_at
    || (
      row?.last_visit_without_order_is_far
        ? ""
        : (row?.last_visit_without_order_at || row?.last_visit_without_order_date || row?.visit_without_order_at || "")
    );
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(raw).trim())) return String(raw).trim();
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return getKsaDateString(parsed);
}

export function isVisitWithoutOrderOlderThanDays(row = {}, {
  todayKey = "",
  minAgeDays = COLLECTION_STALE_OVERDUE_MIN_VISIT_AGE_DAYS,
} = {}) {
  const today = String(todayKey || "").trim() || getKsaDateString();
  const visitKey = resolveNearVisitWithoutOrderDateKey(row);
  if (!visitKey) return true;
  const cutoff = addKsaCalendarDays(today, -Math.max(1, Number(minAgeDays) || 7));
  return visitKey < cutoff;
}

export function isCollectionVisitFar(row = {}) {
  const visit = row?.latest_collection;
  if (!visit) return false;
  return isFarFromCustomer(
    { latitude: visit.latitude, longitude: visit.longitude },
    { latitude: row?.latitude, longitude: row?.longitude },
  );
}

export function formatStaleVisitDateLabel(dateKey = "", isFar = false) {
  const key = String(dateKey || "").trim();
  if (!key) return "Never";
  return isFar ? `${key} FAR` : key;
}

export function isCollectionStaleOverdueRow(row = {}, {
  todayKey = "",
  todayIso = "",
  minVisitAgeDays = COLLECTION_STALE_OVERDUE_MIN_VISIT_AGE_DAYS,
  receiptLookbackDays = COLLECTION_STALE_OVERDUE_RECEIPT_LOOKBACK_DAYS,
  agingThresholdDays = null,
} = {}) {
  const today = String(todayKey || "").trim() || getKsaDateString();
  const threshold = agingThresholdDays == null
    ? resolveOverdueAgingThresholdDays(row)
    : Number(agingThresholdDays) || COLLECTION_STALE_OVERDUE_DEFAULT_AGING_DAYS;
  if (overdueAboveThresholdAmount(row, threshold) <= 0) return false;

  const asOfIso = String(todayIso || "").trim() || `${today}T12:00:00+03:00`;
  if (resolveReceivedInLookbackDays(row, { todayIso: asOfIso, days: receiptLookbackDays }) > 0) {
    return false;
  }
  // FAR visits do not count; only near visit-without-order age gates the row.
  return isVisitWithoutOrderOlderThanDays(row, { todayKey: today, minAgeDays: minVisitAgeDays });
}

export function filterCollectionStaleOverdueRows(rows = [], options = {}) {
  return (rows || []).filter((row) => isCollectionStaleOverdueRow(row, options));
}

export function collectionRowMatchesSalesmanProfile(row = {}, profile = {}) {
  const profileIds = collectSalesmanIdentities(profile);
  if (!profileIds.size) return false;
  const rowIds = collectSalesmanIdentities({
    salesman_code: row?.salesman_code || row?.current_salesman_code,
    salesman_name: getCollectionSalesmanLabel(row),
    current_salesman_code: row?.current_salesman_code,
  });
  for (const identity of rowIds) {
    if (profileIds.has(identity)) return true;
  }
  return false;
}

export function filterCollectionStaleOverdueRowsForProfile(rows = [], profile = {}, options = {}) {
  const threshold = options.agingThresholdDays == null
    ? resolveOverdueAgingThresholdDays(profile)
    : options.agingThresholdDays;
  return (rows || [])
    .filter((row) => collectionRowMatchesSalesmanProfile(row, profile))
    .filter((row) => isCollectionStaleOverdueRow(row, {
      ...options,
      agingThresholdDays: threshold,
    }));
}

export function collectionStaleOverdueGroupKey(row = {}) {
  const code = String(row?.salesman_code || row?.current_salesman_code || "").trim().toUpperCase();
  if (code) return `code:${code}`;
  const name = String(getCollectionSalesmanLabel(row) || "").trim().toUpperCase();
  if (name) return `name:${name}`;
  return "unknown";
}

export function collectionStaleOverdueSalesmanDisplay(row = {}) {
  return String(getCollectionSalesmanLabel(row) || "").trim() || "Unknown salesman";
}

export function groupCollectionStaleOverdueBySalesman(rows = []) {
  const groups = new Map();
  (rows || []).forEach((row) => {
    const key = collectionStaleOverdueGroupKey(row);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        salesmanName: collectionStaleOverdueSalesmanDisplay(row),
        rows: [],
      });
    }
    groups.get(key).rows.push(row);
  });

  return [...groups.values()]
    .map((group) => ({
      ...group,
      rows: [...group.rows].sort((left, right) => (
        overdueAboveThresholdAmount(right, resolveOverdueAgingThresholdDays(right))
          - overdueAboveThresholdAmount(left, resolveOverdueAgingThresholdDays(left))
        || Number(right?.total_due_amount || 0) - Number(left?.total_due_amount || 0)
        || String(left?.customer_name || "").localeCompare(String(right?.customer_name || ""))
      )),
    }))
    .sort((left, right) => left.salesmanName.localeCompare(right.salesmanName));
}

export function formatCollectionMoney(value) {
  if (value == null || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function agingBucketLabel(thresholdDays = COLLECTION_STALE_OVERDUE_DEFAULT_AGING_DAYS) {
  return Number(thresholdDays) <= 30 ? "Over 30" : "Over 60";
}

export function resolveLastVisitWithoutOrderDateKey(row = {}) {
  const raw = row?.last_visit_without_order_at
    || row?.last_visit_without_order_date
    || row?.visit_without_order_at
    || "";
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(raw).trim())) return String(raw).trim();
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return getKsaDateString(parsed);
}

export function buildCollectionStaleOverdueEmailRow(row = {}, {
  todayIso = "",
  todayKey = "",
  agingThresholdDays = null,
} = {}) {
  const code = String(row?.customer_code || "").trim();
  const name = String(row?.customer_name || "").trim();
  const customer = code && name ? `${code} — ${name}` : (code || name || "-");
  const visitKey = resolveLastCollectionVisitDateKey(row);
  const visitWithoutOrderKey = resolveLastVisitWithoutOrderDateKey(row);
  const collectionIsFar = isCollectionVisitFar(row);
  const visitWithoutOrderIsFar = Boolean(row?.last_visit_without_order_is_far);
  const threshold = agingThresholdDays == null
    ? resolveOverdueAgingThresholdDays(row)
    : Number(agingThresholdDays) || COLLECTION_STALE_OVERDUE_DEFAULT_AGING_DAYS;
  const today = String(todayKey || "").trim() || getKsaDateString();
  const asOfIso = String(todayIso || "").trim() || `${today}T12:00:00+03:00`;
  return {
    customer,
    customerCode: code || "-",
    customerName: name || "-",
    city: String(row?.city || "").trim() || "-",
    area: String(row?.area || "").trim() || "-",
    salesman: collectionStaleOverdueSalesmanDisplay(row),
    dueAmount: Number(row?.total_due_amount || 0) || 0,
    overdueAmount: overdueAboveThresholdAmount(row, threshold),
    agingLabel: agingBucketLabel(threshold),
    maxOverdueDays: Number(row?.max_overdue_days || 0) || 0,
    receivedLookbackDays: resolveReceivedInLookbackDays(row, {
      todayIso: asOfIso,
      days: COLLECTION_STALE_OVERDUE_RECEIPT_LOOKBACK_DAYS,
    }),
    lastVisitDate: formatStaleVisitDateLabel(visitKey, collectionIsFar),
    lastVisitIsFar: collectionIsFar && Boolean(visitKey),
    lastVisitWithoutOrderDate: formatStaleVisitDateLabel(visitWithoutOrderKey, visitWithoutOrderIsFar),
    lastVisitWithoutOrderIsFar: visitWithoutOrderIsFar && Boolean(visitWithoutOrderKey),
    lastOutcome: String(
      row?.latest_collection?.visit_outcome
      || row?.latest_collection?.payment_status
      || "",
    ).trim() || "-",
  };
}

export function summarizeCollectionStaleOverdueRows(rows = []) {
  return (rows || []).reduce(
    (totals, row) => {
      totals.customers += 1;
      totals.dueAmount += Number(row?.dueAmount || 0);
      totals.overdueAmount += Number(row?.overdueAmount || 0);
      return totals;
    },
    { customers: 0, dueAmount: 0, overdueAmount: 0 },
  );
}

function tableHeader(agingLabel = "Over 60") {
  return `<tr style="background:linear-gradient(90deg,#0f766e,#0f4c5c);background-color:#0f4c5c;color:#ffffff;">
    <th style="text-align:left;padding:10px 8px;border:1px solid #0a3a45;">Customer</th>
    <th style="text-align:left;padding:10px 8px;border:1px solid #0a3a45;">City / Area</th>
    <th style="text-align:right;padding:10px 8px;border:1px solid #0a3a45;">Due</th>
    <th style="text-align:right;padding:10px 8px;border:1px solid #0a3a45;">${escapeHtml(agingLabel)}</th>
    <th style="text-align:right;padding:10px 8px;border:1px solid #0a3a45;">Max overdue</th>
    <th style="text-align:right;padding:10px 8px;border:1px solid #0a3a45;">Recv ${COLLECTION_STALE_OVERDUE_RECEIPT_LOOKBACK_DAYS}d</th>
    <th style="text-align:left;padding:10px 8px;border:1px solid #0a3a45;">Last collection</th>
    <th style="text-align:left;padding:10px 8px;border:1px solid #0a3a45;">Last visit w/o order</th>
    <th style="text-align:left;padding:10px 8px;border:1px solid #0a3a45;">Last outcome</th>
  </tr>`;
}

function formatVisitDateHtml(label = "Never", isFar = false) {
  const text = String(label || "Never");
  if (!isFar || text === "Never") {
    return `<span style="color:#475569;">${escapeHtml(text)}</span>`;
  }
  const datePart = text.replace(/\s*FAR\s*$/i, "").trim() || text;
  return `<span style="color:#475569;">${escapeHtml(datePart)}</span> <span style="color:#b45309;font-weight:800;">FAR</span>`;
}

function tableRow(row, index) {
  const rowBg = index % 2 === 0 ? "#ffffff" : "#f0fdfa";
  return `<tr style="background:${rowBg};">
    <td style="border:1px solid #99f6e4;padding:8px;font-weight:700;color:#0f4c5c;">${escapeHtml(row.customer)}</td>
    <td style="border:1px solid #99f6e4;padding:8px;">${escapeHtml(`${row.city} / ${row.area}`)}</td>
    <td style="text-align:right;border:1px solid #99f6e4;padding:8px;">${escapeHtml(formatCollectionMoney(row.dueAmount))}</td>
    <td style="text-align:right;border:1px solid #99f6e4;padding:8px;font-weight:700;color:#b91c1c;">${escapeHtml(formatCollectionMoney(row.overdueAmount))}</td>
    <td style="text-align:right;border:1px solid #99f6e4;padding:8px;">${escapeHtml(String(row.maxOverdueDays))}</td>
    <td style="text-align:right;border:1px solid #99f6e4;padding:8px;">${escapeHtml(formatCollectionMoney(row.receivedLookbackDays))}</td>
    <td style="border:1px solid #99f6e4;padding:8px;">${formatVisitDateHtml(row.lastVisitDate, row.lastVisitIsFar)}</td>
    <td style="border:1px solid #99f6e4;padding:8px;">${formatVisitDateHtml(row.lastVisitWithoutOrderDate, row.lastVisitWithoutOrderIsFar)}</td>
    <td style="border:1px solid #99f6e4;padding:8px;color:#475569;">${escapeHtml(row.lastOutcome)}</td>
  </tr>`;
}

function totalRow(totals) {
  return `<tr style="background:#0f4c5c;color:#ffffff;font-weight:700;">
    <td style="padding:10px 8px;border:1px solid #0a3a45;" colspan="2">Total (${totals.customers} customer${totals.customers === 1 ? "" : "s"})</td>
    <td style="text-align:right;padding:10px 8px;border:1px solid #0a3a45;background:#0f766e;">${escapeHtml(formatCollectionMoney(totals.dueAmount))}</td>
    <td style="text-align:right;padding:10px 8px;border:1px solid #0a3a45;background:#b91c1c;">${escapeHtml(formatCollectionMoney(totals.overdueAmount))}</td>
    <td style="padding:10px 8px;border:1px solid #0a3a45;" colspan="5"></td>
  </tr>`;
}

function renderTable(rows, agingLabel = "Over 60") {
  const totals = summarizeCollectionStaleOverdueRows(rows);
  const body = rows.length
    ? rows.map((row, index) => tableRow(row, index)).join("")
    : `<tr><td colspan="9" style="border:1px solid #99f6e4;padding:12px;background:#fff7ed;color:#9a3412;">No matching customers.</td></tr>`;
  return `<table style="border-collapse: collapse; font-size: 13px; width: 100%; border:1px solid #99f6e4;">
    <thead>${tableHeader(agingLabel)}</thead>
    <tbody>${body}${rows.length ? totalRow(totals) : ""}</tbody>
  </table>`;
}

function summaryCards(totals, groupCount) {
  return `<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:0 0;margin:0 0 16px;">
  <tr>
    <td style="width:25%;padding:0 6px 0 0;vertical-align:top;">
      <div style="background:#ecfeff;border:1px solid #67e8f9;border-radius:10px;padding:12px;">
        <div style="font-size:11px;font-weight:700;color:#0e7490;text-transform:uppercase;letter-spacing:0.04em;">Customers</div>
        <div style="font-size:22px;font-weight:800;color:#155e75;margin-top:4px;">${escapeHtml(String(totals.customers))}</div>
      </div>
    </td>
    <td style="width:25%;padding:0 6px;vertical-align:top;">
      <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:10px;padding:12px;">
        <div style="font-size:11px;font-weight:700;color:#a16207;text-transform:uppercase;letter-spacing:0.04em;">Salesmen</div>
        <div style="font-size:22px;font-weight:800;color:#854d0e;margin-top:4px;">${escapeHtml(String(groupCount))}</div>
      </div>
    </td>
    <td style="width:25%;padding:0 6px;vertical-align:top;">
      <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:12px;">
        <div style="font-size:11px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.04em;">Due amount</div>
        <div style="font-size:18px;font-weight:800;color:#14532d;margin-top:4px;">${escapeHtml(formatCollectionMoney(totals.dueAmount))}</div>
      </div>
    </td>
    <td style="width:25%;padding:0 0 0 6px;vertical-align:top;">
      <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:12px;">
        <div style="font-size:11px;font-weight:700;color:#b91c1c;text-transform:uppercase;letter-spacing:0.04em;">Overdue filter</div>
        <div style="font-size:18px;font-weight:800;color:#7f1d1d;margin-top:4px;">${escapeHtml(formatCollectionMoney(totals.overdueAmount))}</div>
      </div>
    </td>
  </tr>
</table>`;
}

export function buildCollectionStaleOverdueSalesmanSection({
  salesmanName = "",
  sourceRows = [],
  todayKey = "",
  todayIso = "",
  agingThresholdDays = null,
} = {}) {
  const threshold = agingThresholdDays == null
    ? (sourceRows[0] ? resolveOverdueAgingThresholdDays(sourceRows[0]) : COLLECTION_STALE_OVERDUE_DEFAULT_AGING_DAYS)
    : Number(agingThresholdDays) || COLLECTION_STALE_OVERDUE_DEFAULT_AGING_DAYS;
  const rows = (sourceRows || []).map((row) => buildCollectionStaleOverdueEmailRow(row, {
    todayKey,
    todayIso,
    agingThresholdDays: threshold,
  }));
  const totals = summarizeCollectionStaleOverdueRows(rows);
  const agingLabel = agingBucketLabel(threshold);
  if (!rows.length) {
    return { html: "", text: "", customerCount: 0, totals, agingLabel };
  }

  const who = String(salesmanName || "").trim() || "Salesman";
  const html = `<div style="margin:18px 0 8px;">
    <h2 style="font-size:16px;margin:0 0 8px;color:#0f4c5c;">Stale overdue collections</h2>
    <p style="margin:0 0 10px;font-size:12px;color:#475569;">
      ${escapeHtml(who)} · ${escapeHtml(agingLabel)} days · no receipt in last ${COLLECTION_STALE_OVERDUE_RECEIPT_LOOKBACK_DAYS} days · last near visit w/o order older than ${COLLECTION_STALE_OVERDUE_MIN_VISIT_AGE_DAYS} days (FAR ignored)
    </p>
    <div style="margin:0 0 8px;">
      <span style="font-size:12px;font-weight:700;color:#0e7490;background:#ecfeff;border:1px solid #67e8f9;border-radius:999px;padding:4px 10px;">
        ${escapeHtml(String(totals.customers))} · ${escapeHtml(agingLabel)} ${escapeHtml(formatCollectionMoney(totals.overdueAmount))}
      </span>
    </div>
    ${renderTable(rows, agingLabel)}
  </div>`;

  const text = [
    `Stale overdue collections — ${who}`,
    `${agingLabel} days · recv ${COLLECTION_STALE_OVERDUE_RECEIPT_LOOKBACK_DAYS}d = 0 · near VWO > ${COLLECTION_STALE_OVERDUE_MIN_VISIT_AGE_DAYS}d (FAR ignored)`,
    `Customer | City/Area | Due | ${agingLabel} | Max overdue | Recv ${COLLECTION_STALE_OVERDUE_RECEIPT_LOOKBACK_DAYS}d | Last collection | Last visit w/o order | Last outcome`,
    ...rows.map((row) => [
      row.customer,
      `${row.city} / ${row.area}`,
      formatCollectionMoney(row.dueAmount),
      formatCollectionMoney(row.overdueAmount),
      row.maxOverdueDays,
      formatCollectionMoney(row.receivedLookbackDays),
      row.lastVisitDate,
      row.lastVisitWithoutOrderDate,
      row.lastOutcome,
    ].join(" | ")),
    `Total | ${totals.customers} customers | ${formatCollectionMoney(totals.dueAmount)} | ${formatCollectionMoney(totals.overdueAmount)}`,
    "",
  ].join("\n");

  return { html, text, customerCount: totals.customers, totals, agingLabel };
}

function renderSalesmanSections(groups, options = {}) {
  if (!groups.length) {
    return `<div style="padding:14px;border:1px solid #fed7aa;background:#fff7ed;border-radius:10px;color:#9a3412;">No customers match the stale overdue filters today.</div>`;
  }

  return groups.map((group) => {
    const section = buildCollectionStaleOverdueSalesmanSection({
      salesmanName: group.salesmanName,
      sourceRows: group.rows || [],
      todayKey: options.todayKey,
      todayIso: options.todayIso,
    });
    return section.html;
  }).join("");
}

function textSections(groups, options = {}) {
  if (!groups.length) return "No customers match the stale overdue filters today.";
  return groups.map((group) => buildCollectionStaleOverdueSalesmanSection({
    salesmanName: group.salesmanName,
    sourceRows: group.rows || [],
    todayKey: options.todayKey,
    todayIso: options.todayIso,
  }).text).join("\n");
}

export function buildCollectionStaleOverdueReportUrl(env = process.env) {
  const base = resolveAppOrigin(env).replace(/\/+$/, "");
  return `${base}/management/payment-collections`;
}

export function buildCollectionStaleOverdueEmail({
  date,
  groups = [],
  reportUrl = "",
  todayIso = "",
} = {}) {
  const allRows = groups.flatMap((group) => (
    (group.rows || []).map((row) => buildCollectionStaleOverdueEmailRow(row, {
      todayKey: date,
      todayIso,
    }))
  ));
  const totals = summarizeCollectionStaleOverdueRows(allRows);
  const subject = `Stale overdue collections ${date} — ${totals.customers} customers / ${groups.length} salesmen`;
  const link = String(reportUrl || "").trim();
  const intro = `Customers needing credit follow-up: outstanding older than 60 days (Parvez & Junaid: older than 30 days), no receipt in the last ${COLLECTION_STALE_OVERDUE_RECEIPT_LOOKBACK_DAYS} days, and last near visit without order older than ${COLLECTION_STALE_OVERDUE_MIN_VISIT_AGE_DAYS} days (or never). FAR visits are shown in the table but do not count as a fresh visit. One table per salesman.`;

  const html = `<div style="font-family: Arial, Helvetica, sans-serif; color: #0f172a; line-height: 1.5; background:#f8fafc; padding:16px;">
  <div style="max-width:1100px;margin:0 auto;background:#ffffff;border:1px solid #99f6e4;border-radius:14px;overflow:hidden;box-shadow:0 8px 24px rgba(15,76,92,0.12);">
    <div style="background:linear-gradient(135deg,#0f766e 0%,#0f4c5c 55%,#155e75 100%);background-color:#0f4c5c;padding:18px 20px;color:#ffffff;">
      <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;opacity:0.9;">MADIBA SFA</div>
      <h2 style="margin:6px 0 4px;font-size:22px;color:#ffffff;">Stale overdue collections</h2>
      <div style="font-size:14px;opacity:0.95;">${escapeHtml(date)}</div>
    </div>
    <div style="padding:18px 20px 8px;">
      <p style="margin:0 0 14px;color:#334155;">${escapeHtml(intro)}</p>
      ${summaryCards(totals, groups.length)}
      ${renderSalesmanSections(groups, { todayKey: date, todayIso })}
      ${link ? `<p style="margin:16px 0 0;"><a href="${escapeHtml(link)}" style="color:#0f766e;font-weight:700;">Open Payment Collections</a></p>` : ""}
      <p style="margin:16px 0 0; color: #64748b; font-size: 12px;">Daily digest for credit follow-up. Default To: malik@pinasz.com. CC: Soyeb and Fazlur.</p>
    </div>
  </div>
</div>`;

  const text = [
    `Stale overdue collections — ${date}`,
    intro,
    "",
    textSections(groups, { todayKey: date, todayIso }),
    link ? `Report: ${link}` : "",
  ].filter(Boolean).join("\n");

  return { subject, text, html, customerCount: totals.customers, totals, groupCount: groups.length };
}

export function parseCollectionStaleOverdueLastSent(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const lastSentAt = String(value.lastSentAt || value.asOf || "").trim();
    const date = String(value.date || value.lastSentDate || "").trim();
    return {
      date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "",
      lastSentAt: Number.isFinite(Date.parse(lastSentAt)) ? new Date(lastSentAt).toISOString() : "",
    };
  }

  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return { date: raw, lastSentAt: "" };
  }
  if (Number.isFinite(Date.parse(raw))) {
    return { date: "", lastSentAt: new Date(raw).toISOString() };
  }
  return { date: "", lastSentAt: "" };
}
