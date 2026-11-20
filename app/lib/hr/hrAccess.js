import {
  canViewManagementReports,
  isManagementRole,
  normalizeAccessRole,
} from "../moduleAccess.js";

/** HR writes are admin or manager only. report-user is read-only here. */
export function canWriteHr(role) {
  const normalized = normalizeAccessRole(role);
  return normalized === "admin" || normalized === "manager";
}

/** Staff list, monthly feed and leave screens: admin, report-user and manager. */
export function canReadHr(role) {
  return isManagementRole(role);
}

/** Payroll summary also opens for invoice-maker and other management-report viewers. */
export function canReadHrPayrollSummary(role) {
  return canViewManagementReports(role);
}

/**
 * Gate used by every /api/hr route. `need` is "read", "write" or "payroll".
 * Returns { ok, status, error }.
 */
export function checkHrAccess(role, need = "read") {
  const allowed = need === "write"
    ? canWriteHr(role)
    : need === "payroll"
      ? canReadHrPayrollSummary(role)
      : canReadHr(role);
  if (allowed) return { ok: true, status: 200, error: "" };
  return {
    ok: false,
    status: 403,
    error: need === "write" ? "Only admin or manager can change HR data." : "Not authorized for HR.",
  };
}
