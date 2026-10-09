export const DATABASE_CRON = "17 0,6,12,18 * * *";
export const FULL_CRON = "47 23 * * *";
export const BACKUP_PREFIX = "madiba-sfa";

export function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required setting: ${name}`);
  return value;
}

export function readBackupConfig(env, mode) {
  if (!["database", "full"].includes(mode)) throw new Error("Invalid backup mode");
  const projectRef = required(env, "BACKUP_SUPABASE_PROJECT_REF");
  if (!/^[a-z]{20}$/.test(projectRef)) throw new Error("Invalid Supabase project reference");
  let database;
  let supabase;
  try {
    database = new URL(required(env, "BACKUP_DATABASE_URL"));
    supabase = new URL(required(env, "BACKUP_SUPABASE_URL"));
  } catch {
    throw new Error("Invalid backup connection URL");
  }
  if (supabase.href !== `https://${projectRef}.supabase.co/`) {
    throw new Error("Storage URL does not match the explicitly selected backup project");
  }
  const direct = database.hostname === `db.${projectRef}.supabase.co`;
  const pooler = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(database.hostname);
  const user = decodeURIComponent(database.username);
  if (!["postgres:", "postgresql:"].includes(database.protocol)
    || !(direct || (pooler && user === `postgres.${projectRef}`))
    || (database.port && database.port !== "5432")
    || database.pathname !== "/postgres"
    || !database.password
    || database.searchParams.get("sslmode") !== "require") {
    throw new Error("Use the selected project's direct or SESSION pooler URL on port 5432 with sslmode=require");
  }
  const recipient = required(env, "BACKUP_AGE_RECIPIENT");
  if (!/^age1[0-9a-z]{58}$/.test(recipient)) throw new Error("Expected an age public recipient, not a private key");
  const drivePath = env.BACKUP_DRIVE_PATH?.trim() || "gdrive:MADIBA-SFA-Backups";
  if (!/^gdrive:[A-Za-z0-9_-]+$/.test(drivePath)) throw new Error("Use a dedicated, single-level gdrive backup folder");
  const rcloneConfig = required(env, "BACKUP_RCLONE_CONFIG");
  if (!/^\[gdrive\]\s*$/m.test(rcloneConfig)
    || (rcloneConfig.match(/^\[[^\]]+\]\s*$/gm) || []).length !== 1
    || !/^type\s*=\s*drive\s*$/m.test(rcloneConfig)
    || !/^scope\s*=\s*drive\.file\s*$/m.test(rcloneConfig)
    || !/^client_id\s*=\s*\S+\s*$/m.test(rcloneConfig)
    || !/^client_secret\s*=\s*\S+\s*$/m.test(rcloneConfig)) {
    throw new Error("Rclone configuration must contain only gdrive, with drive.file scope and your own OAuth client");
  }
  try {
    const token = JSON.parse(rcloneConfig.match(/^token\s*=\s*(.+)$/m)?.[1] || "{}");
    if (!token.refresh_token) throw new Error();
  } catch { throw new Error("Rclone configuration needs an OAuth refresh token"); }
  const config = {
    mode, projectRef, supabaseUrl: supabase.origin,
    serviceKey: required(env, "BACKUP_SUPABASE_SERVICE_ROLE_KEY"),
    recipient, drivePath, rcloneConfig,
    pgEnv: {
      PGHOST: database.hostname, PGPORT: "5432", PGDATABASE: "postgres",
      PGUSER: user, PGPASSWORD: decodeURIComponent(database.password),
      PGSSLMODE: "require", PGCONNECT_TIMEOUT: "30",
      PGOPTIONS: "-c default_transaction_read_only=on",
    },
  };
  if (mode === "full") {
    config.supabaseAccessToken = required(env, "BACKUP_SUPABASE_ACCESS_TOKEN");
    config.vercelToken = required(env, "BACKUP_VERCEL_TOKEN");
    config.vercelProjectId = required(env, "BACKUP_VERCEL_PROJECT_ID");
    config.vercelTeamId = env.BACKUP_VERCEL_TEAM_ID?.trim() || "";
    try {
      config.recoveryInventory = JSON.parse(required(env, "BACKUP_RECOVERY_INVENTORY_JSON"));
    } catch {
      throw new Error("BACKUP_RECOVERY_INVENTORY_JSON must be valid JSON");
    }
    if (!config.recoveryInventory || Array.isArray(config.recoveryInventory)
      || typeof config.recoveryInventory !== "object"
      || Object.keys(config.recoveryInventory).some((key) => !["vaultReference", "secretNames"].includes(key))
      || typeof config.recoveryInventory.vaultReference !== "string"
      || !config.recoveryInventory.vaultReference.trim()
      || !Array.isArray(config.recoveryInventory.secretNames)
      || !config.recoveryInventory.secretNames.length
      || config.recoveryInventory.secretNames.some((name) => typeof name !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(name))) {
      throw new Error("Recovery inventory must contain only a vaultReference and a nonempty array of secretNames; never secret values");
    }
  }
  return config;
}

export function backupName(mode, date, runId = "manual") {
  if (!["database", "full"].includes(mode) || !/^[a-zA-Z0-9-]+$/.test(runId)) {
    throw new Error("Invalid backup identity");
  }
  const stamp = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return `${BACKUP_PREFIX}-${mode}-${stamp}-${runId}.tar.gz.age`;
}

export function parseBackupName(name) {
  const match = /^madiba-sfa-(database|full)-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-([a-zA-Z0-9-]+)\.tar\.gz\.age$/.exec(name);
  if (!match) return null;
  const iso = `${match[2]}-${match[3]}-${match[4]}T${match[5]}:${match[6]}:${match[7]}Z`;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== iso.slice(0, 19)) return null;
  const ksaDay = new Date(date.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { name, mode: match[1], date, ksaDay, month: ksaDay.slice(0, 7) };
}

export function retentionCandidates(names, now = new Date()) {
  const backups = names.map(parseBackupName).filter(Boolean)
    .sort((left, right) => right.date - left.date);
  const keep = new Set();
  const days = new Set();
  const months = new Set();
  for (const backup of backups.filter((entry) => entry.mode === "full")) {
    if (!days.has(backup.ksaDay) && days.size < 30) {
      days.add(backup.ksaDay);
      keep.add(backup.name);
    }
    if (!months.has(backup.month) && months.size < 12) {
      months.add(backup.month);
      keep.add(backup.name);
    }
    if (backup.date > now) keep.add(backup.name);
  }
  const databases = backups.filter((entry) => entry.mode === "database");
  if (databases[0]) keep.add(databases[0].name);
  for (const backup of databases) {
    if (now - backup.date <= 7 * 24 * 60 * 60 * 1000) keep.add(backup.name);
  }
  return backups.filter((backup) => !keep.has(backup.name)).map((backup) => backup.name);
}

export async function listStorageFiles(storage, bucket, prefix = "") {
  const files = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await storage.from(bucket).list(prefix, {
      limit: 1000, offset, sortBy: { column: "name", order: "asc" },
    });
    if (error || !Array.isArray(data)) throw new Error("Storage listing failed; backup is incomplete");
    for (const entry of data) {
      if (!entry.name || entry.name.includes("/") || [".", ".."].includes(entry.name)) {
        throw new Error("Unsafe Storage object name");
      }
      const objectPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id == null && entry.metadata == null) {
        files.push(...await listStorageFiles(storage, bucket, objectPath));
      } else {
        files.push({ bucket, path: objectPath, metadata: entry.metadata || {}, updatedAt: entry.updated_at });
      }
    }
    if (data.length < 1000) return files;
  }
}