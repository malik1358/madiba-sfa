import { probeGpsLocationWithRetries } from "./geo.js";
import {
  clearDeskModeState,
  isDeskModeCacheFresh,
  readDeskModeState,
  resolveDeskModeAccess,
  writeDeskModeState,
} from "./deskMode.js";

/**
 * When morning attendance is missing, allow app use only while GPS confirms the
 * saved home pin (desk / work-from-home). Leaving home clears desk mode so the
 * usual Login (MORNING_ATTENDANCE) gate applies again.
 */
export async function evaluateDeskModeForMissingAttendance({
  userId,
  homeLatitude,
  homeLongitude,
  forceRefresh = false,
} = {}) {
  if (!userId) {
    return { allowDeskMode: false, atHome: false, reason: "no_user" };
  }

  const homeLocation = {
    latitude: homeLatitude,
    longitude: homeLongitude,
  };
  const cached = readDeskModeState(userId);

  if (!forceRefresh && isDeskModeCacheFresh(cached)) {
    return resolveDeskModeAccess({ cached, homeLocation });
  }

  try {
    const location = await probeGpsLocationWithRetries({
      attempts: 2,
      timeoutMs: 8000,
      retryDelayMs: 800,
    });
    const resolved = resolveDeskModeAccess({ location, homeLocation, cached });
    if (resolved.atHome) {
      writeDeskModeState(userId, {
        atHome: true,
        fromSignIn: Boolean(cached?.fromSignIn),
      });
    } else {
      clearDeskModeState(userId);
    }
    return resolved;
  } catch {
    const resolved = resolveDeskModeAccess({
      homeLocation,
      cached,
      gpsFailed: true,
    });
    return resolved;
  }
}
