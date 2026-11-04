import { isAdminRole } from "./moduleAccess.js";

export const ADMIN_LOGIN_AS_SESSION_KEY = "madiba-admin-login-as-session-v1";

export function canStartAdminLoginAs(role) {
  return isAdminRole(role);
}

export function normalizeAdminLoginAsTargets(profiles) {
  return (Array.isArray(profiles) ? profiles : [])
    .filter((profile) => profile?.id && profile.is_active !== false)
    .map((profile) => ({
      id: String(profile.id),
      salesmanCode: String(profile.salesman_code || "").trim(),
      salesmanName: String(profile.salesman_name || "").trim(),
      role: String(profile.role || "").trim(),
    }))
    .sort((left, right) => left.salesmanName.localeCompare(right.salesmanName));
}

/**
 * Saved return-context is only valid while the live Auth user is the selected target.
 * Stale sessionStorage after a failed switch or another tab restoring admin must not
 * keep showing "Viewing as" over an admin JWT (which loads company-wide BI).
 */
export function isActiveAdminLoginAsContext(saved, currentUserId) {
  const targetId = String(saved?.targetId || "").trim();
  const liveId = String(currentUserId || "").trim();
  if (!targetId || !liveId) return false;
  if (!saved?.session?.access_token || !saved?.session?.refresh_token) return false;
  return targetId === liveId;
}

export function buildAdminLoginAsReturnContext({
  adminSession,
  targetId,
  targetName,
} = {}) {
  const accessToken = String(adminSession?.access_token || "").trim();
  const refreshToken = String(adminSession?.refresh_token || "").trim();
  const target = String(targetId || "").trim();
  if (!accessToken || !refreshToken || !target) return null;
  return {
    session: {
      access_token: accessToken,
      refresh_token: refreshToken,
    },
    targetId: target,
    targetName: String(targetName || "").trim() || "User",
  };
}