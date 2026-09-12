import test from "node:test";
import assert from "node:assert/strict";

import {
  buildModuleAccess,
  canManageOrderInvoice,
  isCollectionOnlyAccess,
  isSalesmanVisitPlanSalesmanAccessApproved,
  listAccessibleModules,
  localizedModuleLabel,
  localizedNavGroupLabel,
  moduleLabelForPath,
  pathMatchesModuleHref,
  pinnedModuleKeysForAccess,
  shouldRequireTransactionGps,
  shouldRequireGpsAccessGate,
  shouldEnableBackgroundGps,
} from "../app/lib/moduleAccess.js";

test("collector-only users only see collection modules", () => {
  const access = buildModuleAccess({
    role: "salesman",
    salesmanCode: "CL01",
    collectionOnlyMetadata: true,
  });

  assert.equal(access.canAccess("paymentCollections"), true);
  assert.equal(access.canAccess("collectionReport"), true);
  assert.equal(access.canAccess("myDay"), false);
  assert.equal(access.canAccess("mySalesInvoices"), false);
  assert.equal(access.canAccess("salesmanHierarchy"), false);
  assert.equal(access.canAccess("upload"), false);
});

test("salesmen see field modules but not admin tools", () => {
  const access = buildModuleAccess({ role: "salesman", salesmanCode: "PARVEZ" });

  assert.equal(access.canAccess("myDay"), true);
  assert.equal(access.canAccess("newOrder"), true);
  assert.equal(access.canAccess("visitWithoutOrder"), true);
  assert.equal(access.canAccess("myCollections"), true);
  assert.equal(access.canAccess("mySalesInvoices"), true);
  assert.equal(access.canAccess("dailyVisitReport"), true);
  assert.equal(access.canAccess("gpsMap"), false);
  assert.equal(access.canAccess("salesmanHierarchy"), false);
  assert.equal(access.canAccess("upload"), false);
});

test("admin manager and invoice-maker can set pending order invoice status", () => {
  assert.equal(canManageOrderInvoice("admin"), true);
  assert.equal(canManageOrderInvoice("manager"), true);
  assert.equal(canManageOrderInvoice("invoice-maker"), true);
  assert.equal(canManageOrderInvoice("invoice_maker"), true);
  assert.equal(canManageOrderInvoice("salesman"), false);
});

test("invoice-makers can access hierarchy upload and gps map", () => {
  const access = buildModuleAccess({ role: "invoice-maker" });

  assert.equal(access.canAccess("salesmanHierarchy"), true);
  assert.equal(access.canAccess("customerBookShares"), false);
  assert.equal(access.canAccess("upload"), true);
  assert.equal(access.canAccess("gpsMap"), true);
  assert.equal(access.canAccess("userActivity"), false);
});

test("admins and managers can manage customer book shares", () => {
  assert.equal(buildModuleAccess({ role: "admin" }).canAccess("customerBookShares"), true);
  assert.equal(buildModuleAccess({ role: "manager" }).canAccess("customerBookShares"), true);
  assert.equal(buildModuleAccess({ role: "salesman", salesmanCode: "PARVEZ" }).canAccess("customerBookShares"), false);
});

test("listAccessibleModules returns only allowed modules", () => {
  const access = buildModuleAccess({ role: "admin" });
  const modules = listAccessibleModules(access, [
    "upload",
    "gpsMap",
    "myCollections",
  ]);

  assert.deepEqual(
    modules.map((module) => module.moduleKey),
    ["upload", "gpsMap"],
  );
});

test("isCollectionOnlyAccess detects collector metadata and codes", () => {
  assert.equal(isCollectionOnlyAccess({ role: "salesman", collectionOnlyMetadata: true }), true);
  assert.equal(isCollectionOnlyAccess({ role: "salesman", salesmanCode: "CL12" }), true);
  assert.equal(isCollectionOnlyAccess({ role: "salesman", salesmanCode: "PARVEZ" }), false);
});

test("invoice-makers are exempt from transaction GPS requirements", () => {
  assert.equal(shouldRequireTransactionGps("salesman"), true);
  assert.equal(shouldRequireTransactionGps("invoice-maker"), false);
  assert.equal(shouldRequireTransactionGps("invoice_maker"), false);
});

test("admin and manager bypass GPS access gate on management pages", () => {
  assert.equal(shouldRequireGpsAccessGate("admin"), false);
  assert.equal(shouldRequireGpsAccessGate("manager"), false);
  assert.equal(shouldRequireGpsAccessGate("salesman"), true);
  assert.equal(shouldRequireGpsAccessGate("invoice-maker"), false);
});

test("managers still get background GPS like other field users", () => {
  assert.equal(shouldEnableBackgroundGps("manager"), true);
  assert.equal(shouldEnableBackgroundGps("salesman"), true);
  assert.equal(shouldEnableBackgroundGps("collector"), true);
  assert.equal(shouldEnableBackgroundGps("admin"), false);
  assert.equal(shouldEnableBackgroundGps("invoice-maker"), false);
});

test("business dashboard is limited to admin and manager", () => {
  assert.equal(buildModuleAccess({ role: "admin" }).canAccess("businessDashboard"), true);
  assert.equal(buildModuleAccess({ role: "manager" }).canAccess("businessDashboard"), true);
  assert.equal(buildModuleAccess({ role: "salesman" }).canAccess("businessDashboard"), false);
  assert.equal(buildModuleAccess({ role: "collector" }).canAccess("businessDashboard"), false);
});

test("outstanding without GPS is limited to admin and manager", () => {
  assert.equal(buildModuleAccess({ role: "admin" }).canAccess("outstandingNoGps"), true);
  assert.equal(buildModuleAccess({ role: "manager" }).canAccess("outstandingNoGps"), true);
  assert.equal(buildModuleAccess({ role: "salesman" }).canAccess("outstandingNoGps"), false);
  assert.equal(localizedModuleLabel("outstandingNoGps", "en"), "Outstanding Without GPS");
});

test("salesman visit plan is available to admin and field sales after promotion", () => {
  assert.equal(buildModuleAccess({ role: "admin" }).canAccess("salesmanVisitPlan"), true);
  assert.equal(buildModuleAccess({ role: "manager" }).canAccess("salesmanVisitPlan"), true);
  assert.equal(buildModuleAccess({ role: "salesman", salesmanCode: "PARVEZ" }).canAccess("salesmanVisitPlan"), true);
  assert.equal(localizedModuleLabel("salesmanVisitPlan", "en"), "Salesman Visit Plan");
  assert.equal(isSalesmanVisitPlanSalesmanAccessApproved({}), true);
  assert.equal(isSalesmanVisitPlanSalesmanAccessApproved({
    NEXT_PUBLIC_SALESMAN_VISIT_PLAN_SALESMAN_ACCESS: "false",
  }), false);
});

test("KPI targets can be updated by admin and manager only", () => {
  assert.equal(buildModuleAccess({ role: "admin" }).canAccess("kpiTargets"), true);
  assert.equal(buildModuleAccess({ role: "manager" }).canAccess("kpiTargets"), true);
  assert.equal(buildModuleAccess({ role: "salesman" }).canAccess("kpiTargets"), false);
  assert.equal(localizedModuleLabel("kpiTargets", "en"), "KPI Targets");
});

test("schemes can be configured by admin and manager only", () => {
  assert.equal(buildModuleAccess({ role: "admin" }).canAccess("schemes"), true);
  assert.equal(buildModuleAccess({ role: "manager" }).canAccess("schemes"), true);
  assert.equal(buildModuleAccess({ role: "salesman" }).canAccess("schemes"), false);
  assert.equal(localizedModuleLabel("schemes", "en"), "Schemes");
});

test("admin shortcut buttons stay the same set on every page", () => {
  const access = buildModuleAccess({ role: "admin" });
  assert.deepEqual(pinnedModuleKeysForAccess(access), [
    "customerAudit",
    "paymentCollections",
    "upload",
    "dailyVisitReport",
  ]);
  assert.equal(pathMatchesModuleHref("/management/customer-audit", "/management/customer-audit"), true);
  assert.equal(pathMatchesModuleHref("/management/payment-collections/legal", "/management/payment-collections"), true);
  assert.equal(pathMatchesModuleHref("/management/customer-audit", "/"), false);
});

test("salesman shortcut buttons include field work not admin imports", () => {
  const access = buildModuleAccess({ role: "salesman", salesmanCode: "PARVEZ" });
  assert.deepEqual(pinnedModuleKeysForAccess(access), [
    "myDay",
    "customerAudit",
    "newOrder",
    "myCollections",
  ]);
});

test("localized module and nav labels return Arabic text", () => {
  assert.equal(localizedModuleLabel("newOrder", "ar"), "طلب جديد");
  assert.equal(localizedNavGroupLabel("collections", "ar"), "التحصيلات");
  assert.equal(moduleLabelForPath("/management/new-order", "ar"), "طلب جديد");
});
