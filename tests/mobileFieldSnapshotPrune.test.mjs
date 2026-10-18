import test from "node:test";
import assert from "assert/strict";

import {
  listActiveMobileSnapshotSettingKeys,
  pruneOrphanMobileFieldSnapshots,
  SNAPSHOT_SETTING_PREFIX,
} from "../app/lib/mobileFieldSnapshotPrune.js";

test("listActiveMobileSnapshotSettingKeys unions snapshots and user mappings", () => {
  const keys = listActiveMobileSnapshotSettingKeys({
    snapshots: { "all::all": { version: 1 }, "A::B": { version: 2 } },
    userSnapshotKeys: { "user-1": "all::all", "user-2": "C::D" },
  });
  assert.deepEqual(keys.sort(), [
    `${SNAPSHOT_SETTING_PREFIX}A::B`,
    `${SNAPSHOT_SETTING_PREFIX}C::D`,
    `${SNAPSHOT_SETTING_PREFIX}all::all`,
  ]);
});

test("pruneOrphanMobileFieldSnapshots deletes keys not in meta", async () => {
  const deleted = [];
  const admin = {
    from() {
      const builder = {
        select() { return builder; },
        like() {
          return Promise.resolve({
            data: [
              { setting_key: `${SNAPSHOT_SETTING_PREFIX}keep` },
              { setting_key: `${SNAPSHOT_SETTING_PREFIX}gone` },
            ],
            error: null,
          });
        },
        delete() { return builder; },
        in(_column, keys) {
          deleted.push(...keys);
          return Promise.resolve({ error: null });
        },
      };
      return builder;
    },
  };

  const result = await pruneOrphanMobileFieldSnapshots(admin, {
    snapshots: { keep: { version: 1 } },
    userSnapshotKeys: {},
  });
  assert.equal(result.deleted, 1);
  assert.deepEqual(deleted, [`${SNAPSHOT_SETTING_PREFIX}gone`]);
});
