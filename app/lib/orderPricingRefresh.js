import { hasUploadedInvoice } from "./orderApproval.js";
import { inferPricingFromHistory } from "./orderPdfDocument.js";
import {
  normalizePaymentType,
  normalizePricingRegion,
  normalizePricingType,
} from "./regionalPricing.js";

/**
 * Old pending orders may refresh live catalogue prices and schemes only while
 * no invoice PDF has been uploaded. Drafts keep the normal edit/submit path.
 */
export function canRefreshOrderPricing(order, meta = null) {
  if (!order) return false;
  const status = String(order.status || "").trim().toUpperCase();
  if (!status || status === "DRAFT" || status === "CANCELLED") return false;
  if (hasUploadedInvoice(meta)) return false;
  return true;
}

export function resolveRefreshPricingContext({ pricingMeta = null, history = [] } = {}) {
  const meta = pricingMeta && typeof pricingMeta === "object" && !Array.isArray(pricingMeta)
    ? pricingMeta
    : {};
  const inferred = inferPricingFromHistory(history);
  return {
    paymentType: normalizePaymentType(meta.paymentType || inferred.paymentType),
    pricingRegion: normalizePricingRegion(meta.pricingRegion || inferred.pricingRegion),
    pricingType: normalizePricingType(meta.pricingType || inferred.pricingType),
  };
}

export function summarizePricingRefreshChanges(changeSet = []) {
  const changes = Array.isArray(changeSet) ? changeSet : [];
  const rateChanges = changes.filter((change) => (
    change?.type === "UPDATED"
    && Number(change.before_rate || 0) !== Number(change.after_rate || 0)
  ));
  return {
    changedLineCount: rateChanges.length,
    unchanged: rateChanges.length === 0,
  };
}
