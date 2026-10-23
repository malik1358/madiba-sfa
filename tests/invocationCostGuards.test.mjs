import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("build info is cacheable for one minute and the watcher does not bypass that cache", () => {
  const route = source("../app/api/build-info/route.js");
  const watcher = source("../app/components/BuildUpdateWatcher.jsx");
  assert.match(route, /force-static/);
  assert.match(route, /s-maxage=60/);
  assert.doesNotMatch(route, /no-store/);
  assert.doesNotMatch(route, /force-dynamic/);
  assert.doesNotMatch(watcher, /build-info\?ts=/);
  assert.doesNotMatch(watcher, /Pragma/);
  assert.match(watcher, /fetch\("\/api\/build-info"\)/);
});

test("role access stays fresh for five minutes across page loads", () => {
  const hook = source("../app/hooks/useModuleAccess.js");
  assert.match(hook, /5 \* 60 \* 1000/);
  assert.match(hook, /moduleAccessFresh:v1/);
  assert.match(hook, /readFreshStamp/);
});

test("login-as does not list users on every auth event", () => {
  const control = source("../app/components/AdminLoginAsControl.jsx");
  assert.match(control, /canStartAdminLoginAs\(access\.role\)/);
  assert.match(control, /openPicker/);
  assert.doesNotMatch(control, /setIsAdmin/);
});

test("offline version polling is a two-minute fallback behind realtime", () => {
  const shell = source("../app/components/PwaShell.jsx");
  assert.match(shell, /OFFLINE_VERSION_POLL_MS = 120 \* 1000/);
  assert.match(shell, /postgres_changes/);
  assert.match(shell, /document\.hidden/);
  assert.doesNotMatch(shell, /setInterval\(pollVersion, 30 \* 1000\)/);
});
