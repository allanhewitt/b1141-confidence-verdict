const BUTTON_ID = "cwd-restart-fresh-run";
const STATUS_ID = "cwd-restart-status";

function activityIdFromLocation() {
  const pathMatch = window.location.pathname.match(/^\/control\/([^/?#]+)/);
  if (pathMatch) return decodeURIComponent(pathMatch[1]);
  const hashMatch = window.location.hash.match(/^#\/control\/([^?]+)/);
  return hashMatch ? decodeURIComponent(hashMatch[1]) : null;
}

function lecturerKey() {
  return window.sessionStorage.getItem("gedl:cwd:lecturer-key") || "";
}

async function request(path, options = {}) {
  const response = await fetch(path, options);
  let payload = null;
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(payload?.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function statusNode(toolbar) {
  let node = document.getElementById(STATUS_ID);
  if (!node) {
    node = document.createElement("span");
    node.id = STATUS_ID;
    node.className = "cwd-restart-status";
    node.style.cssText = "align-self:center;color:var(--cwd-muted);font-size:.82rem;line-height:1.3;max-width:34rem";
    toolbar.appendChild(node);
  }
  return node;
}

async function restartFresh(button, toolbar) {
  const activityId = activityIdFromLocation();
  const key = lecturerKey();
  if (!activityId || !key) return;

  const confirmed = window.confirm(
    "Abandon this run and start a completely fresh one?\n\n" +
    "The current run and its responses will remain stored, but nothing will carry into the new run. " +
    "Students will need to return to the B1141 portal and open the activity again."
  );
  if (!confirmed) return;

  const status = statusNode(toolbar);
  button.disabled = true;
  button.textContent = "Starting fresh run…";
  status.textContent = "Closing the current run…";

  try {
    let current = null;
    try {
      current = await request(`/api/cwd/activities/${encodeURIComponent(activityId)}/session`);
    } catch (error) {
      if (error.status !== 404) throw error;
    }

    if (current?.id) {
      await request(`/api/cwd/sessions/${encodeURIComponent(current.id)}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-GEDL-Lecturer-Key": key },
        body: "{}",
      });
    }

    status.textContent = "Creating a fresh run…";
    const fresh = await request(`/api/cwd/activities/${encodeURIComponent(activityId)}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-GEDL-Lecturer-Key": key },
      body: "{}",
    });

    status.textContent = `Fresh run started${fresh?.id ? ` (${String(fresh.id).slice(0, 8)}…)` : ""}. Ask students to return to the portal and reopen the activity.`;
    button.textContent = "Fresh run started";
    window.setTimeout(() => {
      status.textContent = "";
    }, 12000);
  } catch (error) {
    status.textContent = `Recovery failed: ${error.message}. The previous run may already be closed; retry once or use CRUD if needed.`;
    button.disabled = false;
    button.textContent = "Restart with fresh run";
  }
}

function install() {
  const activityId = activityIdFromLocation();
  if (!activityId || !lecturerKey()) return;

  const toolbar = document.querySelector(".cwd-control-toolbar");
  if (!toolbar || document.getElementById(BUTTON_ID)) return;

  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.className = "cwd-control-button";
  button.textContent = "Restart with fresh run";
  button.title = "Emergency recovery: close this run and create a new empty run.";
  button.addEventListener("click", () => restartFresh(button, toolbar));

  const endButton = Array.from(toolbar.querySelectorAll("button")).find((item) => item.textContent?.trim() === "End session");
  if (endButton) toolbar.insertBefore(button, endButton);
  else toolbar.appendChild(button);
}

const observer = new MutationObserver(install);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("popstate", install);
window.addEventListener("hashchange", install);
install();
