import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeName(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

const MUTUAL_SALESMAN_GROUPS = [["JUNAID", "PARVEZ"]];

function resolveMutualGroupCodes(allProfiles, currentProfile) {
  const currentName = normalizeName(currentProfile?.salesman_name);
  const matchedGroup = MUTUAL_SALESMAN_GROUPS.find((group) => group.includes(currentName));
  if (!matchedGroup) return [];

  return allProfiles
    .filter((profile) => matchedGroup.includes(normalizeName(profile.salesman_name)))
    .map((profile) => normalizeCode(profile.salesman_code))
    .filter(Boolean);
}

function latestKey(orderId) {
  return `order_history_latest:${String(orderId || "").trim()}`;
}

function historyKey(orderId, changedAt) {
  return `order_history:${String(orderId || "").trim()}:${String(changedAt || new Date().toISOString())}`;
}

function parseValue(value) {
  try {
    return JSON.parse(value || "null");
  } catch {
    return null;
  }
}

async function resolveScope(admin, token) {
  const {
    data: { user },
    error: userError,
  } = await admin.auth.getUser(token);

  if (userError || !user) {
    throw new Error("Invalid login session");
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,role,salesman_code,salesman_name")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    throw new Error("Profile not found.");
  }

  const role = String(profile.role || "").toLowerCase();
  const currentSalesmanCode = normalizeCode(profile.salesman_code);

  const [profilesRes, usersRes] = await Promise.all([
    admin
      .from("profiles")
      .select("id,role,salesman_code,salesman_name")
      .in("role", ["salesman", "manager", "admin"]),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  if (profilesRes.error) throw profilesRes.error;
  if (usersRes.error) throw usersRes.error;

  const authUsers = usersRes.data?.users || [];
  const subordinateIds = new Set();

  if (!["admin", "manager"].includes(role)) {
    authUsers.forEach((authUser) => {
      const metadata = authUser?.user_metadata || authUser?.app_metadata || {};
      if (normalizeCode(metadata.head_salesman_code) === currentSalesmanCode) {
        subordinateIds.add(authUser.id);
      }
    });
  }

  const allProfiles = profilesRes.data || [];
  const visibleProfiles = allProfiles.filter((entry) => {
    if (["admin", "manager"].includes(role)) return true;
    return entry.id === profile.id || subordinateIds.has(entry.id);
  });

  const mutualGroupCodes = resolveMutualGroupCodes(allProfiles, profile);

  return {
    userId: user.id,
    hasAllAccess: ["admin", "manager"].includes(role),
    visibleUserIds: [...new Set(visibleProfiles.map((entry) => entry.id).filter(Boolean))],
    visibleSalesmanCodes: [...new Set([
      ...visibleProfiles.map((entry) => normalizeCode(entry.salesman_code)).filter(Boolean),
      ...mutualGroupCodes,
    ])],
  };
}

async function ensureOrderVisible(admin, orderId, scope) {
  const { data: order, error } = await admin
    .from("sales_orders")
    .select("id,customer_code,created_by,salesman_code,status")
    .eq("id", orderId)
    .maybeSingle();

  if (error) throw error;
  if (!order) throw new Error("Order not found.");

  if (scope.hasAllAccess) return order;

  const createdByVisible = (scope.visibleUserIds || []).includes(order.created_by);
  const salesmanVisible = (scope.visibleSalesmanCodes || []).includes(normalizeCode(order.salesman_code));

  if (!createdByVisible && !salesmanVisible) {
    throw new Error("You do not have access to this order.");
  }

  return order;
}

async function readHistory(admin, orderId) {
  const [latestRes, historyRes] = await Promise.all([
    admin.from("system_settings").select("setting_value").eq("setting_key", latestKey(orderId)).maybeSingle(),
    admin.from("system_settings").select("setting_key,setting_value").like("setting_key", `order_history:${orderId}:%`),
  ]);

  if (latestRes.error) throw latestRes.error;
  if (historyRes.error) throw historyRes.error;

  const latest = latestRes.data?.setting_value ? parseValue(latestRes.data.setting_value) : null;
  const history = (historyRes.data || [])
    .map((row) => ({ ...parseValue(row.setting_value), historyKey: row.setting_key }))
    .filter(Boolean)
    .sort((a, b) => String(a.changedAt || "").localeCompare(String(b.changedAt || "")));

  return { latest, history };
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

    const url = new URL(request.url);
    const orderId = String(url.searchParams.get("orderId") || "").trim();
    if (!orderId) {
      return NextResponse.json({ success: false, error: "Order id is required." }, { status: 400 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const scope = await resolveScope(admin, authHeader.replace("Bearer ", ""));
    await ensureOrderVisible(admin, orderId, scope);

    const { latest, history } = await readHistory(admin, orderId);
    return NextResponse.json({ success: true, orderId, latest, history });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || "Unable to load order history." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const orderId = String(body?.orderId || "").trim();
    if (!orderId) {
      return NextResponse.json({ success: false, error: "Order id is required." }, { status: 400 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const scope = await resolveScope(admin, authHeader.replace("Bearer ", ""));
    const order = await ensureOrderVisible(admin, orderId, scope);

    const entry = {
      orderId,
      customerCode: order.customer_code || "",
      action: String(body?.action || "UPDATED_ORDER").trim() || "UPDATED_ORDER",
      previousStatus: String(body?.previousStatus || order.status || "").trim(),
      nextStatus: String(body?.nextStatus || order.status || "").trim(),
      changes: Array.isArray(body?.changes) ? body.changes : [],
      changedAt: String(body?.changedAt || new Date().toISOString()),
      changedBy: scope.userId,
    };

    const latestPayload = {
      setting_key: latestKey(orderId),
      setting_value: JSON.stringify(entry),
    };

    const historyPayload = {
      setting_key: historyKey(orderId, entry.changedAt),
      setting_value: JSON.stringify(entry),
    };

    const { error: latestError } = await admin.from("system_settings").upsert(latestPayload, { onConflict: "setting_key" });
    if (latestError) throw latestError;

    const { error: historyError } = await admin.from("system_settings").upsert(historyPayload, { onConflict: "setting_key" });
    if (historyError) throw historyError;

    const { latest, history } = await readHistory(admin, orderId);
    return NextResponse.json({ success: true, orderId, latest, history });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || "Unable to save order history." }, { status: 500 });
  }
}