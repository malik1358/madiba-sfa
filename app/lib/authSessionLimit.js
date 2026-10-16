const ANDROID_WEBVIEW_USER_AGENT = /;\s*wv\)/i;

export function sessionIdFromAccessToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length < 2) return "";

  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    );
    return String(payload.session_id || "").trim();
  } catch {
    return "";
  }
}

/** Android app WebView versus any browser. Blank user agents are unclassified. */
export function sessionPlatformFromUserAgent(userAgent) {
  const value = String(userAgent || "");
  if (!value.trim()) return "";
  return ANDROID_WEBVIEW_USER_AGENT.test(value) ? "android" : "web";
}

export function normalizeSessionPlatform(value) {
  const platform = String(value || "").trim().toLowerCase();
  return platform === "android" || platform === "web" ? platform : "";
}

export function isSessionLimitExemptRole(role) {
  return String(role || "").trim().toLowerCase().replace(/_/g, "-") === "admin";
}

export function resolveCurrentSessionPlatform(userAgent, requestedPlatform) {
  return sessionPlatformFromUserAgent(userAgent)
    || normalizeSessionPlatform(requestedPlatform)
    || "web";
}

export function sessionsToRevoke({
  role,
  currentSessionId,
  currentUserAgent,
  requestedPlatform,
  sessions,
} = {}) {
  if (isSessionLimitExemptRole(role)) return [];

  const platform = resolveCurrentSessionPlatform(currentUserAgent, requestedPlatform);
  const currentId = String(currentSessionId || "");

  return (Array.isArray(sessions) ? sessions : [])
    .filter((session) => {
      const id = String(session?.id || "");
      if (!id || id === currentId) return false;
      const otherPlatform = sessionPlatformFromUserAgent(session?.user_agent) || "web";
      return otherPlatform === platform;
    })
    .map((session) => String(session.id));
}

export async function postSinglePlatformSession({
  accessToken,
  platform,
  fetchImpl = fetch,
} = {}) {
  const token = String(accessToken || "").trim();
  if (!token) return { revoked: 0, limited: false };

  const response = await fetchImpl("/api/auth/session-limit", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ platform: normalizeSessionPlatform(platform) || "web" }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    return { revoked: 0, limited: false };
  }

  return {
    revoked: Number(payload.revoked || 0),
    limited: payload.limited !== false,
  };
}
