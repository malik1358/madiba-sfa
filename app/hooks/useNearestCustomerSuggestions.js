"use client";

import { useCallback, useEffect, useState } from "react";
import { captureGpsLocation, findNearestCustomers } from "../lib/geo.js";

export function useNearestCustomerSuggestions(customers, options = {}) {
  const limit = Number(options.limit || 3);
  const enabled = options.enabled !== false;
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [locationUnavailable, setLocationUnavailable] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled || !Array.isArray(customers) || customers.length === 0) {
      setSuggestions([]);
      setLocationUnavailable(false);
      return;
    }

    setLoading(true);
    setLocationUnavailable(false);

    try {
      const location = await captureGpsLocation();
      const nearest = findNearestCustomers(customers, location.latitude, location.longitude, limit);
      setSuggestions(nearest);
      setLocationUnavailable(nearest.length === 0);
    } catch {
      setSuggestions([]);
      setLocationUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, [customers, enabled, limit]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    suggestions,
    loading,
    locationUnavailable,
    refresh,
  };
}
