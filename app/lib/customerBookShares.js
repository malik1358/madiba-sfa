import { isMissingSchemaColumn } from "./performanceKpis.js";
import {
  SHARED_CUSTOMER_BOOKS,
  matchesShareIdentities,
  normalizeSalesmanCode,
  normalizeSalesmanName,
  resolveSharedBookProfilesFromRows,
} from "./mutualSalesmanGroups.js";

function isMissingRelation(error) {
  const message = String(error?.message || error?.details || error?.hint || "").toLowerCase();
  const code = String(error?.code || "").toUpperCase();
  return code === "42P01"
    || code === "PGRST205"
    || (message.includes("relation") && message.includes("does not exist"))
    || (message.includes("could not find") && message.includes("customer_book_shares"));
}

export { resolveSharedBookProfilesFromRows };

export async function loadActiveCustomerBookShareRows(admin) {
  if (!admin) return null;

  const { data, error } = await admin
    .from("customer_book_shares")
    .select("id,source_salesman_id,viewer_salesman_id,is_active,created_at,updated_at,created_by")
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) {
    if (isMissingSchemaColumn(error) || isMissingRelation(error)) return null;
    throw error;
  }

  return data || [];
}

export async function loadAllCustomerBookShareRows(admin) {
  if (!admin) return null;

  const { data, error } = await admin
    .from("customer_book_shares")
    .select("id,source_salesman_id,viewer_salesman_id,is_active,created_at,updated_at,created_by")
    .order("created_at", { ascending: false });

  if (error) {
    if (isMissingSchemaColumn(error) || isMissingRelation(error)) return null;
    throw error;
  }

  return data || [];
}

function findProfilesForIdentities(allProfiles, identities) {
  return (allProfiles || []).filter((profile) => matchesShareIdentities(profile, identities));
}

export function buildDefaultSharePairs(allProfiles) {
  const pairs = [];
  const seen = new Set();

  (SHARED_CUSTOMER_BOOKS || []).forEach((book) => {
    const sources = findProfilesForIdentities(allProfiles, book.source);
    const viewers = findProfilesForIdentities(allProfiles, book.viewers);
    sources.forEach((source) => {
      viewers.forEach((viewer) => {
        if (!source?.id || !viewer?.id || source.id === viewer.id) return;
        const key = `${source.id}:${viewer.id}`;
        if (seen.has(key)) return;
        seen.add(key);
        pairs.push({
          source_salesman_id: source.id,
          viewer_salesman_id: viewer.id,
          source,
          viewer,
        });
      });
    });
  });

  return pairs;
}

export async function ensureDefaultCustomerBookShares(admin, allProfiles, createdBy = null) {
  const existing = await loadAllCustomerBookShareRows(admin);
  if (existing === null) {
    return { seeded: 0, tableMissing: true };
  }

  const existingKeys = new Set(
    existing.map((row) => `${row.source_salesman_id}:${row.viewer_salesman_id}`),
  );
  const pairs = buildDefaultSharePairs(allProfiles).filter(
    (pair) => !existingKeys.has(`${pair.source_salesman_id}:${pair.viewer_salesman_id}`),
  );

  if (!pairs.length) {
    return { seeded: 0, tableMissing: false };
  }

  const payload = pairs.map((pair) => ({
    source_salesman_id: pair.source_salesman_id,
    viewer_salesman_id: pair.viewer_salesman_id,
    is_active: true,
    created_by: createdBy || null,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await admin.from("customer_book_shares").insert(payload);
  if (error) throw error;

  return { seeded: payload.length, tableMissing: false };
}

export async function loadShareRowsForScope(admin, allProfiles = []) {
  let rows = await loadActiveCustomerBookShareRows(admin);
  if (rows === null) return null;

  if (!rows.length && (allProfiles || []).length) {
    try {
      await ensureDefaultCustomerBookShares(admin, allProfiles);
      rows = await loadActiveCustomerBookShareRows(admin);
    } catch {
      // Keep empty rows; callers fall back to hardcoded books only when rows === null.
    }
  }

  return rows || [];
}

export function salesmanLabel(profile) {
  const name = normalizeSalesmanName(profile?.salesman_name);
  const code = normalizeSalesmanCode(profile?.salesman_code);
  if (name && code && name !== code) return `${name} (${code})`;
  return name || code || "Unknown";
}
