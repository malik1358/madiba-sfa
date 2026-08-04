import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/* ============================================================
   HELPERS
   ============================================================ */

function clean(value) {
  if (value === undefined || value === null) return null;

  const v = String(value).trim();

  return v === "" ? null : v;
}

function number(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const cleaned = String(value)
    .replace(/,/g, "")
    .replace(/%/g, "")
    .trim();

  const parsed = Number(cleaned);

  return Number.isFinite(parsed) ? parsed : 0;
}

function excelDate(value) {
  if (!value) return null;

  if (value instanceof Date && !isNaN(value)) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number") {
    const d = XLSX.SSF.parse_date_code(value);

    if (!d) return null;

    return `${d.y}-${String(d.m).padStart(
      2,
      "0"
    )}-${String(d.d).padStart(2, "0")}`;
  }

  const text = String(value).trim();

  // DD/MM/YYYY
  const dmy = text.match(
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/
  );

  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(
      2,
      "0"
    )}-${dmy[1].padStart(2, "0")}`;
  }

  // YYYY-MM-DD
  const ymd = text.match(
    /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/
  );

  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(
      2,
      "0"
    )}-${ymd[3].padStart(2, "0")}`;
  }

  const parsed = new Date(text);

  if (!isNaN(parsed)) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
}

function findValue(row, possibilities) {
  const keys = Object.keys(row);

  for (const possibility of possibilities) {
    const match = keys.find(
      (key) =>
        key.trim().toLowerCase() ===
        possibility.trim().toLowerCase()
    );

    if (match) {
      return row[match];
    }
  }

  return null;
}

function normalizeImportedItemName(value) {
  const lines = String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let name = lines[0] || "";
  if (!name) return null;

  name = name
    .replace(/\b(?:A\s*)?repet(?:e|i)?d\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return name || null;
}

/* ============================================================
   MAIN IMPORT API
   ============================================================ */

export async function POST(request) {
  let batchId = null;

  try {
    /* ========================================================
       1. CHECK SERVER CONFIGURATION
       ======================================================== */

    if (!supabaseUrl || !serviceKey) {
      throw new Error(
        "Server configuration is incomplete."
      );
    }

    const admin = createClient(
      supabaseUrl,
      serviceKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );

    /* ========================================================
       2. VERIFY LOGGED-IN USER
       ======================================================== */

    const authHeader =
      request.headers.get("authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        {
          success: false,
          error: "Not authenticated",
        },
        {
          status: 401,
        }
      );
    }

    const token = authHeader.replace(
      "Bearer ",
      ""
    );

    const {
      data: { user },
      error: userError,
    } = await admin.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid login session",
        },
        {
          status: 401,
        }
      );
    }

    /* ========================================================
       3. VERIFY MANAGEMENT ACCESS
       ======================================================== */

    const {
      data: profile,
      error: profileError,
    } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (
      profileError ||
      !profile ||
      !["admin", "manager"].includes(
        String(profile.role).toLowerCase()
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Only management can upload sales data.",
        },
        {
          status: 403,
        }
      );
    }

    /* ========================================================
       4. RECEIVE EXCEL FILE
       ======================================================== */

    const formData =
      await request.formData();

    const file = formData.get("file");

    if (!file) {
      return NextResponse.json(
        {
          success: false,
          error: "No Excel file received.",
        },
        {
          status: 400,
        }
      );
    }

    const fileName =
      file.name || "sales-data.xlsx";

    const lowerFileName =
      fileName.toLowerCase();

    if (
      !lowerFileName.endsWith(".xlsx") &&
      !lowerFileName.endsWith(".xls")
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Please upload an Excel file.",
        },
        {
          status: 400,
        }
      );
    }

    /* ========================================================
       5. READ EXCEL
       ======================================================== */

    const bytes =
      await file.arrayBuffer();

    const workbook = XLSX.read(bytes, {
      type: "array",
      cellDates: true,
    });

    if (!workbook.SheetNames.length) {
      throw new Error(
        "Excel workbook contains no sheets."
      );
    }

    const sheetName =
      workbook.SheetNames[0];

    const worksheet =
      workbook.Sheets[sheetName];

    const rows =
      XLSX.utils.sheet_to_json(
        worksheet,
        {
          defval: null,
          raw: true,
        }
      );

    if (!rows.length) {
      throw new Error(
        "Excel sheet contains no data."
      );
    }

    /* ========================================================
       6. MAP KSA SALES DATA

       IMPORTANT SECURITY RULE:
       --------------------------------------------------------
       We deliberately DO NOT import:

       - Margin
       - Margin %
       - GP
       - GP %
       - Gross Profit
       - Cost
       - Cost Price
       - Purchase Cost
       - Landed Cost
       - COGS
       - Profit
       - Profit %

       We also DO NOT store the complete original Excel row.

       The SFA only receives operational sales information.
       ======================================================== */

    const mappedRows = rows
      .map((row, index) => {

        /* ---------------- DATE ---------------- */

        const transactionDate =
          excelDate(
            findValue(row, [
              "Date",
            ])
          );

        /* ---------------- CUSTOMER ----------------

           Example:

           1224 RAWAAT MAZAYA TRADING EST

           becomes:

           customer_code = 1224
           customer_name = RAWAAT MAZAYA TRADING EST
        ------------------------------------------------ */

        const partyRaw = clean(
          findValue(row, [
            "Party Name",
          ])
        );

        let customerCode = null;
        let customerName = partyRaw;

        if (partyRaw) {
          const customerMatch =
            partyRaw.match(
              /^(\d+)\s+(.*)$/
            );

          if (customerMatch) {
            customerCode =
              customerMatch[1];

            customerName =
              customerMatch[2].trim();
          } else {
            /*
              Fallback so a future ERP record without a
              numeric prefix is not silently discarded.
            */
            customerCode = partyRaw;
          }
        }

        /* ---------------- SALESMAN ---------------- */

        const salesmanName = clean(
          findValue(row, [
            "Sales Person",
          ])
        );

        /*
          The current source Excel does not have a separate
          salesman code.

          For V1 the normalized salesman name is used as
          salesman_code.
        */

        const salesmanCode =
          salesmanName
            ? salesmanName
                .toUpperCase()
                .trim()
            : null;

        /* ---------------- ITEM ----------------

           Example:

           A004037_MADIBA KETTLE 1.7L

           becomes:

           item_code = A004037
           item_name = MADIBA KETTLE 1.7L
        ------------------------------------------------ */

        const itemCombinedRaw = clean(
          findValue(row, [
            "Item Name",
            "Item",
            "Product",
            "Product Name",
            "Item Name/Code",
            "Item Code & Name",
          ])
        );

        const itemCodeRaw = clean(
          findValue(row, [
            "Item Code",
            "Item No",
            "Item Number",
            "SKU",
            "Stock Code",
            "Code",
          ])
        );

        const itemNameRaw = clean(
          findValue(row, [
            "Item Description",
            "Description",
            "Product Description",
            "Item Desc",
            "Item Name",
            "Product Name",
          ])
        );

        let itemCode = null;
        let itemName = normalizeImportedItemName(itemCombinedRaw || itemNameRaw);

        if (itemCombinedRaw) {
          const cleanedItem =
            itemCombinedRaw
              .replace(/^`/, "")
              .trim();

          const itemMatch =
            cleanedItem.match(
              /^([A-Za-z0-9]+)[_\-\s]+(.*)$/
            );

          if (itemMatch) {
            itemCode =
              itemMatch[1].trim();

            itemName =
              normalizeImportedItemName(itemMatch[2].trim());
          } else {
            itemCode = cleanedItem;
            itemName = normalizeImportedItemName(cleanedItem);
          }
        }

        if (itemCodeRaw) {
          const explicitCode = itemCodeRaw.replace(/^`/, "").trim();
          if (explicitCode) {
            itemCode = explicitCode;
          }
        }

        if (itemNameRaw) {
          const explicitName = normalizeImportedItemName(itemNameRaw.trim());
          if (explicitName) {
            itemName = explicitName;
          }
        }

        if (!itemName && itemCode) {
          itemName = itemCode;
        }

        itemName = normalizeImportedItemName(itemName) || itemName;

        /* ---------------- CATEGORY ---------------- */

        const category = clean(
          findValue(row, [
            "Item Category",
            "Category",
            "Product Category",
            "Main Category",
            "Sub Category",
            "Item Group",
            "Product Group",
            "Group",
          ])
        );

        /* ---------------- FINAL DATABASE ROW ---------------- */

        return {
          import_batch_id: null,

          source_row_number:
            index + 2,

          reference: clean(
            findValue(row, [
              "Reference",
            ])
          ),

          voucher_number: clean(
            findValue(row, [
              "Voucher Number",
            ])
          ),

          voucher_type: clean(
            findValue(row, [
              "Voucher Type",
            ])
          ),

          transaction_date:
            transactionDate,

          customer_code:
            customerCode,

          customer_name:
            customerName,

          salesman_code:
            salesmanCode,

          salesman_name:
            salesmanName,

          item_code:
            itemCode,

          item_name:
            itemName,

          category:
            category,

          local_import: clean(
            findValue(row, [
              "Local/Import",
            ])
          ),

          quantity: number(
            findValue(row, [
              "Sales Qty",
            ])
          ),

          /*
            RATE = selling rate.

            We KEEP this because it will later be needed
            for order entry and customer price reference.
          */

          rate: number(
            findValue(row, [
              "Rate",
            ])
          ),

          sales_amount: number(
            findValue(row, [
              "Sales Amount",
            ])
          ),

          first_purchase_date:
            excelDate(
              findValue(row, [
                "First Purchase Date(sale)",
              ])
            ),

          abc_class: clean(
            findValue(row, [
              "ABC Category",
            ])
          ),

          /*
            SECURITY:

            Do NOT save the complete Excel row.

            This prevents Margin / GP / Cost or any other
            confidential ERP columns from being hidden
            inside JSON.
          */

          source_data: null,
        };
      })

      /* Ignore completely blank / irrelevant rows */

      .filter((row) => {
        return (
          row.customer_code ||
          row.customer_name ||
          row.item_code ||
          row.item_name ||
          row.sales_amount !== 0
        );
      });

    if (!mappedRows.length) {
      throw new Error(
        "No valid sales rows were detected in the Excel file."
      );
    }

    /* ========================================================
       7. DATA QUALITY VALIDATION
       ======================================================== */

    const validTransactionRows =
      mappedRows.filter(
        (row) =>
          row.transaction_date &&
          row.customer_code &&
          row.item_code
      );

    /*
      If more than 20% of the Excel suddenly does not contain
      Date + Customer + Item, assume the ERP export structure
      changed.

      Do NOT activate the dataset.
    */

    if (
      validTransactionRows.length <
      mappedRows.length * 0.8
    ) {
      throw new Error(
        `Import cancelled. Only ${validTransactionRows.length} of ${mappedRows.length} rows contain valid Date, Customer and Item information.`
      );
    }

    /* ========================================================
       8. CREATE NEW IMPORT BATCH
       ======================================================== */

    const {
      data: batch,
      error: batchError,
    } = await admin
      .from("import_batches")
      .insert({
        file_name: fileName,
        uploaded_by: user.id,
        status: "PROCESSING",
        total_rows:
          mappedRows.length,
      })
      .select("id")
      .single();

    if (batchError) {
      throw batchError;
    }

    batchId = batch.id;

    for (const row of mappedRows) {
      row.import_batch_id =
        batchId;
    }

    /* ========================================================
       9. INSERT SALES DATA IN CHUNKS
       ======================================================== */

    const CHUNK_SIZE = 500;

    for (
      let i = 0;
      i < mappedRows.length;
      i += CHUNK_SIZE
    ) {
      const chunk =
        mappedRows.slice(
          i,
          i + CHUNK_SIZE
        );

      const {
        error: insertError,
      } = await admin
        .from("sales_raw")
        .insert(chunk);

      if (insertError) {
        throw new Error(
          `Database insert failed around Excel row ${
            i + 2
          }: ${insertError.message}`
        );
      }
    }

    /* ========================================================
       10. IMPORT STATISTICS
       ======================================================== */

    const customers =
      new Set();

    const items =
      new Set();

    const salesmen =
      new Set();

    const dates = [];

    for (const row of mappedRows) {
      if (row.customer_code) {
        customers.add(
          row.customer_code
        );
      }

      if (row.item_code) {
        items.add(
          row.item_code
        );
      }

      if (row.salesman_code) {
        salesmen.add(
          row.salesman_code
        );
      }

      if (row.transaction_date) {
        dates.push(
          row.transaction_date
        );
      }
    }

    dates.sort();

    const minDate =
      dates.length
        ? dates[0]
        : null;

    const maxDate =
      dates.length
        ? dates[
            dates.length - 1
          ]
        : null;

    /* ========================================================
       11. DETERMINE CURRENT SALESMAN FOR EACH CUSTOMER

       BUSINESS RULE:

       The customer belongs to the salesman from the
       customer's LAST TRANSACTION.

       If multiple transactions exist on the same latest date,
       the later Excel row wins.
       ======================================================== */

    const latestCustomer =
      new Map();

    for (const row of mappedRows) {
      if (!row.customer_code) {
        continue;
      }

      const existing =
        latestCustomer.get(
          row.customer_code
        );

      if (!existing) {
        latestCustomer.set(
          row.customer_code,
          row
        );

        continue;
      }

      if (
        row.transaction_date &&
        (
          !existing.transaction_date ||
          row.transaction_date >
            existing.transaction_date
        )
      ) {
        latestCustomer.set(
          row.customer_code,
          row
        );

        continue;
      }

      if (
        row.transaction_date &&
        existing.transaction_date &&
        row.transaction_date ===
          existing.transaction_date &&
        row.source_row_number >
          existing.source_row_number
      ) {
        latestCustomer.set(
          row.customer_code,
          row
        );
      }
    }

    /* ========================================================
       12. UPDATE CUSTOMER MASTER
       ======================================================== */

    const customerUpserts = [];

    for (
      const [
        customerCode,
        row,
      ] of latestCustomer
    ) {
      customerUpserts.push({
        customer_code:
          customerCode,

        customer_name:
          row.customer_name ||
          customerCode,

        current_salesman_code:
          row.salesman_code,

        latest_transaction_date:
          row.transaction_date,

        is_active: true,
      });
    }

    const CUSTOMER_CHUNK = 500;

    for (
      let i = 0;
      i <
      customerUpserts.length;
      i += CUSTOMER_CHUNK
    ) {
      const chunk =
        customerUpserts.slice(
          i,
          i + CUSTOMER_CHUNK
        );

      const {
        error: customerError,
      } = await admin
        .from("customers")
        .upsert(
          chunk,
          {
            onConflict:
              "customer_code",
          }
        );

      if (customerError) {
        throw new Error(
          `Customer update failed: ${customerError.message}`
        );
      }
    }

    /* ========================================================
       13. UPSERT ITEM MASTER FROM IMPORTED SALES
       ======================================================== */

    const itemMap = new Map();

    for (const row of mappedRows) {
      const itemCode = clean(row.item_code);
      if (!itemCode) continue;

      const itemName = normalizeImportedItemName(clean(row.item_name)) || itemCode;
      const itemCategory = clean(row.category);

      if (!itemMap.has(itemCode)) {
        itemMap.set(itemCode, {
          item_code: itemCode,
          item_name: itemName,
          category: itemCategory || "Unclassified",
        });
        continue;
      }

      const existing = itemMap.get(itemCode);

      const existingName = String(existing.item_name || "").trim();
      const nextName = String(itemName || "").trim();
      if ((!existingName || existingName === itemCode) && nextName && nextName !== itemCode) {
        existing.item_name = nextName;
      }

      const existingCategory = String(existing.category || "").trim();
      const nextCategory = String(itemCategory || "").trim();
      if ((!existingCategory || existingCategory.toUpperCase() === "UNCLASSIFIED") && nextCategory) {
        existing.category = nextCategory;
      }

      itemMap.set(itemCode, existing);
    }

    const itemUpserts = Array.from(itemMap.values());
    const ITEM_CHUNK = 500;

    for (let i = 0; i < itemUpserts.length; i += ITEM_CHUNK) {
      const chunk = itemUpserts.slice(i, i + ITEM_CHUNK);
      const { error: itemError } = await admin
        .from("items_master")
        .upsert(chunk, { onConflict: "item_code" });

      if (itemError) {
        throw new Error(`Item master update failed: ${itemError.message}`);
      }
    }

    /* ========================================================
       14. UPDATE BATCH STATISTICS
       ======================================================== */

    const {
      error: statsError,
    } = await admin
      .from("import_batches")
      .update({
        total_rows:
          mappedRows.length,

        customer_count:
          customers.size,

        item_count:
          items.size,

        salesman_count:
          salesmen.size,

        min_transaction_date:
          minDate,

        max_transaction_date:
          maxDate,
      })
      .eq(
        "id",
        batchId
      );

    if (statsError) {
      throw statsError;
    }

    /* ========================================================
       15. ACTIVATE NEW SNAPSHOT
       ======================================================== */

    const {
      error: activateError,
    } = await admin.rpc(
      "activate_sales_batch",
      {
        p_batch_id:
          batchId,
      }
    );

    if (activateError) {
      throw activateError;
    }

    /* ========================================================
       16. SUCCESS RESPONSE
       ======================================================== */

    return NextResponse.json({
      success: true,

      batchId,

      fileName,

      rows:
        mappedRows.length,

      customers:
        customers.size,

      items:
        items.size,

      salesmen:
        salesmen.size,

      minDate,

      maxDate,

      message:
        "Sales data replaced successfully.",
    });

  } catch (error) {
    /* ========================================================
       MARK FAILED IMPORT
       ======================================================== */

    if (
      batchId &&
      supabaseUrl &&
      serviceKey
    ) {
      try {
        const admin =
          createClient(
            supabaseUrl,
            serviceKey,
            {
              auth: {
                persistSession:
                  false,

                autoRefreshToken:
                  false,
              },
            }
          );

        await admin
          .from(
            "import_batches"
          )
          .update({
            status: "FAILED",

            error_message:
              error?.message ||
              "Unknown import error",

            completed_at:
              new Date().toISOString(),
          })
          .eq(
            "id",
            batchId
          );

      } catch {
        // Ignore cleanup failures during import error handling.
      }
    }

    return NextResponse.json(
      {
        success: false,

        error:
          error?.message ||
          "Unknown import error",
      },
      {
        status: 500,
      }
    );
  }
}
