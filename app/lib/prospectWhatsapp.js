import { buildFieldVisitWhatsappSummary } from "./fieldVisitWhatsapp.js";
import { resolveProspectCustomerCode } from "./prospects.js";

/**
 * Prospect follow-up WhatsApp uses the same English field-visit report layout
 * so managers get one consistent share format.
 */
export function buildProspectFollowUpWhatsappSummary({
  form = {},
  prospect = {},
  followUpDate = "",
  salesmanName = "",
  salesmanCode = "",
  visitDistance = {},
  outcome = "Order not received",
} = {}) {
  const customerName = String(
    form.customer_name_en
    || form.shop_name
    || prospect.company_name
    || prospect.shop_name
    || ""
  ).trim();
  const customerCode = resolveProspectCustomerCode({
    id: prospect.id,
    offline_id: prospect.offline_id || prospect.offlineId,
  }) || "-";
  const note = String(form.notes || "").trim() || String(outcome || "").trim();

  return buildFieldVisitWhatsappSummary({
    customer: {
      customer_code: customerCode,
      customer_name: customerName || customerCode,
      outstanding_0_30: 0,
      outstanding_30_60: 0,
      outstanding_61_90: 0,
      outstanding_above_90: 0,
      latitude: prospect.latitude ?? form.latitude,
      longitude: prospect.longitude ?? form.longitude,
    },
    visitForm: {
      outcome,
      nextVisitAt: followUpDate,
      note,
    },
    salesmanName,
    salesmanCode,
    visitDistance,
  });
}
