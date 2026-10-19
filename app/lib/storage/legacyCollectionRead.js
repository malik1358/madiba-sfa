const RECEIPT_FLAT = /^receipt-copies\/[^/]+$/;
const PAYMENT_FLAT = /^payment-copies\/[^/]+$/;

export const LEGACY_COPY_MANIFEST_KEYS = Object.freeze({
  receipt: "receipt_r2_copy_progress_v1",
  payment: "payment_r2_copy_progress_v1",
});

const FLAT_BY_KIND = {
  receipt: RECEIPT_FLAT,
  payment: PAYMENT_FLAT,
};

function progressObject(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// A name is eligible only when the copy and the later reconcile recorded the same checksum.
export function verifiedCopyNames(progress) {
  const payload = progressObject(progress);
  const verified = payload.verified && typeof payload.verified === "object" ? payload.verified : {};
  const reconciled = payload.reconciled && typeof payload.reconciled === "object" ? payload.reconciled : {};
  const names = new Set();
  for (const [name, sha] of Object.entries(verified)) {
    const checksum = String(sha || "").toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(checksum)) continue;
    if (String(reconciled[name] || "").toLowerCase() !== checksum) continue;
    if (!RECEIPT_FLAT.test(name) && !PAYMENT_FLAT.test(name)) continue;
    names.add(name);
  }
  return names;
}

export function legacyCollectionStoragePath(object, kind) {
  const key = String(object?.key || "").replace(/^\/+/, "");
  const prefix = "payment-collections/";
  if (!key.startsWith(prefix)) return "";
  const path = key.slice(prefix.length);
  const pattern = FLAT_BY_KIND[kind];
  if (!pattern || !pattern.test(path) || path.split("/").some((part) => part === "." || part === "..")) return "";
  return path;
}

export function legacyCollectionReadObject(object, kind, verifiedNames, { forceSupabaseReads = false } = {}) {
  if (!object?.key) return null;
  const path = legacyCollectionStoragePath(object, kind);
  const key = path ? `payment-collections/${path}` : String(object.key);
  const eligible = Boolean(path) && !forceSupabaseReads && verifiedNames?.has(path);
  return { provider: eligible ? "r2" : "supabase", key };
}

export async function loadVerifiedCopyNames(admin, kind) {
  const settingKey = LEGACY_COPY_MANIFEST_KEYS[kind];
  if (!settingKey || !admin?.from) return new Set();
  try {
    const { data, error } = await admin
      .from("system_settings")
      .select("setting_value")
      .eq("setting_key", settingKey)
      .maybeSingle();
    if (error || !data) return new Set();
    return verifiedCopyNames(data.setting_value);
  } catch {
    return new Set();
  }
}
