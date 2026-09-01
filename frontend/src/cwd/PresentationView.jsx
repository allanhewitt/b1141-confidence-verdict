import { useCallback, useEffect, useState } from "react";
import { loadAggregate, loadSessionState } from "./api.js";
import CwdField from "./CwdField.jsx";
import { profileProps } from "./visual-profile.js";

export default function PresentationView({ activity, initialSession }) {
  const [session, setSession] = useState(initialSession);
  const [aggregate, setAggregate] = useState(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!initialSession?.id) return;
    try {
      const state = await loadSessionState(activity, initialSession.id);
      setSession(state);
      if (activity.variant !== "self_audit") {
        const nextAggregate = await loadAggregate(activity, initialSession.id);
        setAggregate(nextAggregate);
      }
    } catch (refreshError) {
      setError(refreshError.message);
    }
  }, [activity, initialSession?.id]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 1800);
    return () => clearInterval(timer);
  }, [refresh]);

  if (error) {
    return (
      <main {...profileProps()} className="cwd-presentation cwd-presentation--centred">
        <h1>Waiting to reconnect…</h1>
      </main>
    );
  }

  if (activity.variant === "self_audit") {
    return (
      <main {...profileProps()} className="cwd-presentation cwd-presentation--centred">
        <div className="cwd-presentation-orb" aria-hidden="true" />
        <p className="cwd-kicker">Take a moment</p>
        <h1>{activity.config.judgement.prompt}</h1>
        <p className="cwd-presentation-lead">Work through this on your own device.</p>
      </main>
    );
  }

  if (session?.closed) {
    return (
      <main {...profileProps()} className="cwd-presentation cwd-presentation--centred">
        <div className="cwd-presentation-orb" aria-hidden="true" />
        <p className="cwd-kicker">Finished</p>
        <h1>Thanks for taking part.</h1>
      </main>
    );
  }

  if (!session?.revealed) {
    return (
      <main {...profileProps()} className="cwd-presentation">
        <div className="cwd-presentation-grid" aria-hidden="true" />
        <div className="cwd-presentation-collecting">
          <section>
            <p className="cwd-kicker">What do you think?</p>
            <h1>{activity.config.judgement.prompt}</h1>
            {activity.config.entry?.text && <p className="cwd-presentation-lead">{activity.config.entry.text}</p>}
          </section>
          <section className="cwd-presentation-count">
            <div className="cwd-presentation-rings" aria-hidden="true">
              <span />
              <span />
              <span />
              <i />
            </div>
            <p>Responses are coming in.</p>
          </section>
        </div>
      </main>
    );
  }

  if (activity.variant === "social_delayed" && session?.resolution_available) {
    return (
      <main {...profileProps()} className="cwd-presentation cwd-presentation--centred">
        <div className="cwd-presentation-orb" aria-hidden="true" />
        <p className="cwd-kicker">One last look</p>
        <h1>What changed — if anything?</h1>
        <p className="cwd-presentation-lead">Think again about both your answer and how sure you are.</p>
      </main>
    );
  }

  const cohort = aggregate?.cohort;
  return (
    <main {...profileProps()} className="cwd-presentation cwd-presentation--reveal">
      <div className="cwd-presentation-grid" aria-hidden="true" />
      <header className="cwd-presentation-header">
        <div>
          <p className="cwd-kicker">How did the group respond?</p>
          <h1>Here’s what the group said.</h1>
        </div>
        <span>{cohort?.total ?? 0} responses</span>
      </header>
      <CwdField
        activity={activity}
        cohort={cohort}
        showPersonal={false}
        className="cwd-field--presentation"
        ariaLabel="Group response pattern"
      />
      <div className="cwd-presentation-prompt">
        Look for where responses <strong>agree</strong>, where they <strong>differ</strong>, and how <strong>sure</strong> people seem.
      </div>
    </main>
  );
}
