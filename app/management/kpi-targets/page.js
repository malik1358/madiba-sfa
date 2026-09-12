"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  buildPerformanceKpi,
  formatAchievementPercent,
  formatPerformanceKpiValue,
  normalizeSalesmanCode,
  PERFORMANCE_DISPLAY_KPI_KEYS,
} from "../../lib/performanceKpis";
import {
  filterKpiTargetRows,
  NO_BOSS_KEY,
  sumFilteredKpiColumns,
  sumKpiActuals,
  teamMemberRows,
  teamRowLabel,
} from "../../lib/kpiTargetsTable";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { fetchJsonWithTimeout, resolveAuthSession } from "../../lib/authSession";
import { getSupabaseClient } from "../../lib/supabase";
import { usePopupMessages } from "../../hooks/usePopupMessages";
import { getKsaDateString } from "../../lib/workdayActivity";
import ExportableTable from "../../components/ExportableTable";

const TEXT = {
  title: { en: "KPI Targets", ar: "أهداف الأداء" },
  subtitle: {
    en: "Ach. % is actual vs the full month target. Expected pace is that salesman's own average share of monthly sales by this date over the last 6 months, or working days if he has no history.",
    ar: "نسبة الإنجاز هي الفعلي مقابل هدف الشهر. المسار المتوقع هو متوسط حصة المندوب نفسه من مبيعات الشهر حتى هذا التاريخ خلال آخر 6 أشهر، أو أيام العمل إن لم يوجد تاريخ.",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  performance: { en: "My Performance", ar: "أدائي" },
  loading: { en: "Loading KPI targets...", ar: "جاري تحميل أهداف الأداء..." },
  month: { en: "Month", ar: "الشهر" },
  save: { en: "Save targets", ar: "حفظ الأهداف" },
  saving: { en: "Saving...", ar: "جاري الحفظ..." },
  salesman: { en: "Salesman", ar: "المندوب" },
  boss: { en: "Boss", ar: "المدير" },
  filterSalesman: { en: "Filter salesman", ar: "تصفية المندوب" },
  filterBoss: { en: "Filter boss", ar: "تصفية المدير" },
  selectAll: { en: "Select all", ar: "تحديد الكل" },
  searchList: { en: "Search", ar: "بحث" },
  noBoss: { en: "No boss", ar: "بدون مدير" },
  shownCount: { en: "shown", ar: "ظاهر" },
  clearFilters: { en: "Clear filters", ar: "مسح التصفية" },
  noMatches: { en: "No salesmen match the selected filters.", ar: "لا يوجد مندوبون مطابقون للتصفية المحددة." },
  team: { en: "team", ar: "فريق" },
  teamHint: { en: "Team target", ar: "هدف الفريق" },
  totals: { en: "Total (filtered)", ar: "الإجمالي (المصفى)" },
  officeSupplies: { en: "Sales of office supplies", ar: "مبيعات مستلزمات المكتب" },
  otherSales: { en: "Others", ar: "أخرى" },
  totalSales: { en: "Total sales", ar: "إجمالي المبيعات" },
  collection: { en: "Collection", ar: "التحصيل" },
  newCustomers: { en: "New customers", ar: "عملاء جدد" },
  repeatCustomers: { en: "Repeat customers", ar: "عملاء متكررون" },
  actual: { en: "Actual", ar: "الفعلي" },
  achievement: { en: "Ach. %", ar: "الإنجاز" },
  ofTarget: { en: "of target", ar: "من الهدف" },
  expectedByToday: { en: "expected", ar: "المتوقع" },
  status: { en: "Status", ar: "الحالة" },
  saved: { en: "KPI targets updated. Users and the daily mail will show the new status.", ar: "تم تحديث الأهداف. سيظهر للمستخدمين وفي البريد اليومي الحالة الجديدة." },
};

function monthInputValue(date) {
  return String(date || getKsaDateString()).slice(0, 7);
}

function salesmanFilterKey(row) {
  return normalizeSalesmanCode(row?.salesmanCode);
}

function bossFilterKey(row) {
  return normalizeSalesmanCode(row?.bossCode) || NO_BOSS_KEY;
}

function emptyDraft(snapshot) {
  return {
    salesmanCode: snapshot.salesmanCode,
    salesmanName: snapshot.salesmanName,
    bossCode: normalizeSalesmanCode(snapshot.bossCode),
    bossName: String(snapshot.bossName || "").trim(),
    isTeam: Boolean(snapshot.isTeam),
    officeSupplies: String(snapshot.targets?.officeSupplies ?? 0),
    otherSales: String(snapshot.targets?.otherSales ?? 0),
    totalSales: String(snapshot.targets?.totalSales ?? 0),
    collection: String(snapshot.targets?.collection ?? 0),
    newCustomers: String(snapshot.targets?.newCustomers ?? 0),
    repeatCustomers: String(snapshot.targets?.repeatCustomers ?? 0),
    kpis: snapshot.kpis || [],
    paceShares: snapshot.paceShares || null,
    todayIso: snapshot.todayIso || null,
    reportDate: snapshot.reportDate || null,
  };
}

function withLiveTeamActuals(rows) {
  return (rows || []).map((row) => {
    if (!row.isTeam) return row;
    const actuals = sumKpiActuals(teamMemberRows(rows, row.bossCode));
    return {
      ...row,
      kpis: PERFORMANCE_DISPLAY_KPI_KEYS.map((key) => ({
        key,
        actual: actuals[key] || 0,
      })),
    };
  });
}

export default function KpiTargetsPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const [month, setMonth] = useState(() => monthInputValue());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [rows, setRows] = useState([]);
  const [selectedSalesmen, setSelectedSalesmen] = useState([]);
  const [selectedBosses, setSelectedBosses] = useState([]);

  usePopupMessages({ message, error });

  async function loadRows(nextMonth = month, { quiet = false } = {}) {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setLoading(false);
      return;
    }

    if (!quiet) setLoading(true);
    setError("");
    try {
      const session = await resolveAuthSession(supabase);
      if (!session?.access_token) throw new Error("Please login again.");

      const { response, payload } = await fetchJsonWithTimeout(
        `/api/admin/kpi-targets?month=${encodeURIComponent(nextMonth)}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } },
        60000,
      );
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to load KPI targets.");
      }
      const people = (payload.rows || []).map(emptyDraft);
      const teams = (payload.teamTargets || []).map((team) => emptyDraft({
        salesmanCode: team.salesmanCode,
        salesmanName: teamRowLabel(team.bossName, "team"),
        bossCode: team.bossCode,
        bossName: team.bossName,
        isTeam: true,
        targets: team.targets,
        kpis: [],
        reportDate: payload.reportDate,
        todayIso: getKsaDateString(),
      }));
      setRows(withLiveTeamActuals([...people, ...teams]));
    } catch (err) {
      setError(err.message || "Unable to load KPI targets.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRows(month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  async function saveTargets() {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const session = await resolveAuthSession(supabase);
      if (!session?.access_token) throw new Error("Please login again.");

      const { response, payload } = await fetchJsonWithTimeout(
        "/api/admin/kpi-targets",
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            month,
            rows: rows.map((row) => ({
              salesmanCode: row.salesmanCode,
              targets: {
                officeSupplies: Number(row.officeSupplies || 0),
                otherSales: Number(row.otherSales || 0),
                totalSales: (Number(row.officeSupplies || 0) || 0) + (Number(row.otherSales || 0) || 0)
                  || Number(row.totalSales || 0),
                collection: Number(row.collection || 0),
                newCustomers: Number(row.newCustomers || 0),
                repeatCustomers: Number(row.repeatCustomers || 0),
              },
            })),
          }),
        },
        60000,
      );
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to save KPI targets.");
      }
      setMessage(t("saved"));
      await loadRows(month, { quiet: true });
    } catch (err) {
      setError(err.message || "Unable to save KPI targets.");
    } finally {
      setSaving(false);
    }
  }

  const supabaseClient = getSupabaseClient();
  const columns = useMemo(() => PERFORMANCE_DISPLAY_KPI_KEYS, []);

  const salesmanOptions = useMemo(() => {
    const seen = new Set();
    return rows
      .filter((row) => !row.isTeam)
      .map((row) => ({
        key: salesmanFilterKey(row),
        label: row.salesmanName || row.salesmanCode,
      }))
      .filter((option) => {
        if (!option.key || seen.has(option.key)) return false;
        seen.add(option.key);
        return true;
      })
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [rows]);

  const bossOptions = useMemo(() => {
    const seen = new Set();
    return rows
      .filter((row) => !row.isTeam)
      .map((row) => ({
        key: bossFilterKey(row),
        label: row.bossName || row.bossCode || t("noBoss"),
      }))
      .filter((option) => {
        if (!option.key || seen.has(option.key)) return false;
        seen.add(option.key);
        return true;
      })
      .sort((left, right) => {
        if (left.key === NO_BOSS_KEY) return 1;
        if (right.key === NO_BOSS_KEY) return -1;
        return left.label.localeCompare(right.label);
      });
  }, [rows, t]);

  const liveRows = useMemo(() => withLiveTeamActuals(rows), [rows]);

  const visibleRows = useMemo(() => {
    const matched = filterKpiTargetRows(liveRows, { selectedSalesmen, selectedBosses });
    return [...matched].sort((left, right) => {
      if (Boolean(left.isTeam) !== Boolean(right.isTeam)) return left.isTeam ? -1 : 1;
      return String(left.salesmanName || left.salesmanCode)
        .localeCompare(String(right.salesmanName || right.salesmanCode));
    });
  }, [liveRows, selectedBosses, selectedSalesmen]);

  const filteredTotals = useMemo(
    () => sumFilteredKpiColumns(visibleRows, columns),
    [columns, visibleRows],
  );

  const individualVisibleCount = visibleRows.filter((row) => !row.isTeam).length;

  useEffect(() => {
    const salesmanKeys = new Set(rows.filter((row) => !row.isTeam).map(salesmanFilterKey).filter(Boolean));
    const bossKeys = new Set(rows.filter((row) => !row.isTeam).map(bossFilterKey).filter(Boolean));
    setSelectedSalesmen((current) => {
      const next = current.filter((key) => salesmanKeys.has(key));
      return next.length === current.length ? current : next;
    });
    setSelectedBosses((current) => {
      const next = current.filter((key) => bossKeys.has(key));
      return next.length === current.length ? current : next;
    });
  }, [rows]);

  const filtersActive = selectedSalesmen.length > 0 || selectedBosses.length > 0;

  function toggleFilterValue(setter, key) {
    setter((current) => (
      current.includes(key)
        ? current.filter((entry) => entry !== key)
        : [...current, key]
    ));
  }

  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="KPI targets unavailable"
        message="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to manage KPI targets."
      />
    );
  }

  return (
    <MorningAttendanceGate>
      <main className="modulePage moduleKpiTargetsPage" dir={dir}>
        <div className="moduleShell">
          <div className="moduleHeader">
            <div>
              <p className="moduleEyebrow">MADIBA SFA</p>
              <h1>{t("title")}</h1>
              <p className="moduleSubtitle">{t("subtitle")}</p>
            </div>
            <div className="moduleHeaderMeta">
              <AppLanguageSwitch language={language} setLanguage={setLanguage} />
              <Link href="/management/my-performance" className="moduleInlineButton">{t("performance")}</Link>
              <Link href="/management" className="moduleBackLink">{t("back")}</Link>
            </div>
          </div>

          <div className="moduleKpiTargetsFilters">
            <label className="moduleField">
              {t("month")}
              <input
                className="moduleInput"
                type="month"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
              />
            </label>
            <CheckboxFilterList
              label={t("filterSalesman")}
              searchLabel={t("searchList")}
              selectAllLabel={t("selectAll")}
              options={salesmanOptions}
              selected={selectedSalesmen}
              onToggle={(key) => toggleFilterValue(setSelectedSalesmen, key)}
              onSelectAll={() => setSelectedSalesmen(salesmanOptions.map((option) => option.key))}
              onClear={() => setSelectedSalesmen([])}
            />
            <CheckboxFilterList
              label={t("filterBoss")}
              searchLabel={t("searchList")}
              selectAllLabel={t("selectAll")}
              options={bossOptions}
              selected={selectedBosses}
              onToggle={(key) => toggleFilterValue(setSelectedBosses, key)}
              onSelectAll={() => setSelectedBosses(bossOptions.map((option) => option.key))}
              onClear={() => setSelectedBosses([])}
            />
            <div className="moduleKpiTargetsFilterActions">
              <button type="button" className="moduleInlineButton moduleActionButton" onClick={saveTargets} disabled={saving || loading}>
                {saving ? t("saving") : t("save")}
              </button>
              {filtersActive ? (
                <button
                  type="button"
                  className="moduleInlineButton"
                  onClick={() => {
                    setSelectedSalesmen([]);
                    setSelectedBosses([]);
                  }}
                >
                  {t("clearFilters")}
                </button>
              ) : null}
              {!loading ? (
                <span className="moduleHint">
                  {individualVisibleCount} / {rows.filter((row) => !row.isTeam).length} {t("shownCount")}
                </span>
              ) : null}
            </div>
          </div>

          {loading ? (
            <div className="moduleLoading">{t("loading")}</div>
          ) : (
            <ExportableTable filename={`kpi-targets-${month}`} sheetName="KPI Targets" className="moduleTableWrap moduleKpiTargetsWrap">
              <table className="moduleTable moduleStackedHeaderTable moduleKpiTargetsTable">
                <thead>
                  <tr>
                    <th className="moduleKpiSalesmanCell">{t("salesman")}</th>
                    <th className="moduleKpiBossCell">{t("boss")}</th>
                    {columns.map((key) => (
                      <th key={key} colSpan={3}>{t(key)}</th>
                    ))}
                  </tr>
                  <tr>
                    <th className="moduleKpiSalesmanCell" data-column-filter-label={t("salesman")}></th>
                    <th className="moduleKpiBossCell" data-column-filter-label={t("boss")}></th>
                    {columns.map((key) => (
                      <FragmentHeader
                        key={key}
                        group={t(key)}
                        actual={t("actual")}
                        achievement={t("achievement")}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.length === 0 ? (
                    <tr>
                      <td colSpan={2 + columns.length * 3} className="moduleHint">
                        {t("noMatches")}
                      </td>
                    </tr>
                  ) : visibleRows.map((row) => (
                    <tr key={row.salesmanCode} className={row.isTeam ? "moduleKpiTeamRow" : undefined}>
                      <td className="moduleKpiSalesmanCell">
                        <strong>{row.isTeam ? teamRowLabel(row.bossName || row.salesmanName, t("team")) : (row.salesmanName || row.salesmanCode)}</strong>
                        <div className="moduleKpiMeta">{row.isTeam ? t("teamHint") : row.salesmanCode}</div>
                      </td>
                      <td className="moduleKpiBossCell">
                        <strong>{row.bossName || t("noBoss")}</strong>
                        {row.bossCode ? <div className="moduleKpiMeta">{row.bossCode}</div> : null}
                      </td>
                      {columns.map((key) => {
                        const kpi = (row.kpis || []).find((item) => item.key === key);
                        const isTotalSales = key === "totalSales";
                        const targetValue = isTotalSales
                          ? String(
                            (Number(row.officeSupplies || 0) || 0) + (Number(row.otherSales || 0) || 0)
                            || Number(row.totalSales || 0),
                          )
                          : row[key];
                        const liveKpi = buildPerformanceKpi(key, {
                          actual: kpi?.actual || 0,
                          target: Number(targetValue || 0),
                          reportDate: row.reportDate || `${month}-01`,
                          todayIso: row.todayIso || getKsaDateString(),
                          paceShares: row.paceShares,
                        });
                        const statusKey = liveKpi.status?.key || "no_target";
                        const expectedLabel = statusKey === "no_target" || liveKpi.expected == null
                          ? ""
                          : `${t("expectedByToday")} ${formatAchievementPercent(liveKpi.expected)}`;
                        return (
                          <KpiTargetCells
                            key={key}
                            actual={formatPerformanceKpiValue(key, kpi?.actual)}
                            achievement={formatAchievementPercent(liveKpi.achievement)}
                            ofTarget={t("ofTarget")}
                            status={liveKpi.status?.label || "No target"}
                            statusKey={statusKey}
                            expected={expectedLabel}
                            value={targetValue}
                            readOnly={isTotalSales}
                            onChange={(value) => {
                              setRows((current) => current.map((item) => {
                                if (item.salesmanCode !== row.salesmanCode) return item;
                                const next = { ...item, [key]: value };
                                next.totalSales = String(
                                  (Number(next.officeSupplies || 0) || 0) + (Number(next.otherSales || 0) || 0),
                                );
                                return next;
                              }));
                            }}
                          />
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
                {individualVisibleCount > 0 ? (
                  <tfoot>
                    <tr className="moduleKpiTotalsRow">
                      <td className="moduleKpiSalesmanCell">
                        <strong>{t("totals")}</strong>
                        <div className="moduleKpiMeta">{individualVisibleCount} {t("salesman")}</div>
                      </td>
                      <td className="moduleKpiBossCell"></td>
                      {columns.map((key) => {
                        const column = filteredTotals[key] || { actual: 0, target: 0, achievement: null };
                        const liveKpi = buildPerformanceKpi(key, {
                          actual: column.actual,
                          target: column.target,
                          reportDate: `${month}-01`,
                          todayIso: getKsaDateString(),
                        });
                        const statusKey = liveKpi.status?.key || "no_target";
                        return (
                          <KpiTargetCells
                            key={key}
                            actual={formatPerformanceKpiValue(key, column.actual)}
                            achievement={formatAchievementPercent(column.achievement)}
                            ofTarget={t("ofTarget")}
                            status={liveKpi.status?.label || "No target"}
                            statusKey={statusKey}
                            expected=""
                            value={String(Math.round(column.target || 0))}
                            readOnly
                            onChange={() => {}}
                          />
                        );
                      })}
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </ExportableTable>
          )}
        </div>
      </main>
    </MorningAttendanceGate>
  );
}

function CheckboxFilterList({
  label,
  searchLabel,
  selectAllLabel,
  options,
  selected,
  onToggle,
  onSelectAll,
  onClear,
}) {
  const [query, setQuery] = useState("");
  const filteredOptions = options.filter((option) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return `${option.label} ${option.key}`.toLowerCase().includes(needle);
  });
  const allSelected = options.length > 0 && selected.length === options.length;

  return (
    <div className="moduleField">
      {label}
      <input
        className="moduleInput"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={searchLabel}
        aria-label={`${searchLabel} ${label}`}
      />
      <div className="moduleCollectorCheckboxList" role="group" aria-label={label}>
        {options.length === 0 ? null : (
          <label className="moduleCollectorCheckbox moduleCollectorCheckboxSelectAll">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => (allSelected ? onClear() : onSelectAll())}
            />
            <span>{selectAllLabel}</span>
          </label>
        )}
        {filteredOptions.map((option) => (
          <label key={option.key} className="moduleCollectorCheckbox">
            <input
              type="checkbox"
              checked={selected.includes(option.key)}
              onChange={() => onToggle(option.key)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function FragmentHeader({ group, actual, achievement }) {
  return (
    <>
      <th data-column-filter-label={`${group} ${actual}`}>{actual}</th>
      <th data-column-filter-label={`${group} Target`}>Target</th>
      <th data-column-filter-label={`${group} ${achievement}`}>{achievement}</th>
    </>
  );
}

function kpiStatusClass(statusKey) {
  if (statusKey === "achieved") return "moduleKpiStatus--achieved";
  if (statusKey === "on_track" || statusKey === "on_pace" || statusKey === "ahead") {
    return "moduleKpiStatus--onTrack";
  }
  if (statusKey === "behind") return "moduleKpiStatus--behind";
  return "moduleKpiStatus--neutral";
}

function KpiTargetCells({
  actual,
  achievement,
  ofTarget,
  status,
  statusKey,
  expected,
  value,
  onChange,
  readOnly = false,
}) {
  return (
    <>
      <td>{actual}</td>
      <td>
        <input
          className="moduleInput moduleKpiTargetInput"
          type="number"
          min="0"
          step="1"
          size={8}
          inputMode="numeric"
          value={value}
          readOnly={readOnly}
          disabled={readOnly}
          onChange={(event) => onChange(event.target.value)}
        />
      </td>
      <td className="moduleKpiAchCell">
        {statusKey === "no_target" ? (
          <span className={`moduleKpiStatus ${kpiStatusClass(statusKey)}`}>{status}</span>
        ) : (
          <>
            <strong className="moduleKpiAchDone">{achievement}</strong>
            <span className="moduleKpiAchHint">{ofTarget}</span>
            <span className={`moduleKpiStatus ${kpiStatusClass(statusKey)}`}>{status}</span>
            {expected ? <span className="moduleKpiAchExpected">{expected}</span> : null}
          </>
        )}
      </td>
    </>
  );
}
