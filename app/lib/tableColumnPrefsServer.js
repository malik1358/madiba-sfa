import {
  emptyColumnPrefs,
  mergeTableHidden,
  normalizeHiddenLabels,
  normalizeTableId,
  parseColumnPrefs,
  tableColumnPrefsSettingKey,
} from "./tableColumnVisibility.js";

async function readJsonSetting(admin, key) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", key)
    .maybeSingle();
  if (error) throw error;
  if (data?.setting_value == null) return null;
  return data.setting_value;
}

async function writeJsonSetting(admin, key, value) {
  const { error } = await admin.from("system_settings").upsert({
    setting_key: key,
    setting_value: JSON.stringify(value),
  }, { onConflict: "setting_key" });
  if (error) throw error;
}

export async function loadUserTableColumnPrefs(admin, userId) {
  const key = tableColumnPrefsSettingKey(userId);
  if (!key) return emptyColumnPrefs();
  const raw = await readJsonSetting(admin, key);
  return parseColumnPrefs(raw);
}

export async function saveUserTableHidden(admin, userId, tableId, hiddenLabels) {
  const key = tableColumnPrefsSettingKey(userId);
  const id = normalizeTableId(tableId);
  if (!key || !id) {
    throw new Error("tableId is required.");
  }
  const current = await loadUserTableColumnPrefs(admin, userId);
  const next = mergeTableHidden(current, id, normalizeHiddenLabels(hiddenLabels));
  await writeJsonSetting(admin, key, next);
  return next;
}
