import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./i18n";
import "./index.css";
import "./modules/explorer/lib/iconTheme/catppuccinPalette.css";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { RecoveryRuntime } from "./components/RecoveryRuntime";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <RecoveryRuntime>
        <App />
      </RecoveryRuntime>
    </AppErrorBoundary>
  </React.StrictMode>,
);
