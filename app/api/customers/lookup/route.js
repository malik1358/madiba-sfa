import { createClient } from "@supabase/supabase-js";
import { ensureCustomerVisibleToScope, withSalesScopeMatchers } from "../../../lib/customerAccess.js";
import { resolveCustomerMasterExportFields } from "../../../lib/customerCode.js";
import { findCustomersByMobile, isValidKsaMobile, normalizeKsaMobile } from "../../../lib/customerContact.js";
import { resolveSalesScopeForUserId } from "../../user/sales-scope/route.js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

async function getAuthUser(request) {
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("Not authenticated");
  }

  const token = authHeader.slice(7);
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Unable to verify user session");
  return user;
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return Response.json({ success: false, error: "Server configuration is incomplete" }, { status: 500 });
    }

    const url = new URL(request.url);
    const customerCode = normalizeCode(url.searchParams.get("code") || url.searchParams.get("customerCode") || "");
    const mobile = normalizeKsaMobile(url.searchParams.get("mobile") || "");

    if (!customerCode && !isValidKsaMobile(mobile)) {
      return Response.json({ success: false, error: "Customer code or mobile is required" }, { status: 400 });
    }

    const user = await getAuthUser(request);
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (isValidKsaMobile(mobile) && !customerCode) {
      const matches = await findCustomersByMobile(admin, mobile);
      return Response.json({
        success: true,
        customers: matches.map((row) => {
          const display = resolveCustomerMasterExportFields(row);
          return {
            customer_code: display.customer_code || row.customer_code,
            customer_name: display.customer_name || row.customer_name,
            current_salesman_code: row.current_salesman_code || "",
            mobile: normalizeKsaMobile(row.mobile) || row.mobile,
          };
        }),
      });
    }

    const payload = await resolveSalesScopeForUserId(admin, user.id);
    const scope = withSalesScopeMatchers({
      hasAllAccess: payload.hasAllAccess,
      visibleSalesmanCodes: payload.visibleSalesmanCodes || [],
      visibleMembers: payload.visibleMembers || [],
    });

    const customer = await ensureCustomerVisibleToScope(admin, customerCode, scope);
    const display = resolveCustomerMasterExportFields(customer);

    return Response.json({
      success: true,
      customer: {
        ...customer,
        customer_code: display.customer_code || customer.customer_code,
        customer_name: display.customer_name || customer.customer_name,
      },
    });
  } catch (error) {
    const message = error.message || "Unable to find customer.";
    const status = message === "Customer not found." || message === "You do not have access to this customer."
      ? 404
      : 400;
    return Response.json({ success: false, error: message }, { status });
  }
}
