import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import {
  applyCustomerLocationUpdates,
  parseLocationSpreadsheetRow,
  planCustomerLocationUpdates,
} from "../../../../lib/customerLocationImport.js";

export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function requireAdminAccess(admin, request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 }) };
  }

  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: userError } = await admin.auth.getUser(token);
  if (userError || !user) {
    return { error: NextResponse.json({ success: false, error: "Invalid login session" }, { status: 401 }) };
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const role = String(profile?.role || "").toLowerCase();
  if (profileError || !profile || !["admin", "manager"].includes(role)) {
    return { error: NextResponse.json({ success: false, error: "Only admin or manager can import customer locations." }, { status: 403 }) };
  }

  return { user, role };
}

async function fetchAllCustomers(admin) {
  const pageSize = 1000;
  let from = 0;
  const rows = [];

  while (true) {
    const { data, error } = await admin
      .from("customers")
      .select("customer_code,customer_name,latitude,longitude")
      .range(from, from + pageSize - 1);

    if (error) throw error;
    if (!Array.isArray(data) || data.length === 0) break;

    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

export async function POST(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete" }, { status: 500 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const access = await requireAdminAccess(admin, request);
    if (access.error) return access.error;

    const contentType = String(request.headers.get("content-type") || "").toLowerCase();
    let parsedRows = [];

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!file || typeof file.arrayBuffer !== "function") {
        throw new Error("Upload an Excel file with Party Name, Lattitude, and Longitutde columns.");
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      parsedRows = rawRows.map(parseLocationSpreadsheetRow);
    } else {
      const body = await request.json();
      const rows = Array.isArray(body.rows) ? body.rows : [];
      parsedRows = rows.map(parseLocationSpreadsheetRow);
    }

    if (parsedRows.length === 0) {
      throw new Error("No location rows found in upload.");
    }

    const customers = await fetchAllCustomers(admin);
    const plan = planCustomerLocationUpdates(parsedRows, customers);
    const result = await applyCustomerLocationUpdates(admin, plan.updates);

    return NextResponse.json({
      success: true,
      summary: {
        sourceRows: parsedRows.length,
        matched: plan.updates.length,
        updated: result.updated,
        skippedInvalid: plan.skipped.length,
        notFound: plan.notFound.length,
        failures: result.failures.length,
      },
      notFound: plan.notFound.slice(0, 50).map((row) => row.party_name),
      failures: result.failures.slice(0, 20),
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Unable to import customer locations." },
      { status: 400 },
    );
  }
}
