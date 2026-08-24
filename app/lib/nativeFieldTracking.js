import {
  BACKGROUND_GPS_IDLE_MS,
  IDLE_GPS_ACTIVITY_ENTRY_TYPES,
  INACTIVITY_MS,
  INACTIVITY_ALERT_REPEAT_MS,
  getInactivityAlertMessage,
  shouldCaptureIdleGpsPing,
  shouldWarnInactivity,
  ksaDayBounds,
  getKsaDateString,
  logEventTimestamp,
  isWithinActiveWorkSession,
} from "./workdayActivity.js";
import { getSupabaseClient } from "./supabase.js";
import { fetchJsonWithTimeout, resolveAuthSession } from "./authSession.js";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const FOREGROUND_CHANNEL_ID = "madiba-field-tracking";
const PUSH_ALERTS_CHANNEL_ID = "madiba-push-alerts";
const INACTIVITY_NOTIFICATION_ID = 9045;
const TRACKING_PREFS_PREFIX = "madiba.nativeTracking.";

let trackingTimer = null;
let activeUserId = null;
let cycleInFlight = false;
let appStateListener = null;
let visibilityListener = null;

export const NATIVE_WORKDAY_READY_EVENT = "madiba-workday-ready";
export const NATIVE_WORKDAY_STOP_EVENT = "madiba-workday-stop";

export async function isNativeAndroidPlatform() {
  if (typeof window === "undefined") return false;
  try {
    const { Capacitor } = await import("@capacitor/core");
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  } catch {
    return false;
  }
}

function prefKey(userId, suffix) {
  return `${TRACKING_PREFS_PREFIX}${userId}.${suffix}`;
}

async function readPrefNumber(userId, suffix) {
  try {
    const { Preferences } = await import("@capacitor/preferences");
    const { value } = await Preferences.get({ key: prefKey(userId, suffix) });
    return Number(value || 0);
  } catch {
    return 0;
  }
}

async function writePrefNumber(userId, suffix, value) {
  try {
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.set({ key: prefKey(userId, suffix), value: String(value) });
  } catch {
    // Ignore preference write failures.
  }
}

function readCapturedAt(note, createdAt) {
  try {
    const parsed = typeof note === "string" ? JSON.parse(note) : note;
    const capturedAt = Date.parse(String(parsed?.captured_at || ""));
    if (Number.isFinite(capturedAt)) return capturedAt;
  } catch {
    // Fall back to created_at below.
  }
  const fallback = Date.parse(String(createdAt || ""));
  return Number.isFinite(fallback) ? fallback : 0;
}

async function hydrateActivityTimestamps(userId) {
  const supabase = getSupabaseClient();
  if (!supabase) return { lastActivityTs: 0, lastGpsPingTs: 0, workdayEnded: false };

  const reportDate = getKsaDateString();
  const { startIso, endIso } = ksaDayBounds(reportDate);

  const { data, error } = await supabase
    .from("daily_activity_logs")
    .select("entry_type,note,created_at")
    .eq("user_id", userId)
    .in("entry_type", [...IDLE_GPS_ACTIVITY_ENTRY_TYPES, "GPS_PING", "END_OF_DAY"])
    .gte("created_at", startIso)
    .lte("created_at", endIso)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw error;

  let lastGpsPingTs = await readPrefNumber(userId, "lastPing");
  let lastActivityTs = 0;
  let workdayEnded = false;

  (data || []).forEach((row) => {
    const ts = readCapturedAt(row?.note, row?.created_at);
    if (row.entry_type === "END_OF_DAY") workdayEnded = true;
    if (row.entry_type === "GPS_PING") lastGpsPingTs = Math.max(lastGpsPingTs, ts);
    if (IDLE_GPS_ACTIVITY_ENTRY_TYPES.includes(row.entry_type)) {
      lastActivityTs = Math.max(lastActivityTs, ts);
    }
  });

  await writePrefNumber(userId, "lastPing", lastGpsPingTs);
  await writePrefNumber(userId, "lastActivity", lastActivityTs);

  return { lastActivityTs, lastGpsPingTs, workdayEnded };
}

async function captureNativeLocation() {
  const { Geolocation } = await import("@capacitor/geolocation");
  const position = await Geolocation.getCurrentPosition({
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 0,
  });

  return {
    latitude: Number(position.coords.latitude.toFixed(6)),
    longitude: Number(position.coords.longitude.toFixed(6)),
    accuracy: Number(position.coords.accuracy.toFixed(1)),
  };
}

async function postGpsPing(accessToken, location) {
  const { response, payload } = await fetchJsonWithTimeout(
    "/api/gps-ping",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...location,
        source: "native_foreground_service",
        platform: "android",
      }),
    },
    20000,
  );

  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error || "Unable to save GPS ping.");
  }

  if (payload.skipped) return false;
  return true;
}

async function ensureNativePermissions() {
  const { Geolocation } = await import("@capacitor/geolocation");
  await Geolocation.requestPermissions();

  const { ForegroundService } = await import("@capawesome-team/capacitor-android-foreground-service");
  await ForegroundService.createNotificationChannel({
    id: FOREGROUND_CHANNEL_ID,
    name: "Field tracking",
    description: "Shows when MADIBA is tracking field location during the workday.",
    importance: 3,
  }).catch(() => {});

  await ForegroundService.requestPermissions().catch(() => {});

  const { LocalNotifications } = await import("@capacitor/local-notifications");
  await LocalNotifications.requestPermissions().catch(() => {});
  await LocalNotifications.createChannel({
    id: PUSH_ALERTS_CHANNEL_ID,
    name: "MADIBA alerts",
    description: "Remote push alerts from MADIBA during the workday.",
    importance: 4,
    visibility: 1,
  }).catch(() => {});

  const { PushNotifications } = await import("@capacitor/push-notifications");
  await PushNotifications.requestPermissions().catch(() => {});
}

async function startForegroundServiceNotification() {
  const { ForegroundService, ServiceType } = await import("@capawesome-team/capacitor-android-foreground-service");
  await ForegroundService.startForegroundService({
    id: 1001,
    title: "MADIBA field tracking active",
    body: "Location is checked during your workday for attendance monitoring.",
    smallIcon: "ic_launcher",
    notificationChannelId: FOREGROUND_CHANNEL_ID,
    serviceType: ServiceType.Location,
    silent: true,
  });
}

async function registerPushNotifications(userId) {
  const { PushNotifications } = await import("@capacitor/push-notifications");
  const supabase = getSupabaseClient();
  if (!supabase) return;

  await PushNotifications.addListener("registration", async (event) => {
    try {
      const session = await resolveAuthSession(supabase, 8000);
      if (!session?.access_token || !event?.value) return;

      await fetchJsonWithTimeout(
        "/api/push-tokens",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            token: event.value,
            platform: "android",
          }),
        },
        15000,
      );
    } catch {
      // Push token registration is best-effort until Firebase is configured.
    }
  }).catch(() => {});

  await PushNotifications.addListener("registrationError", () => {}).catch(() => {});

  await PushNotifications.register().catch(() => {});
}

async function maybeShowInactivityNotification(userId, lastActivityTs, loginAt) {
  const lastInactivityAlertTs = await readPrefNumber(userId, "lastInactivityAlert");
  const now = Date.now();

  if (lastInactivityAlertTs && now - lastInactivityAlertTs < INACTIVITY_ALERT_REPEAT_MS) {
    return;
  }

  if (!lastActivityTs || now - lastActivityTs < INACTIVITY_MS) {
    return;
  }

  const language = typeof window !== "undefined"
    && window.localStorage.getItem("madiba-language") === "ar"
    ? "ar"
    : "en";
  const { title, body } = getInactivityAlertMessage(language);

  const { LocalNotifications } = await import("@capacitor/local-notifications");
  await LocalNotifications.schedule({
    notifications: [{
      id: INACTIVITY_NOTIFICATION_ID,
      title,
      body,
      channelId: FOREGROUND_CHANNEL_ID,
      smallIcon: "ic_launcher",
      schedule: { at: new Date(now + 1000) },
    }],
  });

  await writePrefNumber(userId, "lastInactivityAlert", now);
}

async function runTrackingCycle(userId) {
  if (cycleInFlight || !userId) return;
  cycleInFlight = true;

  try {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const session = await resolveAuthSession(supabase, 8000);
    if (!session?.access_token || session.user?.id !== userId) return;

    const { lastActivityTs, lastGpsPingTs, workdayEnded } = await hydrateActivityTimestamps(userId);
    if (workdayEnded) {
      await stopNativeFieldTracking();
      return;
    }

    const reportDate = getKsaDateString();
    const { startIso, endIso } = ksaDayBounds(reportDate);
    const { data: logs } = await supabase
      .from("daily_activity_logs")
      .select("entry_type,note,created_at")
      .eq("user_id", userId)
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .order("created_at", { ascending: true });

    const loginLog = (logs || []).find((row) => row.entry_type === "MORNING_ATTENDANCE");
    const logoutLog = [...(logs || [])].reverse().find((row) => row.entry_type === "END_OF_DAY");
    const loginAt = loginLog
      ? new Date(logEventTimestamp(loginLog) || loginLog.created_at).toISOString()
      : null;
    const logoutAt = logoutLog
      ? new Date(logEventTimestamp(logoutLog) || logoutLog.created_at).toISOString()
      : null;

    if (!isWithinActiveWorkSession({
      loginAt,
      logoutAt,
      userLogs: logs || [],
    })) {
      return;
    }

    const now = Date.now();
    if (shouldCaptureIdleGpsPing({
      now,
      lastActivityTs,
      lastGpsPingTs,
      idleMs: BACKGROUND_GPS_IDLE_MS,
    })) {
      const location = await captureNativeLocation();
      const saved = await postGpsPing(session.access_token, location);
      if (saved) {
        await writePrefNumber(userId, "lastPing", now);
      }
    }

    const [{ data: collections }, { data: orders }] = await Promise.all([
      supabase
        .from("collection_visits")
        .select("saved_at")
        .eq("created_by", userId)
        .gte("saved_at", startIso)
        .lte("saved_at", endIso),
      supabase
        .from("sales_orders")
        .select("created_at,updated_at,submitted_at")
        .eq("created_by", userId)
        .gte("updated_at", startIso)
        .lte("updated_at", endIso),
    ]);

    if (shouldWarnInactivity({
      loginAt,
      logoutAt,
      userLogs: logs || [],
      collections: collections || [],
      orders: orders || [],
    })) {
      await maybeShowInactivityNotification(userId, lastActivityTs, loginAt);
    }
  } catch {
    // Native tracking should never block the app shell.
  } finally {
    cycleInFlight = false;
  }
}

async function installResumeListeners(userId) {
  if (!(await isNativeAndroidPlatform())) return;

  if (appStateListener) {
    await appStateListener.remove().catch(() => {});
    appStateListener = null;
  }

  try {
    const { App } = await import("@capacitor/app");
    appStateListener = await App.addListener("appStateChange", ({ isActive }) => {
      if (isActive && activeUserId === userId) {
        runTrackingCycle(userId);
      }
    });
  } catch {
    // Resume catch-up is best-effort when App plugin is unavailable.
  }

  if (typeof document !== "undefined") {
    if (visibilityListener) {
      document.removeEventListener("visibilitychange", visibilityListener);
    }
    visibilityListener = () => {
      if (document.visibilityState === "visible" && activeUserId === userId) {
        runTrackingCycle(userId);
      }
    };
    document.addEventListener("visibilitychange", visibilityListener);
  }
}

export async function startNativeFieldTracking(userId) {
  if (!userId || !(await isNativeAndroidPlatform())) return;
  if (activeUserId === userId && trackingTimer) return;

  await stopNativeFieldTracking();
  activeUserId = userId;

  await ensureNativePermissions();
  await startForegroundServiceNotification();
  await registerPushNotifications(userId);
  await installResumeListeners(userId);

  await runTrackingCycle(userId);
  trackingTimer = window.setInterval(() => {
    runTrackingCycle(userId);
  }, CHECK_INTERVAL_MS);
}

export async function stopNativeFieldTracking() {
  if (trackingTimer) {
    window.clearInterval(trackingTimer);
    trackingTimer = null;
  }

  if (appStateListener) {
    await appStateListener.remove().catch(() => {});
    appStateListener = null;
  }

  if (visibilityListener && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", visibilityListener);
    visibilityListener = null;
  }

  activeUserId = null;

  if (!(await isNativeAndroidPlatform())) return;

  try {
    const { ForegroundService } = await import("@capawesome-team/capacitor-android-foreground-service");
    await ForegroundService.stopForegroundService();
  } catch {
    // Ignore stop failures.
  }
}

export function installNativeFieldTrackingListeners() {
  if (typeof window === "undefined") return () => {};

  const onReady = (event) => {
    const userId = String(event?.detail?.userId || "").trim();
    const enabled = event?.detail?.trackingEnabled !== false;
    if (!userId || !enabled) return;
    startNativeFieldTracking(userId);
  };

  const onStop = () => {
    stopNativeFieldTracking();
  };

  window.addEventListener(NATIVE_WORKDAY_READY_EVENT, onReady);
  window.addEventListener(NATIVE_WORKDAY_STOP_EVENT, onStop);

  return () => {
    window.removeEventListener(NATIVE_WORKDAY_READY_EVENT, onReady);
    window.removeEventListener(NATIVE_WORKDAY_STOP_EVENT, onStop);
    stopNativeFieldTracking();
  };
}
