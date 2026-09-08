"use client";

import { formatIdleDuration } from "../lib/collectionDaySummary";
import {
  buildDayRouteSvg,
  buildGoogleRouteUrl,
  buildIdleBubbles,
  buildWorkdayRouteStops,
  idleBubbleRadius,
  longestIdlePlace,
  resolveDayRouteWorkingHours,
} from "../lib/dayRouteMap";

export default function DayRouteMap({
  points = [],
  idleGaps = [],
  title = "Day route",
  openLabel = "Driving route (no names)",
  idleLegend = "Idle GPS ping",
  unloggedLegend = "Unlogged idle",
  stopLegend = "Logged stop",
  mapsHint = "Google Maps driving route has no customer names. Open a stop below to drop a labeled pin on that street. Look at the neighborhood around the pin — that is the GPS place, not a customer label on the map.",
  longestIdleTitle = "Longest idle",
  openPlaceLabel = "Open this place",
  openLongestIdleLabel = "Open longest idle in Google Maps",
  stopsTitle = "Login, lunch, logout, and idle",
  idleBubblesTitle = "Unlogged idle circles",
  idleBubblesHint = "Bigger red circle = longer time with no visit, order, collection, or lunch logged. Open a circle to see that GPS place.",
  entries = [],
  workingHoursTitle = "Working hours",
}) {
  const svg = buildDayRouteSvg(points, { idleGaps });
  const drivingUrl = buildGoogleRouteUrl(points);
  const longestIdle = longestIdlePlace(points, idleGaps);
  const stops = buildWorkdayRouteStops(points, idleGaps);
  const idleBubbles = buildIdleBubbles(points, idleGaps);
  const workingHours = resolveDayRouteWorkingHours(entries.length ? entries : points);
  if (!svg) return null;

  return (
    <div className="dayRouteMap">
      <div className="moduleSectionHeader">
        <h3 style={{ margin: 0 }}>{title}</h3>
        <div className="dayRouteMapActions">
          {longestIdle?.mapsUrl ? (
            <a className="moduleInlineButton" href={longestIdle.mapsUrl} target="_blank" rel="noreferrer">
              {openLongestIdleLabel}
            </a>
          ) : null}
          {drivingUrl ? (
            <a className="moduleInlineButton" href={drivingUrl} target="_blank" rel="noreferrer">
              {openLabel}
            </a>
          ) : null}
        </div>
      </div>
      <p className="dayRouteMapHint">{mapsHint}</p>
      <div className="dayRouteMapCanvas" dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="dayRouteMapLegend">
        <span><i style={{ background: "#2563eb" }} />{stopLegend}</span>
        <span><i style={{ background: "#f59e0b" }} />{idleLegend}</span>
        <span><i style={{ background: "#dc2626" }} />{unloggedLegend}</span>
        <span><i className="dayRouteMapLegendBubble" />{idleBubblesHint}</span>
      </div>
      {idleBubbles.length ? (
        <div className="dayRouteIdleBubbles" aria-label={idleBubblesTitle}>
          <h4>{idleBubblesTitle}</h4>
          <div className="dayRouteIdleBubbleRow">
            {idleBubbles.map((bubble) => {
              const size = Math.max(56, idleBubbleRadius(bubble.minutes) * 2);
              const content = (
                <>
                  <strong>{formatIdleDuration(bubble.minutes)}</strong>
                  <span>{bubble.area || bubble.customerName || "No activity logged"}</span>
                </>
              );
              return bubble.mapsUrl ? (
                <a
                  key={`${bubble.fromAt}-${bubble.toAt}`}
                  className="dayRouteIdleBubble"
                  href={bubble.mapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={bubble.label}
                  style={{ width: size, height: size }}
                >
                  {content}
                </a>
              ) : (
                <div
                  key={`${bubble.fromAt}-${bubble.toAt}`}
                  className="dayRouteIdleBubble"
                  title={bubble.label}
                  style={{ width: size, height: size }}
                >
                  {content}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {longestIdle ? (
        <p className="dayRouteMapLongestIdle">
          <strong>{longestIdleTitle}:</strong> {longestIdle.label}
          {longestIdle.mapsUrl ? (
            <>
              {" "}
              <a href={longestIdle.mapsUrl} target="_blank" rel="noreferrer">{openPlaceLabel}</a>
            </>
          ) : null}
        </p>
      ) : null}
      {stops.length ? (
        <div className="dayRouteMapStops">
          <h4>{stopsTitle}</h4>
          <ul>
            {stops.map((stop) => (
              <li key={`${stop.kind}-${stop.ts}-${stop.label}`}>
                {stop.label}
                {stop.mapsUrl ? (
                  <>
                    {" "}
                    <a href={stop.mapsUrl} target="_blank" rel="noreferrer">{openPlaceLabel}</a>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
          {workingHours.value !== "-" ? (
            <p className="dayRouteMapWorkingHours">
              <strong>{workingHoursTitle}:</strong> {workingHours.value}
            </p>
          ) : null}
        </div>
      ) : workingHours.value !== "-" ? (
        <p className="dayRouteMapWorkingHours">
          <strong>{workingHoursTitle}:</strong> {workingHours.value}
        </p>
      ) : null}
    </div>
  );
}
