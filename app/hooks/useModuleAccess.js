"use client";

import { useEffect, useState } from "react";
import { buildModuleAccess } from "../lib/moduleAccess";
import { getSupabaseClient } from "../lib/supabase";

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

        const { data: profile } = await supabase
          .from("profiles")
          .select("role,salesman_code")
          .eq("id", session.user.id)
          .maybeSingle();

        if (!cancelled) {
          setAccess(buildModuleAccess({
            role: profile?.role,
            salesmanCode: profile?.salesman_code,
            collectionOnlyMetadata: Boolean(session.user.user_metadata?.collection_only),
          }));
        }
      } catch {
        if (!cancelled) {
          setAccess(buildModuleAccess({}));
        }
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
