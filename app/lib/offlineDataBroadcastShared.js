export const OFFLINE_DATA_VERSION_KEY = "offline_data_version_v1";
export const OFFLINE_DATA_REFRESH_TYPE = "offline_data_refresh";

export const OFFLINE_DATA_KINDS = {
  transactions: "transactions",
  outstanding: "outstanding",
  prices: "prices",
  schemes: "schemes",
};

export function normalizeOfflineDataKinds(kinds) {
  const allowed = new Set(Object.values(OFFLINE_DATA_KINDS));
  return [...new Set((Array.isArray(kinds) ? kinds : [kinds])
    .map((kind) => String(kind || "").trim().toLowerCase())
    .filter((kind) => allowed.has(kind)))];
}

export function kindsNeedCustomerSnapshot(kinds) {
  return normalizeOfflineDataKinds(kinds).some((kind) => (
    kind === OFFLINE_DATA_KINDS.transactions || kind === OFFLINE_DATA_KINDS.outstanding
  ));
}

export function parseOfflineRefreshKinds(value) {
  if (Array.isArray(value)) {
    return value.map((kind) => String(kind || "").trim().toLowerCase()).filter(Boolean);
  }
  return String(value || "")
    .split(",")
    .map((kind) => kind.trim().toLowerCase())
    .filter(Boolean);
}

export function hashOfflineDataContent(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function shouldPublishOfflineDataUpdate(previous, contentHash) {
  const nextHash = String(contentHash || "").trim();
  if (!nextHash) return true;
  return String(previous?.contentHash || "").trim() !== nextHash;
}

export function shouldApplyOfflineDataVersion(nextVersion, lastVersion, nextHash = "", lastHash = "") {
  const normalizedNextHash = String(nextHash || "").trim();
  const normalizedLastHash = String(lastHash || "").trim();
  if (normalizedNextHash && normalizedLastHash && normalizedNextHash === normalizedLastHash) {
    return false;
  }

  const next = Number(nextVersion || 0);
  const last = Number(lastVersion || 0);
  if (!Number.isFinite(next) || next <= 0) return false;
  return !Number.isFinite(last) || next > last;
}

export function kindsNeedPriceCache(kinds) {
  return normalizeOfflineDataKinds(kinds).some((kind) => (
    kind === OFFLINE_DATA_KINDS.prices || kind === OFFLINE_DATA_KINDS.schemes
  ));
}

export function buildOfflineDataVersion({ kinds, trigger, version, contentHash } = {}) {
  const normalizedKinds = normalizeOfflineDataKinds(kinds);
  return {
    version: Number(version || Date.now()),
    updatedAt: new Date().toISOString(),
    trigger: String(trigger || "upload"),
    kinds: normalizedKinds,
    contentHash: String(contentHash || "").trim(),
  };
}

export function buildOfflineDataPushCopy(kinds) {
  const normalized = normalizeOfflineDataKinds(kinds);
  if (normalized.includes(OFFLINE_DATA_KINDS.outstanding) && normalized.includes(OFFLINE_DATA_KINDS.transactions)) {
    return {
      title: "MADIBA data updated",
      body: "Latest sales and outstanding figures are ready on this device.",
    };
  }
  if (normalized.includes(OFFLINE_DATA_KINDS.outstanding)) {
    return {
      title: "Outstanding updated",
      body: "Latest outstanding data is ready on this device.",
    };
  }
  if (normalized.includes(OFFLINE_DATA_KINDS.transactions)) {
    return {
      title: "Sales updated",
      body: "Latest transaction history is ready on this device.",
    };
  }
  if (normalized.includes(OFFLINE_DATA_KINDS.schemes) && !normalized.includes(OFFLINE_DATA_KINDS.prices)) {
    return {
      title: "Schemes updated",
      body: "Latest order schemes are ready on this device.",
    };
  }
  return {
    title: "Prices updated",
    body: "Latest prices and schemes are ready on this device.",
  };
}
