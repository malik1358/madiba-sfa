import test from "node:test";
import assert from "node:assert/strict";

import {
  loadUsersPendingMorningLogin,
  restoreActivityRemindersAfterLeave,
} from "../app/lib/workdayActivityLoaders.js";

function createAdmin({ profiles = [], morningUserIds = [], onUpdate } = {}) {
  return {
    from(table) {
      if (table === "profiles") {
        return {
          select() {
            return Promise.resolve({ data: profiles, error: null });
          },
          update(payload) {
            return {
              in(column, ids) {
                const updated = profiles
                  .filter((row) => ids.includes(row.id))
                  .map((row) => ({ ...row, ...payload }));
                onUpdate?.(payload, ids);
                return {
                  select() {
                    return Promise.resolve({ data: updated, error: null });
                  },
                };
              },
            };
          },
        };
      }

      if (table === "daily_activity_logs") {
        return {
          select() {
            return {
              eq() {
                return {
                  gte() {
                    return {
                      lte() {
                        return Promise.resolve({
                          data: morningUserIds.map((user_id) => ({ user_id })),
                          error: null,
                        });
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`unexpected table ${table}`);
    },
  };
}

test("loadUsersPendingMorningLogin skips users with activity reminders turned off", async () => {
  const users = await loadUsersPendingMorningLogin(createAdmin({
    profiles: [
      { id: "field-manager", role: "salesman", is_active: true, activity_reminders_enabled: false },
      { id: "field-salesman", role: "salesman", is_active: true, activity_reminders_enabled: true },
    ],
  }), "2026-09-07");

  assert.deepEqual(users.map((row) => row.userId), ["field-salesman"]);
});

test("loadUsersPendingMorningLogin skips JUNAID while on annual leave even if flag is on", async () => {
  const users = await loadUsersPendingMorningLogin(createAdmin({
    profiles: [
      {
        id: "junaid",
        role: "salesman",
        is_active: true,
        salesman_code: "JUNAID",
        activity_reminders_enabled: true,
      },
      {
        id: "field-salesman",
        role: "salesman",
        is_active: true,
        salesman_code: "OTHER",
        activity_reminders_enabled: true,
      },
    ],
  }), "2026-10-10");

  assert.deepEqual(users.map((row) => row.userId), ["field-salesman"]);
});

test("restoreActivityRemindersAfterLeave turns JUNAID back on from 9 Nov", async () => {
  const updates = [];
  const result = await restoreActivityRemindersAfterLeave(createAdmin({
    profiles: [
      {
        id: "junaid",
        salesman_code: "JUNAID",
        activity_reminders_enabled: false,
      },
    ],
    onUpdate: (payload, ids) => updates.push({ payload, ids }),
  }), new Date("2026-11-09T00:05:00.000Z"));

  assert.deepEqual(result.codes, ["JUNAID"]);
  assert.deepEqual(result.restored.map((row) => row.salesmanCode), ["JUNAID"]);
  assert.deepEqual(updates, [{
    payload: { activity_reminders_enabled: true },
    ids: ["junaid"],
  }]);
});

test("restoreActivityRemindersAfterLeave does nothing during leave", async () => {
  const updates = [];
  const result = await restoreActivityRemindersAfterLeave(createAdmin({
    profiles: [
      {
        id: "junaid",
        salesman_code: "JUNAID",
        activity_reminders_enabled: false,
      },
    ],
    onUpdate: (payload, ids) => updates.push({ payload, ids }),
  }), new Date("2026-11-08T12:00:00.000Z"));

  assert.deepEqual(result.codes, []);
  assert.deepEqual(result.restored, []);
  assert.deepEqual(updates, []);
});
