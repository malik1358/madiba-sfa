import test from "node:test";
import assert from "node:assert/strict";

import {
  isSessionLimitExemptRole,
  sessionIdFromAccessToken,
  sessionPlatformFromUserAgent,
  sessionsToRevoke,
} from "../app/lib/authSessionLimit.js";

const WEB = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/155.0.0.0 Safari/537.36";
const ANDROID = "Mozilla/5.0 (Linux; Android 16; TB336ZU Build/BP2A.250605.031.A3; wv) AppleWebKit/537.36 Version/4.0 Chrome/155.0.8059.4";
const PHONE_BROWSER = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/155.0.0.0 Mobile Safari/537.36";

test("classifies the Android app separately from browsers", () => {
  assert.equal(sessionPlatformFromUserAgent(ANDROID), "android");
  assert.equal(sessionPlatformFromUserAgent(WEB), "web");
  assert.equal(sessionPlatformFromUserAgent(PHONE_BROWSER), "web");
  assert.equal(sessionPlatformFromUserAgent(""), "");
});

test("admin keeps every session", () => {
  assert.equal(isSessionLimitExemptRole("admin"), true);
  assert.equal(isSessionLimitExemptRole(" report_user "), false);
  assert.deepEqual(sessionsToRevoke({
    role: "admin",
    currentSessionId: "new",
    currentUserAgent: WEB,
    sessions: [
      { id: "old-web", user_agent: WEB },
      { id: "old-android", user_agent: ANDROID },
    ],
  }), []);
});

test("a new browser sign-in revokes other browser sessions only", () => {
  assert.deepEqual(sessionsToRevoke({
    role: "salesman",
    currentSessionId: "new-web",
    currentUserAgent: WEB,
    sessions: [
      { id: "new-web", user_agent: WEB },
      { id: "old-web", user_agent: PHONE_BROWSER },
      { id: "android-app", user_agent: ANDROID },
    ],
  }), ["old-web"]);
});

test("a new Android app sign-in keeps the browser session", () => {
  assert.deepEqual(sessionsToRevoke({
    role: "invoice-maker",
    currentSessionId: "new-android",
    currentUserAgent: ANDROID,
    sessions: [
      { id: "new-android", user_agent: ANDROID },
      { id: "old-android", user_agent: ANDROID },
      { id: "browser", user_agent: WEB },
    ],
  }), ["old-android"]);
});

test("reads the session id from the access token", () => {
  const body = Buffer.from(JSON.stringify({ session_id: "session-1" })).toString("base64url");
  assert.equal(sessionIdFromAccessToken(`aaa.${body}.sig`), "session-1");
  assert.equal(sessionIdFromAccessToken("not-a-token"), "");
});
