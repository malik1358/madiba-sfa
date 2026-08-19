"use client";

import Link from "next/link";
import { useModuleAccess } from "../hooks/useModuleAccess";

export default function AccessibleHeaderLink({
  moduleKey,
  href,
  className,
  children,
}) {
  const { access } = useModuleAccess();

  if (!access.canAccess(moduleKey)) {
    return null;
  }

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
