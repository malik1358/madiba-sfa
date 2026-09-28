import { createClient } from "@supabase/supabase-js";
import { normalizeAccessRole } from "../../lib/moduleAccess.js";
import { normalizeSalesmanCode } from "../../lib/performanceKpis.js";
import { parseIncentiveMonth } from "../../lib/salesmanIncentive.js";
import {
  buildSalesmanIncentiveReportFromDb,
  listIncentiveSalesmen,
} from "../../lib/salesmanIncentiveServer.js";
import { getKsaDateString } from "../../lib/workdayActivity.js";

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

/** Admins and managers see every salesman. A salesman sees only their own scheme. */
function resolveIncentiveScope(profile, requestedCode) {
  const role = normalizeAccessRole(profile?.role);
  const ownCode = normalizeSalesmanCode(profile?.salesman_code);
  const requested = normalizeSalesmanCode(requestedCode);

  if (role === "admin" || role === "manager") {
    return { hasAllAccess: true, salesmanCodes: requested ? [requested] : [] };
  }
  if (role === "salesman" && ownCode) {
    if (requested && requested !== ownCode) {
      throw new Error("You can only view your own incentive.");
    }
    return { hasAllAccess: false, salesmanCodes: [ownCode] };
  }
  throw new Error("You do not have access to this report.");
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

    let scope;
    try {
      scope = resolveIncentiveScope(profile, url.searchParams.get("salesman"));
    } catch (scopeError) {
      return Response.json({ success: false, error: scopeError.message }, { status: 403 });
    }

    const [report, salesmen] = await Promise.all([
      buildSalesmanIncentiveReportFromDb(admin, {
        month,
        salesmanCodes: scope.salesmanCodes,
      }),
      scope.hasAllAccess ? listIncentiveSalesmen(admin, { month }) : Promise.resolve([]),
    ]);

    return Response.json({
      success: true,
      ...report,
      salesmanOptions: salesmen,
      canViewAll: scope.hasAllAccess,
    });
  } catch (error) {
    console.error("Salesman incentive report error:", error);
    return Response.json(
      { success: false, error: error.message || "Unable to load the incentive report." },
      { status: 500 },
    );
  }
}
