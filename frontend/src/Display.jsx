import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError, loadActivity, loadOpenSession } from "./cwd/api.js";
import PresentationView from "./cwd/PresentationView.jsx";
import { profileProps } from "./cwd/visual-profile.js";

export default function Display() {
  const { id } = useParams();
  const [activity, setActivity] = useState(null);
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState("loading");

  const load = useCallback(async () => {
    try {
      const nextActivity = activity || (await loadActivity(id));
      if (!activity) setActivity(nextActivity);
      try {
        const nextSession = await loadOpenSession(nextActivity);
        setSession(nextSession);
        setStatus("ready");
      } catch (sessionError) {
        if (sessionError instanceof ApiError && sessionError.status === 404) {
          setSession(null);
          setStatus("waiting");
          return;
        }
        throw sessionError;
      }
    } catch {
      setStatus("unavailable");
    }
  }, [activity, id]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 2500);
    return () => clearInterval(timer);
  }, [load]);

  if (status === "loading") return <Stage><p className="cwd-kicker">Loading…</p></Stage>;
  if (status === "unavailable") return <Stage><h1>This activity isn’t available yet.</h1></Stage>;
  if (status === "waiting" || !session) {
    return (
      <Stage>
        <div className="cwd-presentation-orb" aria-hidden="true" />
        <p className="cwd-kicker">Ready when you are</p>
        <h1>Waiting to begin.</h1>
      </Stage>
    );
  }

  return <PresentationView activity={activity} initialSession={session} />;
}

function Stage({ children }) {
  return <main {...profileProps()} className="cwd-presentation cwd-presentation--centred">{children}</main>;
}
