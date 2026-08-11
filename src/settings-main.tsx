import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { SettingsApp } from "@/settings/SettingsApp";

import "@/styles/global.css";
import "@/styles/settings.css";

const container = document.getElementById("root");
if (!container) throw new Error("settings root element is missing");

createRoot(container).render(
  <StrictMode>
    <SettingsApp />
  </StrictMode>,
);
