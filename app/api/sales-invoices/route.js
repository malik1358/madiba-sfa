import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCollectionOnlyAccess } from "../../lib/moduleAccess.js";
import { mergeSalesSnapshots } from "../../lib/salesHistory.js";
import {
  groupSalesRowsIntoInvoices,
  resolveInvoiceSalesmanCodes,
  resolveSalesInvoiceDateRange,
  summarizeSalesInvoices,
} from "../../lib/salesInvoices.js";
import { getKsaDateString } from "../../lib/workdayActivity.js";
import { resolveSalesScopeForUserId } from "../user/sales-scope/route.js";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SALES_SELECT = "id,import_batch_id,transaction_date,voucher_number,reference,customer_code,customer_name,salesman_code,salesman_name,item_code,item_name,category,quantity,rate,sales_amount";

function isMissingTableError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42P01"
    || message.includes("could not find the table")
    || (message.includes("relation") && message.includes("does not exist"));
}

function chunkList(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function fetchSalesRowsFromTable(admin, table, { from, to, salesmanCodes }) {
  const pageSize = 1000;
  const codeChunks = salesmanCodes == null ? [null] : chunkList(salesmanCodes, 200);
  const rows = [];

  for (const codeChunk of codeChunks) {
    let offset = 0;
    while (true) {
      let query = admin
        .from(table)
        .select(SALES_SELECT)
        .gte("transaction_date", from)
        .lte("transaction_date", to)
        .order("id", { ascending: true })
        .range(offset, offset + pageSize - 1);

      if (codeChunk) {
        query = query.in("salesman_code", codeChunk);
      }

      const { data, error } = await query;
      if (error) throw error;

      const page = data || [];
      rows.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }
  }

  return rows;
}

async function fetchSalesRows(admin, options) {
  try {
    return await fetchSalesRowsFromTable(admin, "active_sales", options);
  } catch (error) {
    if (!isMissingTableError(error)) throw error;
    return mergeSalesSnapshots(await fetchSalesRowsFromTable(admin, "sales_raw", options));
  }
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userError,
    } = await admin.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json({ success: false, error: "Invalid login session" }, { status: 401 });
    }

    const scope = await resolveSalesScopeForUserId(admin, user.id);
    if (isCollectionOnlyAccess({ role: scope.role, salesmanCode: scope.currentSalesmanCode })) {
      return NextResponse.json({ success: false, error: "Sales invoices are not available for collectors." }, { status: 403 });
    }

    const url = new URL(request.url);
    const range = resolveSalesInvoiceDateRange({
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
      todayIso: getKsaDateString(),
    });
    const salesmanCodes = resolveInvoiceSalesmanCodes(scope, url.searchParams.get("salesmanCode"));

    const salesmen = [...new Map(
      (scope.visibleMembers || [])
        .map((member) => {
          const code = String(member?.salesman_code || "").trim().toUpperCase();
          if (!code) return null;
          return [code, {
            salesman_code: code,
            salesman_name: String(member?.salesman_name || "").trim() || code,
          }];
        })
        .filter(Boolean),
    ).values()].sort((a, b) => a.salesman_name.localeCompare(b.salesman_name));

    if (Array.isArray(salesmanCodes) && salesmanCodes.length === 0) {
      return NextResponse.json({
        success: true,
        from: range.from,
        to: range.to,
        invoices: [],
        summary: summarizeSalesInvoices([]),
        salesmen,
        currentSalesmanCode: scope.currentSalesmanCode || "",
      });
    }

    const invoices = groupSalesRowsIntoInvoices(await fetchSalesRows(admin, {
      from: range.from,
      to: range.to,
      salesmanCodes,
    }));

    return NextResponse.json({
      success: true,
      from: range.from,
      to: range.to,
      invoices,
      summary: summarizeSalesInvoices(invoices),
      salesmen,
      currentSalesmanCode: scope.currentSalesmanCode || "",
    });
  } catch (error) {
    const message = String(error?.message || "Unable to load sales invoices.");
    const status = message.includes("do not have access") ? 403
      : message.includes("Date range") || message.includes("Invalid") ? 400
      : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
