"use client";

export default function DaySummaryBox({ summary, language, title }) {
  if (!summary?.lines?.length) return null;
  const lines = language === "ar" ? (summary.linesAr || summary.lines) : summary.lines;

  return (
    <section className="moduleDaySummary" aria-label={title}>
      <h3>{title}</h3>
      <ul className="moduleDaySummaryList">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}
