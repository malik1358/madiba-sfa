"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { getSupabaseClient } from "../../lib/supabase";

function formatDateTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-GB");
}

function daysOld(fromDate) {
  if (!fromDate) return 0;
  const then = new Date(fromDate).getTime();
  const now = Date.now();
  return Math.max(0, Math.floor((now - then) / (1000 * 60 * 60 * 24)));
}

export default function PendingOrdersPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [orders, setOrders] = useState([]);
  const [userRole, setUserRole] = useState("");

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

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", session.user.id)
          .single();

        if (profileError) throw profileError;

        const role = String(profile?.role || "").toLowerCase();
        setUserRole(role);

        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        let query = supabase
          .from("sales_orders")
          .select("id,customer_code,customer_name,salesman_code,created_by,created_at,updated_at,status")
          .eq("status", "DRAFT")
          .lt("updated_at", startOfToday.toISOString())
          .order("updated_at", { ascending: true })
          .limit(500);

        if (![
          "admin",
          "manager",
        ].includes(role)) {
          query = query.eq("created_by", session.user.id);
        }

        const { data, error: ordersError } = await query;
        if (ordersError) throw ordersError;

        setOrders(data || []);
      } catch (err) {
        setError(err.message || "Unable to load pending orders.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const summary = useMemo(() => {
    const olderThan7 = orders.filter((order) => daysOld(order.updated_at || order.created_at) >= 7).length;
    const olderThan30 = orders.filter((order) => daysOld(order.updated_at || order.created_at) >= 30).length;

    return {
      total: orders.length,
      olderThan7,
      olderThan30,
    };
  }, [orders]);

  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Pending Orders unavailable"
        message="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to view pending orders."
      />
    );
  }

  if (loading) {
    return (
      <main className="modulePage">
        <div className="moduleShell">
          <div className="moduleLoading">Loading old pending orders...</div>
        </div>
      </main>
    );
  }

  return (
    <main className="modulePage">
      <div className="moduleShell">
        <div className="moduleHeader">
          <div>
            <p className="moduleEyebrow">MADIBA SFA</p>
            <h1>Old Pending Orders</h1>
            <p className="moduleSubtitle">
              Draft orders not updated today
              {userRole === "admin" || userRole === "manager" ? " across the team" : " in your account"}
            </p>
          </div>
          <Link href="/" className="moduleBackLink">← Dashboard</Link>
        </div>

        {error && <div className="moduleError">{error}</div>}

        <div className="moduleMetricGrid">
          <section className="moduleMetricCard"><span>Total old pending</span><strong>{summary.total}</strong></section>
          <section className="moduleMetricCard"><span>Older than 7 days</span><strong>{summary.olderThan7}</strong></section>
          <section className="moduleMetricCard"><span>Older than 30 days</span><strong>{summary.olderThan30}</strong></section>
        </div>

        <section className="moduleSection">
          <div className="moduleSectionHeader">
            <h2>Pending Order Queue</h2>
            <span>{summary.total} order(s)</span>
          </div>

          <div className="moduleTableWrap">
            <table className="moduleTable">
              <thead>
                <tr>
                  <th>Order ID</th>
                  <th>Customer</th>
                  <th>Salesman</th>
                  <th>Created</th>
                  <th>Last Updated</th>
                  <th>Age (days)</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const age = daysOld(order.updated_at || order.created_at);

                  return (
                    <tr key={order.id}>
                      <td>{order.id}</td>
                      <td>{order.customer_name || order.customer_code || "-"}</td>
                      <td>{order.salesman_code || "-"}</td>
                      <td>{formatDateTime(order.created_at)}</td>
                      <td>{formatDateTime(order.updated_at)}</td>
                      <td>{age}</td>
                    </tr>
                  );
                })}

                {orders.length === 0 && (
                  <tr>
                    <td colSpan={6}>No old pending orders found.</td>
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
