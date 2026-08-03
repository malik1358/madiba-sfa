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
  const [activeOrderId, setActiveOrderId] = useState(null);
  const [orderLines, setOrderLines] = useState([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const startOfTodayIso = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return start.toISOString();
  }, []);

  async function openOrder(orderId) {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }

    if (activeOrderId === orderId) {
      setActiveOrderId(null);
      setOrderLines([]);
      return;
    }

    setLoadingLines(true);
    setError("");

    try {
      const { data, error: linesError } = await supabase
        .from("sales_order_items")
        .select("id,item_code,item_name,category,quantity,rate,line_value")
        .eq("order_id", orderId)
        .order("item_name");

      if (linesError) throw linesError;

      setActiveOrderId(orderId);
      setOrderLines(data || []);
    } catch (err) {
      setError(err.message || "Unable to open order details.");
      setActiveOrderId(null);
      setOrderLines([]);
    } finally {
      setLoadingLines(false);
    }
  }

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

        let query = supabase
          .from("sales_orders")
          .select("id,customer_code,customer_name,salesman_code,created_by,created_at,updated_at,status")
          .eq("status", "DRAFT")
          .order("updated_at", { ascending: false })
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
    const oldPending = orders.filter((order) => {
      const marker = order.updated_at || order.created_at;
      return Boolean(marker) && marker < startOfTodayIso;
    }).length;
    const updatedToday = Math.max(0, orders.length - oldPending);
    const olderThan7 = orders.filter((order) => daysOld(order.updated_at || order.created_at) >= 7).length;
    const olderThan30 = orders.filter((order) => daysOld(order.updated_at || order.created_at) >= 30).length;

    return {
      total: orders.length,
      oldPending,
      updatedToday,
      olderThan7,
      olderThan30,
    };
  }, [orders, startOfTodayIso]);

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
            <h1>Pending Orders</h1>
            <p className="moduleSubtitle">
              Draft orders queue
              {userRole === "admin" || userRole === "manager" ? " across the team" : " in your account"}
            </p>
          </div>
          <Link href="/" className="moduleBackLink">← Dashboard</Link>
        </div>

        {error && <div className="moduleError">{error}</div>}

        <div className="moduleMetricGrid">
          <section className="moduleMetricCard"><span>Total pending</span><strong>{summary.total}</strong></section>
          <section className="moduleMetricCard"><span>Old pending</span><strong>{summary.oldPending}</strong></section>
          <section className="moduleMetricCard"><span>Updated today</span><strong>{summary.updatedToday}</strong></section>
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
                  <th>Action</th>
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
                      <td>
                        <button
                          type="button"
                          className="moduleInlineButton"
                          onClick={() => openOrder(order.id)}
                          disabled={loadingLines && activeOrderId === order.id}
                        >
                          {activeOrderId === order.id ? "Close" : "Open"}
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {orders.length === 0 && (
                  <tr>
                    <td colSpan={7}>No pending draft orders found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {activeOrderId && (
            <div style={{ marginTop: "12px" }}>
              <div className="moduleSectionHeader">
                <h2>Order #{activeOrderId} Details</h2>
                <span>{loadingLines ? "Loading..." : `${orderLines.length} line(s)`}</span>
              </div>
              <div className="moduleTableWrap">
                <table className="moduleTable">
                  <thead>
                    <tr>
                      <th>Item Code</th>
                      <th>Item Name</th>
                      <th>Category</th>
                      <th>Qty</th>
                      <th>Rate</th>
                      <th>Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderLines.map((line) => (
                      <tr key={line.id}>
                        <td>{line.item_code || "-"}</td>
                        <td>{line.item_name || "-"}</td>
                        <td>{line.category || "-"}</td>
                        <td>{Number(line.quantity || 0)}</td>
                        <td>{`SAR ${Number(line.rate || 0).toFixed(2)}`}</td>
                        <td>{`SAR ${Number(line.line_value || 0).toFixed(2)}`}</td>
                      </tr>
                    ))}
                    {!loadingLines && orderLines.length === 0 && (
                      <tr>
                        <td colSpan={6}>No line items found for this order.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="moduleActionRow" style={{ marginTop: "10px" }}>
                <Link href="/management/new-order" className="modulePrimaryButton">Open Order Workflow</Link>
                <Link href="/management/customer-audit" className="moduleInlineButton">Go to Customer Audit</Link>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
