export const ADMIN_LOGIN_AS_SESSION_KEY = "madiba-admin-login-as-session-v1";

export function canStartAdminLoginAs(role) {
  return String(role || "").trim().toLowerCase() === "admin";
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