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

const REBUILD_RESUME_MAX_MS = 3 * 60 * 60 * 1000;

async function collectSnapshotPlan(admin, fieldUsers) {
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
  return [...uniqueKeys.entries()].sort((left, right) => String(left[0]).localeCompare(String(right[0])));
}

function rebuildInProgressIsFresh(progress) {
  const startedAt = Date.parse(progress?.startedAt || 0);
  return Number.isFinite(startedAt) && Date.now() - startedAt < REBUILD_RESUME_MAX_MS;
}

export async function rebuildAllMobileFieldSnapshots(admin, options = {}) {
  const trigger = String(options.trigger || "upload");
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const limit = Number(options.limit);
  const batchLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
  const timeBudgetMs = Number(options.timeBudgetMs) > 0 ? Number(options.timeBudgetMs) : 0;
  const requestedCursor = String(options.cursor || "").trim();
  const forceStart = options.start === true;

  const previousMeta = await readSnapshotMeta(admin);
  const previousProgress = previousMeta?.rebuildInProgress || null;

  const { data: profiles, error: profilesError } = await admin
    .from("profiles")
    .select("id,role")
    .order("salesman_name");

  if (profilesError) throw profilesError;

  const fieldUsers = (profiles || []).filter((profile) => isFieldUserRole(profile.role));
  const resume = !forceStart && (
    Boolean(requestedCursor)
    || (options.resume !== false && rebuildInProgressIsFresh(previousProgress))
  );
  const plan = resume && Array.isArray(previousProgress?.plan) && previousProgress.plan.length
    ? previousProgress.plan
    : await collectSnapshotPlan(admin, fieldUsers);

  let startIndex = 0;
  const cursor = requestedCursor || (resume ? String(previousProgress?.nextCursor || "") : "");
  if (cursor) {
    const found = plan.findIndex((entry) => entry?.[0] === cursor);
    startIndex = found >= 0 ? found : 0;
  }

  const builtSnapshots = { ...(previousMeta.snapshots || {}) };
  const processedKeys = [];
  let nextCursor = "";
  let complete = startIndex >= plan.length;

  for (let index = startIndex; index < plan.length; index += 1) {
    if (batchLimit && processedKeys.length >= batchLimit) {
      complete = false;
      nextCursor = plan[index][0];
      break;
    }
    if (timeBudgetMs && processedKeys.length > 0 && Date.now() - startedMs >= timeBudgetMs) {
      complete = false;
      nextCursor = plan[index][0];
      break;
    }

    const [snapshotKey, sampleUserId] = plan[index];
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
    processedKeys.push(snapshotKey);
    nextCursor = plan[index + 1]?.[0] || "";
    complete = !nextCursor;

    const meta = {
      lastRebuildAt: new Date().toISOString(),
      lastRebuildStartedAt: resume ? (previousProgress?.startedAt || previousMeta.lastRebuildStartedAt || startedAt) : startedAt,
      lastRebuildTrigger: trigger,
      snapshotCount: Object.keys(builtSnapshots).length,
      snapshots: builtSnapshots,
      userSnapshotKeys: previousMeta.userSnapshotKeys || {},
      complete,
      nextCursor,
      processedCount: processedKeys.length,
      remainingCount: Math.max(plan.length - index - 1, 0),
      rebuildInProgress: complete ? null : {
        startedAt: resume ? (previousProgress?.startedAt || startedAt) : startedAt,
        trigger,
        nextCursor,
        plan,
        processedKeys: [...(resume ? previousProgress?.processedKeys || [] : []), ...processedKeys],
      },
    };
    await writeSnapshotMeta(admin, meta);

    if (!complete && batchLimit && processedKeys.length >= batchLimit) break;
  }

  let userSnapshotKeys = previousMeta.userSnapshotKeys || {};
  if (complete) {
    userSnapshotKeys = {};
    for (const profile of fieldUsers) {
      try {
        userSnapshotKeys[profile.id] = await resolveSnapshotKeyForUser(admin, profile.id);
      } catch {
        // Ignore mapping failures for individual users.
      }
    }
  }

  const meta = {
    lastRebuildAt: new Date().toISOString(),
    lastRebuildStartedAt: resume ? (previousProgress?.startedAt || previousMeta.lastRebuildStartedAt || startedAt) : startedAt,
    lastRebuildTrigger: trigger,
    snapshotCount: Object.keys(builtSnapshots).length,
    snapshots: builtSnapshots,
    userSnapshotKeys,
    complete,
    nextCursor,
    processedCount: processedKeys.length,
    remainingCount: complete ? 0 : Math.max(plan.length - startIndex - processedKeys.length, 0),
    rebuildInProgress: complete ? null : {
      startedAt: resume ? (previousProgress?.startedAt || startedAt) : startedAt,
      trigger,
      nextCursor,
      plan,
      processedKeys: [...(resume ? previousProgress?.processedKeys || [] : []), ...processedKeys],
    },
  };

  await writeSnapshotMeta(admin, meta);
  return meta;
}

export async function scheduleMobileFieldSnapshotRebuild(admin, options = {}) {
  return rebuildAllMobileFieldSnapshots(admin, {
    limit: 1,
    timeBudgetMs: 20000,
    ...options,
  });
}
