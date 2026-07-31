import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function clean(value) {
  if (value === undefined || value === null) return null;
  const v = String(value).trim();
  return v === "" ? null : v;
}

function number(value) {
  if (value === undefined || value === null || value === "") return 0;

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

    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(
      d.d
    ).padStart(2, "0")}`;
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

    if (match) return row[match];
  }

  return null;
}

export async function POST(request) {
  let batchId = null;

  try {
    if (!supabaseUrl || !serviceKey) {
      throw new Error("Server configuration is incomplete.");
    }

    // --------------------------------------------------------
    // 1. VERIFY LOGGED-IN USER
    // --------------------------------------------------------

    const authHeader = request.headers.get("authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    const token = authHeader.replace("Bearer ", "");

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const {
      data: { user },
      error: userError,
    } = await admin.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json(
        { error: "Invalid login session" },
        { status: 401 }
      );
    }

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (
      profileError ||
      !profile ||
      !["admin", "manager"].includes(profile.role)
    ) {
      return NextResponse.json(
        { error: "Only management can upload sales data." },
        { status: 403 }
      );
    }

    // --------------------------------------------------------
    // 2. RECEIVE EXCEL FILE
    // --------------------------------------------------------

    const formData = await request.formData();
    const file = formData.get("file");

    if (!file) {
      return NextResponse.json(
        { error: "No Excel file received." },
        { status: 400 }
      );
    }

    const fileName = file.name || "sales-data.xlsx";

    if (
      !fileName.toLowerCase().endsWith(".xlsx") &&
      !fileName.toLowerCase().endsWith(".xls")
    ) {
      return NextResponse.json(
        { error: "Please upload an Excel file." },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();

    const workbook = XLSX.read(bytes, {
      type: "array",
      cellDates: true,
    });

    if (!workbook.SheetNames.length) {
      throw new Error("Excel workbook contains no sheets.");
    }

    // We use first worksheet.
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    const rows = XLSX.utils.sheet_to_json(worksheet, {
      defval: null,
      raw: true,
    });

    if (!rows.length) {
      throw new Error("Excel sheet contains no data.");
    }

    // --------------------------------------------------------
    // 3. MAP YOUR RAW EXCEL
    // --------------------------------------------------------

    const mappedRows = rows
      .map((row, index) => {
        const transactionDate = excelDate(
          findValue(row, [
            "Date",
            "Transaction Date",
            "Voucher Date",
          ])
        );

        const customerCode = clean(
          findValue(row, [
            "Customer Code",
            "CustomerCode",
            "Party Code",
          ])
        );

        const customerName = clean(
          findValue(row, [
            "Customer Name",
            "Customer",
            "Party Name",
          ])
        );

        const salesmanCode = clean(
          findValue(row, [
            "Salesman Code",
            "SalesmanCode",
            "Sales Person Code",
          ])
        );

        const salesmanName = clean(
          findValue(row, [
            "Salesman Name",
            "Salesman",
            "Sales Person",
          ])
        );

        const itemCode = clean(
          findValue(row, [
            "Item Code",
            "ItemCode",
            "Product Code",
          ])
        );

        const itemName = clean(
          findValue(row, [
            "Item Name",
            "Item",
            "Product Name",
          ])
        );

        const category = clean(
          findValue(row, [
            "Category",
            "Item Category",
            "Group",
          ])
        );

        const marginPercentRaw = findValue(row, [
          "Margin %",
          "Margin%",
          "Margin Percent",
          "GP %",
          "GP%",
        ]);

        let marginPercent = number(marginPercentRaw);

        // Excel percentage may arrive as 0.18 instead of 18.
        if (
          marginPercent !== 0 &&
          Math.abs(marginPercent) <= 1
        ) {
          marginPercent = marginPercent * 100;
        }

        return {
          import_batch_id: null,

          source_row_number: index + 2,

          reference: clean(
            findValue(row, [
              "Reference",
              "Ref",
              "Reference Number",
            ])
          ),

          voucher_number: clean(
            findValue(row, [
              "Voucher Number",
              "Voucher No",
              "Voucher No.",
            ])
          ),

          voucher_type: clean(
            findValue(row, [
              "Voucher Type",
              "Type",
            ])
          ),

          transaction_date: transactionDate,

          customer_code: customerCode,
          customer_name: customerName,

          salesman_code: salesmanCode,
          salesman_name: salesmanName,

          item_code: itemCode,
          item_name: itemName,
          category,

          local_import: clean(
            findValue(row, [
              "Local/Import",
              "Local / Import",
              "Local Import",
              "Import/Local",
            ])
          ),

          quantity: number(
            findValue(row, [
              "Quantity",
              "Qty",
            ])
          ),

          rate: number(
            findValue(row, [
              "Rate",
              "Price",
              "Unit Price",
            ])
          ),

          sales_amount: number(
            findValue(row, [
              "Sales Amount",
              "Sales",
              "Amount",
              "Net Sales",
            ])
          ),

          margin: number(
            findValue(row, [
              "Margin",
              "GP",
              "Gross Profit",
            ])
          ),

          margin_percent: marginPercent,

          first_purchase_date: excelDate(
            findValue(row, [
              "First Purchase Date",
              "First Purchase",
            ])
          ),

          abc_class: clean(
            findValue(row, [
              "ABC",
              "ABC Class",
              "ABC Classification",
              "Class",
            ])
          ),

          // Preserve original row.
          source_data: row,
        };
      })
      .filter((row) => {
        return (
          row.customer_code ||
          row.customer_name ||
          row.item_code ||
          row.sales_amount !== 0
        );
      });

    if (!mappedRows.length) {
      throw new Error(
        "No valid sales rows were detected in the Excel file."
      );
    }

    // --------------------------------------------------------
    // 4. VALIDATE BASIC DATA QUALITY
    // --------------------------------------------------------

    const validTransactionRows = mappedRows.filter(
      (r) =>
        r.transaction_date &&
        (r.customer_code || r.customer_name) &&
        (r.item_code || r.item_name)
    );

    if (validTransactionRows.length < mappedRows.length * 0.8) {
      throw new Error(
        "Too many rows are missing Date, Customer or Item information. Import cancelled."
      );
    }

    // --------------------------------------------------------
    // 5. CREATE IMPORT BATCH
    // --------------------------------------------------------

    const { data: batch, error: batchError } = await admin
      .from("import_batches")
      .insert({
        file_name: fileName,
        uploaded_by: user.id,
        status: "PROCESSING",
        total_rows: mappedRows.length,
      })
      .select("id")
      .single();

    if (batchError) throw batchError;

    batchId = batch.id;

    for (const row of mappedRows) {
      row.import_batch_id = batchId;
    }

    // --------------------------------------------------------
    // 6. UPLOAD IN CHUNKS
    // --------------------------------------------------------

    const CHUNK_SIZE = 500;

    for (
      let i = 0;
      i < mappedRows.length;
      i += CHUNK_SIZE
    ) {
      const chunk = mappedRows.slice(
        i,
        i + CHUNK_SIZE
      );

      const { error: insertError } = await admin
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

    // --------------------------------------------------------
    // 7. CALCULATE IMPORT STATISTICS
    // --------------------------------------------------------

    const customers = new Set();
    const items = new Set();
    const salesmen = new Set();
    const dates = [];

    for (const row of mappedRows) {
      if (row.customer_code)
        customers.add(row.customer_code);

      if (row.item_code)
        items.add(row.item_code);

      if (row.salesman_code)
        salesmen.add(row.salesman_code);

      if (row.transaction_date)
        dates.push(row.transaction_date);
    }

    dates.sort();

    const minDate = dates.length
      ? dates[0]
      : null;

    const maxDate = dates.length
      ? dates[dates.length - 1]
      : null;

    // --------------------------------------------------------
    // 8. UPDATE CUSTOMER MASTER
    //
    // Last transaction determines salesman ownership.
    // --------------------------------------------------------

    const latestCustomer = new Map();

    for (const row of mappedRows) {
      if (!row.customer_code) continue;

      const existing = latestCustomer.get(
        row.customer_code
      );

      if (
        !existing ||
        (row.transaction_date &&
          (!existing.transaction_date ||
            row.transaction_date >
              existing.transaction_date)) ||
        (
          row.transaction_date &&
          existing.transaction_date &&
          row.transaction_date ===
            existing.transaction_date &&
          row.source_row_number >
            existing.source_row_number
        )
      ) {
        latestCustomer.set(
          row.customer_code,
          row
        );
      }
    }

    const customerUpserts = [];

    for (const [customerCode, row] of latestCustomer) {
      customerUpserts.push({
        customer_code: customerCode,
        customer_name:
          row.customer_name || customerCode,

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
      i < customerUpserts.length;
      i += CUSTOMER_CHUNK
    ) {
      const chunk = customerUpserts.slice(
        i,
        i + CUSTOMER_CHUNK
      );

      const { error: customerError } =
        await admin
          .from("customers")
          .upsert(chunk, {
            onConflict: "customer_code",
          });

      if (customerError) {
        throw new Error(
          `Customer update failed: ${customerError.message}`
        );
      }
    }

    // --------------------------------------------------------
    // 9. FINALISE BATCH STATISTICS
    // --------------------------------------------------------

    const { error: statsError } = await admin
      .from("import_batches")
      .update({
        total_rows: mappedRows.length,
        customer_count: customers.size,
        item_count: items.size,
        salesman_count: salesmen.size,
        min_transaction_date: minDate,
        max_transaction_date: maxDate,
      })
      .eq("id", batchId);

    if (statsError) throw statsError;

    // --------------------------------------------------------
    // 10. ACTIVATE NEW SNAPSHOT
    // --------------------------------------------------------

    const { error: activateError } =
      await admin.rpc(
        "activate_sales_batch",
        {
          p_batch_id: batchId,
        }
      );

    if (activateError) throw activateError;

    // --------------------------------------------------------
    // SUCCESS
    // --------------------------------------------------------

    return NextResponse.json({
      success: true,

      batchId,

      fileName,

      rows: mappedRows.length,

      customers: customers.size,
      items: items.size,
      salesmen: salesmen.size,

      minDate,
      maxDate,

      message:
        "Sales data replaced successfully.",
    });

  } catch (error) {
    console.error("IMPORT ERROR:", error);

    // Mark incomplete batch FAILED.
    if (batchId && supabaseUrl && serviceKey) {
      try {
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

        await admin
          .from("import_batches")
          .update({
            status: "FAILED",
            error_message:
              error?.message ||
              "Unknown import error",
            completed_at:
              new Date().toISOString(),
          })
          .eq("id", batchId);

      } catch (cleanupError) {
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
      { status: 500 }
    );
  }
}
