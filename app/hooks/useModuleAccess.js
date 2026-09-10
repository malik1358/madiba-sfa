"use client";

import { useEffect, useState } from "react";
import { withTimeout } from "../lib/authSession";
import { buildModuleAccess } from "../lib/moduleAccess";
import { readCacheEntry, writeCacheEntry } from "../lib/localDataStore";
import { getSupabaseClient } from "../lib/supabase";

const ACCESS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function accessCacheKey(userId) {
  return `moduleAccess:v1:${String(userId || "").trim()}`;
}

export function useModuleAccess() {
  const [access, setAccess] = useState(() => buildModuleAccess({}));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const supabase = getSupabaseClient();
    const stopLoading = () => {
      if (!cancelled) setLoading(false);
    };
    const failsafeTimer = window.setTimeout(stopLoading, 10000);

    if (!supabase) {
      setAccess(buildModuleAccess({}));
      stopLoading();
      window.clearTimeout(failsafeTimer);
      return undefined;
    }

    async function loadAccess(session) {
      try {
        if (!session?.user) {
          if (!cancelled) {
            setAccess(buildModuleAccess({}));
          }
          return;
        }

        const cacheKey = accessCacheKey(session.user.id);
        try {
          const cached = await withTimeout(readCacheEntry(cacheKey), 2000, "ACCESS_CACHE_TIMEOUT");
          if (cached?.value && !cancelled) {
            setAccess(buildModuleAccess(cached.value));
            stopLoading();
          }
        } catch {
          // Continue with the live profile fetch.
        }

        const profileQuery = supabase
          .from("profiles")
          .select("role,salesman_code,stock_take_access")
          .eq("id", session.user.id)
          .maybeSingle();
        let profileRes = await withTimeout(profileQuery, 8000, "PROFILE_TIMEOUT");

        if (profileRes.error) {
          profileRes = await withTimeout(
            supabase
              .from("profiles")
              .select("role,salesman_code")
              .eq("id", session.user.id)
              .maybeSingle(),
            8000,
            "PROFILE_TIMEOUT",
          );
        }

        if (profileRes.error) throw profileRes.error;

        const profile = profileRes.data;
        const context = {
          role: profile?.role,
          salesmanCode: profile?.salesman_code,
          collectionOnlyMetadata: Boolean(session.user.user_metadata?.collection_only),
          stockTakeAccess: profile?.stock_take_access === true,
        };
        if (!cancelled) {
          setAccess(buildModuleAccess(context));
        }
        writeCacheEntry(cacheKey, context, { ttlMs: ACCESS_TTL_MS }).catch(() => {});
      } catch {
        // Keep cached access when the live profile request fails offline.
      } finally {
        stopLoading();
      }
    }

    withTimeout(supabase.auth.getSession(), 8000, "SESSION_TIMEOUT").then((result) => {
      if (!cancelled) loadAccess(result?.data?.session);
    }).catch(() => {
      stopLoading();
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled) loadAccess(session);
    });

    return () => {
      cancelled = true;
      window.clearTimeout(failsafeTimer);
      subscription.unsubscribe();
    };
  }, []);

  return { access, loading };
}
