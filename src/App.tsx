import { Route, Routes } from "react-router-dom";
import "./App.scss";
import Header from "./components/Header/Header";
import Dashboard from "./components/MainContainer/MainContainer";
import AboutUs from "./components/AboutUs";

function App() {
  return (
    <div className="app">
      <Header />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/about" element={<AboutUs />} />
      </Routes>
      
    </div>
  );
}

export default App;
