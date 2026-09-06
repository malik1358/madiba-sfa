import {
  buildSalesmanScopeMatchers,
  normalizeSalesmanCode,
  normalizeSalesmanName,
  salesmanValueMatchesScope,
} from "./mutualSalesmanGroups.js";
import { isMissingSchemaColumn } from "./performanceKpis.js";

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function profileIdentityCandidates(profile) {
  return [...new Set([
    normalizeSalesmanCode(profile?.salesman_code),
    normalizeSalesmanName(profile?.salesman_name),
    normalizeCode(profile?.salesman_code),
    normalizeCode(profile?.salesman_name),
  ].filter(Boolean))];
}

export function headSalesmanMetadataMatchesLeader(metadata, leaderProfile) {
  const headCode = normalizeCode(metadata?.head_salesman_code);
  const headName = normalizeCode(metadata?.head_salesman_name);
  if (!headCode && !headName) return false;

  const leaderKeys = new Set(profileIdentityCandidates(leaderProfile));
  if (headCode && leaderKeys.has(headCode)) return true;
  if (headName && leaderKeys.has(headName)) return true;

  const matchers = buildSalesmanScopeMatchers([leaderProfile]);
  if (headCode && salesmanValueMatchesScope(headCode, matchers)) return true;
  if (headName && salesmanValueMatchesScope(headName, matchers)) return true;

  return false;
}

export function resolveSubordinateUserIds(authUsers, leaderProfile) {
  const subordinateIds = new Set();

  (authUsers || []).forEach((authUser) => {
    const metadata = authUser?.user_metadata || authUser?.app_metadata || {};
    if (headSalesmanMetadataMatchesLeader(metadata, leaderProfile)) {
      subordinateIds.add(authUser.id);
    }
  });

  return subordinateIds;
}

export function findHeadProfile(metadata, profiles = [], seenIds = new Set()) {
  const candidates = (profiles || []).filter((profile) => (
    profile?.id
    && !seenIds.has(profile.id)
    && headSalesmanMetadataMatchesLeader(metadata, profile)
  ));
  if (!candidates.length) return null;

  const headCode = normalizeCode(metadata?.head_salesman_code);
  return candidates.find((profile) => normalizeCode(profile.salesman_code) === headCode)
    || candidates[0];
}

export function resolveReportingChainFromAuth({
  actorUserId,
  profiles = [],
  authUsers = [],
} = {}) {
  const authById = new Map((authUsers || []).map((entry) => [entry.id, entry]));
  const chain = [];
  const seen = new Set([String(actorUserId || "").trim()].filter(Boolean));
  let currentAuth = authById.get(actorUserId);

  while (currentAuth) {
    const metadata = currentAuth.user_metadata || currentAuth.app_metadata || {};
    const head = findHeadProfile(metadata, profiles, seen);
    if (!head) break;
    seen.add(head.id);
    chain.push(head);
    currentAuth = authById.get(head.id);
  }

  return chain;
}

export function resolvePeersUnderSameHeadUserIds(authUsers, headProfile) {
  const peerIds = new Set();

  (authUsers || []).forEach((authUser) => {
    const metadata = authUser?.user_metadata || authUser?.app_metadata || {};
    if (headSalesmanMetadataMatchesLeader(metadata, headProfile)) {
      peerIds.add(authUser.id);
    }
  });

  return peerIds;
}

export async function resolveReportingChain(admin, actorUserId) {
  const usersRes = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersRes.error) throw usersRes.error;

  const full = "id,salesman_code,salesman_name,role,email,report_email";
  const fallback = "id,salesman_code,salesman_name,role";
  let profilesRes = await admin.from("profiles").select(full).order("salesman_name");
  if (profilesRes.error && isMissingSchemaColumn(profilesRes.error)) {
    profilesRes = await admin.from("profiles").select(fallback).order("salesman_name");
  }
  if (profilesRes.error) throw profilesRes.error;

  return resolveReportingChainFromAuth({
    actorUserId,
    profiles: profilesRes.data || [],
    authUsers: usersRes.data?.users || [],
  }).map((head) => ({
    id: head.id,
    salesman_code: head.salesman_code || "",
    salesman_name: head.salesman_name || "",
    role: head.role || "",
    email: head.email || "",
    report_email: head.report_email || "",
  }));
}

export function customerSalesmanAssignmentMatchesScope(customerSalesmanCode, scope) {
  const assigned = normalizeCode(customerSalesmanCode);
  if (!assigned) return false;

  if ((scope?.visibleSalesmanCodes || []).some((code) => normalizeCode(code) === assigned)) {
    return true;
  }

  if (scope?.scopeMatchers && salesmanValueMatchesScope(assigned, scope.scopeMatchers)) {
    return true;
  }

  return false;
}
