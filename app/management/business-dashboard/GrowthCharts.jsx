"use client";

import { useState } from "react";
import { compactChartNumber, TOTAL_SERIES_KEY } from "../../lib/growthCharts";

function niceMax(value) {
  const number = Number(value || 0);
  if (!(number > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(number));
  return Math.ceil(number / magnitude) * magnitude;
}

export function GrowthTrendChart({
  periods = [],
  series = [],
  periodLabel = (period) => period,
  formatValue = compactChartNumber,
}) {
  const [hidden, setHidden] = useState(() => new Set());
  const [hover, setHover] = useState(null);
  const visible = series.filter((item) => !hidden.has(item.key));
  const width = 820;
  const height = 280;
  const pad = { top: 18, right: 18, bottom: 40, left: 54 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(1, ...visible.flatMap((item) => item.values)));
  const x = (index) => pad.left + (periods.length <= 1 ? innerW / 2 : (index / (periods.length - 1)) * innerW);
  const y = (value) => pad.top + innerH - (Number(value || 0) / max) * innerH;

  function toggle(key) {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function nearestIndex(clientX, rect) {
    if (!periods.length || !rect.width) return 0;
    const ratio = (clientX - rect.left) / rect.width;
    return Math.min(periods.length - 1, Math.max(0, Math.round(ratio * (periods.length - 1))));
  }

  const hoverValues = hover == null ? [] : visible.map((item) => ({
    ...item,
    value: Number(item.values[hover] || 0),
  }));

  return (
    <div className="moduleBiChart">
      <svg viewBox={`0 0 ${width} ${height}`} className="moduleBiChartSvg" role="img">
        {[0, 0.5, 1].map((tick) => {
          const value = max * tick;
          const top = y(value);
          return (
            <g key={tick}>
              <line x1={pad.left} x2={width - pad.right} y1={top} y2={top} className="moduleBiChartGridLine" />
              <text x={pad.left - 8} y={top + 4} textAnchor="end" className="moduleBiChartAxis">{formatValue(value)}</text>
            </g>
          );
        })}
        {periods.map((period, index) => (
          <text key={period} x={x(index)} y={height - 12} textAnchor="middle" className="moduleBiChartAxis">
            {periodLabel(period)}
          </text>
        ))}
        {visible.map((item) => {
          const points = item.values.map((value, index) => `${x(index)},${y(value)}`).join(" ");
          return (
            <polyline
              key={item.key}
              fill="none"
              stroke={item.color}
              strokeWidth={item.dashed ? 2.5 : 3}
              strokeDasharray={item.dashed ? "7 5" : "none"}
              points={points}
            />
          );
        })}
        {hover != null ? (
          <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={height - pad.bottom} className="moduleBiChartHoverLine" />
        ) : null}
        {hover != null
          ? visible.map((item) => (
            <circle key={`${item.key}-dot`} cx={x(hover)} cy={y(item.values[hover] || 0)} r="4.5" fill={item.color} />
          ))
          : null}
        <rect
          x={pad.left}
          y={pad.top}
          width={innerW}
          height={innerH}
          fill="transparent"
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setHover(nearestIndex(event.clientX, rect));
          }}
          onMouseLeave={() => setHover(null)}
        />
      </svg>
      {hover != null && hoverValues.length ? (
        <div className="moduleBiChartTooltip">
          <strong>{periodLabel(periods[hover])}</strong>
          {hoverValues.map((item) => (
            <div key={item.key}>
              <span style={{ background: item.color }} />
              {item.label}: {formatValue(item.value)}
            </div>
          ))}
        </div>
      ) : null}
      <div className="moduleBiChartLegend">
        {series.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`moduleBiChartLegendBtn${hidden.has(item.key) ? " isOff" : ""}`}
            onClick={() => toggle(item.key)}
          >
            <i style={{ background: item.color, borderStyle: item.key === TOTAL_SERIES_KEY ? "dashed" : "solid" }} />
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function GrowthCompareChart({
  items = [],
  latestLabel = "Latest",
  priorLabel = "Prior",
  formatValue = compactChartNumber,
}) {
  const max = niceMax(Math.max(1, ...items.flatMap((item) => [item.latest, item.prior])));
  return (
    <div className="moduleBiChart moduleBiChart--bars">
      {items.map((item) => (
        <div key={item.key} className="moduleBiCompareRow">
          <span className="moduleBiCompareLabel" title={item.label}>{item.label}</span>
          <div className="moduleBiCompareTracks">
            <div className="moduleBiCompareBar moduleBiCompareBar--prior" style={{ width: `${(Number(item.prior || 0) / max) * 100}%` }}>
              <em>{formatValue(item.prior)}</em>
            </div>
            <div className="moduleBiCompareBar moduleBiCompareBar--latest" style={{ width: `${(Number(item.latest || 0) / max) * 100}%` }}>
              <em>{formatValue(item.latest)}</em>
            </div>
          </div>
        </div>
      ))}
      <div className="moduleBiChartLegend">
        <span className="moduleBiChartLegendBtn"><i className="moduleBiCompareSwatch--prior" />{priorLabel}</span>
        <span className="moduleBiChartLegendBtn"><i className="moduleBiCompareSwatch--latest" />{latestLabel}</span>
      </div>
    </div>
  );
}

export function GrowthBarChart({ items = [], formatValue = compactChartNumber }) {
  const max = niceMax(Math.max(1, ...items.map((item) => Number(item.value || 0))));
  return (
    <div className="moduleBiChart moduleBiChart--bars">
      {items.map((item) => (
        <div key={item.key || item.label} className="moduleBiCompareRow">
          <span className="moduleBiCompareLabel" title={item.label}>{item.label}</span>
          <div className="moduleBiCompareTracks">
            <div
              className={`moduleBiCompareBar moduleBiCompareBar--latest${item.status ? ` is-${item.status}` : ""}`}
              style={{ width: `${(Number(item.value || 0) / max) * 100}%` }}
            >
              <em>{item.display || formatValue(item.value)}</em>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function GrowthSignalChart({
  counts = {},
  labels = {
    green: "Growing",
    orange: "Watch",
    red: "Red lights",
    neutral: "Limited",
  },
}) {
  const entries = [
    { key: "green", color: "#166534", value: Number(counts.green || 0) },
    { key: "orange", color: "#c2410c", value: Number(counts.orange || 0) },
    { key: "red", color: "#b91c1c", value: Number(counts.red || 0) },
    { key: "neutral", color: "#64748b", value: Number(counts.neutral || 0) },
  ].filter((item) => item.value > 0);
  const total = entries.reduce((sum, item) => sum + item.value, 0) || 1;
  if (!entries.length) return null;
  return (
    <div className="moduleBiChart moduleBiChart--signal">
      <div className="moduleBiSignalTrack">
        {entries.map((item) => (
          <div
            key={item.key}
            className="moduleBiSignalSlice"
            style={{ width: `${(item.value / total) * 100}%`, background: item.color }}
            title={`${labels[item.key] || item.key}: ${item.value}`}
          />
        ))}
      </div>
      <div className="moduleBiChartLegend">
        {entries.map((item) => (
          <span key={item.key} className="moduleBiChartLegendBtn">
            <i style={{ background: item.color }} />
            {labels[item.key] || item.key} · {item.value}
          </span>
        ))}
      </div>
    </div>
  );
}

export function GrowthChartPanel({ title, hint, children }) {
  return (
    <div className="moduleBiChartPanel">
      {title ? <h3>{title}</h3> : null}
      {hint ? <p className="moduleHint">{hint}</p> : null}
      {children}
    </div>
  );
}
