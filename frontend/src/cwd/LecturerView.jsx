import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  closeSession,
  loadLecturer,
  openSocialFinalResponse,
  rememberLecturerKey,
  revealSocial,
  startSession,
  storedLecturerKey,
} from "./api.js";
import CwdField from "./CwdField.jsx";
import { confidencePoints, diagnosticItems, diagnosticScale, socialOptions } from "./model.js";
import { profileProps } from "./visual-profile.js";

function errorText(error) {
  if (error instanceof ApiError && error.status === 401) return "That key was not accepted.";
  return error?.message || "Something went wrong.";
}

function KeyGate({ onContinue, error }) {
  const [value, setValue] = useState(storedLecturerKey());
  return (
    <main {...profileProps()} className="cwd-lecturer cwd-lecturer--gate">
      <div className="cwd-control-card">
        <p className="cwd-kicker">Live control</p>
        <h1>Enter the facilitator key</h1>
        <p className="cwd-lead">The key is kept only for this browser session.</p>
        <input
          className="cwd-key-input"
          type="password"
          autoComplete="current-password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && value) onContinue(value);
          }}
          aria-label="Facilitator key"
        />
        {error && <p className="cwd-error">{error}</p>}
        <button type="button" className="cwd-primary-action" disabled={!value} onClick={() => onContinue(value)}>
          Continue
        </button>
      </div>
    </main>
  );
}

function ControlHeader({ activity, session, children }) {
  return (
    <header className="cwd-control-header">
      <div>
        <p className="cwd-kicker">Live control</p>
        <h1>{activity.config?.judgement?.prompt || activity.title}</h1>
      </div>
      <div className={`cwd-live-chip ${session?.closed ? "is-closed" : ""}`}>
        <span aria-hidden="true" />
        {session?.closed ? "Session ended" : session ? "Session open" : "Not started"}
      </div>
      {children}
    </header>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="cwd-control-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  );
}

function SocialLecturer({ activity, session, data, lecturerKey, onRefresh, onSessionChange }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const revealed = Boolean(data?.revealed);
  const cohort = data?.cohort || null;
  const distribution = cohort?.judgement_distribution || [];
  const dominant = [...distribution].sort((a, b) => b.count - a.count)[0] || null;
  const points = confidencePoints(activity);

  const act = async (name, fn) => {
    setBusy(name);
    setError("");
    try {
      const result = await fn();
      if (result?.id) onSessionChange(result);
      await onRefresh();
    } catch (actionError) {
      setError(errorText(actionError));
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      <div className="cwd-control-toolbar">
        <a className="cwd-control-button" href={`#/display/${activity.id}`} target="_blank" rel="noreferrer">
          Open presentation ↗
        </a>
        {!revealed && (
          <button
            type="button"
            className="cwd-control-button cwd-control-button--primary"
            disabled={Boolean(busy)}
            onClick={() => act("reveal", () => revealSocial(session.id, lecturerKey))}
          >
            {busy === "reveal" ? "Showing…" : "Show group responses"}
          </button>
        )}
        {revealed &&
          activity.config.resolution?.release === "lecturer_controlled" &&
          !data?.resolution_available && (
            <button
              type="button"
              className="cwd-control-button cwd-control-button--primary"
              disabled={Boolean(busy)}
              onClick={() => act("open-final", () => openSocialFinalResponse(session.id, lecturerKey))}
            >
              {busy === "open-final" ? "Opening…" : "Open final response"}
            </button>
          )}
        <button
          type="button"
          className="cwd-control-button cwd-control-button--danger"
          disabled={Boolean(busy)}
          onClick={() => {
            if (window.confirm("End this live session?")) {
              act("close", () => closeSession(activity, session.id, lecturerKey));
            }
          }}
        >
          End session
        </button>
      </div>

      {error && <p className="cwd-error">{error}</p>}

      <div className="cwd-control-layout">
        <section className="cwd-control-main">
          {!revealed ? (
            <>
              <div className="cwd-section-heading">
                <div>
                  <p className="cwd-kicker">Responses arriving</p>
                  <h2>Responses remain hidden</h2>
                  <p>You can monitor participation without seeing how people have answered.</p>
                </div>
                <span className="cwd-count-chip">{data?.live_total ?? 0} responses</span>
              </div>
              <CwdField
                activity={activity}
                hidden
                showPersonal={false}
                className="cwd-field--lecturer"
                ariaLabel="Responses remain hidden"
              />
            </>
          ) : (
            <>
              <div className="cwd-section-heading">
                <div>
                  <p className="cwd-kicker">Group responses</p>
                  <h2>Answers and confidence are now visible</h2>
                  <p>Use the response pattern to decide what is worth drawing attention to.</p>
                </div>
                <span className="cwd-count-chip">{cohort?.total ?? 0} responses</span>
              </div>
              <CwdField
                activity={activity}
                cohort={cohort}
                showPersonal={false}
                className="cwd-field--lecturer"
                ariaLabel="Group response pattern"
              />
            </>
          )}
        </section>

        <aside className="cwd-control-side">
          <Stat label="Responses" value={data?.live_total ?? cohort?.total ?? 0} />
          <Stat label="Current view" value={revealed ? "Shown" : "Hidden"} />
          {revealed && (
            <>
              <Stat
                label="Most selected"
                value={dominant?.label || "—"}
                sub={dominant?.pct == null ? "" : `${Math.round(dominant.pct)}%`}
              />
              <Stat
                label="Average confidence"
                value={
                  cohort?.overall_confidence == null
                    ? "—"
                    : `${Number(cohort.overall_confidence).toFixed(1)} / ${points.length || "—"}`
                }
              />
              <Stat label="Answers used" value={`${cohort?.occupied_options ?? 0} of ${socialOptions(activity).length}`} />
              {(cohort?.signals || []).length > 0 && (
                <div className="cwd-control-insight">
                  <span>Useful pattern</span>
                  {(cohort.signals || []).map((signal) => <p key={signal}>{signal}</p>)}
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </>
  );
}

function SelfAuditLecturer({ activity, session, data, lecturerKey, onRefresh, onSessionChange }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const diagnostic = data?.diagnostic;
  const items = diagnosticItems(activity);
  const scale = diagnosticScale(activity);

  const end = async () => {
    if (!window.confirm("End this live session?")) return;
    setBusy("close");
    setError("");
    try {
      const result = await closeSession(activity, session.id, lecturerKey);
      onSessionChange(result);
      await onRefresh();
    } catch (actionError) {
      setError(errorText(actionError));
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      <div className="cwd-control-toolbar">
        <button type="button" className="cwd-control-button cwd-control-button--danger" disabled={Boolean(busy)} onClick={end}>
          End session
        </button>
      </div>
      {error && <p className="cwd-error">{error}</p>}

      <div className="cwd-control-layout">
        <section className="cwd-control-main">
          <div className="cwd-section-heading">
            <div>
              <p className="cwd-kicker">Current check-in</p>
              <h2>Where does the group need consolidation?</h2>
              <p>This view is aggregate only. Individual profiles are not shown.</p>
            </div>
            <span className="cwd-count-chip">{diagnostic?.total_profiles ?? 0} responses</span>
          </div>

          <div className="cwd-diagnostic-board">
            {items.map((item) => {
              const stats = diagnostic?.items?.[item.id];
              const maxCount = Math.max(1, ...(scale.map((point) => stats?.ratings?.[String(point.value)] || 0)));
              return (
                <article className="cwd-diagnostic-row" key={item.id}>
                  <div className="cwd-diagnostic-row-head">
                    <strong>{item.label}</strong>
                    <span>{stats?.targeted ?? 0} chose this to revisit</span>
                  </div>
                  <div className="cwd-diagnostic-bars">
                    {scale.map((point) => {
                      const count = stats?.ratings?.[String(point.value)] || 0;
                      return (
                        <div key={point.value} className="cwd-diagnostic-bar">
                          <span style={{ height: `${Math.max(5, (count / maxCount) * 100)}%` }} />
                          <strong>{count}</strong>
                          <small>{point.value}</small>
                        </div>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <aside className="cwd-control-side">
          <Stat label="Responses" value={diagnostic?.total_profiles ?? 0} />
          <Stat label="Format" value="Individual check-in" />
          <div className="cwd-control-insight">
            <span>Presentation</span>
            <p>This activity does not project individual or aggregate diagnostic results to the room.</p>
          </div>
        </aside>
      </div>
    </>
  );
}

export default function LecturerView({ activity, initialSession }) {
  const [lecturerKey, setLecturerKey] = useState(storedLecturerKey());
  const [keyError, setKeyError] = useState("");
  const [session, setSession] = useState(initialSession);
  const [data, setData] = useState(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!lecturerKey || !session?.id || session.closed) return;
    try {
      const next = await loadLecturer(activity, session.id, lecturerKey);
      setData(next);
      setSession((current) => ({ ...current, ...next }));
      setKeyError("");
    } catch (refreshError) {
      if (refreshError instanceof ApiError && refreshError.status === 401) {
        rememberLecturerKey("");
        setLecturerKey("");
        setKeyError("That key was not accepted.");
      } else if (refreshError instanceof ApiError && refreshError.status === 404) {
        setSession(null);
        setData(null);
      } else {
        setError(errorText(refreshError));
      }
    }
  }, [activity, lecturerKey, session?.id, session?.closed]);

  useEffect(() => {
    if (!lecturerKey || !session?.id || session.closed) return undefined;
    refresh();
    const timer = setInterval(refresh, 1800);
    return () => clearInterval(timer);
  }, [lecturerKey, session?.id, session?.closed, refresh]);

  const acceptKey = (value) => {
    rememberLecturerKey(value);
    setLecturerKey(value);
    setKeyError("");
  };

  const begin = async () => {
    setStarting(true);
    setError("");
    try {
      const result = await startSession(activity, lecturerKey);
      setSession(result);
      setData(null);
    } catch (startError) {
      if (startError instanceof ApiError && startError.status === 401) {
        rememberLecturerKey("");
        setLecturerKey("");
        setKeyError("That key was not accepted.");
      } else {
        setError(errorText(startError));
      }
    } finally {
      setStarting(false);
    }
  };

  if (!lecturerKey) return <KeyGate onContinue={acceptKey} error={keyError} />;

  return (
    <main {...profileProps()} className="cwd-lecturer">
      <ControlHeader activity={activity} session={session} />

      {!session || session.closed ? (
        <section className="cwd-control-empty">
          <div className="cwd-waiting-orb" aria-hidden="true" />
          <h2>{session?.closed ? "This session has ended." : "Ready when you are."}</h2>
          <p>Start a new session when the group is ready.</p>
          {error && <p className="cwd-error">{error}</p>}
          <button type="button" className="cwd-primary-action" disabled={starting} onClick={begin}>
            {starting ? "Starting…" : "Start session"}
          </button>
        </section>
      ) : activity.variant === "self_audit" ? (
        <SelfAuditLecturer
          activity={activity}
          session={session}
          data={data}
          lecturerKey={lecturerKey}
          onRefresh={refresh}
          onSessionChange={setSession}
        />
      ) : (
        <SocialLecturer
          activity={activity}
          session={session}
          data={data}
          lecturerKey={lecturerKey}
          onRefresh={refresh}
          onSessionChange={setSession}
        />
      )}
    </main>
  );
}
