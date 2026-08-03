"use client";
import React, { Fragment } from "react";
import { monthName, numberFormat } from "./lib/format";
import { trendClass } from "./lib/analytics";

export default function MonthlyPerformance({ analytics }) {
  if (!analytics) return null;

  return (
    <section className="auditSection">
      <h3>Monthly Performance</h3>

      <div className="auditTableScroll">
        <table className="auditMatrix auditPerformanceMatrix">
          <thead>
            <tr className="auditYearRow">
              <th rowSpan="2">Metric</th>

              {analytics.yearGroups.map((group) => (
                <th key={group.year} colSpan={group.months.length} className="auditYearHeader">
                  {group.year}
                </th>
              ))}

              <th rowSpan="2" className="auditTotalHeader">
                Total
              </th>
            </tr>

            <tr className="auditMonthRow">
              {analytics.months.map((month) => (
                <th key={month}>{monthName(month)}</th>
              ))}
            </tr>
          </thead>

          <tbody>
            <tr>
              <th>Sales</th>

              {analytics.monthlySummary.map((month, index) => {
                const previous = index > 0 ? analytics.monthlySummary[index - 1].sales : 0;

                return (
                  <td key={month.month} className={trendClass(month.sales, previous, index > 0)}>
                    {numberFormat(month.sales)}
                  </td>
                );
              })}

              <td className="auditMatrixTotal">
                {numberFormat(analytics.monthlySummary.reduce((total, m) => total + m.sales, 0))}
              </td>
            </tr>

            <tr>
              <th>SKUs Sold</th>

              {analytics.monthlySummary.map((month, index) => {
                const previous = index > 0 ? analytics.monthlySummary[index - 1].skuCount : 0;

                return (
                  <td key={month.month} className={trendClass(month.skuCount, previous, index > 0)}>
                    {month.skuCount}
                  </td>
                );
              })}

              <td className="auditMatrixTotal">{analytics.itemCount}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
