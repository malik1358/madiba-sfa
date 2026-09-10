import { getKsaDateString } from "./workdayActivity.js";

export const PAST_SCHEDULE_GROUP_KEY = "past";

export function getScheduleTodayKey(now = new Date()) {
  return getKsaDateString(now);
}

export function resolveScheduleDateKey(value) {
  const match = String(value || "").trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

export function addDaysToDateKey(dateKey, days) {
  const match = String(dateKey || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "";
  const date = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]) + Number(days || 0),
  ));
  return date.toISOString().slice(0, 10);
}

export function getScheduleWindowEndDateKey(todayKey = getScheduleTodayKey()) {
  return addDaysToDateKey(todayKey, 1);
}

export function isScheduleDateInWindow(dateKey, todayKey = getScheduleTodayKey()) {
  const key = resolveScheduleDateKey(dateKey);
  if (!key) return false;
  return key <= getScheduleWindowEndDateKey(todayKey);
}

export function scheduleDisplayGroupKey(dateKey, todayKey = getScheduleTodayKey()) {
  const key = resolveScheduleDateKey(dateKey);
  if (!key || !isScheduleDateInWindow(key, todayKey)) return "";
  return key < todayKey ? PAST_SCHEDULE_GROUP_KEY : key;
}

export function filterScheduleDateGroups(groups, todayKey = getScheduleTodayKey()) {
  return (groups || []).filter((group) => isScheduleDateInWindow(group?.dateKey, todayKey));
}

export function groupScheduleRowsByDisplayDate(rows, getDateKey, todayKey = getScheduleTodayKey()) {
  const groups = new Map();

  (rows || []).forEach((row) => {
    const groupKey = scheduleDisplayGroupKey(getDateKey(row), todayKey);
    if (!groupKey) return;
    const current = groups.get(groupKey) || [];
    current.push(row);
    groups.set(groupKey, current);
  });

  const tomorrowKey = getScheduleWindowEndDateKey(todayKey);
  return [PAST_SCHEDULE_GROUP_KEY, todayKey, tomorrowKey]
    .filter((key) => groups.has(key))
    .map((dateKey) => ({ dateKey, rows: groups.get(dateKey) || [] }));
}
