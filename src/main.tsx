import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Overlay } from "@/components/Overlay";

import "@/styles/global.css";
import "@/styles/character.css";
import "@/styles/overlay.css";

const container = document.getElementById("root");
if (!container) throw new Error("overlay root element is missing");

createRoot(container).render(
  <StrictMode>
    <Overlay />
  </StrictMode>,
);
