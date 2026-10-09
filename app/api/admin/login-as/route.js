import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  canStartAdminLoginAs,
  normalizeAdminLoginAsTargets,
} from "../../../lib/adminLoginAs.js";

export const runtime = "nodejs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(payload, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function createAdminClient() {
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireAdmin(request, admin) {
  const authorization = String(request.headers.get("authorization") || "");
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return { error: json({ error: "Not authenticated" }, 401) };

  const { data: { user } = {}, error: authError } = await admin.auth.getUser(token);
  if (authError || !user) {
    return { error: json({ error: "Invalid login session" }, 401) };
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role,is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile || profile.is_active === false || !canStartAdminLoginAs(profile.role)) {
    return { error: json({ error: "Only an active admin can use this feature." }, 403) };
  }

  return { user };
}

async function listAuthUsers(admin) {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const pageUsers = data?.users || [];
    users.push(...pageUsers);
    if (pageUsers.length < 1000) return users;
  }
}

export async function GET(request) {
  const admin = createAdminClient();
  if (!admin) return json({ error: "Authentication service is unavailable." }, 503);

  try {
    const authorization = await requireAdmin(request, admin);
    if (authorization.error) return authorization.error;

    const [{ data: profiles, error: profilesError }, authUsers] = await Promise.all([
      admin
        .from("profiles")
        .select("id,salesman_code,salesman_name,role,is_active")
        .neq("id", authorization.user.id)
        .order("salesman_name"),
      listAuthUsers(admin),
    ]);

    if (profilesError) throw profilesError;
    const authUserIds = new Set(authUsers.map((user) => user.id));
    const targets = normalizeAdminLoginAsTargets(profiles)
      .filter((profile) => authUserIds.has(profile.id));

    return json({ targets });
  } catch {
    return json({ error: "Could not load users." }, 500);
  }
}

export async function POST(request) {
  const admin = createAdminClient();
  if (!admin) return json({ error: "Authentication service is unavailable." }, 503);

  try {
    const authorization = await requireAdmin(request, admin);
    if (authorization.error) return authorization.error;

    const body = await request.json().catch(() => ({}));
    const targetId = String(body?.targetId || "").trim();
    if (!targetId || targetId === authorization.user.id) {
      return json({ error: "Select another user to continue." }, 400);
    }

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id,salesman_code,salesman_name,role,is_active")
      .eq("id", targetId)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile || profile.is_active === false) {
      return json({ error: "That user is unavailable or inactive." }, 404);
    }

    const { data: authResult, error: authUserError } = await admin.auth.admin.getUserById(targetId);
    const email = String(authResult?.user?.email || "").trim();
    if (authUserError || !email) {
      return json({ error: "That user does not have a sign-in email." }, 400);
    }

    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });

    const tokenHash = String(linkData?.properties?.hashed_token || "");
    if (linkError || !tokenHash) {
      return json({ error: "Could not create a temporary sign-in." }, 500);
    }

    return json({
      tokenHash,
      verificationType: "magiclink",
      target: {
        id: profile.id,
        name: profile.salesman_name || email,
        salesmanCode: profile.salesman_code || "",
        role: profile.role || "",
      },
    });
  } catch {
    return json({ error: "Could not start the selected user session." }, 500);
  }
}