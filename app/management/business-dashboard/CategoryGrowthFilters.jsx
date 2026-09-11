"use client";

import ExcelColumnFilter from "../../components/ExcelColumnFilter";
import {
  GROWTH_DIMENSIONS,
  emptyGrowthFilters,
  growthDimensionLabel,
  hasActiveGrowthFilters,
} from "../../lib/categoryGrowth";
import { translate } from "../../lib/appLanguage";

const TEXT = {
  title: { en: "Slice and dice", ar: "تقطيع وتصفية" },
  hint: {
    en: "Filter any imported sales field, then Apply. Group by changes the report rows immediately.",
    ar: "صفّ أي حقل من المبيعات ثم اضغط تطبيق. تغيير التجميع يحدّث الصفوف فوراً.",
  },
  groupBy: { en: "Group rows by", ar: "تجميع الصفوف حسب" },
  dateFrom: { en: "Date from", ar: "من تاريخ" },
  dateTo: { en: "Date to", ar: "إلى تاريخ" },
  amountMin: { en: "Amount min", ar: "الحد الأدنى للمبلغ" },
  amountMax: { en: "Amount max", ar: "الحد الأعلى للمبلغ" },
  quantityMin: { en: "Qty min", ar: "الحد الأدنى للكمية" },
  quantityMax: { en: "Qty max", ar: "الحد الأعلى للكمية" },
  fields: { en: "Field filters", ar: "تصفية الحقول" },
  apply: { en: "Apply filters", ar: "تطبيق التصفية" },
  clear: { en: "Clear all", ar: "مسح الكل" },
  all: { en: "All", ar: "الكل" },
  active: { en: "Active slice", ar: "الشريحة الحالية" },
  search: { en: "Search rows", ar: "بحث في الصفوف" },
  status: { en: "Signal filter", ar: "تصفية الإشارة" },
};

const STATUS_OPTIONS = [
  { key: "green", en: "Growing", ar: "نمو" },
  { key: "orange", en: "Softening / flat", ar: "تباطؤ / ثابت" },
  { key: "red", en: "Red lights", ar: "إشارات حمراء" },
  { key: "neutral", en: "New / limited", ar: "جديد / محدود" },
];

function draftValue(draft, key) {
  return Array.isArray(draft?.values?.[key]) ? draft.values[key] : [];
}

export default function CategoryGrowthFilters({
  language,
  draft,
  catalogs = {},
  applied,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  onDraftChange,
  onGroupByChange,
  onApply,
  onClear,
  lockGroupBy = "",
  statusOptions = STATUS_OPTIONS,
  hint,
}) {
  const t = translate(language, TEXT);
  const active = hasActiveGrowthFilters(applied);

  function patchDraft(patch) {
    onDraftChange({ ...emptyGrowthFilters(), ...draft, ...patch });
  }

  function patchValues(key, selected) {
    patchDraft({
      values: {
        ...emptyGrowthFilters().values,
        ...draft.values,
        [key]: selected,
      },
    });
  }

  function toggleStatus(key) {
    const current = Array.isArray(statusFilter) ? statusFilter : [];
    onStatusFilterChange(
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  }

  return (
    <section className="moduleSection">
      <div className="moduleSectionHeader">
        <h2>{t("title")}</h2>
      </div>
      <p className="moduleHint">{hint || t("hint")}</p>

      <div className="moduleFormGrid moduleBiFilterGrid">
        {lockGroupBy ? null : (
        <label className="moduleField">
          {t("groupBy")}
          <select
            className="moduleInput"
            value={draft.groupBy || "category"}
            onChange={(event) => onGroupByChange(event.target.value)}
          >
            {GROWTH_DIMENSIONS.map((dimension) => (
              <option key={dimension.key} value={dimension.key}>
                {growthDimensionLabel(dimension.key, language)}
              </option>
            ))}
          </select>
        </label>
        )}
        <label className="moduleField">
          {t("dateFrom")}
          <input className="moduleInput" type="date" value={draft.dateFrom || ""} onChange={(event) => patchDraft({ dateFrom: event.target.value })} />
        </label>
        <label className="moduleField">
          {t("dateTo")}
          <input className="moduleInput" type="date" value={draft.dateTo || ""} onChange={(event) => patchDraft({ dateTo: event.target.value })} />
        </label>
        <label className="moduleField">
          {t("amountMin")}
          <input className="moduleInput" type="number" value={draft.amountMin || ""} onChange={(event) => patchDraft({ amountMin: event.target.value })} />
        </label>
        <label className="moduleField">
          {t("amountMax")}
          <input className="moduleInput" type="number" value={draft.amountMax || ""} onChange={(event) => patchDraft({ amountMax: event.target.value })} />
        </label>
        <label className="moduleField">
          {t("quantityMin")}
          <input className="moduleInput" type="number" value={draft.quantityMin || ""} onChange={(event) => patchDraft({ quantityMin: event.target.value })} />
        </label>
        <label className="moduleField">
          {t("quantityMax")}
          <input className="moduleInput" type="number" value={draft.quantityMax || ""} onChange={(event) => patchDraft({ quantityMax: event.target.value })} />
        </label>
        <label className="moduleField">
          {t("search")}
          <input className="moduleInput" type="search" value={search || ""} onChange={(event) => onSearchChange(event.target.value)} />
        </label>
      </div>

      <div className="moduleBiStatusFilters" aria-label={t("status")}>
        <span>{t("status")}</span>
        {statusOptions.map((option) => (
          <label key={option.key} className="moduleBiStatusOption">
            <input
              type="checkbox"
              checked={(statusFilter || []).includes(option.key)}
              onChange={() => toggleStatus(option.key)}
            />
            {language === "ar" ? option.ar : option.en}
          </label>
        ))}
      </div>

      <h3 className="moduleBiFilterHeading">{t("fields")}</h3>
      <div className="moduleBiFieldFilters">
        {GROWTH_DIMENSIONS.map((dimension) => (
          <label key={dimension.key} className="moduleField moduleBiFieldFilter">
            {growthDimensionLabel(dimension.key, language)}
            <ExcelColumnFilter
              label={growthDimensionLabel(dimension.key, language)}
              options={catalogs[dimension.key] || []}
              selected={draftValue(draft, dimension.key)}
              onChange={(selected) => patchValues(dimension.key, selected)}
              allLabel={t("all")}
            />
          </label>
        ))}
      </div>

      <div className="moduleInlineStack moduleActionStack">
        <button type="button" className="moduleInlineButton moduleActionButton" onClick={onApply}>
          {t("apply")}
        </button>
        <button type="button" className="moduleInlineButton" onClick={onClear}>
          {t("clear")}
        </button>
      </div>

      {active ? (
        <div className="moduleHint">
          {t("active")}: {growthDimensionLabel(applied.groupBy, language)}
          {applied.dateFrom ? ` · ${applied.dateFrom}` : ""}
          {applied.dateTo ? ` → ${applied.dateTo}` : ""}
        </div>
      ) : null}
    </section>
  );
}

export function filterGrowthRows(rows, { search = "", statusFilter = [], statusOf } = {}) {
  const query = String(search || "").trim().toLowerCase();
  const statuses = Array.isArray(statusFilter) ? statusFilter : [];
  return (rows || []).filter((row) => {
    const status = statusOf ? statusOf(row) : row.status;
    if (statuses.length && !statuses.includes(status)) return false;
    if (!query) return true;
    return String(row.label || row.category || "").toLowerCase().includes(query);
  });
}
