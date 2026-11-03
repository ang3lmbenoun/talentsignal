import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
// Self-hosted via @fontsource/inter (bundled woff2, zero external network
// request at runtime) rather than a Google Fonts <link> — approved for demo
// reliability. Only the weights theme.css actually uses.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./theme.css";
import { applyTheme, getStoredTheme } from "./theme";

// Applied before the first render (not inside a React effect) so the stored
// theme is already correct for the very first paint -- no light-then-dark
// flash. Defaults to "light" when nothing is stored yet.
applyTheme(getStoredTheme());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App onboarding />
  </React.StrictMode>,
);
