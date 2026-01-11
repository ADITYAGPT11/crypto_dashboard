import ReactDOM from "react-dom/client";
import App from "./App";
import { BrowserRouter } from "react-router-dom";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Root container missing in index.html");
}

ReactDOM.createRoot(container).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);