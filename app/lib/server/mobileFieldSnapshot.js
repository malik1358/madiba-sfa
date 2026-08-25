import { buildCollectionQueues } from "../paymentCollections.js";
import { buildScopeHash, buildSnapshotKey } from "../scopeHash.js";
import { filterPendingOrdersForScope, PENDING_ORDER_STATUSES, PENDING_ORDERS_SELECT } from "../pendingOrdersQuery.js";
import { buildVisibleCustomersForScope, resolveScopeForUserId } from "../../api/customers/visible/route.js";
import {
  fetchOutstandingAndCollectionRecords,
  getSalesScope,
} from "../../api/payment-collections/route.js";
import { resolveSalesScopeForUserId } from "../../api/user/sales-scope/route.js";

export const SNAPSHOT_SETTING_PREFIX = "mobile_field_snapshot_v1:";
export const SNAPSHOT_META_KEY = "mobile_field_snapshot_meta_v1";

function snapshotSettingKey(snapshotKey) {
  return `${SNAPSHOT_SETTING_PREFIX}${snapshotKey}`;
}

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase();
}

function isFieldUserRole(role) {
  const normalized = normalizeRole(role);
  return [
    "salesman",
    "manager",
    "admin",
    "collector",
    "invoice_maker",
    "invoice-maker",
    "product-promoter",
    "product_promoter",
  ].includes(normalized);
}

async function fetchPendingOrdersForScope(admin, salesScope) {
  const { data, error } = await admin
    .from("sales_orders")
    .select(PENDING_ORDERS_SELECT)
    .in("status", PENDING_ORDER_STATUSES)
    .order("updated_at", { ascending: false })
    .limit(500);

  if (error) throw error;

  return filterPendingOrdersForScope(data, salesScope);
}

export async function buildMobileFieldSnapshot(admin, userId) {
  const [salesScope, collectionScope, customerScope] = await Promise.all([
    resolveSalesScopeForUserId(admin, userId),
    getSalesScope(admin, userId),
    resolveScopeForUserId(admin, userId),
  ]);

  const snapshotKey = buildSnapshotKey(collectionScope, customerScope);

  const [records, enrichedCustomers, basicCustomers, itemsRes, pendingOrders] = await Promise.all([
    fetchOutstandingAndCollectionRecords(admin, collectionScope),
    buildVisibleCustomersForScope(admin, customerScope, {
      includeRecentSales: true,
      includeOutstanding: true,
    }),
    buildVisibleCustomersForScope(admin, customerScope, {
      includeRecentSales: false,
      includeOutstanding: false,
    }),
    admin.from("items_master").select("*"),
    fetchPendingOrdersForScope(admin, salesScope),
  ]);

  if (itemsRes.error) throw itemsRes.error;

  const collectionQueues = buildCollectionQueues(records);
  const items = itemsRes.data || [];

  return {
    version: Date.now(),
    builtAt: new Date().toISOString(),
    snapshotKey,
    userId,
    salesScope,
    customerScope: {
      hasAllAccess: customerScope.hasAllAccess,
      visibleSalesmanCodes: customerScope.visibleSalesmanCodes,
    },
    collectionScope: {
      hasAllAccess: collectionScope.hasAllAccess,
      visibleSalesmanCodes: collectionScope.visibleSalesmanCodes,
    },
    collectionScopeHash: buildScopeHash(collectionScope),
    customerScopeHash: buildScopeHash(customerScope),
    collectionQueues: {
      dueCustomers: collectionQueues.dueCustomers || [],
      notDueCustomers: collectionQueues.notDueCustomers || [],
      legalCustomers: collectionQueues.legalCustomers || [],
    },
    customersBasic: basicCustomers.customers || [],
    customersEnriched: {
      customers: enrichedCustomers.customers || [],
      inactiveCustomers: enrichedCustomers.inactiveCustomers || [],
    },
    itemsMaster: {
      rows: items,
      status: `SUCCESS: ${items.length} rows`,
    },
    pendingOrders,
  };
}

async function readSnapshotMeta(admin) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", SNAPSHOT_META_KEY)
    .maybeSingle();

  if (error) throw error;

  try {
    return JSON.parse(data?.setting_value || "null") || {};
  } catch {
    return {};
  }
}

async function writeSnapshotMeta(admin, meta) {
  const { error } = await admin
    .from("system_settings")
    .upsert({
      setting_key: SNAPSHOT_META_KEY,
      setting_value: JSON.stringify(meta),
    }, { onConflict: "setting_key" });

  if (error) throw error;
}

export async function saveMobileFieldSnapshot(admin, snapshot) {
  const key = snapshotSettingKey(snapshot.snapshotKey);
  const { error } = await admin
    .from("system_settings")
    .upsert({
      setting_key: key,
      setting_value: JSON.stringify(snapshot),
    }, { onConflict: "setting_key" });

  if (error) throw error;
}

export async function readMobileFieldSnapshot(admin, snapshotKey) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", snapshotSettingKey(snapshotKey))
    .maybeSingle();

  if (error) throw error;

  try {
    return JSON.parse(data?.setting_value || "null");
  } catch {
    return null;
  }
}

export async function resolveSnapshotKeyForUser(admin, userId) {
  const [collectionScope, customerScope] = await Promise.all([
    getSalesScope(admin, userId),
    resolveScopeForUserId(admin, userId),
  ]);
  return buildSnapshotKey(collectionScope, customerScope);
}

export async function getMobileFieldSnapshotForUser(admin, userId) {
  const snapshotKey = await resolveSnapshotKeyForUser(admin, userId);
  let snapshot = await readMobileFieldSnapshot(admin, snapshotKey);

  if (!snapshot) {
    snapshot = await buildMobileFieldSnapshot(admin, userId);
    await saveMobileFieldSnapshot(admin, snapshot);
    const meta = await readSnapshotMeta(admin);
    meta[snapshotKey] = {
      builtAt: snapshot.builtAt,
      version: snapshot.version,
    };
    meta.userSnapshotKeys = {
      ...(meta.userSnapshotKeys || {}),
      [userId]: snapshotKey,
    };
    await writeSnapshotMeta(admin, meta);
  }

  return snapshot;
}

export async function rebuildAllMobileFieldSnapshots(admin, options = {}) {
  const trigger = String(options.trigger || "upload");
  const startedAt = new Date().toISOString();

  const { data: profiles, error: profilesError } = await admin
    .from("profiles")
    .select("id,role")
    .order("salesman_name");

  if (profilesError) throw profilesError;

  const fieldUsers = (profiles || []).filter((profile) => isFieldUserRole(profile.role));
  const uniqueKeys = new Map();

  for (const profile of fieldUsers) {
    try {
      const snapshotKey = await resolveSnapshotKeyForUser(admin, profile.id);
      if (!uniqueKeys.has(snapshotKey)) {
        uniqueKeys.set(snapshotKey, profile.id);
      }
    } catch {
      // Skip users we cannot resolve.
    }
  }

  const builtSnapshots = {};
  const userSnapshotKeys = {};

  for (const [snapshotKey, sampleUserId] of uniqueKeys.entries()) {
    try {
      const snapshot = await buildMobileFieldSnapshot(admin, sampleUserId);
      await saveMobileFieldSnapshot(admin, snapshot);
      builtSnapshots[snapshotKey] = {
        builtAt: snapshot.builtAt,
        version: snapshot.version,
      };
    } catch (error) {
      builtSnapshots[snapshotKey] = {
        error: error?.message || "build failed",
      };
    }
  }

  for (const profile of fieldUsers) {
    try {
      userSnapshotKeys[profile.id] = await resolveSnapshotKeyForUser(admin, profile.id);
    } catch {
      // Ignore mapping failures for individual users.
    }
  }

  const meta = {
    lastRebuildAt: new Date().toISOString(),
    lastRebuildStartedAt: startedAt,
    lastRebuildTrigger: trigger,
    snapshotCount: Object.keys(builtSnapshots).length,
    snapshots: builtSnapshots,
    userSnapshotKeys,
  };

  await writeSnapshotMeta(admin, meta);
  return meta;
}

export async function scheduleMobileFieldSnapshotRebuild(admin, options = {}) {
  return rebuildAllMobileFieldSnapshots(admin, options);
}
