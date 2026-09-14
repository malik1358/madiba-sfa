"use client";

import Link from "next/link";
import { customerAuditHrefFromGrowthRow } from "../../lib/customerGrowthHold";

export default function BiCustomerNameLink({ row, enabled = true }) {
  const label = row?.label || row?.category || row?.title || "—";
  const href = enabled ? customerAuditHrefFromGrowthRow({ ...row, label }) : "";
  if (!href) return label;
  return (
    <Link href={href} className="moduleBiNameLink">
      {label}
    </Link>
  );
}
