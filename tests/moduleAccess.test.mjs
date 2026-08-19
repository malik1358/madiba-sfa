import test from "node:test";
import assert from "node:assert/strict";

import {
  buildModuleAccess,
  isCollectionOnlyAccess,
  listAccessibleModules,
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
