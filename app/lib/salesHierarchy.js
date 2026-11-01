import {
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

function identityTokens(value) {
  return [...new Set(
    normalizeCode(value)
      .replace(/[^A-Z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter((token) => token.length >= 3),
  )];
}

function looseIdentity(value) {
  return normalizeCode(value)
    .replace(/[^A-Z]/g, "")
    .replace(/[AEIOU]/g, "")
    .replace(/(.)\1+/g, "$1");
}

/**
 * Head metadata must identify this leader — not merely share a first name.
 * "NABIL" may abbreviate "AHMED NABIL"; "ASRAR AHMED" must not.
 */
function headValueMatchesLeader(headValue, leaderProfile) {
  const head = normalizeCode(headValue);
  if (!head || !leaderProfile) return false;

  const leaderKeys = new Set(profileIdentityCandidates(leaderProfile));
  if (leaderKeys.has(head)) return true;

  const leaderBlob = [leaderProfile.salesman_name, leaderProfile.salesman_code]
    .map((part) => normalizeCode(part))
    .filter(Boolean)
    .join(" ");
  const headTokens = identityTokens(head);
  const leaderTokens = identityTokens(leaderBlob);
  if (!headTokens.length || !leaderTokens.length) return false;

  const headLoose = looseIdentity(head);
  const leaderLooses = [...leaderKeys].map(looseIdentity).filter(Boolean);
  if (headLoose && leaderLooses.includes(headLoose)) return true;

  // Single-token heads: last-name (or sole-name) abbreviation only — not shared first names.
  if (headTokens.length === 1) {
    const token = headTokens[0];
    if (token === leaderTokens[leaderTokens.length - 1]) return true;
    if (leaderTokens.length === 1 && token === leaderTokens[0]) return true;
    return false;
  }

  // Multi-token heads: require full token containment either direction (not a shared subset).
  if (headTokens.every((token) => leaderTokens.includes(token))) return true;
  if (leaderTokens.every((token) => headTokens.includes(token))) return true;
  return false;
}

export function headSalesmanMetadataMatchesLeader(metadata, leaderProfile) {
  const headCode = normalizeCode(metadata?.head_salesman_code);
  const headName = normalizeCode(metadata?.head_salesman_name);
  if (!headCode && !headName) return false;

  if (headCode && headValueMatchesLeader(headCode, leaderProfile)) return true;
  if (headName && headValueMatchesLeader(headName, leaderProfile)) return true;
  return false;
}

export function resolveSubordinateUserIds(authUsers, leaderProfile, allProfiles = []) {
  const subordinateIds = new Set();
  const profileById = new Map((allProfiles || []).map((profile) => [String(profile?.id || ""), profile]));
  const queue = [leaderProfile].filter(Boolean);
  const seenLeaders = new Set(
    [leaderProfile?.id].filter(Boolean).map((id) => String(id)),
  );

  while (queue.length) {
    const currentLeader = queue.shift();
    (authUsers || []).forEach((authUser) => {
      const authId = String(authUser?.id || "");
      if (!authId || subordinateIds.has(authId) || seenLeaders.has(authId)) return;

      const metadata = authUser?.user_metadata || authUser?.app_metadata || {};
      if (!headSalesmanMetadataMatchesLeader(metadata, currentLeader)) return;

      subordinateIds.add(authId);
      seenLeaders.add(authId);

      const nextLeader = profileById.get(authId) || {
        id: authId,
        salesman_code: metadata.salesman_code || "",
        salesman_name: metadata.salesman_name || "",
      };
      queue.push(nextLeader);
    });
  }

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
