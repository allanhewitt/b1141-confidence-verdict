import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, useParams } from "react-router-dom";
import Respond from "./Respond.jsx";
import Control from "./Control.jsx";
import Display from "./Display.jsx";
import { resolvePublicActivityAlias } from "./cwd/public-aliases.js";
import { profileProps } from "./cwd/visual-profile.js";
import "./styles.css";
import "./cwd/cwd.css";
import "./cwd/student-visual-pass.css";
import "./cwd/lecturer-visual-pass.css";
import "./cwd/presentation.css";

function normalizeLegacyHashRoute() {
  if (window.location.pathname !== "/") return;
  if (!window.location.hash.startsWith("#/")) return;
  window.history.replaceState(null, "", window.location.hash.slice(1));
}

function StartMessage() {
  return (
    <main {...profileProps()} className="cwd-student cwd-student--centred">
      <h1>Open an activity link to begin.</h1>
    </main>
  );
}

function PublicStudentRoute() {
  const { alias } = useParams();
  const activityId = resolvePublicActivityAlias(alias);
  return activityId ? <Respond activityId={activityId} /> : <StartMessage />;
}

normalizeLegacyHashRoute();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/respond/:id" element={<Respond />} />
        <Route path="/control/:id" element={<Control />} />
        <Route path="/display/:id" element={<Display />} />
        <Route path="/:alias" element={<PublicStudentRoute />} />
        <Route path="*" element={<StartMessage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
