import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import "./App.scss";
import "./styles/tokens.css";
import TopNav from "./components/TopNav";
import DashboardPage from "./components/DashboardPage";
import Markets from "./components/MainContainer/MainContainer";
import AboutUs from "./components/AboutUs";

// The chart library is large; load it only when the Chart page opens.
const ChartPage = lazy(() => import("./components/ChartPage"));

function App() {
  return (
    <div className="app">
      <TopNav />
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/chart" element={<ChartPage />} />
          <Route path="/chart/:symbol" element={<ChartPage />} />
          <Route path="/markets" element={<Markets />} />
          <Route path="/about" element={<AboutUs />} />
        </Routes>
      </Suspense>
    </div>
  );
}

export default App;
