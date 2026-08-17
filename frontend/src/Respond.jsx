import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Heatmap from "./Heatmap.jsx";

const API = import.meta.env.VITE_API_BASE || "http://localhost:4000";
const TOKEN_TTL_MS = 10 * 60 * 1000;

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

function currentActivityId() {
  const parts = (window.location.hash || "").split("/").filter(Boolean);
  return parts[parts.length - 1] || "unknown-activity";
}

function getToken() {
  const activityId = currentActivityId();
  const storageKey = `gedl:${activityId}:participant`;
  const now = Date.now();
  let stored = null;

  try {
    stored = JSON.parse(localStorage.getItem(storageKey));
  } catch {
    stored = null;
  }

  if (
    stored?.token &&
    Number.isFinite(stored.lastSeen) &&
    now - stored.lastSeen < TOKEN_TTL_MS
  ) {
    localStorage.setItem(storageKey, JSON.stringify({ token: stored.token, lastSeen: now }));
    return stored.token;
  }

  const token = generateId();
  localStorage.setItem(storageKey, JSON.stringify({ token, lastSeen: now }));
  localStorage.removeItem("confidence-token");
  localStorage.removeItem(`confidence-value-${activityId}`);
  return token;
}

function blankMatrix(options, points) {
  return Object.fromEntries(options.map((option) => [option, Array.from({ length: points }, () => 0)]));
}

export default function Respond() {
  const { id } = useParams();
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [option, setOption] = useState(null);
  const [confidence, setConfidence] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [editing, setEditing] = useState(false);
  const [aggregate, setAggregate] = useState(null);
  const [personal, setPersonal] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [token] = useState(getToken);

  useEffect(() => {
    fetch(`${API}/api/config/confidence/${id}`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            response.status === 404
              ? "This activity does not exist. Check the link you were given."
              : "This activity is not currently active."
          );
        }
        return response.json();
      })
      .then(setConfig)
      .catch((e) => setError(e.message));

    try {
      const stored = JSON.parse(localStorage.getItem(`confidence-value-${id}`));
      if (stored?.option && Number.isInteger(stored?.confidence)) {
        setOption(stored.option);
        setConfidence(stored.confidence);
        setSubmitted(true);
      }
    } catch {
      // Ignore malformed local state.
    }
  }, [id]);

  const fetchPersonal = useCallback(() => {
    return fetch(`${API}/api/personal/confidence/${id}?token=${encodeURIComponent(token)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data) setPersonal(data);
        return data;
      })
      .catch(() => null);
  }, [id, token]);

  const fetchAggregate = useCallback(() => {
    return fetch(`${API}/api/aggregate/confidence/${id}`)
      .then((response) => response.json())
      .then((data) => {
        setAggregate(data);
        if (data.revealed) fetchPersonal();
        return data;
      })
      .catch(() => null);
  }, [id, fetchPersonal]);

  useEffect(() => {
    if (!submitted) return;
    fetchAggregate();
    const interval = setInterval(fetchAggregate, 2500);
    return () => clearInterval(interval);
  }, [submitted, fetchAggregate]);

  const submit = async () => {
    if (option === null || confidence === null || submitting) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const response = await fetch(`${API}/api/response/confidence/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ option, confidence, token }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not record your position.");

      localStorage.setItem(
        `confidence-value-${id}`,
        JSON.stringify({ option, confidence })
      );
      setSubmitted(true);
      setEditing(false);
      await fetchAggregate();
      if (data.late) await fetchPersonal();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (error) return <div className="wrap"><p className="error">{error}</p></div>;
  if (!config) return <div className="wrap"><p className="muted">Loading…</p></div>;

  const confidenceLevels = Array.from({ length: config.confidence_points }, (_, index) => index + 1);
  const revealed = Boolean(aggregate?.revealed);
  const locked = submitted && !editing;

  if (submitted && revealed) {
    return (
      <RevealedLandscape
        config={config}
        aggregate={aggregate}
        personal={personal}
        option={option}
        confidence={confidence}
      />
    );
  }

  if (locked) {
    const marker = [{ option, confidence, label: "YOU", kind: "personal" }];
    return (
      <div className="wrap landscape-wrap">
        <div className="activity-kicker">B1141 · Week {config.week} · Your position</div>
        <h1>{config.question}</h1>

        <section className="position-card">
          <div className="section-heading">
            <div>
              <div className="eyebrow">Your judgement × confidence position</div>
              <h2>You have placed yourself here.</h2>
            </div>
          </div>
          <Heatmap
            options={config.options}
            confidencePoints={config.confidence_points}
            matrix={blankMatrix(config.options, config.confidence_points)}
            markers={marker}
            showCounts={false}
            showTotals={false}
            hiddenSpace
            ariaLabel="Your position in the hidden judgement and confidence space"
          />
          <div className="hidden-landscape-message">
            <strong>The rest of the landscape is hidden.</strong>
            <span>Will the class cluster around you, somewhere else, or spread across the space?</span>
          </div>
        </section>

        <p className="muted waiting-copy">{waitingMessage(config)}</p>
        <button type="button" className="change-mind" onClick={() => setEditing(true)}>
          Reposition before the reveal?
        </button>
      </div>
    );
  }

  return (
    <div className="wrap respond-wrap">
      <div className="activity-kicker">B1141 · Week {config.week}</div>
      <h1>{config.question}</h1>

      <VerdictPicker options={config.options} value={option} setValue={setOption} />
      <ConfidencePicker levels={confidenceLevels} value={confidence} setValue={setConfidence} />

      <p className="placement-copy">
        Your two choices place you at one point in a judgement × confidence space. The class landscape will remain hidden until reveal.
      </p>

      {actionError && <p className="error action-error">{actionError}</p>}
      <button
        className="submit"
        disabled={option === null || confidence === null || submitting}
        onClick={submit}
      >
        {submitting ? "Placing…" : submitted ? "Update my position" : "Place me in the landscape"}
      </button>
    </div>
  );
}

function RevealedLandscape({ config, aggregate, personal, option, confidence }) {
  const position = personal?.position || { option, confidence };
  const marker = [{ option: position.option, confidence: position.confidence, label: "YOU", kind: "personal" }];

  return (
    <div className="wrap landscape-wrap reveal-landscape-wrap">
      <div className="activity-kicker">B1141 · Week {config.week} · The landscape revealed</div>
      <h1>{config.question}</h1>

      <section className="position-card revealed-position-card">
        <div className="section-heading">
          <div>
            <div className="eyebrow">Your position in the room</div>
            <h2>The hidden space now has a social shape.</h2>
          </div>
          <div className="response-chip">{aggregate.total} in the reveal</div>
        </div>
        <Heatmap
          options={config.options}
          confidencePoints={config.confidence_points}
          matrix={aggregate.matrix}
          correctOption={config.correct_option}
          markers={marker}
          ariaLabel="Revealed class judgement and confidence landscape with your position marked"
        />
      </section>

      {!personal?.revealed ? (
        <p className="muted">Loading your position feedback…</p>
      ) : (
        <section className="personal-landscape-feedback">
          <div className="eyebrow">What is distinctive about your position?</div>
          <div className="feedback-grid">
            <FeedbackStat label="Your judgement" value={position.option} />
            <FeedbackStat label="Your confidence" value={`${position.confidence}/${config.confidence_points}`} />
            <FeedbackStat
              label="Same judgement"
              value={personal.peers_total ? `${Math.round(personal.same_option_pct)}%` : "—"}
              sub="of the rest of the class"
            />
            <FeedbackStat
              label="Exact same position"
              value={personal.same_cell_count ?? 0}
              sub="other students"
            />
          </div>
          <div className="interpretive-feedback">
            <p>{confidenceSentence(personal, config.confidence_points)}</p>
            <p>{cellSentence(personal)}</p>
          </div>
          <p className="social-evidence-note">
            This map describes the room; it does not determine which judgement is correct. Its value is in making agreement, uncertainty, confidence and disagreement visible.
          </p>
        </section>
      )}

      <section className="reflection-prompt-card">
        <div className="eyebrow">Look again</div>
        <h2>What kind of intellectual landscape has the class produced?</h2>
        <p>Look for clusters, empty regions, confident minorities, uncertain majorities and places where judgement is divided.</p>
      </section>
    </div>
  );
}

function VerdictPicker({ options, value, setValue }) {
  return (
    <section className="answer-section">
      <div className="answer-heading"><span>1</span><h2>What is your judgement?</h2></div>
      <div className="options">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            className={`option${value === opt ? " selected" : ""}`}
            onClick={() => setValue(opt)}
            aria-pressed={value === opt}
          >
            {opt}
          </button>
        ))}
      </div>
    </section>
  );
}

function ConfidencePicker({ levels, value, setValue }) {
  return (
    <section className="answer-section">
      <div className="answer-heading"><span>2</span><h2>How confident are you?</h2></div>
      <div className="scale">
        <div className="anchors-top">
          <span>Not at all confident</span>
          <span>Extremely confident</span>
        </div>
        <div className="points">
          {levels.map((level) => (
            <button
              key={level}
              type="button"
              className={`point${value === level ? " selected" : ""}`}
              onClick={() => setValue(level)}
              aria-pressed={value === level}
            >
              {level}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeedbackStat({ label, value, sub }) {
  return (
    <div className="feedback-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  );
}

function waitingMessage(config) {
  if (config.reveal_mode === "manual") return "Your lecturer will reveal the class landscape once everyone has committed.";
  if (config.reveal_mode === "threshold") return "The class landscape will reveal once enough people have committed.";
  return "The class landscape will reveal shortly.";
}

function confidenceSentence(personal, points) {
  const peerMean = personal.peer_same_option_mean_confidence;
  if (peerMean == null) {
    return "There are no other students with the same judgement, so there is no like-for-like confidence comparison.";
  }
  const difference = personal.position.confidence - peerMean;
  const mean = Number(peerMean).toFixed(1);
  if (difference >= 0.5) return `Among classmates who made the same judgement, average confidence was ${mean}/${points}; you were more confident than that group average.`;
  if (difference <= -0.5) return `Among classmates who made the same judgement, average confidence was ${mean}/${points}; you were less confident than that group average.`;
  return `Among classmates who made the same judgement, average confidence was ${mean}/${points}; your confidence was close to that group average.`;
}

function cellSentence(personal) {
  if (!personal.peers_total) return "There are not yet enough other positions for a meaningful spatial comparison.";
  if (personal.same_cell_count === 0) return "No one else occupied exactly the same judgement × confidence position as you.";
  if (personal.same_cell_count === 1) return "One other student occupied exactly the same judgement × confidence position as you.";
  return `${personal.same_cell_count} other students occupied exactly the same judgement × confidence position as you.`;
}
