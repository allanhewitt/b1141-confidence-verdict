import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  loadAggregate,
  loadPersonal,
  loadSessionState,
  participantToken,
  socialProgress,
  submitSocialResolution,
  submitSocialResponse,
} from "./api.js";
import CwdField from "./CwdField.jsx";
import {
  allowedFinalConfidenceValues,
  confidencePoints,
  needsRevisedOption,
  resolutionChoices,
  resolutionPayload,
  socialOptions,
} from "./model.js";
import { profileProps } from "./visual-profile.js";

function ErrorMessage({ error }) {
  if (!error) return null;
  return <p className="cwd-error" role="alert">{error}</p>;
}

function ConfidenceControl({ activity, value, onChange, allowedValues = null, label = "How sure are you?" }) {
  const points = confidencePoints(activity);
  const allowed = allowedValues ? new Set(allowedValues) : null;
  return (
    <section className="cwd-confidence">
      <div className="cwd-step-label">{label}</div>
      <div className="cwd-confidence-points" role="group" aria-label={label}>
        {points.map((point) => {
          const disabled = allowed ? !allowed.has(point.value) : false;
          return (
            <button
              key={point.value}
              type="button"
              disabled={disabled}
              className={value === point.value ? "is-selected" : ""}
              onClick={() => onChange(point.value)}
              aria-pressed={value === point.value}
              title={point.label}
            >
              <strong>{point.value}</strong>
              <span>{point.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function optionLabel(activity, optionId) {
  return socialOptions(activity).find((option) => option.id === optionId)?.label || optionId;
}

export default function SocialStudent({ activity, initialSession }) {
  const [session, setSession] = useState(initialSession);
  const token = useMemo(() => participantToken(activity.id, initialSession.id), [activity.id, initialSession.id]);
  const [personal, setPersonal] = useState(null);
  const [aggregate, setAggregate] = useState(null);
  const [optionId, setOptionId] = useState(null);
  const [confidence, setConfidence] = useState(null);
  const [editing, setEditing] = useState(false);
  const [revealAcknowledged, setRevealAcknowledged] = useState(false);
  const [resolutionState, setResolutionState] = useState(null);
  const [finalOptionId, setFinalOptionId] = useState(null);
  const [finalConfidence, setFinalConfidence] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const revealProgressSent = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [state, aggregateResult] = await Promise.all([
        loadSessionState(activity, initialSession.id),
        loadAggregate(activity, initialSession.id),
      ]);
      setSession(state);
      setAggregate(aggregateResult);
      try {
        const mine = await loadPersonal(activity, initialSession.id, token);
        setPersonal(mine);
        const pos = mine?.position;
        if (pos?.option_id) setOptionId(pos.option_id);
        if (Number.isInteger(pos?.confidence)) setConfidence(pos.confidence);
      } catch (personalError) {
        if (!(personalError instanceof ApiError) || personalError.status !== 404) throw personalError;
      }
    } catch (refreshError) {
      setError(refreshError.message);
    }
  }, [activity, initialSession.id, token]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 1800);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!session?.revealed || revealProgressSent.current || !personal?.position) return;
    revealProgressSent.current = true;
    socialProgress(initialSession.id, token, "reveal_encountered").catch(() => {
      revealProgressSent.current = false;
    });
  }, [session?.revealed, personal?.position, initialSession.id, token]);

  const saveResponse = async () => {
    if (!optionId || !Number.isInteger(confidence)) return;
    setBusy(true);
    setError("");
    try {
      await submitSocialResponse(initialSession.id, token, optionId, confidence);
      setEditing(false);
      await refresh();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  };

  const continueFromReveal = () => {
    setRevealAcknowledged(true);
  };

  const continueFromGuidance = async () => {
    setBusy(true);
    setError("");
    try {
      await socialProgress(initialSession.id, token, "guidance_reached");
      await refresh();
    } catch (progressError) {
      setError(progressError.message);
    } finally {
      setBusy(false);
    }
  };

  const submitResolution = async () => {
    const committed = personal?.position;
    if (!resolutionState || !committed) return;
    const revised = needsRevisedOption(resolutionState);
    if (revised && (!finalOptionId || finalOptionId === committed.option_id)) return;
    if (activity.config.confidence.enabled && !Number.isInteger(finalConfidence)) return;

    setBusy(true);
    setError("");
    try {
      await submitSocialResolution(
        initialSession.id,
        token,
        resolutionPayload({
          resolutionState,
          committedOptionId: committed.option_id,
          finalOptionId: revised ? finalOptionId : committed.option_id,
          finalConfidence,
        })
      );
      await refresh();
    } catch (resolutionError) {
      setError(resolutionError.message);
    } finally {
      setBusy(false);
    }
  };

  if (session?.closed && !personal?.completed) {
    return (
      <StudentShell>
        <div className="cwd-complete-orb" aria-hidden="true" />
        <p className="cwd-kicker">This activity has ended</p>
        <h1>Thanks for taking part.</h1>
      </StudentShell>
    );
  }

  if (personal?.completed) {
    return (
      <StudentShell>
        <div className="cwd-complete-orb" aria-hidden="true" />
        <p className="cwd-kicker">Finished</p>
        <h1>That’s it.</h1>
        <p className="cwd-lead">You’re finished with this activity.</p>
      </StudentShell>
    );
  }

  if (!personal?.position || editing) {
    return (
      <StudentShell>
        <p className="cwd-kicker">What do you think?</p>
        {activity.config.entry?.text && <p className="cwd-entry">{activity.config.entry.text}</p>}
        <h1>{activity.config.judgement.prompt}</h1>
        <CwdField
          activity={activity}
          selectedOptionId={optionId}
          confidence={confidence}
          interactive
          onSelect={setOptionId}
          showPersonal={Boolean(optionId && confidence)}
          ariaLabel="Choose the answer closest to your view"
        />
        <ConfidenceControl activity={activity} value={confidence} onChange={setConfidence} />
        <ErrorMessage error={error} />
        <button
          type="button"
          className="cwd-primary-action"
          disabled={!optionId || !Number.isInteger(confidence) || busy}
          onClick={saveResponse}
        >
          {busy ? "Saving…" : personal?.position ? "Save my change" : "That’s my answer"}
        </button>
      </StudentShell>
    );
  }

  if (!session?.revealed) {
    return (
      <StudentShell>
        <p className="cwd-kicker">Response saved</p>
        <h1>We’ll show the group responses shortly.</h1>
        <CwdField
          activity={activity}
          selectedOptionId={personal.position.option_id}
          confidence={personal.position.confidence}
          hidden
          ariaLabel="Your saved response"
        />
        <div className="cwd-saved-summary">
          <strong>{optionLabel(activity, personal.position.option_id)}</strong>
          <span>{confidencePoints(activity).find((point) => point.value === personal.position.confidence)?.label}</span>
        </div>
        <button type="button" className="cwd-secondary-action" onClick={() => setEditing(true)}>
          Change my response
        </button>
        <ErrorMessage error={error} />
      </StudentShell>
    );
  }

  if (!revealAcknowledged) {
    return (
      <StudentShell wide>
        <p className="cwd-kicker">How did the group respond?</p>
        <h1>Here’s what everyone said.</h1>
        <CwdField
          activity={activity}
          selectedOptionId={personal.position.option_id}
          confidence={personal.position.confidence}
          cohort={aggregate?.cohort}
          ariaLabel="Group responses with your response highlighted"
        />
        <p className="cwd-lead cwd-centred">
          Your response is highlighted. Look for where people agree, where they differ, and how sure they seem.
        </p>
        <button type="button" className="cwd-primary-action cwd-action-centred" onClick={continueFromReveal}>
          Keep going
        </button>
        <ErrorMessage error={error} />
      </StudentShell>
    );
  }

  const guidance = activity.config.guidance;
  if (guidance?.source === "in_app" && !personal?.guidance_reached) {
    return (
      <StudentShell>
        <p className="cwd-kicker">Something to think about</p>
        <div className="cwd-guidance-stack">
          {(guidance.content || []).map((block, index) => (
            <div className="cwd-guidance-card" key={`${block.type}-${index}`}>
              <p>{block.text}</p>
            </div>
          ))}
        </div>
        <ErrorMessage error={error} />
        <button type="button" className="cwd-primary-action" disabled={busy} onClick={continueFromGuidance}>
          {busy ? "Saving…" : "Think again"}
        </button>
      </StudentShell>
    );
  }

  if (!session?.resolution_available) {
    return (
      <StudentShell>
        <div className="cwd-waiting-orb" aria-hidden="true" />
        <p className="cwd-kicker">Stay with the group</p>
        <h1>There’s one more response to make.</h1>
        <p className="cwd-lead">It will appear here when it’s time.</p>
        <ErrorMessage error={error} />
      </StudentShell>
    );
  }

  const committed = personal.position;
  const choices = resolutionChoices(activity, committed.confidence);
  const revised = needsRevisedOption(resolutionState);
  const confidenceValues = resolutionState
    ? allowedFinalConfidenceValues(activity, resolutionState, committed.confidence)
    : [];
  const confidenceRequired = activity.config.confidence.enabled;

  return (
    <StudentShell>
      <p className="cwd-kicker">One last look</p>
      <h1>What changed — if anything?</h1>
      <p className="cwd-lead">Think again about your original answer and how sure you were.</p>

      <div className="cwd-resolution-options">
        {choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            disabled={choice.disabled}
            className={resolutionState === choice.id ? "is-selected" : ""}
            onClick={() => {
              setResolutionState(choice.id);
              setFinalOptionId(null);
              const allowed = allowedFinalConfidenceValues(activity, choice.id, committed.confidence);
              if (allowed.length === 1) setFinalConfidence(allowed[0]);
              else setFinalConfidence(committed.confidence);
            }}
            aria-pressed={resolutionState === choice.id}
          >
            {choice.label}
          </button>
        ))}
      </div>

      {revised && (
        <section className="cwd-revision-section">
          <div className="cwd-step-label">What would you choose now?</div>
          <div className="cwd-revision-options">
            {socialOptions(activity).map((option) => (
              <button
                key={option.id}
                type="button"
                disabled={option.id === committed.option_id}
                className={finalOptionId === option.id ? "is-selected" : ""}
                onClick={() => setFinalOptionId(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>
      )}

      {resolutionState && confidenceRequired && (
        <ConfidenceControl
          activity={activity}
          value={finalConfidence}
          onChange={setFinalConfidence}
          allowedValues={confidenceValues}
          label="How sure are you now?"
        />
      )}

      <ErrorMessage error={error} />
      <button
        type="button"
        className="cwd-primary-action"
        disabled={
          busy ||
          !resolutionState ||
          (revised && (!finalOptionId || finalOptionId === committed.option_id)) ||
          (confidenceRequired && !Number.isInteger(finalConfidence))
        }
        onClick={submitResolution}
      >
        {busy ? "Saving…" : "Finish"}
      </button>
    </StudentShell>
  );
}

export function StudentShell({ children, wide = false }) {
  return <main {...profileProps()} className={`cwd-student ${wide ? "cwd-student--wide" : ""}`}>{children}</main>;
}
