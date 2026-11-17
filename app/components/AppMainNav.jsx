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
  pathMatchesModuleHref,
  pinnedModuleKeysForAccess,
} from "../lib/moduleAccess";
import { translate, useAppLanguage } from "../lib/appLanguage";
import { useModuleAccess } from "../hooks/useModuleAccess";
import { getSupabaseClient } from "../lib/supabase";

const NAV_TEXT = {
  mainNavigation: { en: "Main navigation", ar: "التنقل الرئيسي" },
  searchScreensAria: { en: "Search screens", ar: "البحث في الشاشات" },
  searchScreens: { en: "Search screens…", ar: "ابحث عن شاشة…" },
  noScreensFound: { en: "No screens found", ar: "لا توجد شاشات مطابقة" },
  menu: { en: "Menu", ar: "القائمة" },
};

export default function AppMainNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { language, dir } = useAppLanguage();
  const t = translate(language, NAV_TEXT);
  const { access, loading } = useModuleAccess();
  const [signedIn, setSignedIn] = useState(false);
  const [openGroup, setOpenGroup] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
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
    if (!openGroup && !searchOpen && !menuOpen) return undefined;

    function handlePointerDown(event) {
      if (!navRef.current?.contains(event.target)) {
        setOpenGroup("");
        setMenuOpen(false);
      }
      if (!searchRef.current?.contains(event.target)) {
        setSearchOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [openGroup, searchOpen, menuOpen]);

  useEffect(() => {
    setSearchQuery("");
    setSearchOpen(false);
    setOpenGroup("");
    setMenuOpen(false);
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
    () => (signedIn && !loading ? filterAccessibleModulesByQuery(access, searchQuery, language).slice(0, 12) : []),
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
    setMenuOpen(false);
    router.push(href);
  }

  function handleSearchKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearch();
      event.currentTarget.blur();
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
      <button
        type="button"
        className="appMainNavMenuButton"
        aria-expanded={menuOpen}
        aria-haspopup="true"
        onClick={() => {
          setMenuOpen((current) => !current);
          setOpenGroup("");
          setSearchOpen(false);
        }}
      >
        <span aria-hidden="true">☰</span> {t("menu")}
      </button>
      {menuOpen ? (
        <div className="appMainNavMobilePanel">
          {pinnedItems.length > 0 ? (
            <div className="appMainNavMobilePinned">
              {pinnedItems.map((item) => (
                <Link
                  key={item.moduleKey}
                  href={item.href}
                  className={`appMainNavPinnedLink${pathMatchesModuleHref(pathname, item.href) ? " appMainNavPinnedLink--active" : ""}`}
                  onClick={() => setMenuOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ) : null}
          {groups.map((group) => (
            <div key={group.key} className="appMainNavMobileGroup">
              <div className="appMainNavMobileGroupTitle">{localizedNavGroupLabel(group.key, language)}</div>
              <div className="appMainNavMobileLinks">
                {group.items.map((item) => (
                  <Link
                    key={item.moduleKey}
                    href={item.href}
                    className={`appMainNavLink${pathMatchesModuleHref(pathname, item.href) ? " appMainNavLink--active" : ""}`}
                    onClick={() => setMenuOpen(false)}
                  >
                    {localizedModuleLabel(item.moduleKey, language)}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="appMainNavSearch" ref={searchRef}>
        <input
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
            setMenuOpen(false);
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
                  className={`appMainNavSearchLink${index === activeSearchIndex ? " appMainNavSearchLink--active" : ""}`}
                  onMouseEnter={() => setActiveSearchIndex(index)}
                  onClick={() => closeSearch()}
                >
                  <span>{item.label}</span>
                  <span className="appMainNavSearchGroupTag">
                    {localizedNavGroupLabel(groups.find((group) => group.items.some((entry) => entry.moduleKey === item.moduleKey))?.key, language)}
                  </span>
                </Link>
              ))
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
                setSearchOpen(false);
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
