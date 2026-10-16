import { createClient } from "@supabase/supabase-js";
import { canViewManagementReports, normalizeAccessRole } from "../../lib/moduleAccess.js";
import {
  filterIncentiveSalesmanOptions,
  parseIncentiveMonth,
  resolveIncentiveViewerScope,
} from "../../lib/salesmanIncentive.js";
import {
  buildSalesmanIncentiveReportFromDb,
  listIncentiveSalesmen,
} from "../../lib/salesmanIncentiveServer.js";
import { getKsaDateString } from "../../lib/workdayActivity.js";
import { resolveSalesScopeForUserId } from "../user/sales-scope/route.js";

export const runtime = "nodejs";
export const maxDuration = 300;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function getAuthUser(request) {
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("No authorization header provided");
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

async function getProfile(admin, userId) {
  const { data, error } = await admin
    .from("profiles")
    .select("id,role,salesman_code,salesman_name")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("No profile found for this user");
  return data;
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return Response.json(
        { success: false, error: "Server configuration is incomplete" },
        { status: 500 },
      );
    }

    const user = await getAuthUser(request);
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const profile = await getProfile(admin, user.id);
    const url = new URL(request.url);
    const month = parseIncentiveMonth(url.searchParams.get("month"), getKsaDateString());

    // Management roles keep company-wide access. Team heads (Soyeb and other
    // reporting-chain bosses) use the same sales-scope members as Performance.
    let scope;
    try {
      const role = normalizeAccessRole(profile?.role);
      const salesScope = canViewManagementReports(role)
        ? null
        : await resolveSalesScopeForUserId(admin, user.id);
      scope = resolveIncentiveViewerScope({
        profile,
        salesScope,
        requestedCode: url.searchParams.get("salesman"),
      });
    } catch (scopeError) {
      return Response.json({ success: false, error: scopeError.message }, { status: 403 });
    }

    const [report, salesmen] = await Promise.all([
      buildSalesmanIncentiveReportFromDb(admin, {
        month,
        salesmanCodes: scope.salesmanCodes,
      }),
      scope.canSelectSalesman
        ? listIncentiveSalesmen(admin, { month }).then((options) => (
          scope.hasAllAccess
            ? options
            : filterIncentiveSalesmanOptions(options, scope.allowedCodes)
        ))
        : Promise.resolve([]),
    ]);

    return Response.json({
      success: true,
      ...report,
      salesmanOptions: salesmen,
      canViewAll: scope.canSelectSalesman,
      hasCompanyWideAccess: scope.hasAllAccess,
    });
  } catch (error) {
    console.error("Salesman incentive report error:", error);
    return Response.json(
      { success: false, error: error.message || "Unable to load the incentive report." },
      { status: 500 },
    );
  }
}
