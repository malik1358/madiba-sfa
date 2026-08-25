import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

const ANDROID_CHANNEL_ID = "madiba-push-alerts";

let messagingClient = null;

function unwrapParsedServiceAccount(parsed) {
  if (typeof parsed === "string") {
    const nested = String(parsed || "").trim();
    if (nested.startsWith("{")) {
      return JSON.parse(nested);
    }
  }
  return parsed;
}

function tryParseServiceAccountRaw(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;

  const candidates = [trimmed];
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    candidates.push(trimmed.slice(1, -1));
  }

  for (const candidate of candidates) {
    try {
      return unwrapParsedServiceAccount(JSON.parse(candidate));
    } catch {
      // try next candidate
    }
  }

  return null;
}

function parseServiceAccount() {
  const parsed = tryParseServiceAccountRaw(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (!parsed) {
    const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
    if (!raw) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured.");
    }
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must be valid JSON.");
  }
  return parsed;
}

export function getFcmConfigurationStatus() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) {
    return { configured: false, reason: "fcm_not_configured" };
  }

  const parsed = tryParseServiceAccountRaw(raw);
  if (!parsed || typeof parsed !== "object") {
    return { configured: false, reason: "fcm_invalid_json" };
  }

  if (!parsed.type || !parsed.project_id || !parsed.private_key) {
    return { configured: false, reason: "fcm_incomplete_credentials" };
  }

  return { configured: true };
}

function getMessagingClient() {
  if (messagingClient) return messagingClient;

  if (!getApps().length) {
    initializeApp({
      credential: cert(parseServiceAccount()),
    });
  }

  messagingClient = getMessaging();
  return messagingClient;
}

export function isFcmConfigured() {
  return getFcmConfigurationStatus().configured;
}

function isInvalidTokenError(error) {
  const code = String(error?.code || error?.errorInfo?.code || "");
  return [
    "messaging/registration-token-not-registered",
    "messaging/invalid-registration-token",
  ].includes(code);
}

export async function sendPushToTokens(tokens, { title, body, data = {} }) {
  const uniqueTokens = [...new Set((tokens || []).map((token) => String(token || "").trim()).filter(Boolean))];
  if (uniqueTokens.length === 0) {
    return { successCount: 0, failureCount: 0, invalidTokens: [] };
  }

  const messaging = getMessagingClient();
  let successCount = 0;
  let failureCount = 0;
  const invalidTokens = [];

  await Promise.all(uniqueTokens.map(async (token) => {
    try {
      await messaging.send({
        token,
        notification: {
          title: String(title || "MADIBA SFA"),
          body: String(body || ""),
        },
        data: Object.fromEntries(
          Object.entries(data || {}).map(([key, value]) => [String(key), String(value ?? "")]),
        ),
        android: {
          priority: "high",
          notification: {
            channelId: ANDROID_CHANNEL_ID,
            sound: "default",
          },
        },
      });
      successCount += 1;
    } catch (error) {
      failureCount += 1;
      if (isInvalidTokenError(error)) {
        invalidTokens.push(token);
      }
    }
  }));

  return { successCount, failureCount, invalidTokens };
}

export async function sendPushToUser(admin, userId, payload) {
  const { data: tokenRows, error } = await admin
    .from("device_push_tokens")
    .select("token")
    .eq("user_id", userId);

  if (error) throw error;

  const tokens = (tokenRows || []).map((row) => row.token).filter(Boolean);
  const result = await sendPushToTokens(tokens, payload);

  if (result.invalidTokens.length > 0) {
    await admin
      .from("device_push_tokens")
      .delete()
      .eq("user_id", userId)
      .in("token", result.invalidTokens);
  }

  return result;
}
