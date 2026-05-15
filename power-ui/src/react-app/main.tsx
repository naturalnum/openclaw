import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import "./index.css";

const mount = document.getElementById("root");
if (!mount) {
  throw new Error("Missing #root");
}

createRoot(mount).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
