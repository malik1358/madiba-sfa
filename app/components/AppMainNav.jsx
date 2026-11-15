"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  MODULES,
  listAccessibleNavGroups,
  localizedModuleLabel,
  localizedNavGroupLabel,
  pathMatchesModuleHref,
  pinnedModuleKeysForAccess,
} from "../lib/moduleAccess";
import { translate, useAppLanguage } from "../lib/appLanguage";
import { useModuleAccess } from "../hooks/useModuleAccess";
import { getSupabaseClient } from "../lib/supabase";

const NAV_TEXT = {
  mainNavigation: { en: "Main navigation", ar: "التنقل الرئيسي" },
  searchScreens: { en: "Search screens…", ar: "ابحث عن شاشة…" },
  noScreensFound: { en: "No screens found", ar: "لا توجد شاشات مطابقة" },
};

export default function AppMainNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { language, dir } = useAppLanguage();
  const t = translate(language, NAV_TEXT);
  const { access, loading } = useModuleAccess();
  const [signedIn, setSignedIn] = useState(false);
  const [openGroup, setOpenGroup] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [hoverCapable, setHoverCapable] = useState(false);
  const navRef = useRef(null);
  const searchRef = useRef(null);

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
    if (!openGroup && !searchOpen) return undefined;

    function handlePointerDown(event) {
      if (!navRef.current?.contains(event.target)) {
        setOpenGroup("");
      }
      if (!searchRef.current?.contains(event.target)) {
        setSearchOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [openGroup, searchOpen]);

  const groups = useMemo(
    () => (signedIn && !loading ? listAccessibleNavGroups(access) : []),
    [access, loading, signedIn],
  );
  const pinnedItems = useMemo(
    () => {
      if (!signedIn || loading) return [];
      return pinnedModuleKeysForAccess(access)
        .map((moduleKey) => {
          const href = MODULES[moduleKey]?.href;
          if (!href) return null;
          return {
            moduleKey,
            href,
            label: localizedModuleLabel(moduleKey, language),
          };
        })
        .filter(Boolean);
    },
    [access, language, loading, signedIn],
  );

  const searchableScreens = useMemo(() => {
    const seen = new Set();
    const items = [];
    for (const group of groups) {
      for (const item of group.items) {
        if (seen.has(item.moduleKey)) continue;
        seen.add(item.moduleKey);
        items.push({
          moduleKey: item.moduleKey,
          href: item.href,
          groupKey: group.key,
          labelEn: localizedModuleLabel(item.moduleKey, "en").toLowerCase(),
          labelAr: localizedModuleLabel(item.moduleKey, "ar"),
        });
      }
    }
    return items;
  }, [groups]);
  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    return searchableScreens
      .filter((item) => item.labelEn.includes(query) || item.labelAr.includes(query))
      .slice(0, 12);
  }, [searchQuery, searchableScreens]);

  function closeSearch() {
    setSearchQuery("");
    setSearchOpen(false);
  }

  if (!signedIn || (groups.length === 0 && pinnedItems.length === 0)) {
    return null;
  }

  return (
    <nav className="appMainNav" aria-label={t("mainNavigation")} dir={dir} ref={navRef}>
      <div className="appMainNavSearch" ref={searchRef}>
        <input
          type="search"
          className="appMainNavSearchInput"
          value={searchQuery}
          placeholder={t("searchScreens")}
          aria-label={t("searchScreens")}
          onChange={(event) => {
            setSearchQuery(event.target.value);
            setSearchOpen(true);
          }}
          onFocus={() => setSearchOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              closeSearch();
              event.currentTarget.blur();
            } else if (event.key === "Enter" && searchResults.length > 0) {
              event.preventDefault();
              const href = searchResults[0].href;
              closeSearch();
              router.push(href);
            }
          }}
        />
        {searchOpen && searchQuery.trim() ? (
          <div className="appMainNavSearchResults">
            {searchResults.length > 0 ? (
              searchResults.map((item) => (
                <Link
                  key={item.moduleKey}
                  href={item.href}
                  className="appMainNavSearchLink"
                  onClick={closeSearch}
                >
                  <span>{localizedModuleLabel(item.moduleKey, language)}</span>
                  <span className="appMainNavSearchGroupTag">{localizedNavGroupLabel(item.groupKey, language)}</span>
                </Link>
              ))
            ) : (
              <div className="appMainNavSearchEmpty">{t("noScreensFound")}</div>
            )}
          </div>
        ) : null}
      </div>
      {groups.map((group) => {
        const isOpen = openGroup === group.key;
        const hasActiveItem = group.items.some((item) => pathMatchesModuleHref(pathname, item.href));

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
              {localizedNavGroupLabel(group.key, language)}
            </button>
            <div className={`appMainNavDropdown${isOpen ? " appMainNavDropdown--open" : ""}`}>
              {group.items.map((item) => (
                <Link
                  key={item.moduleKey}
                  href={item.href}
                  className={`appMainNavLink${pathMatchesModuleHref(pathname, item.href) ? " appMainNavLink--active" : ""}`}
                  onClick={() => setOpenGroup("")}
                >
                  {localizedModuleLabel(item.moduleKey, language)}
                </Link>
              ))}
            </div>
          </div>
        );
      })}
      {pinnedItems.length > 0 ? (
        <div className="appMainNavPinned">
          {pinnedItems.map((item) => (
            <Link
              key={item.moduleKey}
              href={item.href}
              className={`appMainNavPinnedLink${pathMatchesModuleHref(pathname, item.href) ? " appMainNavPinnedLink--active" : ""}`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ) : null}
    </nav>
  );
}
