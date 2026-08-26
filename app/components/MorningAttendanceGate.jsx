"use client";

import { useEffect, useRef, useState } from "react";
import { useModuleAccess } from "../hooks/useModuleAccess";
import { shouldRequireTransactionGps } from "../lib/moduleAccess";
import { getSupabaseClient } from "../lib/supabase";
import { translate, useAppLanguage } from "../lib/appLanguage";
import { detectTable } from "../lib/schemaGuards";
import { autoCloseForgottenWorkdays, BACKGROUND_GPS_IDLE_MS, IDLE_GPS_ACTIVITY_ENTRY_TYPES, shouldCaptureIdleGpsPing } from "../lib/workdayActivity";
import { NATIVE_WORKDAY_READY_EVENT } from "../lib/nativeFieldTracking";
import {
  isAndroidBatteryRestricted,
  openAndroidBatterySettings,
  requestAndroidBatteryUnrestricted,
} from "../lib/androidBatteryOptimization";
import { evaluateNativeAndroidApkVersion } from "../lib/androidAppVersion";
import { isNativeAndroidPlatform } from "../lib/nativeFieldTracking";
import AndroidApkUpdateRequired from "./AndroidApkUpdateRequired";
import WorkdayInactivityPrompt from "./WorkdayInactivityPrompt";
import { buildGpsActivityNote, GPS_PERMISSION_DENIED_ERROR, GPS_POSITION_UNAVAILABLE_ERROR, GPS_UNSUPPORTED_ERROR, probeGpsLocationWithRetries, resolveGpsCapturePlatform } from "../lib/geo";
import { hasMorningAttendanceToday, MORNING_ATTENDANCE_COMPLETE_EVENT } from "../lib/morningAttendance";
import { usePopupMessages } from "../hooks/usePopupMessages";

const TEXT = {
  checking: { en: "Checking morning attendance...", ar: "جاري التحقق من حضور الصباح..." },
  capturing: { en: "Capturing GPS for morning attendance...", ar: "جاري التقاط GPS لحضور الصباح..." },
  title: { en: "Morning Attendance Required", ar: "حضور الصباح مطلوب" },
  description: { en: "You must complete morning attendance before starting work today.", ar: "يجب تسجيل حضور الصباح قبل بدء العمل اليوم." },
  gpsHelp: { en: "Allow location access to auto-capture GPS and continue.", ar: "اسمح بالوصول إلى الموقع لالتقاط GPS تلقائياً والمتابعة." },
  retry: { en: "Retry Attendance", ar: "إعادة محاولة الحضور" },
  locationUnsupported: { en: "Geolocation is not supported on this device.", ar: "خدمة تحديد الموقع غير مدعومة على هذا الجهاز." },
  locationFailed: { en: "Unable to read GPS location. Please allow location and retry.", ar: "تعذر قراءة موقع GPS. يرجى السماح بالموقع وإعادة المحاولة." },
  logsUnavailableBypass: {
    en: "Attendance log table is unavailable. Access is allowed, but attendance logging is temporarily disabled.",
    ar: "جدول سجلات الحضور غير متاح. تم السماح بالدخول، لكن تسجيل الحضور معطل مؤقتاً.",
  },
  sessionCheckFailed: {
    en: "Unable to verify attendance status right now. You can continue, but attendance may not be recorded.",
    ar: "تعذر التحقق من حضور الصباح الآن. يمكنك المتابعة، لكن قد لا يتم تسجيل الحضور.",
  },
  batteryTitle: { en: "Battery must be Unrestricted", ar: "يجب ضبط البطارية على غير مقيد" },
  batteryDescription: {
    en: "MADIBA needs unrestricted battery access on this phone so idle GPS tracking works while you are in the field. Open settings, choose MADIBA SFA, and set Battery to Unrestricted, then tap Check again.",
    ar: "يحتاج MADIBA إلى وصول غير مقيد للبطارية على هذا الهاتف حتى يعمل تتبع GPS أثناء العمل. افتح الإعدادات، اختر MADIBA SFA، واضبط البطارية على غير مقيد، ثم اضغط تحقق مرة أخرى.",
  },
  openBatterySettings: { en: "Open battery settings", ar: "فتح إعدادات البطارية" },
  allowUnrestrictedBattery: { en: "Allow unrestricted battery", ar: "السماح ببطارية غير مقيدة" },
  checkBatteryAgain: { en: "Check again", ar: "تحقق مرة أخرى" },
  checkingBattery: { en: "Checking battery settings...", ar: "جاري التحقق من إعدادات البطارية..." },
  locationTitle: { en: "Location access required", ar: "الوصول إلى الموقع مطلوب" },
  locationDescription: {
    en: "MADIBA cannot work without GPS. Allow location access for this app in your browser or phone settings, then tap Check again.",
    ar: "لا يمكن لـ MADIBA العمل بدون GPS. اسمح بالوصول إلى الموقع لهذا التطبيق في المتصفح أو إعدادات الهاتف، ثم اضغط تحقق مرة أخرى.",
  },
  checkingLocation: { en: "Checking location access...", ar: "جاري التحقق من الوصول إلى الموقع..." },
  checkLocationAgain: { en: "Check location again", ar: "تحقق من الموقع مرة أخرى" },
  locationPermissionDenied: {
    en: "Location permission is blocked. Enable location for MADIBA SFA to continue.",
    ar: "إذن الموقع محظور. فعّل الموقع لتطبيق MADIBA SFA للمتابعة.",
  },
  locationUnsupported: { en: "Geolocation is not supported on this device.", ar: "خدمة تحديد الموقع غير مدعومة على هذا الجهاز." },
  locationUnavailable: {
    en: "Unable to read GPS right now. Move to an open area and try again.",
    ar: "تعذر قراءة GPS الآن. انتقل إلى منطقة مفتوحة وحاول مرة أخرى.",
  },
};

async function captureLocation() {
  return probeGpsLocationWithRetries();
}

function gpsVerifiedStorageKey(userId) {
  return `madiba-sfa:gps-verified:${userId}`;
}

function isGpsVerifiedForSession(userId) {
  if (typeof window === "undefined" || !userId) return false;
  try {
    return window.sessionStorage.getItem(gpsVerifiedStorageKey(userId)) === "1";
  } catch {
    return false;
  }
}

function markGpsVerifiedForSession(userId) {
  if (typeof window === "undefined" || !userId) return;
  try {
    window.sessionStorage.setItem(gpsVerifiedStorageKey(userId), "1");
  } catch {
    // Ignore storage failures.
  }
}

function clearGpsVerifiedForSession(userId) {
  if (typeof window === "undefined" || !userId) return;
  try {
    window.sessionStorage.removeItem(gpsVerifiedStorageKey(userId));
  } catch {
    // Ignore storage failures.
  }
}

function readCapturedAt(note, fallbackDate) {
  try {
    const parsed = JSON.parse(String(note || ""));
    const capturedAt = parsed?.captured_at || fallbackDate;
    const ts = new Date(capturedAt).getTime();
    return Number.isFinite(ts) ? ts : 0;
  } catch {
    const ts = new Date(fallbackDate || "").getTime();
    return Number.isFinite(ts) ? ts : 0;
  }
}

const BACKGROUND_GPS_CHECK_MS = 5 * 60 * 1000;

function backgroundGpsStorageKey(userId, suffix) {
  return `madiba-sfa:bg-gps:${userId}:${suffix}`;
}

function readStoredTimestamp(userId, suffix) {
  if (typeof window === "undefined" || !userId) return 0;
  try {
    const ts = Number(window.sessionStorage.getItem(backgroundGpsStorageKey(userId, suffix)) || 0);
    return Number.isFinite(ts) ? ts : 0;
  } catch {
    return 0;
  }
}

function writeStoredTimestamp(userId, suffix, value) {
  if (typeof window === "undefined" || !userId) return;
  try {
    window.sessionStorage.setItem(backgroundGpsStorageKey(userId, suffix), String(value));
  } catch {
    // Ignore storage failures.
  }
}

function withTimeout(promise, timeoutMs, timeoutMessage = "REQUEST_TIMEOUT") {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    }),
  ]);
}

async function getSessionWithTimeout(supabase, timeoutMs = 10000) {
  const { data, error } = await withTimeout(
    supabase.auth.getSession(),
    timeoutMs,
    "SESSION_TIMEOUT",
  );
  if (error) throw error;
  return data?.session || null;
}

export default function MorningAttendanceGate({
  children,
  requireMorningAttendance = true,
  enableBackgroundGps = true,
}) {
  const { language, dir } = useAppLanguage();
  const { access, loading: accessLoading } = useModuleAccess();
  const t = translate(language, TEXT);
  const attendanceRequired = requireMorningAttendance
    && access.role !== "admin"
    && shouldRequireTransactionGps(access.role);
  const backgroundGpsEnabled = enableBackgroundGps && shouldRequireTransactionGps(access.role);
  const batteryCheckRequired = shouldRequireTransactionGps(access.role);
  const locationCheckRequired = shouldRequireTransactionGps(access.role);
  const [checking, setChecking] = useState(requireMorningAttendance);
  const [ready, setReady] = useState(!requireMorningAttendance);
  const [attendanceComplete, setAttendanceComplete] = useState(!requireMorningAttendance);
  const [batteryReady, setBatteryReady] = useState(false);
  const [checkingBattery, setCheckingBattery] = useState(false);
  const [locationReady, setLocationReady] = useState(false);
  const [checkingLocation, setCheckingLocation] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [apkVersionReady, setApkVersionReady] = useState(true);
  const [checkingApkVersion, setCheckingApkVersion] = useState(false);
  const [apkVersionState, setApkVersionState] = useState(null);
  const [nativeAndroidApp, setNativeAndroidApp] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  usePopupMessages({ error, warnings: warning ? [warning] : [] });
  const autoPingInFlightRef = useRef(false);
  const lastGpsPingAtRef = useRef(0);
  const lastActivityAtRef = useRef(0);

  async function verifyApkVersion() {
    const isNative = await isNativeAndroidPlatform();
    setNativeAndroidApp(isNative);
    if (!isNative) {
      setApkVersionReady(true);
      setApkVersionState(null);
      return true;
    }

    setCheckingApkVersion(true);
    try {
      const result = await evaluateNativeAndroidApkVersion();
      setApkVersionState(result);
      const allowed = !result.outdated;
      setApkVersionReady(allowed);
      return allowed;
    } catch {
      setApkVersionReady(true);
      setApkVersionState(null);
      return true;
    } finally {
      setCheckingApkVersion(false);
    }
  }

  async function verifyLocationAccess(hasActiveSession = true, options = {}) {
    const forceRecheck = options.force === true;

    if (!locationCheckRequired || !hasActiveSession) {
      setLocationReady(true);
      setLocationError("");
      return true;
    }

    let userId = "";
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const session = await getSessionWithTimeout(supabase);
        userId = session?.user?.id || "";
      } catch {
        userId = "";
      }
    }

    if (!forceRecheck && userId && isGpsVerifiedForSession(userId)) {
      setLocationReady(true);
      setLocationError("");
      return true;
    }

    setCheckingLocation(true);
    setLocationError("");

    try {
      await probeGpsLocationWithRetries({ attempts: 3 });
      if (userId) markGpsVerifiedForSession(userId);
      setLocationReady(true);
      setLocationError("");
      return true;
    } catch (err) {
      if (userId) clearGpsVerifiedForSession(userId);
      const reason = String(err?.message || "");
      if (reason === GPS_PERMISSION_DENIED_ERROR) {
        setLocationError(t("locationPermissionDenied"));
      } else if (reason === GPS_UNSUPPORTED_ERROR) {
        setLocationError(t("locationUnsupported"));
      } else if (reason === GPS_POSITION_UNAVAILABLE_ERROR) {
        setLocationError(t("locationUnavailable"));
      } else {
        setLocationError(t("locationFailed"));
      }
      setLocationReady(false);
      return false;
    } finally {
      setCheckingLocation(false);
    }
  }

  async function verifyBatteryAccess() {
    if (!batteryCheckRequired) {
      setBatteryReady(true);
      return true;
    }

    setCheckingBattery(true);
    try {
      const restricted = await isAndroidBatteryRestricted();
      setBatteryReady(!restricted);
      return !restricted;
    } catch {
      setBatteryReady(true);
      return true;
    } finally {
      setCheckingBattery(false);
    }
  }

  async function refreshWorkdayState() {
    const supabase = getSupabaseClient();
    let hasActiveSession = false;

    if (supabase) {
      try {
        const session = await getSessionWithTimeout(supabase);
        hasActiveSession = Boolean(session?.user?.id);
      } catch {
        hasActiveSession = false;
      }
    }

    const locationOk = await verifyLocationAccess(hasActiveSession);
    if (!locationOk) {
      setReady(false);
      setChecking(false);
      return;
    }

    const batteryOk = await verifyBatteryAccess();
    if (!batteryOk) {
      setReady(false);
      setChecking(false);
      return;
    }

    const apkOk = await verifyApkVersion();
    if (!apkOk) {
      setReady(false);
      setChecking(false);
      return;
    }

    if (!supabase) {
      setAttendanceComplete(true);
      setReady(true);
      setChecking(false);
      return;
    }

    setChecking(true);
    setError("");
    setWarning("");

    try {
      const session = await getSessionWithTimeout(supabase);

      if (!session?.user?.id) {
        setLocationReady(true);
        setAttendanceComplete(true);
        setReady(true);
        return;
      }

      try {
        await autoCloseForgottenWorkdays(supabase, session.user.id);
      } catch {
        // Do not block access if auto-close fails.
      }

      if (!attendanceRequired) {
        setAttendanceComplete(true);
        setReady(true);
        return;
      }

      const logsTable = await withTimeout(
        detectTable(supabase, "daily_activity_logs"),
        10000,
        "ATTENDANCE_CHECK_TIMEOUT",
      );
      if (!logsTable.available) {
        setWarning(t("logsUnavailableBypass"));
        setAttendanceComplete(false);
        setReady(true);
        return;
      }

      const hasAttendance = await hasMorningAttendanceToday(supabase, session.user.id);
      setAttendanceComplete(hasAttendance);
      if (hasAttendance) {
        await hydrateActivityTimestamps(session.user.id);
      }
      setReady(true);
    } catch (err) {
      const message = String(err.message || "");
      if (message === "SESSION_TIMEOUT" || message === "ATTENDANCE_CHECK_TIMEOUT") {
        setWarning(t("sessionCheckFailed"));
        setAttendanceComplete(false);
        setReady(true);
        return;
      }
      setError(err.message || t("sessionCheckFailed"));
      setAttendanceComplete(false);
      setReady(false);
    } finally {
      setChecking(false);
    }
  }

  async function captureBackgroundPing(sessionUserId) {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const location = await captureLocation();
    const nowIso = new Date().toISOString();
    const platform = await resolveGpsCapturePlatform();

    const payload = {
      user_id: sessionUserId,
      entry_type: "GPS_PING",
      note: buildGpsActivityNote("GPS_PING", location, {
        captured_at: nowIso,
        source: "web_idle",
        platform,
      }),
    };

    const { error: insertError } = await supabase.from("daily_activity_logs").insert(payload);
    if (insertError) throw insertError;

    const capturedTs = new Date(nowIso).getTime();
    lastGpsPingAtRef.current = capturedTs;
    writeStoredTimestamp(sessionUserId, "lastPing", capturedTs);
  }

  async function hydrateActivityTimestamps(sessionUserId) {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const { data, error: latestError } = await supabase
      .from("daily_activity_logs")
      .select("entry_type,note,created_at")
      .eq("user_id", sessionUserId)
      .in("entry_type", [...IDLE_GPS_ACTIVITY_ENTRY_TYPES, "GPS_PING"])
      .gte("created_at", start.toISOString())
      .order("created_at", { ascending: false })
      .limit(200);

    if (latestError) return;

    let lastGpsPingTs = readStoredTimestamp(sessionUserId, "lastPing");
    let lastActivityTs = 0;

    (data || []).forEach((row) => {
      const ts = readCapturedAt(row?.note, row?.created_at);
      if (row.entry_type === "GPS_PING") {
        lastGpsPingTs = Math.max(lastGpsPingTs, ts);
      }
      if (IDLE_GPS_ACTIVITY_ENTRY_TYPES.includes(row.entry_type)) {
        lastActivityTs = Math.max(lastActivityTs, ts);
      }
    });

    lastGpsPingAtRef.current = lastGpsPingTs;
    lastActivityAtRef.current = lastActivityTs;
    writeStoredTimestamp(sessionUserId, "lastPing", lastGpsPingTs);
    writeStoredTimestamp(sessionUserId, "lastActivity", lastActivityTs);
  }

  async function maybeCaptureBackgroundPing() {
    if (autoPingInFlightRef.current) return;

    const supabase = getSupabaseClient();
    if (!supabase) return;

    autoPingInFlightRef.current = true;
    try {
      const {
        data: { session },
      } = await withTimeout(
        supabase.auth.getSession(),
        10000,
        "SESSION_TIMEOUT",
      );

      const userId = session?.user?.id;
      if (!userId) return;

      await hydrateActivityTimestamps(userId);

      const now = Date.now();
      const lastActivityTs = Math.max(
        lastActivityAtRef.current || 0,
        readStoredTimestamp(userId, "lastActivity"),
      );
      const lastGpsPingTs = Math.max(
        lastGpsPingAtRef.current || 0,
        readStoredTimestamp(userId, "lastPing"),
      );

      if (!shouldCaptureIdleGpsPing({ now, lastActivityTs, lastGpsPingTs, idleMs: BACKGROUND_GPS_IDLE_MS })) {
        return;
      }

      await captureBackgroundPing(userId);
    } catch {
      // Ignore background GPS failures; user can continue working.
    } finally {
      autoPingInFlightRef.current = false;
    }
  }

  useEffect(() => {
    let cancelled = false;

    isNativeAndroidPlatform().then((isNative) => {
      if (!cancelled) setNativeAndroidApp(isNative);
    });

    verifyApkVersion();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (accessLoading) return undefined;

    if (!batteryCheckRequired) {
      setBatteryReady(true);
      return undefined;
    }

    verifyBatteryAccess();
    return undefined;
  }, [accessLoading, batteryCheckRequired]);

  useEffect(() => {
    if (accessLoading) {
      return undefined;
    }

    if (!attendanceRequired) {
      let cancelled = false;

      async function runAutoClose() {
        const supabase = getSupabaseClient();
        if (!supabase || cancelled) return;

        try {
          const session = await getSessionWithTimeout(supabase);
          if (session?.user?.id && !cancelled) {
            await autoCloseForgottenWorkdays(supabase, session.user.id);
          }
        } catch {
          // Do not block access if auto-close fails.
        }
      }

      async function runBatteryAndAutoClose() {
        const apkOk = await verifyApkVersion();
        if (cancelled) return;
        if (!apkOk) {
          setReady(false);
          setChecking(false);
          return;
        }

        const batteryOk = await verifyBatteryAccess();
        if (cancelled) return;
        if (!batteryOk) {
          setReady(false);
          setChecking(false);
          return;
        }

        const supabase = getSupabaseClient();
        let hasActiveSession = false;
        if (supabase) {
          try {
            const session = await getSessionWithTimeout(supabase);
            hasActiveSession = Boolean(session?.user?.id);
          } catch {
            hasActiveSession = false;
          }
        }

        const locationOk = await verifyLocationAccess(hasActiveSession);
        if (cancelled) return;
        if (!locationOk) {
          setReady(false);
          setChecking(false);
          return;
        }

        await runAutoClose();
        if (!cancelled) {
          setReady(true);
          setChecking(false);
        }
      }

      runBatteryAndAutoClose();

      return () => {
        cancelled = true;
      };
    }

    refreshWorkdayState();

    const safetyTimer = window.setTimeout(() => {
      setWarning((current) => current || t("sessionCheckFailed"));
      setReady(true);
      setChecking(false);
    }, 12000);

    function handleAttendanceComplete() {
      setAttendanceComplete(true);
      refreshWorkdayState();
    }

    window.addEventListener(MORNING_ATTENDANCE_COMPLETE_EVENT, handleAttendanceComplete);

    return () => {
      window.clearTimeout(safetyTimer);
      window.removeEventListener(MORNING_ATTENDANCE_COMPLETE_EVENT, handleAttendanceComplete);
    };
  }, [attendanceRequired, accessLoading, batteryCheckRequired]);

  useEffect(() => {
    if (!nativeAndroidApp || apkVersionReady) return undefined;

    let cancelled = false;

    async function recheckOnResume() {
      if (cancelled) return;
      await verifyApkVersion();
    }

    const handleResume = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      recheckOnResume();
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleResume);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("focus", handleResume);
    }

    return () => {
      cancelled = true;
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleResume);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", handleResume);
      }
    };
  }, [nativeAndroidApp, apkVersionReady]);

  useEffect(() => {
    if (!locationCheckRequired || locationReady || accessLoading) return undefined;

    let cancelled = false;

    async function recheckOnResume() {
      if (cancelled) return;
      await verifyLocationAccess(true);
    }

    const handleResume = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      recheckOnResume();
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleResume);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("focus", handleResume);
    }

    return () => {
      cancelled = true;
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleResume);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", handleResume);
      }
    };
  }, [locationCheckRequired, locationReady, accessLoading]);

  useEffect(() => {
    if (!batteryCheckRequired || batteryReady || accessLoading) return undefined;

    let cancelled = false;

    async function recheckOnResume() {
      if (cancelled) return;
      await verifyBatteryAccess();
    }

    const handleResume = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      recheckOnResume();
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleResume);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("focus", handleResume);
    }

    return () => {
      cancelled = true;
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleResume);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", handleResume);
      }
    };
  }, [batteryCheckRequired, batteryReady, accessLoading]);

  useEffect(() => {
    if (!backgroundGpsEnabled) return undefined;

    const backgroundGpsReady = (attendanceRequired ? attendanceComplete : ready)
      && batteryReady
      && apkVersionReady
      && locationReady;
    if (!backgroundGpsReady) return undefined;

    let cancelled = false;

    async function startBackgroundGps() {
      const supabase = getSupabaseClient();
      if (!supabase) return;

      try {
        const session = await getSessionWithTimeout(supabase);
        const userId = session?.user?.id;
        if (!userId || cancelled) return;

        await hydrateActivityTimestamps(userId);
      } catch {
        // Background GPS should not block page access.
      }
    }

    startBackgroundGps();

    const timer = window.setInterval(() => {
      maybeCaptureBackgroundPing();
    }, BACKGROUND_GPS_CHECK_MS);

    let focusTimer = 0;
    const handleVisibleOrFocused = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      window.clearTimeout(focusTimer);
      focusTimer = window.setTimeout(() => {
        maybeCaptureBackgroundPing();
      }, 1000);
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibleOrFocused);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("focus", handleVisibleOrFocused);
      window.addEventListener("online", handleVisibleOrFocused);
    }

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.clearTimeout(focusTimer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibleOrFocused);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", handleVisibleOrFocused);
        window.removeEventListener("online", handleVisibleOrFocused);
      }
    };
  }, [backgroundGpsEnabled, attendanceRequired, attendanceComplete, ready, batteryReady, apkVersionReady, locationReady]);

  useEffect(() => {
    if (!ready || !batteryReady || !apkVersionReady || !backgroundGpsEnabled || typeof window === "undefined") return undefined;
    if (attendanceRequired && !attendanceComplete) return undefined;

    let cancelled = false;
    const supabase = getSupabaseClient();
    if (!supabase) return undefined;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const userId = data?.session?.user?.id;
      if (!userId) return;
      window.dispatchEvent(new CustomEvent(NATIVE_WORKDAY_READY_EVENT, {
        detail: { userId, trackingEnabled: true },
      }));
    }).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [backgroundGpsEnabled, attendanceComplete, attendanceRequired, ready, batteryReady, apkVersionReady, locationReady]);

  if (accessLoading && requireMorningAttendance) {
    return (
      <main className="modulePage" dir={dir}>
        <div className="moduleShell">
          <section className="moduleSection">
            <div className="moduleSectionHeader">
              <h2>{t("checking")}</h2>
            </div>
          </section>
        </div>
      </main>
    );
  }

  if (ready && batteryReady && apkVersionReady && locationReady) {
    return (
      <>
        {attendanceRequired && attendanceComplete ? <WorkdayInactivityPrompt /> : null}
        {children}
      </>
    );
  }

  if (nativeAndroidApp && !apkVersionReady) {
    return (
      <AndroidApkUpdateRequired
        currentVersion={apkVersionState?.current}
        minimum={apkVersionState?.minimum}
        checking={checkingApkVersion}
        onRecheck={() => verifyApkVersion()}
      />
    );
  }

  if (locationCheckRequired && !locationReady) {
    return (
      <main className="modulePage" dir={dir}>
        <div className="moduleShell">
          <section className="moduleSection">
            <div className="moduleSectionHeader">
              <h2>{checkingLocation ? t("checkingLocation") : t("locationTitle")}</h2>
            </div>
            {!checkingLocation && (
              <>
                <div className="moduleHint">{locationError || t("locationDescription")}</div>
                <div className="moduleActionRow">
                  <button
                    type="button"
                    className="modulePrimaryButton"
                    onClick={() => verifyLocationAccess(true, { force: true })}
                  >
                    {t("checkLocationAgain")}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      </main>
    );
  }

  if (batteryCheckRequired && !batteryReady) {
    return (
      <main className="modulePage" dir={dir}>
        <div className="moduleShell">
          <section className="moduleSection">
            <div className="moduleSectionHeader">
              <h2>{checkingBattery ? t("checkingBattery") : t("batteryTitle")}</h2>
            </div>
            {!checkingBattery && (
              <>
                <div className="moduleHint">{t("batteryDescription")}</div>
                <div className="moduleActionRow">
                  <button
                    type="button"
                    className="modulePrimaryButton"
                    onClick={() => requestAndroidBatteryUnrestricted().catch(() => openAndroidBatterySettings())}
                  >
                    {t("allowUnrestrictedBattery")}
                  </button>
                  <button
                    type="button"
                    className="moduleInlineButton moduleActionButton"
                    onClick={() => openAndroidBatterySettings()}
                  >
                    {t("openBatterySettings")}
                  </button>
                  <button
                    type="button"
                    className="moduleInlineButton moduleActionButton"
                    onClick={() => verifyBatteryAccess()}
                  >
                    {t("checkBatteryAgain")}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="modulePage" dir={dir}>
      <div className="moduleShell">
        <section className="moduleSection">
          <div className="moduleSectionHeader">
            <h2>{checking ? t("checking") : t("title")}</h2>
          </div>
          {!checking && error ? (
            <button type="button" className="modulePrimaryButton" onClick={() => refreshWorkdayState()}>
              {t("retry")}
            </button>
          ) : null}
        </section>
      </div>
    </main>
  );
}