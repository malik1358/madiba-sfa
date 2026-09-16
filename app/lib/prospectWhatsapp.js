import { resolveProspectCustomerCode } from "./prospects.js";
import { formatKsaDateOnly } from "./workdayActivity.js";

/**
 * WhatsApp prospect follow-up shares stay English even when the salesman UI is Arabic,
 * matching field/collection visit summaries so managers always get the same format.
 */
export function buildProspectFollowUpWhatsappSummary({
  form = {},
  prospect = {},
  followUpDate = "",
  salesmanName = "",
  salesmanCode = "",
} = {}) {
  const customerName = String(
    form.customer_name_en
    || form.shop_name
    || prospect.company_name
    || prospect.shop_name
    || ""
  ).trim() || "-";
  const code = resolveProspectCustomerCode({
    id: prospect.id,
    offline_id: prospect.offline_id || prospect.offlineId,
  }) || "-";
  const salesman = String(salesmanName || salesmanCode || form.salesman_code || "-").trim() || "-";
  const nextVisit = formatKsaDateOnly(followUpDate, "");
  const mobile = String(form.mobile || prospect.mobile || "").trim();
  const city = String(form.city || prospect.city || "").trim();
  const area = String(form.area || prospect.area || "").trim();
  const ownerName = String(form.owner_name || prospect.contact_person || "").trim();
  const notes = String(form.notes || "").trim();

  const lines = [
    "New prospect visit",
    `Customer: ${customerName}`,
    `Code: ${code}`,
    `Salesman: ${salesman}`,
    "Outcome: Order not received",
    `Next visit: ${nextVisit || "not specified"}`,
  ];

  if (ownerName) lines.push(`Contact: ${ownerName}`);
  if (mobile) lines.push(`Mobile: ${mobile}`);
  if (city) lines.push(`City: ${city}`);
  if (area) lines.push(`Area: ${area}`);
  if (notes) lines.push(`Notes: ${notes}`);

  return lines.join("\n");
}
