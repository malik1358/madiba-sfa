import {
  isValidHrMonth,
  listHrMonthsBack,
  summarizePayrollByDepartment,
  summarizePayrollByMonth,
} from "../../../lib/hr/hrMonthlyFeed.js";
import {
  HrHttpError,
  authenticateHr,
  hrErrorResponse,
  loadHrEmployees,
  loadHrMonthlyRecords,
} from "../../../lib/hr/hrServer.js";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

/** Monthly payroll totals (+ department split for the end month). Totals only, no per-person pay. */
export async function GET(request) {
  try {
    const { admin } = await authenticateHr(request, "payroll");
    const url = new URL(request.url);
    const endMonth = String(url.searchParams.get("endMonth") || "").trim();
    if (!isValidHrMonth(endMonth)) throw new HrHttpError(400, "Invalid endMonth. Use YYYY-MM.");
    const count = Math.min(24, Math.max(1, Number(url.searchParams.get("months")) || 6));
    const finalOnly = url.searchParams.get("finalOnly") === "1";

    const months = listHrMonthsBack(endMonth, count);
    const [employees, allRecords] = await Promise.all([
      loadHrEmployees(admin),
      loadHrMonthlyRecords(admin, { fromMonth: months[0], toMonth: endMonth }),
    ]);
    const records = finalOnly ? allRecords.filter((record) => record.status === "FINAL") : allRecords;

    const byMonth = new Map(summarizePayrollByMonth(records).map((row) => [row.month, row]));
    const monthRows = months.map((month) => byMonth.get(month) || {
      month,
      employeeCount: 0,
      grossEarnings: 0,
      totalDeductions: 0,
      netPay: 0,
      finalCount: 0,
      draftCount: 0,
    });

    return Response.json({
      success: true,
      endMonth,
      months: monthRows,
      departments: summarizePayrollByDepartment(records, new Map(employees.map((e) => [e.id, e])), endMonth),
    });
  } catch (error) {
    return hrErrorResponse(error);
  }
}
