import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("vercel.json enables Git deployments for main only", () => {
  const config = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
  assert.deepEqual(config.git?.deploymentEnabled, {
    "**": false,
    main: true,
  });
  assert.ok(
    Array.isArray(config.crons) && config.crons.some((c) => c.path === "/api/cron/inactivity-push"),
    "inactivity-push cron must remain registered",
  );
});
