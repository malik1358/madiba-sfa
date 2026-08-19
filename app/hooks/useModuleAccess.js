"use client";

import { useEffect, useState } from "react";
import { buildModuleAccess } from "../lib/moduleAccess";
import { getSupabaseClient } from "../lib/supabase";

export function useModuleAccess() {
  const [access, setAccess] = useState(() => buildModuleAccess({}));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadAccess() {
      const supabase = getSupabaseClient();
      if (!supabase) {
        if (!cancelled) {
          setAccess(buildModuleAccess({}));
          setLoading(false);
        }
        return;
      }

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.user) {
          if (!cancelled) {
            setAccess(buildModuleAccess({}));
            setLoading(false);
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

    loadAccess();
  }, []);

  return { access, loading };
}
