"use client";

import { useEffect, useState } from "react";
import { buildNearestCustomerActionLinks } from "../lib/dashboardNearestCustomers.js";
import { fetchVisibleCustomersCached } from "../lib/mobileDataCache.js";
import { fetchSalesScope } from "../lib/salesScope.js";
import { getSupabaseClient } from "../lib/supabase.js";
import { useNearestCustomerSuggestions } from "../hooks/useNearestCustomerSuggestions.js";
import NearestCustomerSuggestions from "./NearestCustomerSuggestions.jsx";

const ACTION_LABELS = {
  visit: { en: "Visit without order", ar: "زيارة بدون طلب" },
  order: { en: "New order", ar: "طلب جديد" },
  collection: { en: "Collection", ar: "تحصيل" },
};

export default function DashboardNearestCustomers({ moduleAccess, language = "en" }) {
  const [customers, setCustomers] = useState([]);
  const [customersLoading, setCustomersLoading] = useState(true);
  const ar = language === "ar";
  const labels = {
    visit: ACTION_LABELS.visit[ar ? "ar" : "en"],
    order: ACTION_LABELS.order[ar ? "ar" : "en"],
    collection: ACTION_LABELS.collection[ar ? "ar" : "en"],
  };

  useEffect(() => {
    let cancelled = false;

    async function loadCustomers() {
      const supabase = getSupabaseClient();
      if (!supabase) {
        if (!cancelled) setCustomersLoading(false);
        return;
      }

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) return;

        const scope = await fetchSalesScope();
        const result = await fetchVisibleCustomersCached(session.access_token, scope, { enriched: false });
        if (cancelled) return;
        const rows = Array.isArray(result?.data) ? result.data : [];
        setCustomers(rows);
      } catch {
        if (!cancelled) setCustomers([]);
      } finally {
        if (!cancelled) setCustomersLoading(false);
      }
    }

    loadCustomers();

    return () => {
      cancelled = true;
    };
  }, []);

  const {
    suggestions,
    loading,
    locationUnavailable,
    refresh,
  } = useNearestCustomerSuggestions(customers);

  const awaitingGps = customers.length > 0 && suggestions.length === 0 && !locationUnavailable;
  const finding = customersLoading || loading || awaitingGps;
  if (!finding && suggestions.length === 0 && !locationUnavailable) {
    return null;
  }

  return (
    <div className="dashboardNearestCustomers">
      <NearestCustomerSuggestions
        suggestions={suggestions}
        loading={finding}
        locationUnavailable={locationUnavailable}
        onRefresh={refresh}
        actions={(customer) => buildNearestCustomerActionLinks(customer, moduleAccess, labels)}
      />
    </div>
  );
}
