"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "../lib/supabase";
import { translate, useAppLanguage } from "../lib/appLanguage";
import SupabaseUnavailable from "../components/SupabaseUnavailable";
import AppLanguageSwitch from "../components/AppLanguageSwitch";

const TEXT = {
  title: { en: "Management", ar: "الإدارة" },
  subtitle: { en: "Operational control center", ar: "مركز التحكم التشغيلي" },
  dashboard: { en: "← Dashboard", ar: "← الرئيسية" },
  loading: { en: "Loading management panel...", ar: "جاري تحميل لوحة الإدارة..." },
  modules: { en: "Management Modules", ar: "وحدات الإدارة" },
  health: { en: "System Health", ar: "حالة النظام" },
  recentOrders: { en: "Recent Orders", ar: "الطلبات الأخيرة" },
};

function number(value) {
  return Number(value || 0).toLocaleString("en-SA");
}

export default function ManagementPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [summary, setSummary] = useState({
    customers: 0,
    salesmen: 0,
    orders: 0,
    drafts: 0,
    submitted: 0,
    imports: 0,
  });
  const [recentOrders, setRecentOrders] = useState([]);
  const [health, setHealth] = useState({
    activeBatch: "-",
    latestImportAt: "-",
    sessionUser: "-",
  });

  useEffect(() => {
    async function load() {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.user) {
          throw new Error("Please login again.");
        }

        setHealth((current) => ({
          ...current,
          sessionUser: session.user.email || session.user.id,
        }));

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", session.user.id)
          .single();

        if (profileError) throw profileError;

        const role = String(profile?.role || "").toLowerCase();
        if (!["admin", "manager"].includes(role)) {
          setAccessDenied(true);
          setLoading(false);
          return;
        }

        const [
          customersRes,
          salesmenRes,
          ordersRes,
          importsRes,
          activeBatchRes,
          latestImportRes,
          recentOrdersRes,
        ] = await Promise.all([
          supabase.from("customers").select("customer_code", { count: "exact", head: true }),
          supabase.from("profiles").select("id", { count: "exact", head: true }).in("role", ["salesman", "manager", "admin"]),
          supabase.from("sales_orders").select("id,status", { count: "exact" }).order("updated_at", { ascending: false }).limit(1000),
          supabase.from("import_batches").select("id", { count: "exact", head: true }),
          supabase.from("system_settings").select("setting_value").eq("setting_key", "active_sales_batch_id").maybeSingle(),
          supabase.from("import_batches").select("uploaded_at").order("uploaded_at", { ascending: false }).limit(1).maybeSingle(),
          supabase
            .from("sales_orders")
            .select("id,customer_code,customer_name,salesman_code,status,updated_at")
            .order("updated_at", { ascending: false })
            .limit(8),
        ]);

        if (customersRes.error) throw customersRes.error;
        if (salesmenRes.error) throw salesmenRes.error;
        if (ordersRes.error) throw ordersRes.error;
        if (importsRes.error) throw importsRes.error;
        if (activeBatchRes.error) throw activeBatchRes.error;
        if (latestImportRes.error) throw latestImportRes.error;
        if (recentOrdersRes.error) throw recentOrdersRes.error;

        const orders = ordersRes.data || [];
        const drafts = orders.filter((row) => row.status === "DRAFT").length;
        const submitted = orders.filter((row) => row.status === "SUBMITTED").length;

        setSummary({
          customers: customersRes.count || 0,
          salesmen: salesmenRes.count || 0,
          orders: ordersRes.count || 0,
          drafts,
          submitted,
          imports: importsRes.count || 0,
        });

        setHealth({
          sessionUser: session.user.email || session.user.id,
          activeBatch: activeBatchRes.data?.setting_value || "-",
          latestImportAt: latestImportRes.data?.uploaded_at || "-",
        });

        setRecentOrders(recentOrdersRes.data || []);
      } catch (err) {
        setError(err.message || "Unable to load management data.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const cards = useMemo(
    () => [
      { label: "Customers", value: number(summary.customers) },
      { label: "Salesmen", value: number(summary.salesmen) },
      { label: "Orders", value: number(summary.orders) },
      { label: "Draft Orders", value: number(summary.drafts) },
      { label: "Submitted Orders", value: number(summary.submitted) },
      { label: "Imports", value: number(summary.imports) },
    ],
    [summary]
  );

  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Management unavailable"
        message="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to use management features."
      />
    );
  }

  if (loading) {
    return (
      <main className="modulePage" dir={dir}>
        <div className="moduleShell">
          <div className="moduleLoading">{t("loading")}</div>
        </div>
      </main>
    );
  }

  if (accessDenied) {
    return (
      <main className="modulePage" dir={dir}>
        <div className="moduleShell">
          <div className="moduleHeader">
            <div>
              <p className="moduleEyebrow">MADIBA SFA</p>
              <h1>{t("title")}</h1>
            </div>
            <div className="moduleHeaderMeta"><AppLanguageSwitch language={language} setLanguage={setLanguage} /><Link href="/" className="moduleBackLink">{t("dashboard")}</Link></div>
          </div>
          <div className="moduleError">Only manager/admin users can access this panel.</div>
        </div>
      </main>
    );
  }

  return (
    <main className="modulePage" dir={dir}>
      <div className="moduleShell">
        <div className="moduleHeader">
          <div>
            <p className="moduleEyebrow">MADIBA SFA</p>
            <h1>{t("title")}</h1>
            <p className="moduleSubtitle">{t("subtitle")}</p>
          </div>
          <div className="moduleHeaderMeta"><AppLanguageSwitch language={language} setLanguage={setLanguage} /><Link href="/" className="moduleBackLink">{t("dashboard")}</Link></div>
        </div>

        {error && <div className="moduleError">{error}</div>}

        <div className="moduleMetricGrid">
          {cards.map((card) => (
            <section key={card.label} className="moduleMetricCard">
              <span>{card.label}</span>
              <strong>{card.value}</strong>
            </section>
          ))}
        </div>

        <section className="moduleSection">
          <div className="moduleSectionHeader">
            <h2>{t("modules")}</h2>
          </div>
          <div className="moduleNavGrid">
            <Link href="/management/customer-audit" className="moduleNavCard">Customers Audit</Link>
            <Link href="/management/new-order" className="moduleNavCard">Orders Workflow</Link>
            <Link href="/management/salesman-hierarchy" className="moduleNavCard">Salesman Hierarchy</Link>
            <Link href="/management/gps-map" className="moduleNavCard">GPS Map</Link>
            <Link href="/management/pending-orders" className="moduleNavCard">Old Pending Orders</Link>
            <Link href="/management/new-customer" className="moduleNavCard">New Customers</Link>
            <Link href="/management/my-performance" className="moduleNavCard">Performance</Link>
            <Link href="/management/my-day" className="moduleNavCard">My Day Planner</Link>
            <Link href="/management/upload" className="moduleNavCard">Imports</Link>
          </div>
        </section>

        <section className="moduleSection">
          <div className="moduleSectionHeader">
            <h2>{t("health")}</h2>
          </div>
          <div className="moduleHealthGrid">
            <div><span>Session User</span><strong>{health.sessionUser}</strong></div>
            <div><span>Active Sales Batch</span><strong>{health.activeBatch}</strong></div>
            <div><span>Latest Import</span><strong>{health.latestImportAt === "-" ? "-" : new Date(health.latestImportAt).toLocaleString("en-GB")}</strong></div>
          </div>
        </section>

        <section className="moduleSection">
          <div className="moduleSectionHeader">
            <h2>{t("recentOrders")}</h2>
          </div>
          <div className="moduleTableWrap">
            <table className="moduleTable">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Customer</th>
                  <th>Salesman</th>
                  <th>Status</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((row) => (
                  <tr key={row.id}>
                    <td>{row.id}</td>
                    <td>{row.customer_name || row.customer_code}</td>
                    <td>{row.salesman_code || "-"}</td>
                    <td>{row.status || "-"}</td>
                    <td>{row.updated_at ? new Date(row.updated_at).toLocaleString("en-GB") : "-"}</td>
                  </tr>
                ))}
                {recentOrders.length === 0 && (
                  <tr>
                    <td colSpan={5}>No orders found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
