"use client";
import React from "react";
import { shortDate } from "./lib/format";

export default function CustomerHeader({ PAGE_VERSION, BUILD_COMMIT }) {
  return (
    <div className="auditTop">
      <div>
        <div className="auditBrand">MADIBA SFA</div>
        <h1>Customer Audit</h1>
        <p className="auditSubtitle">Management sales history validation</p>
        <div className="auditPageVersionTop">
          <strong>{PAGE_VERSION}</strong>
          <span>Commit: {BUILD_COMMIT}</span>
        </div>
      </div>

      <a href="/management" className="auditHomeButton">
        ← Home
      </a>
    </div>
  );
}
