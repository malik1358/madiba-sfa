import { isLikelyEmail, parseEmailList } from "./mailer.js";
import { normalizePricingRegion, pricingRegionLabel } from "./regionalPricing.js";

export const WAREHOUSE_INVOICE_ILIYAS_EMAIL = "iliyas.belliyaru@noorshukran.com";
export const WAREHOUSE_INVOICE_JAVED_EMAIL = "dwh@noorshukran.com";
export const WAREHOUSE_INVOICE_RESUME_CC = [
  "jenil.modi@noorshukran.com",
  "shreyansh.sharma@noorshukran.com",
];

export const WAREHOUSE_INVOICE_BUCKET_RIYADH_JEDDAH = "riyadh_jeddah";
export const WAREHOUSE_INVOICE_BUCKET_DAMMAM = "dammam";

function mergeEmailList(defaults, extraValue) {
  const extras = parseEmailList(extraValue);
  const base = (defaults || [])
    .flatMap((value) => parseEmailList(value))
    .filter((email) => isLikelyEmail(email));
  return [...new Set([...base, ...extras])];
}

/** Normalize order pricing city for warehouse routing. */
export function warehouseInvoicePricingRegion(value) {
  return normalizePricingRegion(value);
}

export function warehouseInvoiceBucketKey(region) {
  return warehouseInvoicePricingRegion(region) === "dammam"
    ? WAREHOUSE_INVOICE_BUCKET_DAMMAM
    : WAREHOUSE_INVOICE_BUCKET_RIYADH_JEDDAH;
}

export function warehouseInvoiceBucketLabel(bucketKey) {
  if (bucketKey === WAREHOUSE_INVOICE_BUCKET_DAMMAM) return "Dammam";
  return "Riyadh & Jeddah";
}

/**
 * Fixed warehouse recipient for a single invoice-upload notification.
 * Riyadh / Jeddah / unknown → Iliyas; Dammam → Javed (dwh@).
 */
export function resolveWarehouseInvoiceFixedRecipient(region, env = process.env) {
  const bucket = warehouseInvoiceBucketKey(region);
  if (bucket === WAREHOUSE_INVOICE_BUCKET_DAMMAM) {
    const override = mergeEmailList([], env.INVOICE_UPLOAD_WAREHOUSE_TO_DAMMAM);
    return override[0] || WAREHOUSE_INVOICE_JAVED_EMAIL;
  }
  const override = mergeEmailList([], env.INVOICE_UPLOAD_WAREHOUSE_TO_RIYADH_JEDDAH);
  return override[0] || WAREHOUSE_INVOICE_ILIYAS_EMAIL;
}

export function resolveWarehouseInvoiceFixedRecipients(region, env = process.env) {
  const email = resolveWarehouseInvoiceFixedRecipient(region, env);
  return email ? [email] : [];
}

export function resolveDailyWarehouseInvoiceResumeTo(bucketKey, env = process.env) {
  if (bucketKey === WAREHOUSE_INVOICE_BUCKET_DAMMAM) {
    return mergeEmailList(
      [WAREHOUSE_INVOICE_JAVED_EMAIL],
      env.DAILY_WAREHOUSE_INVOICE_RESUME_TO_DAMMAM,
    );
  }
  return mergeEmailList(
    [WAREHOUSE_INVOICE_ILIYAS_EMAIL],
    env.DAILY_WAREHOUSE_INVOICE_RESUME_TO_RIYADH_JEDDAH,
  );
}

export function resolveDailyWarehouseInvoiceResumeCc(env = process.env, to = []) {
  const recipients = new Set((to || []).map((email) => String(email || "").trim().toLowerCase()));
  return mergeEmailList(WAREHOUSE_INVOICE_RESUME_CC, env.DAILY_WAREHOUSE_INVOICE_RESUME_CC)
    .filter((email) => !recipients.has(email));
}

const STORAGE_UPLOAD_PREFIX =
  /^\d+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(.+)$/i;

/**
 * Derive the human invoice file number from an upload name or storage object key.
 * Storage keys look like: `1432/1253/<ts>-<uuid>-DC-0087.pdf` → `DC-0087`.
 */
export function invoiceFileNumberFromName(fileName = "") {
  const raw = String(fileName || "").trim();
  if (!raw) return "";
  let base = raw.replace(/^.*[\\/]/, "").replace(/\.pdf$/i, "").trim();
  const prefixed = base.match(STORAGE_UPLOAD_PREFIX);
  if (prefixed?.[1]) base = String(prefixed[1]).trim();
  return base || "";
}

/** Prefer original upload name; fall back to the stored invoice object key. */
export function resolveInvoiceFileNumberFromMeta(meta = {}) {
  const payload = meta && typeof meta === "object" ? meta : {};
  const candidates = [
    payload.originalFileName,
    payload.invoiceFileName,
    payload.invoiceFilePath,
  ];
  for (const candidate of candidates) {
    const number = invoiceFileNumberFromName(candidate);
    if (number) return number;
  }
  return "";
}

export { pricingRegionLabel };
