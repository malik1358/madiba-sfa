export const ORDER_QUANTITY_CONTROLS_CACHE_KEY = "order_quantity_controls";

export const CONTROL_PERIOD_WEEK = "week";
export const CONTROL_SCOPE_CUSTOMER = "customer";

export const DEFAULT_ORDER_QUANTITY_CONTROLS = [
  {
    id: "default-a004075-weekly-20",
    name: "A004075 max 20 CTN / customer / week",
    active: true,
    itemCode: "A004075",
    maxQty: 20,
    unit: "CTN",
    period: CONTROL_PERIOD_WEEK,
    scope: CONTROL_SCOPE_CUSTOMER,
  },
];

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function toPositiveNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toBoolean(value, fallback = true) {
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  return fallback;
}

export function createEmptyQuantityControlDraft() {
  return {
    id: "",
    name: "",
    active: true,
    itemCode: "",
    maxQty: 20,
    unit: "CTN",
    period: CONTROL_PERIOD_WEEK,
    scope: CONTROL_SCOPE_CUSTOMER,
  };
}

export function normalizeOrderQuantityControl(raw, index = 0) {
  const source = raw && typeof raw === "object" ? raw : {};
  const itemCode = normalizeCode(source.itemCode || source.item_code);
  const maxQty = toPositiveNumber(source.maxQty ?? source.max_qty, 0);
  if (!itemCode || !(maxQty > 0)) return null;

  const period = String(source.period || CONTROL_PERIOD_WEEK).trim().toLowerCase() === CONTROL_PERIOD_WEEK
    ? CONTROL_PERIOD_WEEK
    : CONTROL_PERIOD_WEEK;
  const scope = String(source.scope || CONTROL_SCOPE_CUSTOMER).trim().toLowerCase() === CONTROL_SCOPE_CUSTOMER
    ? CONTROL_SCOPE_CUSTOMER
    : CONTROL_SCOPE_CUSTOMER;

  return {
    id: String(source.id || `qty-control-${index + 1}`).trim() || `qty-control-${index + 1}`,
    name: String(source.name || `${itemCode} max ${maxQty} ${String(source.unit || "CTN").trim() || "CTN"} / ${scope} / ${period}`).trim(),
    active: toBoolean(source.active, true),
    itemCode,
    maxQty,
    unit: String(source.unit || "CTN").trim().toUpperCase() || "CTN",
    period,
    scope,
  };
}

export function normalizeOrderQuantityControls(raw) {
  const list = Array.isArray(raw)
    ? raw
    : (Array.isArray(raw?.controls) ? raw.controls : []);
  return list
    .map((entry, index) => normalizeOrderQuantityControl(entry, index))
    .filter(Boolean);
}

export function resolveStoredOrderQuantityControls(stored) {
  if (!stored || typeof stored !== "object") {
    return normalizeOrderQuantityControls(DEFAULT_ORDER_QUANTITY_CONTROLS);
  }
  if (Object.prototype.hasOwnProperty.call(stored, "controls")) {
    return normalizeOrderQuantityControls(stored.controls);
  }
  if (Array.isArray(stored)) {
    return normalizeOrderQuantityControls(stored);
  }
  return normalizeOrderQuantityControls(DEFAULT_ORDER_QUANTITY_CONTROLS);
}

export function activeOrderQuantityControls(controls = []) {
  return normalizeOrderQuantityControls(controls).filter((control) => control.active);
}

function quantityMapFromLines(lines = []) {
  const map = {};
  (lines || []).forEach((line) => {
    const code = normalizeCode(line?.item_code || line?.itemCode);
    if (!code) return;
    map[code] = (map[code] || 0) + Number(line?.quantity || 0);
  });
  return map;
}

function quantityMapFromValues(values = {}) {
  const map = {};
  Object.entries(values || {}).forEach(([code, qty]) => {
    const normalized = normalizeCode(code);
    if (!normalized) return;
    map[normalized] = Number(qty || 0);
  });
  return map;
}

/** Monday 00:00 Asia/Riyadh → next Monday 00:00, as UTC ISO strings. */
export function getRiyadhWeekBounds(referenceDate = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = formatter.formatToParts(referenceDate);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(lookup.year);
  const month = Number(lookup.month);
  const day = Number(lookup.day);
  const weekday = String(lookup.weekday || "").slice(0, 3).toLowerCase();
  const weekdayOffset = {
    mon: 0,
    tue: 1,
    wed: 2,
    thu: 3,
    fri: 4,
    sat: 5,
    sun: 6,
  }[weekday] ?? 0;

  // Build noon UTC on the Riyadh calendar date, then walk back to Monday.
  const noonUtc = Date.UTC(year, month - 1, day, 9, 0, 0); // 12:00 Riyadh ≈ 09:00 UTC
  const mondayNoonUtc = noonUtc - (weekdayOffset * 24 * 60 * 60 * 1000);
  const mondayParts = Object.fromEntries(
    formatter.formatToParts(new Date(mondayNoonUtc)).map((part) => [part.type, part.value]),
  );
  const weekStartLocal = `${mondayParts.year}-${mondayParts.month}-${mondayParts.day}T00:00:00+03:00`;
  const weekStartMs = Date.parse(weekStartLocal);
  const weekEndMs = weekStartMs + (7 * 24 * 60 * 60 * 1000);

  return {
    weekStartIso: new Date(weekStartMs).toISOString(),
    weekEndIso: new Date(weekEndMs).toISOString(),
    weekStartLocal,
    weekEndLocal: new Date(weekEndMs).toISOString().replace("Z", "+00:00"),
  };
}

export function evaluateOrderQuantityControls({
  lines = [],
  quantities = null,
  controls = [],
  priorQtyByItem = {},
} = {}) {
  const qtyMap = quantities
    ? quantityMapFromValues(quantities)
    : quantityMapFromLines(lines);
  const priorMap = quantityMapFromValues(priorQtyByItem);
  const violations = [];

  activeOrderQuantityControls(controls).forEach((control) => {
    const orderedQty = Number(qtyMap[control.itemCode] || 0);
    if (!(orderedQty > 0)) return;

    const alreadyQty = Number(priorMap[control.itemCode] || 0);
    const totalQty = alreadyQty + orderedQty;
    if (totalQty <= control.maxQty) return;

    const remaining = Math.max(0, control.maxQty - alreadyQty);
    violations.push({
      controlId: control.id,
      controlName: control.name,
      itemCode: control.itemCode,
      maxQty: control.maxQty,
      unit: control.unit,
      period: control.period,
      scope: control.scope,
      alreadyQty,
      orderedQty,
      totalQty,
      remainingQty: remaining,
    });
  });

  return violations;
}

export function formatQuantityControlViolation(violation, language = "en") {
  if (!violation) return "";
  const item = violation.itemCode;
  const max = violation.maxQty;
  const unit = violation.unit || "CTN";
  const already = Number(violation.alreadyQty || 0);
  const ordered = Number(violation.orderedQty || 0);
  const remaining = Number(violation.remainingQty || 0);

  if (language === "ar") {
    return `حد الطلب للصنف ${item}: بحد أقصى ${max} ${unit} لكل عميل في الأسبوع. تم طلب ${already} سابقاً هذا الأسبوع، والكمية الحالية ${ordered}. المتبقي المسموح ${remaining}.`;
  }

  return `${item} is limited to ${max} ${unit} per customer per week. Already ordered this week: ${already}. This order: ${ordered}. Remaining allowed: ${remaining}.`;
}

export function describeOrderQuantityControl(control) {
  const normalized = normalizeOrderQuantityControl(control);
  if (!normalized) return "";
  return `${normalized.itemCode}: max ${normalized.maxQty} ${normalized.unit} per ${normalized.scope} per ${normalized.period}${normalized.active ? "" : " (disabled)"}`;
}
