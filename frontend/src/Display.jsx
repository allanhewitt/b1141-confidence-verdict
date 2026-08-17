import { useCallback, useEffect, useState } from "react";
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

function blankMatrix(options, points) {
  return Object.fromEntries(options.map((option) => [option, Array.from({ length: points }, () => 0)]));
}

export default function Display() {
  const { id } = useParams();
  const [config, setConfig] = useState(null);
  const [aggregate, setAggregate] = useState(null);
  const [error, setError] = useState(null);

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
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => { if (data) setAggregate(data); })
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [refresh]);

  if (error) return <div className="display-stage display-centred"><p className="error">{error}</p></div>;
  if (!config || !aggregate) return <div className="display-stage display-centred"><div className="display-kicker">B1141</div><h1>Loading class display…</h1></div>;

  if (!aggregate.revealed) {
    return (
      <div className="display-stage hidden-landscape-display">
        <FullscreenButton />
        <header className="display-header hidden-display-header">
          <div>
            <div className="display-kicker">B1141 · Week {config.week} · Hidden landscape</div>
            <h1>{config.question}</h1>
          </div>
          <div className="display-response-chip">{aggregate.live_total} placed</div>
        </header>

        <p className="display-subtitle">Each person has chosen a verdict and a confidence position. The class pattern remains concealed.</p>

        <section className="display-panel hidden-map-panel">
          <Heatmap
            options={config.options}
            confidencePoints={config.confidence_points}
            matrix={blankMatrix(config.options, config.confidence_points)}
            showCounts={false}
            showTotals={false}
            hiddenSpace
            ariaLabel="Hidden class judgement and confidence landscape"
          />
          <div className="display-hold">Where will the room cluster when the landscape is revealed?</div>
        </section>

        {config.cohort_size && (
          <div className="display-progress-wrap">
            <ProgressBar value={aggregate.live_total} max={config.cohort_size} />
            <span>{aggregate.live_total} of about {config.cohort_size} expected</span>
          </div>
        )}
      </div>
    );
  }

  const landscape = aggregate.landscape || {};

  return (
    <div className="display-stage display-reveal landscape-display-reveal">
      <FullscreenButton />
      <header className="display-header">
        <div>
          <div className="display-kicker">B1141 · Week {config.week} · Landscape revealed</div>
          <h1>{config.question}</h1>
        </div>
        <div className="display-response-chip">{aggregate.total} positions</div>
      </header>

      <div className="display-summary-grid landscape-display-summary">
        <Summary
          label="Most selected"
          value={landscape.dominant_option || "—"}
          sub={landscape.dominant_pct == null ? "" : `${Math.round(landscape.dominant_pct)}% of the room`}
        />
        <Summary
          label="Average confidence"
          value={landscape.mean_confidence == null ? "—" : `${Number(landscape.mean_confidence).toFixed(1)} / ${config.confidence_points}`}
          sub="across the whole room"
        />
        <Summary
          label="High confidence"
          value={landscape.high_confidence_pct == null ? "—" : `${Math.round(landscape.high_confidence_pct)}%`}
          sub={`confidence ${Math.ceil(config.confidence_points * 0.8)}–${config.confidence_points}`}
        />
        <Summary
          label="Space occupied"
          value={`${landscape.occupied_cells ?? 0} cells`}
          sub={`${landscape.occupied_options ?? 0} verdict options used`}
        />
      </div>

      <section className="display-panel display-main-heatmap landscape-main-map">
        <div className="display-panel-title">
          <span>Selection × confidence</span>
          <strong>The shape of the room</strong>
        </div>
        <Heatmap
          options={config.options}
          confidencePoints={config.confidence_points}
          matrix={aggregate.matrix}
          correctOption={config.correct_option}
        />
      </section>

      <div className="display-landscape-signals">
        {(landscape.signals || []).map((signal) => <div key={signal}>{signal}</div>)}
      </div>

      <div className="display-discussion-prompt">
        Where are the <strong>clusters</strong>, <strong>empty regions</strong>, <strong>confident minorities</strong> and <strong>uncertain majorities</strong>?
      </div>
    </div>
  );
}

function Summary({ label, value, sub }) {
  return <div className="display-summary-card"><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>;
}
