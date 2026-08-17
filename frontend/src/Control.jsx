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
      .then((r) => {
        if (!r.ok) throw new Error("This activity does not exist.");
        return r.json();
      })
      .then(setConfig)
      .catch((e) => setError(e.message));
  }, [id]);

  const refresh = useCallback(() => {
    fetch(`${API}/api/aggregate/confidence/${id}`)
      .then((r) => r.json())
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

  const complete = async () => {
    await fetch(`${API}/api/session/${id}/complete`, { method: "POST" });
    refresh();
  };

  const clear = async () => {
    if (!window.confirm("Clear the live session and return to initial collection?")) return;
    await fetch(`${API}/api/session/${id}/clear`, { method: "POST" });
    refresh();
  };

  if (error) return <div className="wrap"><p className="error">{error}</p></div>;
  if (!config) return <div className="wrap"><p className="muted">Loading…</p></div>;

  const phase = aggregate?.phase || "initial";
  const movement = aggregate?.movement || {};

  return (
    <div className="control-shell">
      <div className="activity-kicker">B1141 · Lecturer control · Week {config.week}</div>
      <h1>{config.question}</h1>

      <div className="control-status-grid">
        <Status label="Phase" value={phaseLabel(phase)} />
        <Status label="Initial responses" value={aggregate?.total ?? 0} />
        <Status label="Resolved" value={`${aggregate?.resolved_count ?? 0} / ${aggregate?.total ?? 0}`} />
        <Status label="Initial avg. confidence" value={fmt(aggregate?.initial_mean_confidence)} />
      </div>

      <div className="control-toolbar">
        <a className="projector-link" href={`#/display/${id}`} target="_blank" rel="noreferrer">Open projector display ↗</a>
        {!aggregate?.revealed && <button onClick={reveal}>Reveal class picture</button>}
        {aggregate?.revealed && !aggregate?.complete && <button onClick={complete}>Complete activity</button>}
        <button className="danger" onClick={clear}>Clear session</button>
      </div>

      {!aggregate?.revealed ? (
        <section className="dashboard-section">
          <div className="section-heading"><div><div className="eyebrow">Private lecturer view</div><h2>Responses arriving</h2></div></div>
          <Heatmap options={config.options} confidencePoints={config.confidence_points} matrix={aggregate?.current_matrix || aggregate?.matrix || {}} correctOption={config.correct_option} />
          <p className="muted small">Students cannot see this class picture until reveal.</p>
        </section>
      ) : (
        <>
          <section className="movement-summary">
            <Movement label="Judgement only changed" value={movement.judgement_only || 0} />
            <Movement label="Confidence only changed" value={movement.confidence_only || 0} />
            <Movement label="Both changed" value={movement.both_changed || 0} />
            <Movement label="Both retained" value={movement.neither_changed || 0} />
          </section>

          <div className="control-heatmap-grid">
            <section className="dashboard-section">
              <div className="section-heading"><div><div className="eyebrow">Frozen reveal</div><h2>Initial class picture</h2></div></div>
              <Heatmap options={config.options} confidencePoints={config.confidence_points} matrix={aggregate?.initial_matrix || {}} correctOption={config.correct_option} />
            </section>
            <section className="dashboard-section">
              <div className="section-heading"><div><div className="eyebrow">Live calibration</div><h2>Current class picture</h2></div></div>
              <Heatmap options={config.options} confidencePoints={config.confidence_points} matrix={aggregate?.current_matrix || {}} correctOption={config.correct_option} />
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function Status({ label, value }) {
  return <div className="status-card"><span>{label}</span><strong>{value}</strong></div>;
}

function Movement({ label, value }) {
  return <div className="movement-card"><span>{label}</span><strong>{value}</strong></div>;
}

function phaseLabel(phase) {
  if (phase === "revealed") return "Calibration open";
  if (phase === "complete") return "Complete";
  return "Initial judgement";
}

function fmt(value) {
  return value == null ? "—" : Number(value).toFixed(1);
}
