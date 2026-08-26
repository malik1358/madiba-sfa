"use client";

import { formatDistanceKm } from "../lib/geo.js";
import { translate, useAppLanguage } from "../lib/appLanguage.js";

const TEXT = {
  title: { en: "Nearest customers", ar: "أقرب العملاء" },
  hint: {
    en: "Based on your current location and saved customer GPS.",
    ar: "بناءً على موقعك الحالي وإحداثيات العملاء المحفوظة.",
  },
  loading: { en: "Finding nearby customers...", ar: "جاري البحث عن العملاء القريبين..." },
  unavailable: {
    en: "Unable to find nearby customers with saved GPS from your current location.",
    ar: "تعذر العثور على عملاء قريبين بإحداثيات محفوظة من موقعك الحالي.",
  },
  refresh: { en: "Refresh", ar: "تحديث" },
};

export default function NearestCustomerSuggestions({
  suggestions = [],
  loading = false,
  locationUnavailable = false,
  onSelect,
  onRefresh,
  actionLabel,
}) {
  const { language, dir } = useAppLanguage();
  const t = translate(language, TEXT);

  if (!loading && suggestions.length === 0 && !locationUnavailable) {
    return null;
  }

  return (
    <section className="moduleNearestCustomers" dir={dir} aria-label={t("title")}>
      <div className="moduleSectionHeader">
        <h2>{t("title")}</h2>
        {onRefresh ? (
          <button type="button" className="moduleInlineButton" onClick={onRefresh} disabled={loading}>
            {t("refresh")}
          </button>
        ) : null}
      </div>
      <div className="moduleHint">{t("hint")}</div>

      {loading ? (
        <div className="moduleLoading">{t("loading")}</div>
      ) : suggestions.length > 0 ? (
        <div className="moduleNearestCustomersList">
          {suggestions.map((customer) => (
            <button
              type="button"
              key={`nearest-${customer.customer_code}`}
              className="moduleNearestCustomersCard"
              onClick={() => onSelect?.(customer)}
            >
              <div>
                <strong>{customer.customer_name || customer.customer_code}</strong>
                <div className="moduleCode">{customer.customer_code}</div>
              </div>
              <span>{formatDistanceKm(customer.distanceKm)}</span>
              {actionLabel ? <span className="moduleNearestCustomersAction">{actionLabel}</span> : null}
            </button>
          ))}
        </div>
      ) : (
        <div className="moduleHint">{t("unavailable")}</div>
      )}
    </section>
  );
}
