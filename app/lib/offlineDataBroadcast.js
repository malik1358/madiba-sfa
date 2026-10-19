import { isFcmConfigured, sendPushToAllDevices } from "./fcm.js";
import {
  buildOfflineDataPushCopy,
  buildOfflineDataVersion,
  kindsNeedCustomerSnapshot,
  OFFLINE_DATA_REFRESH_TYPE,
  OFFLINE_DATA_VERSION_KEY,
  shouldPublishOfflineDataUpdate,
} from "./offlineDataBroadcastShared.js";
import { markSnapshotsRequiringRebuild, scheduleMobileFieldSnapshotRebuild } from "./server/mobileFieldSnapshot.js";

export {
  buildOfflineDataPushCopy,
  buildOfflineDataVersion,
  hashOfflineDataContent,
  kindsNeedCustomerSnapshot,
  kindsNeedPriceCache,
  normalizeOfflineDataKinds,
  OFFLINE_DATA_KINDS,
  OFFLINE_DATA_REFRESH_TYPE,
  OFFLINE_DATA_VERSION_KEY,
  parseOfflineRefreshKinds,
  shouldApplyOfflineDataVersion,
  shouldPublishOfflineDataUpdate,
} from "./offlineDataBroadcastShared.js";

export async function writeOfflineDataVersion(admin, payload) {
  const { error } = await admin
    .from("system_settings")
    .upsert({
      setting_key: OFFLINE_DATA_VERSION_KEY,
      setting_value: JSON.stringify(payload),
    }, { onConflict: "setting_key" });

  if (error) throw error;
  return payload;
}

export async function readOfflineDataVersion(admin) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", OFFLINE_DATA_VERSION_KEY)
    .maybeSingle();

  if (error) throw error;

  try {
    return JSON.parse(data?.setting_value || "null");
  } catch {
    return null;
  }
}

export async function publishOfflineDataUpdate(admin, options = {}) {
  const previous = await readOfflineDataVersion(admin);
  if (!shouldPublishOfflineDataUpdate(previous, options.contentHash)) {
    return {
      payload: previous,
      push: { skipped: true, unchanged: true, successCount: 0, failureCount: 0 },
    };
  }

  const payload = buildOfflineDataVersion({
    ...options,
    contentHash: options.contentHash,
  });
  await writeOfflineDataVersion(admin, payload);

  if (kindsNeedCustomerSnapshot(payload.kinds)) {
    await markSnapshotsRequiringRebuild(admin, {
      version: payload.version,
      trigger: payload.trigger,
    });
  }

  let push = { skipped: true, successCount: 0, failureCount: 0 };
  if (isFcmConfigured()) {
    const copy = buildOfflineDataPushCopy(payload.kinds);
    push = await sendPushToAllDevices(admin, {
      title: copy.title,
      body: copy.body,
      data: {
        type: OFFLINE_DATA_REFRESH_TYPE,
        kinds: payload.kinds.join(","),
        version: String(payload.version),
        trigger: payload.trigger,
      },
    });
  }

  if (kindsNeedCustomerSnapshot(payload.kinds)) {
    scheduleMobileFieldSnapshotRebuild(admin, { trigger: payload.trigger }).catch((error) => {
      console.error("Mobile snapshot rebuild after offline data publish failed:", error);
    });
  }

  return { payload, push };
}
