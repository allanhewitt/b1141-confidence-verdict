import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError, loadActivity, loadOpenSession } from "./cwd/api.js";
import SocialStudent from "./cwd/SocialStudent.jsx";
import SelfAuditStudent from "./cwd/SelfAuditStudent.jsx";
import { profileProps } from "./cwd/visual-profile.js";

export default function Respond() {
  const { id } = useParams();
  const [activity, setActivity] = useState(null);
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

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
          setStatus("waiting");
          return;
        }
        throw sessionError;
      }
    } catch (loadError) {
      if (loadError instanceof ApiError && (loadError.status === 404 || loadError.status === 410)) {
        setStatus("unavailable");
        return;
      }
      setError(loadError.message);
      setStatus("error");
    }
  }, [activity, id]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 2500);
    return () => clearInterval(timer);
  }, [load]);

  if (status === "loading") return <Shell><p className="cwd-kicker">Loading…</p></Shell>;
  if (status === "unavailable") return <Shell><h1>This activity isn’t available yet.</h1></Shell>;
  if (status === "error") return <Shell><p className="cwd-error">{error}</p></Shell>;
  if (status === "waiting" || !session) {
    return (
      <Shell>
        <div className="cwd-waiting-orb" aria-hidden="true" />
        <p className="cwd-kicker">Ready when the group is</p>
        <h1>This activity will begin shortly.</h1>
      </Shell>
    );
  }

  return activity.variant === "self_audit"
    ? <SelfAuditStudent activity={activity} initialSession={session} />
    : <SocialStudent activity={activity} initialSession={session} />;
}

function Shell({ children }) {
  return <main {...profileProps()} className="cwd-student cwd-student--centred">{children}</main>;
}
