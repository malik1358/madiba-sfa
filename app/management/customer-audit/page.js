"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

function money(value) {
  return Number(value || 0).toLocaleString("en-SA", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function qty(value) {
  return Number(value || 0).toLocaleString("en-SA", {
    maximumFractionDigits: 2,
  });
}

function shortDate(value) {
  if (!value) return "-";

  const d = new Date(`${value}T00:00:00`);

  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function daysBetween(date1, date2) {
  if (!date1 || !date2) return null;

  const a = new Date(`${date1}T00:00:00`);
  const b = new Date(`${date2}T00:00:00`);

  return Math.round((b - a) / 86400000);
}

export default function CustomerAuditPage() {
  const [loading, setLoading] = useState(true);
  const [loadingCustomer, setLoadingCustomer] = useState(false);
  const [error, setError] = useState("");

  const [salesmen, setSalesmen] = useState([]);
  const [customers, setCustomers] = useState([]);

  const [selectedSalesman, setSelectedSalesman] =
    useState("ALL");

  const [search, setSearch] = useState("");

  const [selectedCustomer, setSelectedCustomer] =
    useState(null);

  const [transactions, setTransactions] =
    useState([]);

  const [showTransactions, setShowTransactions] =
    useState(false);

  useEffect(() => {
    loadFoundation();
  }, []);

  async function loadFoundation() {
    setLoading(true);
    setError("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        throw new Error("Please login again.");
      }

      const {
        data: customerData,
        error: customerError,
      } = await supabase
        .from("customers")
        .select(`
          customer_code,
          customer_name,
          current_salesman_code,
          latest_transaction_date,
          customer_type,
          city,
          area,
          mobile
        `)
        .eq("is_active", true)
        .order("customer_name");

      if (customerError) {
        throw customerError;
      }

      const list = customerData || [];

      setCustomers(list);

      const salesmanCodes = [
        ...new Set(
          list
            .map(
              (customer) =>
                customer.current_salesman_code
            )
            .filter(Boolean)
        ),
      ].sort();

      setSalesmen(salesmanCodes);
    } catch (err) {
      setError(
        err.message ||
          "Unable to load customer data."
      );
    } finally {
      setLoading(false);
    }
  }

  const filteredCustomers = useMemo(() => {
    const q = search
      .trim()
      .toLowerCase();

    return customers.filter(
      (customer) => {
        const salesmanOK =
          selectedSalesman === "ALL" ||
          customer.current_salesman_code ===
            selectedSalesman;

        if (!salesmanOK) {
          return false;
        }

        if (!q) {
          return true;
        }

        return (
          String(
            customer.customer_code || ""
          )
            .toLowerCase()
            .includes(q) ||
          String(
            customer.customer_name || ""
          )
            .toLowerCase()
            .includes(q)
        );
      }
    );
  }, [
    customers,
    selectedSalesman,
    search,
  ]);

  async function openCustomer(customer) {
    setSelectedCustomer(customer);
    setTransactions([]);
    setLoadingCustomer(true);
    setShowTransactions(false);
    setError("");

    try {
      const {
        data: settings,
        error: settingsError,
      } = await supabase
        .from("system_settings")
        .select("setting_value")
        .eq(
          "setting_key",
          "active_sales_batch_id"
        )
        .single();

      if (settingsError) {
        throw settingsError;
      }

      const activeBatchId =
        Number(settings.setting_value);

      if (!activeBatchId) {
        throw new Error(
          "No active sales snapshot found."
        );
      }

      /*
        IMPORTANT:
        No Margin / GP / Cost fields are requested here.
      */

      const {
        data,
        error: salesError,
      } = await supabase
        .from("sales_raw")
        .select(`
          id,
          transaction_date,
          voucher_number,
          reference,
          customer_code,
          customer_name,
          salesman_code,
          salesman_name,
          item_code,
          item_name,
          category,
          local_import,
          quantity,
          rate,
          sales_amount,
          first_purchase_date,
          abc_class
        `)
        .eq(
          "import_batch_id",
          activeBatchId
        )
        .eq(
          "customer_code",
          customer.customer_code
        )
        .order(
          "transaction_date",
          {
            ascending: false,
          }
        )
        .order(
          "id",
          {
            ascending: false,
          }
        );

      if (salesError) {
        throw salesError;
      }

      setTransactions(data || []);
    } catch (err) {
      setError(
        err.message ||
          "Unable to load customer history."
      );
    } finally {
      setLoadingCustomer(false);
    }
  }

  const customerAnalytics =
    useMemo(() => {
      if (!transactions.length) {
        return null;
      }

      const totalSales =
        transactions.reduce(
          (sum, row) =>
            sum +
            Number(
              row.sales_amount || 0
            ),
          0
        );

      const totalQty =
        transactions.reduce(
          (sum, row) =>
            sum +
            Number(
              row.quantity || 0
            ),
          0
        );

      const itemMap =
        new Map();

      for (const row of transactions) {
        const key =
          row.item_code ||
          row.item_name;

        if (!itemMap.has(key)) {
          itemMap.set(key, {
            item_code:
              row.item_code,

            item_name:
              row.item_name,

            category:
              row.category,

            abc_class:
              row.abc_class,

            total_sales: 0,
            total_qty: 0,

            transaction_count: 0,

            first_date:
              row.transaction_date,

            last_date:
              row.transaction_date,

            months:
              new Set(),
          });
        }

        const item =
          itemMap.get(key);

        item.total_sales +=
          Number(
            row.sales_amount || 0
          );

        item.total_qty +=
          Number(
            row.quantity || 0
          );

        item.transaction_count += 1;

        if (
          row.transaction_date &&
          (
            !item.first_date ||
            row.transaction_date <
              item.first_date
          )
        ) {
          item.first_date =
            row.transaction_date;
        }

        if (
          row.transaction_date &&
          (
            !item.last_date ||
            row.transaction_date >
              item.last_date
          )
        ) {
          item.last_date =
            row.transaction_date;
        }

        if (row.transaction_date) {
          item.months.add(
            row.transaction_date.slice(
              0,
              7
            )
          );
        }
      }

      const latestDate =
        transactions.reduce(
          (latest, row) => {
            if (
              !row.transaction_date
            ) {
              return latest;
            }

            if (
              !latest ||
              row.transaction_date >
                latest
            ) {
              return row.transaction_date;
            }

            return latest;
          },
          null
        );

      const earliestDate =
        transactions.reduce(
          (earliest, row) => {
            if (
              !row.transaction_date
            ) {
              return earliest;
            }

            if (
              !earliest ||
              row.transaction_date <
                earliest
            ) {
              return row.transaction_date;
            }

            return earliest;
          },
          null
        );

      const items =
        Array.from(
          itemMap.values()
        )
          .map((item) => {
            const activeMonths =
              Math.max(
                item.months.size,
                1
              );

            return {
              ...item,

              active_months:
                activeMonths,

              avg_monthly_qty:
                item.total_qty /
                activeMonths,

              avg_monthly_sales:
                item.total_sales /
                activeMonths,

              days_since_last:
                latestDate &&
                item.last_date
                  ? daysBetween(
                      item.last_date,
                      latestDate
                    )
                  : null,
            };
          })
          .sort(
            (a, b) =>
              b.total_sales -
              a.total_sales
          );

      const categories =
        new Map();

      for (const item of items) {
        const category =
          item.category ||
          "Unclassified";

        if (
          !categories.has(
            category
          )
        ) {
          categories.set(
            category,
            {
              category,
              sales: 0,
              qty: 0,
              items: 0,
            }
          );
        }

        const c =
          categories.get(
            category
          );

        c.sales +=
          item.total_sales;

        c.qty +=
          item.total_qty;

        c.items += 1;
      }

      const categoryList =
        Array.from(
          categories.values()
        ).sort(
          (a, b) =>
            b.sales -
            a.sales
        );

      /*
        Count distinct vouchers/orders.
        If voucher number is missing,
        fall back to reference.
      */

      const orderSet =
        new Set();

      for (const row of transactions) {
        const orderKey =
          row.voucher_number ||
          row.reference;

        if (orderKey) {
          orderSet.add(orderKey);
        }
      }

      return {
        totalSales,
        totalQty,

        itemCount:
          items.length,

        transactionCount:
          transactions.length,

        orderCount:
          orderSet.size,

        latestDate,
        earliestDate,

        items,

        categories:
          categoryList,
      };
    }, [transactions]);

  if (loading) {
    return (
      <main className="auditPage">
        <div className="auditLoading">
          Loading customer database...
        </div>
      </main>
    );
  }

  return (
    <main className="auditPage">
      <div className="auditShell">

        <header className="auditTop">
          <div>
            <div className="auditBrand">
              MADIBA SFA
            </div>

            <h1>
              Customer Audit
            </h1>

            <p>
              Management sales history
              validation
            </p>
          </div>

          <a
            href="/"
            className="auditHome"
          >
            ← Home
          </a>
        </header>

        {error && (
          <div className="auditError">
            {error}
          </div>
        )}

        {!selectedCustomer && (
          <>
            <section className="auditFilters">

              <label>
                Salesman

                <select
                  value={
                    selectedSalesman
                  }
                  onChange={(e) =>
                    setSelectedSalesman(
                      e.target.value
                    )
                  }
                >
                  <option value="ALL">
                    All Salesmen
                  </option>

                  {salesmen.map(
                    (salesman) => (
                      <option
                        key={salesman}
                        value={salesman}
                      >
                        {salesman}
                      </option>
                    )
                  )}
                </select>
              </label>

              <label>
                Search Customer

                <input
                  type="search"
                  value={search}
                  onChange={(e) =>
                    setSearch(
                      e.target.value
                    )
                  }
                  placeholder="Code or customer name..."
                />
              </label>

            </section>

            <div className="auditCount">
              <strong>
                {
                  filteredCustomers.length
                }
              </strong>{" "}
              customers
            </div>

            <section className="auditCustomerList">

              {filteredCustomers.map(
                (customer) => (
                  <button
                    key={
                      customer.customer_code
                    }
                    className="auditCustomerCard"
                    onClick={() =>
                      openCustomer(
                        customer
                      )
                    }
                  >
                    <div className="auditCustomerCode">
                      {
                        customer.customer_code
                      }
                    </div>

                    <div className="auditCustomerBody">
                      <strong>
                        {
                          customer.customer_name
                        }
                      </strong>

                      <span>
                        {customer.current_salesman_code ||
                          "No salesman"}
                      </span>

                      <small>
                        Last transaction:{" "}
                        {shortDate(
                          customer.latest_transaction_date
                        )}
                      </small>
                    </div>

                    <div className="auditArrow">
                      ›
                    </div>
                  </button>
                )
              )}

            </section>
          </>
        )}

        {selectedCustomer && (
          <section className="auditDetail">

            <button
              className="auditBack"
              onClick={() => {
                setSelectedCustomer(
                  null
                );

                setTransactions(
                  []
                );

                setShowTransactions(
                  false
                );
              }}
            >
              ← Customers
            </button>

            <div className="auditCustomerHeader">

              <div className="auditCustomerHeaderCode">
                {
                  selectedCustomer.customer_code
                }
              </div>

              <h2>
                {
                  selectedCustomer.customer_name
                }
              </h2>

              <div className="auditSalesmanPill">
                {selectedCustomer.current_salesman_code ||
                  "No salesman"}
              </div>

              {(selectedCustomer.city ||
                selectedCustomer.area) && (
                <p>
                  {[
                    selectedCustomer.area,
                    selectedCustomer.city,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </p>
              )}

            </div>

            {loadingCustomer && (
              <div className="auditLoadingBox">
                Loading complete purchase
                history...
              </div>
            )}

            {!loadingCustomer &&
              customerAnalytics && (
                <>

                  {/* ==============================
                      MAIN CUSTOMER METRICS
                      ============================== */}

                  <div className="auditMetrics">

                    <div>
                      <span>
                        Total Sales
                      </span>

                      <strong>
                        SAR{" "}
                        {money(
                          customerAnalytics.totalSales
                        )}
                      </strong>
                    </div>

                    <div>
                      <span>
                        SKUs Bought
                      </span>

                      <strong>
                        {
                          customerAnalytics.itemCount
                        }
                      </strong>
                    </div>

                    <div>
                      <span>
                        Orders
                      </span>

                      <strong>
                        {
                          customerAnalytics.orderCount
                        }
                      </strong>
                    </div>

                    <div>
                      <span>
                        Last Purchase
                      </span>

                      <strong>
                        {shortDate(
                          customerAnalytics.latestDate
                        )}
                      </strong>
                    </div>

                  </div>

                  {/* ==============================
                      CATEGORY MIX
                      ============================== */}

                  <div className="auditSectionTitle">
                    Category Mix
                  </div>

                  <div className="auditCategoryList">

                    {customerAnalytics.categories.map(
                      (
                        category
                      ) => (
                        <div
                          className="auditCategoryCard"
                          key={
                            category.category
                          }
                        >
                          <div>
                            <strong>
                              {
                                category.category
                              }
                            </strong>

                            <span>
                              {
                                category.items
                              }{" "}
                              SKU
                              {category.items !==
                              1
                                ? "s"
                                : ""}
                            </span>
                          </div>

                          <div className="auditCategoryNumbers">
                            <strong>
                              SAR{" "}
                              {money(
                                category.sales
                              )}
                            </strong>

                            <span>
                              Qty{" "}
                              {qty(
                                category.qty
                              )}
                            </span>
                          </div>
                        </div>
                      )
                    )}

                  </div>

                  {/* ==============================
                      ITEM HISTORY
                      ============================== */}

                  <div className="auditSectionTitle">
                    Item Purchase History
                  </div>

                  <div className="auditItemList">

                    {customerAnalytics.items.map(
                      (item) => (
                        <div
                          className="auditItemCard"
                          key={
                            item.item_code ||
                            item.item_name
                          }
                        >

                          <div className="auditItemTop">

                            <div>
                              <div className="auditItemCode">
                                {item.item_code ||
                                  "-"}
                              </div>

                              <strong>
                                {
                                  item.item_name
                                }
                              </strong>

                              <span>
                                {item.category ||
                                  "Unclassified"}

                                {item.abc_class
                                  ? ` • ${item.abc_class}`
                                  : ""}
                              </span>
                            </div>

                            <div className="auditItemSales">
                              SAR{" "}
                              {money(
                                item.total_sales
                              )}
                            </div>

                          </div>

                          <div className="auditItemStats">

                            <div>
                              <span>
                                Total Qty
                              </span>

                              <strong>
                                {qty(
                                  item.total_qty
                                )}
                              </strong>
                            </div>

                            <div>
                              <span>
                                Avg / Active
                                Month
                              </span>

                              <strong>
                                {qty(
                                  item.avg_monthly_qty
                                )}
                              </strong>
                            </div>

                            <div>
                              <span>
                                Last Bought
                              </span>

                              <strong>
                                {shortDate(
                                  item.last_date
                                )}
                              </strong>
                            </div>

                            <div>
                              <span>
                                Purchase Bills
                              </span>

                              <strong>
                                {
                                  item.transaction_count
                                }
                              </strong>
                            </div>

                          </div>

                        </div>
                      )
                    )}

                  </div>

                  {/* ==============================
                      TRANSACTIONS
                      ============================== */}

                  <button
                    className="auditTransactionButton"
                    onClick={() =>
                      setShowTransactions(
                        !showTransactions
                      )
                    }
                  >
                    {showTransactions
                      ? "Hide Transactions"
                      : `View All ${customerAnalytics.transactionCount} Transaction Lines`}
                  </button>

                  {showTransactions && (
                    <div className="auditTransactions">

                      {transactions.map(
                        (row) => (
                          <div
                            className="auditTransaction"
                            key={row.id}
                          >

                            <div>
                              <strong>
                                {shortDate(
                                  row.transaction_date
                                )}
                              </strong>

                              <span>
                                {row.voucher_number ||
                                  row.reference ||
                                  "-"}
                              </span>
                            </div>

                            <div className="auditTransactionItem">
                              <strong>
                                {
                                  row.item_name
                                }
                              </strong>

                              <span>
                                Qty{" "}
                                {qty(
                                  row.quantity
                                )}
                              </span>
                            </div>

                            <div className="auditTransactionAmount">
                              SAR{" "}
                              {money(
                                row.sales_amount
                              )}
                            </div>

                          </div>
                        )
                      )}

                    </div>
                  )}

                </>
              )}

            {!loadingCustomer &&
              !customerAnalytics &&
              !error && (
                <div className="auditEmpty">
                  No transactions found for
                  this customer in the active
                  snapshot.
                </div>
              )}

          </section>
        )}

      </div>
    </main>
  );
}
