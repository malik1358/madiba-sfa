"use client";

import { fetchJsonWithTimeout, resolveAuthSession } from "../authSession";
import {
  buildHrLeaveTemplateRows,
  HR_LEAVE_TEMPLATE_HEADERS,
  hrLeaveTemplateListOptions,
} from "./hrLeave.js";
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

/**
 * Leave historic-data template: Leave sheet + Lists sheet (Employee Code / Type / Status)
 * with Excel list validations on the data rows.
 */
export async function downloadHrLeaveTemplate(employees) {
  const XLSX = await import("xlsx");
  const lists = hrLeaveTemplateListOptions(employees);
  const leaveRows = buildHrLeaveTemplateRows(employees);
  const leaveSheet = XLSX.utils.json_to_sheet(
    leaveRows.length
      ? leaveRows
      : [{ "Employee Code": "", Type: "ANNUAL", "Start Date": "", "End Date": "", Status: "APPROVED", Notes: "" }],
    { header: HR_LEAVE_TEMPLATE_HEADERS },
  );

  const listAoA = [["Employee Code", "Type", "Status"]];
  const maxRows = Math.max(lists.employeeCodes.length, lists.types.length, lists.statuses.length, 1);
  for (let index = 0; index < maxRows; index += 1) {
    listAoA.push([
      lists.employeeCodes[index] || "",
      lists.types[index] || "",
      lists.statuses[index] || "",
    ]);
  }
  const listsSheet = XLSX.utils.aoa_to_sheet(listAoA);

  const lastDataRow = Math.max(leaveRows.length + 50, 100);
  const empEnd = Math.max(lists.employeeCodes.length, 1) + 1;
  const typeEnd = Math.max(lists.types.length, 1) + 1;
  const statusEnd = Math.max(lists.statuses.length, 1) + 1;
  leaveSheet["!dataValidation"] = [
    {
      sqref: `A2:A${lastDataRow}`,
      type: "list",
      allowBlank: true,
      formulas: [`Lists!$A$2:$A$${empEnd}`],
    },
    {
      sqref: `B2:B${lastDataRow}`,
      type: "list",
      allowBlank: false,
      formulas: [`Lists!$B$2:$B$${typeEnd}`],
    },
    {
      sqref: `E2:E${lastDataRow}`,
      type: "list",
      allowBlank: false,
      formulas: [`Lists!$C$2:$C$${statusEnd}`],
    },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, leaveSheet, "Leave");
  XLSX.utils.book_append_sheet(workbook, listsSheet, "Lists");
  XLSX.writeFile(workbook, "hr-leave-historic-template.xlsx");
}

/** Read the first sheet of an uploaded .xlsx/.xls/.csv file into header-keyed row objects. */
export async function readHrExcelFile(file) {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const preferred = workbook.SheetNames.find((name) => String(name).toLowerCase() === "leave")
    || workbook.SheetNames[0];
  const sheet = workbook.Sheets[preferred];
  if (!sheet) throw new Error("The file has no sheets.");
  return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true });
}
