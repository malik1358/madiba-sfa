"use client";

import { fetchJsonWithTimeout, resolveAuthSession } from "../authSession";
import { buildHrMonthlyTemplateRows, HR_MONTHLY_TEMPLATE_HEADERS } from "./hrMonthlyFeed.js";

/** Call an /api/hr route with the signed-in user's bearer token. Throws on failure. */
export async function hrFetch(supabase, path, { method = "GET", body, params, timeoutMs = 60000 } = {}) {
  const session = await resolveAuthSession(supabase, 12000);
  if (!session?.access_token) throw new Error("Please login again.");

  const query = params ? `?${new URLSearchParams(params).toString()}` : "";
  const headers = { Authorization: `Bearer ${session.access_token}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const { response, payload } = await fetchJsonWithTimeout(
    `${path}${query}`,
    {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
    timeoutMs,
  );
  if (!response.ok || !payload?.success) {
    const error = new Error(payload?.error || "HR request failed.");
    error.migrationRequired = Boolean(payload?.migrationRequired);
    throw error;
  }
  return payload;
}

export function formatHrAmount(value) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function currentHrMonth(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}

export function compareTone(current, previous) {
  if (previous == null) return "";
  const left = Number(current || 0);
  const right = Number(previous || 0);
  if (left > right) return "moduleBiMonthCell--up";
  if (left < right) return "moduleBiMonthCell--down";
  return "";
}

/** Download the monthly Excel template pre-filled with the active staff list. */
export async function downloadHrMonthlyTemplate(employees, month) {
  const XLSX = await import("xlsx");
  const worksheet = XLSX.utils.json_to_sheet(buildHrMonthlyTemplateRows(employees), {
    header: HR_MONTHLY_TEMPLATE_HEADERS,
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "HR Monthly");
  XLSX.writeFile(workbook, `hr-monthly-template-${month}.xlsx`);
}

/** Read the first sheet of an uploaded .xlsx/.xls/.csv file into header-keyed row objects. */
export async function readHrExcelFile(file) {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("The file has no sheets.");
  return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true });
}
