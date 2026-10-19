import { monthName, numberFormat } from "../management/customer-audit/lib/format.js";

const TITLE_HEIGHT = 18;
const YEAR_ROW_HEIGHT = 16;
const MONTH_ROW_HEIGHT = 16;
const DATA_ROW_HEIGHT = 18;
const AFTER_TABLE_GAP = 12;
const METRIC_COL_WIDTH = 78;
const TOTAL_COL_WIDTH = 68;

const COLORS = {
  headerBg: [11, 83, 100],
  headerText: [255, 255, 255],
  monthBg: [237, 243, 245],
  monthText: [49, 84, 94],
  metricBg: [247, 250, 251],
  metricText: [18, 63, 75],
  totalBg: [234, 239, 241],
  border: [164, 183, 188],
  upBg: [241, 250, 245],
  upText: [22, 131, 79],
  downBg: [255, 244, 244],
  downText: [198, 60, 60],
  sameText: [83, 107, 114],
  bodyText: [20, 20, 20],
};

export function monthTrend(current, previous, hasPrevious = true) {
  if (!hasPrevious) return "none";

  const currentValue = Number(current || 0);
  const previousValue = Number(previous || 0);

  if (currentValue > previousValue) return "up";
  if (currentValue < previousValue) return "down";
  return "same";
}

export function buildMonthlyPerformancePdfModel(analytics) {
  const months = Array.isArray(analytics?.months) ? analytics.months : [];
  const monthlySummary = Array.isArray(analytics?.monthlySummary) ? analytics.monthlySummary : [];
  if (!months.length || monthlySummary.length !== months.length) return null;

  const yearGroups = Array.isArray(analytics?.yearGroups) && analytics.yearGroups.length
    ? analytics.yearGroups.map((group) => ({
        year: String(group.year || ""),
        colSpan: Array.isArray(group.months) ? group.months.length : 0,
      })).filter((group) => group.year && group.colSpan > 0)
    : [];

  const salesCells = monthlySummary.map((month, index) => ({
    text: numberFormat(month.sales),
    trend: monthTrend(month.sales, index > 0 ? monthlySummary[index - 1].sales : 0, index > 0),
  }));

  const skuCells = monthlySummary.map((month, index) => ({
    text: String(month.skuCount ?? 0),
    trend: monthTrend(month.skuCount, index > 0 ? monthlySummary[index - 1].skuCount : 0, index > 0),
  }));

  const salesTotal = monthlySummary.reduce((total, month) => total + Number(month.sales || 0), 0);

  return {
    title: "Monthly Performance",
    yearGroups,
    months: months.map((month) => ({
      key: month,
      label: String(monthName(month) || month).toUpperCase(),
    })),
    rows: [
      {
        label: "Sales",
        cells: salesCells,
        total: numberFormat(salesTotal),
      },
      {
        label: "SKUs Sold",
        cells: skuCells,
        total: String(analytics.itemCount ?? monthlySummary.reduce((total, month) => total + Number(month.skuCount || 0), 0)),
      },
    ],
  };
}

export function measureMonthlyPerformancePdfHeight(model) {
  if (!model) return 0;
  return TITLE_HEIGHT + YEAR_ROW_HEIGHT + MONTH_ROW_HEIGHT + model.rows.length * DATA_ROW_HEIGHT + AFTER_TABLE_GAP;
}

function trendColors(trend) {
  if (trend === "up") return { fill: COLORS.upBg, text: COLORS.upText };
  if (trend === "down") return { fill: COLORS.downBg, text: COLORS.downText };
  if (trend === "same") return { fill: [255, 255, 255], text: COLORS.sameText };
  return { fill: [255, 255, 255], text: COLORS.bodyText };
}

function drawFilledCell(doc, x, y, width, height, fill, text, options = {}) {
  const {
    textColor = COLORS.bodyText,
    align = "center",
    fontStyle = "normal",
    fontSize = 8,
  } = options;

  doc.setFillColor(...fill);
  doc.setDrawColor(...COLORS.border);
  doc.setLineWidth(0.4);
  doc.rect(x, y, width, height, "FD");
  doc.setFont(undefined, fontStyle);
  doc.setFontSize(fontSize);
  doc.setTextColor(...textColor);

  const textY = y + height / 2 + 3;
  if (align === "right") {
    doc.text(String(text), x + width - 5, textY, { align: "right" });
  } else if (align === "left") {
    doc.text(String(text), x + 5, textY);
  } else {
    doc.text(String(text), x + width / 2, textY, { align: "center" });
  }

  doc.setTextColor(...COLORS.bodyText);
  doc.setFont(undefined, "normal");
}

export function drawMonthlyPerformancePdf(doc, model, x, y, maxWidth) {
  if (!doc || !model) return y;

  const tableWidth = maxWidth;
  const monthCount = Math.max(model.months.length, 1);
  const monthColWidth = Math.max(36, (tableWidth - METRIC_COL_WIDTH - TOTAL_COL_WIDTH) / monthCount);

  doc.setFont(undefined, "bold");
  doc.setFontSize(11);
  doc.setTextColor(...COLORS.metricText);
  doc.text(model.title, x, y + 11);
  doc.setTextColor(...COLORS.bodyText);
  doc.setFont(undefined, "normal");

  let rowY = y + TITLE_HEIGHT;
  let colX = x;

  drawFilledCell(doc, colX, rowY, METRIC_COL_WIDTH, YEAR_ROW_HEIGHT + MONTH_ROW_HEIGHT, COLORS.metricBg, "Metric", {
    textColor: COLORS.metricText,
    align: "left",
    fontStyle: "bold",
    fontSize: 8,
  });
  colX += METRIC_COL_WIDTH;

  if (model.yearGroups.length) {
    model.yearGroups.forEach((group) => {
      const width = monthColWidth * group.colSpan;
      drawFilledCell(doc, colX, rowY, width, YEAR_ROW_HEIGHT, COLORS.headerBg, group.year, {
        textColor: COLORS.headerText,
        fontStyle: "bold",
        fontSize: 8,
      });
      colX += width;
    });
  } else {
    const width = monthColWidth * monthCount;
    drawFilledCell(doc, colX, rowY, width, YEAR_ROW_HEIGHT, COLORS.headerBg, "", {
      textColor: COLORS.headerText,
    });
    colX += width;
  }

  drawFilledCell(doc, colX, rowY, TOTAL_COL_WIDTH, YEAR_ROW_HEIGHT + MONTH_ROW_HEIGHT, COLORS.headerBg, "Total", {
    textColor: COLORS.headerText,
    fontStyle: "bold",
    fontSize: 8,
  });

  colX = x + METRIC_COL_WIDTH;
  const monthY = rowY + YEAR_ROW_HEIGHT;
  model.months.forEach((month) => {
    drawFilledCell(doc, colX, monthY, monthColWidth, MONTH_ROW_HEIGHT, COLORS.monthBg, month.label, {
      textColor: COLORS.monthText,
      fontStyle: "bold",
      fontSize: 7,
    });
    colX += monthColWidth;
  });

  rowY += YEAR_ROW_HEIGHT + MONTH_ROW_HEIGHT;

  model.rows.forEach((row) => {
    colX = x;
    drawFilledCell(doc, colX, rowY, METRIC_COL_WIDTH, DATA_ROW_HEIGHT, COLORS.metricBg, row.label, {
      textColor: COLORS.metricText,
      align: "left",
      fontStyle: "bold",
      fontSize: 8,
    });
    colX += METRIC_COL_WIDTH;

    row.cells.forEach((cell) => {
      const colors = trendColors(cell.trend);
      drawFilledCell(doc, colX, rowY, monthColWidth, DATA_ROW_HEIGHT, colors.fill, cell.text, {
        textColor: colors.text,
        fontStyle: cell.trend === "none" ? "normal" : "bold",
        fontSize: 8,
      });
      colX += monthColWidth;
    });

    drawFilledCell(doc, colX, rowY, TOTAL_COL_WIDTH, DATA_ROW_HEIGHT, COLORS.totalBg, row.total, {
      textColor: COLORS.metricText,
      fontStyle: "bold",
      fontSize: 8,
    });

    rowY += DATA_ROW_HEIGHT;
  });

  return rowY + AFTER_TABLE_GAP;
}

export function appendMonthlyPerformanceToPdf(doc, {
  analytics,
  x,
  y,
  maxWidth,
  ensureSpace,
} = {}) {
  const model = buildMonthlyPerformancePdfModel(analytics);
  if (!model) {
    return typeof y === "function" ? y() : Number(y || 0);
  }

  const height = measureMonthlyPerformancePdfHeight(model);
  if (typeof ensureSpace === "function") ensureSpace(height);
  const startY = typeof y === "function" ? y() : Number(y || 0);
  return drawMonthlyPerformancePdf(doc, model, x, startY, maxWidth);
}
