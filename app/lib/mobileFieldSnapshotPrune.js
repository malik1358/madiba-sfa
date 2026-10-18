export const SNAPSHOT_SETTING_PREFIX = "mobile_field_snapshot_v1:";

export function snapshotSettingKey(snapshotKey) {
  return `${SNAPSHOT_SETTING_PREFIX}${snapshotKey}`;
}

/** Keep only snapshot keys still referenced by meta; stale keys bloat system_settings toast. */
export function listActiveMobileSnapshotSettingKeys(meta) {
  const keys = new Set();
  const snapshots = meta?.snapshots && typeof meta.snapshots === "object" ? meta.snapshots : {};
  for (const snapshotKey of Object.keys(snapshots)) {
    if (snapshotKey) keys.add(snapshotSettingKey(snapshotKey));
  }
  const userKeys = meta?.userSnapshotKeys && typeof meta.userSnapshotKeys === "object"
    ? meta.userSnapshotKeys
    : {};
  for (const snapshotKey of Object.values(userKeys)) {
    if (snapshotKey) keys.add(snapshotSettingKey(String(snapshotKey)));
  }
  return [...keys];
}

export async function pruneOrphanMobileFieldSnapshots(admin, meta) {
  if (!meta || typeof meta !== "object") {
    throw new Error("Snapshot meta is required to prune orphans");
  }
  const keep = new Set(listActiveMobileSnapshotSettingKeys(meta));
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_key")
    .like("setting_key", `${SNAPSHOT_SETTING_PREFIX}%`);
  if (error) throw error;

  const orphanKeys = (data || [])
    .map((row) => row?.setting_key)
    .filter((key) => key && !keep.has(key));
  if (!orphanKeys.length) {
    return { deleted: 0, kept: keep.size, orphans: [] };
  }

  const { error: deleteError } = await admin
    .from("system_settings")
    .delete()
    .in("setting_key", orphanKeys);
  if (deleteError) throw deleteError;

  return { deleted: orphanKeys.length, kept: keep.size, orphans: orphanKeys };
}
