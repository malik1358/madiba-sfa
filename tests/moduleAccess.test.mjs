import test from "node:test";
import assert from "node:assert/strict";

import {
  buildModuleAccess,
  isCollectionOnlyAccess,
  listAccessibleModules,
  localizedModuleLabel,
  localizedNavGroupLabel,
  moduleLabelForPath,
  shouldRequireTransactionGps,
  shouldRequireGpsAccessGate,
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
  assert.equal(access.canAccess("salesmanHierarchy"), false);
  assert.equal(access.canAccess("upload"), false);
});

test("salesmen see field modules but not admin tools", () => {
  const access = buildModuleAccess({ role: "salesman", salesmanCode: "PARVEZ" });

  assert.equal(access.canAccess("myDay"), true);
  assert.equal(access.canAccess("newOrder"), true);
  assert.equal(access.canAccess("visitWithoutOrder"), true);
  assert.equal(access.canAccess("myCollections"), true);
  assert.equal(access.canAccess("dailyVisitReport"), true);
  assert.equal(access.canAccess("gpsMap"), false);
  assert.equal(access.canAccess("salesmanHierarchy"), false);
  assert.equal(access.canAccess("upload"), false);
});

test("invoice-makers can access hierarchy upload and gps map", () => {
  const access = buildModuleAccess({ role: "invoice-maker" });

  assert.equal(access.canAccess("salesmanHierarchy"), true);
  assert.equal(access.canAccess("upload"), true);
  assert.equal(access.canAccess("gpsMap"), true);
  assert.equal(access.canAccess("userActivity"), false);
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

test("localized module and nav labels return Arabic text", () => {
  assert.equal(localizedModuleLabel("newOrder", "ar"), "طلب جديد");
  assert.equal(localizedNavGroupLabel("collections", "ar"), "التحصيلات");
  assert.equal(moduleLabelForPath("/management/new-order", "ar"), "طلب جديد");
});
