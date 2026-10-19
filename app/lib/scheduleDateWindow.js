import { getKsaDateString } from "./workdayActivity.js";

export function getScheduleTodayKey(now = new Date()) {
  return getKsaDateString(now);
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
  const key = String(dateKey || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  return key <= getScheduleWindowEndDateKey(todayKey);
}

export function filterScheduleDateGroups(groups, todayKey = getScheduleTodayKey()) {
  return (groups || []).filter((group) => isScheduleDateInWindow(group?.dateKey, todayKey));
}
