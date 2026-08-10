import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { ConfirmProvider } from "./components/ui/ConfirmDialog";
import { ToastProvider } from "./components/ui/Toast";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ToastProvider>
      <ConfirmProvider>
        <App />
      </ConfirmProvider>
    </ToastProvider>
  </React.StrictMode>,
);
