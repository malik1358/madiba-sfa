"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { getSupabaseClient } from "../lib/supabase";

const DEFAULT_ITEMS = [
  { href: "/management/my-day", label: "My Day" },
  { href: "/management/payment-collections", label: "Collections" },
  { href: "/management/customer-audit", label: "Customer Details" },
  { href: "/management/new-order", label: "New Order" },
  { href: "/management/pending-orders", label: "Pending Orders" },
  { href: "/management/gps-map", label: "GPS Report" },
];

export default function MostVisitedPages({ items = DEFAULT_ITEMS }) {
  const pathname = usePathname();
  const [userRole, setUserRole] = useState("");
  const [salesmanCode, setSalesmanCode] = useState("");
  const [collectionOnly, setCollectionOnly] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadRole() {
      const supabase = getSupabaseClient();
      if (!supabase) return;

      const {
        data: { session },
      } = await supabase.auth.getSession();

      const userId = session?.user?.id;
      if (mounted) {
        setCollectionOnly(Boolean(session?.user?.user_metadata?.collection_only));
      }
      if (!userId || !mounted) return;

      const { data } = await supabase
        .from("profiles")
        .select("role,salesman_code")
        .eq("id", userId)
        .maybeSingle();

      if (mounted) {
        setUserRole(String(data?.role || "").toLowerCase());
        setSalesmanCode(String(data?.salesman_code || "").trim());
      }
    }

    loadRole();
    return () => {
      mounted = false;
    };
  }, []);

  const visibleItems = useMemo(() => {
    if (collectionOnly || userRole === "collector" || /^CL\d+$/i.test(salesmanCode)) {
      return DEFAULT_ITEMS.filter((item) => item.href === "/management/payment-collections");
    }
    return items;
  }, [items, userRole, salesmanCode, collectionOnly]);

  return (
    <nav className="mostVisitedNav" aria-label="Most visited pages">
      <span className="mostVisitedLabel">Most Visited</span>
      <div className="mostVisitedLinks">
        {visibleItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`mostVisitedLink${isActive ? " mostVisitedLinkActive" : ""}`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
