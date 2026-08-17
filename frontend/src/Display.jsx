import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import Heatmap from "./Heatmap.jsx";

const API = import.meta.env.VITE_API_BASE || "http://localhost:4000";

function FullscreenButton() {
  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      // Fullscreen may be blocked unless triggered by a user gesture.
    }
  };
  return <button className="display-fullscreen" onClick={toggleFullscreen}>⛶ Full screen</button>;
}

function ProgressBar({ value, max }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  return <div className="display-progress"><span style={{ width: `${pct}%` }} /></div>;
}

export default function Display() {
  const { id } = useParams();
  const [config, setConfig] = useState(null);
  const [aggregate, setAggregate] = useState(null);
  const [error, setError] = useState(null);

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
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setAggregate(data); })
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [refresh]);

  const initialTop = useMemo(
    () => topOption(config?.options || [], aggregate?.initial_matrix || {}),
    [config, aggregate]
  );

  if (error) return <div className="display-stage display-centred"><p className="error">{error}</p></div>;
  if (!config || !aggregate) return <div className="display-stage display-centred"><div className="display-kicker">B1141</div><h1>Loading class display…</h1></div>;

  if (!aggregate.revealed) {
    return (
      <div className="display-stage display-centred">
        <FullscreenButton />
        <div className="display-kicker">B1141 · Week {config.week} · Initial judgement</div>
        <h1 className="display-question">{config.question}</h1>
        <p className="display-subtitle">Choose a verdict, then commit to how confident you are.</p>
        <div className="display-counter"><strong>{aggregate.total}</strong><span>responses received{config.cohort_size ? ` · about ${config.cohort_size} expected` : ""}</span></div>
        {config.cohort_size && <ProgressBar value={aggregate.total} max={config.cohort_size} />}
        <div className="display-hold">The class picture remains hidden while judgements are being made.</div>
      </div>
    );
  }

  if (aggregate.complete) {
    return (
      <div className="display-stage display-complete">
        <FullscreenButton />
        <header className="display-header">
          <div><div className="display-kicker">B1141 · Week {config.week} · Complete</div><h1>How did the room calibrate?</h1></div>
          <div className="display-response-chip">{aggregate.resolved_count} resolved</div>
        </header>

        <MovementSummary movement={aggregate.movement} />

        <div className="display-heatmap-pair">
          <section className="display-panel">
            <div className="display-panel-title"><span>Before</span><strong>At reveal</strong></div>
            <Heatmap options={config.options} confidencePoints={config.confidence_points} matrix={aggregate.initial_matrix} correctOption={config.correct_option} />
          </section>
          <section className="display-panel">
            <div className="display-panel-title"><span>After</span><strong>Final class picture</strong></div>
            <Heatmap options={config.options} confidencePoints={config.confidence_points} matrix={aggregate.current_matrix} correctOption={config.correct_option} />
          </section>
        </div>

        <div className="display-discussion-prompt">What changed more: our <strong>judgements</strong>, our <strong>confidence</strong>, or neither?</div>
      </div>
    );
  }

  return (
    <div className="display-stage display-reveal">
      <FullscreenButton />
      <header className="display-header">
        <div><div className="display-kicker">B1141 · Week {config.week} · The reveal</div><h1>{config.question}</h1></div>
        <div className="display-response-chip">{aggregate.total} responses</div>
      </header>

      <div className="display-summary-grid">
        <Summary label="Most selected verdict" value={initialTop?.label || "—"} sub={initialTop ? `${initialTop.pct}% of responses` : ""} />
        <Summary label="Average confidence" value={fmt(aggregate.initial_mean_confidence)} sub={`out of ${config.confidence_points}`} />
        <Summary label="Calibration resolved" value={`${aggregate.resolved_count} / ${aggregate.total}`} sub="explicit second judgements" />
      </div>

      <section className="display-panel display-main-heatmap">
        <div className="display-panel-title"><span>Frozen class picture</span><strong>Verdict × confidence at reveal</strong></div>
        <Heatmap options={config.options} confidencePoints={config.confidence_points} matrix={aggregate.initial_matrix} correctOption={config.correct_option} />
      </section>

      <MovementSummary movement={aggregate.movement} compact />
      <div className="display-discussion-prompt">Where are the <strong>confident minorities</strong>, the <strong>uncertain majorities</strong>, and the points of genuine consensus?</div>
    </div>
  );
}

function Summary({ label, value, sub }) {
  return <div className="display-summary-card"><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>;
}

function MovementSummary({ movement = {}, compact = false }) {
  const cards = [
    ["Judgement changed", movement.judgement_only || 0],
    ["Confidence changed", movement.confidence_only || 0],
    ["Both changed", movement.both_changed || 0],
    ["Both retained", movement.neither_changed || 0],
  ];
  return (
    <div className={`display-movement-summary${compact ? " compact" : ""}`}>
      {cards.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
    </div>
  );
}

function topOption(options, matrix) {
  const totals = options.map((label) => ({
    label,
    count: (matrix[label] || []).reduce((sum, value) => sum + value, 0),
  }));
  const total = totals.reduce((sum, row) => sum + row.count, 0);
  const top = totals.reduce((best, row) => !best || row.count > best.count ? row : best, null);
  if (!top || total === 0) return null;
  return { ...top, pct: Math.round((top.count / total) * 100) };
}

function fmt(value) {
  return value == null ? "—" : Number(value).toFixed(1);
}
