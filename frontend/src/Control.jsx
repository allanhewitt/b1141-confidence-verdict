import { useEffect, useState, useCallback } from "react";
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

  const fetchAggregate = useCallback(() => {
    fetch(`${API}/api/aggregate/confidence/${id}`)
      .then((r) => r.json())
      .then(setAggregate)
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    fetchAggregate();
    const interval = setInterval(fetchAggregate, 2000);
    return () => clearInterval(interval);
  }, [fetchAggregate]);

  const reveal = () =>
    fetch(`${API}/api/session/${id}/reveal`, { method: "POST" }).then(fetchAggregate);

  const clear = () => {
    if (!window.confirm("Clear all responses for this activity's live view?")) return;
    fetch(`${API}/api/session/${id}/clear`, { method: "POST" }).then(fetchAggregate);
  };

  if (error) {
    return (
      <div className="wrap">
        <p className="error">{error}</p>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="wrap">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="wrap wrap-wide">
      <h1>{config.question}</h1>
      <p className="muted">
        {aggregate?.total ?? 0} response{(aggregate?.total ?? 0) === 1 ? "" : "s"}
        {config.cohort_size ? ` of ~${config.cohort_size}` : ""}
      </p>

      <div className="controls">
        <button onClick={reveal}>Reveal now</button>
        <button className="danger" onClick={clear}>
          Clear session
        </button>
      </div>

      {aggregate && (
        <Heatmap
          options={config.options}
          confidencePoints={config.confidence_points}
          matrix={aggregate.matrix}
          correctOption={config.correct_option}
        />
      )}

      <p className="muted small">
        {aggregate?.revealed ? "Visible to students." : "Not yet visible to students."}
      </p>
    </div>
  );
}
