import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";
import App from "./App.tsx";
import { WebHaptics } from "web-haptics";

const haptics = new WebHaptics();
document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (target.closest("button:not(:disabled)")) {
    haptics.trigger("selection");
  }
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
