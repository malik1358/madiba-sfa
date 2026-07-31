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

         IMPORTANT:
         We read historical rate because it exists in
         sales_raw, but it is NOT used as the order rate.
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

         Only the logged-in user's own draft is loaded.
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

         Every item stores:
         - category
         - item code/name
         - total historical value
         - total historical quantity
         - VALUE month-by-month
         - QUANTITY month-by-month
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
         REMOVE COMPLETELY EMPTY MONTHS

         A month remains if the CUSTOMER had any activity.
         ==================================================== */

      const months =
        allMonths.filter(
          (month) =>
            monthlyMap.get(
              month
            ).hasActivity
        );


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


              return {

                category:
                  category.category,

                months:
                  monthData,

                totalSales:
                  category.totalSales,

                totalSkuCount:
                  category
                    .totalSkus
                    .size,

                items:
                  categoryItems,

              };
            }
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
     ITEMS CURRENTLY IN ORDER
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
          ([
            itemCode,
            quantity,
          ]) => {

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
                Number(
                  quantity
                ),

              /*
                RATE IS INTENTIONALLY BLANK
                UNTIL GOOGLE SHEET PRICE
                SOURCE IS CONNECTED.
              */

              rate: 0,

              line_value: 0,
            };
          }
        )
        .filter(Boolean);

    }, [
      analytics,
      orderQuantities,
    ]);


  /* ========================================================
     ORDER TOTALS

     Value intentionally remains 0 until rate is connected.
     ======================================================== */

  const orderSummary =
    useMemo(() => {

      return {

        itemCount:
          orderItems.length,

        totalQuantity:
          orderItems.reduce(
            (
              total,
              item
            ) =>
              total +
              Number(
                item.order_quantity ||
                  0
              ),
            0
          ),

        totalValue: 0,

      };

    }, [orderItems]);


  /* ========================================================
     SAVE DRAFT
     ======================================================== */

  async function saveDraft(
    showSuccess = true
  ) {

    if (!selectedCustomer) {
      return null;
    }

    if (
      orderItems.length === 0
    ) {

      setError(
        "Please add at least one item to the order."
      );

      return null;
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


      let orderId =
        draftOrderId;


      /* ----------------------------------------------------
         CREATE ORDER HEADER
         ---------------------------------------------------- */

      if (!orderId) {

        const {
          data: newOrder,
          error: createError,
        } =
          await supabase
            .from(
              "sales_orders"
            )
            .insert({

              customer_code:
                selectedCustomer
                  .customer_code,

              customer_name:
                selectedCustomer
                  .customer_name,

              salesman_code:
                selectedCustomer
                  .current_salesman_code ||
                null,

              salesman_name:
                null,

              status:
                "DRAFT",

              total_items:
                orderSummary
                  .itemCount,

              total_quantity:
                orderSummary
                  .totalQuantity,

              total_value:
                0,

              created_by:
                session.user.id,

              updated_at:
                new Date()
                  .toISOString(),

            })
            .select("id")
            .single();

        if (createError) {
          throw createError;
        }

        orderId =
          newOrder.id;

        setDraftOrderId(
          orderId
        );

      } else {

        /* --------------------------------------------------
           UPDATE HEADER
           -------------------------------------------------- */

        const {
          error: updateError,
        } =
          await supabase
            .from(
              "sales_orders"
            )
            .update({

              total_items:
                orderSummary
                  .itemCount,

              total_quantity:
                orderSummary
                  .totalQuantity,

              total_value:
                0,

              updated_at:
                new Date()
                  .toISOString(),

            })
            .eq(
              "id",
              orderId
            )
            .eq(
              "status",
              "DRAFT"
            );

        if (updateError) {
          throw updateError;
        }
      }


      /* ----------------------------------------------------
         REWRITE ALL DRAFT LINES

         Dataset is small, so this is intentionally simple:
         delete old draft lines and insert the current basket.
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
              item.order_quantity,

            /*
              TEMPORARY:
              RATE + VALUE REMAIN ZERO.
            */

            rate: 0,

            line_value: 0,

            updated_at:
              new Date()
                .toISOString(),

          })
        );


      const {
        error: insertError,
      } =
        await supabase
          .from(
            "sales_order_items"
          )
          .insert(
            lines
          );

      if (insertError) {
        throw insertError;
      }


      if (showSuccess) {

        setMessage(
          "Draft order saved."
        );

      }

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
        "Please add at least one item before submitting."
      );

      return;
    }


    const confirmed =
      window.confirm(
        "Submit this order? Once submitted it will no longer be editable from this screen."
      );

    if (!confirmed) {
      return;
    }


    setSubmittingOrder(true);

    setError("");

    setMessage("");


    try {

      const orderId =
        await saveDraft(
          false
        );

      if (!orderId) {
        return;
      }


      /* ----------------------------------------------------
         GENERATE READABLE ORDER NUMBER
         ---------------------------------------------------- */

      const now =
        new Date();

      const datePart =
        `${now.getFullYear()}${String(
          now.getMonth() + 1
        ).padStart(
          2,
          "0"
        )}${String(
          now.getDate()
        ).padStart(
          2,
          "0"
        )}`;

      const orderNumber =
        `SO-${datePart}-${String(
          orderId
        ).padStart(
          6,
          "0"
        )}`;


      const {
        error: submitError,
      } =
        await supabase
          .from(
            "sales_orders"
          )
          .update({

            order_number:
              orderNumber,

            status:
              "SUBMITTED",

            total_items:
              orderSummary
                .itemCount,

            total_quantity:
              orderSummary
                .totalQuantity,

            total_value:
              0,

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
          )
          .eq(
            "status",
            "DRAFT"
          );


      if (submitError) {
        throw submitError;
      }


      setMessage(
        `Order ${orderNumber} submitted successfully.`
      );

      setDraftOrderId(
        null
      );

      setOrderQuantities(
        {}
      );

      setShowOrderReview(
        false
      );

    } catch (err) {

      setError(
        err.message ||
          "Unable to submit order."
      );

    } finally {

      setSubmittingOrder(
        false
      );

    }
  }
    /* ========================================================
     LOADING SCREEN
     ======================================================== */

  if (loading) {
    return (
      <main className="auditPage">
        <div className="auditLoading">
          Loading customer database...
        </div>
      </main>
    );
  }


  /* ========================================================
     PAGE
     ======================================================== */

  return (
    <main className="auditPage">

      <div className="auditShell">

        {/* ==================================================
            HEADER
            ================================================== */}

        <header className="auditTop">

          <div>

            <div className="auditBrand">
              MADIBA SFA
            </div>

            <h1>
              Customer Audit
            </h1>

            <p>
              Sales history &amp; order entry
            </p>

          </div>

          <a
            href="/"
            className="auditHome"
          >
            ← Home
          </a>

        </header>


        {/* ==================================================
            MESSAGES
            ================================================== */}

        {error && (
          <div className="auditError">
            {error}
          </div>
        )}

        {message && (
          <div className="auditSuccess">
            {message}
          </div>
        )}


        {/* ==================================================
            CUSTOMER SELECTION
            ================================================== */}

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


        {/* ==================================================
            CUSTOMER DETAIL
            ================================================== */}

        {selectedCustomer && (

          <section className="auditDetail">


            {/* ===============================================
                BACK BUTTON
                =============================================== */}

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

              }}
            >
              ← Customers
            </button>


            {/* ===============================================
                CUSTOMER HEADER
                =============================================== */}

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


            {/* ===============================================
                LOADING CUSTOMER
                =============================================== */}

            {loadingCustomer && (

              <div className="auditLoadingBox">
                Loading purchase history and draft order...
              </div>

            )}


            {/* ===============================================
                CUSTOMER ANALYTICS
                =============================================== */}

            {!loadingCustomer &&
              analytics && (
                <>


                  {/* =========================================
                      SUMMARY
                      ========================================= */}

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


                  {/* =========================================
                      MONTHLY PERFORMANCE
                      ========================================= */}

                  <div className="auditSectionTitle">
                    Monthly Performance
                  </div>


                  <div className="auditTableScroll">

                    <table className="auditMatrix auditPerformanceMatrix">

                      <thead>

                        {/* YEAR */}

                        <tr className="auditYearRow">

                          <th
                            rowSpan={2}
                            className="auditMetricHeader"
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
                                className="auditYearHeader"
                              >
                                {
                                  group.year
                                }
                              </th>

                            )
                          )}


                          <th
                            rowSpan={2}
                            className="auditTotalHeader"
                          >
                            Total
                          </th>

                        </tr>


                        {/* MONTH */}

                        <tr className="auditMonthRow">

                          {analytics.months.map(
                            (month) => (

                              <th
                                key={month}
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
                                index > 0
                                  ? analytics
                                      .monthlySummary[
                                      index - 1
                                    ].sales
                                  : null;

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
                                  {month.sales !== 0
                                    ? numberFormat(
                                        month.sales
                                      )
                                    : "—"}
                                </td>

                              );
                            }
                          )}


                          <td className="auditMatrixTotal">

                            {numberFormat(
                              analytics.monthlySummary.reduce(
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


                        {/* SKUs */}

                        <tr>

                          <th>
                            SKUs Sold
                          </th>


                          {analytics.monthlySummary.map(
                            (
                              month,
                              index
                            ) => {

                              const previous =
                                index > 0
                                  ? analytics
                                      .monthlySummary[
                                      index - 1
                                    ].skuCount
                                  : null;

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
                                  {month.skuCount !== 0
                                    ? month.skuCount
                                    : "—"}
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


                  {/* =========================================
                      CATEGORY + ITEM DRILL DOWN
                      ========================================= */}

                  <div className="auditSectionTitle auditCategoryTitle">

                    <span>
                      Category Performance &amp; Order Entry
                    </span>

                    <small>
                      Tap a category to view items and add order quantities.
                    </small>

                  </div>


                  <div className="auditTableScroll">

                    <table className="auditMatrix auditCategoryMatrixV3 auditOrderMatrix">

                      <thead>


                        {/* ===================================
                            YEAR
                            =================================== */}

                        <tr className="auditYearRow">

                          <th
                            rowSpan={2}
                            className="auditCategoryHeader"
                          >
                            Category / Item
                          </th>


                          <th
                            rowSpan={2}
                            className="auditCategoryMetricHeader"
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
                                className="auditYearHeader"
                              >
                                {
                                  group.year
                                }
                              </th>

                            )
                          )}


                          <th
                            rowSpan={2}
                            className="auditTotalHeader"
                          >
                            Total
                          </th>


                          <th
                            rowSpan={2}
                            className="auditRateHeader"
                          >
                            Rate
                          </th>


                          <th
                            rowSpan={2}
                            className="auditOrderQtyHeader"
                          >
                            Order Qty
                          </th>

                        </tr>


                        {/* ===================================
                            MONTH
                            =================================== */}

                        <tr className="auditMonthRow">

                          {analytics.months.map(
                            (month) => (

                              <th
                                key={month}
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
                                key={
                                  category.category
                                }
                              >


                                {/* ===========================
                                    CATEGORY SALES
                                    =========================== */}

                                <tr className="auditCategorySalesRow">

                                  <th
                                    rowSpan={2}
                                    className="auditMergedCategory auditClickableCategory"
                                    onClick={() =>
                                      toggleCategory(
                                        category.category
                                      )
                                    }
                                  >

                                    <div className="auditCategoryClickInner">

                                      <span className="auditExpandIcon">
                                        {isExpanded
                                          ? "▼"
                                          : "▶"}
                                      </span>

                                      <span>
                                        {
                                          category.category
                                        }
                                      </span>

                                    </div>

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
                                        category
                                          .months[
                                          month
                                        ].sales;


                                      const previousMonth =
                                        index > 0
                                          ? analytics
                                              .months[
                                              index - 1
                                            ]
                                          : null;


                                      const previous =
                                        previousMonth
                                          ? category
                                              .months[
                                              previousMonth
                                            ].sales
                                          : null;


                                      return (

                                        <td
                                          key={
                                            month
                                          }
                                          className={trendClass(
                                            current,
                                            previous,
                                            index > 0
                                          )}
                                        >
                                          {current !== 0
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


                                  {/* CATEGORY HAS NO ORDER RATE */}

                                  <td
                                    rowSpan={2}
                                    className="auditCategoryNoOrder"
                                  >
                                    —
                                  </td>


                                  {/* CATEGORY HAS NO ORDER QTY */}

                                  <td
                                    rowSpan={2}
                                    className="auditCategoryNoOrder"
                                  >
                                    {isExpanded
                                      ? "Items ↓"
                                      : "Open"}
                                  </td>

                                </tr>


                                {/* ===========================
                                    CATEGORY SKU
                                    =========================== */}

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
                                        category
                                          .months[
                                          month
                                        ].skuCount;


                                      const previousMonth =
                                        index > 0
                                          ? analytics
                                              .months[
                                              index - 1
                                            ]
                                          : null;


                                      const previous =
                                        previousMonth
                                          ? category
                                              .months[
                                              previousMonth
                                            ].skuCount
                                          : null;


                                      return (

                                        <td
                                          key={
                                            month
                                          }
                                          className={trendClass(
                                            current,
                                            previous,
                                            index > 0
                                          )}
                                        >
                                          {current !== 0
                                            ? current
                                            : "—"}
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


                                {/* ===========================
                                    EXPANDED ITEMS
                                    =========================== */}

                                {isExpanded &&
                                  category.items.map(
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
                                            item.item_code
                                          }
                                        >


                                          {/* =================
                                              ITEM VALUE
                                              ================= */}

                                          <tr className="auditItemValueRow">


                                            <th
                                              rowSpan={2}
                                              className="auditDrillItem"
                                            >

                                              <div className="auditDrillItemCode">
                                                {
                                                  item.item_code
                                                }
                                              </div>

                                              <div className="auditDrillItemName">
                                                {
                                                  item.item_name
                                                }
                                              </div>

                                              {item.abc_class && (

                                                <div className="auditDrillItemABC">
                                                  {
                                                    item.abc_class
                                                  }
                                                </div>

                                              )}

                                            </th>


                                            <th className="auditItemMetric">
                                              Value
                                            </th>


                                            {analytics.months.map(
                                              (
                                                month,
                                                index
                                              ) => {

                                                const current =
                                                  item
                                                    .months[
                                                    month
                                                  ].value;


                                                const previousMonth =
                                                  index > 0
                                                    ? analytics
                                                        .months[
                                                        index - 1
                                                      ]
                                                    : null;


                                                const previous =
                                                  previousMonth
                                                    ? item
                                                        .months[
                                                        previousMonth
                                                      ].value
                                                    : null;


                                                return (

                                                  <td
                                                    key={
                                                      month
                                                    }
                                                    className={trendClass(
                                                      current,
                                                      previous,
                                                      index > 0
                                                    )}
                                                  >
                                                    {current !== 0
                                                      ? numberFormat(
                                                          current
                                                        )
                                                      : "—"}
                                                  </td>

                                                );
                                              }
                                            )}


                                            <td className="auditMatrixTotal auditItemTotal">

                                              {numberFormat(
                                                item.total_value
                                              )}

                                            </td>


                                            {/* RATE BLANK FOR NOW */}

                                            <td
                                              rowSpan={2}
                                              className="auditOrderRate"
                                            >
                                              —
                                            </td>


                                            {/* ORDER QUANTITY */}

                                            <td
                                              rowSpan={2}
                                              className="auditOrderQtyCell"
                                            >

                                              <div className="auditQtyControl">


                                                <button
                                                  type="button"
                                                  className="auditQtyButton"
                                                  onClick={() =>
                                                    decreaseOrderQty(
                                                      item.item_code
                                                    )
                                                  }
                                                  disabled={
                                                    orderQty <= 0
                                                  }
                                                  aria-label={`Decrease ${item.item_name}`}
                                                >
                                                  −
                                                </button>


                                                <input
                                                  type="number"
                                                  min="0"
                                                  step="1"
                                                  inputMode="numeric"
                                                  value={
                                                    orderQty === 0
                                                      ? ""
                                                      : orderQty
                                                  }
                                                  placeholder="0"
                                                  onChange={(e) =>
                                                    changeOrderQty(
                                                      item.item_code,
                                                      e.target.value
                                                    )
                                                  }
                                                  aria-label={`Order quantity for ${item.item_name}`}
                                                />


                                                <button
                                                  type="button"
                                                  className="auditQtyButton"
                                                  onClick={() =>
                                                    increaseOrderQty(
                                                      item.item_code
                                                    )
                                                  }
                                                  aria-label={`Increase ${item.item_name}`}
                                                >
                                                  +
                                                </button>


                                              </div>

                                            </td>

                                          </tr>


                                          {/* =================
                                              ITEM QUANTITY
                                              ================= */}

                                          <tr className="auditItemQuantityRow">

                                            <th className="auditItemMetric">
                                              Quantity
                                            </th>


                                            {analytics.months.map(
                                              (
                                                month,
                                                index
                                              ) => {

                                                const current =
                                                  item
                                                    .months[
                                                    month
                                                  ].quantity;


                                                const previousMonth =
                                                  index > 0
                                                    ? analytics
                                                        .months[
                                                        index - 1
                                                      ]
                                                    : null;


                                                const previous =
                                                  previousMonth
                                                    ? item
                                                        .months[
                                                        previousMonth
                                                      ].quantity
                                                    : null;


                                                return (

                                                  <td
                                                    key={
                                                      month
                                                    }
                                                    className={trendClass(
                                                      current,
                                                      previous,
                                                      index > 0
                                                    )}
                                                  >
                                                    {current !== 0
                                                      ? qtyFormat(
                                                          current
                                                        )
                                                      : "—"}
                                                  </td>

                                                );
                                              }
                                            )}


                                            <td className="auditMatrixTotal auditItemTotal">

                                              {qtyFormat(
                                                item.total_quantity
                                              )}

                                            </td>

                                          </tr>

                                        </Fragment>

                                      );
                                    }
                                  )}

                              </Fragment>

                            );
                          }
                        )}

                      </tbody>

                    </table>

                  </div>


                  {/* =========================================
                      DRAFT STATUS
                      ========================================= */}

                  {draftOrderId && (

                    <div className="auditDraftNotice">

                      <span>
                        Draft Order
                      </span>

                      <strong>
                        #{draftOrderId}
                      </strong>

                      <small>
                        Changes on screen are saved when you press Save Draft.
                      </small>

                    </div>

                  )}


                  {/* =========================================
                      TRANSACTION HISTORY
                      ========================================= */}

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
                                {qtyFormat(
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


                  {/* =========================================
                      ORDER REVIEW MODAL
                      ========================================= */}

                  {showOrderReview && (

                    <div
                      className="auditOrderOverlay"
                      onClick={() =>
                        setShowOrderReview(
                          false
                        )
                      }
                    >

                      <div
                        className="auditOrderReview"
                        onClick={(e) =>
                          e.stopPropagation()
                        }
                      >


                        <div className="auditOrderReviewHeader">

                          <div>

                            <span>
                              MADIBA SFA
                            </span>

                            <h3>
                              Review Order
                            </h3>

                            <p>
                              {
                                selectedCustomer.customer_name
                              }
                            </p>

                          </div>


                          <button
                            type="button"
                            className="auditOrderClose"
                            onClick={() =>
                              setShowOrderReview(
                                false
                              )
                            }
                          >
                            ×
                          </button>

                        </div>


                        {orderItems.length === 0 ? (

                          <div className="auditOrderEmpty">

                            No items have been added to this order.

                          </div>

                        ) : (

                          <div className="auditOrderReviewLines">

                            {orderItems.map(
                              (item) => (

                                <div
                                  className="auditOrderReviewLine"
                                  key={
                                    item.item_code
                                  }
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


                                  <div className="auditReviewQty">

                                    <button
                                      type="button"
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

                              )
                            )}

                          </div>

                        )}


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
                              Order Value
                            </span>

                            <strong>
                              —
                            </strong>

                            <small>
                              Rate pending
                            </small>

                          </div>

                        </div>


                        <div className="auditOrderReviewActions">


                          <button
                            type="button"
                            className="auditSaveDraftButton"
                            disabled={
                              savingOrder ||
                              orderItems.length === 0
                            }
                            onClick={() =>
                              saveDraft(
                                true
                              )
                            }
                          >

                            {savingOrder
                              ? "Saving..."
                              : "Save Draft"}

                          </button>


                          <button
                            type="button"
                            className="auditSubmitOrderButton"
                            disabled={
                              submittingOrder ||
                              savingOrder ||
                              orderItems.length === 0
                            }
                            onClick={
                              submitOrder
                            }
                          >

                            {submittingOrder
                              ? "Submitting..."
                              : "Submit Order"}

                          </button>


                        </div>

                      </div>

                    </div>

                  )}


                  {/* =========================================
                      MOBILE / DESKTOP STICKY ORDER BAR
                      ========================================= */}

                  {orderItems.length > 0 && (

                    <div className="auditOrderBar">

                      <div className="auditOrderBarSummary">

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
                            Qty
                          </span>

                          <strong>
                            {qtyFormat(
                              orderSummary.totalQuantity
                            )}
                          </strong>

                        </div>


                        <div>

                          <span>
                            Value
                          </span>

                          <strong>
                            —
                          </strong>

                        </div>

                      </div>


                      <div className="auditOrderBarActions">


                        <button
                          type="button"
                          className="auditSaveDraftButton"
                          disabled={
                            savingOrder
                          }
                          onClick={() =>
                            saveDraft(
                              true
                            )
                          }
                        >

                          {savingOrder
                            ? "Saving..."
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

                    </div>

                  )}

                </>
              )}


            {/* ===============================================
                NO SALES HISTORY
                =============================================== */}

            {!loadingCustomer &&
              !analytics &&
              !error && (

                <div className="auditEmpty">

                  No transactions found for this customer in the active snapshot.

                </div>

              )}

          </section>

        )}

      </div>

    </main>
  );
}
/* ==========================================================
   MADIBA SFA
   CATEGORY DRILL-DOWN + ORDER ENTRY
   PART 3
   MUST BE AT BOTTOM OF GLOBALS.CSS
   ========================================================== */


/* ==========================================================
   SUCCESS MESSAGE
   ========================================================== */

.auditSuccess {
  margin-bottom: 16px;
  padding: 13px 16px;

  background: #edf9f2;
  color: #167044;

  border: 1px solid #b9dfc9;
  border-radius: 10px;

  font-size: 13px;
  font-weight: 700;
}


/* ==========================================================
   CATEGORY SECTION TITLE
   ========================================================== */

.auditCategoryTitle {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.auditCategoryTitle span {
  color: #073f4c;
  font-weight: 800;
}

.auditCategoryTitle small {
  color: #74888e;
  font-size: 10px;
  font-weight: 400;
}


/* ==========================================================
   ORDER TABLE
   ========================================================== */

.auditOrderMatrix {
  width: max-content !important;
  min-width: 100% !important;
}


/* Rate */

.auditRateHeader {
  min-width: 70px !important;

  background: #0b5364 !important;
  color: #ffffff !important;

  text-align: center !important;

  border-left: 2px solid #8faab1 !important;
}


/* Order Qty */

.auditOrderQtyHeader {
  min-width: 130px !important;

  background: #073f4c !important;
  color: #ffffff !important;

  text-align: center !important;
}


/* ==========================================================
   CLICKABLE CATEGORY
   ========================================================== */

.auditClickableCategory {
  cursor: pointer !important;

  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.auditClickableCategory:hover {
  background: #dcebed !important;
}

.auditCategoryClickInner {
  display: flex;
  align-items: center;
  gap: 7px;
}

.auditExpandIcon {
  display: inline-flex;
  align-items: center;
  justify-content: center;

  width: 15px;
  flex: 0 0 15px;

  color: #0c6879;

  font-size: 9px;
}


/* ==========================================================
   CATEGORY RATE / ORDER CELLS
   ========================================================== */

.auditCategoryNoOrder {
  background: #f6f9fa !important;
  color: #8a9ba0 !important;

  text-align: center !important;

  font-size: 10px !important;
  font-weight: 700 !important;

  vertical-align: middle !important;
}


/* ==========================================================
   EXPANDED ITEM ROWS
   ========================================================== */

.auditItemValueRow th,
.auditItemValueRow td,
.auditItemQuantityRow th,
.auditItemQuantityRow td {
  background-clip: padding-box;
}


/* ----------------------------------------------------------
   ITEM NAME
   ---------------------------------------------------------- */

.auditDrillItem {
  min-width: 150px !important;
  max-width: 190px !important;

  padding-left: 24px !important;

  background: #fbfdfd !important;

  color: #123f49 !important;

  text-align: left !important;
  vertical-align: middle !important;

  white-space: normal !important;

  border-left: 4px solid #78a9b3 !important;
  border-bottom: 2px solid #c2d1d5 !important;
}


/* Item code */

.auditDrillItemCode {
  margin-bottom: 3px;

  color: #0b6678;

  font-size: 9px;
  font-weight: 800;

  letter-spacing: 0.02em;
}


/* Item name */

.auditDrillItemName {
  color: #173f49;

  font-size: 11px;
  font-weight: 700;

  line-height: 1.25;
}


/* ABC */

.auditDrillItemABC {
  display: inline-block;

  margin-top: 5px;
  padding: 2px 6px;

  background: #e6f0f2;
  color: #42656e;

  border-radius: 999px;

  font-size: 8px;
  font-weight: 800;
}


/* ----------------------------------------------------------
   ITEM METRIC
   ---------------------------------------------------------- */

.auditItemMetric {
  min-width: 82px !important;

  background: #f7fafb !important;
  color: #526b72 !important;

  text-align: left !important;

  font-size: 10px !important;
  font-weight: 700 !important;
}


/* ----------------------------------------------------------
   ITEM MONTH VALUES
   ---------------------------------------------------------- */

.auditItemValueRow td,
.auditItemQuantityRow td {
  font-size: 11px;
}


/* Slight separation from category */

.auditItemValueRow > th,
.auditItemValueRow > td {
  border-top: 1px solid #e0e9eb !important;
}


/* Strong separator after each item */

.auditItemQuantityRow > th,
.auditItemQuantityRow > td {
  border-bottom: 2px solid #c2d1d5 !important;
}


/* Total */

.auditItemTotal {
  background: #f4f8f9 !important;
}


/* ==========================================================
   RATE
   ========================================================== */

.auditOrderRate {
  min-width: 70px !important;

  background: #fafcfc !important;
  color: #8b9b9f !important;

  text-align: center !important;

  font-size: 12px !important;
  font-weight: 700 !important;

  border-left: 2px solid #b4c5c9 !important;

  vertical-align: middle !important;
}


/* ==========================================================
   ORDER QUANTITY CELL
   ========================================================== */

.auditOrderQtyCell {
  min-width: 130px !important;

  background: #f8fbfb !important;

  text-align: center !important;
  vertical-align: middle !important;
}


/* ==========================================================
   +/- QUANTITY CONTROL
   ========================================================== */

.auditQtyControl {
  display: inline-flex;
  align-items: center;
  justify-content: center;

  overflow: hidden;

  background: #ffffff;

  border: 1px solid #b9cbd0;
  border-radius: 9px;
}


/* Buttons */

.auditQtyButton {
  width: 34px;
  height: 36px;

  display: flex;
  align-items: center;
  justify-content: center;

  padding: 0;

  background: #edf4f5;
  color: #0a5363;

  border: 0;

  font-size: 18px;
  font-weight: 800;

  line-height: 1;

  cursor: pointer;
}

.auditQtyButton:hover {
  background: #dcebed;
}

.auditQtyButton:active {
  background: #cbdfe3;
}

.auditQtyButton:disabled {
  color: #aebdc1;
  background: #f5f7f8;

  cursor: default;
}


/* Quantity input */

.auditQtyControl input {
  width: 48px;
  height: 36px;

  padding: 0 3px;

  background: #ffffff;
  color: #073f4c;

  border: 0;
  border-left: 1px solid #cbd8dc;
  border-right: 1px solid #cbd8dc;

  outline: none;

  text-align: center;

  font-size: 14px;
  font-weight: 800;

  appearance: textfield;
  -moz-appearance: textfield;
}


/* Remove browser number arrows */

.auditQtyControl input::-webkit-inner-spin-button,
.auditQtyControl input::-webkit-outer-spin-button {
  margin: 0;
  -webkit-appearance: none;
}


/* ==========================================================
   DRAFT NOTICE
   ========================================================== */

.auditDraftNotice {
  display: flex;
  align-items: center;
  gap: 8px;

  margin: -12px 0 18px;
  padding: 10px 12px;

  background: #fff8e8;

  border: 1px solid #ecd99e;
  border-radius: 9px;

  color: #775b13;

  font-size: 10px;
}

.auditDraftNotice span {
  font-weight: 800;
}

.auditDraftNotice strong {
  padding: 3px 6px;

  background: #f3e4b8;

  border-radius: 5px;
}

.auditDraftNotice small {
  color: #8c773f;
}


/* ==========================================================
   STICKY ORDER BAR
   ========================================================== */

.auditOrderBar {
  position: sticky;

  left: 0;
  right: 0;
  bottom: 12px;

  z-index: 40;

  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;

  width: 100%;

  margin-top: 20px;
  padding: 11px 13px;

  background: rgba(7, 63, 76, 0.97);
  color: #ffffff;

  border: 1px solid #356f7b;
  border-radius: 13px;

  box-shadow:
    0 8px 28px rgba(0, 36, 46, 0.22);
}


/* ----------------------------------------------------------
   ORDER BAR TOTALS
   ---------------------------------------------------------- */

.auditOrderBarSummary {
  display: flex;
  align-items: center;
  gap: 20px;
}

.auditOrderBarSummary > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.auditOrderBarSummary span {
  color: #bcd2d7;

  font-size: 8px;
  font-weight: 700;

  text-transform: uppercase;
}

.auditOrderBarSummary strong {
  color: #ffffff;

  font-size: 14px;
  font-weight: 800;
}


/* ----------------------------------------------------------
   ORDER BAR BUTTONS
   ---------------------------------------------------------- */

.auditOrderBarActions {
  display: flex;
  gap: 8px;
}


/* Save Draft */

.auditSaveDraftButton {
  min-height: 40px;

  padding: 0 16px;

  background: #ffffff;
  color: #0a5262;

  border: 1px solid #d2e0e3;
  border-radius: 8px;

  font-size: 11px;
  font-weight: 800;

  cursor: pointer;
}

.auditSaveDraftButton:hover {
  background: #edf5f6;
}


/* View Order */

.auditViewOrderButton {
  min-height: 40px;

  padding: 0 18px;

  background: #1f8294;
  color: #ffffff;

  border: 1px solid #4a9baa;
  border-radius: 8px;

  font-size: 11px;
  font-weight: 800;

  cursor: pointer;
}

.auditViewOrderButton:hover {
  background: #176e7e;
}


/* Disabled */

.auditSaveDraftButton:disabled,
.auditViewOrderButton:disabled,
.auditSubmitOrderButton:disabled {
  opacity: 0.5;
  cursor: default;
}


/* ==========================================================
   ORDER REVIEW OVERLAY
   ========================================================== */

.auditOrderOverlay {
  position: fixed;
  inset: 0;

  z-index: 1000;

  display: flex;
  align-items: center;
  justify-content: center;

  padding: 20px;

  background: rgba(2, 28, 35, 0.64);

  backdrop-filter: blur(3px);
}


/* ==========================================================
   ORDER REVIEW WINDOW
   ========================================================== */

.auditOrderReview {
  width: 100%;
  max-width: 720px;
  max-height: 88vh;

  display: flex;
  flex-direction: column;

  overflow: hidden;

  background: #f5f8f9;

  border: 1px solid #afc3c8;
  border-radius: 16px;

  box-shadow:
    0 20px 60px rgba(0, 26, 34, 0.35);
}


/* ==========================================================
   REVIEW HEADER
   ========================================================== */

.auditOrderReviewHeader {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 15px;

  padding: 18px 20px;

  background: #0b5364;
  color: #ffffff;
}

.auditOrderReviewHeader span {
  color: #a9d1d9;

  font-size: 9px;
  font-weight: 800;

  letter-spacing: 1px;
}

.auditOrderReviewHeader h3 {
  margin: 3px 0 2px;

  color: #ffffff;

  font-size: 20px;
}

.auditOrderReviewHeader p {
  margin: 0;

  color: #c9dfe3;

  font-size: 11px;
}


/* Close */

.auditOrderClose {
  width: 34px;
  height: 34px;

  display: flex;
  align-items: center;
  justify-content: center;

  flex: 0 0 34px;

  padding: 0;

  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;

  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 8px;

  font-size: 22px;

  cursor: pointer;
}


/* ==========================================================
   REVIEW LINES
   ========================================================== */

.auditOrderReviewLines {
  flex: 1;

  overflow-y: auto;

  padding: 12px;
}

.auditOrderReviewLine {
  display: grid;

  grid-template-columns:
    minmax(0, 1fr)
    65px
    140px;

  gap: 12px;

  align-items: center;

  padding: 11px 12px;

  margin-bottom: 8px;

  background: #ffffff;

  border: 1px solid #d2dfe2;
  border-radius: 10px;
}


/* Item */

.auditOrderReviewItem {
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 2px;
}

.auditOrderReviewItem span {
  color: #0b687a;

  font-size: 9px;
  font-weight: 800;
}

.auditOrderReviewItem strong {
  overflow: hidden;

  color: #073f4c;

  font-size: 11px;

  text-overflow: ellipsis;
  white-space: nowrap;
}

.auditOrderReviewItem small {
  color: #788d93;

  font-size: 9px;
}


/* Rate */

.auditOrderReviewRate {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}

.auditOrderReviewRate span {
  color: #7b8f95;

  font-size: 8px;
}

.auditOrderReviewRate strong {
  color: #536b72;

  font-size: 12px;
}


/* ==========================================================
   REVIEW QTY
   ========================================================== */

.auditReviewQty {
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.auditReviewQty button {
  width: 34px;
  height: 34px;

  padding: 0;

  background: #e8f1f3;
  color: #0a5868;

  border: 1px solid #c2d2d6;

  font-size: 17px;
  font-weight: 800;

  cursor: pointer;
}

.auditReviewQty button:first-child {
  border-radius: 8px 0 0 8px;
}

.auditReviewQty button:last-child {
  border-radius: 0 8px 8px 0;
}

.auditReviewQty input {
  width: 52px;
  height: 34px;

  padding: 0;

  background: #ffffff;
  color: #073f4c;

  border-top: 1px solid #c2d2d6;
  border-bottom: 1px solid #c2d2d6;
  border-left: 0;
  border-right: 0;

  outline: 0;

  text-align: center;

  font-size: 13px;
  font-weight: 800;

  appearance: textfield;
  -moz-appearance: textfield;
}

.auditReviewQty input::-webkit-inner-spin-button,
.auditReviewQty input::-webkit-outer-spin-button {
  -webkit-appearance: none;
}


/* ==========================================================
   EMPTY ORDER
   ========================================================== */

.auditOrderEmpty {
  padding: 50px 20px;

  color: #70868c;

  text-align: center;

  font-size: 12px;
}


/* ==========================================================
   REVIEW SUMMARY
   ========================================================== */

.auditOrderReviewSummary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);

  border-top: 1px solid #d2dfe2;
  border-bottom: 1px solid #d2dfe2;

  background: #ffffff;
}

.auditOrderReviewSummary > div {
  display: flex;
  flex-direction: column;
  gap: 3px;

  padding: 12px 15px;

  border-right: 1px solid #d2dfe2;
}

.auditOrderReviewSummary > div:last-child {
  border-right: 0;
}

.auditOrderReviewSummary span {
  color: #758a90;

  font-size: 8px;
  font-weight: 700;

  text-transform: uppercase;
}

.auditOrderReviewSummary strong {
  color: #073f4c;

  font-size: 16px;
  font-weight: 800;
}

.auditOrderReviewSummary small {
  color: #9a7d35;

  font-size: 8px;
}


/* ==========================================================
   REVIEW ACTIONS
   ========================================================== */

.auditOrderReviewActions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 9px;

  padding: 12px;

  background: #eef3f4;
}

.auditOrderReviewActions button {
  min-height: 46px;
}


/* Submit */

.auditSubmitOrderButton {
  padding: 0 18px;

  background: #147347;
  color: #ffffff;

  border: 1px solid #0e653c;
  border-radius: 8px;

  font-size: 11px;
  font-weight: 800;

  cursor: pointer;
}

.auditSubmitOrderButton:hover {
  background: #0d633a;
}


/* ==========================================================
   MOBILE
   ========================================================== */

@media (max-width: 700px) {

  /*
    Category/item column
  */

  .auditOrderMatrix
  .auditCategoryHeader,

  .auditOrderMatrix
  .auditMergedCategory,

  .auditOrderMatrix
  .auditDrillItem {
    min-width: 120px !important;
    width: 120px !important;
    max-width: 120px !important;
  }


  /*
    Metric column
  */

  .auditOrderMatrix
  .auditCategoryMetricHeader,

  .auditOrderMatrix
  .auditCategoryMetric,

  .auditOrderMatrix
  .auditItemMetric {
    min-width: 68px !important;
    width: 68px !important;
  }


  /*
    Sticky metric position
  */

  .auditOrderMatrix
  .auditCategoryMetricHeader,

  .auditOrderMatrix
  .auditCategoryMetric,

  .auditOrderMatrix
  .auditItemMetric {
    left: 120px !important;
  }


  /* Item indentation */

  .auditDrillItem {
    padding-left: 17px !important;
  }

  .auditDrillItemCode {
    font-size: 8px;
  }

  .auditDrillItemName {
    font-size: 10px;
  }


  /* Order quantity */

  .auditOrderQtyHeader,
  .auditOrderQtyCell {
    min-width: 118px !important;
  }

  .auditQtyButton {
    width: 31px;
    height: 34px;
  }

  .auditQtyControl input {
    width: 43px;
    height: 34px;
  }


  /* Sticky bottom order bar */

  .auditOrderBar {
    bottom: 7px;

    flex-direction: column;
    align-items: stretch;

    gap: 9px;

    padding: 10px;

    border-radius: 12px;
  }

  .auditOrderBarSummary {
    justify-content: space-around;

    gap: 5px;
  }

  .auditOrderBarSummary > div {
    flex: 1;

    align-items: center;

    padding: 0 6px;
  }

  .auditOrderBarActions {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .auditOrderBarActions button {
    width: 100%;
    min-height: 42px;
  }


  /* Review becomes mobile sheet */

  .auditOrderOverlay {
    align-items: flex-end;

    padding: 0;
  }

  .auditOrderReview {
    max-width: none;
    max-height: 92vh;

    border-radius: 16px 16px 0 0;

    border-bottom: 0;
  }

  .auditOrderReviewHeader {
    padding: 15px;
  }

  .auditOrderReviewHeader h3 {
    font-size: 18px;
  }


  /* Review lines */

  .auditOrderReviewLine {
    grid-template-columns:
      minmax(0, 1fr)
      48px;

    gap: 8px;
  }

  .auditOrderReviewItem {
    grid-column: 1;
  }

  .auditOrderReviewRate {
    grid-column: 2;
    grid-row: 1;
  }

  .auditReviewQty {
    grid-column: 1 / -1;

    justify-content: flex-start;

    padding-top: 7px;

    border-top: 1px solid #e4ebed;
  }

  .auditReviewQty button {
    width: 38px;
    height: 36px;
  }

  .auditReviewQty input {
    width: 58px;
    height: 36px;
  }


  /* Summary */

  .auditOrderReviewSummary > div {
    padding: 10px;
  }

  .auditOrderReviewSummary strong {
    font-size: 14px;
  }


  /* Actions */

  .auditOrderReviewActions {
    position: sticky;
    bottom: 0;

    padding-bottom:
      max(
        12px,
        env(safe-area-inset-bottom)
      );
  }

}


/* ==========================================================
   VERY SMALL PHONES
   ========================================================== */

@media (max-width: 390px) {

  .auditOrderBarSummary span {
    font-size: 7px;
  }

  .auditOrderBarSummary strong {
    font-size: 12px;
  }

  .auditSaveDraftButton,
  .auditViewOrderButton {
    padding-left: 8px;
    padding-right: 8px;

    font-size: 10px;
  }

  .auditOrderReviewActions {
    gap: 7px;
  }

}
