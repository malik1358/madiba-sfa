import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

const ANDROID_CHANNEL_ID = "madiba-push-alerts";

let messagingClient = null;

function parseServiceAccount() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured.");
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must be valid JSON.");
  }
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
  return Boolean(String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim());
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
