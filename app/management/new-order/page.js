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

        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const marginX = 40;
        const marginTop = 38;
        const contentWidth = pageWidth - marginX * 2;
        const tableStartX = marginX;
        const vatRate = 0.15;
        const subtotal = Number(snapshot.grandTotal || 0);
        const vatAmount = subtotal * vatRate;
        const totalWithVat = subtotal + vatAmount;

        const columns = [
          { key: "item_code", label: "Item Code", width: 88, align: "left" },
          { key: "item_name", label: "Item Name", width: 222, align: "left" },
          { key: "quantity", label: "Qty", width: 60, align: "right" },
          { key: "rate", label: "Rate (Excl. VAT)", width: 96, align: "right" },
          { key: "lineTotal", label: "Line Total", width: 89, align: "right" },
        ];

        function drawCellText(text, x, y, width, align = "left") {
          if (align === "right") {
            doc.text(text, x + width - 6, y, { align: "right" });
            return;
          }
          doc.text(text, x + 6, y);
        }

        function drawTableHeader(startY) {
          let colX = tableStartX;
          doc.setFillColor(239, 244, 245);
          doc.rect(tableStartX, startY, contentWidth, 24, "F");
          doc.setFont(undefined, "bold");
          doc.setFontSize(10);

          columns.forEach((column) => {
            doc.rect(colX, startY, column.width, 24);
            drawCellText(column.label, colX, startY + 15, column.width, column.align);
            colX += column.width;
          });

          doc.setFont(undefined, "normal");
          return startY + 24;
        }

        doc.setDrawColor(72, 110, 120);
        doc.setLineWidth(1);
        doc.roundedRect(marginX, marginTop, contentWidth, 92, 6, 6);

        doc.setFontSize(18);
        doc.setFont(undefined, "bold");
        doc.text("MADIBA SFA", marginX + 12, marginTop + 24);
        doc.setFontSize(12);
        doc.text("SALES ORDER", marginX + 12, marginTop + 44);

        doc.setFont(undefined, "normal");
        doc.setFontSize(10);
        doc.text(`Order ID: ${snapshot.orderId}`, marginX + 12, marginTop + 64);
        doc.text(`Status: ${snapshot.statusLabel}`, marginX + 12, marginTop + 78);

        const rightColX = marginX + contentWidth - 210;
        doc.text(`Date: ${new Date(snapshot.savedAtIso).toLocaleString("en-GB")}`, rightColX, marginTop + 64);
        doc.text(`Salesman: ${snapshot.salesmanCode || "-"}`, rightColX, marginTop + 78);

        doc.setLineWidth(0.8);
        doc.roundedRect(marginX, marginTop + 104, contentWidth, 56, 5, 5);
        doc.setFont(undefined, "bold");
        doc.text("Customer", marginX + 12, marginTop + 124);
        doc.setFont(undefined, "normal");
        const customerText = `${snapshot.customerCode} - ${snapshot.customerName}`;
        const customerLines = doc.splitTextToSize(customerText, contentWidth - 24);
        const customerLine1 = Array.isArray(customerLines) ? customerLines[0] : customerText;
        const customerLine2 = Array.isArray(customerLines) && customerLines.length > 1 ? customerLines[1] : "";
        doc.text(customerLine1, marginX + 12, marginTop + 140);
        if (customerLine2) {
          doc.text(customerLine2, marginX + 12, marginTop + 152);
        }

        doc.roundedRect(marginX, marginTop + 172, contentWidth, 40, 5, 5);
        doc.setFont(undefined, "bold");
        doc.text("Items", marginX + 12, marginTop + 188);
        doc.text("Total Qty", marginX + 145, marginTop + 188);
        doc.text("Subtotal", marginX + 282, marginTop + 188);
        doc.text("VAT 15%", marginX + 398, marginTop + 188);
        doc.text("Total Incl. VAT", marginX + 475, marginTop + 188);
        doc.setFont(undefined, "normal");
        doc.text(String(snapshot.itemCount), marginX + 12, marginTop + 202);
        doc.text(qtyFormat(snapshot.totalQuantity), marginX + 145, marginTop + 202);
        doc.text(formatMoney(subtotal), marginX + 282, marginTop + 202);
        doc.text(formatMoney(vatAmount), marginX + 398, marginTop + 202);
        doc.text(formatMoney(totalWithVat), marginX + 475, marginTop + 202);

        let y = drawTableHeader(marginTop + 226);
        doc.setFontSize(10);

        snapshot.lines.forEach((line) => {
          const rowValues = {
            item_code: String(line.item_code || "-"),
            item_name: String(line.item_name || "-"),
            quantity: String(line.quantity),
            rate: formatMoney(line.rate),
            lineTotal: formatMoney(line.lineTotal),
          };

          const itemNameCol = columns.find((column) => column.key === "item_name");
          const wrappedName = doc.splitTextToSize(rowValues.item_name, (itemNameCol?.width || 200) - 12);
          const wrappedLines = Array.isArray(wrappedName) ? wrappedName : [rowValues.item_name];
          const rowHeight = Math.max(24, wrappedLines.length * 12 + 8);

          if (y + rowHeight > pageHeight - 110) {
            doc.addPage();
            y = drawTableHeader(marginTop);
          }

          let colX = tableStartX;
          columns.forEach((column) => {
            doc.rect(colX, y, column.width, rowHeight);

            if (column.key === "item_name") {
              wrappedLines.forEach((nameLine, index) => {
                drawCellText(nameLine, colX, y + 14 + index * 12, column.width, column.align);
              });
            } else {
              drawCellText(rowValues[column.key], colX, y + 15, column.width, column.align);
            }

            colX += column.width;
          });

          y += rowHeight;
        });

        const summaryBoxWidth = 220;
        const summaryX = pageWidth - marginX - summaryBoxWidth;
        const summaryY = Math.min(y + 16, pageHeight - 88);
        doc.roundedRect(summaryX, summaryY, summaryBoxWidth, 68, 4, 4);
        doc.setFont(undefined, "normal");
        doc.text("Subtotal (Excl. VAT)", summaryX + 10, summaryY + 18);
        doc.text(formatMoney(subtotal), summaryX + summaryBoxWidth - 10, summaryY + 18, { align: "right" });
        doc.text("VAT @ 15%", summaryX + 10, summaryY + 34);
        doc.text(formatMoney(vatAmount), summaryX + summaryBoxWidth - 10, summaryY + 34, { align: "right" });
        doc.setFont(undefined, "bold");
        doc.text("Total (Incl. VAT)", summaryX + 10, summaryY + 54);
        doc.text(formatMoney(totalWithVat), summaryX + summaryBoxWidth - 10, summaryY + 54, { align: "right" });
        doc.setFont(undefined, "normal");

        doc.setFontSize(9);
        doc.text("Note: Item rates are exclusive of VAT. VAT is applied at 15% on subtotal.", marginX, pageHeight - 28);

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
