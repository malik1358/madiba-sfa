"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

const STORAGE_KEY = "madiba.mostVisitedPages.v1";

const PAGE_LABELS = {
  "/": "Dashboard",
  "/management": "Management",
  "/management/new-order": "New Order",
  "/management/pending-orders": "Pending Orders",
  "/management/my-day": "My Day",
  "/management/my-performance": "My Performance",
  "/management/new-customer": "New Customer",
  "/management/upload": "Upload",
  "/management/gps-map": "GPS Map",
  "/management/salesman-hierarchy": "Salesman Hierarchy",
  "/management/payment-collections": "Collections",
  "/management/collection-report": "Collection Report",
  "/management/my-collections": "My Collections",
};

function readStoredPages() {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
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
  const [visitedPages, setVisitedPages] = useState(() => {
    const stored = readStoredPages();
    return stored.length ? stored : [
      { href: "/management", label: "Management" },
      { href: "/management/new-order", label: "New Order" },
      { href: "/management/my-day", label: "My Day" },
    ];
  });

  useEffect(() => {
    const stored = readStoredPages();
    if (stored.length) {
      setVisitedPages(stored);
    }
  }, []);

  useEffect(() => {
    if (!pathname || typeof window === "undefined") return;

    const label = PAGE_LABELS[pathname] || null;
    if (!label) return;

    const nextEntry = { href: pathname, label };
    const stored = readStoredPages();
    const merged = [nextEntry, ...stored.filter((item) => item.href !== pathname)];
    const unique = merged.slice(0, 4);

    setVisitedPages(unique);
    writeStoredPages(unique);
  }, [pathname]);

  const items = useMemo(() => {
    if (visitedPages.length) return visitedPages;
    return [
      { href: "/management", label: "Management" },
      { href: "/management/new-order", label: "New Order" },
      { href: "/management/my-day", label: "My Day" },
    ];
  }, [visitedPages]);

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
          key={`${item.href}-${item.label}`}
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
