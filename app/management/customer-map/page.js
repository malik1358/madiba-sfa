"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import ExportableTable from "../../components/ExportableTable";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { resolveAuthSession } from "../../lib/authSession";
import { customersForAreaKey } from "../../lib/customerMapReport.js";
import { getSupabaseClient } from "../../lib/supabase";
import BiExcelHead, { useBiExcelFilters } from "../business-dashboard/BiExcelHead";

const CustomerMapCanvas = dynamic(() => import("../../components/CustomerMapCanvas"), {
  ssr: false,
  loading: () => <div className="customerMapCanvas customerMapCanvas--loading">…</div>,
});

const TEXT = {
  title: { en: "Customer Map", ar: "خريطة العملاء" },
  subtitle: {
    en: "See how many customers are in each area, then zoom the map to find every customer pin.",
    ar: "اعرض عدد العملاء في كل منطقة، ثم قرّب الخريطة لرؤية موقع كل عميل.",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  loading: { en: "Loading customer map...", ar: "جاري تحميل خريطة العملاء..." },
  refresh: { en: "Refresh", ar: "تحديث" },
  showAll: { en: "Show all areas", ar: "عرض كل المناطق" },
  city: { en: "City", ar: "المدينة" },
  area: { en: "Area", ar: "المنطقة" },
  salesman: { en: "Salesman", ar: "المندوب" },
  allCities: { en: "All cities", ar: "كل المدن" },
  allSalesmen: { en: "All salesmen", ar: "كل المندوبين" },
  search: { en: "Search code or name", ar: "بحث بالكود أو الاسم" },
  activeOnly: { en: "Active customers only", ar: "العملاء النشطون فقط" },
  customers: { en: "Customers", ar: "العملاء" },
  withGps: { en: "With GPS", ar: "مع GPS" },
  withoutGps: { en: "Without GPS", ar: "بدون GPS" },
  cities: { en: "Cities", ar: "المدن" },
  areas: { en: "Areas", ar: "المناطق" },
  areaSummary: { en: "Customers by area", ar: "العملاء حسب المنطقة" },
  customerList: { en: "Customers in area", ar: "عملاء المنطقة" },
  map: { en: "Map", ar: "الخريطة" },
  total: { en: "Total", ar: "الإجمالي" },
  code: { en: "Code", ar: "الكود" },
  customer: { en: "Customer", ar: "العميل" },
  gps: { en: "GPS", ar: "GPS" },
  yes: { en: "Yes", ar: "نعم" },
  no: { en: "No", ar: "لا" },
  openMap: { en: "Map", ar: "الخريطة" },
  audit: { en: "Audit", ar: "التدقيق" },
  actions: { en: "Actions", ar: "الإجراءات" },
  zoomHint: {
    en: "Zoomed out: area bubbles show customer counts. Click a count/bubble or area row to open that area’s customer list and zoom to the pins.",
    ar: "عند التصغير تظهر فقاعات المناطق بعدد العملاء. انقر العدد/الفقاعة أو صف المنطقة لفتح قائمة العملاء والتقريب إلى المواقع.",
  },
  selected: { en: "Selected area", ar: "المنطقة المحددة" },
  pickArea: {
    en: "Click an area count on the map or a row below to list those customers.",
    ar: "انقر عدد منطقة على الخريطة أو صفاً أدناه لعرض قائمة هؤلاء العملاء.",
  },
  noRows: {
    en: "No customers match the current filters.",
    ar: "لا يوجد عملاء مطابقون للفلاتر الحالية.",
  },
  noCustomers: {
    en: "No customers in this area for the current filters.",
    ar: "لا يوجد عملاء في هذه المنطقة حسب الفلاتر الحالية.",
  },
  accessDenied: {
    en: "Only admin, manager, or invoice maker can open this report.",
    ar: "هذا التقرير للمدير أو الأدمن أو معد الفواتير.",
  },
  signIn: { en: "Please login again.", ar: "يرجى تسجيل الدخول مرة أخرى." },
  all: { en: "All", ar: "الكل" },
};

const AREA_FILTER_KEYS = ["city", "area", "customers", "with_gps", "without_gps"];
const CUSTOMER_FILTER_KEYS = ["customer_code", "customer_name", "current_salesman_code", "city", "area", "has_gps"];

function formatCount(value) {
  return Number(value || 0).toLocaleString("en-SA");
}

function areaCellValue(row, key) {
  if (key === "city") return row.city || "";
  if (key === "area") return row.area || "";
  if (key === "customers") return formatCount(row.customers);
  if (key === "with_gps") return formatCount(row.with_gps);
  if (key === "without_gps") return formatCount(row.without_gps);
  return "";
}

function customerCellValue(row, key, t) {
  if (key === "customer_code") return row.customer_code || "";
  if (key === "customer_name") return row.customer_name || "";
  if (key === "current_salesman_code") return row.current_salesman_code || "";
  if (key === "city") return row.city || "";
  if (key === "area") return row.area || "";
  if (key === "has_gps") return row.has_gps ? t("yes") : t("no");
  return "";
}

function googleMapsUrl(row) {
  if (!row?.has_gps || row.latitude == null || row.longitude == null) return "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${row.latitude},${row.longitude}`)}`;
}

export default function CustomerMapPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const supabaseClient = getSupabaseClient();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [summary, setSummary] = useState({
    customers: 0,
    with_gps: 0,
    without_gps: 0,
    cities: 0,
    areas: 0,
  });
  const [areaRows, setAreaRows] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [mapPoints, setMapPoints] = useState([]);
  const [cities, setCities] = useState([]);
  const [salesmen, setSalesmen] = useState([]);
  const [cityFilter, setCityFilter] = useState("");
  const [salesmanFilter, setSalesmanFilter] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const [selectedAreaKey, setSelectedAreaKey] = useState("");
  const [fitToken, setFitToken] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadReport = useCallback(async () => {
    if (!supabaseClient) return;
    setLoading(true);
    setError("");
    setAccessDenied(false);
    try {
      const session = await resolveAuthSession(supabaseClient);
      const token = session?.access_token;
      if (!token) {
        setError(TEXT.signIn.en);
        setLoading(false);
        return;
      }

      const params = new URLSearchParams();
      if (cityFilter) params.set("city", cityFilter);
      if (salesmanFilter) params.set("salesman", salesmanFilter);
      if (debouncedSearch) params.set("search", debouncedSearch);
      params.set("activeOnly", activeOnly ? "1" : "0");

      const response = await fetch(`/api/customer-map?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 403) {
        setAccessDenied(true);
        setAreaRows([]);
        setCustomers([]);
        setMapPoints([]);
        setLoading(false);
        return;
      }
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || TEXT.signIn.en);
      }

      setSummary(payload.summary || {
        customers: 0,
        with_gps: 0,
        without_gps: 0,
        cities: 0,
        areas: 0,
      });
      setAreaRows(Array.isArray(payload.areaRows) ? payload.areaRows : []);
      setCustomers(Array.isArray(payload.customers) ? payload.customers : []);
      setMapPoints(Array.isArray(payload.mapPoints) ? payload.mapPoints : []);
      setCities(Array.isArray(payload.cities) ? payload.cities : []);
      setSalesmen(Array.isArray(payload.salesmen) ? payload.salesmen : []);
      setFitToken((value) => value + 1);
    } catch (loadError) {
      setError(String(loadError?.message || TEXT.signIn.en));
      setAreaRows([]);
      setCustomers([]);
      setMapPoints([]);
    } finally {
      setLoading(false);
    }
  }, [activeOnly, cityFilter, debouncedSearch, salesmanFilter, supabaseClient]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  useEffect(() => {
    if (!selectedAreaKey) return undefined;
    const timer = window.setTimeout(() => {
      document.getElementById("customer-map-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [selectedAreaKey, fitToken]);

  const selectedArea = useMemo(
    () => areaRows.find((row) => row.area_key === selectedAreaKey) || null,
    [areaRows, selectedAreaKey],
  );

  const selectedCustomers = useMemo(
    () => customersForAreaKey(customers, selectedAreaKey),
    [customers, selectedAreaKey],
  );

  const visibleAreaRows = useMemo(() => {
    if (!selectedAreaKey) return areaRows;
    return areaRows.filter((row) => row.area_key === selectedAreaKey);
  }, [areaRows, selectedAreaKey]);

  const areaFilterValueOf = useCallback((row, key) => areaCellValue(row, key), []);
  const {
    filters: areaFilters,
    options: areaOptions,
    visibleRows: filteredAreaRows,
    setFilter: setAreaFilter,
  } = useBiExcelFilters(visibleAreaRows, AREA_FILTER_KEYS, areaFilterValueOf);

  const customerFilterValueOf = useCallback(
    (row, key) => customerCellValue(row, key, t),
    [t],
  );
  const {
    filters: customerFilters,
    options: customerOptions,
    visibleRows: filteredCustomers,
    setFilter: setCustomerFilter,
  } = useBiExcelFilters(selectedCustomers, CUSTOMER_FILTER_KEYS, customerFilterValueOf);

  const areaTotals = useMemo(() => filteredAreaRows.reduce((acc, row) => ({
    customers: acc.customers + Number(row.customers || 0),
    with_gps: acc.with_gps + Number(row.with_gps || 0),
    without_gps: acc.without_gps + Number(row.without_gps || 0),
  }), { customers: 0, with_gps: 0, without_gps: 0 }), [filteredAreaRows]);

  const handleSelectArea = useCallback((areaKey) => {
    setSelectedAreaKey(String(areaKey || ""));
    setFitToken((value) => value + 1);
  }, []);

  const clearAreaSelection = useCallback(() => {
    setSelectedAreaKey("");
    setFitToken((value) => value + 1);
  }, []);

  if (!supabaseClient) {
    return <SupabaseUnavailable />;
  }

  return (
    <MorningAttendanceGate>
      <main className="modulePage" dir={dir}>
        <div className="moduleTopBar">
          <div>
            <Link className="moduleBackLink" href="/management">{t("back")}</Link>
            <h1>{t("title")}</h1>
            <p className="moduleSubtitle">{t("subtitle")}</p>
          </div>
          <AppLanguageSwitch language={language} setLanguage={setLanguage} />
        </div>

        {accessDenied ? (
          <div className="moduleHint">{t("accessDenied")}</div>
        ) : (
          <>
            <section className="moduleSection">
              <div className="moduleFilterRow" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
                <select
                  className="moduleInput"
                  value={cityFilter}
                  onChange={(event) => {
                    setCityFilter(event.target.value);
                    setSelectedAreaKey("");
                  }}
                  aria-label={t("city")}
                >
                  <option value="">{t("allCities")}</option>
                  {cities.map((city) => (
                    <option key={city} value={city}>{city}</option>
                  ))}
                </select>
                <select
                  className="moduleInput"
                  value={salesmanFilter}
                  onChange={(event) => {
                    setSalesmanFilter(event.target.value);
                    setSelectedAreaKey("");
                  }}
                  aria-label={t("salesman")}
                >
                  <option value="">{t("allSalesmen")}</option>
                  {salesmen.map((code) => (
                    <option key={code} value={code}>{code}</option>
                  ))}
                </select>
                <input
                  className="moduleInput"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t("search")}
                />
                <label className="moduleHint" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <input
                    type="checkbox"
                    checked={activeOnly}
                    onChange={(event) => setActiveOnly(event.target.checked)}
                  />
                  {t("activeOnly")}
                </label>
                <button type="button" className="moduleInlineButton" onClick={loadReport} disabled={loading}>
                  {loading ? t("loading") : t("refresh")}
                </button>
                {selectedAreaKey ? (
                  <button type="button" className="moduleInlineButton" onClick={clearAreaSelection}>
                    {t("showAll")}
                  </button>
                ) : null}
              </div>
              {error ? <div className="moduleHint">{error}</div> : null}
              <div className="customerMapSummary">
                <div><strong>{formatCount(summary.customers)}</strong><span>{t("customers")}</span></div>
                <div><strong>{formatCount(summary.with_gps)}</strong><span>{t("withGps")}</span></div>
                <div><strong>{formatCount(summary.without_gps)}</strong><span>{t("withoutGps")}</span></div>
                <div><strong>{formatCount(summary.cities)}</strong><span>{t("cities")}</span></div>
                <div><strong>{formatCount(summary.areas)}</strong><span>{t("areas")}</span></div>
              </div>
              <p className="moduleHint">{t("zoomHint")}</p>
              {selectedArea ? (
                <p className="moduleHint">
                  {t("selected")}: {selectedArea.city} / {selectedArea.area} — {formatCount(selectedArea.customers)} {t("customers")}
                </p>
              ) : (
                <p className="moduleHint">{t("pickArea")}</p>
              )}
            </section>

            <section className="moduleSection">
              <div className="moduleSectionHeader">
                <h2>{t("map")}</h2>
                <span>{formatCount(mapPoints.length)} {t("withGps")}</span>
              </div>
              <CustomerMapCanvas
                mapPoints={mapPoints}
                areaRows={areaRows}
                selectedAreaKey={selectedAreaKey}
                language={language}
                onSelectArea={handleSelectArea}
                fitToken={fitToken}
              />
            </section>

            {selectedAreaKey ? (
              <section className="moduleSection" id="customer-map-list">
                <div className="moduleSectionHeader">
                  <h2>{t("customerList")}</h2>
                  <span>
                    {selectedArea ? `${selectedArea.city} / ${selectedArea.area}` : ""}
                    {" · "}
                    {formatCount(filteredCustomers.length)} {t("customers")}
                  </span>
                </div>
                {loading ? (
                  <div className="moduleHint">{t("loading")}</div>
                ) : filteredCustomers.length === 0 ? (
                  <div className="moduleHint">{t("noCustomers")}</div>
                ) : (
                  <ExportableTable
                    filename="customer-map-customers"
                    sheetName="Customers"
                    className="moduleTableWrap moduleBiTableWrap"
                  >
                    <table className="moduleTable moduleBiTable">
                      <thead>
                        <tr>
                          <BiExcelHead label={t("code")} filterKey="customer_code" options={customerOptions} filters={customerFilters} onChange={setCustomerFilter} allLabel={t("all")} />
                          <BiExcelHead label={t("customer")} filterKey="customer_name" options={customerOptions} filters={customerFilters} onChange={setCustomerFilter} allLabel={t("all")} />
                          <BiExcelHead label={t("salesman")} filterKey="current_salesman_code" options={customerOptions} filters={customerFilters} onChange={setCustomerFilter} allLabel={t("all")} />
                          <BiExcelHead label={t("city")} filterKey="city" options={customerOptions} filters={customerFilters} onChange={setCustomerFilter} allLabel={t("all")} />
                          <BiExcelHead label={t("area")} filterKey="area" options={customerOptions} filters={customerFilters} onChange={setCustomerFilter} allLabel={t("all")} />
                          <BiExcelHead label={t("gps")} filterKey="has_gps" options={customerOptions} filters={customerFilters} onChange={setCustomerFilter} allLabel={t("all")} />
                          <th data-column-filter-label={t("actions")}>{t("actions")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredCustomers.map((row) => {
                          const mapsUrl = googleMapsUrl(row);
                          return (
                            <tr key={`${row.customer_code}-${row.area_key}`}>
                              <td data-label={t("code")}>{row.customer_code}</td>
                              <td data-label={t("customer")}>{row.customer_name}</td>
                              <td data-label={t("salesman")}>{row.current_salesman_code || "-"}</td>
                              <td data-label={t("city")}>{row.city}</td>
                              <td data-label={t("area")}>{row.area}</td>
                              <td data-label={t("gps")}>{row.has_gps ? t("yes") : t("no")}</td>
                              <td data-label={t("actions")}>
                                <div className="moduleFilterRow" style={{ gridTemplateColumns: "repeat(2, auto)", gap: "6px" }}>
                                  <Link
                                    className="moduleInlineButton"
                                    href={`/management/customer-audit?customer=${encodeURIComponent(row.customer_code)}`}
                                  >
                                    {t("audit")}
                                  </Link>
                                  {mapsUrl ? (
                                    <a className="moduleInlineButton" href={mapsUrl} target="_blank" rel="noreferrer">
                                      {t("openMap")}
                                    </a>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={5}><strong>{t("total")}</strong></td>
                          <td className="moduleBiTotalCol"><strong>{formatCount(filteredCustomers.length)}</strong></td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </ExportableTable>
                )}
              </section>
            ) : null}

            <section className="moduleSection">
              <div className="moduleSectionHeader">
                <h2>{t("areaSummary")}</h2>
                <span>{formatCount(filteredAreaRows.length)} {t("areas")}</span>
              </div>
              {loading ? (
                <div className="moduleHint">{t("loading")}</div>
              ) : filteredAreaRows.length === 0 ? (
                <div className="moduleHint">{t("noRows")}</div>
              ) : (
                <ExportableTable
                  filename="customer-map-areas"
                  sheetName="Areas"
                  className="moduleTableWrap moduleBiTableWrap"
                >
                  <table className="moduleTable moduleBiTable">
                    <thead>
                      <tr>
                        <BiExcelHead label={t("city")} filterKey="city" options={areaOptions} filters={areaFilters} onChange={setAreaFilter} allLabel={t("all")} />
                        <BiExcelHead label={t("area")} filterKey="area" options={areaOptions} filters={areaFilters} onChange={setAreaFilter} allLabel={t("all")} />
                        <BiExcelHead label={t("customers")} filterKey="customers" options={areaOptions} filters={areaFilters} onChange={setAreaFilter} allLabel={t("all")} />
                        <BiExcelHead label={t("withGps")} filterKey="with_gps" options={areaOptions} filters={areaFilters} onChange={setAreaFilter} allLabel={t("all")} />
                        <BiExcelHead label={t("withoutGps")} filterKey="without_gps" options={areaOptions} filters={areaFilters} onChange={setAreaFilter} allLabel={t("all")} className="moduleBiTotalCol" />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAreaRows.map((row) => {
                        const selected = row.area_key === selectedAreaKey;
                        return (
                          <tr
                            key={row.area_key}
                            className={selected ? "customerMapAreaRow--selected" : undefined}
                            onClick={() => handleSelectArea(row.area_key)}
                            style={{ cursor: "pointer" }}
                          >
                            <td data-label={t("city")}>{row.city}</td>
                            <td data-label={t("area")}>{row.area}</td>
                            <td data-label={t("customers")}>
                              <button
                                type="button"
                                className="moduleInlineButton"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleSelectArea(row.area_key);
                                }}
                              >
                                {formatCount(row.customers)}
                              </button>
                            </td>
                            <td data-label={t("withGps")}>{formatCount(row.with_gps)}</td>
                            <td data-label={t("withoutGps")} className="moduleBiTotalCol">{formatCount(row.without_gps)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={2}><strong>{t("total")}</strong></td>
                        <td><strong>{formatCount(areaTotals.customers)}</strong></td>
                        <td><strong>{formatCount(areaTotals.with_gps)}</strong></td>
                        <td className="moduleBiTotalCol"><strong>{formatCount(areaTotals.without_gps)}</strong></td>
                      </tr>
                    </tfoot>
                  </table>
                </ExportableTable>
              )}
            </section>
          </>
        )}
      </main>
    </MorningAttendanceGate>
  );
}
