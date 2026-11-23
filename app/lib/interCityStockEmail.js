import * as XLSX from "xlsx";
import { resolveAppOrigin } from "./inactivityEmail.js";
import { isLikelyEmail, parseEmailList } from "./mailer.js";
import { WAREHOUSE_INVOICE_ILIYAS_EMAIL, WAREHOUSE_INVOICE_JAVED_EMAIL } from "./warehouseInvoiceRecipients.js";

export const INTER_CITY_STOCK_EMAIL_KEY_PREFIX = "inter_city_stock_email:";

/** Store / Dukan contact for warehouse↔Store digests (override with INTER_CITY_STOCK_EMAIL_STORE_TO). */
export const INTER_CITY_STOCK_EMAIL_VILYATH = "vilyath@noorshukran.com";

export const DEFAULT_INTER_CITY_STOCK_EMAIL_CC = [
  "fazlur.rahiman@noorshukran.com",
  "soyeb@noorshukran.com",
  "sohail.budhiya@noorshukran.com",
  "malik@pinasz.com",
];

export const INTER_CITY_STOCK_EMAIL_GROUPS = {
  dammamRiyadh: {
    key: "dammamRiyadh",
    label: "Dammam ↔ Riyadh",
    sectionKeys: ["dammamToRiyadh", "riyadhToDammam"],
    defaultTo: [WAREHOUSE_INVOICE_ILIYAS_EMAIL, WAREHOUSE_INVOICE_JAVED_EMAIL],
  },
  storeRiyadh: {
    key: "storeRiyadh",
    label: "Store ↔ Riyadh",
    sectionKeys: ["riyadhToStore", "storeToRiyadh"],
    defaultTo: [WAREHOUSE_INVOICE_ILIYAS_EMAIL, INTER_CITY_STOCK_EMAIL_VILYATH],
  },
};

const HEADER_BG = "#0f4c5c";
const ZEBRA = "#f4f8f9";
const MAX_ROWS_PER_SECTION = 80;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const SECTIONS = [
  {
    key: "dammamToRiyadh",
    title: "In Dammam, not in Riyadh",
    sheetName: "Dammam to Riyadh",
    sourceLabel: "Dammam qty",
    destLabel: "Riyadh qty",
    sourcePeakLabel: "Peak weekly (Dammam)",
    daysCoverSourceLabel: "Days cover left at Dammam",
    afterDestLabel: "After at Riyadh",
    remainSourceLabel: "Left at Dammam",
    daysCoverDestLabel: "Days cover after at Riyadh",
  },
  {
    key: "riyadhToDammam",
    title: "In Riyadh, not in Dammam",
    sheetName: "Riyadh to Dammam",
    sourceLabel: "Riyadh qty",
    destLabel: "Dammam qty",
    sourcePeakLabel: "Peak weekly (Riyadh)",
    daysCoverSourceLabel: "Days cover left at Riyadh",
    afterDestLabel: "After at Dammam",
    remainSourceLabel: "Left at Riyadh",
    daysCoverDestLabel: "Days cover after at Dammam",
  },
  {
    key: "riyadhToStore",
    title: "In Riyadh warehouse, not in Store",
    sheetName: "Riyadh to Store",
    sourceLabel: "Riyadh qty",
    destLabel: "Store qty",
    sourcePeakLabel: "Peak weekly (Riyadh)",
    daysCoverSourceLabel: "Days cover left at Riyadh",
    afterDestLabel: "After at Store",
    remainSourceLabel: "Left at Riyadh",
    daysCoverDestLabel: "Days cover after at Store",
  },
  {
    key: "storeToRiyadh",
    title: "In Store, not in Riyadh warehouse",
    sheetName: "Store to Riyadh",
    sourceLabel: "Store qty",
    destLabel: "Riyadh qty",
    sourcePeakLabel: "Peak weekly (Store)",
    daysCoverSourceLabel: "Days cover left at Store",
    afterDestLabel: "After at Riyadh",
    remainSourceLabel: "Left at Store",
    daysCoverDestLabel: "Days cover after at Riyadh",
  },
];

const SECTION_BY_KEY = Object.fromEntries(SECTIONS.map((section) => [section.key, section]));

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatQty(value) {
  if (value == null || value === "") return "";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  return amount.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

function formatCbm(value) {
  if (value == null || value === "") return "";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  return amount.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

function formatDaysCover(value) {
  if (value == null || value === "") return "";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  return amount.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function sectionTotalCbm(report, key, rows) {
  const stored = Number(report?.directions?.[key]?.totalCbm);
  if (Number.isFinite(stored)) return stored;
  return rows.reduce((total, row) => total + Number(row?.totalCbm || 0), 0);
}

function formatDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text || "-";
  const [year, month, day] = text.split("-");
  return `${day}/${month}/${year}`;
}

function mergeEmailList(defaults, extraValue) {
  const extras = parseEmailList(extraValue);
  const base = (defaults || [])
    .flatMap((value) => parseEmailList(value))
    .filter((email) => isLikelyEmail(email));
  return [...new Set([...base, ...extras])];
}

export function interCityStockEmailClaimKey(date) {
  return `${INTER_CITY_STOCK_EMAIL_KEY_PREFIX}${String(date || "").trim().slice(0, 10)}`;
}

/** @deprecated Prefer group recipients. */
export function interCityStockEmailRecipients(env = {}) {
  const testTo = String(env.INTER_CITY_STOCK_EMAIL_TEST_TO || "").trim();
  if (testTo) return parseEmailList(testTo).filter((email) => isLikelyEmail(email));
  const override = String(env.INTER_CITY_STOCK_EMAIL_TO || "").trim();
  if (override) return parseEmailList(override).filter((email) => isLikelyEmail(email));
  return mergeEmailList([
    ...INTER_CITY_STOCK_EMAIL_GROUPS.dammamRiyadh.defaultTo,
    ...INTER_CITY_STOCK_EMAIL_GROUPS.storeRiyadh.defaultTo,
  ]);
}

export function interCityStockEmailCc(env = {}) {
  const testTo = String(env.INTER_CITY_STOCK_EMAIL_TEST_TO || "").trim();
  if (testTo) return [];
  return mergeEmailList(DEFAULT_INTER_CITY_STOCK_EMAIL_CC, env.INTER_CITY_STOCK_EMAIL_CC);
}

export function interCityStockEmailGroupRecipients(groupKey, env = {}) {
  const testTo = String(env.INTER_CITY_STOCK_EMAIL_TEST_TO || "").trim();
  if (testTo) return parseEmailList(testTo).filter((email) => isLikelyEmail(email));

  const group = INTER_CITY_STOCK_EMAIL_GROUPS[groupKey];
  if (!group) return [];

  if (groupKey === "dammamRiyadh") {
    const override = String(env.INTER_CITY_STOCK_EMAIL_CITY_TO || env.INTER_CITY_STOCK_EMAIL_TO || "").trim();
    if (override) return parseEmailList(override).filter((email) => isLikelyEmail(email));
    return mergeEmailList(group.defaultTo);
  }

  const override = String(env.INTER_CITY_STOCK_EMAIL_STORE_TO || "").trim();
  if (override) return parseEmailList(override).filter((email) => isLikelyEmail(email));
  return mergeEmailList(group.defaultTo);
}

function sectionRows(report, key) {
  const rows = report?.directions?.[key]?.rows;
  return Array.isArray(rows) ? rows : [];
}

function suggestedNote(row) {
  if (row?.blockedBySourceReserve) return "Blocked: need 30 days at source";
  if (row?.cappedBySourceReserve) return "Capped: source keeps 30 days";
  if (row?.cappedBySource) return "Capped by source stock";
  if (row?.usedUnsoldMinimum) return "Min 5 (not sold yet)";
  return "";
}

function excelHeaders(section) {
  return [
    "Item code",
    "Item",
    "Unit",
    section.sourceLabel,
    section.destLabel,
    "Peak weekly (dest)",
    section.sourcePeakLabel,
    "Peak week",
    "Daily demand",
    "15-day target",
    "Suggested transfer",
    "Suggested note",
    section.afterDestLabel,
    section.remainSourceLabel,
    section.daysCoverDestLabel,
    section.daysCoverSourceLabel,
    "CBM / Ctn",
    "Total CBM",
  ];
}

function excelRow(section, row) {
  return [
    row.itemCode || "",
    row.itemName || "",
    row.unit || "",
    formatQty(row.sourceQty),
    formatQty(row.destinationQty),
    formatQty(row.peakWeeklyQty),
    formatQty(row.sourcePeakWeeklyQty),
    row.peakWeekKey || "",
    formatQty(row.dailyDemand),
    formatQty(row.targetCoverQty),
    formatQty(row.suggestedQty),
    suggestedNote(row),
    formatQty(row.afterAtDestination),
    formatQty(row.remainingAtSource),
    formatDaysCover(row.daysCoverAfterAtDestination ?? row.daysCoverAfter),
    formatDaysCover(row.daysCoverAfterAtSource),
    formatCbm(row.cbmPerCtn),
    formatCbm(row.totalCbm),
  ];
}

export function buildInterCityStockExcelAttachment(report = {}, { groupKey = "", date = "" } = {}) {
  const group = INTER_CITY_STOCK_EMAIL_GROUPS[groupKey];
  if (!group) return null;
  const workbook = XLSX.utils.book_new();
  let sheetCount = 0;
  group.sectionKeys.forEach((key) => {
    const section = SECTION_BY_KEY[key];
    if (!section) return;
    const rows = sectionRows(report, key);
    const aoa = [excelHeaders(section), ...rows.map((row) => excelRow(section, row))];
    const sheet = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(workbook, sheet, section.sheetName.slice(0, 31));
    sheetCount += 1;
  });
  if (!sheetCount) return null;
  const stamp = String(date || report.stockDate || "report").trim().slice(0, 10) || "report";
  const filename = `inter-city-stock-${group.key}-${stamp}.xlsx`;
  const content = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return { filename, content, contentType: XLSX_MIME };
}

function renderSectionTable(section, rows, totalCbm = 0) {
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
    const note = suggestedNote(row);
    return `
      <tr style="background:${bg};">
        <td style="padding:6px 8px;border:1px solid #dbe4ea;font-family:ui-monospace,monospace;">${escapeHtml(row.itemCode)}</td>
        <td style="padding:6px 8px;border:1px solid #dbe4ea;">${escapeHtml(row.itemName || "")}</td>
        <td style="padding:6px 8px;border:1px solid #dbe4ea;text-align:right;">${escapeHtml(formatQty(row.sourceQty))} ${escapeHtml(unit)}</td>
        <td style="padding:6px 8px;border:1px solid #dbe4ea;text-align:right;">${escapeHtml(formatQty(row.destinationQty))} ${escapeHtml(unit)}</td>
        <td style="padding:6px 8px;border:1px solid #dbe4ea;text-align:right;font-weight:600;">
          ${escapeHtml(formatQty(row.suggestedQty))} ${escapeHtml(unit)}
          ${note ? `<div style="font-size:11px;font-weight:400;color:#64748b;">${escapeHtml(note)}</div>` : ""}
        </td>
        <td style="padding:6px 8px;border:1px solid #dbe4ea;text-align:right;">${escapeHtml(formatCbm(row.totalCbm) || "-")}</td>
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
          <th align="right" style="padding:8px;border:1px solid ${HEADER_BG};">Suggested</th>
          <th align="right" style="padding:8px;border:1px solid ${HEADER_BG};">Total CBM</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
      <tfoot>
        <tr style="background:#e6f0f2;font-weight:600;">
          <td colspan="5" style="padding:6px 8px;border:1px solid #dbe4ea;text-align:right;">Section total CBM</td>
          <td style="padding:6px 8px;border:1px solid #dbe4ea;text-align:right;">${escapeHtml(formatCbm(totalCbm) || "0")}</td>
        </tr>
      </tfoot>
    </table>
    ${omitted > 0
      ? `<p style="margin:6px 0 0;color:#64748b;font-size:12px;">Showing first ${MAX_ROWS_PER_SECTION} of ${rows.length}. Full list is in the Excel attachment.</p>`
      : `<p style="margin:6px 0 0;color:#64748b;font-size:12px;">Full column detail is in the Excel attachment.</p>`}
  `;
}

export function buildInterCityStockEmail(report = {}, {
  date = "",
  env = process.env,
  groupKey = "dammamRiyadh",
} = {}) {
  const group = INTER_CITY_STOCK_EMAIL_GROUPS[groupKey] || INTER_CITY_STOCK_EMAIL_GROUPS.dammamRiyadh;
  const origin = resolveAppOrigin(env);
  const reportUrl = `${origin}/management/inter-city-stock-transfer`;
  const stockDate = String(report.stockDate || "").trim();
  const summary = report.summary || {};

  const sectionParts = group.sectionKeys.map((key) => {
    const section = SECTION_BY_KEY[key];
    const rows = sectionRows(report, key);
    return {
      section,
      rows,
      totalCbm: sectionTotalCbm(report, key, rows),
      itemCount: Number(summary[`${key}Items`] ?? rows.length ?? 0),
    };
  });

  const subjectBits = sectionParts.map((part) => {
    const short = part.section.sheetName.replace(" to ", "→");
    return `${short} ${part.itemCount}`;
  });
  const subject = [
    `Stock gaps · ${group.label}`,
    formatDate(date || stockDate),
    ...subjectBits,
  ].join(" · ");

  const sectionsHtml = sectionParts.map((part) => (
    renderSectionTable(part.section, part.rows, part.totalCbm)
  )).join("");

  const textLines = [
    `Stock gap digest · ${group.label} · ${formatDate(date || stockDate)} (KSA)`,
    `EOD stock date: ${stockDate || "-"}`,
    ...sectionParts.map((part) => `${part.section.title}: ${part.itemCount} items · CBM ${formatCbm(part.totalCbm) || "0"}`),
    "Excel attachment includes every report column.",
    `Open report: ${reportUrl}`,
  ];

  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;color:#0f172a;line-height:1.45;max-width:960px;">
      <h1 style="margin:0 0 8px;font-size:20px;color:${HEADER_BG};">Daily stock gaps · ${escapeHtml(group.label)}</h1>
      <p style="margin:0 0 4px;color:#475569;font-size:13px;">
        EOD stock date ${escapeHtml(formatDate(stockDate))} · Report date ${escapeHtml(formatDate(date || stockDate))} (KSA)
      </p>
      <p style="margin:0 0 16px;color:#475569;font-size:13px;">
        HTML preview shows key columns. The attached Excel has every Inter-city Stock Transfer column.
      </p>
      <p style="margin:0 0 16px;font-size:13px;">
        ${sectionParts.map((part) => `<strong>${escapeHtml(part.section.sheetName)}:</strong> ${part.itemCount}`).join(" · ")}
      </p>
      ${sectionsHtml}
      <p style="margin:24px 0 0;font-size:13px;">
        <a href="${escapeHtml(reportUrl)}">Open Inter-city Stock Transfer</a>
      </p>
    </div>
  `;

  const attachment = buildInterCityStockExcelAttachment(report, { groupKey: group.key, date: date || stockDate });

  return {
    groupKey: group.key,
    groupLabel: group.label,
    subject,
    text: textLines.join("\n"),
    html,
    attachments: attachment ? [attachment] : [],
    counts: {
      dammamToRiyadhItems: Number(summary.dammamToRiyadhItems || 0),
      riyadhToDammamItems: Number(summary.riyadhToDammamItems || 0),
      riyadhToStoreItems: Number(summary.riyadhToStoreItems || 0),
      storeToRiyadhItems: Number(summary.storeToRiyadhItems || 0),
      storeStockItems: Number(summary.storeStockItems || 0),
      stockDate,
    },
  };
}

export function buildInterCityStockEmailMessages(report = {}, options = {}) {
  return [
    buildInterCityStockEmail(report, { ...options, groupKey: "dammamRiyadh" }),
    buildInterCityStockEmail(report, { ...options, groupKey: "storeRiyadh" }),
  ];
}
