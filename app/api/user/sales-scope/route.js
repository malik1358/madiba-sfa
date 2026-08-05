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

const MUTUAL_SALESMAN_GROUPS = [["JUNAID", "PARVEZ", "SOYEB"]];

function resolveMutualGroupCodes(allProfiles, currentProfile) {
  const currentName = normalizeName(currentProfile?.salesman_name);
  const matchedGroup = MUTUAL_SALESMAN_GROUPS.find((group) => group.includes(currentName));
  if (!matchedGroup) return [];

  return allProfiles
    .filter((profile) => matchedGroup.includes(normalizeName(profile.salesman_name)))
    .map((profile) => normalizeCode(profile.salesman_code))
    .filter(Boolean);
}

function isInvoiceMakerRole(role) {
  const normalized = String(role || "").toLowerCase();
  return normalized === "invoice_maker" || normalized === "invoice-maker";
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

    const { data: currentProfile, error: profileError } = await admin
      .from("profiles")
      .select("id,role,salesman_code,salesman_name")
      .eq("id", user.id)
      .single();

    if (profileError || !currentProfile) {
      return NextResponse.json({ success: false, error: "Profile not found." }, { status: 404 });
    }

    const role = String(currentProfile.role || "").toLowerCase();
    const currentSalesmanCode = normalizeCode(currentProfile.salesman_code);

    const [profilesRes, usersRes] = await Promise.all([
      admin
        .from("profiles")
        .select("id,role,salesman_code,salesman_name")
        .in("role", ["salesman", "manager", "admin"])
        .order("salesman_name"),
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);

    if (profilesRes.error) throw profilesRes.error;
    if (usersRes.error) throw usersRes.error;

    const allProfiles = profilesRes.data || [];
    const authUsers = usersRes.data?.users || [];
    const authMap = new Map(authUsers.map((entry) => [entry.id, entry]));

    let members = [];
    if (["admin", "manager"].includes(role)) {
      members = allProfiles;
    } else {
      const subordinateIds = new Set();

      authUsers.forEach((authUser) => {
        const metadata = authUser?.user_metadata || authUser?.app_metadata || {};
        const headCode = normalizeCode(metadata.head_salesman_code);
        if (headCode && headCode === currentSalesmanCode) {
          subordinateIds.add(authUser.id);
        }
      });

      members = allProfiles.filter((profile) => profile.id === currentProfile.id || subordinateIds.has(profile.id));
    }

    const visibleMembers = members.map((profile) => {
      const authUser = authMap.get(profile.id);
      return {
        id: profile.id,
        role: profile.role || "",
        salesman_code: profile.salesman_code || "",
        salesman_name: profile.salesman_name || "",
        email: authUser?.email || "",
      };
    });

    const mutualGroupCodes = resolveMutualGroupCodes(allProfiles, currentProfile);
    const visibleSalesmanCodes = [...new Set([
      ...visibleMembers.map((member) => normalizeCode(member.salesman_code)).filter(Boolean),
      ...mutualGroupCodes,
    ])];
    const visibleUserIds = [...new Set(visibleMembers.map((member) => member.id).filter(Boolean))];

    const hasAllAccess = ["admin", "manager"].includes(role) || isInvoiceMakerRole(role);

    return NextResponse.json({
      success: true,
      role,
      currentUserId: currentProfile.id,
      currentSalesmanCode,
      hasAllAccess,
      visibleSalesmanCodes,
      visibleUserIds,
      visibleMembers,
      hasSubordinates: visibleMembers.some((member) => member.id !== currentProfile.id),
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || "Unable to resolve sales scope." }, { status: 500 });
  }
}