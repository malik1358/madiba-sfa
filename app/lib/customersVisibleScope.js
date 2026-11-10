/**
 * Management roles already receive every sales-team profile. Auth Admin
 * listUsers can fail on cold starts; those roles can continue with an empty
 * auth user list. Salesman / promoter peer graphs still need listUsers.
 */
export function managementRoleIgnoresAuthUserListFailure(role) {
  const normalized = String(role || "").trim().toLowerCase().replace(/_/g, "-");
  return normalized === "admin"
    || normalized === "report-user"
    || normalized === "manager";
}
