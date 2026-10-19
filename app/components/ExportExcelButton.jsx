"use client";

import { useState } from "react";
import { translate, useAppLanguage } from "../lib/appLanguage";
import { downloadExcelWorkbook } from "../lib/excelExport";

const TEXT = {
  exportExcel: { en: "Export Excel", ar: "تصدير Excel" },
  exporting: { en: "Exporting...", ar: "جاري التصدير..." },
};

export default function ExportExcelButton({
  rows,
  sheets,
  getRows,
  filename = "export",
  sheetName = "Sheet1",
  disabled = false,
  onError,
  title,
}) {
  const { language } = useAppLanguage();
  const t = translate(language, TEXT);
  const [exporting, setExporting] = useState(false);

  async function handleClick() {
    if (exporting || disabled) return;
    setExporting(true);
    try {
      const payload = getRows
        ? await getRows()
        : (sheets || [{ name: sheetName, rows: rows || [] }]);
      await downloadExcelWorkbook(payload, filename);
    } catch (error) {
      onError?.(error);
    } finally {
      setExporting(false);
    }
  }

  return (
    <button
      type="button"
      className="moduleInlineButton"
      onClick={handleClick}
      disabled={disabled || exporting}
      title={title || t("exportExcel")}
    >
      {exporting ? t("exporting") : t("exportExcel")}
    </button>
  );
}
