"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { listAccessibleNavGroups } from "../lib/moduleAccess";
import { useModuleAccess } from "../hooks/useModuleAccess";
import { getSupabaseClient } from "../lib/supabase";

export default function AppMainNav() {
  const pathname = usePathname();
  const { access, loading } = useModuleAccess();
  const [signedIn, setSignedIn] = useState(false);
  const [openGroup, setOpenGroup] = useState("");
  const [hoverCapable, setHoverCapable] = useState(false);
  const navRef = useRef(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
    const syncHoverCapable = () => setHoverCapable(mediaQuery.matches);

    syncHoverCapable();
    mediaQuery.addEventListener("change", syncHoverCapable);
    return () => mediaQuery.removeEventListener("change", syncHoverCapable);
  }, []);

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

  useEffect(() => {
    if (!openGroup) return undefined;

    function handlePointerDown(event) {
      if (!navRef.current?.contains(event.target)) {
        setOpenGroup("");
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [openGroup]);

  const groups = useMemo(
    () => (signedIn && !loading ? listAccessibleNavGroups(access) : []),
    [access, loading, signedIn],
  );

  if (!signedIn || groups.length === 0) {
    return null;
  }

  return (
    <nav className="appMainNav" aria-label="Main navigation" ref={navRef}>
      {groups.map((group) => {
        const isOpen = openGroup === group.key;
        const hasActiveItem = group.items.some((item) => item.href === pathname);

        return (
          <div
            key={group.key}
            className={`appMainNavGroup${hasActiveItem ? " appMainNavGroup--active" : ""}${isOpen ? " appMainNavGroup--open" : ""}`}
            onMouseEnter={hoverCapable ? () => setOpenGroup(group.key) : undefined}
            onMouseLeave={hoverCapable ? () => setOpenGroup("") : undefined}
          >
            <button
              type="button"
              className="appMainNavGroupButton"
              aria-expanded={isOpen}
              aria-haspopup="true"
              onClick={(event) => {
                event.stopPropagation();
                setOpenGroup((current) => (current === group.key ? "" : group.key));
              }}
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
