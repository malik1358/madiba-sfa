"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { listAccessibleNavGroups } from "../lib/moduleAccess";
import { useModuleAccess } from "../hooks/useModuleAccess";
import { getSupabaseClient } from "../lib/supabase";

export default function AppMainNav() {
  const pathname = usePathname();
  const { access, loading } = useModuleAccess();
  const [signedIn, setSignedIn] = useState(false);
  const [openGroup, setOpenGroup] = useState("");

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return undefined;

    supabase.auth.getSession().then(({ data }) => {
      setSignedIn(Boolean(data?.session?.user));
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session?.user));
    });

    return () => subscription.unsubscribe();
  }, []);

  const groups = useMemo(
    () => (signedIn && !loading ? listAccessibleNavGroups(access) : []),
    [access, loading, signedIn],
  );

  if (!signedIn || groups.length === 0) {
    return null;
  }

  return (
    <nav className="appMainNav" aria-label="Main navigation">
      {groups.map((group) => {
        const isOpen = openGroup === group.key;
        const hasActiveItem = group.items.some((item) => item.href === pathname);

        return (
          <div
            key={group.key}
            className={`appMainNavGroup${hasActiveItem ? " appMainNavGroup--active" : ""}`}
            onMouseEnter={() => setOpenGroup(group.key)}
            onMouseLeave={() => setOpenGroup("")}
          >
            <button
              type="button"
              className="appMainNavGroupButton"
              aria-expanded={isOpen}
              onClick={() => setOpenGroup((current) => (current === group.key ? "" : group.key))}
            >
              {group.label}
            </button>
            <div className={`appMainNavDropdown${isOpen ? " appMainNavDropdown--open" : ""}`}>
              {group.items.map((item) => (
                <Link
                  key={item.moduleKey}
                  href={item.href}
                  className={`appMainNavLink${pathname === item.href ? " appMainNavLink--active" : ""}`}
                  onClick={() => setOpenGroup("")}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
