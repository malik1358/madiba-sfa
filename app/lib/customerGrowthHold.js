import { isOutstandingOverSixtyDays } from "./creditApproval.js";
import { findOutstandingForCustomer, isSameOutstandingCustomer, toNumber } from "./outstanding.js";
import { findLegalTransferForCustomer } from "./paymentCollections.js";

export function parseGrowthCustomerLabel(label) {
  const text = String(label || "").trim();
  const separator = " · ";
  const index = text.lastIndexOf(separator);
  if (index < 0) return { customer_name: text, customer_code: "" };
  return {
    customer_name: text.slice(0, index).trim(),
    customer_code: text.slice(index + separator.length).trim(),
  };
}

export function customerAuditHrefFromGrowthRow(row = {}) {
  const identity = growthRowCustomerIdentity(row);
  if (!identity.customer_code) return "";
  return `/management/customer-audit?customer_code=${encodeURIComponent(identity.customer_code)}`;
}

export function growthRowCustomerIdentity(row = {}) {
  const parsed = parseGrowthCustomerLabel(row.label || row.category || "");
  return {
    customer_code: String(row.customer_code || parsed.customer_code || "").trim(),
    customer_name: String(row.customer_name || parsed.customer_name || "").trim(),
  };
}

export function customerHasOverSixtyOutstanding(outstanding) {
  if (!outstanding) return false;
  if (isOutstandingOverSixtyDays(outstanding)) return true;
  return toNumber(outstanding.outstanding_61_90) > 0
    || toNumber(outstanding.outstanding_91_120) > 0
    || toNumber(outstanding.outstanding_above_90) > 0
    || toNumber(outstanding.outstanding_above_120) > 0
    || toNumber(outstanding.buckets?.["61-90"]) > 0
    || toNumber(outstanding.buckets?.["91-120"]) > 0
    || toNumber(outstanding.buckets?.[">120"]) > 0
    || toNumber(outstanding.buckets?.[">90"]) > 0;
}

function findOutstandingHoldRecord(dataset, customerCode, customerName) {
  const built = findOutstandingForCustomer(dataset, customerCode, customerName);
  const raw = (dataset?.rows || []).find((row) => (
    isSameOutstandingCustomer(row.customer_code, row.customer_name, customerCode, customerName)
  ));
  if (!built && !raw) return null;
  return { ...raw, ...built };
}

export function isHeldCustomerGrowthRow(row, { legalTransfers = [], outstandingDataset = null } = {}) {
  const identity = growthRowCustomerIdentity(row);
  if (!identity.customer_code && !identity.customer_name) return false;

  if (findLegalTransferForCustomer(legalTransfers, identity.customer_code)?.is_transferred) {
    return true;
  }

  const outstanding = findOutstandingHoldRecord(
    outstandingDataset,
    identity.customer_code,
    identity.customer_name,
  );
  return customerHasOverSixtyOutstanding(outstanding);
}

function recountGrowthMeta(groups = []) {
  return {
    categoryCount: groups.length,
    groupCount: groups.length,
    growingCount: groups.filter((row) => row.status === "green").length,
    decliningCount: groups.filter((row) => row.status === "red").length,
    warningCount: groups.filter((row) => row.status === "orange").length,
  };
}

export function applyCustomerGrowthHolds(report, holdContext = {}) {
  const groupBy = report?.filters?.groupBy || report?.meta?.groupBy;
  if (!report || groupBy !== "customer") return report;

  const source = report.groups || report.categories || [];
  const groups = source.filter((row) => !isHeldCustomerGrowthRow(row, holdContext));
  if (groups.length === source.length) return report;

  const keptLabels = new Set(groups.map((row) => row.label));
  const alerts = (report.alerts || []).filter((alert) => keptLabels.has(alert.title));

  return {
    ...report,
    groups,
    categories: groups,
    alerts,
    meta: {
      ...report.meta,
      ...recountGrowthMeta(groups),
      heldCustomersHidden: source.length - groups.length,
    },
  };
}

export function applyCustomerGrowthHoldsToReport(report, holdContext = {}) {
  const next = applyCustomerGrowthHolds(report, holdContext);
  if (!next?.measures) return next;
  return {
    ...next,
    measures: {
      sales: applyCustomerGrowthHolds(next.measures.sales, holdContext),
      profit: applyCustomerGrowthHolds(next.measures.profit, holdContext),
    },
  };
}
