export const MODULES = {
  dashboard: { href: "/", label: "Dashboard" },
  management: { href: "/management", label: "Management" },
  myDay: { href: "/management/my-day", label: "My Day" },
  customerAudit: { href: "/management/customer-audit", label: "Customers Audit" },
  newOrder: { href: "/management/new-order", label: "New Order" },
  visitWithoutOrder: { href: "/management/visit-without-order", label: "Visit Without Order" },
  pendingOrders: { href: "/management/pending-orders", label: "Old Pending Orders" },
  newCustomer: { href: "/management/new-customer", label: "New Customers" },
  myPerformance: { href: "/management/my-performance", label: "Performance" },
  mySalesInvoices: { href: "/management/my-sales-invoices", label: "My Sales Invoices" },
  myCollections: { href: "/management/my-collections", label: "My Customer Collections" },
  paymentCollections: { href: "/management/payment-collections", label: "Payment Collections" },
  collectionReport: { href: "/management/collection-report", label: "Collection Report" },
  dailyVisitReport: { href: "/management/daily-visit-report", label: "Daily Visit Report" },
  userActivity: { href: "/management/user-activity", label: "User Activity" },
  businessDashboard: { href: "/management/business-dashboard", label: "Business Dashboard" },
  customerMaster: { href: "/management/customer-master", label: "Customer Master" },
  outstandingNoGps: { href: "/management/outstanding-no-gps", label: "Outstanding Without GPS" },
  salesmanHierarchy: { href: "/management/salesman-hierarchy", label: "Salesman Hierarchy" },
  gpsMap: { href: "/management/gps-map", label: "GPS Map" },
  upload: { href: "/management/upload", label: "Imports" },
};

export const NAV_GROUPS = [
  { key: "home", label: "Home", modules: ["dashboard", "management"] },
  {
    key: "field",
    label: "Field Sales",
    modules: ["myDay", "customerAudit", "newOrder", "visitWithoutOrder", "pendingOrders", "newCustomer", "myPerformance", "mySalesInvoices", "myCollections"],
  },
  {
    key: "collections",
    label: "Collections",
    modules: ["paymentCollections", "collectionReport", "dailyVisitReport"],
  },
  {
    key: "admin",
    label: "Admin",
    modules: ["businessDashboard", "customerMaster", "outstandingNoGps", "userActivity", "salesmanHierarchy", "gpsMap", "upload"],
  },
];

export function normalizeAccessRole(role) {
  return String(role || "").trim().toLowerCase().replace(/_/g, "-");
}

export function isInvoiceMakerRole(role) {
  const normalized = normalizeAccessRole(role);
  return normalized === "invoice-maker";
}

export function shouldRequireTransactionGps(role) {
  return !isInvoiceMakerRole(role);
}

export function shouldRequireGpsAccessGate(role) {
  const normalized = normalizeAccessRole(role);
  if (normalized === "admin" || normalized === "manager") {
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
  const isAdmin = role === "admin";
  const isManager = role === "manager";
  const isSalesman = role === "salesman";
  const isInvoiceMaker = isInvoiceMakerRole(role);
  const isProductPromoter = isProductPromoterRole(role);
  const isCollector = collectionOnly;
  const isFieldSales = isSalesman || isManager || isAdmin || isInvoiceMaker || isProductPromoter;

  const access = {
    role,
    collectionOnly: isCollector,
    hasManagementPanel: isAdmin || isManager || isInvoiceMaker || isCollector,
    modules: {
      dashboard: true,
      management: isAdmin || isManager || isInvoiceMaker || isCollector,
      myDay: isFieldSales && !isCollector,
      customerAudit: isFieldSales && !isCollector,
      newOrder: isFieldSales && !isCollector,
      visitWithoutOrder: isFieldSales && !isCollector,
      pendingOrders: isFieldSales && !isCollector,
      newCustomer: isFieldSales && !isCollector,
      myPerformance: isFieldSales && !isCollector,
      mySalesInvoices: isFieldSales && !isCollector,
      myCollections: isSalesman,
      paymentCollections: isAdmin || isManager || isCollector || isInvoiceMaker,
      collectionReport: isAdmin || isManager || isCollector,
      dailyVisitReport: isAdmin || isManager || isCollector || isSalesman,
      userActivity: isAdmin || isManager || isCollector,
      businessDashboard: isAdmin || isManager,
      customerMaster: isAdmin || isManager,
      outstandingNoGps: isAdmin || isManager,
      salesmanHierarchy: isAdmin || isManager || isInvoiceMaker,
      gpsMap: isAdmin || isInvoiceMaker || isProductPromoter,
      upload: isAdmin || isManager || isInvoiceMaker,
    },
  };

  access.canAccess = (moduleKey) => Boolean(access.modules[moduleKey]);
  access.canAccessPath = (href) => {
    const normalizedHref = String(href || "").trim();
    const match = Object.entries(MODULES).find(([, module]) => module.href === normalizedHref);
    return match ? access.canAccess(match[0]) : true;
  };

  return access;
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
  newOrder: { en: "New Order", ar: "طلب جديد" },
  visitWithoutOrder: { en: "Visit Without Order", ar: "زيارة بدون طلب" },
  pendingOrders: { en: "Old Pending Orders", ar: "طلبات معلقة قديمة" },
  newCustomer: { en: "New Customers", ar: "عميل جديد" },
  myPerformance: { en: "Performance", ar: "أدائي" },
  mySalesInvoices: { en: "My Sales Invoices", ar: "فواتير المبيعات" },
  myCollections: { en: "My Customer Collections", ar: "تحصيلات عملائي" },
  paymentCollections: { en: "Payment Collections", ar: "التحصيلات" },
  collectionReport: { en: "Collection Report", ar: "تقرير التحصيل" },
  dailyVisitReport: { en: "Daily Visit Report", ar: "تقرير الزيارات اليومية" },
  userActivity: { en: "User Activity", ar: "نشاط المستخدمين" },
  businessDashboard: { en: "Business Dashboard", ar: "لوحة الأعمال" },
  customerMaster: { en: "Customer Master", ar: "سجل العملاء" },
  outstandingNoGps: { en: "Outstanding Without GPS", ar: "مستحقات بدون GPS" },
  salesmanHierarchy: { en: "Salesman Hierarchy", ar: "هيكل المندوبين" },
  gpsMap: { en: "GPS Map", ar: "خريطة GPS" },
  upload: { en: "Imports", ar: "الاستيراد" },
};

export const NAV_GROUP_LABELS = {
  home: { en: "Home", ar: "الرئيسية" },
  field: { en: "Field Sales", ar: "المبيعات الميدانية" },
  collections: { en: "Collections", ar: "التحصيلات" },
  admin: { en: "Admin", ar: "الإدارة" },
};

export const ROLE_LABELS = {
  admin: { en: "admin", ar: "مدير النظام" },
  manager: { en: "manager", ar: "مدير" },
  salesman: { en: "salesman", ar: "مندوب مبيعات" },
  collector: { en: "collector", ar: "محصل" },
  "invoice-maker": { en: "invoice-maker", ar: "مُصدر فواتير" },
  "invoice_maker": { en: "invoice_maker", ar: "مُصدر فواتير" },
  "product-promoter": { en: "product-promoter", ar: "مروج منتجات" },
};

export const PINNED_MODULE_KEYS = {
  admin: ["customerAudit", "paymentCollections", "upload", "dailyVisitReport"],
  manager: ["customerAudit", "paymentCollections", "upload", "dailyVisitReport"],
  salesman: ["myDay", "customerAudit", "newOrder", "myCollections"],
  collector: ["paymentCollections", "collectionReport", "dailyVisitReport", "userActivity"],
  "invoice-maker": ["customerAudit", "pendingOrders", "upload", "paymentCollections"],
  "product-promoter": ["myDay", "customerAudit", "newOrder", "gpsMap"],
};

export function pinnedModuleKeysForAccess(access) {
  const role = access?.collectionOnly ? "collector" : normalizeAccessRole(access?.role);
  const keys = PINNED_MODULE_KEYS[role] || PINNED_MODULE_KEYS.salesman;
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
