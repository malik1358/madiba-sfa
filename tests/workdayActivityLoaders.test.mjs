import test from "node:test";
import assert from "node:assert/strict";

import { loadUsersPendingMorningLogin } from "../app/lib/workdayActivityLoaders.js";

function createAdmin({ profiles = [], morningUserIds = [] } = {}) {
  return {
    from(table) {
      if (table === "profiles") {
        return {
          select() {
            return Promise.resolve({ data: profiles, error: null });
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
