const FLAT_KEY = /^payment-collections\/(?:receipt-copies|payment-copies)\/[^/]+$/;

function folderFor(category) {
  if (category === "receipt_copy") return "receipt-copies";
  if (category === "payment_copy") return "payment-copies";
  return "";
}

export function isHistoricalReadSwitchRow(record) {
  const category = String(record?.category || "");
  const folder = folderFor(category);
  const key = String(record?.object_key || "");
  return Boolean(folder)
    && record?.storage_provider === "supabase"
    && Boolean(record?.verified_at)
    && FLAT_KEY.test(key)
    && key.startsWith(`payment-collections/${folder}/`);
}

export function isSwitchedHistoricalRow(record) {
  return isHistoricalReadSwitchRow({ ...record, storage_provider: "supabase" })
    && record?.storage_provider === "r2";
}

export function signedHostKind(url) {
  const host = new URL(url).hostname;
  if (host.endsWith(".r2.cloudflarestorage.com")) return "r2";
  if (host.endsWith(".supabase.co")) return "supabase";
  return "other";
}

export function sameIdSet(left, right) {
  const a = [...left].map(String).sort();
  const b = [...right].map(String).sort();
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
