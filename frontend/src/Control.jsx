import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError, loadActivity, loadOpenSession } from "./cwd/api.js";
import LecturerView from "./cwd/LecturerView.jsx";
import { profileProps } from "./cwd/visual-profile.js";

const SESSION_POLL_MS = 1500;

export default function Control() {
  const { id } = useParams();
  const [activity, setActivity] = useState(null);
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const nextActivity = await loadActivity(id);
        if (cancelled) return;
        setActivity(nextActivity);
        setError("");
      } catch (loadError) {
        if (!cancelled) setError(loadError.message);
      }
    })();

    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (!activity) return undefined;

    let cancelled = false;

    const resolveCurrentSession = async () => {
      try {
        const nextSession = await loadOpenSession(activity);
        if (!cancelled) {
          setSession(nextSession);
          setError("");
        }
      } catch (sessionError) {
        if (sessionError instanceof ApiError && sessionError.status === 404) {
          if (!cancelled) setSession(null);
          return;
        }
        if (!cancelled) setError(sessionError.message);
      }
    };

    resolveCurrentSession();
    const timer = window.setInterval(resolveCurrentSession, SESSION_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activity]);

  if (error) return <main {...profileProps()} className="cwd-lecturer cwd-lecturer--gate"><p className="cwd-error">{error}</p></main>;
  if (!activity) return <main {...profileProps()} className="cwd-lecturer cwd-lecturer--gate"><p className="cwd-kicker">Loading…</p></main>;

  if (!session) {
    return (
      <main {...profileProps()} className="cwd-lecturer">
        <header className="cwd-control-header">
          <div>
            <p className="cwd-kicker">Live control</p>
            <h1>{activity.config?.judgement?.prompt || activity.title}</h1>
          </div>
          <div className="cwd-live-chip">
            <span aria-hidden="true" />
            Waiting for scheduled run
          </div>
        </header>
        <section className="cwd-control-empty">
          <div className="cwd-waiting-orb" aria-hidden="true" />
          <h2>Waiting for the scheduled activity.</h2>
          <p>This view will connect automatically when the activity's CRUD availability window opens.</p>
        </section>
      </main>
    );
  }

  return (
    <LecturerView
      key={session.id}
      activity={activity}
      initialSession={session}
    />
  );
}
