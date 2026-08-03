"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "./lib/supabase";
import SupabaseUnavailable from "./components/SupabaseUnavailable";

export default function Home() {
  const [language, setLanguage] = useState("en");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);

  const [loading, setLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [error, setError] = useState("");

  const router = useRouter();
  const ar = language === "ar";

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

  async function checkSession(supabaseClient = getSupabaseClient()) {
    if (!supabaseClient) {
      setLoading(false);
      return;
    }

    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    if (session?.user) {
      setUser(session.user);
      await loadProfile(session.user.id);
    }

    setLoading(false);
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
      return;
    }

    setProfile(data);

    if (data?.preferred_language) {
      setLanguage(data.preferred_language);
    }
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
      setUser(data.user);
      await loadProfile(data.user.id);
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
    return (
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

          <button
            className="logoutButton"
            onClick={handleLogout}
          >
            {ar ? "تسجيل الخروج" : "Logout"}
          </button>

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
            {[
              {
                icon: "📍",
                title: ar ? "يومي" : "My Day",
                subtitle: ar
                  ? "زيارات ومتابعات اليوم"
                  : "Today's visits & follow-ups",
                href: "/management",
              },
              {
                icon: "👥",
                title: ar ? "عملائي" : "My Customers",
                subtitle: ar
                  ? "بحث وسجل العملاء"
                  : "Search & customer history",
                href: "/management/customer-audit",
              },
              {
                icon: "🛒",
                title: ar ? "طلب جديد" : "New Order",
                subtitle: ar
                  ? "إنشاء طلب للعميل"
                  : "Create customer order",
                href: "/management/upload",
              },
              {
                icon: "➕",
                title: ar ? "عميل جديد" : "New Customer",
                subtitle: ar
                  ? "تسجيل عميل محتمل"
                  : "Register a new prospect",
                href: "/management",
              },
              {
                icon: "🎯",
                title: ar ? "أدائي" : "My Performance",
                subtitle: ar
                  ? "الأهداف والنتائج"
                  : "KRA & KPI progress",
                href: "/management",
              },
            ].map((item) => (
              <button
                key={item.title}
                type="button"
                className="menuCard"
                onClick={() => handleNavigate(item.href)}
              >
                <div className="menuIcon">{item.icon}</div>
                <strong>{item.title}</strong>
                <span>{item.subtitle}</span>
              </button>
            ))}

            {profile.role === "admin" && (
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
    );
  }

  // =========================================================
  // LOGIN
  // =========================================================

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
