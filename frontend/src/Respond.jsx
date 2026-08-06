import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import Heatmap from "./Heatmap.jsx";

const API = import.meta.env.VITE_API_BASE || "http://localhost:4000";

// crypto.randomUUID() requires a secure context (HTTPS/localhost) — it
// throws on a plain http://*.sslip.io deployment and blanks the page.
// Manual fallback covers that case (lesson from b1141-likert-poll).
function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch {
      // fall through
    }
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getToken() {
  let token = localStorage.getItem("confidence-token");
  if (!token) {
    token = generateId();
    localStorage.setItem("confidence-token", token);
  }
  return token;
}

export default function Respond() {
  const { id } = useParams();
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);
  const [option, setOption] = useState(null);
  const [confidence, setConfidence] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [editing, setEditing] = useState(false);
  const [aggregate, setAggregate] = useState(null);
  const [token] = useState(getToken);

  useEffect(() => {
    fetch(`${API}/api/config/confidence/${id}`)
      .then((r) => {
        if (!r.ok) {
          throw new Error(
            r.status === 404
              ? "This activity does not exist. Check the link you were given."
              : "This activity is not currently active."
          );
        }
        return r.json();
      })
      .then(setConfig)
      .catch((e) => setError(e.message));

    const stored = localStorage.getItem(`confidence-value-${id}`);
    if (stored) {
      const { option: o, confidence: c } = JSON.parse(stored);
      setOption(o);
      setConfidence(c);
      setSubmitted(true);
    }
  }, [id]);

  const fetchAggregate = useCallback(() => {
    fetch(`${API}/api/aggregate/confidence/${id}`)
      .then((r) => r.json())
      .then(setAggregate)
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    if (!submitted) return;
    fetchAggregate();
    const interval = setInterval(fetchAggregate, 3000);
    return () => clearInterval(interval);
  }, [submitted, fetchAggregate]);

  const submit = async () => {
    if (option === null || confidence === null) return;
    const res = await fetch(`${API}/api/response/confidence/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ option, confidence, token }),
    });
    if (res.ok) {
      localStorage.setItem(`confidence-value-${id}`, JSON.stringify({ option, confidence }));
      setSubmitted(true);
      setEditing(false);
    }
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

  const locked = submitted && !editing;
  const confidenceLevels = Array.from({ length: config.confidence_points }, (_, i) => i + 1);

  return (
    <div className="wrap">
      <h1>{config.question}</h1>

      <div className="options">
        {config.options.map((opt) => (
          <button
            key={opt}
            type="button"
            className={`option${option === opt ? " selected" : ""}`}
            onClick={() => !locked && setOption(opt)}
            disabled={locked}
            aria-pressed={option === opt}
          >
            {opt}
          </button>
        ))}
      </div>

      <div className="scale">
        <div className="anchors-top">
          <span>Not at all confident</span>
          <span>Extremely confident</span>
        </div>
        <div className="points">
          {confidenceLevels.map((n) => (
            <button
              key={n}
              type="button"
              className={`point${confidence === n ? " selected" : ""}`}
              onClick={() => !locked && setConfidence(n)}
              disabled={locked}
              aria-pressed={confidence === n}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {locked ? (
        <>
          <div className="confirmation">
            <p className="muted">Thanks — your response has been recorded.</p>
            {aggregate?.revealed ? (
              <Heatmap
                options={config.options}
                confidencePoints={config.confidence_points}
                matrix={aggregate.matrix}
                correctOption={config.correct_option}
              />
            ) : (
              <p className="muted">
                Results will appear once enough of the class has responded.
              </p>
            )}
          </div>
          <button type="button" className="change-mind" onClick={() => setEditing(true)}>
            Change your mind?
          </button>
        </>
      ) : (
        <button
          className="submit"
          disabled={option === null || confidence === null}
          onClick={submit}
        >
          {submitted ? "Update response" : "Submit"}
        </button>
      )}
    </div>
  );
}
