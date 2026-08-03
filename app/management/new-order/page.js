"use client";

import { useEffect, useState, useMemo } from "react";
import { getSupabaseClient } from "../../lib/supabase";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";

const PRICE_API =
  "https://script.google.com/macros/s/AKfycbzXPREoz0tUgern-5LhpEPBMY_ed2hO1fgYpIVfzG2-BU9HbjOklKCBFVMtsw64Uff5/exec";

export default function NewOrderPage() {
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [search, setSearch] = useState("");
  const [priceList, setPriceList] = useState({});
  const [itemMaster, setItemMaster] = useState([]);
  const [orderItems, setOrderItems] = useState([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const supabaseClient = getSupabaseClient();

  useEffect(() => {
    async function loadData() {
      try {
        const supabase = getSupabaseClient();
        if (!supabase) {
          setLoading(false);
          return;
        }

        // Load customers
        const { data: customersData, error: customersError } = await supabase
          .from("customers")
          .select("*")
          .order("customer_name");

        if (customersError) throw customersError;
        setCustomers(customersData || []);

        // Load item master
        const { data: itemsData, error: itemsError } = await supabase
          .from("item_master")
          .select("*")
          .order("item_name");

        if (itemsError) throw itemsError;
        setItemMaster(itemsData || []);

        setLoading(false);
      } catch (err) {
        setError(err.message || "Failed to load data");
        setLoading(false);
      }
    }

    loadData();
  }, []);

  useEffect(() => {
    async function loadPrices() {
      try {
        const response = await fetch(PRICE_API);
        const prices = await response.json();
        setPriceList(prices);
      } catch {
        // Ignore price lookup failures
      }
    }

    loadPrices();
  }, []);

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;

    return customers.filter((customer) => {
      return (
        String(customer.customer_code || "").toLowerCase().includes(q) ||
        String(customer.customer_name || "").toLowerCase().includes(q)
      );
    });
  }, [customers, search]);

  function addItemToOrder(item) {
    const existing = orderItems.find((oi) => oi.item_code === item.item_code);
    if (existing) {
      setOrderItems(
        orderItems.map((oi) =>
          oi.item_code === item.item_code
            ? { ...oi, order_quantity: oi.order_quantity + 1 }
            : oi
        )
      );
    } else {
      setOrderItems([
        ...orderItems,
        {
          item_code: item.item_code,
          item_name: item.item_name,
          category: item.category,
          order_quantity: 1,
        },
      ]);
    }
  }

  function updateOrderQty(itemCode, value) {
    const qty = Math.max(0, Number(value) || 0);
    setOrderItems(
      orderItems.map((oi) =>
        oi.item_code === itemCode ? { ...oi, order_quantity: qty } : oi
      )
    );
  }

  function removeOrderItem(itemCode) {
    setOrderItems(orderItems.filter((oi) => oi.item_code !== itemCode));
  }

  async function submitOrder() {
    if (!selectedCustomer) {
      setError("Please select a customer");
      return;
    }

    if (orderItems.length === 0) {
      setError("Please add at least one item");
      return;
    }

    setSubmitting(true);
    setError("");
    setMessage("");

    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Supabase not configured");

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Please login again");

      // Create order
      const { data: newOrder, error: orderError } = await supabase
        .from("sales_orders")
        .insert({
          customer_code: selectedCustomer.customer_code,
          customer_name: selectedCustomer.customer_name,
          salesman_code: selectedCustomer.current_salesman_code,
          status: "SUBMITTED",
          created_by: session.user.id,
          submitted_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (orderError) throw orderError;

      // Insert order items
      const lines = orderItems.map((item) => ({
        order_id: newOrder.id,
        item_code: item.item_code,
        item_name: item.item_name,
        category: item.category,
        quantity: Number(item.order_quantity),
        rate: Number(
          priceList[String(item.item_code).trim().toUpperCase()] || 0
        ),
        line_value:
          Number(priceList[String(item.item_code).trim().toUpperCase()] || 0) *
          Number(item.order_quantity),
      }));

      const { error: lineError } = await supabase
        .from("sales_order_items")
        .insert(lines);

      if (lineError) throw lineError;

      setMessage(`Order #${newOrder.id} created successfully!`);
      setSelectedCustomer(null);
      setOrderItems([]);
      setSearch("");
    } catch (err) {
      setError(err.message || "Failed to submit order");
    } finally {
      setSubmitting(false);
    }
  }

  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="New Order unavailable"
        message="The new order module requires Supabase credentials to access customer and pricing data."
      />
    );
  }

  if (loading) {
    return (
      <main className="auditPage">
        <div className="auditShell">
          <div className="auditBrand">MADIBA SFA</div>
          <h1>New Order</h1>
          <p className="auditSubtitle">Loading...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="auditPage">
      <div className="auditShell">
        <div className="auditTop">
          <div>
            <div className="auditBrand">MADIBA SFA</div>
            <h1>New Order</h1>
            <p className="auditSubtitle">Create and submit a new customer order</p>
          </div>
          <a href="/" className="auditHomeButton">
            ← Dashboard
          </a>
        </div>

        {message && <div className="auditSuccess">{message}</div>}
        {error && <div className="auditError">{error}</div>}

        {!selectedCustomer ? (
          <section className="auditSection">
            <h3 className="auditSectionTitle">Select Customer</h3>

            <input
              type="text"
              placeholder="Search customer by code or name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                marginBottom: "12px",
                border: "1px solid #cbd8dc",
                borderRadius: "8px",
                fontSize: "14px",
              }}
            />

            <div style={{ maxHeight: "400px", overflowY: "auto" }}>
              {filteredCustomers.length === 0 ? (
                <div className="auditEmpty">
                  {search ? "No customers found" : "No customers available"}
                </div>
              ) : (
                filteredCustomers.map((customer) => (
                  <div
                    key={customer.customer_code}
                    style={{
                      padding: "12px",
                      border: "1px solid #d1dde0",
                      borderRadius: "8px",
                      marginBottom: "8px",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = "#f0f7f9";
                      e.currentTarget.style.borderColor = "#0b5364";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = "transparent";
                      e.currentTarget.style.borderColor = "#d1dde0";
                    }}
                    onClick={() => setSelectedCustomer(customer)}
                  >
                    <div style={{ fontWeight: 800, color: "#073f4c" }}>
                      {customer.customer_code}
                    </div>
                    <div style={{ color: "#0b6072", fontSize: "14px" }}>
                      {customer.customer_name}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        ) : (
          <>
            <section className="auditSection">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <div>
                  <h3 className="auditSectionTitle">{selectedCustomer.customer_name}</h3>
                  <p style={{ color: "#6c838a", fontSize: "12px" }}>
                    {selectedCustomer.customer_code}
                  </p>
                </div>
                <button
                  type="button"
                  className="auditBackButton"
                  onClick={() => {
                    setSelectedCustomer(null);
                    setOrderItems([]);
                  }}
                >
                  ← Change Customer
                </button>
              </div>

              <div className="auditEmpty" style={{ marginBottom: "16px" }}>
                <strong>Add Items</strong>
                <p>Search and select items to add to the order</p>
              </div>

              <input
                type="text"
                placeholder="Search items..."
                onChange={(e) => {
                  const q = e.target.value.toLowerCase();
                  if (!q) return;

                  const matching = itemMaster.filter(
                    (item) =>
                      String(item.item_code || "").toLowerCase().includes(q) ||
                      String(item.item_name || "").toLowerCase().includes(q)
                  );

                  if (matching.length === 1) {
                    addItemToOrder(matching[0]);
                    e.target.value = "";
                  }
                }}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  marginBottom: "12px",
                  border: "1px solid #cbd8dc",
                  borderRadius: "8px",
                  fontSize: "14px",
                }}
              />
            </section>

            {orderItems.length > 0 && (
              <section className="auditSection">
                <h3 className="auditSectionTitle">Order Items</h3>

                <div style={{ overflowX: "auto" }}>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: "12px",
                    }}
                  >
                    <thead>
                      <tr style={{ backgroundColor: "#eef5f6" }}>
                        <th
                          style={{
                            padding: "10px",
                            textAlign: "left",
                            borderBottom: "1px solid #d1dde0",
                          }}
                        >
                          Item
                        </th>
                        <th
                          style={{
                            padding: "10px",
                            textAlign: "left",
                            borderBottom: "1px solid #d1dde0",
                          }}
                        >
                          Category
                        </th>
                        <th
                          style={{
                            padding: "10px",
                            textAlign: "left",
                            borderBottom: "1px solid #d1dde0",
                          }}
                        >
                          Rate
                        </th>
                        <th
                          style={{
                            padding: "10px",
                            textAlign: "center",
                            borderBottom: "1px solid #d1dde0",
                          }}
                        >
                          Qty
                        </th>
                        <th
                          style={{
                            padding: "10px",
                            textAlign: "right",
                            borderBottom: "1px solid #d1dde0",
                          }}
                        >
                          Total
                        </th>
                        <th
                          style={{
                            padding: "10px",
                            textAlign: "center",
                            borderBottom: "1px solid #d1dde0",
                          }}
                        >
                          Action
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderItems.map((item) => {
                        const rate = Number(
                          priceList[String(item.item_code).trim().toUpperCase()] || 0
                        );
                        const total = rate * item.order_quantity;
                        return (
                          <tr key={item.item_code} style={{ borderBottom: "1px solid #d1dde0" }}>
                            <td style={{ padding: "10px" }}>
                              <div style={{ fontWeight: 800 }}>{item.item_code}</div>
                              <div style={{ color: "#6c838a" }}>{item.item_name}</div>
                            </td>
                            <td style={{ padding: "10px" }}>{item.category || "—"}</td>
                            <td style={{ padding: "10px", fontWeight: 800 }}>
                              SAR {rate.toFixed(2)}
                            </td>
                            <td style={{ padding: "10px", textAlign: "center" }}>
                              <input
                                type="number"
                                min="0"
                                value={item.order_quantity}
                                onChange={(e) =>
                                  updateOrderQty(item.item_code, e.target.value)
                                }
                                style={{
                                  width: "50px",
                                  textAlign: "center",
                                  padding: "4px",
                                  border: "1px solid #cbd8dc",
                                  borderRadius: "4px",
                                }}
                              />
                            </td>
                            <td style={{ padding: "10px", textAlign: "right", fontWeight: 800 }}>
                              SAR {total.toFixed(2)}
                            </td>
                            <td style={{ padding: "10px", textAlign: "center" }}>
                              <button
                                type="button"
                                onClick={() => removeOrderItem(item.item_code)}
                                style={{
                                  background: "#fff1f1",
                                  color: "#a42c2c",
                                  border: "1px solid #e8c8c8",
                                  borderRadius: "4px",
                                  padding: "4px 8px",
                                  cursor: "pointer",
                                  fontSize: "12px",
                                }}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div
                  style={{
                    marginTop: "16px",
                    padding: "12px",
                    backgroundColor: "#f9fbfc",
                    borderRadius: "8px",
                    textAlign: "right",
                    fontWeight: 800,
                  }}
                >
                  Order Total: SAR{" "}
                  {orderItems
                    .reduce(
                      (sum, item) =>
                        sum +
                        Number(
                          priceList[String(item.item_code).trim().toUpperCase()] || 0
                        ) *
                          item.order_quantity,
                      0
                    )
                    .toFixed(2)}
                </div>

                <button
                  type="button"
                  className="auditSubmitOrderButton"
                  onClick={submitOrder}
                  disabled={submitting}
                  style={{
                    width: "100%",
                    marginTop: "16px",
                    padding: "12px",
                    minHeight: "44px",
                  }}
                >
                  {submitting ? "Submitting..." : "Submit Order"}
                </button>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
