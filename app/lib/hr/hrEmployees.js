export const HR_EMPLOYEE_STATUSES = ["ACTIVE", "INACTIVE"];
export const HR_SALESMAN_DESIGNATION = "Salesman";
/** Designations kept on the HR Employees list (active only). */
export const HR_FIELD_STAFF_DESIGNATIONS = ["Salesman", "Collector", "Product promoter", "Promoter"];
/** Hierarchy roles pulled into HR (salesman / collector / promoter). */
export const HR_HIERARCHY_SYNC_ROLES = ["salesman", "collector", "product-promoter"];

const MONEY_FIELDS = ["basicSalary", "housingAllowance", "transportAllowance", "otherAllowance"];

export function roundHrMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

export function normalizeEmployeeCode(value) {
  return String(value ?? "").trim().toUpperCase();
}

function text(value) {
  return String(value ?? "").trim();
}

function money(value) {
  if (value === "" || value == null) return 0;
  const amount = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(amount) ? roundHrMoney(amount) : NaN;
}

function dateOrNull(value) {
  const raw = text(value).slice(0, 10);
  if (!raw) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
}

function nonNegativeNumber(value, { allowEmpty = true } = {}) {
  if (value === "" || value == null) return allowEmpty ? 0 : NaN;
  const amount = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(amount) ? roundHrMoney(amount) : NaN;
}

function normalizeRoleKey(role) {
  return String(role || "").trim().toLowerCase().replace(/_/g, "-");
}

/** True when an app role is salesman (hyphen/underscore/case insensitive). */
export function isSalesmanRole(role) {
  return normalizeRoleKey(role) === "salesman";
}

/** Hierarchy roles that belong on the HR field-staff ledger. */
export function isHrHierarchySyncRole(role) {
  return HR_HIERARCHY_SYNC_ROLES.includes(normalizeRoleKey(role));
}

/** True when an HR staff row is Salesman / Collector / Promoter. */
export function isHrFieldStaff(employee = {}) {
  const designation = text(employee.designation).toLowerCase();
  return HR_FIELD_STAFF_DESIGNATIONS.some((label) => label.toLowerCase() === designation);
}

/** Active field staff only — what the HR Employees list shows. */
export function filterActiveFieldStaff(employees = []) {
  return (employees || []).filter(
    (employee) => employee.status === "ACTIVE" && isHrFieldStaff(employee),
  );
}

/** @deprecated Use filterActiveFieldStaff — kept for older call sites. */
export function filterActiveSalesmen(employees = []) {
  return filterActiveFieldStaff(employees);
}

/** @deprecated Use isHrFieldStaff. */
export function isHrSalesmanStaff(employee = {}) {
  return isHrFieldStaff(employee);
}

/** Validate/normalise employee form or API input. Returns { value, errors }. */
export function normalizeEmployeeInput(input = {}) {
  const errors = [];
  const value = {
    employeeCode: normalizeEmployeeCode(input.employeeCode ?? input.employee_code),
    fullName: text(input.fullName ?? input.full_name),
    fullNameAr: text(input.fullNameAr ?? input.full_name_ar),
    profileId: text(input.profileId ?? input.profile_id) || null,
    designation: text(input.designation) || HR_SALESMAN_DESIGNATION,
    department: text(input.department),
    nationality: text(input.nationality),
    iqamaNo: text(input.iqamaNo ?? input.iqama_no),
    iqamaExpiry: dateOrNull(input.iqamaExpiry ?? input.iqama_expiry),
    phone: text(input.phone),
    joinDate: dateOrNull(input.joinDate ?? input.join_date),
    status: text(input.status || "ACTIVE").toUpperCase(),
    holidaysPerYear: nonNegativeNumber(input.holidaysPerYear ?? input.holidays_per_year),
    notes: text(input.notes),
  };

  for (const field of MONEY_FIELDS) {
    const snake = field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    const amount = money(input[field] ?? input[snake]);
    if (Number.isNaN(amount) || amount < 0) {
      errors.push(`${field} must be a non-negative number.`);
      value[field] = 0;
    } else {
      value[field] = amount;
    }
  }

  if (!value.employeeCode) errors.push("Employee code is required.");
  if (!value.fullName) errors.push("Employee name is required.");
  if (!HR_EMPLOYEE_STATUSES.includes(value.status)) errors.push("Status must be ACTIVE or INACTIVE.");
  if (value.joinDate === undefined) {
    errors.push("Joining date must be YYYY-MM-DD.");
    value.joinDate = null;
  }
  if (value.iqamaExpiry === undefined) {
    errors.push("Iqama expiry must be YYYY-MM-DD.");
    value.iqamaExpiry = null;
  }
  if (Number.isNaN(value.holidaysPerYear) || value.holidaysPerYear < 0) {
    errors.push("Holidays per year must be a non-negative number.");
    value.holidaysPerYear = 0;
  }
  if (value.profileId && !/^[0-9a-f-]{32,36}$/i.test(value.profileId)) {
    errors.push("Linked profile is not a valid id.");
    value.profileId = null;
  }
  return { value, errors };
}

export function employeeToRow(employee = {}) {
  return {
    employee_code: employee.employeeCode,
    full_name: employee.fullName,
    full_name_ar: employee.fullNameAr || "",
    profile_id: employee.profileId || null,
    designation: employee.designation || "",
    department: employee.department || "",
    nationality: employee.nationality || "",
    iqama_no: employee.iqamaNo || "",
    iqama_expiry: employee.iqamaExpiry || null,
    phone: employee.phone || "",
    join_date: employee.joinDate || null,
    status: employee.status || "ACTIVE",
    basic_salary: employee.basicSalary || 0,
    housing_allowance: employee.housingAllowance || 0,
    transport_allowance: employee.transportAllowance || 0,
    other_allowance: employee.otherAllowance || 0,
    holidays_per_year: employee.holidaysPerYear || 0,
    notes: employee.notes || "",
  };
}

export function rowToEmployee(row = {}) {
  return {
    id: row.id || "",
    employeeCode: row.employee_code || "",
    fullName: row.full_name || "",
    fullNameAr: row.full_name_ar || "",
    profileId: row.profile_id || null,
    designation: row.designation || "",
    department: row.department || "",
    nationality: row.nationality || "",
    iqamaNo: row.iqama_no || "",
    iqamaExpiry: row.iqama_expiry || null,
    phone: row.phone || "",
    joinDate: row.join_date || null,
    status: row.status || "ACTIVE",
    basicSalary: roundHrMoney(row.basic_salary),
    housingAllowance: roundHrMoney(row.housing_allowance),
    transportAllowance: roundHrMoney(row.transport_allowance),
    otherAllowance: roundHrMoney(row.other_allowance),
    holidaysPerYear: roundHrMoney(row.holidays_per_year),
    notes: row.notes || "",
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

/** Monthly package from the employee master: basic + allowances. */
export function employeeMonthlyPackage(employee = {}) {
  return roundHrMoney(
    Number(employee.basicSalary || 0)
    + Number(employee.housingAllowance || 0)
    + Number(employee.transportAllowance || 0)
    + Number(employee.otherAllowance || 0),
  );
}

export function employeeDisplayName(employee = {}, language = "en") {
  const ar = text(employee.fullNameAr);
  const en = text(employee.fullName);
  if (String(language).startsWith("ar") && ar) return ar;
  return en || ar;
}

/** Linked profile ids must be unique across staff rows. Returns the clashing employee or null. */
export function findProfileLinkConflict(employees = [], { profileId, excludeId = "" } = {}) {
  if (!profileId) return null;
  return (employees || []).find(
    (employee) => employee.profileId === profileId && employee.id !== excludeId,
  ) || null;
}

export function summarizeEmployees(employees = []) {
  const list = Array.isArray(employees) ? employees : [];
  const active = list.filter((employee) => employee.status === "ACTIVE");
  return {
    total: list.length,
    active: active.length,
    inactive: list.length - active.length,
    linked: list.filter((employee) => employee.profileId).length,
    monthlyPackage: roundHrMoney(active.reduce((sum, employee) => sum + employeeMonthlyPackage(employee), 0)),
  };
}

/** Map a Salesman Hierarchy / profiles role to an HR department label. */
export function departmentForHierarchyRole(role) {
  const normalized = String(role || "").trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "collector") return "Collections";
  if (normalized === "manager") return "Management";
  if (normalized === "invoice-maker") return "Office";
  if (normalized === "admin" || normalized === "report-user") return "Admin";
  if (normalized === "product-promoter") return "Sales";
  return "Sales";
}

/** Human designation from the app role (English). */
export function designationForHierarchyRole(role) {
  const normalized = String(role || "").trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "collector") return "Collector";
  if (normalized === "manager") return "Manager";
  if (normalized === "invoice-maker") return "Invoice maker";
  if (normalized === "admin") return "Admin";
  if (normalized === "report-user") return "Report user";
  if (normalized === "product-promoter") return "Product promoter";
  if (normalized === "salesman") return "Salesman";
  return text(role) || "Staff";
}

/**
 * Build a new HR employee payload from a Salesman Hierarchy profile.
 * employee_code = salesman_code; profile is linked for My Day prefill.
 */
export function employeeFromHierarchyProfile(profile = {}) {
  const employeeCode = normalizeEmployeeCode(profile.salesmanCode ?? profile.salesman_code);
  const fullName = text(profile.name ?? profile.salesman_name ?? profile.email);
  const role = profile.role || "";
  const isActive = profile.isActive !== false && profile.is_active !== false;
  return {
    employeeCode,
    fullName,
    fullNameAr: "",
    profileId: text(profile.id) || null,
    designation: designationForHierarchyRole(role),
    department: departmentForHierarchyRole(role),
    nationality: "",
    iqamaNo: "",
    iqamaExpiry: null,
    phone: "",
    joinDate: null,
    status: isActive ? "ACTIVE" : "INACTIVE",
    basicSalary: 0,
    housingAllowance: 0,
    transportAllowance: 0,
    otherAllowance: 0,
    holidaysPerYear: 0,
    notes: "Imported from Salesman Hierarchy",
  };
}

/**
 * Plan create/update/skip actions to pull Salesman Hierarchy profiles into HR Employees.
 * Only salesman / collector / product-promoter roles. Creates a staff row per salesman_code
 * when missing (linked). Updates keep salary/iqama/holidays. Skips other roles and link clashes.
 */
export function planHierarchyStaffSync(profiles = [], employees = []) {
  const existingByCode = new Map(
    (employees || [])
      .filter((employee) => employee.employeeCode)
      .map((employee) => [employee.employeeCode, employee]),
  );
  const linkedProfileIds = new Map();
  (employees || []).forEach((employee) => {
    if (employee.profileId) linkedProfileIds.set(employee.profileId, employee.employeeCode);
  });

  const creates = [];
  const updates = [];
  const skipped = [];
  const seenCodes = new Set();

  for (const profile of profiles || []) {
    if (!isHrHierarchySyncRole(profile.role)) {
      skipped.push({
        reason: "not_field_staff_role",
        profileId: profile.id || null,
        role: profile.role || "",
        name: text(profile.name ?? profile.salesman_name ?? profile.email),
      });
      continue;
    }

    const draft = employeeFromHierarchyProfile(profile);
    if (!draft.employeeCode) {
      skipped.push({ reason: "missing_code", profileId: profile.id || null, name: draft.fullName });
      continue;
    }
    if (!draft.fullName) {
      skipped.push({ reason: "missing_name", profileId: profile.id || null, employeeCode: draft.employeeCode });
      continue;
    }
    if (seenCodes.has(draft.employeeCode)) {
      skipped.push({ reason: "duplicate_code", profileId: profile.id || null, employeeCode: draft.employeeCode });
      continue;
    }
    seenCodes.add(draft.employeeCode);

    const ownerCode = linkedProfileIds.get(draft.profileId);
    if (ownerCode && ownerCode !== draft.employeeCode) {
      skipped.push({
        reason: "profile_linked_elsewhere",
        profileId: draft.profileId,
        employeeCode: draft.employeeCode,
        linkedTo: ownerCode,
      });
      continue;
    }

    const existing = existingByCode.get(draft.employeeCode);
    if (!existing) {
      if (draft.status !== "ACTIVE") {
        skipped.push({ reason: "inactive_profile", profileId: draft.profileId, employeeCode: draft.employeeCode });
        continue;
      }
      creates.push(draft);
      if (draft.profileId) linkedProfileIds.set(draft.profileId, draft.employeeCode);
      continue;
    }

    const nextProfileId = existing.profileId || draft.profileId;
    if (draft.profileId && existing.profileId && existing.profileId !== draft.profileId) {
      skipped.push({
        reason: "code_already_linked_other_profile",
        employeeCode: draft.employeeCode,
        profileId: draft.profileId,
        linkedProfileId: existing.profileId,
      });
      continue;
    }

    const patch = {
      id: existing.id,
      employeeCode: existing.employeeCode,
      fullName: draft.fullName || existing.fullName,
      fullNameAr: existing.fullNameAr || "",
      profileId: nextProfileId,
      designation: existing.designation || draft.designation,
      department: existing.department || draft.department,
      nationality: existing.nationality || "",
      iqamaNo: existing.iqamaNo || "",
      iqamaExpiry: existing.iqamaExpiry || null,
      phone: existing.phone || "",
      joinDate: existing.joinDate || null,
      status: draft.status,
      basicSalary: existing.basicSalary || 0,
      housingAllowance: existing.housingAllowance || 0,
      transportAllowance: existing.transportAllowance || 0,
      otherAllowance: existing.otherAllowance || 0,
      holidaysPerYear: existing.holidaysPerYear || 0,
      notes: existing.notes || draft.notes,
    };

    const changed = patch.fullName !== existing.fullName
      || patch.profileId !== existing.profileId
      || patch.status !== existing.status
      || patch.designation !== existing.designation
      || patch.department !== existing.department;

    if (changed) {
      updates.push(patch);
      if (patch.profileId) linkedProfileIds.set(patch.profileId, patch.employeeCode);
    } else {
      skipped.push({ reason: "unchanged", employeeCode: draft.employeeCode, profileId: draft.profileId });
    }
  }

  return {
    creates,
    updates,
    skipped,
    summary: {
      created: creates.length,
      updated: updates.length,
      skipped: skipped.length,
      considered: (profiles || []).length,
    },
  };
}
