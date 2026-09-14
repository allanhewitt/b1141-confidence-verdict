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

  return (
    <LecturerView
      key={session?.id || "no-current-session"}
      activity={activity}
      initialSession={session}
    />
  );
}
