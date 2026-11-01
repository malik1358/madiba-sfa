export function normalizeReportItemCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

export function isDoNotUseItemName(name) {
  return /do\s*not\s*use+/i.test(String(name || "").trim());
}

export function itemIdentityKey(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const parts = text.split(/\s*·\s*/).map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1) {
    const code = normalizeReportItemCode(parts[parts.length - 1]);
    if (code) return code.toLowerCase();
  }
  const asCode = normalizeReportItemCode(text);
  return (asCode || text).toLowerCase();
}

export function preferItemDisplayName(current, candidate, itemCode = "") {
  const code = normalizeReportItemCode(itemCode);
  const next = String(candidate || "").trim();
  const prev = String(current || "").trim();
  if (!next) return prev;
  if (!prev) return next;

  const nextIsCode = Boolean(code) && normalizeReportItemCode(next) === code;
  const prevIsCode = Boolean(code) && normalizeReportItemCode(prev) === code;
  const nextDoNotUse = isDoNotUseItemName(next);
  const prevDoNotUse = isDoNotUseItemName(prev);

  if (prevDoNotUse && !nextDoNotUse) return next;
  if (!prevDoNotUse && nextDoNotUse) return prev;
  if (prevIsCode && !nextIsCode) return next;
  if (!prevIsCode && nextIsCode) return prev;
  if (next.length > prev.length) return next;
  return prev;
}

export function reportItemLabel(row = {}) {
  const code = normalizeReportItemCode(row.item_code);
  const name = String(row.item_name || "").trim();
  if (name && code) return `${name} · ${code}`;
  return name || code || "Unclassified";
}

export function reportItemGroupKey(row = {}) {
  return normalizeReportItemCode(row.item_code) || reportItemLabel(row);
}
