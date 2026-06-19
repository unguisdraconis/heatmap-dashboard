/**
 * HeatmapChart.jsx
 * Global Weekly Average Temperatures — 2025
 *
 * Data source : Open-Meteo Archive API (historical)
 * Architecture: Chart Design System — ResponsiveChartWrapper pattern
 * Rendering   : D3 for scales / math, React for SVG <rect> elements
 * Reference   : react-graph-gallery.com/heatmap
 *
 * Shared infrastructure required (Chart Design System):
 *   ./ResponsiveChartWrapper   — layout shell (render-prop, measures container)
 *   ./ChartTooltip             — HTML tooltip (absolute-positioned over SVG)
 *   ../utils/cssVar            — reads CSS custom properties at render time
 *
 * NOTE: The default chart-widget height in App.css is 480px.
 * For 20 rows this component works best at 560–600px.
 * Override per-card with: .heatmap-card { height: 580px; }
 */

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import * as d3 from "d3";
import { rollups, mean } from "d3-array";
import { ResponsiveChartWrapper } from "./ResponsiveChartWrapper";
import { ChartTooltip } from "./ChartTooltip";
import { cssVar } from "../utils/cssVar";

// ─── Configuration ─────────────────────────────────────────────────────────────

// 20 cities ordered north → south so the heatmap reads geographically.
const CITIES = [
  { name: "Reykjavik", lat: 64.15, lon: -21.94 },
  { name: "Anchorage", lat: 61.22, lon: -149.9 },
  { name: "Oslo", lat: 59.91, lon: 10.75 },
  { name: "Moscow", lat: 55.75, lon: 37.62 },
  { name: "London", lat: 51.51, lon: -0.13 },
  { name: "Paris", lat: 48.85, lon: 2.35 },
  { name: "New York", lat: 40.71, lon: -74.01 },
  { name: "Tokyo", lat: 35.68, lon: 139.65 },
  { name: "Los Angeles", lat: 34.05, lon: -118.24 },
  { name: "Cairo", lat: 30.04, lon: 31.24 },
  { name: "Delhi", lat: 28.61, lon: 77.21 },
  { name: "Mexico City", lat: 19.43, lon: -99.13 },
  { name: "Mumbai", lat: 19.08, lon: 72.88 },
  { name: "Bangkok", lat: 13.76, lon: 100.5 },
  { name: "Singapore", lat: 1.35, lon: 103.82 },
  { name: "Nairobi", lat: -1.29, lon: 36.82 },
  { name: "Jakarta", lat: -6.21, lon: 106.85 },
  { name: "Lima", lat: -12.05, lon: -77.04 },
  { name: "Rio de Janeiro", lat: -22.91, lon: -43.17 },
  { name: "Cape Town", lat: -33.92, lon: 18.42 },
];

const CITY_NAMES = CITIES.map((c) => c.name);
const YEAR_START = new Date("2025-01-01");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const NUM_WEEKS = 52;

// Week index where each calendar month starts in 2025 (approximate).
// Jan 1 = week 0, Feb 1 ≈ week 4, Mar 1 ≈ week 8, …
const MONTH_TICK_WEEKS = [0, 4, 8, 13, 17, 22, 26, 30, 35, 39, 43, 48];
const MONTH_TICK_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Pixels reserved at the bottom of the wrapper for the color-scale legend.
const LEGEND_H = 52;

// ─── Color Palettes ─────────────────────────────────────────────────────────────
// Sequential palettes are ordered low→high = cool→warm by default.
// RdYlBu is diverging and inverted so blue = cold, red = hot.

const PALETTES = {
  viridis: { label: "Viridis", fn: d3.interpolateViridis },
  magma: { label: "Magma", fn: d3.interpolateMagma },
  plasma: { label: "Plasma", fn: d3.interpolatePlasma },
  inferno: { label: "Inferno", fn: d3.interpolateInferno },
  cividis: { label: "Cividis (Accessible)", fn: d3.interpolateCividis },
  turbo: { label: "Turbo", fn: d3.interpolateTurbo },
  rdylbu: {
    label: "RdYlBu (Diverging)",
    fn: (t) => d3.interpolateRdYlBu(1 - t),
  },
};

// ─── Data Fetching ──────────────────────────────────────────────────────────────

/**
 * Fetches 2025 daily mean temperatures for all 20 cities in a single request
 * then aggregates into 20 × 52 week-average cells.
 *
 * Returns: Array<{ city: string, week: number (0–51), value: number (°C) }>
 */
async function loadHeatmapData() {
  const url =
    "https://archive-api.open-meteo.com/v1/archive" +
    "?latitude=" +
    CITIES.map((c) => c.lat).join(",") +
    "&longitude=" +
    CITIES.map((c) => c.lon).join(",") +
    "&start_date=2025-01-01&end_date=2025-12-31" +
    "&daily=temperature_2m_mean&timezone=auto";

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo API returned HTTP ${res.status}`);
  const json = await res.json();

  // The API returns an array when multiple lat/lon pairs are provided.
  const cityResults = Array.isArray(json) ? json : [json];

  // 1. Flatten to long daily rows, tag each with its 7-day bucket (0–51).
  //    Math.min folds Dec 31 into week 51 → exactly 52 columns.
  const daily = cityResults.flatMap((city, i) =>
    city.daily.time.map((t, j) => ({
      city: CITIES[i].name,
      week: Math.min(
        NUM_WEEKS - 1,
        Math.floor((new Date(t) - YEAR_START) / WEEK_MS),
      ),
      temp: city.daily.temperature_2m_mean[j],
    })),
  );

  // 2. Average daily temps → one mean per city × week cell.
  return rollups(
    daily,
    (v) => mean(v, (d) => d.temp),
    (d) => d.city,
    (d) => d.week,
  ).flatMap(([city, weeks]) =>
    weeks.map(([week, value]) => ({ city, week, value })),
  );
  // → [{ city: 'Reykjavik', week: 0, value: -0.4 }, …]  (up to 20 × 52 rows)
}

// ─── Color Scale Legend (canvas gradient + D3 tick marks) ──────────────────────

function ColorScaleLegend({ colorScale, min, max, containerWidth }) {
  const canvasRef = useRef(null);

  // Gradient bar width: proportional to container but capped sensibly.
  const gradW = Math.max(120, Math.min(containerWidth - 140, 380));
  const gradH = 12;

  // Draw gradient once whenever scale or domain changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, gradW, gradH);
    for (let i = 0; i < gradW; i++) {
      ctx.fillStyle = colorScale(min + ((max - min) * i) / gradW);
      ctx.fillRect(i, 0, 1, gradH);
    }
  }, [colorScale, min, max, gradW, gradH]);

  // Tick positions derived from a linear helper scale.
  const tickScale = useMemo(
    () => d3.scaleLinear().domain([min, max]).range([0, gradW]),
    [min, max, gradW],
  );
  const ticks = tickScale.ticks(5);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        paddingLeft: 6,
        paddingTop: 4,
      }}
    >
      {/* Cold end label */}
      <span style={legendLabelStyle}>{min.toFixed(1)}°C</span>

      {/* Gradient bar + tick marks */}
      <div>
        <canvas
          ref={canvasRef}
          width={gradW}
          height={gradH}
          style={{
            display: "block",
            borderRadius: 2,
            border: `1px solid ${cssVar("--border")}`,
          }}
          aria-hidden="true"
        />
        <svg
          width={gradW}
          height={18}
          style={{ display: "block", overflow: "visible" }}
        >
          {ticks.map((t) => (
            <g key={t} transform={`translate(${tickScale(t)},0)`}>
              <line
                y1={0}
                y2={4}
                stroke={cssVar("--chart-axis")}
                strokeWidth={1}
              />
              <text
                y={14}
                textAnchor="middle"
                fill={cssVar("--chart-text")}
                fontSize={9}
                fontFamily="var(--mono)"
              >
                {t.toFixed(0)}°
              </text>
            </g>
          ))}
        </svg>
      </div>

      {/* Hot end label */}
      <span style={legendLabelStyle}>{max.toFixed(1)}°C</span>
    </div>
  );
}

const legendLabelStyle = {
  fontSize: 10,
  color: "var(--chart-text)",
  fontFamily: "var(--mono)",
  minWidth: 40,
  textAlign: "right",
};

// ─── Heatmap SVG (inner) ───────────────────────────────────────────────────────
// D3 owns scale computation; React owns SVG rendering.
// Pattern from react-graph-gallery.com/heatmap

function HeatmapSVG({ width, height, data, colorScale, onTooltip }) {
  // Left margin sized to the longest city label ("Rio de Janeiro" ≈ 105 px at 11 px).
  const margin = { top: 8, right: 16, bottom: 32, left: 112 };

  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;

  // ── Scales ──────────────────────────────────────────────────────────────────
  // X: 52 string keys ("0"…"51") → band scale keeps padding generic.
  const weekKeys = useMemo(() => d3.range(NUM_WEEKS).map(String), []);

  const xScale = useMemo(
    () => d3.scaleBand().domain(weekKeys).range([0, w]).padding(0.05),
    [w, weekKeys],
  );
  const yScale = useMemo(
    () => d3.scaleBand().domain(CITY_NAMES).range([0, h]).padding(0.06),
    [h],
  );

  // O(1) cell lookup: "city|week" → value
  const dataMap = useMemo(() => {
    const m = new Map();
    data.forEach((d) => m.set(`${d.city}|${d.week}`, d.value));
    return m;
  }, [data]);

  if (w <= 0 || h <= 0) return null;

  // Read theme tokens at render time (CSS custom properties).
  const textColor = cssVar("--chart-text");
  const axisColor = cssVar("--chart-axis");

  return (
    <svg
      width={width}
      height={height}
      style={{ position: "absolute", top: 0, left: 0, overflow: "visible" }}
      aria-label="Heatmap: weekly average temperatures for 20 cities across 2025"
    >
      <g transform={`translate(${margin.left},${margin.top})`}>
        {/* ── Heat cells ────────────────────────────────────────────────── */}
        {CITY_NAMES.flatMap((city) =>
          d3.range(NUM_WEEKS).map((week) => {
            const value = dataMap.get(`${city}|${week}`);
            if (value == null) return null;
            return (
              <rect
                key={`${city}|${week}`}
                x={xScale(String(week))}
                y={yScale(city)}
                width={Math.max(1, xScale.bandwidth())}
                height={Math.max(1, yScale.bandwidth())}
                fill={colorScale(value)}
                rx={1}
                style={{ cursor: "default" }}
                onMouseEnter={() =>
                  onTooltip({
                    // Coords relative to the wrapper's top-left corner.
                    x:
                      xScale(String(week)) +
                      xScale.bandwidth() / 2 +
                      margin.left,
                    y: yScale(city) + margin.top,
                    city,
                    week,
                    value,
                  })
                }
                onMouseLeave={() => onTooltip(null)}
              />
            );
          }),
        )}

        {/* ── Y-axis: city labels ──────────────────────────────────────── */}
        {CITY_NAMES.map((city) => (
          <text
            key={city}
            x={-8}
            y={yScale(city) + yScale.bandwidth() / 2}
            textAnchor="end"
            dominantBaseline="middle"
            fill={textColor}
            fontSize={11}
          >
            {city}
          </text>
        ))}

        {/* ── X-axis: month labels ─────────────────────────────────────── */}
        {MONTH_TICK_WEEKS.map((wk, i) => (
          <text
            key={i}
            x={(xScale(String(wk)) ?? 0) + xScale.bandwidth() / 2}
            y={h + 18}
            textAnchor="middle"
            fill={textColor}
            fontSize={10}
          >
            {MONTH_TICK_LABELS[i]}
          </text>
        ))}

        {/* ── Axis baselines ───────────────────────────────────────────── */}
        <line
          x1={0}
          x2={w}
          y1={h + 4}
          y2={h + 4}
          stroke={axisColor}
          strokeWidth={1}
        />
        <line x1={0} x2={0} y1={0} y2={h} stroke={axisColor} strokeWidth={1} />
      </g>
    </svg>
  );
}

// ─── Exported Component ────────────────────────────────────────────────────────

export function HeatmapChart() {
  const [data, setData] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | loading | error | ready
  const [fetchErr, setFetchErr] = useState("");
  const [paletteKey, setPaletteKey] = useState("viridis");
  const [tooltip, setTooltip] = useState(null);

  const handleTooltip = useCallback((val) => setTooltip(val), []);

  // Fetch once on mount.
  useEffect(() => {
    setStatus("loading");
    loadHeatmapData()
      .then((d) => {
        setData(d);
        setStatus("ready");
      })
      .catch((e) => {
        setFetchErr(e.message);
        setStatus("error");
      });
  }, []);

  // Temperature domain across all loaded cells.
  const { minTemp, maxTemp } = useMemo(() => {
    if (!data.length) return { minTemp: -10, maxTemp: 40 };
    const vals = data.map((d) => d.value).filter((v) => v != null);
    return { minTemp: d3.min(vals), maxTemp: d3.max(vals) };
  }, [data]);

  // Sequential color scale, rebuilt when palette or domain changes.
  const colorScale = useMemo(
    () =>
      d3.scaleSequential(PALETTES[paletteKey].fn).domain([minTemp, maxTemp]),
    [paletteKey, minTemp, maxTemp],
  );

  // Palette dropdown — passed to ResponsiveChartWrapper's controls slot.
  const paletteControl = (
    <select
      value={paletteKey}
      onChange={(e) => setPaletteKey(e.target.value)}
      aria-label="Color palette"
      style={{
        fontSize: "0.72rem",
        padding: "3px 8px",
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: "var(--bg-card)",
        color: "var(--text)",
        cursor: "pointer",
      }}
    >
      {Object.entries(PALETTES).map(([key, { label }]) => (
        <option key={key} value={key}>
          {label}
        </option>
      ))}
    </select>
  );

  return (
    <ResponsiveChartWrapper
      title="Global Weekly Average Temperatures — 2025"
      controls={paletteControl}
    >
      {({ width, height }) => (
        <>
          {/* ── Loading ─────────────────────────────────────────── */}
          {status === "loading" && (
            <div style={OVERLAY_STYLE}>
              <span style={{ color: "var(--chart-text)", fontSize: "0.85rem" }}>
                Fetching 2025 temperature data…
              </span>
            </div>
          )}

          {/* ── Error ───────────────────────────────────────────── */}
          {status === "error" && (
            <div style={OVERLAY_STYLE}>
              <span style={{ color: "#D55E00", fontSize: "0.85rem" }}>
                ⚠ {fetchErr}
              </span>
            </div>
          )}

          {/* ── Chart + legend ──────────────────────────────────── */}
          {status === "ready" && (
            <>
              {/*
               * The SVG takes height minus the legend strip so both fit
               * inside the absolutely-positioned wrapper without overflow.
               */}
              <HeatmapSVG
                width={width}
                height={height - LEGEND_H}
                data={data}
                colorScale={colorScale}
                onTooltip={handleTooltip}
              />

              {/* Color-scale legend anchored to the wrapper's bottom edge */}
              <div style={{ position: "absolute", bottom: 4, left: 0, width }}>
                <ColorScaleLegend
                  colorScale={colorScale}
                  min={minTemp}
                  max={maxTemp}
                  containerWidth={width}
                />
              </div>
            </>
          )}

          {/* ── Tooltip (HTML, absolute-positioned per Design System) ── */}
          {tooltip && (
            <ChartTooltip
              x={tooltip.x}
              y={tooltip.y}
              containerWidth={width}
              containerHeight={height}
            >
              <div className="tooltip-title">
                {tooltip.city} — Week {tooltip.week + 1}
              </div>
              <div className="tooltip-row">
                <span
                  className="tooltip-swatch"
                  style={{ background: colorScale(tooltip.value) }}
                />
                <span className="tooltip-label">Avg Temp</span>
                <span
                  className="tooltip-value"
                  style={{ color: colorScale(tooltip.value) }}
                >
                  {tooltip.value.toFixed(1)}°C
                </span>
              </div>
            </ChartTooltip>
          )}
        </>
      )}
    </ResponsiveChartWrapper>
  );
}

// ─── Shared style constants ────────────────────────────────────────────────────

const OVERLAY_STYLE = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
