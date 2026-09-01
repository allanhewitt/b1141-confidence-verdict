import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Routes, Route } from "react-router-dom";
import Respond from "./Respond.jsx";
import Control from "./Control.jsx";
import Display from "./Display.jsx";
import { profileProps } from "./cwd/visual-profile.js";
import "./styles.css";
import "./cwd/cwd.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/respond/:id" element={<Respond />} />
        <Route path="/control/:id" element={<Control />} />
        <Route path="/display/:id" element={<Display />} />
        <Route
          path="*"
          element={
            <main {...profileProps()} className="cwd-student cwd-student--centred">
              <h1>Open an activity link to begin.</h1>
            </main>
          }
        />
      </Routes>
    </HashRouter>
  </React.StrictMode>
);
