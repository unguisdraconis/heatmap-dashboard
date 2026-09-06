// Import CSS for styling and Motion components for animations.
import "./App.css";
import { motion, useReducedMotion } from "motion/react";
// Import individual chart components to be used in the application.
import { HeatmapChart } from "./components/HeatmapChart";

// Define the main App component that renders the dashboard.
function App() {
  // Check if the user prefers reduced motion to accomodate accessibility settings.
  const prefersReducedMotion = useReducedMotion();
  // Set animation transition based on the user's preference for reduced motion.
  const motionTransition = prefersReducedMotion
    ? { duration: 0 }
    : { duration: 0.35, ease: "easeOut" };

  return (
    <>
      {/* Animated header with Motion */}
      <motion.header
        className="dashboard-header"
        initial={{ y: 18 }}
        animate={{ y: 0 }}
        transition={motionTransition}
      >
        {/* Header content including title and description */}
        <h1> 🌍 Temperature Patterns for 20 Cities 🌡️</h1>
        <p className="subtitle">Historical mean temperatures across 2025</p>
        <p className="description">
          Daily mean temperatures for 20 selected cities are retrieved at runtime
          and aggregated into 52 sequential periods. The first 51 periods span
          seven days; the final period spans December 24–31 to preserve a
          52-column view of 2025.
        </p>
      </motion.header>

      {/* Main content area displaying all charts */}
      <main className="dashboard-grid">
        <HeatmapChart />
      </main>

      {/* Animated footer with Motion */}
      <motion.footer
        className="dashboard-footer"
        initial={{ y: 12 }}
        animate={{ y: 0 }}
        transition={motionTransition}
      >
        {/* Footer content including the data source */}
        <p className="data-source">
          Data source:{" "}
          <a href="https://open-meteo.com/en/docs/historical-weather-api">
            Open-Meteo Historical Weather API
          </a>{" "}
          (CC BY 4.0) · Scaffolding by Claude Sonnet 4.6 · Visualization by
          Jeremiah King as part of the D3 Loves React course taught by Yan Holtz
        </p>
      </motion.footer>
    </>
  );
}

// Export the App component as default for use in other parts of the application.
export default App;
