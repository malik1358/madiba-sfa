import { parseEmailList } from "./mailer.js";

export const DEFAULT_MISSING_CATALOGUE_PHOTOS_EMAIL_TO = "malik@pinasz.com,swami@pinasz.com";
export const MISSING_CATALOGUE_PHOTOS_EMAIL_KEY_PREFIX = "missing_catalogue_photos_email:";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

export function missingCataloguePhotoEmailRecipients(env = {}) {
  const testTo = String(env.MISSING_CATALOGUE_PHOTOS_EMAIL_TEST_TO || "").trim();
  const override = String(env.MISSING_CATALOGUE_PHOTOS_EMAIL_TO || "").trim();
  return [...new Set(parseEmailList(testTo || override || DEFAULT_MISSING_CATALOGUE_PHOTOS_EMAIL_TO))];
}

export function buildMissingCataloguePhotoEmail({ date, rows = [], summary = {} } = {}) {
  const missing = Number(summary.missing) || rows.length;
  const headers = ["Code", "Item", "Category"];
  const body = rows.map((row, index) => {
    const background = index % 2 ? "#f4fafa" : "#ffffff";
    const cells = [
      escapeHtml(row.code),
      escapeHtml(row.name),
      escapeHtml(row.category),
    ];
    return `<tr style="background:${background}">${cells.map((cell) => `<td style="padding:8px;border:1px solid #d7e4e8">${cell}</td>`).join("")}</tr>`;
  }).join("");
  const empty = '<tr><td colspan="3" style="padding:12px">Every included item already has a photo.</td></tr>';
  return {
    subject: `Missing catalogue photos - ${date} (${missing})`,
    html: `<div style="font-family:Arial,sans-serif;color:#14323a">
      <h2 style="margin:0 0 8px">Missing catalogue photos - ${escapeHtml(date)}</h2>
      <p style="margin:0 0 12px">Priced catalogue items with no photo: ${missing}. Already have photos: ${Number(summary.withPhotos) || 0}. Building materials excluded: ${Number(summary.excludedBuilding) || 0}.</p>
      <table style="border-collapse:collapse;width:100%;font-size:13px">
        <thead><tr style="background:#0f4c5c;color:#ffffff">${headers.map((header) => `<th style="padding:10px;text-align:left">${header}</th>`).join("")}</tr></thead>
        <tbody>${body || empty}</tbody>
        <tfoot><tr style="background:#0f4c5c;color:#ffffff"><th style="padding:10px;text-align:left">Total</th><td style="padding:10px">${missing}</td><td></td></tr></tfoot>
      </table>
      <p style="margin:12px 0 0;color:#52656c;font-size:12px">Same list as Missing Catalogue Photos. Items without a price, non-product codes, building materials, and do-not-use names are excluded.</p>
    </div>`,
    text: [
      `Missing catalogue photos - ${date}: ${missing}`,
      `Priced catalogue items with no photo: ${missing}. Already have photos: ${Number(summary.withPhotos) || 0}. Building materials excluded: ${Number(summary.excludedBuilding) || 0}.`,
      headers.join(" | "),
      ...rows.map((row) => [row.code, row.name, row.category].join(" | ")),
      ...(rows.length ? [] : ["Every included item already has a photo."]),
      `Total: ${missing}`,
    ].join("\n"),
  };
}
