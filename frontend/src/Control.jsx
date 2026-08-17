import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Heatmap from "./Heatmap.jsx";

const API = import.meta.env.VITE_API_BASE || "http://localhost:4000";

export default function Control() {
  const { id } = useParams();
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);
  const [aggregate, setAggregate] = useState(null);

  useEffect(() => {
    fetch(`${API}/api/config/confidence/${id}`)
      .then((response) => {
        if (!response.ok) throw new Error("This activity does not exist.");
        return response.json();
      })
      .then(setConfig)
      .catch((e) => setError(e.message));
  }, [id]);

  const refresh = useCallback(() => {
    fetch(`${API}/api/aggregate/confidence/${id}`)
      .then((response) => response.json())
      .then(setAggregate)
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 2000);
    return () => clearInterval(interval);
  }, [refresh]);

  const reveal = async () => {
    await fetch(`${API}/api/session/${id}/reveal`, { method: "POST" });
    refresh();
  };

  const clear = async () => {
    if (!window.confirm("Clear the live session and return to a hidden landscape?")) return;
    await fetch(`${API}/api/session/${id}/clear`, { method: "POST" });
    refresh();
  };

  if (error) return <div className="wrap"><p className="error">{error}</p></div>;
  if (!config) return <div className="wrap"><p className="muted">Loading…</p></div>;

  const landscape = aggregate?.landscape || {};

  return (
    <div className="control-shell landscape-control-shell">
      <div className="activity-kicker">B1141 · Lecturer control · Week {config.week}</div>
      <h1>{config.question}</h1>

      <div className="control-status-grid landscape-status-grid">
        <Status label="Phase" value={aggregate?.revealed ? "Landscape revealed" : "Landscape hidden"} />
        <Status label="Responses" value={aggregate?.revealed ? aggregate?.total ?? 0 : aggregate?.live_total ?? 0} />
        <Status label="Average confidence" value={formatConfidence(aggregate?.mean_confidence, config.confidence_points)} />
        <Status label="Occupied cells" value={aggregate?.revealed ? landscape.occupied_cells ?? "—" : "hidden"} />
      </div>

      <div className="control-toolbar">
        <a className="projector-link" href={`#/display/${id}`} target="_blank" rel="noreferrer">
          Open projector display ↗
        </a>
        {!aggregate?.revealed && <button onClick={reveal}>Reveal class landscape</button>}
        <button className="danger" onClick={clear}>Clear session</button>
      </div>

      {!aggregate?.revealed ? (
        <section className="dashboard-section">
          <div className="section-heading">
            <div>
              <div className="eyebrow">Private lecturer view</div>
              <h2>Positions arriving in the hidden space</h2>
            </div>
          </div>
          <Heatmap
            options={config.options}
            confidencePoints={config.confidence_points}
            matrix={aggregate?.matrix || {}}
            correctOption={config.correct_option}
          />
          <p className="muted small">Students and the projector see only their own position or the hidden-space holding view until reveal.</p>
        </section>
      ) : (
        <>
          <section className="landscape-summary-row">
            <Summary label="Most selected" value={landscape.dominant_option || "—"} sub={landscape.dominant_pct == null ? "" : `${Math.round(landscape.dominant_pct)}% of the room`} />
            <Summary label="Average confidence" value={formatConfidence(landscape.mean_confidence, config.confidence_points)} sub="across all positions" />
            <Summary label="High confidence" value={landscape.high_confidence_pct == null ? "—" : `${Math.round(landscape.high_confidence_pct)}%`} sub={`confidence ${Math.ceil(config.confidence_points * 0.8)}–${config.confidence_points}`} />
            <Summary label="Space occupied" value={`${landscape.occupied_cells ?? 0} cells`} sub={`${landscape.occupied_options ?? 0} verdict options used`} />
          </section>

          <section className="dashboard-section revealed-dashboard-section">
            <div className="section-heading">
              <div>
                <div className="eyebrow">Frozen reveal</div>
                <h2>Judgement × confidence landscape</h2>
              </div>
              <div className="response-chip">{aggregate.total} positions</div>
            </div>
            <Heatmap
              options={config.options}
              confidencePoints={config.confidence_points}
              matrix={aggregate.matrix}
              correctOption={config.correct_option}
            />
          </section>

          <section className="landscape-signals-card">
            <div className="eyebrow">Useful patterns to discuss</div>
            <h2>What shape has the room produced?</h2>
            <div className="landscape-signal-list">
              {(landscape.signals || []).map((signal) => <div key={signal}>{signal}</div>)}
              <div>Look across the grid for clusters, empty regions, confident minorities and uncertain majorities.</div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Status({ label, value }) {
  return <div className="status-card"><span>{label}</span><strong>{value}</strong></div>;
}

function Summary({ label, value, sub }) {
  return (
    <div className="landscape-summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  );
}

function formatConfidence(value, points) {
  return value == null ? "—" : `${Number(value).toFixed(1)} / ${points}`;
}
