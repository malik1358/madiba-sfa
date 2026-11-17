import { resolveAppOrigin } from "./inactivityEmail.js";
import { isLikelyEmail, parseEmailList } from "./mailer.js";

export const INTER_CITY_STOCK_EMAIL_KEY_PREFIX = "inter_city_stock_email:";
export const DEFAULT_INTER_CITY_STOCK_EMAIL_TO = "malik@pinasz.com";

const HEADER_BG = "#0f4c5c";
const ZEBRA = "#f4f8f9";
const MAX_ROWS_PER_SECTION = 80;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatQty(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return "0";
  return amount.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

function formatDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text || "-";
  const [year, month, day] = text.split("-");
  return `${day}/${month}/${year}`;
}

export function interCityStockEmailClaimKey(date) {
  return `${INTER_CITY_STOCK_EMAIL_KEY_PREFIX}${String(date || "").trim().slice(0, 10)}`;
}

export function interCityStockEmailRecipients(env = {}) {
  const testTo = String(env.INTER_CITY_STOCK_EMAIL_TEST_TO || "").trim();
  const override = String(env.INTER_CITY_STOCK_EMAIL_TO || "").trim();
  const list = parseEmailList(testTo || override || DEFAULT_INTER_CITY_STOCK_EMAIL_TO)
    .filter((email) => isLikelyEmail(email));
  return [...new Set(list)];
}

export function interCityStockEmailCc(env = {}) {
  return parseEmailList(env.INTER_CITY_STOCK_EMAIL_CC || "")
    .filter((email) => isLikelyEmail(email));
}

const SECTIONS = [
  {
    key: "dammamToRiyadh",
    title: "In Dammam, not in Riyadh",
    sourceLabel: "Dammam CTN",
    destLabel: "Riyadh CTN",
  },
  {
    key: "riyadhToDammam",
    title: "In Riyadh, not in Dammam",
    sourceLabel: "Riyadh CTN",
    destLabel: "Dammam CTN",
  },
  {
    key: "riyadhToStore",
    title: "In Riyadh warehouse, not in Store",
    sourceLabel: "Riyadh WH CTN",
    destLabel: "Store CTN",
  },
];

function sectionRows(report, key) {
  const rows = report?.directions?.[key]?.rows;
  return Array.isArray(rows) ? rows : [];
}

function renderSectionTable(section, rows) {
  const shown = rows.slice(0, MAX_ROWS_PER_SECTION);
  const omitted = Math.max(0, rows.length - shown.length);
  if (!shown.length) {
    return `
      <h2 style="margin:28px 0 8px;font-size:16px;color:${HEADER_BG};">${escapeHtml(section.title)}</h2>
      <p style="margin:0 0 12px;color:#64748b;font-size:13px;">No catalogue items in this gap on the latest end-of-day stock.</p>
    `;
  }

  const body = shown.map((row, index) => {
    const bg = index % 2 === 1 ? ZEBRA : "#ffffff";
    const unit = String(row.unit || "CTN").trim() || "CTN";
    return `
      <tr style="background:${bg};">
        <td style="padding:6px 8px;border:1px solid #dbe4ea;font-family:ui-monospace,monospace;">${escapeHtml(row.itemCode)}</td>
        <td style="padding:6px 8px;border:1px solid #dbe4ea;">${escapeHtml(row.itemName || "")}</td>
        <td style="padding:6px 8px;border:1px solid #dbe4ea;text-align:right;">${escapeHtml(formatQty(row.sourceQty))} ${escapeHtml(unit)}</td>
        <td style="padding:6px 8px;border:1px solid #dbe4ea;text-align:right;">${escapeHtml(formatQty(row.destinationQty))} ${escapeHtml(unit)}</td>
        <td style="padding:6px 8px;border:1px solid #dbe4ea;text-align:right;font-weight:600;">${escapeHtml(formatQty(row.suggestedQty))} ${escapeHtml(unit)}</td>
      </tr>
    `;
  }).join("");

  return `
    <h2 style="margin:28px 0 8px;font-size:16px;color:${HEADER_BG};">${escapeHtml(section.title)} · ${rows.length} items</h2>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead>
        <tr style="background:${HEADER_BG};color:#ffffff;">
          <th align="left" style="padding:8px;border:1px solid ${HEADER_BG};">Item code</th>
          <th align="left" style="padding:8px;border:1px solid ${HEADER_BG};">Item</th>
          <th align="right" style="padding:8px;border:1px solid ${HEADER_BG};">${escapeHtml(section.sourceLabel)}</th>
          <th align="right" style="padding:8px;border:1px solid ${HEADER_BG};">${escapeHtml(section.destLabel)}</th>
          <th align="right" style="padding:8px;border:1px solid ${HEADER_BG};">Suggested CTN</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
    ${omitted > 0
      ? `<p style="margin:6px 0 0;color:#64748b;font-size:12px;">Showing first ${MAX_ROWS_PER_SECTION} of ${rows.length}. Open the report for the full list.</p>`
      : ""}
  `;
}

export function buildInterCityStockEmail(report = {}, { date = "", env = process.env } = {}) {
  const origin = resolveAppOrigin(env);
  const reportUrl = `${origin}/management/inter-city-stock-transfer`;
  const stockDate = String(report.stockDate || "").trim();
  const summary = report.summary || {};
  const subject = [
    "Stock gaps (cartons)",
    formatDate(date || stockDate),
    `D→R ${Number(summary.dammamToRiyadhItems || 0)}`,
    `R→D ${Number(summary.riyadhToDammamItems || 0)}`,
    `R→Store ${Number(summary.riyadhToStoreItems || 0)}`,
  ].join(" · ");

  const sectionsHtml = SECTIONS.map((section) => (
    renderSectionTable(section, sectionRows(report, section.key))
  )).join("");

  const textLines = [
    `Stock gap digest · ${formatDate(date || stockDate)} (KSA)`,
    `EOD stock date: ${stockDate || "-"}`,
    `In Dammam not Riyadh: ${Number(summary.dammamToRiyadhItems || 0)} items`,
    `In Riyadh not Dammam: ${Number(summary.riyadhToDammamItems || 0)} items`,
    `In Riyadh warehouse not Store: ${Number(summary.riyadhToStoreItems || 0)} items`,
    `Quantities are cartons (master units) when a conversion exists.`,
    `Open report: ${reportUrl}`,
  ];

  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;color:#0f172a;line-height:1.45;max-width:960px;">
      <h1 style="margin:0 0 8px;font-size:20px;color:${HEADER_BG};">Daily stock gaps (cartons)</h1>
      <p style="margin:0 0 4px;color:#475569;font-size:13px;">
        EOD stock date ${escapeHtml(formatDate(stockDate))} · Report date ${escapeHtml(formatDate(date || stockDate))} (KSA)
      </p>
      <p style="margin:0 0 16px;color:#475569;font-size:13px;">
        Three gaps: Dammam not in Riyadh, Riyadh not in Dammam, and Riyadh warehouse not in Store (Dukan).
        Qty columns use cartons / master units when Item Master conversion exists.
      </p>
      <p style="margin:0 0 16px;font-size:13px;">
        <strong>Dammam→Riyadh:</strong> ${Number(summary.dammamToRiyadhItems || 0)}
        · <strong>Riyadh→Dammam:</strong> ${Number(summary.riyadhToDammamItems || 0)}
        · <strong>Riyadh→Store:</strong> ${Number(summary.riyadhToStoreItems || 0)}
        · Store stock items: ${Number(summary.storeStockItems || 0)}
      </p>
      ${sectionsHtml}
      <p style="margin:24px 0 0;font-size:13px;">
        <a href="${escapeHtml(reportUrl)}">Open Inter-city Stock Transfer</a>
      </p>
    </div>
  `;

  return {
    subject,
    text: textLines.join("\n"),
    html,
    counts: {
      dammamToRiyadhItems: Number(summary.dammamToRiyadhItems || 0),
      riyadhToDammamItems: Number(summary.riyadhToDammamItems || 0),
      riyadhToStoreItems: Number(summary.riyadhToStoreItems || 0),
      storeStockItems: Number(summary.storeStockItems || 0),
      stockDate,
    },
  };
}
