export const PUBLIC_ACTIVITY_ALIASES = Object.freeze({
  cwd01: "b1141-w1-who-is-excluded",
  cwd02: "b1141-w2-bad-apple-or-system-cwd",
  cwd03: "b1141-w5-biometric-data",
  cwd04: "b1141-w6-sky-premier-league-1992",
  cwd05: "b1141-w7-universal-code",
  cwd06: "b1141-w9-audit-own-confidence",
});

export function resolvePublicActivityAlias(alias) {
  if (typeof alias !== "string") return null;
  return PUBLIC_ACTIVITY_ALIASES[alias.toLowerCase()] || null;
}
