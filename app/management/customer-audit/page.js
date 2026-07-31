"use client";

const PAGE_VERSION = "01 Aug 2026 - Quick Order V1";

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
     ITEM MASTER / QUICK ORDER
     ======================================================== */

  const [itemMaster, setItemMaster] =
    useState([]);


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
     LOAD CUSTOMERS + ITEM MASTER
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


      /* ----------------------------------------------------
         ITEM MASTER
         RATE REMAINS BLANK FOR NOW
         ---------------------------------------------------- */

      const {
        data: masterData,
        error: masterError,
      } =
        await supabase
          .from("items_master")
          .select("*")
          .eq("is_active", true);

      if (masterError) {
        throw masterError;
      }

      setItemMaster(
        masterData || []
      );


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
         CATEGORIES
         Only categories sold in visible 6 months
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


              /* --------------------------------------------
                 TOTALS ONLY FROM DISPLAYED 6 MONTHS
                 -------------------------------------------- */

              const visibleTotalSales =
                months.reduce(
                  (total, month) =>
                    total +
                    Number(
                      monthData[
                        month
                      ]?.sales || 0
                    ),
                  0
                );


              const visibleSkuSet =
                new Set();


              months.forEach(
                (month) => {

                  const originalMonth =
                    category.months[
                      month
                    ];

                  if (
                    originalMonth
                  ) {

                    originalMonth
                      .skus
                      .forEach(
                        (sku) =>
                          visibleSkuSet.add(
                            sku
                          )
                      );
                  }
                }
              );


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
              category.totalSales !==
                0 ||
              category.totalSkuCount >
                0
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
     QUICK ORDER SUGGESTIONS
     3 NEW ITEMS
     2 NOT BOUGHT SINCE LONG
     2 BUYING LESS
     ======================================================== */

  const quickOrderSuggestions =
    useMemo(() => {

      if (
        !analytics ||
        !itemMaster.length
      ) {
        return {
          newItems: [],
          notBoughtRecently: [],
          buyingLess: [],
        };
      }


      const normalizeCode =
        (value) =>
          String(value || "")
            .trim()
            .toUpperCase();


      /* ----------------------------------------------------
         BUILD COMPLETE CUSTOMER ITEM HISTORY
         ---------------------------------------------------- */

      const historyByCode =
        new Map();


      transactions.forEach(
        (row) => {

          const code =
            normalizeCode(
              row.item_code
            );

          if (!code) {
            return;
          }


          if (
            !historyByCode.has(
              code
            )
          ) {

            historyByCode.set(
              code,
              {

                item_code:
                  String(
                    row.item_code ||
                    ""
                  ).trim(),

                item_name:
                  row.item_name ||
                  row.item_code ||
                  "Unknown Item",

                category:
                  row.category ||
                  "Unclassified",

                lastBought:
                  null,

                months:
                  {},
              }
            );
          }


          const item =
            historyByCode.get(
              code
            );


          const qty =
            Number(
              row.quantity || 0
            );


          const month =
            monthKey(
              row.transaction_date
            );


          if (month) {

            if (
              !item.months[
                month
              ]
            ) {
              item.months[
                month
              ] = 0;
            }


            item.months[
              month
            ] += qty;
          }


          /*
           * Returns / negative quantities
           * do not count as a purchase date.
           */

          if (
            qty > 0 &&
            row.transaction_date &&
            (
              !item.lastBought ||
              row.transaction_date >
                item.lastBought
            )
          ) {

            item.lastBought =
              row.transaction_date;
          }

        }
      );


      /* ----------------------------------------------------
         CUSTOMER'S PURCHASED CATEGORIES
         ---------------------------------------------------- */

      const boughtCategories =
        new Set(
          Array.from(
            historyByCode.values()
          )
            .map(
              (item) =>
                String(
                  item.category ||
                  ""
                )
                  .trim()
                  .toLowerCase()
            )
            .filter(Boolean)
        );


      /* ----------------------------------------------------
         CLEAN ACTIVE MASTER ITEMS
         ---------------------------------------------------- */

      const cleanMaster =
        itemMaster
          .map(
            (row) => {

              const itemCode =
                String(
                  row.item_code ||
                  row.code ||
                  ""
                ).trim();


              const itemName =
                row.item_name ||
                row.name ||
                row.description ||
                itemCode ||
                "Unknown Item";


              const category =
                row.category ||
                row.item_category ||
                "Unclassified";


              return {

                item_code:
                  itemCode,

                item_name:
                  itemName,

                category,

                /*
                 * RATE INTENTIONALLY BLANK
                 * until Google Sheet is connected.
                 */

                rate:
                  null,

                master_row:
                  row,
              };

            }
          )
          .filter(
            (item) =>
              item.item_code
          );


      /* ====================================================
         1. NEW ITEMS
         ==================================================== */

      const newItems =
        cleanMaster
          .filter(
            (item) =>
              !historyByCode.has(
                normalizeCode(
                  item.item_code
                )
              )
          )
          .map(
            (item) => ({

              ...item,

              categoryMatch:
                boughtCategories.has(
                  String(
                    item.category ||
                    ""
                  )
                    .trim()
                    .toLowerCase()
                )
                  ? 1
                  : 0,

              recommendationReason:
                "New Item",

            })
          )
          .sort(
            (a, b) => {

              if (
                b.categoryMatch !==
                a.categoryMatch
              ) {

                return (
                  b.categoryMatch -
                  a.categoryMatch
                );
              }


              return String(
                a.item_name ||
                ""
              ).localeCompare(
                String(
                  b.item_name ||
                  ""
                )
              );

            }
          )
          .slice(0, 3);


      /* ====================================================
         2. NOT BOUGHT SINCE LONG
         ==================================================== */

      const notBoughtRecently =
        Array.from(
          historyByCode.values()
        )
          .filter(
            (item) =>
              item.lastBought
          )
          .sort(
            (a, b) =>
              String(
                a.lastBought
              ).localeCompare(
                String(
                  b.lastBought
                )
              )
          )
          .slice(0, 2)
          .map(
            (item) => ({

              ...item,

              rate:
                null,

              recommendationReason:
                "Not Bought Since Long",

            })
          );


      /* ====================================================
         3. BUYING LESS

         Latest 3 displayed transaction months
         versus previous 3 displayed transaction months.
         ==================================================== */

      const visibleMonths =
        analytics.months ||
        [];


      const recentMonths =
        visibleMonths.slice(
          -3
        );


      const previousMonths =
        visibleMonths.slice(
          -6,
          -3
        );


      const buyingLess =
        Array.from(
          historyByCode.values()
        )
          .map(
            (item) => {

              const recentQty =
                recentMonths.reduce(
                  (
                    total,
                    month
                  ) =>
                    total +
                    Number(
                      item.months[
                        month
                      ] || 0
                    ),
                  0
                );


              const previousQty =
                previousMonths.reduce(
                  (
                    total,
                    month
                  ) =>
                    total +
                    Number(
                      item.months[
                        month
                      ] || 0
                    ),
                  0
                );


              const decline =
                previousQty -
                recentQty;


              const declinePercent =
                previousQty > 0
                  ? decline /
                    previousQty
                  : 0;


              return {

                ...item,

                recentQty,

                previousQty,

                decline,

                declinePercent,
              };

            }
          )
          .filter(
            (item) =>
              item.previousQty >
                0 &&
              item.recentQty <
                item.previousQty
          )
          .sort(
            (a, b) => {

              if (
                b.declinePercent !==
                a.declinePercent
              ) {

                return (
                  b.declinePercent -
                  a.declinePercent
                );
              }


              return (
                b.decline -
                a.decline
              );

            }
          )
          .slice(0, 2)
          .map(
            (item) => ({

              ...item,

              rate:
                null,

              recommendationReason:
                "Buying Less",

            })
          );


      return {

        newItems,

        notBoughtRecently,

        buyingLess,
      };

    }, [
      analytics,
      transactions,
      itemMaster,
    ]);


  const quickOrderAllItems =
    useMemo(
      () => [

        ...quickOrderSuggestions
          .newItems,

        ...quickOrderSuggestions
          .notBoughtRecently,

        ...quickOrderSuggestions
          .buyingLess,

      ],
      [
        quickOrderSuggestions,
      ]
    );
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

            let item =
              analytics.items.find(
                (row) =>
                  row.item_code ===
                  itemCode
              );


            /*
             * NEW QUICK-ORDER ITEMS MAY NOT
             * EXIST IN CUSTOMER SALES HISTORY.
             */

            if (!item) {

              item =
                quickOrderAllItems.find(
                  (row) =>
                    row.item_code ===
                    itemCode
                );
            }


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
      quickOrderAllItems,
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
             * Google Sheet rate source
             * will be connected later.
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
       * SAVE CURRENT QUANTITIES FIRST.
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
     CUSTOMER LIST
     ======================================================== */

  if (!selectedCustomer) {

    return (

      <main className="auditPage">

        <div className="auditShell">


          {/* ================================================
              HEADER
              ================================================ */}

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


          {/* ================================================
              ERROR
              ================================================ */}

          {error && (

            <div className="auditError">
              {error}
            </div>

          )}


          {/* ================================================
              FILTERS
              ================================================ */}

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


          {/* ================================================
              CUSTOMER COUNT
              ================================================ */}

          <div className="auditCustomerCount">

            <strong>
              {
                filteredCustomers.length
              }
            </strong>{" "}

            customers

          </div>


          {/* ================================================
              CUSTOMER LIST
              ================================================ */}

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


          <div className="auditVersion">
            Page updated: {PAGE_VERSION}
          </div>

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


          <div className="auditVersion">
            Page updated: {PAGE_VERSION}
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


                {/* SKUS SOLD */}

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
            CATEGORY PERFORMANCE
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


                {/* MONTH HEADER */}

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
                                {
                                  category.category
                                }
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
                                  key={
                                    month
                                  }
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
                                  key={
                                    month
                                  }
                                  className={trendClass(
                                    current,
                                    previous,
                                    index > 0
                                  )}
                                >

                                  {current ||
                                    "—"}

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
                                analytics.months.length + 3
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
                                      {category.items.length} items
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


                                {category.items.length === 0 ? (

                                  <div className="auditEmpty">
                                    No items found in this category.
                                  </div>

                                ) : (

                                  <div className="auditItemTableScroll">

                                    <table className="auditItemMatrix">

                                      <thead>

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
                                                key={group.year}
                                                colSpan={
                                                  group.months.length
                                                }
                                              >
                                                {group.year}
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


                                        <tr className="auditItemMonthRow">

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
                                                key={item.item_key}
                                              >

                                                {/* ITEM VALUE */}

                                                <tr className="auditItemValueRow">

                                                  <th
                                                    rowSpan="2"
                                                    className="auditItemNameCell"
                                                  >

                                                    <div className="auditItemCode">
                                                      {item.item_code}
                                                    </div>

                                                    <div className="auditItemName">
                                                      {item.item_name}
                                                    </div>

                                                    {item.abc_class && (

                                                      <div className="auditItemABC">
                                                        {item.abc_class}
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
                                                        ]?.value || 0;

                                                      const previous =
                                                        index > 0
                                                          ? item.months[
                                                              analytics
                                                                .months[
                                                                  index - 1
                                                                ]
                                                            ]?.value || 0
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


                                                  <td className="auditItemTotal">
                                                    {numberFormat(
                                                      item.total_value
                                                    )}
                                                  </td>


                                                  {/* RATE BLANK */}

                                                  <td
                                                    rowSpan="2"
                                                    className="auditRateCell"
                                                  >
                                                    <span className="auditRateBlank">
                                                      —
                                                    </span>
                                                  </td>


                                                  {/* ORDER QTY */}

                                                  <td
                                                    rowSpan="2"
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
                                                      >
                                                        −
                                                      </button>

                                                      <input
                                                        type="number"
                                                        min="0"
                                                        step="1"
                                                        inputMode="numeric"
                                                        value={
                                                          orderQty || ""
                                                        }
                                                        placeholder="0"
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

                                                  </td>

                                                </tr>


                                                {/* ITEM QUANTITY */}

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
                                                        ]?.quantity || 0;

                                                      const previous =
                                                        index > 0
                                                          ? item.months[
                                                              analytics
                                                                .months[
                                                                  index - 1
                                                                ]
                                                            ]?.quantity || 0
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
            QUICK ORDER
            3 NEW + 2 NOT BOUGHT + 2 BUYING LESS
            ================================================== */}

        <section className="auditSection auditQuickOrderSection">

          <div className="auditQuickOrderHeading">

            <div>

              <h3>
                Quick Order
              </h3>

              <p>
                Suggested items based on this customer's purchase history.
              </p>

            </div>

            <span className="auditQuickOrderCount">
              {quickOrderAllItems.length} suggestions
            </span>

          </div>


          {quickOrderAllItems.length === 0 ? (

            <div className="auditEmpty">
              No quick-order suggestions available for this customer.
            </div>

          ) : (

            <div className="auditQuickOrderGroups">

              {[
                {
                  key: "newItems",
                  title: "New Items",
                  subtitle:
                    "Items this customer has never bought",
                  items:
                    quickOrderSuggestions.newItems,
                },

                {
                  key: "notBoughtRecently",
                  title: "Not Bought Since Long",
                  subtitle:
                    "Previously purchased items with the oldest last purchase",
                  items:
                    quickOrderSuggestions.notBoughtRecently,
                },

                {
                  key: "buyingLess",
                  title: "Buying Less",
                  subtitle:
                    "Items where recent quantity is lower than the previous period",
                  items:
                    quickOrderSuggestions.buyingLess,
                },
              ].map(
                (group) => (

                  <div
                    key={group.key}
                    className="auditQuickOrderGroup"
                  >

                    <div className="auditQuickOrderGroupHeader">

                      <div>

                        <strong>
                          {group.title}
                        </strong>

                        <span>
                          {group.subtitle}
                        </span>

                      </div>

                      <b>
                        {group.items.length}
                      </b>

                    </div>


                    {group.items.length === 0 ? (

                      <div className="auditQuickOrderEmpty">
                        No suggestion
                      </div>

                    ) : (

                      <div className="auditQuickOrderTableWrap">

                        <table className="auditQuickOrderTable">

                          <thead>

                            <tr>

                              <th>
                                Item
                              </th>

                              <th>
                                Category
                              </th>

                              <th>
                                History
                              </th>

                              <th>
                                Rate
                              </th>

                              <th>
                                Order Qty
                              </th>

                            </tr>

                          </thead>


                          <tbody>

                            {group.items.map(
                              (item) => {

                                const orderQty =
                                  Number(
                                    orderQuantities[
                                      item.item_code
                                    ] || 0
                                  );

                                return (

                                  <tr
                                    key={`${group.key}-${item.item_code}`}
                                  >

                                    {/* ITEM */}

                                    <td>

                                      <div className="auditQuickItemCode">
                                        {item.item_code}
                                      </div>

                                      <strong className="auditQuickItemName">
                                        {item.item_name}
                                      </strong>

                                    </td>


                                    {/* CATEGORY */}

                                    <td>
                                      {item.category ||
                                        "Unclassified"}
                                    </td>


                                    {/* REASON / HISTORY */}

                                    <td>

                                      {group.key ===
                                        "newItems" && (

                                        <span className="auditQuickBadge auditQuickBadgeNew">
                                          Never bought
                                        </span>

                                      )}


                                      {group.key ===
                                        "notBoughtRecently" && (

                                        <div className="auditQuickHistory">

                                          <span>
                                            Last bought
                                          </span>

                                          <strong>
                                            {shortDate(
                                              item.lastBought
                                            )}
                                          </strong>

                                        </div>

                                      )}


                                      {group.key ===
                                        "buyingLess" && (

                                        <div className="auditQuickHistory">

                                          <span>
                                            Previous 3 months
                                          </span>

                                          <strong>
                                            {qtyFormat(
                                              item.previousQty
                                            )}
                                          </strong>

                                          <span>
                                            Recent 3 months
                                          </span>

                                          <strong className="auditQuickDecline">
                                            {qtyFormat(
                                              item.recentQty
                                            )}
                                          </strong>

                                        </div>

                                      )}

                                    </td>


                                    {/* RATE BLANK */}

                                    <td className="auditQuickRate">
                                      —
                                    </td>


                                    {/* ORDER QTY */}

                                    <td>

                                      <div className="auditQtyControl">

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
                                            orderQty || ""
                                          }
                                          placeholder="0"
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

                                    </td>

                                  </tr>

                                );
                              }
                            )}

                          </tbody>

                        </table>

                      </div>

                    )}

                  </div>

                )
              )}

            </div>

          )}

        </section>


        {/* ==================================================
            QUICK ORDER CSS
            ================================================== */}

        <style jsx>{`

          .auditQuickOrderSection {
            margin-top: 28px;
          }

          .auditQuickOrderHeading {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 16px;
            margin-bottom: 12px;
          }

          .auditQuickOrderHeading h3 {
            margin: 0 0 3px;
          }

          .auditQuickOrderHeading p {
            margin: 0;
            color: #5b737b;
            font-size: 12px;
          }

          .auditQuickOrderCount {
            white-space: nowrap;
            border: 1px solid #b8cbd1;
            border-radius: 999px;
            padding: 6px 10px;
            background: #ffffff;
            color: #0b5364;
            font-size: 11px;
            font-weight: 800;
          }

          .auditQuickOrderGroups {
            display: grid;
            gap: 14px;
          }

          .auditQuickOrderGroup {
            overflow: hidden;
            border: 1px solid #b8cbd1;
            border-radius: 12px;
            background: #ffffff;
          }

          .auditQuickOrderGroupHeader {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 11px 14px;
            background: #0b5364;
            color: #ffffff;
          }

          .auditQuickOrderGroupHeader > div {
            display: flex;
            flex-direction: column;
            gap: 2px;
          }

          .auditQuickOrderGroupHeader strong {
            font-size: 13px;
          }

          .auditQuickOrderGroupHeader span {
            font-size: 10px;
            opacity: 0.85;
          }

          .auditQuickOrderGroupHeader b {
            min-width: 25px;
            height: 25px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.16);
            font-size: 11px;
          }

          .auditQuickOrderTableWrap {
            width: 100%;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
          }

          .auditQuickOrderTable {
            width: 100%;
            min-width: 760px;
            border-collapse: collapse;
            font-size: 11px;
          }

          .auditQuickOrderTable th,
          .auditQuickOrderTable td {
            padding: 9px 10px;
            border-right: 1px solid #cdd8dc;
            border-bottom: 1px solid #cdd8dc;
            vertical-align: middle;
          }

          .auditQuickOrderTable th:last-child,
          .auditQuickOrderTable td:last-child {
            border-right: 0;
          }

          .auditQuickOrderTable tbody tr:last-child td {
            border-bottom: 0;
          }

          .auditQuickOrderTable thead th {
            background: #edf3f5;
            color: #214d59;
            text-align: left;
            font-weight: 800;
          }

          .auditQuickItemCode {
            margin-bottom: 2px;
            color: #0b6a7d;
            font-size: 10px;
            font-weight: 800;
          }

          .auditQuickItemName {
            display: block;
            color: #073f4c;
            line-height: 1.25;
          }

          .auditQuickBadge {
            display: inline-block;
            padding: 4px 7px;
            border-radius: 999px;
            font-size: 10px;
            font-weight: 800;
          }

          .auditQuickBadgeNew {
            background: #eaf7ef;
            color: #16834f;
          }

          .auditQuickHistory {
            display: grid;
            grid-template-columns: auto auto;
            gap: 2px 8px;
            align-items: center;
          }

          .auditQuickHistory span {
            color: #63787e;
            font-size: 10px;
          }

          .auditQuickHistory strong {
            color: #123f4b;
            text-align: right;
          }

          .auditQuickDecline {
            color: #c63c3c !important;
          }

          .auditQuickRate {
            text-align: center;
            font-weight: 800;
          }

          .auditQuickOrderEmpty {
            padding: 14px;
            color: #63787e;
            font-size: 11px;
          }


          /* MOBILE */

          @media (max-width: 700px) {

            .auditQuickOrderHeading {
              align-items: stretch;
              flex-direction: column;
            }

            .auditQuickOrderCount {
              align-self: flex-start;
            }

          }

        `}</style>
        {/* ==================================================
            ORDER ACTION BAR
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
                    {selectedCustomer.customer_code}{" "}
                    {selectedCustomer.customer_name}
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


              {/* ============================================
                  ORDER REVIEW SUMMARY
                  ============================================ */}

              <div className="auditOrderReviewSummary">

                <div>

                  <span>
                    Items
                  </span>

                  <strong>
                    {orderSummary.itemCount}
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


              {/* ============================================
                  ORDER LINES
                  ============================================ */}

              <div className="auditOrderReviewLines">

                {orderItems.map(
                  (item) => (

                    <div
                      key={item.item_code}
                      className="auditOrderReviewLine"
                    >

                      <div className="auditOrderReviewItem">

                        <span>
                          {item.item_code}
                        </span>

                        <strong>
                          {item.item_name}
                        </strong>

                        <small>
                          {item.category ||
                            "Unclassified"}
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


              {/* ============================================
                  ORDER REVIEW ACTIONS
                  ============================================ */}

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
            TRANSACTION HISTORY
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


                        <td
                          className={`auditNumberCell ${
                            Number(
                              row.quantity
                            ) < 0
                              ? "auditNegativeValue"
                              : ""
                          }`}
                        >
                          {qtyFormat(
                            row.quantity
                          )}
                        </td>


                        <td
                          className={`auditNumberCell ${
                            Number(
                              row.sales_amount
                            ) < 0
                              ? "auditNegativeValue"
                              : ""
                          }`}
                        >
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
            PAGE VERSION
            ================================================== */}

        <div className="auditVersion">
          Page updated: {PAGE_VERSION}
        </div>


        {/* ==================================================
            PAGE FOOTER
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
              {selectedCustomer.customer_code}
            </strong>
          </span>

        </div>

      </div>

    </main>
  );
}
