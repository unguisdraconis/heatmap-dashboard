import { motion, useReducedMotion } from "motion/react";
import { useDimensions } from "../hooks/useDimensions";

/**
 * ResponsiveChartWrapper — the "wrapper pattern" for responsive charts.
 *
 * Uses the useDimensions hook to measure the chart container, then passes
 * the measured { width, height } to children via a render-prop function.
 *
 * The SVG is absolutely positioned inside the container so it doesn't
 * affect the container's measured size (preventing a resize feedback loop).
 *
 * The .chart-svg-wrapper also serves as the positioning context for
 * HTML tooltips — they sit absolutely positioned on top of the SVG.
 */

export function ResponsiveChartWrapper({ title, controls, legend, children }) {
  const [ref, dimensions] = useDimensions();
  const prefersReducedMotion = useReducedMotion();
  const motionTransition = prefersReducedMotion
    ? { duration: 0 }
    : { duration: 0.35, ease: "easeOut" };

  return (
    <motion.div
      className="chart-widget"
      initial={{ y: 12 }}
      animate={{ y: 0 }}
      transition={motionTransition}
      layout
      layoutTransition={motionTransition}
    >
      <div className="chart-header">
        <h3 className="chart-title">{title}</h3>
        {controls && <div className="chart-controls">{controls}</div>}
      </div>
      <div ref={ref} className="chart-container">
        {dimensions.width > 0 && dimensions.height > 0 && (
          <motion.div
            className="chart-svg-wrapper"
            animate={{ y: 0 }}
            transition={motionTransition}
          >
            {children(dimensions)}
          </motion.div>
        )}
      </div>
      {legend && <div className="chart-legend">{legend}</div>}
    </motion.div>
  );
}
