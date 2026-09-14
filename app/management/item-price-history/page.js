"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import ExportableTable from "../../components/ExportableTable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { fetchJsonWithTimeout, resolveAuthSession } from "../../lib/authSession";
import { PRICING_REGIONS, pricingRegionLabel } from "../../lib/regionalPricing";
import { getSupabaseClient } from "../../lib/supabase";
import { formatKsaDateTime } from "../../lib/workdayActivity";
import { usePopupMessages } from "../../hooks/usePopupMessages";

const TEXT = {
  title: { en: "Item Price History", ar: "سجل أسعار الأصناف" },
  subtitle: {
    en: "Look up an item and see at least the last 5 catalog prices with dates.",
    ar: "ابحث عن صنف واعرض آخر 5 أسعار على الأقل مع التواريخ.",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  search: { en: "Item code or name", ar: "كود أو اسم الصنف" },
  region: { en: "Region", ar: "المنطقة" },
  lookup: { en: "Show history", ar: "عرض السجل" },
  loading: { en: "Loading price history...", ar: "جاري تحميل سجل الأسعار..." },
  searching: { en: "Searching...", ar: "جاري البحث..." },
  date: { en: "Date", ar: "التاريخ" },
  price: { en: "Price (SAR)", ar: "السعر (ر.س)" },
  change: { en: "Change", ar: "التغيير" },
  previous: { en: "Previous", ar: "السابق" },
  source: { en: "Source", ar: "المصدر" },
  current: { en: "Current", ar: "الحالي" },
  up: { en: "Up", ar: "ارتفاع" },
  down: { en: "Down", ar: "انخفاض" },
  same: { en: "Same", ar: "ثابت" },
  noRows: {
    en: "No historic prices found for this item yet. History builds from price sync snapshots.",
    ar: "لا يوجد سجل أسعار لهذا الصنف بعد. يتم بناء السجل من لقطات مزامنة الأسعار.",
  },
  pickItem: { en: "Search and select an item to view historic prices.", ar: "ابحث واختر صنفاً لعرض الأسعار التاريخية." },
  matches: { en: "Matches", ar: "النتائج" },
  item: { en: "Item", ar: "الصنف" },
  category: { en: "Category", ar: "الفئة" },
  currentPrice: { en: "Current price", ar: "السعر الحالي" },
  syncedAt: { en: "Catalog synced", ar: "آخر مزامنة" },
  historyCount: { en: "Prices shown", ar: "الأسعار المعروضة" },
  accessDenied: {
    en: "Only sales users can view item price history.",
    ar: "فقط مستخدمو المبيعات يمكنهم عرض سجل أسعار الأصناف.",
  },
};

function formatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "-";
  return number.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

function changeClass(change) {
  if (change === "up") return "moduleBiMonthCell--up";
  if (change === "down") return "moduleBiMonthCell--down";
  return "";
}

function sourceLabel(source, t) {
  const value = String(source || "").toLowerCase();
  if (value.includes("cache")) return t("current");
  if (value.includes("snapshot")) return "Snapshot";
  return "Sync";
}

export default function ItemPriceHistoryPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("riyadh");
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [matches, setMatches] = useState([]);
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState([]);
  const [meta, setMeta] = useState({
    currentPrice: null,
    syncedAt: null,
    historyCount: 0,
    migrationHint: null,
  });

  usePopupMessages({ error });

  const loadHistory = useCallback(async (itemCode, nextRegion = region) => {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    setLoading(true);
    setError("");
    try {
      const session = await resolveAuthSession(supabase);
      if (!session?.access_token) {
        throw new Error("Please login again.");
      }

      const params = new URLSearchParams({
        itemCode: String(itemCode || "").trim().toUpperCase(),
        region: nextRegion,
        limit: "12",
      });
      const payload = await fetchJsonWithTimeout(`/api/admin/item-price-history?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!payload?.success) {
        if (payload?.error && /only sales/i.test(payload.error)) {
          setAccessDenied(true);
        }
        throw new Error(payload?.error || "Unable to load item price history.");
      }

      setSelected(payload.item || { itemCode, itemName: itemCode });
      setHistory(Array.isArray(payload.history) ? payload.history : []);
      setMeta({
        currentPrice: payload.currentPrice,
        syncedAt: payload.syncedAt,
        historyCount: payload.historyCount || 0,
        migrationHint: payload.migrationHint || null,
      });
      setMatches([]);
    } catch (loadError) {
      setError(loadError.message || "Unable to load item price history.");
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, [region]);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return undefined;

    let cancelled = false;
    const timer = setTimeout(async () => {
      const needle = String(query || "").trim();
      if (needle.length < 2) {
        setMatches([]);
        return;
      }
      if (selected && (
        needle.toUpperCase() === String(selected.itemCode || "").toUpperCase()
        || needle === selected.itemName
      )) {
        return;
      }

      setSearching(true);
      setError("");
      try {
        const session = await resolveAuthSession(supabase);
        if (!session?.access_token) return;
        const params = new URLSearchParams({ q: needle, region });
        const payload = await fetchJsonWithTimeout(`/api/admin/item-price-history?${params}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (cancelled) return;
        if (!payload?.success) {
          if (payload?.error && /only sales/i.test(payload.error)) {
            setAccessDenied(true);
          }
          throw new Error(payload?.error || "Search failed.");
        }
        setMatches(Array.isArray(payload.matches) ? payload.matches : []);
      } catch (searchError) {
        if (!cancelled) setError(searchError.message || "Search failed.");
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 280);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, region, selected]);

  async function onSubmit(event) {
    event.preventDefault();
    const needle = String(query || "").trim().toUpperCase();
    if (!needle) {
      setError("Enter an item code or name.");
      return;
    }
    if (matches.length === 1) {
      const match = matches[0];
      setQuery(match.itemCode);
      await loadHistory(match.itemCode, region);
      return;
    }
    await loadHistory(needle, region);
  }

  const summaryLine = useMemo(() => {
    if (!selected) return "";
    const parts = [
      `${t("item")}: ${selected.itemCode}${selected.itemName && selected.itemName !== selected.itemCode ? ` — ${selected.itemName}` : ""}`,
    ];
    if (selected.category) parts.push(`${t("category")}: ${selected.category}`);
    parts.push(`${t("currentPrice")}: ${formatPrice(meta.currentPrice)}`);
    parts.push(`${t("historyCount")}: ${meta.historyCount}`);
    if (meta.syncedAt) parts.push(`${t("syncedAt")}: ${formatKsaDateTime(meta.syncedAt)}`);
    return parts.join(" • ");
  }, [meta, selected, t]);

  if (!getSupabaseClient()) {
    return <SupabaseUnavailable />;
  }

  return (
    <MorningAttendanceGate>
      <main className="modulePage" dir={dir}>
        <header className="moduleHeader">
          <div>
            <p className="moduleEyebrow">
              <Link href="/management">{t("back")}</Link>
            </p>
            <h1>{t("title")}</h1>
            <p className="moduleSubtitle">{t("subtitle")}</p>
          </div>
          <AppLanguageSwitch language={language} setLanguage={setLanguage} />
        </header>

        {accessDenied ? (
          <p className="moduleError">{t("accessDenied")}</p>
        ) : (
          <>
            <form className="moduleCard moduleFilterRow" onSubmit={onSubmit}>
              <label style={{ flex: 2 }}>
                {t("search")}
                <input
                  className="moduleInput"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setSelected(null);
                  }}
                  placeholder="A004224 or item name"
                  autoComplete="off"
                />
              </label>
              <label>
                {t("region")}
                <select
                  className="moduleInput"
                  value={region}
                  onChange={(event) => {
                    const next = event.target.value;
                    setRegion(next);
                    if (selected?.itemCode) {
                      loadHistory(selected.itemCode, next);
                    }
                  }}
                >
                  {PRICING_REGIONS.map((entry) => (
                    <option key={entry} value={entry}>
                      {pricingRegionLabel(entry)}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="modulePrimaryButton" disabled={loading}>
                {loading ? t("loading") : t("lookup")}
              </button>
            </form>

            {searching ? <p className="moduleHint">{t("searching")}</p> : null}

            {matches.length > 0 && !selected ? (
              <section className="moduleCard">
                <h2>{t("matches")}</h2>
                <div className="moduleTableWrap">
                  <table className="moduleTable">
                    <thead>
                      <tr>
                        <th>{t("item")}</th>
                        <th>{t("category")}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {matches.map((row) => (
                        <tr key={row.itemCode}>
                          <td>
                            <strong>{row.itemCode}</strong>
                            <div className="moduleHint">{row.itemName}</div>
                          </td>
                          <td>{row.category || "-"}</td>
                          <td>
                            <button
                              type="button"
                              className="moduleInlineButton"
                              onClick={() => {
                                setQuery(row.itemCode);
                                loadHistory(row.itemCode, region);
                              }}
                            >
                              {t("lookup")}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            {!selected && matches.length === 0 && !loading ? (
              <p className="moduleHint">{t("pickItem")}</p>
            ) : null}

            {selected ? (
              <section className="moduleCard">
                <p className="moduleHint">{summaryLine}</p>
                {meta.migrationHint ? <p className="moduleHint">{meta.migrationHint}</p> : null}

                {loading ? (
                  <p className="moduleHint">{t("loading")}</p>
                ) : history.length === 0 ? (
                  <p className="moduleHint">{t("noRows")}</p>
                ) : (
                  <ExportableTable filename={`item-price-history-${selected.itemCode}`}>
                    <div className="moduleTableWrap">
                      <table className="moduleTable">
                        <thead>
                          <tr>
                            <th>{t("date")}</th>
                            <th>{t("price")}</th>
                            <th>{t("previous")}</th>
                            <th>{t("change")}</th>
                            <th>{t("source")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {history.map((row) => (
                            <tr key={`${row.recordedAt}-${row.price}-${row.source}`}>
                              <td className={row.isCurrent ? "moduleBiMonthCell--current" : ""}>
                                {formatKsaDateTime(row.recordedAt)}
                                {row.isCurrent ? ` (${t("current")})` : ""}
                              </td>
                              <td className={`${changeClass(row.change)}${row.isCurrent ? " moduleBiMonthCell--current" : ""}`.trim()}>
                                {formatPrice(row.price)}
                              </td>
                              <td>{formatPrice(row.previousPrice)}</td>
                              <td className={changeClass(row.change)}>
                                {row.change === "up" ? t("up") : row.change === "down" ? t("down") : t("same")}
                              </td>
                              <td>{sourceLabel(row.source, t)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </ExportableTable>
                )}
              </section>
            ) : null}
          </>
        )}
      </main>
    </MorningAttendanceGate>
  );
}
