"use client";

import Link from "next/link";
import { useMemo } from "react";
import { usePathname } from "next/navigation";
import {
  MODULES,
  localizedModuleLabel,
  pathMatchesModuleHref,
  pinnedModuleKeysForAccess,
} from "../lib/moduleAccess";
import { useAppLanguage } from "../lib/appLanguage";
import { useModuleAccess } from "../hooks/useModuleAccess";

export default function MostVisitedPages() {
  const pathname = usePathname();
  const { language } = useAppLanguage();
  const { access, loading } = useModuleAccess();

  const items = useMemo(
    () => {
      if (loading) return [];
      return pinnedModuleKeysForAccess(access)
        .map((moduleKey) => {
          const href = MODULES[moduleKey]?.href;
          if (!href) return null;
          return {
            href,
            label: localizedModuleLabel(moduleKey, language),
            active: pathMatchesModuleHref(pathname, href),
          };
        })
        .filter(Boolean);
    },
    [access, language, loading, pathname],
  );

  if (!items.length) return null;

  return (
    <nav className="mostVisitedLinks" aria-label="Quick links">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`mostVisitedLink${item.active ? " mostVisitedLinkActive" : ""}`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
