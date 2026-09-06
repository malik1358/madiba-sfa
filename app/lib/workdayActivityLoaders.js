import { shouldRequireTransactionGps } from "./moduleAccess.js";
import { isMissingSchemaColumn } from "./performanceKpis.js";
import { ksaDayBounds } from "./workdayActivity.js";

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase().replace(/_/g, "-");
}

export function isFieldAttendanceRole(role) {
  const normalized = normalizeRole(role);
  return normalized === "salesman" || normalized === "collector";
}

export async function loadActiveFieldUsers(admin, reportDate) {
  const { startIso, endIso } = ksaDayBounds(reportDate);

  const [{ data: morningRows, error: morningError }, { data: endRows, error: endError }] = await Promise.all([
    admin
      .from("daily_activity_logs")
      .select("user_id,note,created_at")
      .eq("entry_type", "MORNING_ATTENDANCE")
      .gte("created_at", startIso)
      .lte("created_at", endIso),
    admin
      .from("daily_activity_logs")
      .select("user_id")
      .eq("entry_type", "END_OF_DAY")
      .gte("created_at", startIso)
      .lte("created_at", endIso),
  ]);

  if (morningError) throw morningError;
  if (endError) throw endError;

  const endedUserIds = new Set((endRows || []).map((row) => row.user_id));
  const loginByUserId = new Map();

  (morningRows || []).forEach((row) => {
    if (!row?.user_id || endedUserIds.has(row.user_id)) return;
    if (loginByUserId.has(row.user_id)) return;
    loginByUserId.set(row.user_id, row);
  });

  const userIds = [...loginByUserId.keys()];
  if (userIds.length === 0) {
    return [];
  }

  const { data: profiles, error: profileError } = await admin
    .from("profiles")
    .select("id,role,preferred_language")
    .in("id", userIds);

  if (profileError) throw profileError;

  const profileByUserId = new Map((profiles || []).map((row) => [row.id, row]));

  return userIds
    .filter((userId) => shouldRequireTransactionGps(normalizeRole(profileByUserId.get(userId)?.role)))
    .map((userId) => ({
      userId,
      loginLog: loginByUserId.get(userId),
      preferredLanguage: profileByUserId.get(userId)?.preferred_language || "en",
    }));
}

export async function loadUsersPendingMorningLogin(admin, reportDate) {
  const { startIso, endIso } = ksaDayBounds(reportDate);
  const profileSelect = "id,role,is_active,preferred_language";
  const profileFallback = "id,role,preferred_language";

  let profilesRes = await admin.from("profiles").select(profileSelect);
  if (profilesRes.error && isMissingSchemaColumn(profilesRes.error)) {
    profilesRes = await admin.from("profiles").select(profileFallback);
  }
  if (profilesRes.error) throw profilesRes.error;

  const { data: morningRows, error: morningError } = await admin
    .from("daily_activity_logs")
    .select("user_id")
    .eq("entry_type", "MORNING_ATTENDANCE")
    .gte("created_at", startIso)
    .lte("created_at", endIso);

  if (morningError) throw morningError;

  const loggedIn = new Set((morningRows || []).map((row) => row.user_id).filter(Boolean));

  return (profilesRes.data || [])
    .filter((profile) => profile.is_active !== false)
    .filter((profile) => isFieldAttendanceRole(profile.role))
    .filter((profile) => !loggedIn.has(profile.id))
    .map((profile) => ({
      userId: profile.id,
      preferredLanguage: profile.preferred_language || "en",
    }));
}

export async function loadUserActivity(admin, userId, startIso, endIso) {
  const [{ data: logs, error: logsError }, { data: collections, error: collectionsError }, { data: orders, error: ordersError }] =
    await Promise.all([
      admin
        .from("daily_activity_logs")
        .select("entry_type,note,created_at")
        .eq("user_id", userId)
        .gte("created_at", startIso)
        .lte("created_at", endIso)
        .order("created_at", { ascending: true }),
      admin
        .from("collection_visits")
        .select("saved_at")
        .eq("created_by", userId)
        .gte("saved_at", startIso)
        .lte("saved_at", endIso),
      admin
        .from("sales_orders")
        .select("created_at,updated_at,submitted_at")
        .eq("created_by", userId)
        .gte("updated_at", startIso)
        .lte("updated_at", endIso),
    ]);

  if (logsError) throw logsError;
  if (collectionsError) throw collectionsError;
  if (ordersError) throw ordersError;

  return {
    logs: logs || [],
    collections: collections || [],
    orders: orders || [],
  };
}
