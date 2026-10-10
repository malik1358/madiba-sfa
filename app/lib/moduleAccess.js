function envFlagEnabled(value, defaultValue = false) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return defaultValue;
  return raw !== "0" && raw !== "false" && raw !== "no";
}

export function isSalesmanVisitPlanSalesmanAccessApproved(
  env = typeof process !== "undefined" ? process.env : {},
) {
  return envFlagEnabled(env.NEXT_PUBLIC_SALESMAN_VISIT_PLAN_SALESMAN_ACCESS, true);
}

export const MODULES = {
  dashboard: { href: "/", label: "Dashboard" },
  management: { href: "/management", label: "Management" },
  myDay: { href: "/management/my-day", label: "My Day" },
  customerAudit: { href: "/management/customer-audit", label: "Customers Audit" },
  paymentSettlement: { href: "/management/payment-settlement", label: "Payment Settlement" },
  outstandingCompare: { href: "/management/outstanding-compare", label: "Outstanding Compare" },
  newOrder: { href: "/management/new-order", label: "New Order" },
  productCatalogue: { href: "/management/product-catalogue", label: "Product Catalogue" },
  visitWithoutOrder: { href: "/management/visit-without-order", label: "Visit Without Order" },
  pendingOrders: { href: "/management/pending-orders", label: "Old Pending Orders" },
  newCustomer: { href: "/management/new-customer", label: "New Customers" },
  myPerformance: { href: "/management/my-performance", label: "Performance" },
  mySalesInvoices: { href: "/management/my-sales-invoices", label: "My Sales Invoices" },
  myCollections: { href: "/management/my-collections", label: "My Customer Collections" },
  paymentCollections: { href: "/management/payment-collections", label: "Payment Collections" },
  collectionReport: { href: "/management/collection-report", label: "Collection Report" },
  receiptsNotInTally: { href: "/management/receipts-not-in-tally", label: "Receipts Not in Tally" },
  dailyVisitReport: { href: "/management/daily-visit-report", label: "Daily Visit Report" },
  potentialSalesTargets: { href: "/management/potential-sales-targets", label: "Potential Sales Targets" },
  userActivity: { href: "/management/user-activity", label: "User Activity" },
  workingHours: { href: "/management/working-hours", label: "Working Hours" },
  businessDashboard: { href: "/management/business-dashboard", label: "Business Intelligence" },
  salesmanIncentive: { href: "/management/salesman-incentive", label: "Salesman Incentive" },
  promoterCoverage: { href: "/management/promoter-coverage", label: "Promoter Coverage" },
  customerMaster: { href: "/management/customer-master", label: "Customer Master" },
  outstandingNoGps: { href: "/management/outstanding-no-gps", label: "Outstanding Without GPS" },
  customerGpsHistory: { href: "/management/customer-gps-history", label: "Customer GPS History" },
  salesmanVisitPlan: { href: "/management/salesman-visit-plan", label: "Salesman Visit Plan" },
  salesmanHierarchy: { href: "/management/salesman-hierarchy", label: "Salesman Hierarchy" },
  customerBookShares: { href: "/management/customer-book-shares", label: "Customer Book Shares" },
  kpiTargets: { href: "/management/kpi-targets", label: "KPI Targets" },
  schemes: { href: "/management/schemes", label: "Schemes" },
  orderQuantityControls: { href: "/management/order-quantity-controls", label: "Sales Qty Limits" },
  itemPriceHistory: { href: "/management/item-price-history", label: "Item Price History" },
  gpsMap: { href: "/management/gps-map", label: "GPS Map" },
  upload: { href: "/management/upload", label: "Imports" },
  stockTake: { href: "/management/stock-take", label: "Stock Take" },
  roleAccess: { href: "/management/role-access", label: "Role Access" },
};

export const NAV_GROUPS = [
  { key: "home", label: "Home", modules: ["dashboard", "management"] },
  {
    key: "field",
    label: "Field Sales",
    modules: [
      "myDay",
      "customerAudit",
      "newOrder",
      "productCatalogue",
      "visitWithoutOrder",
      "pendingOrders",
      "newCustomer",
      "mySalesInvoices",
      "salesmanVisitPlan",
      "itemPriceHistory",
    ],
  },
  {
    key: "collections",
    label: "Collections",
    modules: [
      "paymentCollections",
      "myCollections",
      "collectionReport",
      "receiptsNotInTally",
      "paymentSettlement",
      "outstandingCompare",
    ],
  },
  {
    key: "reports",
    label: "Reports",
    modules: [
      "businessDashboard",
      "myPerformance",
      "salesmanIncentive",
      "promoterCoverage",
      "potentialSalesTargets",
      "dailyVisitReport",
      "userActivity",
      "workingHours",
      "outstandingNoGps",
      "customerGpsHistory",
      "gpsMap",
    ],
  },
  {
    key: "warehouse",
    label: "Warehouse",
    modules: ["stockTake"],
  },
  {
    key: "admin",
    label: "Setup & Admin",
    modules: [
      "customerMaster",
      "salesmanHierarchy",
      "customerBookShares",
      "kpiTargets",
      "schemes",
      "orderQuantityControls",
      "roleAccess",
      "upload",
    ],
  },
];

export function normalizeAccessRole(role) {
  return String(role || "").trim().toLowerCase().replace(/_/g, "-");
}

/** Admin and report-user share the same app access. */
export function isAdminRole(role) {
  const normalized = normalizeAccessRole(role);
  return normalized === "admin" || normalized === "report-user";
}

/** Admin-equivalent roles plus manager (common API / scope gate). */
export function isManagementRole(role) {
  const normalized = normalizeAccessRole(role);
  return isAdminRole(normalized) || normalized === "manager";
}

/** Values accepted in profiles.role / Auth metadata for admin-equivalent users. */
export const ADMIN_ROLE_VALUES = ["admin", "report-user", "report_user"];

/** Values for management-level scope checks (admin-equivalent + manager). */
export const MANAGEMENT_ROLE_VALUES = [...ADMIN_ROLE_VALUES, "manager"];

export function isInvoiceMakerRole(role) {
  const normalized = normalizeAccessRole(role);
  return normalized === "invoice-maker";
}

export function canViewManagementReports(role) {
  const normalized = normalizeAccessRole(role);
  return isAdminRole(normalized) || normalized === "manager" || isInvoiceMakerRole(normalized);
}

export function canManageOrderInvoice(role) {
  const normalized = normalizeAccessRole(role);
  return isInvoiceMakerRole(normalized) || isAdminRole(normalized) || normalized === "manager";
}

export function shouldRequireTransactionGps(role) {
  return !isInvoiceMakerRole(role);
}

export function shouldRequireGpsAccessGate(role) {
  if (isManagementRole(role)) {
    return false;
  }
  return shouldRequireTransactionGps(role);
}

export function shouldEnableBackgroundGps(role) {
  if (isAdminRole(role) || isInvoiceMakerRole(role)) {
    return false;
  }
  return shouldRequireTransactionGps(role);
}

export function isProductPromoterRole(role) {
  const normalized = normalizeAccessRole(role);
  return normalized === "product-promoter";
}

export function isCollectionOnlyAccess({ role, salesmanCode, collectionOnlyMetadata = false }) {
  const normalizedRole = normalizeAccessRole(role);
  return Boolean(collectionOnlyMetadata)
    || normalizedRole === "collector"
    || /^CL\d+$/i.test(String(salesmanCode || "").trim());
}

export function buildModuleAccess(context = {}) {
  const role = normalizeAccessRole(context.role);
  const collectionOnly = isCollectionOnlyAccess(context);
  const isAdmin = isAdminRole(role);
  const isManager = role === "manager";
  const isSalesman = role === "salesman";
  const isInvoiceMaker = isInvoiceMakerRole(role);
  const isProductPromoter = isProductPromoterRole(role);
  const isCollector = collectionOnly;
  const hasManagementReportAccess = canViewManagementReports(role);
  const isFieldSales = isSalesman || isManager || isAdmin || isInvoiceMaker || isProductPromoter;
  const stockTakeAccess = isAdmin || Boolean(context.stockTakeAccess);

  const access = {
    role,
    collectionOnly: isCollector,
    hasManagementPanel: isAdmin || isManager || isInvoiceMaker || isCollector,
    modules: {
      dashboard: true,
      management: isAdmin || isManager || isInvoiceMaker || isCollector,
      myDay: isFieldSales && !isCollector,
      customerAudit: isFieldSales && !isCollector,
      paymentSettlement: isFieldSales && !isCollector,
      outstandingCompare: isFieldSales && !isCollector,
      newOrder: isFieldSales && !isCollector,
      productCatalogue: isFieldSales && !isCollector,
      visitWithoutOrder: isFieldSales && !isCollector,
      pendingOrders: isFieldSales && !isCollector,
      newCustomer: isFieldSales && !isCollector,
      myPerformance: isFieldSales && !isCollector,
      mySalesInvoices: isFieldSales && !isCollector,
      // Legacy /management/my-collections path stays available via canAccessPath.
      myCollections: false,
      paymentCollections: isAdmin || isManager || isCollector || isInvoiceMaker || (isSalesman && !isCollector),
      collectionReport: hasManagementReportAccess || isCollector,
      receiptsNotInTally: hasManagementReportAccess || isCollector,
      dailyVisitReport: hasManagementReportAccess || isCollector || isSalesman,
      potentialSalesTargets: hasManagementReportAccess || (isSalesman && !isCollector),
      userActivity: hasManagementReportAccess || isCollector,
      workingHours: hasManagementReportAccess || isCollector,
      businessDashboard: hasManagementReportAccess,
      salesmanIncentive: hasManagementReportAccess || (isSalesman && !isCollector),
      promoterCoverage: true,
      customerMaster: isAdmin || isManager,
      outstandingNoGps: hasManagementReportAccess,
      customerGpsHistory: isAdmin || isManager,
      // Enabled for field sales after admin approval. Set NEXT_PUBLIC_SALESMAN_VISIT_PLAN_SALESMAN_ACCESS=false to lock again.
      salesmanVisitPlan: isAdmin || (
        isSalesmanVisitPlanSalesmanAccessApproved()
        && isFieldSales
        && !isCollector
      ),
      salesmanHierarchy: isAdmin || isManager || isInvoiceMaker,
      customerBookShares: isAdmin || isManager,
      kpiTargets: isAdmin || isManager,
      schemes: isAdmin || isManager,
      orderQuantityControls: isAdmin || isManager,
      itemPriceHistory: (isAdmin || isManager || isInvoiceMaker || isSalesman || isProductPromoter) && !isCollector,
      gpsMap: isAdmin || isInvoiceMaker || isProductPromoter,
      upload: isAdmin || isManager || isInvoiceMaker,
      stockTake: stockTakeAccess,
      roleAccess: isAdmin,
    },
  };

  applyRoleModuleMatrixOverrides(access, context);

  access.hasManagementPanel = Boolean(access.modules.management);
  access.canAccess = (moduleKey) => Boolean(access.modules[moduleKey]);
  access.canAccessPath = (href) => {
    const normalizedHref = String(href || "").trim().split("?")[0];
    if (
      (normalizedHref === MODULES.myCollections.href || normalizedHref === MODULES.paymentCollections.href)
      && (access.canAccess("myCollections") || access.canAccess("paymentCollections"))
    ) {
      return true;
    }
    const match = Object.entries(MODULES).find(([, module]) => module.href === normalizedHref);
    return match ? access.canAccess(match[0]) : true;
  };

  return access;
}

/** Roles shown as columns on the Role Access matrix (and stored in system_settings). */
export const ACCESS_MATRIX_ROLES = [
  "admin",
  "report-user",
  "manager",
  "salesman",
  "collector",
  "invoice-maker",
  "product-promoter",
];

export const ROLE_MODULE_ACCESS_SETTING_KEY = "role_module_access_v1";

/** Admin-equivalent roles always keep Role Access so the matrix cannot lock them out. */
export const ROLE_ACCESS_LOCKED_ROLES = ["admin", "report-user"];

export function matrixRoleKey(context = {}) {
  if (isCollectionOnlyAccess(context)) return "collector";
  const role = normalizeAccessRole(context.role);
  if (role === "report_user") return "report-user";
  if (role === "invoice_maker") return "invoice-maker";
  if (role === "product_promoter") return "product-promoter";
  return role || "salesman";
}

export function buildDefaultRoleModuleMatrix() {
  const matrix = {};
  for (const role of ACCESS_MATRIX_ROLES) {
    const access = buildModuleAccess({
      role,
      salesmanCode: role === "collector" ? "CL01" : "SM001",
      collectionOnlyMetadata: role === "collector",
      stockTakeAccess: false,
      // Avoid re-applying a matrix while building defaults.
      roleModuleMatrix: null,
      skipRoleModuleMatrix: true,
    });
    matrix[role] = { ...access.modules };
  }
  return matrix;
}

export function normalizeRoleModuleMatrix(input, { fillDefaults = true } = {}) {
  const defaults = buildDefaultRoleModuleMatrix();
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const matrix = {};

  for (const role of ACCESS_MATRIX_ROLES) {
    const roleSource = source[role] && typeof source[role] === "object" ? source[role] : {};
    const row = {};
    for (const moduleKey of Object.keys(MODULES)) {
      if (Object.prototype.hasOwnProperty.call(roleSource, moduleKey)) {
        row[moduleKey] = Boolean(roleSource[moduleKey]);
      } else if (fillDefaults) {
        row[moduleKey] = Boolean(defaults[role]?.[moduleKey]);
      } else {
        row[moduleKey] = Boolean(defaults[role]?.[moduleKey]);
      }
    }
    if (ROLE_ACCESS_LOCKED_ROLES.includes(role) && Object.prototype.hasOwnProperty.call(row, "roleAccess")) {
      row.roleAccess = true;
    }
    matrix[role] = row;
  }

  return matrix;
}

export function parseStoredRoleModuleAccess(settingValue) {
  let parsed = settingValue;
  if (typeof settingValue === "string") {
    try {
      parsed = JSON.parse(settingValue);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const matrixSource = parsed.matrix && typeof parsed.matrix === "object" ? parsed.matrix : parsed;
  return {
    matrix: normalizeRoleModuleMatrix(matrixSource),
    updatedAt: parsed.updatedAt || null,
    updatedBy: parsed.updatedBy || null,
  };
}

function applyRoleModuleMatrixOverrides(access, context = {}) {
  if (context.skipRoleModuleMatrix) return;
  const matrix = context.roleModuleMatrix;
  if (!matrix || typeof matrix !== "object") return;

  const roleKey = matrixRoleKey(context);
  const row = matrix[roleKey];
  if (!row || typeof row !== "object") return;

  for (const moduleKey of Object.keys(access.modules)) {
    if (Object.prototype.hasOwnProperty.call(row, moduleKey)) {
      access.modules[moduleKey] = Boolean(row[moduleKey]);
    }
  }

  if (ROLE_ACCESS_LOCKED_ROLES.includes(roleKey) && Object.prototype.hasOwnProperty.call(access.modules, "roleAccess")) {
    access.modules.roleAccess = true;
  }

  // Per-user stock-take flag still grants Stock Take even when the role matrix is off.
  if (Boolean(context.stockTakeAccess)) {
    access.modules.stockTake = true;
  }
}

export function listAccessibleModules(access, moduleKeys) {
  return (moduleKeys || Object.keys(MODULES))
    .filter((moduleKey) => access.canAccess(moduleKey))
    .map((moduleKey) => ({
      moduleKey,
      ...MODULES[moduleKey],
    }));
}

export function listAccessibleNavGroups(access) {
  return NAV_GROUPS
    .map((group) => ({
      ...group,
      items: listAccessibleModules(access, group.modules),
    }))
    .filter((group) => group.items.length > 0);
}

export function moduleLabelForPath(href, language = "en") {
  const normalizedHref = String(href || "").trim();
  const match = Object.entries(MODULES).find(([, module]) => module.href === normalizedHref);
  if (!match) return null;
  return localizedModuleLabel(match[0], language);
}

export const MODULE_LABELS = {
  dashboard: { en: "Dashboard", ar: "الرئيسية" },
  management: { en: "Management", ar: "الإدارة" },
  myDay: { en: "My Day", ar: "يومي" },
  customerAudit: { en: "Customers Audit", ar: "عملائي" },
  paymentSettlement: { en: "Payment Settlement", ar: "تسوية المدفوعات" },
  outstandingCompare: { en: "Outstanding Compare", ar: "مقارنة المستحقات" },
  newOrder: { en: "New Order", ar: "طلب جديد" },
  productCatalogue: { en: "Product Catalogue", ar: "كتالوج المنتجات" },
  visitWithoutOrder: { en: "Visit Without Order", ar: "زيارة بدون طلب" },
  pendingOrders: { en: "Old Pending Orders", ar: "طلبات معلقة قديمة" },
  newCustomer: { en: "New Customers", ar: "عميل جديد" },
  myPerformance: { en: "Performance", ar: "أدائي" },
  mySalesInvoices: { en: "My Sales Invoices", ar: "فواتير المبيعات" },
  myCollections: { en: "My Customer Collections", ar: "تحصيلات عملائي" },
  paymentCollections: { en: "Payment Collections", ar: "التحصيلات" },
  collectionReport: { en: "Collection Report", ar: "تقرير التحصيل" },
  receiptsNotInTally: { en: "Receipts Not in Tally", ar: "إيصالات غير موجودة في تالي" },
  dailyVisitReport: { en: "Daily Visit Report", ar: "تقرير الزيارات اليومية" },
  potentialSalesTargets: { en: "Potential Sales Targets", ar: "عملاء مستهدفون محتملون" },
  userActivity: { en: "User Activity", ar: "نشاط المستخدمين" },
  workingHours: { en: "Working Hours", ar: "ساعات العمل" },
  businessDashboard: { en: "Business Intelligence", ar: "ذكاء الأعمال" },
  salesmanIncentive: { en: "Salesman Incentive", ar: "حوافز المندوبين" },
  promoterCoverage: { en: "Promoter Coverage", ar: "تغطية مروج المنتجات" },
  customerMaster: { en: "Customer Master", ar: "سجل العملاء" },
  outstandingNoGps: { en: "Outstanding Without GPS", ar: "مستحقات بدون GPS" },
  customerGpsHistory: { en: "Customer GPS History", ar: "سجل مواقع العملاء" },
  salesmanVisitPlan: { en: "Salesman Visit Plan", ar: "خطة زيارات المندوب" },
  salesmanHierarchy: { en: "Salesman Hierarchy", ar: "هيكل المندوبين" },
  customerBookShares: { en: "Customer Book Shares", ar: "مشاركة دفاتر العملاء" },
  kpiTargets: { en: "KPI Targets", ar: "أهداف الأداء" },
  schemes: { en: "Schemes", ar: "العروض" },
  orderQuantityControls: { en: "Sales Qty Limits", ar: "حدود كمية البيع للعميل" },
  itemPriceHistory: { en: "Item Price History", ar: "سجل أسعار الأصناف" },
  gpsMap: { en: "GPS Map", ar: "خريطة GPS" },
  upload: { en: "Imports", ar: "الاستيراد" },
  stockTake: { en: "Stock Take", ar: "جرد المخزون" },
  roleAccess: { en: "Role Access", ar: "صلاحيات الأدوار" },
};

export const NAV_GROUP_LABELS = {
  home: { en: "Home", ar: "الرئيسية" },
  field: { en: "Field Sales", ar: "المبيعات الميدانية" },
  collections: { en: "Collections", ar: "التحصيلات" },
  reports: { en: "Reports", ar: "التقارير" },
  warehouse: { en: "Warehouse", ar: "المستودع" },
  admin: { en: "Setup & Admin", ar: "الإعداد والإدارة" },
};

export const ROLE_LABELS = {
  admin: { en: "admin", ar: "مدير النظام" },
  "report-user": { en: "report-user", ar: "مستخدم تقارير" },
  report_user: { en: "report_user", ar: "مستخدم تقارير" },
  manager: { en: "manager", ar: "مدير" },
  salesman: { en: "salesman", ar: "مندوب مبيعات" },
  collector: { en: "collector", ar: "محصل" },
  "invoice-maker": { en: "invoice-maker", ar: "مُصدر فواتير" },
  "invoice_maker": { en: "invoice_maker", ar: "مُصدر فواتير" },
  "product-promoter": { en: "product-promoter", ar: "مروج منتجات" },
};

export const PINNED_MODULE_KEYS = {
  admin: ["customerAudit", "paymentCollections", "upload", "dailyVisitReport"],
  "report-user": ["customerAudit", "paymentCollections", "upload", "dailyVisitReport"],
  manager: ["customerAudit", "paymentCollections", "upload", "dailyVisitReport"],
  salesman: ["myDay", "customerAudit", "newOrder", "paymentCollections"],
  collector: ["paymentCollections", "collectionReport", "receiptsNotInTally", "dailyVisitReport", "userActivity"],
  "invoice-maker": ["customerAudit", "pendingOrders", "upload", "paymentCollections"],
  "product-promoter": ["myDay", "customerAudit", "newOrder", "gpsMap", "promoterCoverage"],
};

export function pinnedModuleKeysForAccess(access) {
  const role = access?.collectionOnly ? "collector" : normalizeAccessRole(access?.role);
  const keys = PINNED_MODULE_KEYS[role]
    || (isAdminRole(role) ? PINNED_MODULE_KEYS.admin : null)
    || PINNED_MODULE_KEYS.salesman;
  return keys.filter((moduleKey) => access?.canAccess?.(moduleKey));
}

export function pathMatchesModuleHref(pathname, href) {
  const path = String(pathname || "").trim();
  const target = String(href || "").trim();
  if (!path || !target) return false;
  if (path === target) return true;
  if (target === "/") return false;
  return path.startsWith(`${target}/`);
}

export function localizedModuleLabel(moduleKey, language = "en") {
  const labels = MODULE_LABELS[moduleKey];
  if (labels) return labels[language] || labels.en || "";
  return MODULES[moduleKey]?.label || "";
}

export function localizedNavGroupLabel(groupKey, language = "en") {
  const labels = NAV_GROUP_LABELS[groupKey];
  if (labels) return labels[language] || labels.en || "";
  const group = NAV_GROUPS.find((entry) => entry.key === groupKey);
  return group?.label || "";
}

export function localizedRoleLabel(role, language = "en") {
  const normalized = String(role || "").trim().toLowerCase().replace(/_/g, "-");
  const labels = ROLE_LABELS[normalized] || ROLE_LABELS[String(role || "").trim().toLowerCase()];
  if (labels) return labels[language] || labels.en || normalized;
  return String(role || "").trim();
}
