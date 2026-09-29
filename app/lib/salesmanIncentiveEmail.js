import { INCENTIVE_TIER_LABELS } from "./salesmanIncentive.js";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Local copy so this presentation helper stays free of the Supabase import chain.
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-SA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatRate(rate) {
  const value = Number(rate || 0) * 100;
  if (!value) return "";
  return `${Number(value.toFixed(2))}%`;
}

export function formatIncentiveMonthLabel(month) {
  const key = String(month || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(key)) return key;
  const index = Number(key.slice(5, 7)) - 1;
  return `${MONTH_NAMES[index] || key} ${key.slice(0, 4)}`;
}

function tierLabel(key) {
  return INCENTIVE_TIER_LABELS[key]?.en || key;
}

/**
 * Label / value rows for one salesman's incentive, laid out vertically so the
 * email reads on a phone. Returns null when there is nothing to report.
 */
export function buildSalesmanIncentiveEmailRows(summary, { month = "", rates = {}, tierKeys = [] } = {}) {
  if (!summary) return null;

  const rows = [{ label: "Month", value: formatIncentiveMonthLabel(month) }];

  const earning = (tierKeys || []).filter((key) => (
    key !== "late" && Number(summary.tier_base?.[key] || 0) > 0
  ));

  if (earning.length) {
    earning.forEach((key) => {
      const rate = formatRate(rates?.[key]);
      rows.push({
        label: `${tierLabel(key)}${rate ? ` @ ${rate}` : ""}`,
        value: `${formatMoney(summary.tier_incentive?.[key])} SAR`,
        note: `on ${formatMoney(summary.tier_base?.[key])} collected`,
      });
    });
  } else {
    rows.push({ label: "Collections settled this month", value: "None yet" });
  }

  if (Number(summary.tier_base?.late || 0) > 0) {
    rows.push({
      label: "Collected too late to earn",
      value: `${formatMoney(summary.tier_base.late)} SAR`,
      note: "no incentive",
      warn: true,
    });
  }

  rows.push({
    label: "Collection incentive",
    value: `${formatMoney(summary.collection_incentive)} SAR`,
    strong: true,
  });

  rows.push({ label: "This month sales", value: `${formatMoney(summary.current_month_sales)} SAR` });

  if (summary.has_sales_history) {
    rows.push({
      label: "Best month ever",
      value: `${formatMoney(summary.peak_month_sales)} SAR`,
      note: summary.peak_month ? formatIncentiveMonthLabel(summary.peak_month) : "",
    });
    rows.push({
      label: "Above best month",
      value: `${formatMoney(summary.sales_delta)} SAR`,
      warn: Number(summary.sales_delta || 0) <= 0,
    });
  } else {
    rows.push({ label: "Best month ever", value: "First month — no growth incentive" });
  }

  rows.push({
    label: "Growth incentive",
    value: `${formatMoney(summary.growth_incentive)} SAR`,
    strong: true,
  });

  rows.push({
    label: "Total incentive",
    value: `${formatMoney(summary.total_incentive)} SAR`,
    total: true,
  });

  return rows;
}

export function buildSalesmanIncentiveEmailSection(summary, options = {}) {
  const rows = buildSalesmanIncentiveEmailRows(summary, options);
  if (!rows) return null;

  const bodyHtml = rows.map((row) => {
    const labelStyle = "padding:8px;border:1px solid #d5dee3;background:#f4f7fb;font-weight:600;width:55%;";
    const valueStyle = [
      "padding:8px;border:1px solid #d5dee3;text-align:right;",
      row.total ? "background:#0f4c5c;color:#ffffff;font-weight:700;" : "",
      row.strong && !row.total ? "font-weight:700;" : "",
      row.warn && !row.total ? "color:#b91c1c;" : "",
    ].join("");
    const note = row.note
      ? `<div style="font-size:11px;color:#52616b;font-weight:400;">${escapeHtml(row.note)}</div>`
      : "";
    return `<tr>
        <td style="${labelStyle}">${escapeHtml(row.label)}</td>
        <td style="${valueStyle}">${escapeHtml(row.value)}${note}</td>
      </tr>`;
  }).join("");

  const html = `<h2 style="font-size:16px;margin:16px 0 4px;">Your incentive</h2>
  <p style="color:#52616b;font-size:12px;margin:0 0 8px;">All amounts exclude VAT. Collection incentive is earned on cash actually received in the month.</p>
  <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-size:12px;width:100%;max-width:460px;margin:0 0 16px;">
    <tbody>${bodyHtml}</tbody>
  </table>`;

  const text = [
    "Your incentive:",
    ...rows.map((row) => `- ${row.label}: ${row.value}${row.note ? ` (${row.note})` : ""}`),
  ].join("\n");

  return { html, text, rows };
}
