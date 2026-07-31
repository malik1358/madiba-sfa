"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useState,
} from "react";

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

function numberFormat(value) {
  return Number(value || 0).toLocaleString("en-SA", {
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

function monthKey(date) {
  if (!date) return null;
  return date.slice(0, 7);
}

function monthLabel(key) {
  if (!key) return "";

  const [year, month] = key.split("-");

  const d = new Date(
    Number(year),
    Number(month) - 1,
    1
  );

  return d.toLocaleDateString("en-GB", {
    month: "short",
    year: "2-digit",
  });
}

function buildLast12Months(latestDate) {
  if (!latestDate) return [];

  const d = new Date(`${latestDate}T00:00:00`);
  const result = [];

  for (let i = 11; i >= 0; i--) {
    const x = new Date(
      d.getFullYear(),
      d.getMonth() - i,
      1
    );

    result.push(
      `${x.getFullYear()}-${String(
        x.getMonth() + 1
      ).padStart(2, "0")}`
    );
  }

  return result;
}

/*
  COLOR LOGIC

  current > previous = green
  current < previous = red
  current = previous = neutral

  If there is no previous month,
  no comparison colour is applied.
*/
function trendClass(current, previous, hasPrevious = true) {
  if (!hasPrevious) return "";

  const currentValue = Number(current || 0);
  const previousValue = Number(previous || 0);

  if (currentValue > previousValue) {
    return "auditTrendUp";
  }

  if (currentValue < previousValue) {
    return "auditTrendDown";
  }

  return "auditTrendSame";
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

  const [transactions, setTransactions] = useState([]);

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
    const q = search.trim().toLowerCase();

    return customers.filter((customer) => {
      const salesmanOK =
        selectedSalesman === "ALL" ||
        customer.current_salesman_code ===
          selectedSalesman;

      if (!salesmanOK) return false;

      if (!q) return true;

      return (
        String(customer.customer_code || "")
          .toLowerCase()
          .includes(q) ||
        String(customer.customer_name || "")
          .toLowerCase()
          .includes(q)
      );
    });
  }, [customers, selectedSalesman, search]);

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
          { ascending: false }
        )
        .order(
          "id",
          { ascending: false }
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

  const analytics = useMemo(() => {
    if (!transactions.length) {
      return null;
    }

    let latestDate = null;

    for (const row of transactions) {
      if (
        row.transaction_date &&
        (
          !latestDate ||
          row.transaction_date > latestDate
        )
      ) {
        latestDate = row.transaction_date;
      }
    }

    const months =
      buildLast12Months(latestDate);

    const monthSet =
      new Set(months);

    /*
      ======================================================
      MONTHLY CUSTOMER TOTAL
      ======================================================
    */

    const monthlyMap =
      new Map();

    months.forEach((month) => {
      monthlyMap.set(month, {
        sales: 0,
        skus: new Set(),
        orders: new Set(),
      });
    });

    /*
      ======================================================
      CATEGORY x MONTH

      Each category/month stores:
      - sales
      - distinct SKUs
      ======================================================
    */

    const categoryMap =
      new Map();

    /*
      ======================================================
      ITEM HISTORY
      ======================================================
    */

    const itemMap =
      new Map();

    const orderSet =
      new Set();

    for (const row of transactions) {
      const month =
        monthKey(
          row.transaction_date
        );

      const sales =
        Number(
          row.sales_amount || 0
        );

      const itemKey =
        row.item_code ||
        row.item_name ||
        "UNKNOWN";

      const orderKey =
        row.voucher_number ||
        row.reference ||
        `ROW-${row.id}`;

      /*
        MONTHLY CUSTOMER TOTAL
      */

      if (monthSet.has(month)) {
        const monthly =
          monthlyMap.get(month);

        monthly.sales += sales;

        if (
          row.item_code ||
          row.item_name
        ) {
          monthly.skus.add(
            itemKey
          );
        }

        monthly.orders.add(
          orderKey
        );

        /*
          CATEGORY MONTHLY DATA
        */

        const category =
          row.category ||
          "Unclassified";

        if (
          !categoryMap.has(
            category
          )
        ) {
          const monthValues = {};

          months.forEach(
            (monthKeyValue) => {
              monthValues[
                monthKeyValue
              ] = {
                sales: 0,
                skus: new Set(),
              };
            }
          );

          categoryMap.set(
            category,
            {
              category,
              months:
                monthValues,

              totalSales: 0,

              totalSkus:
                new Set(),
            }
          );
        }

        const cat =
          categoryMap.get(
            category
          );

        cat.months[
          month
        ].sales += sales;

        if (
          row.item_code ||
          row.item_name
        ) {
          cat.months[
            month
          ].skus.add(
            itemKey
          );

          cat.totalSkus.add(
            itemKey
          );
        }

        cat.totalSales += sales;
      }

      orderSet.add(
        orderKey
      );

      /*
        ITEM PURCHASE HISTORY
      */

      if (
        !itemMap.has(
          itemKey
        )
      ) {
        itemMap.set(
          itemKey,
          {
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

            transaction_count:
              0,

            last_date:
              row.transaction_date,

            active_months:
              new Set(),
          }
        );
      }

      const item =
        itemMap.get(
          itemKey
        );

      item.total_sales +=
        sales;

      item.total_qty +=
        Number(
          row.quantity || 0
        );

      item.transaction_count +=
        1;

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

      if (month) {
        item.active_months.add(
          month
        );
      }
    }

    /*
      MONTHLY SUMMARY
    */

    const monthlySummary =
      months.map(
        (month) => ({
          month,

          sales:
            monthlyMap.get(
              month
            ).sales,

          skuCount:
            monthlyMap.get(
              month
            ).skus.size,

          orderCount:
            monthlyMap.get(
              month
            ).orders.size,
        })
      );

    /*
      CATEGORY SUMMARY
    */

    const categories =
      Array.from(
        categoryMap.values()
      )
        .map((category) => {
          const monthData = {};

          months.forEach(
            (month) => {
              monthData[
                month
              ] = {
                sales:
                  category.months[
                    month
                  ].sales,

                skuCount:
                  category.months[
                    month
                  ].skus.size,
              };
            }
          );

          return {
            category:
              category.category,

            months:
              monthData,

            totalSales:
              category.totalSales,

            totalSkuCount:
              category.totalSkus
                .size,
          };
        })
        .sort(
          (a, b) =>
            b.totalSales -
            a.totalSales
        );

    /*
      ITEM SUMMARY
    */

    const items =
      Array.from(
        itemMap.values()
      )
        .map((item) => ({
          ...item,

          avg_monthly_qty:
            item.total_qty /
            Math.max(
              item.active_months
                .size,
              1
            ),
        }))
        .sort(
          (a, b) =>
            b.total_sales -
            a.total_sales
        );

    return {
      latestDate,
      months,
      monthlySummary,
      categories,
      items,

      orderCount:
        orderSet.size,

      itemCount:
        itemMap.size,

      transactionCount:
        transactions.length,
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
              Management sales history validation
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
                        key={
                          salesman
                        }
                        value={
                          salesman
                        }
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

            </div>

            {loadingCustomer && (
              <div className="auditLoadingBox">
                Loading complete purchase history...
              </div>
            )}

            {!loadingCustomer &&
              analytics && (
                <>

                  {/* ===============================
                      SUMMARY
                      =============================== */}

                  <div className="auditMetrics auditMetricsSmall">

                    <div>
                      <span>
                        Orders
                      </span>

                      <strong>
                        {
                          analytics.orderCount
                        }
                      </strong>
                    </div>

                    <div>
                      <span>
                        Last Purchase
                      </span>

                      <strong>
                        {shortDate(
                          analytics.latestDate
                        )}
                      </strong>
                    </div>

                  </div>

                  {/* ===============================
                      CUSTOMER 12 MONTH PERFORMANCE
                      =============================== */}

                  <div className="auditSectionTitle">
                    Last 12 Months Performance
                  </div>

                  <div className="auditTableScroll">

                    <table className="auditMatrix">

                      <thead>
                        <tr>

                          <th>
                            Metric
                          </th>

                          {analytics.months.map(
                            (month) => (
                              <th
                                key={
                                  month
                                }
                              >
                                {monthLabel(
                                  month
                                )}
                              </th>
                            )
                          )}

                          <th>
                            Total
                          </th>

                        </tr>
                      </thead>

                      <tbody>

                        {/* SALES */}

                        <tr>

                          <th>
                            Sales
                          </th>

                          {analytics.monthlySummary.map(
                            (
                              month,
                              index
                            ) => {
                              const previous =
                                index >
                                0
                                  ? analytics
                                      .monthlySummary[
                                      index -
                                        1
                                    ]
                                      .sales
                                  : null;

                              return (
                                <td
                                  key={
                                    month.month
                                  }
                                  className={trendClass(
                                    month.sales,
                                    previous,
                                    index >
                                      0
                                  )}
                                >
                                  {month.sales
                                    ? numberFormat(
                                        month.sales
                                      )
                                    : "-"}
                                </td>
                              );
                            }
                          )}

                          <td className="auditMatrixTotal">
                            {numberFormat(
                              analytics.monthlySummary.reduce(
                                (
                                  sum,
                                  month
                                ) =>
                                  sum +
                                  month.sales,
                                0
                              )
                            )}
                          </td>

                        </tr>

                        {/* SKU */}

                        <tr>

                          <th>
                            SKUs Bought
                          </th>

                          {analytics.monthlySummary.map(
                            (
                              month,
                              index
                            ) => {
                              const previous =
                                index >
                                0
                                  ? analytics
                                      .monthlySummary[
                                      index -
                                        1
                                    ]
                                      .skuCount
                                  : null;

                              return (
                                <td
                                  key={
                                    month.month
                                  }
                                  className={trendClass(
                                    month.skuCount,
                                    previous,
                                    index >
                                      0
                                  )}
                                >
                                  {month.skuCount ||
                                    "-"}
                                </td>
                              );
                            }
                          )}

                          <td className="auditMatrixTotal">
                            {
                              analytics.itemCount
                            }
                          </td>

                        </tr>

                      </tbody>

                    </table>

                  </div>

                  {/* ===============================
                      CATEGORY x MONTH
                      =============================== */}

                  <div className="auditSectionTitle">
                    Category Performance by Month
                  </div>

                  <div className="auditTableScroll">

                    <table className="auditMatrix auditCategoryMatrix">

                      <thead>

                        <tr>

                          <th>
                            Category / Metric
                          </th>

                          {analytics.months.map(
                            (month) => (
                              <th
                                key={
                                  month
                                }
                              >
                                {monthLabel(
                                  month
                                )}
                              </th>
                            )
                          )}

                          <th>
                            Total
                          </th>

                        </tr>

                      </thead>

                      <tbody>

                        {analytics.categories.map(
                          (
                            category
                          ) => (
                            <Fragment key={category.category}>

                              {/* CATEGORY SALES */}

                              <tr
                                key={`${category.category}-sales`}
                                className="auditCategorySalesRow"
                              >

                                <th>
                                  <strong>
                                    {
                                      category.category
                                    }
                                  </strong>

                                  <small>
                                    Sales
                                  </small>
                                </th>

                                {analytics.months.map(
                                  (
                                    month,
                                    index
                                  ) => {
                                    const current =
                                      category
                                        .months[
                                        month
                                      ].sales;

                                    const previous =
                                      index >
                                      0
                                        ? category
                                            .months[
                                            analytics
                                              .months[
                                              index -
                                                1
                                            ]
                                          ]
                                            .sales
                                        : null;

                                    return (
                                      <td
                                        key={
                                          month
                                        }
                                        className={trendClass(
                                          current,
                                          previous,
                                          index >
                                            0
                                        )}
                                      >
                                        {current
                                          ? numberFormat(
                                              current
                                            )
                                          : "-"}
                                      </td>
                                    );
                                  }
                                )}

                                <td className="auditMatrixTotal">
                                  {numberFormat(
                                    category.totalSales
                                  )}
                                </td>

                              </tr>

                              {/* CATEGORY SKU */}

                              <tr
                                key={`${category.category}-sku`}
                                className="auditCategorySkuRow"
                              >

                                <th>
                                  <span className="auditSubMetric">
                                    SKUs Bought
                                  </span>
                                </th>

                                {analytics.months.map(
                                  (
                                    month,
                                    index
                                  ) => {
                                    const current =
                                      category
                                        .months[
                                        month
                                      ]
                                        .skuCount;

                                    const previous =
                                      index >
                                      0
                                        ? category
                                            .months[
                                            analytics
                                              .months[
                                              index -
                                                1
                                            ]
                                          ]
                                            .skuCount
                                        : null;

                                    return (
                                      <td
                                        key={
                                          month
                                        }
                                        className={trendClass(
                                          current,
                                          previous,
                                          index >
                                            0
                                        )}
                                      >
                                        {current ||
                                          "-"}
                                      </td>
                                    );
                                  }
                                )}

                                <td className="auditMatrixTotal">
                                  {
                                    category.totalSkuCount
                                  }
                                </td>

                              </tr>

                            </Fragment>
                          )
                        )}

                      </tbody>

                    </table>

                  </div>

                  {/* ===============================
                      ITEM PURCHASE HISTORY
                      =============================== */}

                  <div className="auditSectionTitle">
                    Item Purchase History
                  </div>

                  <div className="auditItemList">

                    {analytics.items.map(
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
                              {numberFormat(
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
                                Avg / Active Month
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
                      : `View All ${analytics.transactionCount} Transaction Lines`}
                  </button>

                  {showTransactions && (
                    <div className="auditTransactions">

                      {transactions.map(
                        (row) => (
                          <div
                            className="auditTransaction"
                            key={
                              row.id
                            }
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
                              {numberFormat(
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

          </section>
        )}

      </div>
    </main>
  );
}
