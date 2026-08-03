"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "../../lib/supabase";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { useOrder } from "../customer-audit/hooks/useOrder";
import { getPrice } from "../customer-audit/lib/helpers";
import { qtyFormat } from "../customer-audit/lib/format";
import { calculateGrandTotal } from "../customer-audit/lib/orderHelpers";

const PRICE_API =
  "https://script.google.com/macros/s/AKfycbzXPREoz0tUgern-5LhpEPBMY_ed2hO1fgYpIVfzG2-BU9HbjOklKCBFVMtsw64Uff5/exec";

function formatMoney(value) {
  return `SAR ${Number(value || 0).toFixed(2)}`;
}

export default function NewOrderPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [customers, setCustomers] = useState([]);
  const [itemsMaster, setItemsMaster] = useState([]);
  const [selectedCustomerCode, setSelectedCustomerCode] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [expandedCategories, setExpandedCategories] = useState({});
  const [priceList, setPriceList] = useState({});
  const [previousDrafts, setPreviousDrafts] = useState([]);
  const [lastSavedOrder, setLastSavedOrder] = useState(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.customer_code === selectedCustomerCode) || null,
    [customers, selectedCustomerCode]
  );

  const categories = useMemo(
    () => [
      "ALL",
      ...new Set(itemsMaster.map((item) => item.category).filter(Boolean)).values(),
    ],
    [itemsMaster]
  );

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    return customers.filter((customer) => {
      if (!q) return true;
      return (
        String(customer.customer_code || "").toLowerCase().includes(q) ||
        String(customer.customer_name || "").toLowerCase().includes(q)
      );
    });
  }, [customers, customerSearch]);

  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    return itemsMaster.filter((item) => {
      if (categoryFilter !== "ALL" && item.category !== categoryFilter) return false;
      if (!q) return true;

      return (
        String(item.item_code || "").toLowerCase().includes(q) ||
        String(item.item_name || "").toLowerCase().includes(q) ||
        String(item.category || "").toLowerCase().includes(q)
      );
    });
  }, [itemsMaster, categoryFilter, itemSearch]);

  const groupedItems = useMemo(() => {
    const map = new Map();

    filteredItems.forEach((item) => {
      const category = item.category || "Unclassified";
      const current = map.get(category) || [];
      current.push(item);
      map.set(category, current);
    });

    return Array.from(map.entries())
      .map(([category, items]) => ({
        category,
        items,
      }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }, [filteredItems]);

  function toggleCategory(category) {
    setExpandedCategories((current) => ({
      ...current,
      [category]: !current[category],
    }));
  }

  const analyticsLike = useMemo(() => ({ items: itemsMaster }), [itemsMaster]);

  const {
    draftOrderId,
    orderItems,
    orderSummary,
    orderQuantities,
    savingOrder,
    submittingOrder,
    updateQty,
    increaseQty,
    decreaseQty,
    saveDraft,
    submitOrder,
  } = useOrder({
    analytics: analyticsLike,
    quickOrderAllItems: [],
    selectedCustomer,
    priceList,
    setError,
    setMessage,
  });

  const buildOrderSnapshot = useCallback(
    (orderId, statusLabel) => {
      if (!selectedCustomer || orderItems.length === 0) return null;

      const savedAtIso = new Date().toISOString();
      const lines = orderItems.map((item) => {
        const quantity = Number(item.order_quantity || 0);
        const rate = Number(getPrice(priceList, item.item_code) || 0);

        return {
          item_code: item.item_code,
          item_name: item.item_name,
          category: item.category || "Unclassified",
          quantity,
          rate,
          lineTotal: quantity * rate,
        };
      });

      return {
        orderId,
        statusLabel,
        savedAtIso,
        customerCode: selectedCustomer.customer_code,
        customerName: selectedCustomer.customer_name,
        salesmanCode: selectedCustomer.current_salesman_code,
        itemCount: orderSummary.itemCount,
        totalQuantity: orderSummary.totalQuantity,
        grandTotal: calculateGrandTotal(orderItems, priceList),
        lines,
      };
    },
    [orderItems, orderSummary.itemCount, orderSummary.totalQuantity, priceList, selectedCustomer]
  );

  const downloadOrderPdf = useCallback(
    async (snapshot) => {
      if (!snapshot) return;

      setDownloadingPdf(true);
      try {
        const { jsPDF } = await import("jspdf");
        const doc = new jsPDF({ unit: "pt", format: "a4" });

        doc.setFontSize(18);
        doc.text("MADIBA SFA - Order Review", 40, 44);

        doc.setFontSize(11);
        doc.text(`Order ID: ${snapshot.orderId}`, 40, 70);
        doc.text(`Status: ${snapshot.statusLabel}`, 40, 88);
        doc.text(`Date: ${new Date(snapshot.savedAtIso).toLocaleString("en-GB")}`, 40, 106);

        doc.text(`Customer: ${snapshot.customerCode} - ${snapshot.customerName}`, 40, 126);
        doc.text(`Salesman: ${snapshot.salesmanCode || "-"}`, 40, 144);

        doc.text(`Items: ${snapshot.itemCount}`, 40, 166);
        doc.text(`Total Qty: ${qtyFormat(snapshot.totalQuantity)}`, 150, 166);
        doc.text(`Grand Total: ${formatMoney(snapshot.grandTotal)}`, 280, 166);

        let y = 192;
        doc.setFontSize(10);
        doc.setFont(undefined, "bold");
        doc.text("Item Code", 40, y);
        doc.text("Item Name", 120, y);
        doc.text("Qty", 340, y);
        doc.text("Rate", 390, y);
        doc.text("Line Total", 470, y);
        doc.setFont(undefined, "normal");
        y += 8;
        doc.line(40, y, 555, y);
        y += 14;

        snapshot.lines.forEach((line) => {
          if (y > 760) {
            doc.addPage();
            y = 44;
          }

          doc.text(String(line.item_code || "-"), 40, y);
          doc.text(String(line.item_name || "-").slice(0, 40), 120, y);
          doc.text(String(line.quantity), 340, y);
          doc.text(formatMoney(line.rate), 390, y);
          doc.text(formatMoney(line.lineTotal), 470, y);
          y += 18;
        });

        const safeCustomer = String(snapshot.customerCode || "customer").replace(/[^a-zA-Z0-9_-]/g, "_");
        const safeDate = snapshot.savedAtIso.slice(0, 19).replace(/[:T]/g, "-");
        const fileName = `order-${snapshot.orderId}-${safeCustomer}-${safeDate}.pdf`;
        doc.save(fileName);
      } catch {
        setError("Order saved, but PDF generation failed. Please try again.");
      } finally {
        setDownloadingPdf(false);
      }
    },
    [setError]
  );

  const handleSaveDraft = useCallback(async () => {
    const orderId = await saveDraft();
    if (!orderId) return;

    const snapshot = buildOrderSnapshot(orderId, "Draft Saved");
    if (!snapshot) return;

    setLastSavedOrder(snapshot);
    setPreviousDrafts((current) => {
      const next = current.filter((draft) => draft.id !== orderId);
      return [
        {
          id: orderId,
          customer_code: snapshot.customerCode,
          customer_name: snapshot.customerName,
          updated_at: snapshot.savedAtIso,
          status: "DRAFT",
        },
        ...next,
      ].slice(0, 25);
    });

    await downloadOrderPdf(snapshot);
    setMessage(`Draft order #${orderId} saved. PDF downloaded automatically.`);
  }, [buildOrderSnapshot, downloadOrderPdf, saveDraft]);

  const handleSubmitOrder = useCallback(async () => {
    const pendingSnapshot = buildOrderSnapshot(draftOrderId || "pending", "Submitted");
    const orderId = await submitOrder();
    if (!orderId || !pendingSnapshot) return;

    const snapshot = {
      ...pendingSnapshot,
      orderId,
      savedAtIso: new Date().toISOString(),
      statusLabel: "Submitted",
    };

    setLastSavedOrder(snapshot);
    await downloadOrderPdf(snapshot);
    setMessage(`Order #${orderId} submitted. PDF downloaded automatically.`);
  }, [buildOrderSnapshot, downloadOrderPdf, draftOrderId, submitOrder]);

  const shareText = useMemo(() => {
    if (!lastSavedOrder) return "";
    return `Order #${lastSavedOrder.orderId} (${lastSavedOrder.statusLabel}) for ${lastSavedOrder.customerName} - ${formatMoney(lastSavedOrder.grandTotal)}. PDF downloaded and ready to attach.`;
  }, [lastSavedOrder]);

  const whatsappShareUrl = useMemo(
    () => (shareText ? `https://wa.me/?text=${encodeURIComponent(shareText)}` : "#"),
    [shareText]
  );

  const emailShareUrl = useMemo(() => {
    if (!lastSavedOrder) return "#";
    const subject = `Order #${lastSavedOrder.orderId} - ${lastSavedOrder.customerName}`;
    const body = `${shareText}\n\nPlease attach the downloaded PDF from your device before sending.`;
    return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }, [lastSavedOrder, shareText]);

  useEffect(() => {
    async function loadFoundation() {
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

        const [customersRes, itemsRes, draftsRes] = await Promise.all([
          supabase
            .from("customers")
            .select("customer_code,customer_name,current_salesman_code")
            .eq("is_active", true)
            .order("customer_name"),
          supabase
            .from("items_master")
            .select("item_code,item_name,category")
            .order("item_name"),
          supabase
            .from("sales_orders")
            .select("id,customer_code,customer_name,updated_at,status")
            .eq("created_by", session.user.id)
            .eq("status", "DRAFT")
            .order("updated_at", { ascending: false })
            .limit(25),
        ]);

        if (customersRes.error) throw customersRes.error;
        if (itemsRes.error) throw itemsRes.error;
        if (draftsRes.error) throw draftsRes.error;

        setCustomers(customersRes.data || []);
        setItemsMaster(itemsRes.data || []);
        setPreviousDrafts(draftsRes.data || []);
      } catch (err) {
        setError(err.message || "Unable to load new order data.");
      } finally {
        setLoading(false);
      }
    }

    async function loadPrices() {
      try {
        const response = await fetch(PRICE_API);
        const data = await response.json();
        setPriceList(data || {});
      } catch {
        setPriceList({});
      }
    }

    loadFoundation();
    loadPrices();
  }, []);

  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="New Order unavailable"
        message="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to create orders."
      />
    );
  }

  if (loading) {
    return (
      <main className="modulePage">
        <div className="moduleShell">
          <div className="moduleLoading">Loading order workspace...</div>
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
            <h1>New Order</h1>
            <p className="moduleSubtitle">Create, save draft, and submit customer orders</p>
          </div>
          <Link href="/" className="moduleBackLink">← Dashboard</Link>
        </div>

        {error && <div className="moduleError">{error}</div>}
        {message && <div className="moduleSuccess">{message}</div>}

        <section className="moduleSection">
          <div className="moduleSectionHeader">
            <h2>Customer Search</h2>
          </div>
          <div className="moduleFilterRow">
            <input
              className="moduleInput"
              type="text"
              placeholder="Search customer by code or name"
              value={customerSearch}
              onChange={(event) => setCustomerSearch(event.target.value)}
            />
            <select
              className="moduleInput"
              value={selectedCustomerCode}
              onChange={(event) => {
                setSelectedCustomerCode(event.target.value);
                setError("");
                setMessage("");
              }}
            >
              <option value="">Select customer</option>
              {filteredCustomers.map((customer) => (
                <option key={customer.customer_code} value={customer.customer_code}>
                  {customer.customer_code} - {customer.customer_name}
                </option>
              ))}
            </select>
          </div>

          {!selectedCustomer && (
            <div className="moduleHint">Select a customer to start building an order.</div>
          )}
        </section>

        {selectedCustomer && (
          <>
            <section className="moduleSection">
              <div className="moduleSectionHeader">
                <h2>Items</h2>
                <span>
                  {orderSummary.itemCount} items • {qtyFormat(orderSummary.totalQuantity)} units
                </span>
              </div>

              <div className="moduleFilterRow">
                <input
                  className="moduleInput"
                  type="text"
                  placeholder="Search item code, name, or category"
                  value={itemSearch}
                  onChange={(event) => setItemSearch(event.target.value)}
                />
                <select
                  className="moduleInput"
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                >
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>

              <div className="moduleTableWrap">
                <table className="moduleTable moduleOrderTable">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Item</th>
                      <th>Price</th>
                      <th>Qty</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedItems.slice(0, 40).map((group) => {
                      const isExpanded = Boolean(expandedCategories[group.category]);

                      return (
                        <Fragment key={`group-${group.category}`}>
                          <tr className="moduleCategoryRow">
                            <td colSpan={5}>
                              <button
                                type="button"
                                className="moduleCategoryToggle"
                                onClick={() => toggleCategory(group.category)}
                                aria-expanded={isExpanded}
                              >
                                <span className="moduleCategorySymbol">{isExpanded ? "−" : "+"}</span>
                                <strong>{group.category}</strong>
                                <small>{group.items.length} items</small>
                              </button>
                            </td>
                          </tr>
                          {isExpanded &&
                            group.items.slice(0, 120).map((item) => {
                              const qty = Number(orderQuantities[item.item_code] || 0);
                              const price = getPrice(priceList, item.item_code);

                              return (
                                <tr key={item.item_code} className="moduleItemRow">
                                  <td>{item.category || "Unclassified"}</td>
                                  <td>
                                    <strong>{item.item_name}</strong>
                                    <div className="moduleCode">{item.item_code}</div>
                                  </td>
                                  <td>{price ? `SAR ${price.toFixed(2)}` : "NOT FOUND"}</td>
                                  <td>
                                    <div className="moduleQtyControl">
                                      <button type="button" onClick={() => decreaseQty(item.item_code)}>−</button>
                                      <input
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={qty || ""}
                                        onChange={(event) => updateQty(item.item_code, event.target.value)}
                                      />
                                      <button type="button" onClick={() => increaseQty(item.item_code)}>+</button>
                                    </div>
                                  </td>
                                  <td>SAR {(price * qty).toFixed(2)}</td>
                                </tr>
                              );
                            })}
                        </Fragment>
                      );
                    })}
                    {groupedItems.length === 0 && (
                      <tr>
                        <td colSpan={5}>No items found for this filter.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="moduleSection">
              <div className="moduleOrderBar">
                <div>
                  <span>Current Order</span>
                  <strong>SAR {calculateGrandTotal(orderItems, priceList).toFixed(2)}</strong>
                </div>
                <div className="moduleOrderActions">
                  <button type="button" onClick={handleSaveDraft} disabled={savingOrder || submittingOrder || downloadingPdf}>
                    {savingOrder ? "Saving..." : draftOrderId ? "Update Draft" : "Save Draft"}
                  </button>
                  <button type="button" onClick={handleSubmitOrder} disabled={savingOrder || submittingOrder || downloadingPdf}>
                    {submittingOrder ? "Submitting..." : "Submit Order"}
                  </button>
                </div>
              </div>
            </section>

            {lastSavedOrder && (
              <section className="moduleSection moduleReviewSection">
                <div className="moduleSectionHeader">
                  <h2>Saved Order Review</h2>
                  <span>{lastSavedOrder.statusLabel}</span>
                </div>

                <div className="moduleReviewMeta">
                  <div>
                    <span>Order ID</span>
                    <strong>#{lastSavedOrder.orderId}</strong>
                  </div>
                  <div>
                    <span>Customer</span>
                    <strong>{lastSavedOrder.customerCode} - {lastSavedOrder.customerName}</strong>
                  </div>
                  <div>
                    <span>Saved At</span>
                    <strong>{new Date(lastSavedOrder.savedAtIso).toLocaleString("en-GB")}</strong>
                  </div>
                  <div>
                    <span>Total</span>
                    <strong>{formatMoney(lastSavedOrder.grandTotal)}</strong>
                  </div>
                </div>

                <div className="moduleTableWrap">
                  <table className="moduleTable">
                    <thead>
                      <tr>
                        <th>Item Code</th>
                        <th>Item Name</th>
                        <th>Qty</th>
                        <th>Rate</th>
                        <th>Line Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lastSavedOrder.lines.map((line) => (
                        <tr key={`${lastSavedOrder.orderId}-${line.item_code}`}>
                          <td>{line.item_code}</td>
                          <td>{line.item_name}</td>
                          <td>{line.quantity}</td>
                          <td>{formatMoney(line.rate)}</td>
                          <td>{formatMoney(line.lineTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="moduleReviewActions">
                  <button
                    type="button"
                    className="moduleInlineButton"
                    disabled={downloadingPdf}
                    onClick={() => downloadOrderPdf(lastSavedOrder)}
                  >
                    {downloadingPdf ? "Preparing PDF..." : "Download PDF Again"}
                  </button>
                  <a className="moduleShareLink" href={emailShareUrl}>Share via Email</a>
                  <a className="moduleShareLink" href={whatsappShareUrl} target="_blank" rel="noreferrer">
                    Share via WhatsApp
                  </a>
                </div>

                <p className="moduleReviewNote">
                  PDF downloads automatically after save/submit. Attach the downloaded file in Email or WhatsApp before sending.
                </p>
              </section>
            )}
          </>
        )}

        <section className="moduleSection">
          <div className="moduleSectionHeader">
            <h2>Previous Drafts</h2>
          </div>
          <div className="moduleTableWrap">
            <table className="moduleTable">
              <thead>
                <tr>
                  <th>Draft ID</th>
                  <th>Customer</th>
                  <th>Updated</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {previousDrafts.map((draft) => (
                  <tr key={draft.id}>
                    <td>{draft.id}</td>
                    <td>{draft.customer_name || draft.customer_code}</td>
                    <td>{draft.updated_at ? new Date(draft.updated_at).toLocaleString("en-GB") : "-"}</td>
                    <td>
                      <button
                        type="button"
                        className="moduleInlineButton"
                        onClick={() => setSelectedCustomerCode(draft.customer_code)}
                      >
                        Open Draft
                      </button>
                    </td>
                  </tr>
                ))}
                {previousDrafts.length === 0 && (
                  <tr>
                    <td colSpan={4}>No draft orders found.</td>
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
