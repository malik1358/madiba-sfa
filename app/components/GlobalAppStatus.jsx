"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "../lib/supabase";

export default function GlobalAppStatus({ environment, buildId }) {
  const [identity, setIdentity] = useState("Not signed in");

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setIdentity("Supabase unavailable");
      return undefined;
    }

    let mounted = true;

    async function loadIdentity(session) {
      if (!session?.user) {
        if (mounted) setIdentity("Not signed in");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("salesman_name,salesman_code,role")
        .eq("id", session.user.id)
        .maybeSingle();

      if (!mounted) return;

      const name = String(profile?.salesman_name || session.user.email || session.user.id).trim();
      const code = String(profile?.salesman_code || "").trim();
      const role = String(profile?.role || "").trim();
      const details = [code, role].filter(Boolean).join(" / ");
      setIdentity(details ? `${name} (${details})` : name);
    }

    supabase.auth.getSession().then(({ data }) => loadIdentity(data?.session));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      loadIdentity(session);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <div className={`globalAppStatus globalAppStatus${environment}`} role="status">
      <span><strong>User:</strong> {identity}</span>
      <span><strong>Server:</strong> {environment}</span>
      <span><strong>Build:</strong> {buildId}</span>
    </div>
  );
}