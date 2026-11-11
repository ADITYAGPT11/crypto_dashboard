import { lazy, Suspense, useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import "./App.scss";
import "./styles/tokens.css";
import TopNav from "./components/TopNav";
import DashboardPage from "./components/DashboardPage";
import Markets from "./components/MainContainer/MainContainer";
import AboutUs from "./components/AboutUs";
import RiskPage from "./components/RiskPage";
import AlertsPage from "./components/AlertsPage";
import AlertToast from "./components/AlertToast";
import { SetupAlertService } from "./services/SetupAlertService";

// The chart library is large; load it only when the Chart page opens.
const ChartPage = lazy(() => import("./components/ChartPage"));
const StatsPage = lazy(() => import("./components/StatsPage"));

function App() {
  // Setup alerts are checked while any GreenMTM page is open (Phase 1a, browser-side).
  useEffect(() => SetupAlertService.getInstance().start(), []);

  return (
    <div className="app">
      <TopNav />
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/chart" element={<ChartPage />} />
          <Route path="/chart/:symbol" element={<ChartPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/risk" element={<RiskPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/markets" element={<Markets />} />
          <Route path="/about" element={<AboutUs />} />
        </Routes>
      </Suspense>
      <AlertToast />
    </div>
  );
}

export default App;
