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

    if (
      !fileName
        .toLowerCase()
        .endsWith(".xlsx") &&
      !fileName
        .toLowerCase()
        .endsWith(".xls")
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
     console.log("EXCEL HEADERS:", Object.keys(rows[0]));

return NextResponse.json({
  success: false,
  diagnostic: true,
  sheetName: sheetName,
  totalRows: rows.length,
  headers: Object.keys(rows[0]),
  firstRow: rows[0],
});

    /* ========================================================
       6. MAP YOUR ACTUAL KSA EXCEL FORMAT
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

           We separate:

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
             Keep a usable identifier even if a future
             export contains a party without a numeric prefix.
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
          Current Excel does not have a separate salesman
          code.

          Therefore for V1 we use the normalized salesman
          name as the salesman identifier.
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

        const itemRaw = clean(
          findValue(row, [
            "Item Name",
          ])
        );

        let itemCode = null;
        let itemName = itemRaw;

        if (itemRaw) {
          const cleanedItem =
            itemRaw
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
              itemMatch[2].trim();
          } else {
            /*
             Again, don't throw away the item if the
             future Excel format changes slightly.
            */
            itemCode = cleanedItem;
            itemName = cleanedItem;
          }
        }

        /* ---------------- CATEGORY ---------------- */

        const category = clean(
          findValue(row, [
            "Item Category",
          ])
        );

        /* ---------------- MARGIN % ---------------- */

        const marginPercentRaw =
          findValue(row, [
            "Margin %",
          ]);

        let marginPercent =
          number(marginPercentRaw);

        /*
          Excel sometimes stores 18% as 0.18.
          Convert that to 18.
        */

        if (
          marginPercent !== 0 &&
          Math.abs(marginPercent) <= 1
        ) {
          marginPercent =
            marginPercent * 100;
        }

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

          margin: number(
            findValue(row, [
              "Margin",
            ])
          ),

          margin_percent:
            marginPercent,

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
            IMPORTANT:

            Preserve the complete original Excel row.

            This means if later we discover another useful
            column, the source information is still stored.
          */

          source_data: row,
        };
      })

      /*
        Ignore completely blank / irrelevant Excel rows.
      */

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
      If more than 20% of rows suddenly don't contain
      date/customer/item, something probably changed in
      the ERP export.

      DO NOT activate such a dataset.
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

       CUSTOMER BELONGS TO THE SALESMAN FROM THE
       CUSTOMER'S LATEST TRANSACTION.
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

      /*
        Newer transaction wins.
      */

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

      /*
        If two transactions are on the same date,
        the later Excel row wins.

        This gives us deterministic ownership.
      */

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
       13. UPDATE BATCH STATISTICS
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
       14. ACTIVATE NEW SNAPSHOT
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
       15. SUCCESS RESPONSE
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
    console.error(
      "IMPORT ERROR:",
      error
    );

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
      } catch (
        cleanupError
      ) {
        console.error(
          "Failed to mark import as failed:",
          cleanupError
        );
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
