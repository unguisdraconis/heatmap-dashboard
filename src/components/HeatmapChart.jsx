/**
 * HeatmapChart.jsx
 * Global Weekly Average Temperatures — 2025
 *
 * New in this version
 * ───────────────────
 * 1. Legend hover highlight
 *    Mousing over the colour-scale dims every cell whose weekly mean falls
 *    outside a ±10 % temperature band around the cursor.  Opacity updates are
 *    applied imperatively through D3 (`.selectAll('.hm-cell')`) so React never
 *    re-diffs the 1 040 <rect> elements during pointer movement.
 *
 * 2. Sequential entrance animation
 *    On data load the chart wrapper eases in (opacity + translateY), then each
 *    cell reveals individually with a staggered CSS animation delay — the
 *    coolest cell first, the hottest cell last — producing a diagonal cool→warm
 *    fill wave.  The prefers-reduced-motion media query disables both effects.
 *
 * Architecture (Chart Design System)
 * ────────────────────────────────────
 *   ResponsiveChartWrapper (title + palette dropdown)
 *     └─ div key={animKey}  ← wrapper entrance animation target
 *          ├─ HeatmapSVG    ← D3 scales / React JSX cells / D3 hover effect
 *          ├─ ColorScaleLegend  ← canvas gradient + mouse tracking
 *          └─ ChartTooltip  ← HTML, absolute-positioned
 *
 * Shared infrastructure required:
 *   ./ResponsiveChartWrapper
 *   ./ChartTooltip
 *   ../utils/cssVar
 */

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import * as d3 from "d3";
import { rollups, mean } from "d3-array";
import { ResponsiveChartWrapper } from "./ResponsiveChartWrapper";
import { ChartTooltip } from "./ChartTooltip";
import { cssVar } from "../utils/cssVar";

// ─── City list (north → south) ────────────────────────────────────────────────

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

// Pixels below the SVG reserved for the colour-scale legend strip.
const LEGEND_H = 60;

// ─── Animation constants ──────────────────────────────────────────────────────

const EASE_IN_MS = 400; // wrapper slide-up + fade duration (ms)
const FILL_MS = 2500; // window across which cell delays are spread (ms)
const CELL_DURATION = 380; // single cell reveal duration (ms)
const ANIM_BUFFER = 650; // extra ms after last cell before animationDone fires

// ─── Hover highlight constants ────────────────────────────────────────────────

const HOVER_BAND_PCT = 0.1; // ± 10 % of domain range is "highlighted"
const DIM_OPACITY = 0.08; // opacity of non-highlighted cells
const HOVER_TRANS_MS = 150; // D3 transition duration for opacity changes (ms)

// ─── Colour palettes ──────────────────────────────────────────────────────────

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

// ─── CSS keyframes ────────────────────────────────────────────────────────────
// Injected via a <style> tag so this file stays self-contained.
// heatmapWrapperReveal  — the outer div entrance effect
// heatmapCellReveal     — per-cell staggered opacity reveal

const ANIMATION_CSS = `
@keyframes heatmapWrapperReveal {
  from { opacity: 0; transform: translateY(14px); }
  to   { opacity: 1; transform: translateY(0);    }
}
@keyframes heatmapCellReveal {
  from { opacity: 0; }
  to   { opacity: 1; }
}
`;

// ─── useReducedMotion ─────────────────────────────────────────────────────────

function useReducedMotion() {
  const MQ = "(prefers-reduced-motion: reduce)";
  const [val, setVal] = useState(
    () => typeof window !== "undefined" && window.matchMedia(MQ).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(MQ);
    const cb = (e) => setVal(e.matches);
    mq.addEventListener("change", cb);
    return () => mq.removeEventListener("change", cb);
  }, []);
  return val;
}

// ─── Data fetching ────────────────────────────────────────────────────────────

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
  const cityResults = Array.isArray(json) ? json : [json];

  // 1. Flatten → long daily rows tagged with week bucket 0–51.
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
  // → [{ city: 'Reykjavik', week: 0, value: -0.4 }, …]  (up to 20 × 52 cells)
}

// ─── Week date label ──────────────────────────────────────────────────────────

function weekLabel(weekIndex) {
  const start = new Date(YEAR_START.getTime() + weekIndex * WEEK_MS);
  const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
  const fmt = (d) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

// ─── ColorScaleLegend ─────────────────────────────────────────────────────────
//
// Renders a canvas gradient bar with D3 tick marks below it.
//
// New: mouse tracking on the canvas reports the hovered temperature (°C) via
// the onHover(temp | null) callback.  A white indicator line + floating label
// follows the cursor.

function ColorScaleLegend({ colorScale, min, max, containerWidth, onHover }) {
  const canvasRef = useRef(null);
  const [hover, setHover] = useState(null); // { x: px, temp: °C } | null

  const gradW = Math.max(100, Math.min(containerWidth - 150, 380));
  const gradH = 12;

  // Paint gradient whenever scale, domain, or dimensions change.
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

  // Convert a clientX position to { x (canvas-local px), temp (°C) }.
  const resolve = useCallback(
    (clientX) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const x = Math.max(0, Math.min(gradW, clientX - rect.left));
      return { x, temp: min + ((max - min) * x) / gradW };
    },
    [min, max, gradW],
  );

  const handleMouseMove = useCallback(
    (e) => {
      const h = resolve(e.clientX);
      if (!h) return;
      setHover(h);
      onHover(h.temp);
    },
    [resolve, onHover],
  );

  const handleMouseLeave = useCallback(() => {
    setHover(null);
    onHover(null);
  }, [onHover]);

  // Tick positions derived from a D3 linear helper scale.
  const tickScale = useMemo(
    () => d3.scaleLinear().domain([min, max]).range([0, gradW]),
    [min, max, gradW],
  );
  const ticks = tickScale.ticks(5);

  // Clamp floating label so it doesn't overflow the canvas edges.
  const labelX = hover ? Math.max(22, Math.min(gradW - 22, hover.x)) : 0;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        paddingTop: 6,
      }}
    >
      {/* Cold-end label */}
      <span style={LABEL_STYLE}>{min.toFixed(1)}°C</span>

      <div>
        {/* Gradient canvas + hover overlay */}
        <div style={{ position: "relative", display: "inline-block" }}>
          <canvas
            ref={canvasRef}
            width={gradW}
            height={gradH}
            style={{
              display: "block",
              borderRadius: 2,
              border: `1px solid ${cssVar("--border")}`,
              cursor: "crosshair",
            }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            aria-label="Colour scale — hover to highlight matching cells"
          />

          {/* Vertical indicator line */}
          {hover && (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: hover.x,
                width: 2,
                height: gradH,
                background: "rgba(255,255,255,0.92)",
                boxShadow: "0 0 5px rgba(0,0,0,0.5)",
                borderRadius: 1,
                pointerEvents: "none",
                transform: "translateX(-50%)",
              }}
            />
          )}

          {/* Floating temperature label below indicator */}
          {hover && (
            <div
              style={{
                position: "absolute",
                top: gradH + 2,
                left: labelX,
                transform: "translateX(-50%)",
                background: cssVar("--chart-tooltip-bg"),
                border: `1px solid ${cssVar("--chart-tooltip-border")}`,
                borderRadius: 4,
                padding: "2px 5px",
                fontSize: 9,
                fontFamily: "var(--mono)",
                color: cssVar("--chart-tooltip-text"),
                pointerEvents: "none",
                whiteSpace: "nowrap",
                zIndex: 20,
              }}
            >
              {hover.temp.toFixed(1)}°C
            </div>
          )}
        </div>

        {/* D3 tick marks */}
        <svg
          width={gradW}
          height={20}
          style={{ display: "block", overflow: "visible" }}
        >
          {ticks.map((t) => (
            <g key={t} transform={`translate(${tickScale(t)},0)`}>
              <line y2={4} stroke={cssVar("--chart-axis")} strokeWidth={1} />
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

      {/* Warm-end label */}
      <span style={LABEL_STYLE}>{max.toFixed(1)}°C</span>
    </div>
  );
}

const LABEL_STYLE = {
  fontSize: 10,
  color: "var(--chart-text)",
  fontFamily: "var(--mono)",
  minWidth: 38,
  textAlign: "right",
  paddingTop: 2,
};

// ─── HeatmapSVG ───────────────────────────────────────────────────────────────
//
// D3 owns scale computation; React owns SVG <rect> elements.
// Pattern from react-graph-gallery.com/heatmap.
//
// Opacity is managed in two non-overlapping phases:
//
//   Phase A — animation running (!animationDone)
//     Each rect receives a CSS `animation` inline style (opacity 0 → 1) with
//     a staggered delay proportional to its temperature rank (coolest first).
//     React does NOT set an explicit opacity; the CSS keyframe owns that attribute.
//
//   Phase B — animation complete (animationDone)
//     The CSS animation is removed.  D3 then manages the `opacity` SVG
//     attribute imperatively via useEffect — no React re-diffing of the
//     1 040 cells occurs on every mousemove event.

function HeatmapSVG({
  width,
  height,
  data,
  colorScale,
  onTooltip,
  hoveredLegendTemp, // °C | null — set by ColorScaleLegend via parent
  animationDone, // boolean  — true once all cell animations have finished
  animEnabled, // boolean  — false when prefers-reduced-motion
}) {
  const svgRef = useRef(null);

  // ── O(1) cell-value lookup ───────────────────────────────────────────────
  const cellMap = useMemo(() => {
    const m = new Map();
    data.forEach((d) => m.set(`${d.city}|${d.week}`, d.value));
    return m;
  }, [data]);

  // ── Rank cells by temperature for CSS animation stagger ──────────────────
  // rank 0 = coldest cell (reveals first), rank N-1 = hottest (reveals last).
  const { rankMap, totalCells } = useMemo(() => {
    const sorted = data
      .filter((d) => d.value != null)
      .sort((a, b) => a.value - b.value);
    return {
      rankMap: new Map(sorted.map((d, i) => [`${d.city}|${d.week}`, i])),
      totalCells: sorted.length,
    };
  }, [data]);

  // ── Layout ────────────────────────────────────────────────────────────────
  const margin = useMemo(
    () => ({ top: 18, right: 10, bottom: 28, left: 114 }),
    [],
  );
  const w = Math.max(0, width - margin.left - margin.right);
  const h = Math.max(0, height - margin.top - margin.bottom);

  const bandW = w / NUM_WEEKS;
  const yScale = useMemo(
    () => d3.scaleBand().domain(CITY_NAMES).range([0, h]).paddingInner(0.06),
    [h],
  );
  const bandH = yScale.bandwidth();

  // ── D3 hover-highlight effect (Phase B only) ─────────────────────────────
  // Runs imperatively so React never re-diffs the rect elements on mousemove.
  useEffect(() => {
    if (!svgRef.current || !animationDone) return;
    const [lo, hi] = colorScale.domain();
    const band = (hi - lo) * HOVER_BAND_PCT;

    d3.select(svgRef.current)
      .selectAll(".hm-cell")
      .transition("hoverOpacity")
      .duration(HOVER_TRANS_MS)
      .attr(
        "opacity",
        hoveredLegendTemp === null
          ? 1
          : function () {
              const v = parseFloat(this.dataset.value);
              return isNaN(v)
                ? 1
                : Math.abs(v - hoveredLegendTemp) <= band
                  ? 1
                  : DIM_OPACITY;
            },
      );
  }, [hoveredLegendTemp, animationDone, colorScale]);

  // ── Reset all cells to full opacity when animation completes ─────────────
  useEffect(() => {
    if (!svgRef.current || !animationDone) return;
    d3.select(svgRef.current).selectAll(".hm-cell").attr("opacity", 1);
  }, [animationDone]);

  if (!w || !h) return null;

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      style={{ overflow: "visible" }}
    >
      <g transform={`translate(${margin.left},${margin.top})`}>
        {/* ── City labels (Y axis) ─────────────────────────────────────── */}
        {CITY_NAMES.map((city) => (
          <text
            key={city}
            x={-7}
            y={(yScale(city) ?? 0) + bandH / 2}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize={10}
            fill={cssVar("--chart-text")}
            fontFamily="var(--sans)"
          >
            {city}
          </text>
        ))}

        {/* ── Month ticks (X axis) ─────────────────────────────────────── */}
        {MONTH_TICK_WEEKS.map((wk, i) => (
          <g key={i} transform={`translate(${wk * bandW},${h + 4})`}>
            <line y2={4} stroke={cssVar("--chart-axis")} strokeWidth={1} />
            <text
              y={13}
              fontSize={9}
              fill={cssVar("--chart-text")}
              fontFamily="var(--sans)"
              textAnchor="start"
            >
              {MONTH_TICK_LABELS[i]}
            </text>
          </g>
        ))}

        {/* ── Heatmap cells ─────────────────────────────────────────────── */}
        {CITY_NAMES.flatMap((city) =>
          Array.from({ length: NUM_WEEKS }, (_, week) => {
            const value = cellMap.get(`${city}|${week}`);
            if (value == null) return null;

            // Phase A: staggered CSS animation (opacity not set by React).
            // Phase B: no inline style — D3 useEffect owns opacity.
            let animStyle;
            if (animEnabled && !animationDone) {
              const rank = rankMap.get(`${city}|${week}`) ?? 0;
              const delay =
                EASE_IN_MS + (rank / Math.max(1, totalCells - 1)) * FILL_MS;
              animStyle = {
                opacity: 0,
                animation: `heatmapCellReveal ${CELL_DURATION}ms ease-out ${delay}ms forwards`,
              };
            }

            return (
              <rect
                key={`${city}-${week}`}
                className="hm-cell"
                data-value={value} // read by the D3 hover effect
                x={week * bandW}
                y={yScale(city) ?? 0}
                width={Math.max(0, bandW - 0.6)}
                height={Math.max(0, bandH)}
                fill={colorScale(value)}
                style={animStyle} // undefined in Phase B → no conflict with D3
                // Tooltip is suppressed during animation (cells may not be visible yet).
                onMouseEnter={
                  animationDone
                    ? () =>
                        onTooltip({
                          x: week * bandW + margin.left + bandW / 2,
                          y: (yScale(city) ?? 0) + margin.top,
                          city,
                          week,
                          value,
                          fill: colorScale(value),
                        })
                    : undefined
                }
                onMouseLeave={animationDone ? () => onTooltip(null) : undefined}
              />
            );
          }),
        )}
      </g>
    </svg>
  );
}

// ─── HeatmapChart (outer component) ──────────────────────────────────────────

export function HeatmapChart() {
  const [palette, setPalette] = useState("viridis");
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const [hoveredTemp, setHoveredTemp] = useState(null); // legend hover (°C | null)
  const [animKey, setAnimKey] = useState(0); // bump to replay animation
  const [animationDone, setAnimationDone] = useState(false);

  const prefersReducedMotion = useReducedMotion();
  const animEnabled = !prefersReducedMotion;

  const handleTooltip = useCallback((v) => setTooltip(v), []);
  const handleLegendHover = useCallback((temp) => setHoveredTemp(temp), []);

  // ── Fetch data once ────────────────────────────────────────────────────────
  useEffect(() => {
    loadHeatmapData()
      .then((d) => {
        setData(d);
        setLoading(false);
        setAnimKey((k) => k + 1); // replay animation on fresh data
        setAnimationDone(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
        setAnimationDone(true);
      });
  }, []);

  // ── Mark animation complete after the last cell finishes ───────────────────
  // Timer = wrapper ease-in + full stagger window + one cell duration + buffer.
  useEffect(() => {
    if (!animEnabled || !data.length) {
      setAnimationDone(true);
      return;
    }
    setAnimationDone(false);
    const ms = EASE_IN_MS + FILL_MS + CELL_DURATION + ANIM_BUFFER;
    const t = setTimeout(() => setAnimationDone(true), ms);
    return () => clearTimeout(t);
  }, [animKey, animEnabled, data.length]);

  // ── Colour scale ───────────────────────────────────────────────────────────
  const colorScale = useMemo(() => {
    const vals = data.map((d) => d.value).filter((v) => v != null);
    const lo = d3.min(vals) ?? -15;
    const hi = d3.max(vals) ?? 45;
    return d3.scaleSequential(PALETTES[palette].fn).domain([lo, hi]);
  }, [palette, data]);

  // ── Wrapper entrance animation ─────────────────────────────────────────────
  // key={animKey} forces a new DOM node on data load, which restarts the
  // CSS animation even if the palette is unchanged.
  const wrapperStyle = animEnabled
    ? { animation: `heatmapWrapperReveal ${EASE_IN_MS}ms ease-out both` }
    : undefined;

  // ── Palette selector (controls slot) ──────────────────────────────────────
  const paletteControl = (
    <select
      value={palette}
      onChange={(e) => setPalette(e.target.value)}
      style={SELECT_STYLE}
      aria-label="Colour palette"
    >
      {Object.entries(PALETTES).map(([key, { label }]) => (
        <option key={key} value={key}>
          {label}
        </option>
      ))}
    </select>
  );

  return (
    <>
      {/* Inject keyframes once into the document. */}
      <style>{ANIMATION_CSS}</style>

      <ResponsiveChartWrapper
        title="Global Weekly Temperatures — 2025"
        controls={paletteControl}
      >
        {({ width, height }) => {
          const vals = data.map((d) => d.value).filter((v) => v != null);
          const lo = d3.min(vals) ?? -15;
          const hi = d3.max(vals) ?? 45;
          const svgH = Math.max(0, height - LEGEND_H);

          if (loading) return <StatusMsg>Loading temperature data…</StatusMsg>;
          if (error) return <StatusMsg error>⚠ {error}</StatusMsg>;

          return (
            // key forces DOM remount → CSS animation replays on new data load.
            <div key={animKey} style={wrapperStyle}>
              <HeatmapSVG
                width={width}
                height={svgH}
                data={data}
                colorScale={colorScale}
                onTooltip={handleTooltip}
                hoveredLegendTemp={hoveredTemp}
                animationDone={animationDone}
                animEnabled={animEnabled}
              />

              {/* Legend aligns left edge with heatmap's y-axis (margin.left = 114px). */}
              <div style={{ paddingLeft: 114 }}>
                <ColorScaleLegend
                  colorScale={colorScale}
                  min={lo}
                  max={hi}
                  containerWidth={Math.max(0, width - 114)}
                  onHover={handleLegendHover}
                />
              </div>

              {tooltip && (
                <ChartTooltip
                  x={tooltip.x}
                  y={tooltip.y}
                  containerWidth={width}
                  containerHeight={height}
                >
                  <div className="tooltip-title">{tooltip.city}</div>
                  <div className="tooltip-row">
                    <span
                      className="tooltip-swatch"
                      style={{ background: tooltip.fill }}
                    />
                    <span className="tooltip-label">
                      {weekLabel(tooltip.week)}
                    </span>
                    <span
                      className="tooltip-value"
                      style={{ color: tooltip.fill }}
                    >
                      {tooltip.value.toFixed(1)}°C
                    </span>
                  </div>
                </ChartTooltip>
              )}
            </div>
          );
        }}
      </ResponsiveChartWrapper>
    </>
  );
}

// ─── StatusMsg helper ─────────────────────────────────────────────────────────

function StatusMsg({ children, error = false }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        fontSize: "0.8rem",
        fontFamily: "var(--sans)",
        color: error ? "#D55E00" : "var(--chart-text)",
      }}
    >
      {children}
    </div>
  );
}

// ─── Shared inline styles ─────────────────────────────────────────────────────

const SELECT_STYLE = {
  fontSize: "0.72rem",
  padding: "3px 6px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg-card)",
  color: "var(--text)",
  cursor: "pointer",
  fontFamily: "var(--sans)",
};
