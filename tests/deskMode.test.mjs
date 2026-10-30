import test from "node:test";
import assert from "node:assert/strict";

import {
  DESK_MODE_CACHE_TTL_MS,
  DESK_MODE_SIGNIN_GRACE_MS,
  isAtHomeDeskLocation,
  isDeskModeCacheFresh,
  isDeskModeSignInGraceActive,
  resolveDeskModeAccess,
} from "../app/lib/deskMode.js";

const HOME = { latitude: 24.7136, longitude: 46.6753 };

test("desk mode recognizes GPS within the saved home radius", () => {
  assert.equal(isAtHomeDeskLocation({ latitude: 24.7136, longitude: 46.6753 }, HOME), true);
  assert.equal(isAtHomeDeskLocation({ latitude: 24.8, longitude: 46.8 }, HOME), false);
  assert.equal(isAtHomeDeskLocation({ latitude: 24.7136, longitude: 46.6753 }, null), false);
  assert.equal(isAtHomeDeskLocation({ latitude: 24.7136, longitude: 46.6753 }, { home_latitude: 24.7136, home_longitude: 46.6753 }), true);
});

test("desk mode access allows work at home without counting as field Login", () => {
  const atHome = resolveDeskModeAccess({
    location: { latitude: 24.7136, longitude: 46.6753 },
    homeLocation: HOME,
  });
  assert.deepEqual(atHome, { allowDeskMode: true, atHome: true, reason: "at_home" });

  const away = resolveDeskModeAccess({
    location: { latitude: 24.8, longitude: 46.8 },
    homeLocation: HOME,
  });
  assert.deepEqual(away, { allowDeskMode: false, atHome: false, reason: "away_from_home" });
});

test("fresh at-home cache and sign-in grace keep desk mode without a new GPS fix", () => {
  const now = Date.now();
  const fresh = { atHome: true, checkedAtMs: now - 1000, fromSignIn: true };
  assert.equal(isDeskModeCacheFresh(fresh, now, DESK_MODE_CACHE_TTL_MS), true);
  assert.equal(isDeskModeSignInGraceActive(fresh, now, DESK_MODE_SIGNIN_GRACE_MS), true);

  const cached = resolveDeskModeAccess({ cached: fresh, nowMs: now });
  assert.equal(cached.allowDeskMode, true);
  assert.equal(cached.reason, "cache");

  const grace = resolveDeskModeAccess({
    cached: { atHome: true, checkedAtMs: now - (DESK_MODE_CACHE_TTL_MS + 1000), fromSignIn: true },
    gpsFailed: true,
    nowMs: now,
  });
  assert.equal(grace.allowDeskMode, true);
  assert.equal(grace.reason, "signin_grace");

  const expired = resolveDeskModeAccess({
    cached: { atHome: true, checkedAtMs: now - (DESK_MODE_SIGNIN_GRACE_MS + 1000), fromSignIn: true },
    gpsFailed: true,
    nowMs: now,
  });
  assert.equal(expired.allowDeskMode, false);
  assert.equal(expired.reason, "gps_failed");
});

test("away-from-home without attendance must not get desk mode from stale cache alone when GPS says away", () => {
  const now = Date.now();
  const resolved = resolveDeskModeAccess({
    location: { latitude: 24.8, longitude: 46.8 },
    homeLocation: HOME,
    cached: { atHome: true, checkedAtMs: now, fromSignIn: true },
    nowMs: now,
  });
  assert.equal(resolved.allowDeskMode, false);
  assert.equal(resolved.reason, "away_from_home");
});
