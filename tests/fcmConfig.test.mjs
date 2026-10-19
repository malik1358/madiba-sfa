import test from "node:test";
import assert from "node:assert/strict";

import { getFcmConfigurationStatus, isFcmConfigured } from "../app/lib/fcm.js";

const VALID_SERVICE_ACCOUNT = {
  type: "service_account",
  project_id: "madiba-sfa",
  private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
};

function withFirebaseEnv(value, fn) {
  const previous = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (value === undefined) {
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  } else {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = value;
  }

  try {
    fn();
  } finally {
    if (previous === undefined) {
      delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    } else {
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON = previous;
    }
  }
}

test("FCM is not configured when env var is missing", () => {
  withFirebaseEnv(undefined, () => {
    assert.equal(isFcmConfigured(), false);
    assert.deepEqual(getFcmConfigurationStatus(), {
      configured: false,
      reason: "fcm_not_configured",
    });
  });
});

test("FCM is not configured when env var is invalid JSON", () => {
  withFirebaseEnv("{not-json", () => {
    assert.equal(isFcmConfigured(), false);
    assert.deepEqual(getFcmConfigurationStatus(), {
      configured: false,
      reason: "fcm_invalid_json",
    });
  });
});

test("FCM is not configured when JSON is missing required fields", () => {
  withFirebaseEnv(JSON.stringify({ type: "service_account" }), () => {
    assert.equal(isFcmConfigured(), false);
    assert.deepEqual(getFcmConfigurationStatus(), {
      configured: false,
      reason: "fcm_incomplete_credentials",
    });
  });
});

test("FCM is configured for valid one-line service account JSON", () => {
  withFirebaseEnv(JSON.stringify(VALID_SERVICE_ACCOUNT), () => {
    assert.equal(isFcmConfigured(), true);
    assert.deepEqual(getFcmConfigurationStatus(), { configured: true });
  });
});

test("FCM accepts JSON wrapped in extra quotes", () => {
  withFirebaseEnv(JSON.stringify(JSON.stringify(VALID_SERVICE_ACCOUNT)), () => {
    assert.equal(isFcmConfigured(), true);
  });
});
