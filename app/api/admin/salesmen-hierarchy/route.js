import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function defaultPasswordFor(code) {
  return `MADIBA-${normalizeCode(code)}@123`;
}

async function requireManagementAccess(admin, request) {
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

  if (profileError || !profile || !["admin", "manager"].includes(String(profile.role || "").toLowerCase())) {
    return { error: NextResponse.json({ success: false, error: "Only management can access salesman hierarchy." }, { status: 403 }) };
  }

  return { user };
}

async function loadSalesmen(admin) {
  const [profilesRes, usersRes] = await Promise.all([
    admin
      .from("profiles")
      .select("id,salesman_code,salesman_name,role")
      .in("role", ["salesman", "manager", "admin"])
      .order("salesman_name"),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  if (profilesRes.error) throw profilesRes.error;
  if (usersRes.error) throw usersRes.error;

  const authUsers = usersRes.data?.users || [];
  const authMap = new Map(authUsers.map((user) => [user.id, user]));

  return (profilesRes.data || []).map((profile) => {
    const authUser = authMap.get(profile.id);
    const metadata = authUser?.user_metadata || authUser?.app_metadata || {};

    return {
      id: profile.id,
      salesman_code: profile.salesman_code || "",
      salesman_name: profile.salesman_name || "",
      role: profile.role || "",
      email: authUser?.email || "",
      head_salesman_code: metadata.head_salesman_code || "",
      head_salesman_name: metadata.head_salesman_name || "",
      default_password: defaultPasswordFor(profile.salesman_code || profile.id),
    };
  });
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const access = await requireManagementAccess(admin, request);
    if (access.error) return access.error;

    const salesmen = await loadSalesmen(admin);

    return NextResponse.json({
      success: true,
      salesmen,
      headOptions: salesmen.map((salesman) => ({
        id: salesman.id,
        salesman_code: salesman.salesman_code,
        salesman_name: salesman.salesman_name,
      })),
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || "Unable to load salesman hierarchy." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const access = await requireManagementAccess(admin, request);
    if (access.error) return access.error;

    const body = await request.json();
    const mode = String(body?.mode || "").trim();

    if (mode === "assign-head") {
      const salesmanId = String(body?.salesmanId || "").trim();
      const headSalesmanCode = normalizeCode(body?.headSalesmanCode || "");

      if (!salesmanId) {
        return NextResponse.json({ success: false, error: "Missing salesman id." }, { status: 400 });
      }

      const { data: salesmen, error: salesmenError } = await admin
        .from("profiles")
        .select("id,salesman_code,salesman_name")
        .eq("id", salesmanId)
        .single();

      if (salesmenError) throw salesmenError;

      let headSalesmanName = "";
      if (headSalesmanCode) {
        const { data: headSalesman, error: headError } = await admin
          .from("profiles")
          .select("salesman_name,salesman_code")
          .eq("salesman_code", headSalesmanCode)
          .maybeSingle();

        if (headError) throw headError;
        if (!headSalesman) {
          return NextResponse.json({ success: false, error: "Head salesman not found." }, { status: 404 });
        }

        headSalesmanName = headSalesman.salesman_name || "";
      }

      const { error: updateError } = await admin.auth.admin.updateUserById(salesmen.id, {
        user_metadata: {
          head_salesman_code: headSalesmanCode || null,
          head_salesman_name: headSalesmanName || null,
        },
      });

      if (updateError) throw updateError;

      return NextResponse.json({
        success: true,
        message: `Assigned ${salesmen.salesman_name || salesmen.salesman_code || salesmanId} to ${headSalesmanCode || "no head"}.`,
      });
    }

    if (mode === "reset-password") {
      const salesmanId = String(body?.salesmanId || "").trim();
      const password = String(body?.password || "").trim();

      if (!salesmanId || !password) {
        return NextResponse.json({ success: false, error: "Missing salesman id or password." }, { status: 400 });
      }

      const { data: salesmen, error: salesmenError } = await admin
        .from("profiles")
        .select("id,salesman_code,salesman_name")
        .eq("id", salesmanId)
        .single();

      if (salesmenError) throw salesmenError;

      const { error: updateError } = await admin.auth.admin.updateUserById(salesmen.id, {
        password,
      });

      if (updateError) throw updateError;

      return NextResponse.json({
        success: true,
        message: `Password reset for ${salesmen.salesman_name || salesmen.salesman_code || salesmanId}.`,
        password,
      });
    }

    if (mode === "reset-all-passwords") {
      const salesmen = await loadSalesmen(admin);

      const results = [];
      for (const salesman of salesmen) {
        const { error: updateError } = await admin.auth.admin.updateUserById(salesman.id, {
          password: salesman.default_password,
        });

        if (updateError) {
          results.push({ salesmanId: salesman.id, success: false, error: updateError.message });
          continue;
        }

        results.push({ salesmanId: salesman.id, success: true, password: salesman.default_password });
      }

      return NextResponse.json({
        success: true,
        message: "Default passwords reset for all salesmen.",
        results,
      });
    }

    return NextResponse.json({ success: false, error: "Unsupported action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || "Unable to update salesman hierarchy." }, { status: 500 });
  }
}