export function isUnsetInvoiceStatus(invoiceStatus) {
  return String(invoiceStatus ?? "").trim() === "-" || String(invoiceStatus ?? "").trim() === "";
}

export function shouldRunTimeToMakeClock(invoiceStatus) {
  return isUnsetInvoiceStatus(invoiceStatus);
}

export function isPendingOrderTimeFrozen(meta, invoiceStatus) {
  if (!shouldRunTimeToMakeClock(invoiceStatus)) return true;
  return Boolean(meta?.invoiceUploadedAt) || Number(meta?.invoiceBuildSeconds) > 0;
}

export function pendingOrderTimeToMakeSeconds(order, meta, nowMs = Date.now(), invoiceStatus = "-") {
  const createdMs = Date.parse(order?.created_at || "");
  const uploadedMs = Date.parse(meta?.invoiceUploadedAt || "");
  const stored = Number(meta?.invoiceBuildSeconds);

  if (Number.isFinite(stored) && stored > 0) {
    return Math.round(stored);
  }
  if (Number.isFinite(createdMs) && Number.isFinite(uploadedMs)) {
    return Math.max(0, Math.round((uploadedMs - createdMs) / 1000));
  }
  if (!shouldRunTimeToMakeClock(invoiceStatus)) return null;
  if (!Number.isFinite(createdMs)) return null;
  return Math.max(0, Math.floor((Number(nowMs) - createdMs) / 1000));
}

export function formatPendingDuration(secondsValue) {
  if (secondsValue == null) return "-";
  const seconds = Math.floor(Number(secondsValue));
  if (!Number.isFinite(seconds) || seconds < 0) return "-";

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m ${remainingSeconds}s`;
  if (hours > 0) return `${hours}h ${minutes}m ${remainingSeconds}s`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

export function pendingOrderTimeToMakeBucket(secondsValue) {
  const seconds = Number(secondsValue);
  if (!Number.isFinite(seconds) || seconds < 0) return "-";
  if (seconds < 3600) return "Under 1 hour";
  if (seconds < 6 * 3600) return "1-6 hours";
  if (seconds < 24 * 3600) return "6-24 hours";
  if (seconds < 7 * 24 * 3600) return "1-7 days";
  return "Over 7 days";
}
