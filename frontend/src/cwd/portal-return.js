const PORTALS = {
  b1141: "http://ai3pbfgh23bz6pqvml37qngu.167.233.132.208.sslip.io",
};

function portalKey() {
  const direct = new URLSearchParams(window.location.search).get("gdl_portal");
  if (direct) return direct;
  const hashQuery = window.location.hash.includes("?") ? window.location.hash.split("?")[1] : "";
  return hashQuery ? new URLSearchParams(hashQuery).get("gdl_portal") : null;
}

export function portalReturnUrl() {
  return PORTALS[portalKey()] || null;
}

export function returnToPortal() {
  const url = portalReturnUrl();
  if (url) window.location.assign(url);
}

function syncReturnControl() {
  const url = portalReturnUrl();
  const completed = Boolean(document.querySelector(".cwd-complete-orb"));
  const existing = document.getElementById("gdl-return-to-portal");

  if (!url || !completed) {
    existing?.remove();
    return;
  }
  if (existing) return;

  const wrapper = document.createElement("div");
  wrapper.id = "gdl-return-to-portal";
  Object.assign(wrapper.style, {
    position: "fixed",
    left: "50%",
    bottom: "20px",
    transform: "translateX(-50%)",
    width: "min(92vw, 520px)",
    zIndex: "1000",
  });

  const link = document.createElement("a");
  link.href = url;
  link.className = "cwd-primary-action";
  link.textContent = "Return to B1141 activities";
  Object.assign(link.style, {
    display: "block",
    textAlign: "center",
    textDecoration: "none",
    boxSizing: "border-box",
  });

  wrapper.appendChild(link);
  document.body.appendChild(wrapper);
}

function installReturnControl() {
  const root = document.getElementById("root");
  if (!root) return;
  const observer = new MutationObserver(syncReturnControl);
  observer.observe(root, { childList: true, subtree: true });
  syncReturnControl();
}

if (typeof window !== "undefined") {
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", installReturnControl, { once: true });
  } else {
    installReturnControl();
  }
}
