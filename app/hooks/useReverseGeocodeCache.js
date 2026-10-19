"use client";

import { useEffect, useState } from "react";
import { buildReverseGeocodeCache, coordinateCacheKey } from "../lib/geo";

export function useReverseGeocodeCache(report) {
  const [geocodeCache, setGeocodeCache] = useState(() => new Map());

  useEffect(() => {
    if (!report?.users?.length) {
      setGeocodeCache(new Map());
      return undefined;
    }

    let cancelled = false;

    const keys = report.users
      .flatMap((entryUser) => entryUser.entries || [])
      .filter((entry) => entry.hasEntryGps && (!entry.area || !entry.street))
      .map((entry) => coordinateCacheKey(entry.entryLatitude, entry.entryLongitude))
      .filter(Boolean);

    if (keys.length === 0) {
      setGeocodeCache(new Map());
      return undefined;
    }

    buildReverseGeocodeCache(keys)
      .then((cache) => {
        if (!cancelled) setGeocodeCache(cache);
      })
      .catch(() => {
        if (!cancelled) setGeocodeCache(new Map());
      });

    return () => {
      cancelled = true;
    };
  }, [report]);

  return geocodeCache;
}
