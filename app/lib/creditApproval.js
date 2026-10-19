import { toNumber } from "./outstanding.js";
import {
  addYearsToIsoDate,
  isCreditApplicationExpired,
  parseDocumentDate,
} from "./customerDocumentParse.js";

const CREDIT_EXPOSURE_LIMIT = 10000;

function bucketAmount(outstanding, label, fieldName) {
  const fromBuckets = toNumber(outstanding?.buckets?.[label]);
  const fromField = toNumber(outstanding?.[fieldName]);
  return fromBuckets > 0 ? fromBuckets : fromField;
}

export function outstandingAmountOverSixtyDays(outstanding = {}) {
  return bucketAmount(outstanding, "61-90", "outstanding_61_90")
    + bucketAmount(outstanding, "91-120", "outstanding_91_120")
    + bucketAmount(outstanding, ">120", "outstanding_above_120");
}

export function isOutstandingOverSixtyDays(outstanding = {}) {
  return outstandingAmountOverSixtyDays(outstanding) > 0;
}

export function evaluateCreditApproval({
  outstanding = {},
  orderValue = 0,
  creditApplication = null,
  todayIso = new Date().toISOString().slice(0, 10),
  paymentType = "credit",
} = {}) {
  if (String(paymentType || "").trim().toLowerCase() === "cash") {
    return {
      required: false,
      reasons: [],
      remark: "Cash order — credit approval not required.",
    };
  }

  const totalOutstanding = toNumber(outstanding?.total_outstanding);
  const order = toNumber(orderValue);
  const overdueOver60 = isOutstandingOverSixtyDays(outstanding);
  const present = Boolean(creditApplication?.present || creditApplication?.issue_date || creditApplication?.expiry_date);
  const expiry = parseDocumentDate(creditApplication?.expiryDate || creditApplication?.expiry_date)
    || (parseDocumentDate(creditApplication?.issueDate || creditApplication?.issue_date)
      ? addYearsToIsoDate(creditApplication.issueDate || creditApplication.issue_date, 1)
      : "");
  const expired = present
    ? (expiry ? expiry < String(todayIso || "").slice(0, 10) : isCreditApplicationExpired(creditApplication, todayIso))
    : true;
  const missingOrExpired = !present || expired;
  const highExposure = (totalOutstanding + order) > CREDIT_EXPOSURE_LIMIT && missingOrExpired;

  if (overdueOver60) {
    return {
      required: true,
      reasons: ["outstanding_over_60_days"],
      remark: "Credit control: Approval required — outstanding over 60 days.",
    };
  }

  if (highExposure) {
    const reason = present && expired
      ? "Credit control: Approval required — order plus outstanding exceeds 10,000 and credit application is expired."
      : "Credit control: Approval required — order plus outstanding exceeds 10,000 and credit application is missing.";
    return {
      required: true,
      reasons: ["exposure_over_10000_without_valid_credit_app"],
      remark: reason,
    };
  }

  return {
    required: false,
    reasons: [],
    remark: "Credit control: Approval not required.",
  };
}

export function formatCreditApprovalPdfRemark(evaluation) {
  return String(evaluation?.remark || "Credit control: Approval not required.").trim();
}

export function wrapCreditControlRemark(doc, remark, maxWidth) {
  const text = formatCreditApprovalPdfRemark({ remark });
  const wrapped = typeof doc?.splitTextToSize === "function"
    ? doc.splitTextToSize(text, maxWidth)
    : [text];
  const lines = Array.isArray(wrapped) ? wrapped : [text];
  return {
    lines,
    height: Math.max(16, lines.length * 12 + 8),
  };
}

export function drawCreditControlRemark(doc, lines, x, y) {
  const rows = Array.isArray(lines) ? lines : [String(lines || "")];
  doc.setFont(undefined, "bold");
  doc.setFontSize(10);
  rows.forEach((line, index) => {
    doc.text(line, x, y + index * 12);
  });
  doc.setFont(undefined, "normal");
}

export function appendCreditControlRemarkToPdf(doc, {
  remark,
  x,
  y,
  maxWidth,
  ensureSpace,
} = {}) {
  const { lines, height } = wrapCreditControlRemark(doc, remark, maxWidth);
  if (typeof ensureSpace === "function") ensureSpace(height);
  const drawY = typeof y === "function" ? y() : y;
  drawCreditControlRemark(doc, lines, x, drawY);
  return drawY + height;
}
