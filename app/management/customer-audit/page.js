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


/* ==========================================================
   FORMATTING
   ========================================================== */

function numberFormat(value) {
  return Number(value || 0).toLocaleString("en-SA", {
    maximumFractionDigits: 0,
  });
}

function qtyFormat(value) {
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

  return String(date).slice(0, 7);
}

function monthName(key) {
  if (!key) return "";

  const [year, month] = key.split("-");

  const d = new Date(
    Number(year),
    Number(month) - 1,
    1
  );

  return d.toLocaleDateString("en-GB", {
    month: "short",
  });
}


/* ==========================================================
   LAST 12 MONTHS
   ========================================================== */

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


/* ==========================================================
   TREND COLOUR
   ========================================================== */

function trendClass(
  current,
  previous,
  hasPrevious = true
) {
  if (!hasPrevious) return "";

  const currentValue =
    Number(current || 0);

  const previousValue =
    Number(previous || 0);

  if (currentValue > previousValue) {
    return "auditTrendUp";
  }

  if (currentValue < previousValue) {
    return "auditTrendDown";
  }

  return "auditTrendSame";
}


/* ==========================================================
   PAGE
   ========================================================== */

export default function CustomerAuditPage() {

  const [loading, setLoading] =
    useState(true);

  const [
    loadingCustomer,
    setLoadingCustomer,
  ] = useState(false);

  const [error, setError] =
    useState("");

  const [message, setMessage] =
    useState("");


  /* ========================================================
     CUSTOMER LIST
     ======================================================== */

  const [salesmen, setSalesmen] =
    useState([]);

  const [customers, setCustomers] =
    useState([]);

  const [
    selectedSalesman,
    setSelectedSalesman,
  ] = useState("ALL");

  const [search, setSearch] =
    useState("");

  const [
    selectedCustomer,
    setSelectedCustomer,
  ] = useState(null);

  const [
    transactions,
    setTransactions,
  ] = useState([]);

  const [
    showTransactions,
    setShowTransactions,
  ] = useState(false);


  /* ========================================================
     CATEGORY DRILL DOWN
     ======================================================== */

  const [
    expandedCategories,
    setExpandedCategories,
  ] = useState({});


  /* ========================================================
     ORDER
     ======================================================== */

  const [draftOrderId, setDraftOrderId] =
    useState(null);

  const [
    orderQuantities,
    setOrderQuantities,
  ] = useState({});

  const [savingOrder, setSavingOrder] =
    useState(false);

  const [
    submittingOrder,
    setSubmittingOrder,
  ] = useState(false);

  const [
    showOrderReview,
    setShowOrderReview,
  ] = useState(false);


  /* ========================================================
     INITIAL LOAD
     ======================================================== */

  useEffect(() => {
    loadFoundation();
  }, []);


  /* ========================================================
     LOAD CUSTOMERS
     ======================================================== */

  async function loadFoundation() {

    setLoading(true);
    setError("");

    try {

      const {
        data: { session },
      } =
        await supabase.auth.getSession();

      if (!session) {
        throw new Error(
          "Please login again."
        );
      }

      const {
        data: customerData,
        error: customerError,
      } =
        await supabase
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

      const list =
        customerData || [];

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

      setSalesmen(
        salesmanCodes
      );

    } catch (err) {

      setError(
        err.message ||
          "Unable to load customer data."
      );

    } finally {

      setLoading(false);
    }
  }


  /* ========================================================
     CUSTOMER FILTER
     ======================================================== */

  const filteredCustomers =
    useMemo(() => {

      const q =
        search
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


  /* ========================================================
     OPEN CUSTOMER
     ======================================================== */

  async function openCustomer(customer) {

    setSelectedCustomer(
      customer
    );

    setTransactions([]);

    setLoadingCustomer(true);

    setShowTransactions(false);

    setExpandedCategories({});

    setOrderQuantities({});

    setDraftOrderId(null);

    setShowOrderReview(false);

    setMessage("");

    setError("");

    try {

      /* ----------------------------------------------------
         ACTIVE SALES SNAPSHOT
         ---------------------------------------------------- */

      const {
        data: settings,
        error: settingsError,
      } =
        await supabase
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
        Number(
          settings.setting_value
        );

      if (!activeBatchId) {
        throw new Error(
          "No active sales snapshot found."
        );
      }


      /* ----------------------------------------------------
         CUSTOMER SALES HISTORY

         Historical sales are loaded here.
         Rate is NOT being used as the new order rate.
         ---------------------------------------------------- */

      const {
        data,
        error: salesError,
      } =
        await supabase
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

      setTransactions(
        data || []
      );


      /* ----------------------------------------------------
         LOAD EXISTING DRAFT

         Only the logged-in user's draft for this customer.
         ---------------------------------------------------- */

      const {
        data: { session },
      } =
        await supabase.auth.getSession();

      if (session) {

        const {
          data: draft,
          error: draftError,
        } =
          await supabase
            .from("sales_orders")
            .select(`
              id,
              customer_code,
              status,
              created_by
            `)
            .eq(
              "customer_code",
              customer.customer_code
            )
            .eq(
              "status",
              "DRAFT"
            )
            .eq(
              "created_by",
              session.user.id
            )
            .order(
              "updated_at",
              {
                ascending: false,
              }
            )
            .limit(1)
            .maybeSingle();

        if (draftError) {
          throw draftError;
        }

        if (draft) {

          setDraftOrderId(
            draft.id
          );

          const {
            data: lines,
            error: lineError,
          } =
            await supabase
              .from(
                "sales_order_items"
              )
              .select(`
                item_code,
                quantity
              `)
              .eq(
                "order_id",
                draft.id
              );

          if (lineError) {
            throw lineError;
          }

          const loadedQuantities =
            {};

          (lines || []).forEach(
            (line) => {

              loadedQuantities[
                line.item_code
              ] =
                Number(
                  line.quantity || 0
                );

            }
          );

          setOrderQuantities(
            loadedQuantities
          );
        }
      }

    } catch (err) {

      setError(
        err.message ||
          "Unable to load customer history."
      );

    } finally {

      setLoadingCustomer(false);
    }
  }


  /* ========================================================
     CATEGORY EXPAND / COLLAPSE
     ======================================================== */

  function toggleCategory(category) {

    setExpandedCategories(
      (current) => ({
        ...current,

        [category]:
          !current[category],
      })
    );
  }


  /* ========================================================
     CHANGE ORDER QTY
     ======================================================== */

  function changeOrderQty(
    itemCode,
    value
  ) {

    if (!itemCode) {
      return;
    }

    let newValue =
      Number(value || 0);

    if (
      !Number.isFinite(
        newValue
      )
    ) {
      newValue = 0;
    }

    if (newValue < 0) {
      newValue = 0;
    }

    setOrderQuantities(
      (current) => {

        const next = {
          ...current,
        };

        if (newValue <= 0) {
          delete next[
            itemCode
          ];
        } else {
          next[
            itemCode
          ] = newValue;
        }

        return next;
      }
    );
  }


  function increaseOrderQty(
    itemCode
  ) {

    const current =
      Number(
        orderQuantities[
          itemCode
        ] || 0
      );

    changeOrderQty(
      itemCode,
      current + 1
    );
  }


  function decreaseOrderQty(
    itemCode
  ) {

    const current =
      Number(
        orderQuantities[
          itemCode
        ] || 0
      );

    changeOrderQty(
      itemCode,
      Math.max(
        current - 1,
        0
      )
    );
  }


  /* ========================================================
     ANALYTICS
     ======================================================== */

  const analytics =
    useMemo(() => {

      if (!transactions.length) {
        return null;
      }


      /* ----------------------------------------------------
         FIND LATEST TRANSACTION DATE
         ---------------------------------------------------- */

      let latestDate = null;

      for (
        const row
        of transactions
      ) {

        if (
          row.transaction_date &&
          (
            !latestDate ||
            row.transaction_date >
              latestDate
          )
        ) {
          latestDate =
            row.transaction_date;
        }
      }


      /* ----------------------------------------------------
         CREATE LAST 12 MONTH RANGE
         ---------------------------------------------------- */

      const allMonths =
        buildLast12Months(
          latestDate
        );

      const monthSet =
        new Set(
          allMonths
        );


      /* ----------------------------------------------------
         CUSTOMER MONTHLY DATA
         ---------------------------------------------------- */

      const monthlyMap =
        new Map();

      allMonths.forEach(
        (month) => {

          monthlyMap.set(
            month,
            {
              sales: 0,
              skus: new Set(),
              orders: new Set(),
              hasActivity: false,
            }
          );
        }
      );


      /* ----------------------------------------------------
         CATEGORY DATA
         ---------------------------------------------------- */

      const categoryMap =
        new Map();


      /* ----------------------------------------------------
         ITEM DATA

         Each item stores:
         - Category
         - Item code
         - Item name
         - Total historical value
         - Total historical quantity
         - Monthly value
         - Monthly quantity
         ---------------------------------------------------- */

      const itemMap =
        new Map();

      const orderSet =
        new Set();


      /* ====================================================
         PROCESS TRANSACTIONS
         ==================================================== */

      for (
        const row
        of transactions
      ) {

        const month =
          monthKey(
            row.transaction_date
          );

        const sales =
          Number(
            row.sales_amount || 0
          );

        const quantity =
          Number(
            row.quantity || 0
          );

        const itemCode =
          String(
            row.item_code ||
            ""
          ).trim();

        const itemName =
          row.item_name ||
          itemCode ||
          "Unknown Item";

        const itemKey =
          itemCode ||
          itemName;

        const category =
          row.category ||
          "Unclassified";

        const orderKey =
          row.voucher_number ||
          row.reference ||
          `ROW-${row.id}`;

        orderSet.add(
          orderKey
        );


        /* --------------------------------------------------
           CUSTOMER MONTH
           -------------------------------------------------- */

        if (
          monthSet.has(month)
        ) {

          const monthly =
            monthlyMap.get(
              month
            );

          monthly.sales +=
            sales;

          monthly.hasActivity =
            true;

          if (
            itemCode ||
            itemName
          ) {

            monthly.skus.add(
              itemKey
            );
          }

          monthly.orders.add(
            orderKey
          );
        }


        /* --------------------------------------------------
           CREATE CATEGORY
           -------------------------------------------------- */

        if (
          !categoryMap.has(
            category
          )
        ) {

          const monthValues =
            {};

          allMonths.forEach(
            (monthValue) => {

              monthValues[
                monthValue
              ] = {
                sales: 0,
                skus:
                  new Set(),
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

              itemKeys:
                new Set(),
            }
          );
        }


        const categoryData =
          categoryMap.get(
            category
          );


        categoryData.itemKeys.add(
          itemKey
        );


        if (
          monthSet.has(month)
        ) {

          categoryData
            .months[
              month
            ]
            .sales +=
              sales;

          categoryData
            .months[
              month
            ]
            .skus.add(
              itemKey
            );

          categoryData
            .totalSales +=
              sales;

          categoryData
            .totalSkus.add(
              itemKey
            );
        }


        /* --------------------------------------------------
           CREATE ITEM
           -------------------------------------------------- */

        if (
          !itemMap.has(
            itemKey
          )
        ) {

          const itemMonths =
            {};

          allMonths.forEach(
            (monthValue) => {

              itemMonths[
                monthValue
              ] = {
                value: 0,
                quantity: 0,
              };
            }
          );

          itemMap.set(
            itemKey,
            {
              item_key:
                itemKey,

              item_code:
                itemCode,

              item_name:
                itemName,

              category,

              abc_class:
                row.abc_class,

              months:
                itemMonths,

              total_value: 0,

              total_quantity: 0,

              last_date:
                row.transaction_date,
            }
          );
        }


        const item =
          itemMap.get(
            itemKey
          );


        if (
          monthSet.has(month)
        ) {

          item.months[
            month
          ].value +=
            sales;

          item.months[
            month
          ].quantity +=
            quantity;

          item.total_value +=
            sales;

          item.total_quantity +=
            quantity;
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
      }


     /* ====================================================
   SHOW ONLY LAST 6 MONTHS WITH TRANSACTIONS
   ==================================================== */

const activeMonths =
  allMonths.filter(
    (month) =>
      monthlyMap.get(
        month
      ).hasActivity
  );

const months =
  activeMonths.slice(-6);


      /* ====================================================
         YEAR GROUPS
         ==================================================== */

      const yearGroups = [];

      months.forEach(
        (month) => {

          const year =
            month.slice(0, 4);

          const existing =
            yearGroups.find(
              (group) =>
                group.year ===
                year
            );

          if (existing) {

            existing.months.push(
              month
            );

          } else {

            yearGroups.push({
              year,
              months: [
                month,
              ],
            });
          }
        }
      );


      /* ====================================================
         MONTHLY SUMMARY
         ==================================================== */

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


      /* ====================================================
         ITEMS
         ==================================================== */

      const items =
        Array.from(
          itemMap.values()
        )
          .filter(
            (item) =>
              item.item_code
          )
          .sort(
            (a, b) =>
              b.total_value -
              a.total_value
          );


      const itemLookup =
        {};

      items.forEach(
        (item) => {

          itemLookup[
            item.item_key
          ] = item;
        }
      );


      /* ====================================================
         CATEGORIES + THEIR ITEMS
         ==================================================== */

      const categories =
        Array.from(
          categoryMap.values()
        )
          .map(
            (category) => {

              const monthData =
                {};

              months.forEach(
                (month) => {

                  monthData[
                    month
                  ] = {

                    sales:
                      category
                        .months[
                          month
                        ]
                        .sales,

                    skuCount:
                      category
                        .months[
                          month
                        ]
                        .skus
                        .size,
                  };
                }
              );


              const categoryItems =
                Array.from(
                  category.itemKeys
                )
                  .map(
                    (itemKey) =>
                      itemLookup[
                        itemKey
                      ]
                  )
                  .filter(Boolean)
                  .sort(
                    (a, b) =>
                      b.total_value -
                      a.total_value
                  );


              /* Calculate totals ONLY from the displayed 6 months */

const visibleTotalSales =
  months.reduce(
    (total, month) =>
      total +
      Number(
        monthData[month]?.sales || 0
      ),
    0
  );

const visibleSkuSet =
  new Set();

months.forEach((month) => {

  const originalMonth =
    category.months[month];

  if (originalMonth) {

    originalMonth.skus.forEach(
      (sku) =>
        visibleSkuSet.add(sku)
    );

  }

});


return {

  category:
    category.category,

  months:
    monthData,

  totalSales:
    visibleTotalSales,

  totalSkuCount:
    visibleSkuSet.size,

  items:
    categoryItems,
};
            }
          )
        .filter(
  (category) =>
    category.totalSales !== 0 ||
    category.totalSkuCount > 0
)
.sort(
  (a, b) =>
    b.totalSales -
    a.totalSales
);


      return {

        latestDate,

        months,

        yearGroups,

        monthlySummary,

        categories,

        items,

        itemLookup,

        orderCount:
          orderSet.size,

        itemCount:
          itemMap.size,

        transactionCount:
          transactions.length,
      };

    }, [transactions]);
    /* ========================================================
     ORDER ITEMS
     ======================================================== */

  const orderItems =
    useMemo(() => {

      if (!analytics) {
        return [];
      }

      return Object.entries(
        orderQuantities
      )
        .filter(
          ([, quantity]) =>
            Number(quantity) > 0
        )
        .map(
          ([itemCode, quantity]) => {

            const item =
              analytics.items.find(
                (row) =>
                  row.item_code ===
                  itemCode
              );

            if (!item) {
              return null;
            }

            return {
              ...item,

              order_quantity:
                Number(quantity),
            };
          }
        )
        .filter(Boolean);

    }, [
      analytics,
      orderQuantities,
    ]);


  /* ========================================================
     ORDER SUMMARY
     ======================================================== */

  const orderSummary =
    useMemo(() => {

      let totalQuantity = 0;

      for (
        const item
        of orderItems
      ) {

        totalQuantity +=
          Number(
            item.order_quantity ||
              0
          );
      }

      return {

        itemCount:
          orderItems.length,

        totalQuantity,
      };

    }, [orderItems]);


  /* ========================================================
     SAVE DRAFT
     ======================================================== */

  async function saveDraft() {

    if (
      !selectedCustomer
    ) {
      return;
    }

    if (
      orderItems.length === 0
    ) {

      setError(
        "Add at least one item before saving the draft."
      );

      return;
    }

    setSavingOrder(true);

    setError("");
    setMessage("");

    try {

      const {
        data: { session },
      } =
        await supabase.auth.getSession();

      if (!session) {
        throw new Error(
          "Please login again."
        );
      }


      /* ----------------------------------------------------
         CREATE OR UPDATE DRAFT HEADER
         ---------------------------------------------------- */

      let orderId =
        draftOrderId;

      if (!orderId) {

        const {
          data: newOrder,
          error: orderError,
        } =
          await supabase
            .from("sales_orders")
            .insert({
              customer_code:
                selectedCustomer
                  .customer_code,

              customer_name:
                selectedCustomer
                  .customer_name,

              salesman_code:
                selectedCustomer
                  .current_salesman_code,

              status:
                "DRAFT",

              created_by:
                session.user.id,
            })
            .select("id")
            .single();

        if (orderError) {
          throw orderError;
        }

        orderId =
          newOrder.id;

        setDraftOrderId(
          orderId
        );

      } else {

        const {
          error: updateError,
        } =
          await supabase
            .from("sales_orders")
            .update({
              customer_name:
                selectedCustomer
                  .customer_name,

              salesman_code:
                selectedCustomer
                  .current_salesman_code,

              updated_at:
                new Date()
                  .toISOString(),
            })
            .eq(
              "id",
              orderId
            );

        if (updateError) {
          throw updateError;
        }
      }


      /* ----------------------------------------------------
         REPLACE DRAFT LINES
         ---------------------------------------------------- */

      const {
        error: deleteError,
      } =
        await supabase
          .from(
            "sales_order_items"
          )
          .delete()
          .eq(
            "order_id",
            orderId
          );

      if (deleteError) {
        throw deleteError;
      }


      const lines =
        orderItems.map(
          (item) => ({

            order_id:
              orderId,

            item_code:
              item.item_code,

            item_name:
              item.item_name,

            category:
              item.category,

            quantity:
              Number(
                item.order_quantity
              ),

            /*
             * RATE IS INTENTIONALLY NULL.
             * We will connect the Google Sheet
             * rate source later.
             */

            rate:
              null,

            line_value:
              null,
          })
        );


      const {
        error: lineError,
      } =
        await supabase
          .from(
            "sales_order_items"
          )
          .insert(lines);

      if (lineError) {
        throw lineError;
      }


      setMessage(
        "Draft order saved successfully."
      );

      return orderId;

    } catch (err) {

      setError(
        err.message ||
          "Unable to save draft order."
      );

      return null;

    } finally {

      setSavingOrder(false);
    }
  }


  /* ========================================================
     SUBMIT FINAL ORDER
     ======================================================== */

  async function submitOrder() {

    if (
      orderItems.length === 0
    ) {

      setError(
        "Add at least one item before submitting the order."
      );

      return;
    }

    setSubmittingOrder(true);

    setError("");
    setMessage("");

    try {

      /*
       * Save the current quantities first.
       * This makes sure the final order contains
       * exactly what is currently on screen.
       */

      const orderId =
        await saveDraft();

      if (!orderId) {
        throw new Error(
          "Unable to save the order before submission."
        );
      }


      const {
        error: submitError,
      } =
        await supabase
          .from("sales_orders")
          .update({
            status:
              "SUBMITTED",

            submitted_at:
              new Date()
                .toISOString(),

            updated_at:
              new Date()
                .toISOString(),
          })
          .eq(
            "id",
            orderId
          );

      if (submitError) {
        throw submitError;
      }


      setMessage(
        `Order #${orderId} submitted successfully.`
      );

      setShowOrderReview(
        false
      );

      setDraftOrderId(
        null
      );

      setOrderQuantities(
        {}
      );

    } catch (err) {

      setError(
        err.message ||
          "Unable to submit order."
      );

    } finally {

      setSubmittingOrder(false);
    }
  }


  /* ========================================================
     BACK TO CUSTOMER LIST
     ======================================================== */

  function closeCustomer() {

    setSelectedCustomer(
      null
    );

    setTransactions([]);

    setShowTransactions(
      false
    );

    setExpandedCategories(
      {}
    );

    setOrderQuantities(
      {}
    );

    setDraftOrderId(
      null
    );

    setShowOrderReview(
      false
    );

    setMessage("");
    setError("");
  }


  /* ========================================================
     LOADING SCREEN
     ======================================================== */

  if (loading) {

    return (
      <main className="auditPage">

        <div className="auditShell">

          <div className="auditBrand">
            MADIBA SFA
          </div>

          <h1>
            Customer Audit
          </h1>

          <p className="auditSubtitle">
            Loading customer data...
          </p>

        </div>

      </main>
    );
  }


  /* ========================================================
     CUSTOMER LIST SCREEN
     ======================================================== */

  if (!selectedCustomer) {

    return (
      <main className="auditPage">

        <div className="auditShell">

          {/* HEADER */}

          <div className="auditTop">

            <div>

              <div className="auditBrand">
                MADIBA SFA
              </div>

              <h1>
                Customer Audit
              </h1>

              <p className="auditSubtitle">
                Management sales history validation
              </p>

            </div>


            <a
              href="/management"
              className="auditHomeButton"
            >
              ← Home
            </a>

          </div>


          {/* ERROR */}

          {error && (

            <div className="auditError">
              {error}
            </div>

          )}


          {/* FILTERS */}

          <div className="auditFilters">

            <div className="auditFilterField">

              <label>
                Salesman
              </label>

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

            </div>


            <div className="auditFilterField auditSearchField">

              <label>
                Search Customer
              </label>

              <input
                type="search"
                value={search}
                placeholder="Code or customer name..."
                onChange={(e) =>
                  setSearch(
                    e.target.value
                  )
                }
              />

            </div>

          </div>


          {/* CUSTOMER COUNT */}

          <div className="auditCustomerCount">

            <strong>
              {
                filteredCustomers.length
              }
            </strong>{" "}
            customers

          </div>


          {/* CUSTOMER CARDS */}

          <div className="auditCustomerList">

            {filteredCustomers.map(
              (customer) => (

                <button
                  type="button"
                  className="auditCustomerCard"
                  key={
                    customer.customer_code
                  }
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


                  <div className="auditCustomerMain">

                    <strong>
                      {
                        customer.customer_name
                      }
                    </strong>

                    <span>
                      {
                        customer.current_salesman_code ||
                        "No salesman"
                      }
                    </span>

                    <small>

                      Last transaction:{" "}

                      {shortDate(
                        customer.latest_transaction_date
                      )}

                    </small>

                  </div>


                  <div className="auditCustomerArrow">
                    ›
                  </div>

                </button>

              )
            )}

          </div>


          {filteredCustomers.length ===
            0 && (

            <div className="auditEmpty">

              No customers match the current filters.

            </div>

          )}

        </div>

      </main>
    );
  }


  /* ========================================================
     CUSTOMER DETAIL LOADING
     ======================================================== */

  if (loadingCustomer) {

    return (
      <main className="auditPage">

        <div className="auditShell">

          <div className="auditTop">

            <div>

              <div className="auditBrand">
                MADIBA SFA
              </div>

              <h1>
                Customer Audit
              </h1>

              <p className="auditSubtitle">
                Loading customer history...
              </p>

            </div>


            <a
              href="/management"
              className="auditHomeButton"
            >
              ← Home
            </a>

          </div>


          <button
            type="button"
            className="auditBackButton"
            onClick={
              closeCustomer
            }
          >
            ← Customers
          </button>

        </div>

      </main>
    );
  }


  /* ========================================================
     NO TRANSACTIONS
     ======================================================== */

  if (!analytics) {

    return (
      <main className="auditPage">

        <div className="auditShell">

          <div className="auditTop">

            <div>

              <div className="auditBrand">
                MADIBA SFA
              </div>

              <h1>
                Customer Audit
              </h1>

              <p className="auditSubtitle">
                Management sales history validation
              </p>

            </div>


            <a
              href="/management"
              className="auditHomeButton"
            >
              ← Home
            </a>

          </div>


          <button
            type="button"
            className="auditBackButton"
            onClick={
              closeCustomer
            }
          >
            ← Customers
          </button>


          {error && (

            <div className="auditError">
              {error}
            </div>

          )}


          <div className="auditEmpty">

            No sales history was found for{" "}

            <strong>
              {
                selectedCustomer.customer_name
              }
            </strong>.

          </div>

        </div>

      </main>
    );
  }


  /* ========================================================
     CUSTOMER DETAIL
     ======================================================== */

  return (
    <main className="auditPage">

      <div className="auditShell">

        {/* ==================================================
            HEADER
            ================================================== */}

        <div className="auditTop">

          <div>

            <div className="auditBrand">
              MADIBA SFA
            </div>

            <h1>
              Customer Audit
            </h1>

            <p className="auditSubtitle">
              Management sales history validation
            </p>

          </div>


          <a
            href="/management"
            className="auditHomeButton"
          >
            ← Home
          </a>

        </div>


        <button
          type="button"
          className="auditBackButton"
          onClick={
            closeCustomer
          }
        >
          ← Customers
        </button>


        {/* ==================================================
            MESSAGE / ERROR
            ================================================== */}

        {message && (

          <div className="auditSuccess">
            {message}
          </div>

        )}


        {error && (

          <div className="auditError">
            {error}
          </div>

        )}


        {/* ==================================================
            CUSTOMER HERO
            ================================================== */}

        <section className="auditCustomerHero">

          <div className="auditHeroCode">

            {
              selectedCustomer.customer_code
            }

          </div>


          <h2>

            {
              selectedCustomer.customer_code
            }{" "}

            {
              selectedCustomer.customer_name
            }

          </h2>


          <div className="auditHeroSalesman">

            {
              selectedCustomer.current_salesman_code ||
              "NO SALESMAN"
            }

          </div>

        </section>


        {/* ==================================================
            CUSTOMER SUMMARY
            ================================================== */}

        <section className="auditSummaryGrid">

          <div className="auditSummaryCard">

            <span>
              Orders
            </span>

            <strong>
              {
                analytics.orderCount
              }
            </strong>

          </div>


          <div className="auditSummaryCard">

            <span>
              Last Purchase
            </span>

            <strong>
              {shortDate(
                analytics.latestDate
              )}
            </strong>

          </div>

        </section>


        {/* ==================================================
            MONTHLY PERFORMANCE
            ================================================== */}

        <section className="auditSection">

          <h3>
            Monthly Performance
          </h3>


          <div className="auditTableScroll">

            <table className="auditMatrix auditPerformanceMatrix">

              <thead>

                {/* YEAR */}

                <tr className="auditYearRow">

                  <th rowSpan="2">
                    Metric
                  </th>

                  {analytics.yearGroups.map(
                    (group) => (

                      <th
                        key={
                          group.year
                        }
                        colSpan={
                          group.months.length
                        }
                        className="auditYearHeader"
                      >
                        {
                          group.year
                        }
                      </th>

                    )
                  )}

                  <th
                    rowSpan="2"
                    className="auditTotalHeader"
                  >
                    Total
                  </th>

                </tr>


                {/* MONTH */}

                <tr className="auditMonthRow">

                  {analytics.months.map(
                    (month) => (

                      <th key={month}>
                        {monthName(
                          month
                        )}
                      </th>

                    )
                  )}

                </tr>

              </thead>


              <tbody>

                {/* SALES */}

                <tr>

                  <th>
                    Sales
                  </th>

                  {analytics.monthlySummary.map(
                    (month, index) => {

                      const previous =
                        index > 0
                          ? analytics
                              .monthlySummary[
                                index - 1
                              ].sales
                          : 0;

                      return (

                        <td
                          key={
                            month.month
                          }
                          className={trendClass(
                            month.sales,
                            previous,
                            index > 0
                          )}
                        >
                          {numberFormat(
                            month.sales
                          )}
                        </td>

                      );
                    }
                  )}

                  <td className="auditMatrixTotal">

                    {numberFormat(
                      analytics
                        .monthlySummary
                        .reduce(
                          (
                            total,
                            month
                          ) =>
                            total +
                            month.sales,
                          0
                        )
                    )}

                  </td>

                </tr>


                {/* SKU SOLD */}

                <tr>

                  <th>
                    SKUs Sold
                  </th>

                  {analytics.monthlySummary.map(
                    (month, index) => {

                      const previous =
                        index > 0
                          ? analytics
                              .monthlySummary[
                                index - 1
                              ].skuCount
                          : 0;

                      return (

                        <td
                          key={
                            month.month
                          }
                          className={trendClass(
                            month.skuCount,
                            previous,
                            index > 0
                          )}
                        >
                          {
                            month.skuCount
                          }
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

        </section>


        {/* ==================================================
            CATEGORY PERFORMANCE + ITEM ORDERING
            ================================================== */}

        <section className="auditSection">

          <div className="auditCategoryTitle">

            <span>
              Category Performance by Month
            </span>

            <small>
              Tap a category to view items and place an order.
            </small>

          </div>
          <div className="auditTableScroll">

            <table className="auditMatrix auditCategoryMatrixV3">

              <thead>

                {/* YEAR HEADER */}

                <tr className="auditYearRow">

                  <th
                    rowSpan="2"
                    className="auditCategoryHeader"
                  >
                    Category
                  </th>

                  <th
                    rowSpan="2"
                    className="auditCategoryMetricHeader"
                  >
                    Metric
                  </th>

                  {analytics.yearGroups.map(
                    (group) => (

                      <th
                        key={group.year}
                        colSpan={group.months.length}
                        className="auditYearHeader"
                      >
                        {group.year}
                      </th>

                    )
                  )}

                  <th
                    rowSpan="2"
                    className="auditTotalHeader"
                  >
                    Total
                  </th>

                </tr>


                {/* MONTH HEADER */}

                <tr className="auditMonthRow">

                  {analytics.months.map(
                    (month) => (

                      <th key={month}>
                        {monthName(month)}
                      </th>

                    )
                  )}

                </tr>

              </thead>


              <tbody>

                {analytics.categories.map(
                  (category) => {

                    const isExpanded =
                      Boolean(
                        expandedCategories[
                          category.category
                        ]
                      );

                    return (

                      <Fragment
                        key={category.category}
                      >

                        {/* ================================
                            CATEGORY SALES ROW
                            ================================ */}

                        <tr className="auditCategorySalesRow">

                          <th
                            rowSpan="2"
                            className="auditMergedCategory auditClickableCategory"
                            onClick={() =>
                              toggleCategory(
                                category.category
                              )
                            }
                          >

                            <button
                              type="button"
                              className="auditCategoryToggle"
                              onClick={(e) => {
                                e.stopPropagation();

                                toggleCategory(
                                  category.category
                                );
                              }}
                            >

                              <span className="auditCategoryArrow">
                                {isExpanded
                                  ? "▼"
                                  : "▶"}
                              </span>

                              <span>
                                {category.category}
                              </span>

                            </button>

                          </th>


                          <th className="auditCategoryMetric">
                            Sales
                          </th>


                          {analytics.months.map(
                            (
                              month,
                              index
                            ) => {

                              const current =
                                category.months[
                                  month
                                ]?.sales || 0;

                              const previous =
                                index > 0
                                  ? category.months[
                                      analytics.months[
                                        index - 1
                                      ]
                                    ]?.sales || 0
                                  : 0;

                              return (

                                <td
                                  key={month}
                                  className={trendClass(
                                    current,
                                    previous,
                                    index > 0
                                  )}
                                >

                                  {current
                                    ? numberFormat(
                                        current
                                      )
                                    : "—"}

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


                        {/* ================================
                            CATEGORY SKU ROW
                            ================================ */}

                        <tr className="auditCategorySkuRow">

                          <th className="auditCategoryMetric">
                            SKUs Sold
                          </th>


                          {analytics.months.map(
                            (
                              month,
                              index
                            ) => {

                              const current =
                                category.months[
                                  month
                                ]?.skuCount || 0;

                              const previous =
                                index > 0
                                  ? category.months[
                                      analytics.months[
                                        index - 1
                                      ]
                                    ]?.skuCount || 0
                                  : 0;

                              return (

                                <td
                                  key={month}
                                  className={trendClass(
                                    current,
                                    previous,
                                    index > 0
                                  )}
                                >

                                  {current || "—"}

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


                        {/* ================================
                            EXPANDED CATEGORY ITEMS
                            ================================ */}

                        {isExpanded && (

                          <tr className="auditExpandedItemsRow">

                            <td
                              colSpan={
                                analytics.months.length +
                                3
                              }
                              className="auditExpandedItemsCell"
                            >

                              <div className="auditExpandedCategory">

                                <div className="auditExpandedCategoryHeader">

                                  <div>

                                    <strong>
                                      {category.category}
                                    </strong>

                                    <span>
                                      {
                                        category.items.length
                                      }{" "}
                                      items
                                    </span>

                                  </div>


                                  <button
                                    type="button"
                                    className="auditCollapseButton"
                                    onClick={() =>
                                      toggleCategory(
                                        category.category
                                      )
                                    }
                                  >
                                    Close
                                  </button>

                                </div>


                                {category.items.length ===
                                0 ? (

                                  <div className="auditEmpty">

                                    No items found in this category.

                                  </div>

                                ) : (

                                  <div className="auditItemTableScroll">

                                    <table className="auditItemMatrix">

                                      <thead>

                                        {/* ITEM YEAR HEADER */}

                                        <tr className="auditItemYearRow">

                                          <th
                                            rowSpan="2"
                                            className="auditItemNameHeader"
                                          >
                                            Item
                                          </th>

                                          <th
                                            rowSpan="2"
                                            className="auditItemMetricHeader"
                                          >
                                            Metric
                                          </th>


                                          {analytics.yearGroups.map(
                                            (group) => (

                                              <th
                                                key={
                                                  group.year
                                                }
                                                colSpan={
                                                  group.months.length
                                                }
                                              >
                                                {
                                                  group.year
                                                }
                                              </th>

                                            )
                                          )}


                                          <th
                                            rowSpan="2"
                                            className="auditItemTotalHeader"
                                          >
                                            Total
                                          </th>

                                          <th
                                            rowSpan="2"
                                            className="auditRateHeader"
                                          >
                                            Rate
                                          </th>

                                          <th
                                            rowSpan="2"
                                            className="auditOrderQtyHeader"
                                          >
                                            Order Qty
                                          </th>

                                        </tr>


                                        {/* ITEM MONTH HEADER */}

                                        <tr className="auditItemMonthRow">

                                          {analytics.months.map(
                                            (month) => (

                                              <th
                                                key={
                                                  month
                                                }
                                              >
                                                {monthName(
                                                  month
                                                )}
                                              </th>

                                            )
                                          )}

                                        </tr>

                                      </thead>


                                      <tbody>

                                        {category.items.map(
                                          (item) => {

                                            const orderQty =
                                              Number(
                                                orderQuantities[
                                                  item.item_code
                                                ] || 0
                                              );

                                            return (

                                              <Fragment
                                                key={
                                                  item.item_key
                                                }
                                              >

                                                {/* ======================
                                                    ITEM VALUE ROW
                                                    ====================== */}

                                                <tr className="auditItemValueRow">

                                                  <th
                                                    rowSpan="2"
                                                    className="auditItemNameCell"
                                                  >

                                                    <div className="auditItemCode">

                                                      {
                                                        item.item_code
                                                      }

                                                    </div>


                                                    <div className="auditItemName">

                                                      {
                                                        item.item_name
                                                      }

                                                    </div>


                                                    {item.abc_class && (

                                                      <div className="auditItemABC">

                                                        {
                                                          item.abc_class
                                                        }

                                                      </div>

                                                    )}

                                                  </th>


                                                  <th className="auditItemMetricCell">
                                                    Value
                                                  </th>


                                                  {analytics.months.map(
                                                    (
                                                      month,
                                                      index
                                                    ) => {

                                                      const current =
                                                        item.months[
                                                          month
                                                        ]?.value ||
                                                        0;

                                                      const previous =
                                                        index > 0
                                                          ? item.months[
                                                              analytics.months[
                                                                index -
                                                                  1
                                                              ]
                                                            ]?.value ||
                                                            0
                                                          : 0;

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
                                                            : "—"}

                                                        </td>

                                                      );
                                                    }
                                                  )}


                                                  <td className="auditItemTotal">

                                                    {numberFormat(
                                                      item.total_value
                                                    )}

                                                  </td>


                                                  {/* RATE BLANK FOR NOW */}

                                                  <td
                                                    rowSpan="2"
                                                    className="auditRateCell"
                                                  >

                                                    <span className="auditRateBlank">
                                                      —
                                                    </span>

                                                  </td>


                                                  {/* ORDER QUANTITY */}

                                                  <td
                                                    rowSpan="2"
                                                    className="auditOrderQtyCell"
                                                  >

                                                    <div className="auditQtyControl">

                                                      <button
                                                        type="button"
                                                        className="auditQtyButton"
                                                        aria-label={`Decrease ${item.item_name}`}
                                                        onClick={() =>
                                                          decreaseOrderQty(
                                                            item.item_code
                                                          )
                                                        }
                                                      >
                                                        −
                                                      </button>


                                                      <input
                                                        type="number"
                                                        min="0"
                                                        step="1"
                                                        inputMode="numeric"
                                                        value={
                                                          orderQty ||
                                                          ""
                                                        }
                                                        placeholder="0"
                                                        aria-label={`Order quantity for ${item.item_name}`}
                                                        onChange={(
                                                          e
                                                        ) =>
                                                          changeOrderQty(
                                                            item.item_code,
                                                            e
                                                              .target
                                                              .value
                                                          )
                                                        }
                                                      />


                                                      <button
                                                        type="button"
                                                        className="auditQtyButton"
                                                        aria-label={`Increase ${item.item_name}`}
                                                        onClick={() =>
                                                          increaseOrderQty(
                                                            item.item_code
                                                          )
                                                        }
                                                      >
                                                        +
                                                      </button>

                                                    </div>

                                                  </td>

                                                </tr>


                                                {/* ======================
                                                    ITEM QUANTITY ROW
                                                    ====================== */}

                                                <tr className="auditItemQtyRow">

                                                  <th className="auditItemMetricCell">
                                                    Qty
                                                  </th>


                                                  {analytics.months.map(
                                                    (
                                                      month,
                                                      index
                                                    ) => {

                                                      const current =
                                                        item.months[
                                                          month
                                                        ]?.quantity ||
                                                        0;

                                                      const previous =
                                                        index > 0
                                                          ? item.months[
                                                              analytics.months[
                                                                index -
                                                                  1
                                                              ]
                                                            ]?.quantity ||
                                                            0
                                                          : 0;

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
                                                            ? qtyFormat(
                                                                current
                                                              )
                                                            : "—"}

                                                        </td>

                                                      );
                                                    }
                                                  )}


                                                  <td className="auditItemTotal">

                                                    {qtyFormat(
                                                      item.total_quantity
                                                    )}

                                                  </td>

                                                </tr>

                                              </Fragment>

                                            );
                                          }
                                        )}

                                      </tbody>

                                    </table>

                                  </div>

                                )}

                              </div>

                            </td>

                          </tr>

                        )}

                      </Fragment>

                    );
                  }
                )}

              </tbody>

            </table>

          </div>

        </section>


        {/* ==================================================
            ORDER ACTION BAR
            Appears once at least one item has an order qty.
            ================================================== */}

        {orderItems.length > 0 && (

          <section className="auditOrderBar">

            <div className="auditOrderBarSummary">

              <span>
                Current Order
              </span>

              <strong>

                {orderSummary.itemCount}{" "}

                {orderSummary.itemCount === 1
                  ? "item"
                  : "items"}

                {" • "}

                {qtyFormat(
                  orderSummary.totalQuantity
                )}{" "}

                units

              </strong>

            </div>


            <div className="auditOrderBarActions">

              <button
                type="button"
                className="auditDraftButton"
                disabled={
                  savingOrder ||
                  submittingOrder
                }
                onClick={
                  saveDraft
                }
              >

                {savingOrder
                  ? "Saving..."
                  : draftOrderId
                    ? "Update Draft"
                    : "Save Draft"}

              </button>


              <button
                type="button"
                className="auditViewOrderButton"
                onClick={() =>
                  setShowOrderReview(
                    true
                  )
                }
              >
                View Order
              </button>

            </div>

          </section>

        )}


        {/* ==================================================
            ORDER REVIEW
            ================================================== */}

        {showOrderReview &&
          orderItems.length > 0 && (

          <div className="auditOrderOverlay">

            <div className="auditOrderReview">

              <div className="auditOrderReviewHeader">

                <div>

                  <span className="auditOrderReviewEyebrow">
                    MADIBA SFA
                  </span>

                  <h3>
                    Review Order
                  </h3>

                  <p>

                    {
                      selectedCustomer.customer_code
                    }{" "}

                    {
                      selectedCustomer.customer_name
                    }

                  </p>

                </div>


                <button
                  type="button"
                  className="auditOrderClose"
                  aria-label="Close order review"
                  onClick={() =>
                    setShowOrderReview(
                      false
                    )
                  }
                >
                  ×
                </button>

              </div>


              <div className="auditOrderReviewSummary">

                <div>

                  <span>
                    Items
                  </span>

                  <strong>
                    {
                      orderSummary.itemCount
                    }
                  </strong>

                </div>


                <div>

                  <span>
                    Total Qty
                  </span>

                  <strong>

                    {qtyFormat(
                      orderSummary.totalQuantity
                    )}

                  </strong>

                </div>


                <div>

                  <span>
                    Status
                  </span>

                  <strong>
                    {draftOrderId
                      ? "Draft"
                      : "New"}
                  </strong>

                </div>

              </div>


              <div className="auditOrderReviewLines">

                {orderItems.map(
                  (item) => (

                    <div
                      key={
                        item.item_code
                      }
                      className="auditOrderReviewLine"
                    >

                      <div className="auditOrderReviewItem">

                        <span>
                          {
                            item.item_code
                          }
                        </span>

                        <strong>
                          {
                            item.item_name
                          }
                        </strong>

                        <small>
                          {
                            item.category
                          }
                        </small>

                      </div>


                      <div className="auditOrderReviewRate">

                        <span>
                          Rate
                        </span>

                        <strong>
                          —
                        </strong>

                      </div>


                      <div className="auditOrderReviewQty">

                        <span>
                          Qty
                        </span>


                        <div className="auditQtyControl auditQtyControlReview">

                          <button
                            type="button"
                            className="auditQtyButton"
                            onClick={() =>
                              decreaseOrderQty(
                                item.item_code
                              )
                            }
                          >
                            −
                          </button>


                          <input
                            type="number"
                            min="0"
                            step="1"
                            inputMode="numeric"
                            value={
                              item.order_quantity
                            }
                            onChange={(e) =>
                              changeOrderQty(
                                item.item_code,
                                e.target.value
                              )
                            }
                          />


                          <button
                            type="button"
                            className="auditQtyButton"
                            onClick={() =>
                              increaseOrderQty(
                                item.item_code
                              )
                            }
                          >
                            +
                          </button>

                        </div>

                      </div>

                    </div>

                  )
                )}

              </div>
              {/* ==========================================
                  ORDER REVIEW ACTIONS
                  ========================================== */}

              <div className="auditOrderReviewActions">

                <button
                  type="button"
                  className="auditSaveDraftButton"
                  disabled={
                    savingOrder ||
                    submittingOrder
                  }
                  onClick={saveDraft}
                >
                  {savingOrder
                    ? "Saving..."
                    : draftOrderId
                      ? "Update Draft"
                      : "Save Draft"}
                </button>


                <button
                  type="button"
                  className="auditSubmitOrderButton"
                  disabled={
                    savingOrder ||
                    submittingOrder
                  }
                  onClick={submitOrder}
                >
                  {submittingOrder
                    ? "Submitting..."
                    : "Submit Final Order"}
                </button>

              </div>

            </div>

          </div>

        )}


        {/* ==================================================
            DRAFT NOTICE
            ================================================== */}

        {draftOrderId && (

          <div className="auditDraftNotice">

            <span>
              Draft Order
            </span>

            <strong>
              #{draftOrderId}
            </strong>

            <small>
              Changes are not final until the order is submitted.
            </small>

          </div>

        )}


        {/* ==================================================
            TRANSACTION HISTORY TOGGLE
            ================================================== */}

        <section className="auditSection">

          <div className="auditTransactionHeader">

            <div>

              <h3>
                Transaction History
              </h3>

              <p className="auditSectionNote">
                Full source transaction history for this customer.
              </p>

            </div>


            <button
              type="button"
              className="auditTransactionToggle"
              onClick={() =>
                setShowTransactions(
                  (current) =>
                    !current
                )
              }
            >
              {showTransactions
                ? "Hide Transactions"
                : `Show Transactions (${analytics.transactionCount})`}
            </button>

          </div>


          {/* ================================================
              TRANSACTION TABLE
              ================================================ */}

          {showTransactions && (

            <div className="auditTableScroll">

              <table className="auditTransactionTable">

                <thead>

                  <tr>

                    <th>
                      Date
                    </th>

                    <th>
                      Voucher
                    </th>

                    <th>
                      Item Code
                    </th>

                    <th>
                      Item
                    </th>

                    <th>
                      Category
                    </th>

                    <th>
                      Qty
                    </th>

                    <th>
                      Sales
                    </th>

                  </tr>

                </thead>


                <tbody>

                  {transactions.map(
                    (row) => (

                      <tr key={row.id}>

                        <td>
                          {shortDate(
                            row.transaction_date
                          )}
                        </td>


                        <td>
                          {row.voucher_number ||
                            row.reference ||
                            "—"}
                        </td>


                        <td>
                          {row.item_code ||
                            "—"}
                        </td>


                        <td>
                          {row.item_name ||
                            "—"}
                        </td>


                        <td>
                          {row.category ||
                            "Unclassified"}
                        </td>


                        <td className="auditNumberCell">

                          {qtyFormat(
                            row.quantity
                          )}

                        </td>


                        <td className="auditNumberCell">

                          {numberFormat(
                            row.sales_amount
                          )}

                        </td>

                      </tr>

                    )
                  )}

                </tbody>

              </table>

            </div>

          )}

        </section>


        {/* ==================================================
            PAGE FOOTER INFO
            ================================================== */}

        <div className="auditPageFooter">

          <span>

            Latest sales data:{" "}

            <strong>
              {shortDate(
                analytics.latestDate
              )}
            </strong>

          </span>


          <span>

            Customer:{" "}

            <strong>
              {
                selectedCustomer.customer_code
              }
            </strong>

          </span>

        </div>

      </div>

    </main>
  );
}
