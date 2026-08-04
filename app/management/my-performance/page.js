"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "../../lib/supabase";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { fetchSalesScope } from "../../lib/salesScope";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";

const TEXT = {
  title: { en: "My Performance", ar: "أدائي" },
  subtitle: { en: "Sales KPI snapshot", ar: "ملخص مؤشرات الأداء" },
  dashboard: { en: "← Dashboard", ar: "← الرئيسية" },
  loading: { en: "Loading KPI dashboard...", ar: "جاري تحميل مؤشرات الأداء..." },
};

function currency(value) {
  return `SAR ${Number(value || 0).toLocaleString("en-SA", { maximumFractionDigits: 2 })}`;
}

function percent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

export default function MyPerformancePage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [metrics, setMetrics] = useState({
    salesToday: 0,
    salesMonth: 0,
    visitsToday: 0,
    productiveVisits: 0,
    strikeRate: 0,
    collection: 0,
    newCustomers: 0,
    orders: 0,
    averageOrderValue: 0,
    achievement: 0,
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

        const scope = await fetchSalesScope();

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("id,salesman_code,monthly_target")
          .eq("id", session.user.id)
          .single();

        if (profileError) throw profileError;

        const today = new Date();
        const todayISO = today.toISOString().slice(0, 10);
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
          .toISOString()
          .slice(0, 10);

        const salesmanCode = profile.salesman_code;

        let salesTodayQuery = supabase
          .from("sales_raw")
          .select("sales_amount,customer_code,salesman_code")
          .eq("transaction_date", todayISO);

        let salesMonthQuery = supabase
          .from("sales_raw")
          .select("sales_amount,salesman_code")
          .gte("transaction_date", monthStart)
          .lte("transaction_date", todayISO);

        let monthRowsQuery = supabase
          .from("sales_raw")
          .select("customer_code,sales_amount,salesman_code")
          .eq("transaction_date", todayISO);

        let ordersQuery = supabase
          .from("sales_orders")
          .select("id,status,total_amount,submitted_at,created_by,salesman_code")
          .gte("created_at", `${monthStart}T00:00:00`);

        let customersQuery = supabase
          .from("customers")
          .select("customer_code,current_salesman_code")
          .gte("latest_transaction_date", monthStart)
          .lte("latest_transaction_date", todayISO);

        if (scope.hasAllAccess) {
          // no-op
        } else {
          salesTodayQuery = salesTodayQuery.in("salesman_code", scope.visibleSalesmanCodes);
          salesMonthQuery = salesMonthQuery.in("salesman_code", scope.visibleSalesmanCodes);
          monthRowsQuery = monthRowsQuery.in("salesman_code", scope.visibleSalesmanCodes);
          customersQuery = customersQuery.in("current_salesman_code", scope.visibleSalesmanCodes);
        }

        const [salesTodayRes, salesMonthRes, monthRowsRes, ordersRes, customersRes] = await Promise.all([
          salesTodayQuery,
          salesMonthQuery,
          monthRowsQuery,
          ordersQuery,
          customersQuery,
        ]);

        if (salesTodayRes.error) throw salesTodayRes.error;
        if (salesMonthRes.error) throw salesMonthRes.error;
        if (monthRowsRes.error) throw monthRowsRes.error;
        if (ordersRes.error) throw ordersRes.error;
        if (customersRes.error) throw customersRes.error;

        const salesToday = (salesTodayRes.data || []).reduce((sum, row) => sum + Number(row.sales_amount || 0), 0);
        const salesMonth = (salesMonthRes.data || []).reduce((sum, row) => sum + Number(row.sales_amount || 0), 0);

        const visitsTodaySet = new Set((monthRowsRes.data || []).map((row) => row.customer_code).filter(Boolean));
        const productiveSet = new Set(
          (monthRowsRes.data || [])
            .filter((row) => Number(row.sales_amount || 0) > 0)
            .map((row) => row.customer_code)
            .filter(Boolean)
        );

        const visitsToday = visitsTodaySet.size;
        const productiveVisits = productiveSet.size;
        const strikeRate = visitsToday ? (productiveVisits / visitsToday) * 100 : 0;

        const visibleOrders = (ordersRes.data || []).filter((row) => {
          if (scope.hasAllAccess) return true;
          return scope.visibleUserIds.includes(row.created_by) || scope.visibleSalesmanCodes.includes(String(row.salesman_code || "").trim().toUpperCase());
        });

        const submittedOrders = visibleOrders.filter((row) => row.status === "SUBMITTED");
        const orders = submittedOrders.length;
        const collection = submittedOrders.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
        const averageOrderValue = orders ? collection / orders : 0;
        const monthlyTarget = Number(profile.monthly_target || 0);
        const achievement = monthlyTarget > 0 ? (salesMonth / monthlyTarget) * 100 : 0;

        setMetrics({
          salesToday,
          salesMonth,
          visitsToday,
          productiveVisits,
          strikeRate,
          collection,
          newCustomers: (customersRes.data || []).length,
          orders,
          averageOrderValue,
          achievement,
        });
      } catch (err) {
        setError(err.message || "Unable to load performance metrics.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const cards = useMemo(
    () => [
      { label: "Sales Today", value: currency(metrics.salesToday) },
      { label: "Sales This Month", value: currency(metrics.salesMonth) },
      { label: "Visits Today", value: metrics.visitsToday },
      { label: "Productive Visits", value: metrics.productiveVisits },
      { label: "Strike Rate", value: percent(metrics.strikeRate) },
      { label: "Collection", value: currency(metrics.collection) },
      { label: "New Customers", value: metrics.newCustomers },
      { label: "Orders", value: metrics.orders },
      { label: "Average Order Value", value: currency(metrics.averageOrderValue) },
      { label: "Achievement", value: percent(metrics.achievement) },
    ],
    [metrics]
  );

  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Performance unavailable"
        message="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to view KPI metrics."
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

  return (
    <MorningAttendanceGate>
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
      </div>
    </main>
    </MorningAttendanceGate>
  );
}
