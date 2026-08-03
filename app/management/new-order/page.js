"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "../../lib/supabase";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { useOrder } from "../customer-audit/hooks/useOrder";
import { getPrice } from "../customer-audit/lib/helpers";
import { qtyFormat } from "../customer-audit/lib/format";
import { calculateGrandTotal } from "../customer-audit/lib/orderHelpers";

const PRICE_API =
  "https://script.google.com/macros/s/AKfycbzXPREoz0tUgern-5LhpEPBMY_ed2hO1fgYpIVfzG2-BU9HbjOklKCBFVMtsw64Uff5/exec";

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
                  <button type="button" onClick={saveDraft} disabled={savingOrder || submittingOrder}>
                    {savingOrder ? "Saving..." : draftOrderId ? "Update Draft" : "Save Draft"}
                  </button>
                  <button type="button" onClick={submitOrder} disabled={savingOrder || submittingOrder}>
                    {submittingOrder ? "Submitting..." : "Submit Order"}
                  </button>
                </div>
              </div>
            </section>
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
