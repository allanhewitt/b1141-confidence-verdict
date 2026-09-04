import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  auditGuidanceReached,
  loadPersonal,
  loadSessionState,
  participantToken,
  selectAuditTarget,
  submitAuditProfile,
  submitAuditRerating,
} from "./api.js";
import {
  diagnosticItem,
  diagnosticItems,
  diagnosticScale,
  diagnosticStage,
  diagnosticTargetCandidates,
  ratingLabel,
} from "./model.js";
import { StudentShell } from "./SocialStudent.jsx";

function ErrorMessage({ error }) {
  return error ? <p className="cwd-error" role="alert">{error}</p> : null;
}

function RatingButtons({ activity, value, onChange, name }) {
  return (
    <div className="cwd-audit-rating" role="group" aria-label={name}>
      {diagnosticScale(activity).map((point) => (
        <button
          key={point.value}
          type="button"
          className={value === point.value ? "is-selected" : ""}
          onClick={() => onChange(point.value)}
          aria-pressed={value === point.value}
        >
          <strong>{point.value}</strong>
          <span>{point.label}</span>
        </button>
      ))}
    </div>
  );
}

export default function SelfAuditStudent({ activity, initialSession }) {
  const token = useMemo(() => participantToken(activity.id, initialSession.id), [activity.id, initialSession.id]);
  const [session, setSession] = useState(initialSession);
  const [personal, setPersonal] = useState(null);
  const [ratings, setRatings] = useState({});
  const [rerating, setRerating] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const state = await loadSessionState(activity, initialSession.id);
      setSession(state);
      try {
        const mine = await loadPersonal(activity, initialSession.id, token);
        setPersonal(mine);
        if (mine?.profile) setRatings(mine.profile);
        if (mine?.target_id && Number.isInteger(mine?.profile?.[mine.target_id]) && rerating == null) {
          setRerating(mine.profile[mine.target_id]);
        }
      } catch (personalError) {
        if (!(personalError instanceof ApiError) || personalError.status !== 404) throw personalError;
      }
    } catch (refreshError) {
      setError(refreshError.message);
    }
  }, [activity, initialSession.id, token, rerating]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 2500);
    return () => clearInterval(timer);
  }, [refresh]);

  const items = diagnosticItems(activity);
  const allRated = items.every((item) => Number.isInteger(ratings[item.id]));
  const stage = diagnosticStage(personal);

  const saveProfile = async () => {
    if (!allRated) return;
    setBusy(true);
    setError("");
    try {
      await submitAuditProfile(initialSession.id, token, ratings);
      await refresh();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  };

  const chooseTarget = async (itemId) => {
    setBusy(true);
    setError("");
    try {
      await selectAuditTarget(initialSession.id, token, itemId);
      await refresh();
    } catch (targetError) {
      setError(targetError.message);
    } finally {
      setBusy(false);
    }
  };

  const finishGuidance = async () => {
    setBusy(true);
    setError("");
    try {
      await auditGuidanceReached(initialSession.id, token);
      await refresh();
    } catch (progressError) {
      setError(progressError.message);
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (!Number.isInteger(rerating)) return;
    setBusy(true);
    setError("");
    try {
      await submitAuditRerating(initialSession.id, token, rerating);
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

  if (stage === "complete") {
    const target = diagnosticItem(activity, personal.target_id);
    const original = personal.profile?.[personal.target_id];
    const finalValue = personal.final_profile?.[personal.target_id];
    return (
      <StudentShell>
        <div className="cwd-complete-orb" aria-hidden="true" />
        <p className="cwd-kicker">Finished</p>
        <h1>That’s it.</h1>
        {target && (
          <div className="cwd-audit-finish">
            <span>{target.label}</span>
            <strong>{ratingLabel(activity, original)} → {ratingLabel(activity, finalValue)}</strong>
          </div>
        )}
      </StudentShell>
    );
  }

  if (stage === "profile") {
    return (
      <StudentShell wide>
        <p className="cwd-kicker">Where are you now?</p>
        {activity.config.entry?.text && <p className="cwd-entry">{activity.config.entry.text}</p>}
        <h1>{activity.config.judgement.prompt}</h1>
        <div className="cwd-audit-grid">
          {items.map((item) => (
            <section className="cwd-audit-item" key={item.id}>
              <h2>{item.label}</h2>
              <RatingButtons
                activity={activity}
                value={ratings[item.id]}
                onChange={(value) => setRatings((current) => ({ ...current, [item.id]: value }))}
                name={item.label}
              />
            </section>
          ))}
        </div>
        <ErrorMessage error={error} />
        <button
          type="button"
          className="cwd-primary-action cwd-action-centred"
          disabled={!allRated || busy}
          onClick={saveProfile}
        >
          {busy ? "Saving…" : "That’s my check-in"}
        </button>
      </StudentShell>
    );
  }

  if (stage === "target") {
    const candidates = diagnosticTargetCandidates(activity, personal);
    return (
      <StudentShell>
        <p className="cwd-kicker">Choose where to look next</p>
        <h1>{candidates.length > 1 ? "These are your lowest-rated areas." : "This is your lowest-rated area."}</h1>
        <p className="cwd-lead">
          {candidates.length > 1
            ? "Pick one to look at more closely."
            : "Take a closer look before you rate yourself again."}
        </p>
        <div className="cwd-target-options">
          {candidates.map((item) => (
            <button key={item.id} type="button" disabled={busy} onClick={() => chooseTarget(item.id)}>
              <strong>{item.label}</strong>
              <span>{ratingLabel(activity, personal.profile[item.id])}</span>
            </button>
          ))}
        </div>
        <ErrorMessage error={error} />
      </StudentShell>
    );
  }

  if (stage === "guidance") {
    const target = diagnosticItem(activity, personal.target_id);
    return (
      <StudentShell>
        <p className="cwd-kicker">Take another look</p>
        <h1>{target?.label}</h1>
        <div className="cwd-guidance-card cwd-guidance-card--large">
          <p>{personal.guidance?.text}</p>
        </div>
        <ErrorMessage error={error} />
        <button type="button" className="cwd-primary-action" disabled={busy} onClick={finishGuidance}>
          {busy ? "Saving…" : "Rate yourself again"}
        </button>
      </StudentShell>
    );
  }

  const target = diagnosticItem(activity, personal.target_id);
  const original = personal.profile?.[personal.target_id];

  return (
    <StudentShell>
      <p className="cwd-kicker">One last check</p>
      <h1>{activity.config.resolution.prompt}</h1>
      <div className="cwd-original-rating">
        <span>Your first answer</span>
        <strong>{ratingLabel(activity, original)}</strong>
      </div>
      <RatingButtons
        activity={activity}
        value={rerating}
        onChange={setRerating}
        name={`Rate ${target?.label || "this area"} again`}
      />
      <ErrorMessage error={error} />
      <button type="button" className="cwd-primary-action" disabled={!Number.isInteger(rerating) || busy} onClick={finish}>
        {busy ? "Saving…" : "Finish"}
      </button>
    </StudentShell>
  );
}
