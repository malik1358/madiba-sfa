"use client";

function summaryLineClass(kind) {
  const normalized = String(kind || "").trim().toLowerCase();
  if (!normalized) return "";
  return `moduleDaySummaryKind moduleDaySummaryKind-${normalized.replace(/_/g, "-")}`;
}

export default function DaySummaryBox({ summary, language, title }) {
  const items = language === "ar"
    ? (summary?.itemsAr || summary?.items || [])
    : (summary?.items || []);
  const lines = language === "ar" ? (summary?.linesAr || summary?.lines || []) : (summary?.lines || []);
  const entries = items.length
    ? items
    : lines.map((text) => ({ kind: "", text }));

  if (!entries.length) return null;

  return (
    <section className="moduleDaySummary" aria-label={title}>
      <h3>{title}</h3>
      <ul className="moduleDaySummaryList">
        {entries.map((entry, index) => (
          <li key={`${entry.kind || "line"}-${index}`} className={summaryLineClass(entry.kind)}>
            {entry.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
