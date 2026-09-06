# Agent Instructions for Heatmap Dashboard

## Project overview

- This is a D3 Loves React learning artifact built with React, D3, and Vite.
- It visualizes 2025 historical mean temperatures for 20 selected cities.
- The browser retrieves data at runtime from the Open-Meteo Historical Weather API.
- Preserve the learning-project scope; do not present it as a production weather service.

## Important files

- `package.json` — project metadata and scripts.
- `vite.config.js` — Vite configuration for React.
- `src/App.jsx` — page framing, data attribution, and learning credits.
- `src/components/HeatmapChart.jsx` — data retrieval, aggregation, heatmap, interactive legend, and exact-value table.
- `src/components/ResponsiveChartWrapper.jsx` — responsive chart measurement and layout.
- `src/components/ChartTooltip.jsx` — pointer tooltip.
- `src/hooks/useDimensions` — hook used by `ResponsiveChartWrapper` for responsive SVG sizing.
- `src/App.css` — application, legend, table, and responsive styles.

## Build and run

Use the existing npm scripts from `package.json`:

- `npm run dev` — start local development server.
- `npm run build` — build production output.
- `npm run preview` — preview the built app locally.
- `npm run deploy` — publish to GitHub Pages; run only with explicit authorization.

## Conventions and guidance

- Keep the artifact focused; avoid unnecessary modernization, routing, frameworks, or architecture changes.
- Do not reintroduce the removed Energy Dashboard components or data.
- Preserve Open-Meteo attribution and keep its CC BY 4.0 data license distinct from the repository's software-license status.
- Preserve the continuous pointer-hover legend behavior and its matching keyboard-focus controls; the legend is the primary exploration interface.
- Keep the structured table derived from the same aggregated values as the SVG.
- Do not make all heatmap cells focusable when the legend and table provide the intended access paths.

## When modifying the app

- Preserve the 20-city, January 1–December 31, 2025 scope unless requirements explicitly change.
- Preserve 52 displayed periods and the December 24–31 final-period label.
- Ensure data claims describe runtime historical retrieval, not current weather or a weekly update schedule.
- Validate with `npm ci`, `npm run build`, and `git diff --check` before deployment.
- Manually check pointer legend exploration, keyboard legend focus, the exact-value table, reduced motion, and narrow layouts when browser tooling is available.

## Notes for agents

- There is no automated test suite in this repository.
- Do not deploy, alter `gh-pages`, or change GitHub settings without explicit authorization.
