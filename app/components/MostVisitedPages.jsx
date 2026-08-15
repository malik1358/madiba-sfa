"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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

  return (
    <nav className="mostVisitedNav" aria-label="Most visited pages">
      <span className="mostVisitedLabel">Most Visited</span>
      <div className="mostVisitedLinks">
        {items.map((item) => {
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
