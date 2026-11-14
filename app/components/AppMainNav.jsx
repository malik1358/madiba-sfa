"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  MODULES,
  filterAccessibleModulesByQuery,
  listAccessibleNavGroups,
  localizedModuleLabel,
  localizedNavGroupLabel,
  localizedNavSubgroupLabel,
  pathMatchesModuleHref,
  pinnedModuleKeysForAccess,
} from "../lib/moduleAccess";
import { translate, useAppLanguage } from "../lib/appLanguage";
import { useModuleAccess } from "../hooks/useModuleAccess";
import { getSupabaseClient } from "../lib/supabase";

const NAV_TEXT = {
  mainNavigation: { en: "Main navigation", ar: "التنقل الرئيسي" },
  searchScreens: { en: "Search screens…", ar: "البحث في الشاشات…" },
  searchScreensAria: { en: "Search screens", ar: "البحث في الشاشات" },
  noScreensFound: { en: "No screens found", ar: "لا توجد شاشات" },
};

export default function AppMainNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { language, dir } = useAppLanguage();
  const t = translate(language, NAV_TEXT);
  const { access, loading } = useModuleAccess();
  const [signedIn, setSignedIn] = useState(false);
  const [openGroup, setOpenGroup] = useState("");
  const [hoverCapable, setHoverCapable] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
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
        setSearchOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [openGroup, searchOpen]);

  useEffect(() => {
    setSearchQuery("");
    setSearchOpen(false);
    setOpenGroup("");
  }, [pathname]);

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
  const searchResults = useMemo(
    () => (signedIn && !loading ? filterAccessibleModulesByQuery(access, searchQuery, language) : []),
    [access, language, loading, searchQuery, signedIn],
  );

  useEffect(() => {
    setActiveSearchIndex(0);
  }, [searchQuery]);

  function closeSearch() {
    setSearchOpen(false);
    setSearchQuery("");
    setActiveSearchIndex(0);
  }

  function goToScreen(href) {
    if (!href) return;
    closeSearch();
    setOpenGroup("");
    router.push(href);
  }

  function handleSearchKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearch();
      searchRef.current?.blur();
      return;
    }

    if (!searchResults.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSearchOpen(true);
      setActiveSearchIndex((current) => (current + 1) % searchResults.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSearchOpen(true);
      setActiveSearchIndex((current) => (current - 1 + searchResults.length) % searchResults.length);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const target = searchResults[activeSearchIndex] || searchResults[0];
      if (target?.href) goToScreen(target.href);
    }
  }

  if (!signedIn || (groups.length === 0 && pinnedItems.length === 0)) {
    return null;
  }

  return (
    <nav className="appMainNav" aria-label={t("mainNavigation")} dir={dir} ref={navRef}>
      <div className={`appMainNavSearch${searchOpen ? " appMainNavSearch--open" : ""}`}>
        <input
          ref={searchRef}
          type="search"
          className="appMainNavSearchInput"
          value={searchQuery}
          placeholder={t("searchScreens")}
          aria-label={t("searchScreensAria")}
          aria-expanded={searchOpen}
          aria-controls="app-main-nav-search-results"
          autoComplete="off"
          onFocus={() => setSearchOpen(true)}
          onChange={(event) => {
            setSearchQuery(event.target.value);
            setSearchOpen(true);
            setOpenGroup("");
          }}
          onKeyDown={handleSearchKeyDown}
        />
        {searchOpen && searchQuery.trim() ? (
          <div
            id="app-main-nav-search-results"
            className="appMainNavSearchResults"
            role="listbox"
          >
            {searchResults.length === 0 ? (
              <div className="appMainNavSearchEmpty">{t("noScreensFound")}</div>
            ) : (
              searchResults.map((item, index) => (
                <Link
                  key={item.moduleKey}
                  href={item.href}
                  role="option"
                  aria-selected={index === activeSearchIndex}
                  className={`appMainNavSearchResult${index === activeSearchIndex ? " appMainNavSearchResult--active" : ""}`}
                  onMouseEnter={() => setActiveSearchIndex(index)}
                  onClick={() => closeSearch()}
                >
                  <span className="appMainNavSearchResultLabel">{item.label}</span>
                </Link>
              ))
            )}
          </div>
        ) : null}
      </div>
      {groups.map((group) => {
        const isOpen = openGroup === group.key;
        const hasActiveItem = group.items.some((item) => pathMatchesModuleHref(pathname, item.href));
        const useSubgroups = Array.isArray(group.subgroups) && group.subgroups.length > 0;

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
                setSearchOpen(false);
                setOpenGroup((current) => (current === group.key ? "" : group.key));
              }}
            >
              {localizedNavGroupLabel(group.key, language)}
            </button>
            <div className={`appMainNavDropdown${isOpen ? " appMainNavDropdown--open" : ""}${useSubgroups ? " appMainNavDropdown--grouped" : ""}`}>
              {useSubgroups
                ? group.subgroups.map((subgroup) => (
                  <div key={subgroup.key} className="appMainNavSubgroup">
                    <div className="appMainNavSubgroupLabel">
                      {localizedNavSubgroupLabel(subgroup.key, language) || subgroup.label}
                    </div>
                    {subgroup.items.map((item) => (
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
                ))
                : group.items.map((item) => (
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
