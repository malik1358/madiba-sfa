"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "./lib/supabase";
import { useAppLanguage } from "./lib/appLanguage";
import MorningAttendanceGate from "./components/MorningAttendanceGate";
import MostVisitedPages from "./components/MostVisitedPages";
import SupabaseUnavailable from "./components/SupabaseUnavailable";
import { buildModuleAccess, listAccessibleModules, shouldRequireTransactionGps } from "./lib/moduleAccess";
import { isAndroidBatteryRestricted } from "./lib/androidBatteryOptimization";
import { evaluateNativeAndroidApkVersion } from "./lib/androidAppVersion";
import AndroidApkUpdateRequired from "./components/AndroidApkUpdateRequired";

export default function Home() {
  const { language, ar, dir, setLanguage } = useAppLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);

  const [loading, setLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [error, setError] = useState("");
  const [checkingApkVersion, setCheckingApkVersion] = useState(true);
  const [apkVersionState, setApkVersionState] = useState(null);

  const router = useRouter();
  const moduleAccess = buildModuleAccess({
    role: profile?.role,
    salesmanCode: profile?.salesman_code,
    collectionOnlyMetadata: Boolean(user?.user_metadata?.collection_only),
  });
  const isCollectionOnlyAccess = moduleAccess.collectionOnly;
  const hasManagementAccess = moduleAccess.hasManagementPanel;

  const dashboardModules = listAccessibleModules(moduleAccess, [
    "myDay",
    "customerAudit",
    "newOrder",
    "pendingOrders",
    "newCustomer",
    "myPerformance",
    "myCollections",
    "paymentCollections",
  ]).map((module) => ({
    ...module,
    icon: {
      myDay: "📍",
      customerAudit: "👥",
      newOrder: "🛒",
      pendingOrders: "⏳",
      newCustomer: "➕",
      myPerformance: "🎯",
      myCollections: "💰",
      paymentCollections: "💰",
    }[module.moduleKey] || "•",
    title: {
      myDay: ar ? "يومي" : "My Day",
      customerAudit: ar ? "عملائي" : "My Customers",
      newOrder: ar ? "طلب جديد" : "New Order",
      pendingOrders: ar ? "طلبات معلقة قديمة" : "Old Pending Orders",
      newCustomer: ar ? "عميل جديد" : "New Customer",
      myPerformance: ar ? "أدائي" : "My Performance",
      myCollections: ar ? "التحصيلات" : "My Collections",
      paymentCollections: ar ? "التحصيلات" : "Collections",
    }[module.moduleKey] || module.label,
    subtitle: {
      myDay: ar ? "زيارات ومتابعات اليوم" : "Today's visits & follow-ups",
      customerAudit: ar ? "بحث وسجل العملاء" : "Search & customer history",
      newOrder: ar ? "إنشاء طلب للعميل" : "Create customer order",
      pendingOrders: ar ? "عرض الطلبات غير المكتملة" : "View unfinished draft orders",
      newCustomer: ar ? "تسجيل عميل محتمل" : "Register a new prospect",
      myPerformance: ar ? "الأهداف والنتائج" : "KRA & KPI progress",
      myCollections: ar ? "متابعة التحصيل والزيارات" : "Collection queue and visit tracking",
      paymentCollections: ar ? "متابعة التحصيل والزيارات" : "Collection queue and visit tracking",
    }[module.moduleKey] || "",
  }));

  useEffect(() => {
    const supabase = getSupabaseClient();

    if (!supabase) {
      setLoading(false);
      return;
    }

    checkSession(supabase);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user);
        loadProfile(session.user.id);
      } else {
        setUser(null);
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function verifyApkVersionForLogin() {
      setCheckingApkVersion(true);
      try {
        const result = await evaluateNativeAndroidApkVersion();
        if (!cancelled) setApkVersionState(result);
      } finally {
        if (!cancelled) setCheckingApkVersion(false);
      }
    }

    verifyApkVersionForLogin();

    return () => {
      cancelled = true;
    };
  }, []);

  async function checkSession(supabaseClient = getSupabaseClient()) {
    if (!supabaseClient) {
      setLoading(false);
      return;
    }

    try {
      const sessionResult = await Promise.race([
        supabaseClient.auth.getSession(),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("Session check timed out")), 10000);
        }),
      ]);

      const session = sessionResult?.data?.session;
      if (session?.user) {
        setUser(session.user);
        await loadProfile(session.user.id);
      }
    } catch {
      setUser(null);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadProfile(userId) {
    const supabase = getSupabaseClient();

    if (!supabase) {
      setProfile(null);
      return;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (error) {
      setProfile(null);
      return null;
    }

    setProfile(data);

    if (data?.preferred_language) {
      setLanguage(data.preferred_language);
    }

    return data;
  }

  async function handleLogin(e) {
    e.preventDefault();

    const supabase = getSupabaseClient();

    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }

    setError("");
    setLoginLoading(true);

    const apkStatus = await evaluateNativeAndroidApkVersion();
    setApkVersionState(apkStatus);
    if (apkStatus.outdated) {
      setLoginLoading(false);
      return;
    }

    const { data, error } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      });

    if (error) {
      setError(
        ar
          ? "البريد الإلكتروني أو كلمة المرور غير صحيحة"
          : "Incorrect email or password"
      );

      setLoginLoading(false);
      return;
    }

    if (data?.user) {
      const profileData = await loadProfile(data.user.id);
      if (
        profileData
        && shouldRequireTransactionGps(profileData.role)
        && await isAndroidBatteryRestricted()
      ) {
        await supabase.auth.signOut();
        setUser(null);
        setProfile(null);
        setError(
          ar
            ? "يجب ضبط بطارية MADIBA على غير مقيد قبل تسجيل الدخول. افتح الإعدادات واضبط Battery إلى Unrestricted."
            : "Set MADIBA battery to Unrestricted before signing in. Open settings and choose Battery → Unrestricted."
        );
        setLoginLoading(false);
        return;
      }
      setUser(data.user);
    }

    setLoginLoading(false);
  }

  async function handleLogout() {
    const supabase = getSupabaseClient();
    if (supabase) {
      await supabase.auth.signOut();
    }

    setUser(null);
    setProfile(null);
    setEmail("");
    setPassword("");
  }

  function handleNavigate(path) {
    router.push(path);
  }

  useEffect(() => {
    if (user && profile && isCollectionOnlyAccess) {
      router.replace("/management/payment-collections");
    }
  }, [user, profile, isCollectionOnlyAccess, router]);

  if (loading) {
    return (
      <main className="loginPage">
        <div className="loginCard">
          <div className="loadingText">
            Loading MADIBA SFA...
          </div>
        </div>
      </main>
    );
  }

  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Supabase is not configured"
        message="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to enable authentication and data access."
      />
    );
  }

  // =========================================================
  // DASHBOARD
  // =========================================================

  if (user && profile) {
    if (isCollectionOnlyAccess) {
      return (
        <main className="loginPage">
          <div className="loginCard">
            <div className="loadingText">Loading MADIBA SFA...</div>
          </div>
        </main>
      );
    }
    return (
      <MorningAttendanceGate>
      <main
        className="dashboardPage"
        dir={ar ? "rtl" : "ltr"}
      >
        <header className="dashboardHeader">

          <div className="brand">
            <div className="logo">M</div>

            <div>
              <h1>MADIBA</h1>
              <p>
                {ar
                  ? "نظام إدارة المبيعات"
                  : "Sales Force Automation"}
              </p>
            </div>
          </div>

          <div className="dashboardHeaderActions">
            <MostVisitedPages />
            <button
              className="logoutButton"
              onClick={handleLogout}
            >
              {ar ? "تسجيل الخروج" : "Logout"}
            </button>
          </div>

        </header>

        <section className="dashboardContent">

          <div className="dashboardWelcome">

            <p className="smallText">
              {ar ? "مرحباً" : "Welcome"}
            </p>

            <h2>
              {profile.salesman_name}
            </h2>

            <div className="roleBadge">
              {profile.role?.toUpperCase()}
            </div>

          </div>

          <div className="languageDashboard">

            <button
              className={
                language === "en" ? "active" : ""
              }
              onClick={() => setLanguage("en")}
            >
              English
            </button>

            <button
              className={
                language === "ar" ? "active" : ""
              }
              onClick={() => setLanguage("ar")}
            >
              العربية
            </button>

          </div>

          <h3 className="sectionTitle">
            {ar ? "القائمة الرئيسية" : "Main Menu"}
          </h3>

          <div className="menuGrid">
            {dashboardModules.map((item) => (
              <button
                key={item.moduleKey}
                type="button"
                className="menuCard"
                onClick={() => handleNavigate(item.href)}
              >
                <div className="menuIcon">{item.icon}</div>
                <strong>{item.title}</strong>
                <span>{item.subtitle}</span>
              </button>
            ))}

            {hasManagementAccess && (
              <button
                type="button"
                className="menuCard adminCard"
                onClick={() => handleNavigate("/management")}
              >
                <div className="menuIcon">⚙️</div>
                <strong>{ar ? "الإدارة" : "Management"}</strong>
                <span>
                  {ar
                    ? "لوحة تحكم الإدارة"
                    : "Management control panel"}
                </span>
              </button>
            )}
          </div>

        </section>

      </main>
      </MorningAttendanceGate>
    );
  }

  // =========================================================
  // LOGIN
  // =========================================================

  if (apkVersionState?.outdated) {
    return (
      <AndroidApkUpdateRequired
        currentVersion={apkVersionState.current}
        minimum={apkVersionState.minimum}
        checking={checkingApkVersion}
        onRecheck={async () => {
          setCheckingApkVersion(true);
          const result = await evaluateNativeAndroidApkVersion();
          setApkVersionState(result);
          setCheckingApkVersion(false);
        }}
      />
    );
  }

  return (
    <main
      className="loginPage"
      dir={ar ? "rtl" : "ltr"}
    >
      <div className="loginCard">

        <div className="brand">

          <div className="logo">M</div>

          <div>
            <h1>MADIBA</h1>
            <p>
              {ar
                ? "نظام إدارة المبيعات"
                : "Sales Force Automation"}
            </p>
          </div>

        </div>

        <div className="languageSelector">

          <button
            className={
              language === "en" ? "active" : ""
            }
            onClick={() => setLanguage("en")}
          >
            English
          </button>

          <button
            className={
              language === "ar" ? "active" : ""
            }
            onClick={() => setLanguage("ar")}
          >
            العربية
          </button>

        </div>

        <div className="welcome">

          <h2>
            {ar ? "مرحباً بك" : "Welcome back"}
          </h2>

          <p>
            {ar
              ? "سجل الدخول إلى حساب المبيعات الخاص بك"
              : "Sign in to your sales account"}
          </p>

        </div>

        <form onSubmit={handleLogin}>

          <label>
            {ar ? "البريد الإلكتروني" : "Email"}
          </label>

          <input
            type="email"
            value={email}
            onChange={(e) =>
              setEmail(e.target.value)
            }
            placeholder={
              ar
                ? "أدخل البريد الإلكتروني"
                : "Enter your email"
            }
            required
          />

          <label>
            {ar ? "كلمة المرور" : "Password"}
          </label>

          <input
            type="password"
            value={password}
            onChange={(e) =>
              setPassword(e.target.value)
            }
            placeholder={
              ar
                ? "أدخل كلمة المرور"
                : "Enter your password"
            }
            required
          />

          {error && (
            <div className="errorMessage">
              {error}
            </div>
          )}

          <button
            className="loginButton"
            type="submit"
            disabled={loginLoading}
          >
            {loginLoading
              ? ar
                ? "جارٍ تسجيل الدخول..."
                : "Signing in..."
              : ar
              ? "تسجيل الدخول"
              : "Sign In"}
          </button>

        </form>

        <div className="footer">
          MADIBA KSA
        </div>

      </div>
    </main>
  );
}
