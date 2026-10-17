"use client";

import { useEffect, useState } from "react";
import { fetchJsonWithTimeout, resolveAuthSession, withTimeout } from "../lib/authSession";
import { buildModuleAccess } from "../lib/moduleAccess";
import { readCacheEntry, writeCacheEntry } from "../lib/localDataStore";
import { getSupabaseClient } from "../lib/supabase";

const ACCESS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function accessCacheKey(userId) {
  return `moduleAccess:v2:${String(userId || "").trim()}`;
}

export function useModuleAccess() {
  const [access, setAccess] = useState(() => buildModuleAccess({}));
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let accessLoadPending = false;
    let initialSessionSettled = false;
    const supabase = getSupabaseClient();
    const stopLoading = () => {
      if (!cancelled) setLoading(false);
    };
    const failsafeTimer = window.setTimeout(() => {
      if (cancelled || accessLoadPending) return;
      setSignedIn((current) => (current == null ? false : current));
      stopLoading();
    }, 10000);

    if (!supabase) {
      setAccess(buildModuleAccess({}));
      setSignedIn(false);
      stopLoading();
      window.clearTimeout(failsafeTimer);
      return undefined;
    }

    async function loadRoleModuleMatrix(accessToken) {
      if (!accessToken) return null;
      try {
        const { response, payload } = await fetchJsonWithTimeout(
          "/api/role-module-access",
          { headers: { Authorization: `Bearer ${accessToken}` } },
          8000,
        );
        if (!response.ok || !payload?.success || !payload.matrix) return null;
        return payload.matrix;
      } catch {
        return null;
      }
    }

    async function loadAccess(session) {
      accessLoadPending = true;
      try {
        if (!session?.user) {
          if (!cancelled) {
            setSignedIn(false);
            setAccess(buildModuleAccess({}));
          }
          return;
        }
        if (!cancelled) setSignedIn(true);

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
        const roleModuleMatrix = await loadRoleModuleMatrix(session.access_token);
        const context = {
          role: profile?.role,
          salesmanCode: profile?.salesman_code,
          collectionOnlyMetadata: Boolean(session.user.user_metadata?.collection_only),
          stockTakeAccess: profile?.stock_take_access === true,
          roleModuleMatrix,
        };
        if (!cancelled) {
          setAccess(buildModuleAccess(context));
        }
        writeCacheEntry(cacheKey, context, { ttlMs: ACCESS_TTL_MS }).catch(() => {});
      } catch {
        // Keep cached access when the live profile request fails offline.
      } finally {
        accessLoadPending = false;
        stopLoading();
      }
    }

    resolveAuthSession(supabase, 8000).then((session) => {
      initialSessionSettled = true;
      if (!cancelled) loadAccess(session);
    }).catch(() => {
      initialSessionSettled = true;
      if (!cancelled && !accessLoadPending) {
        setSignedIn(false);
        stopLoading();
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      if (!initialSessionSettled && !session?.user) return;
      loadAccess(session);
    });

    return () => {
      cancelled = true;
      window.clearTimeout(failsafeTimer);
      subscription.unsubscribe();
    };
  }, []);

  return { access, loading, signedIn };
}
