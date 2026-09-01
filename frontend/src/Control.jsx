import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError, loadActivity, loadOpenSession } from "./cwd/api.js";
import LecturerView from "./cwd/LecturerView.jsx";
import { profileProps } from "./cwd/visual-profile.js";

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
        try {
          const nextSession = await loadOpenSession(nextActivity);
          if (!cancelled) setSession(nextSession);
        } catch (sessionError) {
          if (!(sessionError instanceof ApiError) || sessionError.status !== 404) throw sessionError;
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError.message);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (error) return <main {...profileProps()} className="cwd-lecturer cwd-lecturer--gate"><p className="cwd-error">{error}</p></main>;
  if (!activity) return <main {...profileProps()} className="cwd-lecturer cwd-lecturer--gate"><p className="cwd-kicker">Loading…</p></main>;

  return <LecturerView activity={activity} initialSession={session} />;
}
