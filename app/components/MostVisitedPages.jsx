"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { moduleLabelForPath } from "../lib/moduleAccess";
import { useAppLanguage } from "../lib/appLanguage";
import { useModuleAccess } from "../hooks/useModuleAccess";

const STORAGE_KEY = "madiba.mostVisitedPages.v1";

function readStoredPages() {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => ({
        href: String(item?.href || "").trim(),
      }))
      .filter((item) => item.href);
  } catch {
    return [];
  }
}

function writeStoredPages(items) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage issues.
  }
}

export default function MostVisitedPages() {
  const pathname = usePathname();
  const { language } = useAppLanguage();
  const { access } = useModuleAccess();
  const [visitedPages, setVisitedPages] = useState([]);

  useEffect(() => {
    setVisitedPages(readStoredPages());
  }, []);

  useEffect(() => {
    if (!pathname || typeof window === "undefined") return;

    if (!moduleLabelForPath(pathname, language) || !access.canAccessPath(pathname)) return;

    const nextEntry = { href: pathname };
    const stored = readStoredPages();
    const merged = [nextEntry, ...stored.filter((item) => item.href !== pathname)];
    const unique = merged.slice(0, 4);

    setVisitedPages(unique);
    writeStoredPages(unique);
  }, [pathname, access, language]);

  const items = useMemo(
    () => (visitedPages.length ? visitedPages : [])
      .filter((item) => access.canAccessPath(item.href))
      .map((item) => ({
        href: item.href,
        label: moduleLabelForPath(item.href, language) || item.href,
      }))
      .slice(0, 4),
    [visitedPages, access, language],
  );

  if (!items.length) return null;

  return (
    <nav
      aria-label="Most visited pages"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
      }}
    >
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          style={{
            textDecoration: "none",
            color: "#0f172a",
            background: "rgba(255,255,255,0.7)",
            border: "1px solid rgba(15,23,42,0.15)",
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
