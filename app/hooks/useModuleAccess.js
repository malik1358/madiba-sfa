"use client";

import { useEffect, useState } from "react";
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

    if (!supabase) {
      setAccess(buildModuleAccess({}));
      setLoading(false);
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
        const cached = await readCacheEntry(cacheKey);
        if (cached?.value && !cancelled) {
          setAccess(buildModuleAccess(cached.value));
          setLoading(false);
        }

        let profileRes = await supabase
          .from("profiles")
          .select("role,salesman_code,stock_take_access")
          .eq("id", session.user.id)
          .maybeSingle();

        if (profileRes.error) {
          profileRes = await supabase
            .from("profiles")
            .select("role,salesman_code")
            .eq("id", session.user.id)
            .maybeSingle();
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
        await writeCacheEntry(cacheKey, context, { ttlMs: ACCESS_TTL_MS });
      } catch {
        // Keep cached access when the live profile request fails offline.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) loadAccess(data?.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled) loadAccess(session);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  return { access, loading };
}
