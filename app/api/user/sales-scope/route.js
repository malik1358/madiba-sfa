import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  resolvePeersUnderSameHeadUserIds,
  resolveSubordinateUserIds,
} from "../../../lib/salesHierarchy.js";
import {
  expandMutualGroupScopeIdentities,
  isSoyebProfile,
  mergeMutualGroupProfiles,
  salesmanScopeIdentities,
} from "../../../lib/mutualSalesmanGroups.js";

export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function extractEmailLocalPart(email) {
  const raw = String(email || "").trim().toLowerCase();
  if (!raw) return "";
  return raw.includes("@") ? raw.split("@")[0] : raw;
}

function normalizeLooseToken(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase();
}

function isProductPromoterRole(role) {
  const normalized = normalizeRole(role);
  return normalized === "product-promoter" || normalized === "product_promoter";
}

function isSalesTeamRole(role) {
  const normalized = normalizeRole(role);
  return ["salesman", "manager", "admin", "invoice_maker", "invoice-maker", "product-promoter", "product_promoter"].includes(normalized);
}

function profileCodeCandidates(profile) {
  return salesmanScopeIdentities(profile);
}

function authCodeCandidates(authUser) {
  const metadata = authUser?.user_metadata || authUser?.app_metadata || {};
  const localPart = extractEmailLocalPart(authUser?.email);

  return [
    normalizeCode(metadata.salesman_code),
    normalizeCode(metadata.salesman_name),
    normalizeCode(metadata.head_salesman_code),
    normalizeCode(metadata.head_salesman_name),
    normalizeCode(localPart),
    normalizeCode(localPart.replace(/[._-]+/g, " ")),
    normalizeCode(localPart.replace(/[._-]+/g, "")),
  ].filter(Boolean);
}

function fuzzyMatchedProfileCodes(allProfiles, authUser) {
  const localPart = extractEmailLocalPart(authUser?.email);
  const localToken = normalizeLooseToken(localPart);
  if (!localToken) return [];

  return allProfiles
    .filter((profile) => {
      const nameToken = normalizeLooseToken(profile?.salesman_name);
      const codeToken = normalizeLooseToken(profile?.salesman_code);
      return (
        (nameToken && (nameToken.includes(localToken) || localToken.includes(nameToken)))
        || (codeToken && (codeToken.includes(localToken) || localToken.includes(codeToken)))
      );
    })
    .flatMap((profile) => profileCodeCandidates(profile));
}

function isInvoiceMakerRole(role) {
  const normalized = String(role || "").toLowerCase();
  return normalized === "invoice_maker" || normalized === "invoice-maker";
}

export async function resolveSalesScopeForUserId(admin, userId) {
  const { data: authData, error: authError } = await admin.auth.admin.getUserById(userId);
  if (authError || !authData?.user) {
    throw new Error("User not found.");
  }

  const user = authData.user;

  const { data: currentProfile, error: profileError } = await admin
    .from("profiles")
    .select("id,role,salesman_code,salesman_name")
    .eq("id", userId)
    .single();

  if (profileError || !currentProfile) {
    throw new Error("Profile not found.");
  }

  const role = normalizeRole(currentProfile.role);
  const currentSalesmanCode = normalizeCode(currentProfile.salesman_code);

  const [profilesRes, usersRes] = await Promise.all([
    admin
      .from("profiles")
      .select("id,role,salesman_code,salesman_name")
      .order("salesman_name"),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  if (profilesRes.error) throw profilesRes.error;
  if (usersRes.error) throw usersRes.error;

  const allProfiles = profilesRes.data || [];
  const scopedProfiles = allProfiles.filter((profile) => isSalesTeamRole(profile.role));
  const authUsers = usersRes.data?.users || [];
  const authMap = new Map(authUsers.map((entry) => [entry.id, entry]));
  const currentAuthUser = authMap.get(currentProfile.id) || user;
  const currentMetadata = currentAuthUser?.user_metadata || currentAuthUser?.app_metadata || {};
  const inheritedHeadCode = normalizeCode(currentMetadata.head_salesman_code);

  let members = [];
  if (["admin", "manager"].includes(role)) {
    members = scopedProfiles;
  } else if (isProductPromoterRole(role) && inheritedHeadCode) {
    const headProfile = {
      salesman_code: inheritedHeadCode,
      salesman_name: currentMetadata.head_salesman_name || inheritedHeadCode,
    };
    const peerIds = resolvePeersUnderSameHeadUserIds(authUsers, headProfile);

    members = scopedProfiles.filter((profile) => {
      const profileCode = normalizeCode(profile.salesman_code);
      return profileCode === inheritedHeadCode || peerIds.has(profile.id);
    });
  } else {
    const subordinateIds = resolveSubordinateUserIds(authUsers, currentProfile);

    members = scopedProfiles.filter((profile) => profile.id === currentProfile.id || subordinateIds.has(profile.id));

    if (!members.some((profile) => profile.id === currentProfile.id)) {
      members = [currentProfile, ...members];
    }
  }

  members = mergeMutualGroupProfiles(members, allProfiles, currentProfile);
  const mutualGroupCodes = expandMutualGroupScopeIdentities(allProfiles, currentProfile);

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

  const visibleSalesmanCodes = [...new Set([
    ...members.flatMap((member) => profileCodeCandidates(member)),
    ...authCodeCandidates(currentAuthUser),
    ...fuzzyMatchedProfileCodes(scopedProfiles, currentAuthUser),
    ...mutualGroupCodes,
  ])];
  const visibleUserIds = isProductPromoterRole(role)
    ? [...new Set([currentProfile.id].filter(Boolean))]
    : [...new Set(visibleMembers.map((member) => member.id).filter(Boolean))];

  const hasAllAccess = ["admin", "manager"].includes(role) || isInvoiceMakerRole(role) || isSoyebProfile(currentProfile);

  return {
    success: true,
    role,
    currentUserId: currentProfile.id,
    currentSalesmanCode,
    hasAllAccess,
    mutualSalesmanCodes: mutualGroupCodes,
    visibleSalesmanCodes,
    visibleUserIds,
    visibleMembers,
    hasSubordinates: visibleMembers.some((member) => member.id !== currentProfile.id),
  };
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

    const payload = await resolveSalesScopeForUserId(admin, user.id);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || "Unable to resolve sales scope." }, { status: 500 });
  }
}