// Pedagogical framing belongs in activity config; interface mechanics remain in the engine.
export function copyText(config, path, fallback = "") {
  const keys = Array.isArray(path) ? path : String(path).split(".");
  let value = config?.copy;
  for (const key of keys) value = value?.[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}
