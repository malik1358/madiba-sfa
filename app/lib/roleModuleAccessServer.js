import {
  ROLE_MODULE_ACCESS_SETTING_KEY,
  buildDefaultRoleModuleMatrix,
  normalizeRoleModuleMatrix,
  parseStoredRoleModuleAccess,
} from "./moduleAccess.js";

export async function loadRoleModuleMatrix(admin) {
  const defaults = buildDefaultRoleModuleMatrix();
  if (!admin) {
    return { matrix: defaults, configured: false, updatedAt: null, updatedBy: null };
  }

  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", ROLE_MODULE_ACCESS_SETTING_KEY)
    .maybeSingle();

  if (error) throw error;
  if (!data?.setting_value) {
    return { matrix: defaults, configured: false, updatedAt: null, updatedBy: null };
  }

  const parsed = parseStoredRoleModuleAccess(data.setting_value);
  if (!parsed) {
    return { matrix: defaults, configured: false, updatedAt: null, updatedBy: null };
  }

  return {
    matrix: parsed.matrix,
    configured: true,
    updatedAt: parsed.updatedAt,
    updatedBy: parsed.updatedBy,
  };
}

export async function saveRoleModuleMatrix(admin, matrix, { updatedBy = null } = {}) {
  const normalized = normalizeRoleModuleMatrix(matrix);
  const updatedAt = new Date().toISOString();
  const settingValue = JSON.stringify({
    version: 1,
    updatedAt,
    updatedBy,
    matrix: normalized,
  });

  const { error } = await admin.from("system_settings").upsert(
    {
      setting_key: ROLE_MODULE_ACCESS_SETTING_KEY,
      setting_value: settingValue,
    },
    { onConflict: "setting_key" },
  );
  if (error) throw error;

  return { matrix: normalized, configured: true, updatedAt, updatedBy };
}
