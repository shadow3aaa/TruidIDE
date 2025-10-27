import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { DownloadStatusProvider } from "@/components/ProotDownloadProgress";
import App from "./App";
import "@saurl/tauri-plugin-safe-area-insets-css-api";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <HashRouter>
      <DownloadStatusProvider>
        <App />
      </DownloadStatusProvider>
    </HashRouter>
  </React.StrictMode>,
);
