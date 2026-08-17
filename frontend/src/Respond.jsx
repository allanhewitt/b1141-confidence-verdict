import { useCallback, useEffect, useMemo, useState } from "react";
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
  const [calibrationScope, setCalibrationScope] = useState(null);
  const [submitting, setSubmitting] = useState(false);
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
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setPersonal(data);
        return data;
      })
      .catch(() => null);
  }, [id, token]);

  const fetchAggregate = useCallback(() => {
    return fetch(`${API}/api/aggregate/confidence/${id}`)
      .then((r) => r.json())
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
    const interval = setInterval(fetchAggregate, 3000);
    return () => clearInterval(interval);
  }, [submitted, fetchAggregate]);

  const storeCurrent = (nextOption, nextConfidence) => {
    localStorage.setItem(
      `confidence-value-${id}`,
      JSON.stringify({ option: nextOption, confidence: nextConfidence })
    );
  };

  const submitInitial = async () => {
    if (option === null || confidence === null || submitting) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const res = await fetch(`${API}/api/response/confidence/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ option, confidence, token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not record your response.");
      storeCurrent(option, confidence);
      setSubmitted(true);
      setEditing(false);
      await fetchAggregate();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const submitCalibration = async (scope, nextOption, nextConfidence) => {
    if (submitting) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const res = await fetch(`${API}/api/response/confidence/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          option: nextOption,
          confidence: nextConfidence,
          token,
          scope,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not record your final response.");
      setOption(data.current.option);
      setConfidence(data.current.confidence);
      storeCurrent(data.current.option, data.current.confidence);
      setCalibrationScope(null);
      await Promise.all([fetchAggregate(), fetchPersonal()]);
    } catch (e) {
      setActionError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (error) return <div className="wrap"><p className="error">{error}</p></div>;
  if (!config) return <div className="wrap"><p className="muted">Loading…</p></div>;

  const confidenceLevels = Array.from({ length: config.confidence_points }, (_, i) => i + 1);
  const revealed = Boolean(aggregate?.revealed);

  if (revealed && submitted) {
    return (
      <RevealedExperience
        config={config}
        aggregate={aggregate}
        personal={personal}
        option={option}
        confidence={confidence}
        setOption={setOption}
        setConfidence={setConfidence}
        calibrationScope={calibrationScope}
        setCalibrationScope={setCalibrationScope}
        confidenceLevels={confidenceLevels}
        submitCalibration={submitCalibration}
        submitting={submitting}
        actionError={actionError}
      />
    );
  }

  const locked = submitted && !editing;
  const hiddenResultsMessage =
    config.reveal_mode === "manual"
      ? "The class picture will appear when your lecturer reveals it."
      : config.reveal_mode === "threshold"
      ? "The class picture will appear once enough of the room has committed."
      : "The class picture will appear shortly.";

  return (
    <div className="wrap respond-wrap">
      <div className="activity-kicker">B1141 · Week {config.week}</div>
      <h1>{config.question}</h1>

      <VerdictPicker
        options={config.options}
        value={option}
        setValue={setOption}
        disabled={locked}
      />
      <ConfidencePicker
        levels={confidenceLevels}
        value={confidence}
        setValue={setConfidence}
        disabled={locked}
      />

      {actionError && <p className="error action-error">{actionError}</p>}

      {locked ? (
        <>
          <div className="anticipation-card">
            <div className="commit-summary">
              <div><span>Your judgement</span><strong>{option}</strong></div>
              <div><span>Your confidence</span><strong>{confidence}/{config.confidence_points}</strong></div>
            </div>
            <div className="anticipation-copy">
              <strong>Locked in.</strong>
              <span>Where will your judgement and confidence sit within the room?</span>
            </div>
            <p className="muted">{hiddenResultsMessage}</p>
          </div>
          <button type="button" className="change-mind" onClick={() => setEditing(true)}>
            Change my answers before the reveal?
          </button>
        </>
      ) : (
        <button
          className="submit"
          disabled={option === null || confidence === null || submitting}
          onClick={submitInitial}
        >
          {submitting ? "Recording…" : submitted ? "Update my commitment" : "Lock in judgement + confidence"}
        </button>
      )}
    </div>
  );
}

function RevealedExperience({
  config,
  aggregate,
  personal,
  option,
  confidence,
  setOption,
  setConfidence,
  calibrationScope,
  setCalibrationScope,
  confidenceLevels,
  submitCalibration,
  submitting,
  actionError,
}) {
  if (!personal?.revealed) {
    return (
      <div className="wrap respond-wrap">
        <div className="activity-kicker">B1141 · Week {config.week}</div>
        <h1>{config.question}</h1>
        <p className="muted">Loading your class comparison…</p>
      </div>
    );
  }

  const initial = personal.initial;
  const current = personal.current || initial;
  const resolved = Boolean(personal.resolution);
  const peerMean = personal.peer_same_option_mean_confidence;
  const confidenceDifference = peerMean == null ? null : initial.confidence - peerMean;

  const markers = [{
    option: initial.option,
    confidence: initial.confidence,
    label: "YOU",
    kind: "personal",
  }];

  return (
    <div className="wrap reveal-wrap">
      <div className="activity-kicker">B1141 · Week {config.week} · The reveal</div>
      <h1>{config.question}</h1>

      <section className="personal-feedback-card">
        <div className="eyebrow">Your position at the reveal</div>
        <div className="personal-position">
          <div><span>Judgement</span><strong>{initial.option}</strong></div>
          <div><span>Confidence</span><strong>{initial.confidence}/{config.confidence_points}</strong></div>
        </div>
        <div className="personal-feedback-copy">
          <p>{peerComparisonSentence(personal)}</p>
          {confidenceDifference != null && <p>{confidenceComparisonSentence(confidenceDifference)}</p>}
        </div>
        <p className="social-evidence-note">
          Agreement is social information. It does not, by itself, tell you whether a judgement is correct.
        </p>
      </section>

      <section className="class-picture-section">
        <div className="section-heading">
          <div>
            <div className="eyebrow">Class picture at reveal</div>
            <h2>Where did everyone land?</h2>
          </div>
          <div className="response-chip">{aggregate.total} responses</div>
        </div>
        <Heatmap
          options={config.options}
          confidencePoints={config.confidence_points}
          matrix={aggregate.initial_matrix || aggregate.matrix}
          correctOption={config.correct_option}
          markers={markers}
          ariaLabel="Class responses at reveal, with your initial position marked"
        />
      </section>

      {actionError && <p className="error action-error">{actionError}</p>}

      {resolved ? (
        <ResolutionCard
          initial={initial}
          current={current}
          resolution={personal.resolution}
          confidencePoints={config.confidence_points}
        />
      ) : aggregate.complete ? (
        <section className="resolution-card">
          <div className="eyebrow">Activity complete</div>
          <h2>Your initial position remains your recorded position.</h2>
        </section>
      ) : calibrationScope ? (
        <CalibrationEditor
          config={config}
          scope={calibrationScope}
          option={option}
          confidence={confidence}
          setOption={setOption}
          setConfidence={setConfidence}
          confidenceLevels={confidenceLevels}
          initial={initial}
          submitting={submitting}
          onCancel={() => {
            setOption(initial.option);
            setConfidence(initial.confidence);
            setCalibrationScope(null);
          }}
          onSubmit={() => submitCalibration(calibrationScope, option, confidence)}
        />
      ) : (
        <CalibrationChoice
          submitting={submitting}
          onChoose={(scope) => {
            if (scope === "neither") {
              submitCalibration("neither", initial.option, initial.confidence);
              return;
            }
            setOption(initial.option);
            setConfidence(initial.confidence);
            setCalibrationScope(scope);
          }}
        />
      )}
    </div>
  );
}

function VerdictPicker({ options, value, setValue, disabled }) {
  return (
    <section className="answer-section">
      <div className="answer-heading"><span>1</span><h2>What is your judgement?</h2></div>
      <div className="options">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            className={`option${value === opt ? " selected" : ""}`}
            onClick={() => !disabled && setValue(opt)}
            disabled={disabled}
            aria-pressed={value === opt}
          >
            {opt}
          </button>
        ))}
      </div>
    </section>
  );
}

function ConfidencePicker({ levels, value, setValue, disabled }) {
  return (
    <section className="answer-section">
      <div className="answer-heading"><span>2</span><h2>How confident are you?</h2></div>
      <div className="scale">
        <div className="anchors-top">
          <span>Not at all confident</span>
          <span>Extremely confident</span>
        </div>
        <div className="points">
          {levels.map((n) => (
            <button
              key={n}
              type="button"
              className={`point${value === n ? " selected" : ""}`}
              onClick={() => !disabled && setValue(n)}
              disabled={disabled}
              aria-pressed={value === n}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function CalibrationChoice({ onChoose, submitting }) {
  const choices = [
    ["judgement", "Reconsider my judgement", "Keep confidence fixed; reopen the verdict."],
    ["confidence", "Reconsider my confidence", "Keep the verdict fixed; recalibrate certainty."],
    ["both", "Reconsider both", "Reopen both parts of the response."],
    ["neither", "Keep both as they are", "Explicitly retain the judgement and confidence you committed to."],
  ];

  return (
    <section className="calibration-section">
      <div className="eyebrow">Calibration</div>
      <h2>What, if anything, do you want to reconsider?</h2>
      <p className="muted">Changing is not the goal. The goal is to make a deliberate second judgement after seeing the room.</p>
      <div className="calibration-choices">
        {choices.map(([scope, title, description]) => (
          <button key={scope} disabled={submitting} onClick={() => onChoose(scope)}>
            <strong>{title}</strong>
            <span>{description}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function CalibrationEditor({
  config,
  scope,
  option,
  confidence,
  setOption,
  setConfidence,
  confidenceLevels,
  initial,
  submitting,
  onCancel,
  onSubmit,
}) {
  const judgementOpen = scope === "judgement" || scope === "both";
  const confidenceOpen = scope === "confidence" || scope === "both";

  return (
    <section className="calibration-section calibration-editor">
      <div className="eyebrow">Your final calibration</div>
      <h2>Reconsider, then lock in your final position.</h2>
      <div className="calibration-lock-note">
        {!judgementOpen && <span>Judgement locked at <strong>{initial.option}</strong></span>}
        {!confidenceOpen && <span>Confidence locked at <strong>{initial.confidence}/{config.confidence_points}</strong></span>}
      </div>

      <VerdictPicker
        options={config.options}
        value={option}
        setValue={setOption}
        disabled={!judgementOpen}
      />
      <ConfidencePicker
        levels={confidenceLevels}
        value={confidence}
        setValue={setConfidence}
        disabled={!confidenceOpen}
      />

      <div className="calibration-actions">
        <button className="submit" disabled={submitting} onClick={onSubmit}>
          {submitting ? "Recording…" : "Lock in final response"}
        </button>
        <button className="secondary-action" disabled={submitting} onClick={onCancel}>
          Choose a different reconsideration
        </button>
      </div>
    </section>
  );
}

function ResolutionCard({ initial, current, resolution, confidencePoints }) {
  const judgementChanged = initial.option !== current.option;
  const confidenceChanged = initial.confidence !== current.confidence;

  let summary = "You explicitly retained both your judgement and your confidence.";
  if (judgementChanged && confidenceChanged) summary = "You changed both your judgement and your confidence.";
  else if (judgementChanged) summary = "You changed your judgement while retaining your confidence.";
  else if (confidenceChanged) summary = "You retained your judgement but recalibrated your confidence.";
  else if (resolution.scope !== "neither") summary = "You reconsidered your response and chose to retain both parts.";

  return (
    <section className="resolution-card">
      <div className="eyebrow">Resolved</div>
      <h2>{summary}</h2>
      <div className="trajectory-grid">
        <div>
          <span>At reveal</span>
          <strong>{initial.option}</strong>
          <small>Confidence {initial.confidence}/{confidencePoints}</small>
        </div>
        <div className="trajectory-arrow">→</div>
        <div>
          <span>Final</span>
          <strong>{current.option}</strong>
          <small>Confidence {current.confidence}/{confidencePoints}</small>
        </div>
      </div>
      <p className="muted">Your final response is locked. Retaining an answer is as deliberate an outcome as changing it.</p>
    </section>
  );
}

function peerComparisonSentence(personal) {
  if (!personal.peers_total) return "There are not yet enough other responses for a peer comparison.";
  if (!personal.same_option_count) return "No one else in the class chose the same verdict at the reveal.";
  const pct = Math.round(personal.same_option_pct);
  const mean = Number(personal.peer_same_option_mean_confidence).toFixed(1);
  return `${pct}% of the rest of the class chose the same verdict. Among those classmates, average confidence was ${mean}/5.`;
}

function confidenceComparisonSentence(difference) {
  if (difference >= 0.5) return "You were more confident than the average classmate who made the same judgement.";
  if (difference <= -0.5) return "You were less confident than the average classmate who made the same judgement.";
  return "Your confidence was close to the average among classmates who made the same judgement.";
}
