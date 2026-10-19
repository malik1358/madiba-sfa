import test from "node:test";
import assert from "node:assert/strict";

import {
  isAndroidApkVersionOutdated,
  parseAndroidApkMinVersionConfig,
  resolveAndroidApkMinVersionConfig,
} from "../app/lib/androidAppVersionPolicy.js";

test("isAndroidApkVersionOutdated compares build numbers", () => {
  assert.equal(isAndroidApkVersionOutdated(150, 200), true);
  assert.equal(isAndroidApkVersionOutdated(200, 200), false);
  assert.equal(isAndroidApkVersionOutdated(201, 200), false);
  assert.equal(isAndroidApkVersionOutdated(0, 0), false);
  assert.equal(isAndroidApkVersionOutdated(1, 200), true);
});

test("resolveAndroidApkMinVersionConfig prefers the highest required build", () => {
  const resolved = resolveAndroidApkMinVersionConfig({
    settingValue: {
      minVersionCode: 180,
      minVersionName: "1.0.180",
      downloadUrl: "https://example.com/from-db",
    },
    envVersionCode: 200,
    envVersionName: "1.0.200",
    envDownloadUrl: "https://example.com/from-env",
  });

  assert.equal(resolved.minVersionCode, 200);
  assert.equal(resolved.minVersionName, "1.0.180");
  assert.equal(resolved.downloadUrl, "https://example.com/from-db");
});

test("parseAndroidApkMinVersionConfig accepts JSON strings", () => {
  assert.deepEqual(
    parseAndroidApkMinVersionConfig('{"minVersionCode":125,"minVersionName":"1.0.125"}'),
    {
      minVersionCode: 125,
      minVersionName: "1.0.125",
      downloadUrl: "",
      messageEn: "",
      messageAr: "",
    },
  );
});
