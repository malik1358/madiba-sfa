"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { getSupabaseClient } from "../../lib/supabase";

function formatMoney(value) {
  return `SAR ${Number(value || 0).toFixed(2)}`;
}

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

const PENDING_STATUSES = ["DRAFT", "PENDING", "SUBMITTED"];

export default function PendingOrdersPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [orders, setOrders] = useState([]);
  const [userRole, setUserRole] = useState("");
  const [activeOrderId, setActiveOrderId] = useState(null);
  const [orderLines, setOrderLines] = useState([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
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
          .in("status", PENDING_STATUSES)
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

  const activeOrder = useMemo(
    () => orders.find((order) => order.id === activeOrderId) || null,
    [orders, activeOrderId]
  );

  async function regenerateOrderPdf() {
    if (!activeOrder) {
      setError("Open an order first to regenerate PDF.");
      return;
    }

    if (orderLines.length === 0) {
      setError("This order has no line items to generate PDF.");
      return;
    }

    setDownloadingPdf(true);
    setError("");

    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const vatRate = 0.15;
      const subtotal = orderLines.reduce((sum, line) => sum + Number(line.line_value || 0), 0);
      const vatAmount = subtotal * vatRate;
      const grandTotal = subtotal + vatAmount;

      doc.setFont(undefined, "bold");
      doc.setFontSize(18);
      doc.text("MADIBA SFA", 40, 44);
      doc.setFontSize(12);
      doc.text("SALES ORDER", 40, 64);

      doc.setFont(undefined, "normal");
      doc.setFontSize(10);
      doc.text(`Order ID: ${activeOrder.id}`, 40, 86);
      doc.text(`Status: ${activeOrder.status || "-"}`, 40, 102);
      doc.text(`Customer: ${activeOrder.customer_code || "-"} - ${activeOrder.customer_name || "-"}`, 40, 118);
      doc.text(`Salesman: ${activeOrder.salesman_code || "-"}`, 40, 134);
      doc.text(`Created: ${formatDateTime(activeOrder.created_at)}`, 40, 150);
      doc.text(`Last Updated: ${formatDateTime(activeOrder.updated_at)}`, 40, 166);

      doc.setFont(undefined, "bold");
      doc.rect(40, 186, 515, 24);
      doc.text("Item Code", 46, 202);
      doc.text("Item Name", 124, 202);
      doc.text("Qty", 346, 202);
      doc.text("Rate", 396, 202);
      doc.text("Line Total", 476, 202);
      doc.setFont(undefined, "normal");

      let y = 210;
      orderLines.forEach((line) => {
        const wrapped = doc.splitTextToSize(String(line.item_name || "-"), 210);
        const rowHeight = Math.max(22, wrapped.length * 12 + 8);

        if (y + rowHeight > 760) {
          doc.addPage();
          y = 40;
          doc.setFont(undefined, "bold");
          doc.rect(40, y, 515, 24);
          doc.text("Item Code", 46, y + 16);
          doc.text("Item Name", 124, y + 16);
          doc.text("Qty", 346, y + 16);
          doc.text("Rate", 396, y + 16);
          doc.text("Line Total", 476, y + 16);
          doc.setFont(undefined, "normal");
          y += 24;
        }

        doc.rect(40, y, 80, rowHeight);
        doc.rect(120, y, 220, rowHeight);
        doc.rect(340, y, 50, rowHeight);
        doc.rect(390, y, 80, rowHeight);
        doc.rect(470, y, 85, rowHeight);

        doc.text(String(line.item_code || "-"), 46, y + 14);
        wrapped.forEach((nameLine, idx) => {
          doc.text(nameLine, 124, y + 14 + idx * 12);
        });
        doc.text(String(Number(line.quantity || 0)), 346, y + 14);
        doc.text(formatMoney(line.rate), 396, y + 14);
        doc.text(formatMoney(line.line_value), 476, y + 14);

        y += rowHeight;
      });

      const summaryY = Math.min(y + 20, 740);
      doc.roundedRect(350, summaryY, 205, 70, 4, 4);
      doc.text("Subtotal (Excl. VAT)", 360, summaryY + 18);
      doc.text(formatMoney(subtotal), 546, summaryY + 18, { align: "right" });
      doc.text("VAT @ 15%", 360, summaryY + 36);
      doc.text(formatMoney(vatAmount), 546, summaryY + 36, { align: "right" });
      doc.setFont(undefined, "bold");
      doc.text("Total (Incl. VAT)", 360, summaryY + 54);
      doc.text(formatMoney(grandTotal), 546, summaryY + 54, { align: "right" });
      doc.setFont(undefined, "normal");

      const safeCustomer = String(activeOrder.customer_code || "customer").replace(/[^a-zA-Z0-9_-]/g, "_");
      const safeDate = String(activeOrder.updated_at || activeOrder.created_at || new Date().toISOString())
        .slice(0, 19)
        .replace(/[:T]/g, "-");
      doc.save(`order-${activeOrder.id}-${safeCustomer}-${safeDate}.pdf`);
    } catch {
      setError("Unable to regenerate PDF for this order.");
    } finally {
      setDownloadingPdf(false);
    }
  }

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
              Orders queue ({PENDING_STATUSES.join(", ")})
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
                  <th>Status</th>
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
                      <td>{order.status || "-"}</td>
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
                    <td colSpan={8}>No pending orders found.</td>
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
                <button
                  type="button"
                  className="modulePrimaryButton"
                  onClick={regenerateOrderPdf}
                  disabled={downloadingPdf || loadingLines || orderLines.length === 0}
                >
                  {downloadingPdf ? "Generating PDF..." : "Regenerate PDF"}
                </button>
                <Link href="/management/new-order" className="moduleInlineButton">Open Order Workflow</Link>
                <Link href="/management/customer-audit" className="moduleInlineButton">Go to Customer Audit</Link>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
