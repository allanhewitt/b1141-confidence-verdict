export const cwdHiddenFieldV1 = Object.freeze({
  id: "cwd_hidden_field_v1",
  tokens: Object.freeze({
    "--cwd-bg": "#090d14",
    "--cwd-panel": "#111722",
    "--cwd-panel-2": "#151d2a",
    "--cwd-ink": "#f6f7fb",
    "--cwd-muted": "#94a1b4",
    "--cwd-line": "rgba(255,255,255,.10)",
    "--cwd-line-strong": "rgba(255,255,255,.18)",
    "--cwd-accent": "#79e4ff",
    "--cwd-accent-2": "#1aa4cb",
    "--cwd-option-1": "#ff9bc0",
    "--cwd-option-2": "#ffd28a",
    "--cwd-option-3": "#b9a7ff",
    "--cwd-option-4": "#79e4ff",
    "--cwd-option-5": "#b9ffad",
    "--cwd-danger": "#ff8c9f",
    "--cwd-radius": "24px",
    "--cwd-control-radius": "14px",
    "--cwd-motion-fast": "180ms",
    "--cwd-motion-standard": "320ms",
    "--cwd-shadow": "0 26px 70px rgba(0,0,0,.34)",
  }),
});

export const defaultCwdVisualProfile = cwdHiddenFieldV1;

export function profileProps(profile = defaultCwdVisualProfile) {
  return {
    "data-cwd-profile": profile.id,
    style: profile.tokens,
  };
}
