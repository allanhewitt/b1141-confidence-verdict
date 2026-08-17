import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Routes, Route } from "react-router-dom";
import Respond from "./Respond.jsx";
import Control from "./Control.jsx";
import Display from "./Display.jsx";
import "./styles.css";
import "./landscape.css";

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
            <div className="wrap">
              <p className="muted">
                Open /#/respond/&#123;activity-id&#125;, /#/control/&#123;activity-id&#125; or /#/display/&#123;activity-id&#125;.
              </p>
            </div>
          }
        />
      </Routes>
    </HashRouter>
  </React.StrictMode>
);
