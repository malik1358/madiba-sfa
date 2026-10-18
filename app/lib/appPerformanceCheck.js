import { sendEmail } from "./mailer.js";
import { isWithinTeamEmailWindow } from "./workdayActivity.js";
import { getKsaDateString, getKsaDateTimeParts } from "./workdayActivity.js";

export const APP_PERFORMANCE_SETTING_KEY = "app_performance_daily_v1";
export const APP_PERFORMANCE_HISTORY_DAYS = 90;
export const APP_PERFORMANCE_EMAIL_TO = "malik@pinasz.com";
export const APP_PERFORMANCE_SLOTS_PER_DAY = 4;
export const APP_PERFORMANCE_DB_PING_KEY = "active_sales_batch_id";
export const APP_PERFORMANCE_DB_PROBE_ATTEMPTS = 2;
export const APP_PERFORMANCE_SPEED_KEYS = [
  "external_build_info_ms",
  "build_info_ms",
  "auth_health_ms",
  "db_ping_ms",
  "customers_count_ms",
  "recent_orders_ms",
];

const DEFAULT_APP_ORIGIN = "https://madiba-sfa.vercel.app";

export function median(numbers) {
  const values = (Array.isArray(numbers) ? numbers : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (!values.length) return null;
  const middle = Math.floor(values.length / 2);
  if (values.length % 2) return values[middle];
  return (values[middle - 1] + values[middle]) / 2;
}

export function parsePerformanceHistory(raw) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw || "null") : raw;
    const checks = Array.isArray(parsed?.checks) ? parsed.checks : [];
    return { version: 1, checks };
  } catch {
    return { version: 1, checks: [] };
  }
}

export function performanceSlot(date, checkedAt) {
  const hour = getKsaDateTimeParts(new Date(checkedAt)).hour;
  return `${date}T${String(hour).padStart(2, "0")}`;
}

export function withDailyCheck(stored, check, limit = APP_PERFORMANCE_HISTORY_DAYS * APP_PERFORMANCE_SLOTS_PER_DAY) {
  const checks = (Array.isArray(stored?.checks) ? stored.checks : [])
    .filter((row) => !(check.slot && row?.slot === check.slot));
  checks.push(check);
  checks.sort((left, right) => String(left.checkedAt || left.slot || left.date).localeCompare(String(right.checkedAt || right.slot || right.date)));
  return {
    version: 1,
    checks: checks.slice(-Math.max(1, Number(limit) || (APP_PERFORMANCE_HISTORY_DAYS * APP_PERFORMANCE_SLOTS_PER_DAY))),
  };
}

const METRIC_LABELS = {
  external_build_info_ms: "Public app, from outside",
  build_info_ms: "Public app, from the server",
  auth_health_ms: "Sign-in service",
  db_ping_ms: "Database read",
  customers_count_ms: "Customer count",
  recent_orders_ms: "Recent orders",
};

export function shouldEmailPerformanceCheck(check, previousSlot) {
  if (check?.status !== "slower" && check?.status !== "error") return false;
  return !previousSlot?.emailedAt;
}

export function buildPerformanceEmail(check, to = APP_PERFORMANCE_EMAIL_TO) {
  const when = check.checkedAt || check.slot || check.date;
  const slowerLines = (check.slower || []).map((key) => {
    const label = METRIC_LABELS[key] || key;
    const value = check.metrics?.[key];
    return `${label}: ${value} ms`;
  });
  const errorLines = Object.entries(check.errors || {}).map(([key, message]) => `${key}: ${message}`);
  const detail = check.status === "error"
    ? errorLines.join("\n")
    : slowerLines.join("\n");
  const subject = check.status === "error"
    ? "MADIBA app performance check failed"
    : "MADIBA app is slower";
  const text = [
    subject,
    `Checked at ${when} (KSA date ${check.date}).`,
    detail,
    check.status === "slower"
      ? "This run is both 50% and at least 200 ms above the median of earlier samples."
      : "",
  ].filter(Boolean).join("\n");
  return {
    to,
    subject,
    text,
    html: `<p>${subject}</p><p>Checked at ${when} (KSA date ${check.date}).</p><pre>${detail}</pre>`,
  };
}

export function judgeDailySpeed(priorChecks, metrics, {
  minSamples = 3,
  ratio = 1.5,
  minDeltaMs = 200,
} = {}) {
  const prior = Array.isArray(priorChecks) ? priorChecks : [];
  const slower = [];

  for (const key of APP_PERFORMANCE_SPEED_KEYS) {
    const current = Number(metrics?.[key]);
    if (!Number.isFinite(current)) continue;
    const samples = prior
      .map((row) => Number(row?.metrics?.[key]))
      .filter((value) => Number.isFinite(value));
    if (samples.length < minSamples) continue;
    const base = median(samples);
    if (!Number.isFinite(base)) continue;
    if (current > base * ratio && current > base + minDeltaMs) slower.push(key);
  }

  if (prior.length < minSamples) {
    return { status: prior.length ? "collecting" : "baseline", slower };
  }
  return { status: slower.length ? "slower" : "steady", slower };
}

export function buildDailyPerformanceRecord({
  date,
  checkedAt,
  metrics,
  counts,
  errors,
  priorChecks,
}) {
  const problemKeys = Object.keys(errors || {}).filter((key) => errors[key]);
  if (problemKeys.length) {
    return {
      date,
      checkedAt,
      metrics,
      counts,
      errors,
      status: "error",
      slower: [],
    };
  }

  const judged = judgeDailySpeed(priorChecks, metrics);
  return {
    date,
    checkedAt,
    metrics,
    counts,
    status: judged.status,
    slower: judged.slower,
  };
}

async function timeCall(fn) {
  const started = Date.now();
  try {
    const value = await fn();
    return { ms: Date.now() - started, ok: true, value };
  } catch (error) {
    return {
      ms: Date.now() - started,
      ok: false,
      error: error?.message || "Check failed",
    };
  }
}

function finiteMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 120000) return null;
  return Math.round(number);
}

/** Keep the fastest successful attempt so one cold pooler hit does not mark the day slower. */
export function pickBestProbeAttempt(attempts) {
  const rows = Array.isArray(attempts) ? attempts : [];
  const okRows = rows.filter((row) => row?.ok);
  if (!okRows.length) {
    const last = rows[rows.length - 1] || { ok: false, ms: 0, error: "Check failed" };
    return last;
  }
  return okRows.reduce((best, row) => (row.ms < best.ms ? row : best));
}

async function timeBestCall(fn, attempts = APP_PERFORMANCE_DB_PROBE_ATTEMPTS) {
  const count = Math.max(1, Number(attempts) || 1);
  const results = [];
  for (let index = 0; index < count; index += 1) {
    results.push(await timeCall(fn));
  }
  return pickBestProbeAttempt(results);
}

async function warmDatabaseConnection(admin) {
  await admin
    .from("system_settings")
    .select("setting_key")
    .eq("setting_key", APP_PERFORMANCE_DB_PING_KEY)
    .maybeSingle();
}

async function collectProbeResults(admin, {
  fetchImpl,
  appOrigin,
  supabaseUrl,
  supabaseKey,
  now,
  dbProbeAttempts = APP_PERFORMANCE_DB_PROBE_ATTEMPTS,
}) {
  const buildInfo = await timeCall(async () => {
    const response = await fetchImpl(`${appOrigin}/api/build-info`, { cache: "no-store" });
    if (!response.ok) throw new Error(`build-info ${response.status}`);
  });

  const authHealth = await timeCall(async () => {
    if (!supabaseUrl) throw new Error("Supabase URL missing");
    const response = await fetchImpl(`${supabaseUrl}/auth/v1/health`, {
      headers: supabaseKey ? { apikey: supabaseKey } : {},
      cache: "no-store",
    });
    if (!response.ok && response.status !== 401) throw new Error(`auth health ${response.status}`);
  });

  // Discard one settings round-trip so the timed probes do not pay TLS/pooler cold start alone.
  await warmDatabaseConnection(admin);

  const dbPing = await timeBestCall(async () => {
    const { error } = await admin
      .from("system_settings")
      .select("setting_key")
      .eq("setting_key", APP_PERFORMANCE_DB_PING_KEY)
      .maybeSingle();
    if (error) throw new Error(error.message);
  }, dbProbeAttempts);

  const customers = await timeBestCall(async () => {
    const { count, error } = await admin
      .from("customers")
      .select("customer_code", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    return count;
  }, dbProbeAttempts);

  const since = new Date(now.getTime() - (2 * 24 * 60 * 60 * 1000)).toISOString();
  const orders = await timeBestCall(async () => {
    const { count, error } = await admin
      .from("sales_orders")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since);
    if (error) throw new Error(error.message);
    return count;
  }, dbProbeAttempts);

  return { buildInfo, authHealth, dbPing, customers, orders };
}

export async function runAppPerformanceCheck(admin, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const date = options.date || getKsaDateString(now);
  const fetchImpl = options.fetchImpl || fetch;
  const probes = options.probeResults || await collectProbeResults(admin, {
    fetchImpl,
    appOrigin: options.appOrigin || DEFAULT_APP_ORIGIN,
    supabaseUrl: options.supabaseUrl || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    supabaseKey: options.supabaseKey || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "",
    now,
    dbProbeAttempts: options.dbProbeAttempts,
  });

  const metrics = {
    external_build_info_ms: finiteMs(options.externalBuildInfoMs),
    build_info_ms: probes.buildInfo.ok ? probes.buildInfo.ms : null,
    auth_health_ms: probes.authHealth.ok ? probes.authHealth.ms : null,
    db_ping_ms: probes.dbPing.ok ? probes.dbPing.ms : null,
    customers_count_ms: probes.customers.ok ? probes.customers.ms : null,
    recent_orders_ms: probes.orders.ok ? probes.orders.ms : null,
  };
  const errors = {};
  if (!probes.buildInfo.ok) errors.build_info = probes.buildInfo.error;
  if (!probes.authHealth.ok) errors.auth_health = probes.authHealth.error;
  if (!probes.dbPing.ok) errors.db_ping = probes.dbPing.error;
  if (!probes.customers.ok) errors.customers = probes.customers.error;
  if (!probes.orders.ok) errors.recent_orders = probes.orders.error;

  const { data, error: readError } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", APP_PERFORMANCE_SETTING_KEY)
    .maybeSingle();
  if (readError) throw new Error(readError.message || "Unable to read performance history");

  const history = parsePerformanceHistory(data?.setting_value);
  const slot = performanceSlot(date, now.toISOString());
  const previousSlot = history.checks.find((row) => row?.slot === slot);
  const priorChecks = history.checks.filter((row) => row?.slot !== slot);
  const check = buildDailyPerformanceRecord({
    date,
    checkedAt: now.toISOString(),
    metrics,
    counts: {
      customers: Number.isFinite(Number(probes.customers.value)) ? Number(probes.customers.value) : null,
      recent_orders: Number.isFinite(Number(probes.orders.value)) ? Number(probes.orders.value) : null,
    },
    errors,
    priorChecks,
  });
  check.slot = slot;

  const emailTo = options.emailTo || process.env.APP_PERFORMANCE_EMAIL_TO || APP_PERFORMANCE_EMAIL_TO;
  let emailed = false;
  if (shouldEmailPerformanceCheck(check, previousSlot) && isWithinTeamEmailWindow(now)) {
    const send = options.sendEmail || sendEmail;
    await send(buildPerformanceEmail(check, emailTo));
    check.emailedAt = now.toISOString();
    emailed = true;
  }

  const next = withDailyCheck(history, check);
  const { error: saveError } = await admin.from("system_settings").upsert({
    setting_key: APP_PERFORMANCE_SETTING_KEY,
    setting_value: JSON.stringify(next),
    updated_at: now.toISOString(),
  }, { onConflict: "setting_key" });
  if (saveError) throw new Error(saveError.message || "Unable to store performance history");

  return { ...check, historyDays: next.checks.length, emailed };
}
