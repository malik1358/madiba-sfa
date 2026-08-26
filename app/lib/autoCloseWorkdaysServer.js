import {
  buildAutoCloseEndOfDayPayload,
  collectWorkdaysNeedingAutoClose,
} from "./workdayActivity.js";

const LOOKBACK_DAYS = 14;

export async function runAutoCloseWorkdaysCycle(admin, now = new Date()) {
  if (!admin) {
    return { closedCount: 0, closed: [] };
  }

  const lookbackStart = new Date(now);
  lookbackStart.setUTCDate(lookbackStart.getUTCDate() - LOOKBACK_DAYS);

  const { data, error } = await admin
    .from("daily_activity_logs")
    .select("user_id,entry_type,note,created_at")
    .in("entry_type", ["MORNING_ATTENDANCE", "END_OF_DAY"])
    .gte("created_at", lookbackStart.toISOString())
    .order("created_at", { ascending: true });

  if (error) throw error;

  const pending = collectWorkdaysNeedingAutoClose(data || [], now);
  const closed = [];

  for (const { userId, day } of pending) {
    const payload = buildAutoCloseEndOfDayPayload(userId, day);
    if (!payload) continue;

    const { error: insertError } = await admin.from("daily_activity_logs").insert(payload);
    if (insertError) throw insertError;

    closed.push({ userId, day });
  }

  return {
    closedCount: closed.length,
    closed,
  };
}
