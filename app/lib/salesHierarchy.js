import {
  buildSalesmanScopeMatchers,
  normalizeSalesmanCode,
  normalizeSalesmanName,
  salesmanValueMatchesScope,
} from "./mutualSalesmanGroups.js";

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
