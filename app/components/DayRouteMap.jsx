"use client";

import { buildDayRouteSvg, buildGoogleRouteUrl, formatIdleGapLabel } from "../lib/dayRouteMap";

export default function DayRouteMap({
  points = [],
  idleGaps = [],
  title = "Day route",
  openLabel = "Open route in Google Maps",
  idleLegend = "Idle GPS ping",
  unloggedLegend = "Unlogged idle",
  stopLegend = "Logged stop",
}) {
  const svg = buildDayRouteSvg(points);
  const openUrl = buildGoogleRouteUrl(points);
  if (!svg) return null;

  return (
    <div className="dayRouteMap">
      <div className="moduleSectionHeader">
        <h3 style={{ margin: 0 }}>{title}</h3>
        {openUrl ? (
          <a className="moduleInlineButton" href={openUrl} target="_blank" rel="noreferrer">
            {openLabel}
          </a>
        ) : null}
      </div>
      <div className="dayRouteMapCanvas" dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="dayRouteMapLegend">
        <span><i style={{ background: "#2563eb" }} />{stopLegend}</span>
        <span><i style={{ background: "#f59e0b" }} />{idleLegend}</span>
        <span><i style={{ background: "#dc2626" }} />{unloggedLegend}</span>
      </div>
      {idleGaps.length ? (
        <ul className="dayRouteMapIdleList">
          {idleGaps.map((gap) => (
            <li key={`${gap.fromAt}-${gap.toAt}`}>{formatIdleGapLabel(gap)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
