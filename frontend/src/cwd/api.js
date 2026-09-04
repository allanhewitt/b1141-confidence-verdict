const API = import.meta.env.VITE_API_BASE || "http://localhost:4000";

export class ApiError extends Error {
  constructor(message, status, payload = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, options);
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new ApiError(payload?.error || `Request failed (${response.status})`, response.status, payload);
  }
  return payload;
}

function jsonOptions(method, body, lecturerKey) {
  const headers = { "Content-Type": "application/json" };
  if (lecturerKey) headers["X-GEDL-Lecturer-Key"] = lecturerKey;
  return { method, headers, body: body == null ? undefined : JSON.stringify(body) };
}

export async function loadActivity(id) {
  try {
    return await request(`/api/cwd/audit/activities/${encodeURIComponent(id)}`);
  } catch (error) {
    if (!(error instanceof ApiError) || (error.status !== 404 && error.status !== 409)) throw error;
  }
  return request(`/api/cwd/activities/${encodeURIComponent(id)}`);
}

export function activityBase(activity) {
  return activity?.variant === "self_audit" ? "/api/cwd/audit" : "/api/cwd";
}

export async function loadOpenSession(activity) {
  return request(`${activityBase(activity)}/activities/${encodeURIComponent(activity.id)}/session`);
}

export async function startSession(activity, lecturerKey) {
  return request(
    `${activityBase(activity)}/activities/${encodeURIComponent(activity.id)}/sessions`,
    jsonOptions("POST", {}, lecturerKey)
  );
}

export async function loadSessionState(activity, sessionId) {
  return request(`${activityBase(activity)}/sessions/${encodeURIComponent(sessionId)}/state`);
}

export async function loadResponseCount(activity, sessionId) {
  if (activity?.variant === "self_audit") return null;
  return request(`/api/cwd/sessions/${encodeURIComponent(sessionId)}/count`);
}

export async function loadPersonal(activity, sessionId, token) {
  return request(
    `${activityBase(activity)}/sessions/${encodeURIComponent(sessionId)}/personal?token=${encodeURIComponent(token)}`
  );
}

export async function loadLecturer(activity, sessionId, lecturerKey) {
  return request(
    `${activityBase(activity)}/sessions/${encodeURIComponent(sessionId)}/lecturer`,
    { headers: { "X-GEDL-Lecturer-Key": lecturerKey } }
  );
}

export async function loadAggregate(activity, sessionId) {
  if (activity.variant === "self_audit") return null;
  return request(`/api/cwd/sessions/${encodeURIComponent(sessionId)}/aggregate`);
}

export async function submitSocialResponse(sessionId, token, optionId, confidence) {
  return request(
    `/api/cwd/sessions/${encodeURIComponent(sessionId)}/response`,
    jsonOptions("POST", { token, option_id: optionId, confidence })
  );
}

export async function socialProgress(sessionId, token, event) {
  return request(
    `/api/cwd/sessions/${encodeURIComponent(sessionId)}/progress`,
    jsonOptions("POST", { token, event })
  );
}

export async function submitSocialResolution(sessionId, token, payload) {
  return request(
    `/api/cwd/sessions/${encodeURIComponent(sessionId)}/resolution`,
    jsonOptions("POST", { token, ...payload })
  );
}

export async function revealSocial(sessionId, lecturerKey) {
  return request(
    `/api/cwd/sessions/${encodeURIComponent(sessionId)}/reveal`,
    jsonOptions("POST", {}, lecturerKey)
  );
}

export async function openSocialFinalResponse(sessionId, lecturerKey) {
  return request(
    `/api/cwd/sessions/${encodeURIComponent(sessionId)}/resolution/open`,
    jsonOptions("POST", {}, lecturerKey)
  );
}

export async function submitAuditProfile(sessionId, token, ratings) {
  return request(
    `/api/cwd/audit/sessions/${encodeURIComponent(sessionId)}/profile`,
    jsonOptions("POST", { token, ratings })
  );
}

export async function selectAuditTarget(sessionId, token, itemId) {
  return request(
    `/api/cwd/audit/sessions/${encodeURIComponent(sessionId)}/target`,
    jsonOptions("POST", { token, item_id: itemId })
  );
}

export async function auditGuidanceReached(sessionId, token) {
  return request(
    `/api/cwd/audit/sessions/${encodeURIComponent(sessionId)}/progress`,
    jsonOptions("POST", { token, event: "guidance_reached" })
  );
}

export async function submitAuditRerating(sessionId, token, rating) {
  return request(
    `/api/cwd/audit/sessions/${encodeURIComponent(sessionId)}/resolution`,
    jsonOptions("POST", { token, rating })
  );
}

export async function closeSession(activity, sessionId, lecturerKey) {
  return request(
    `${activityBase(activity)}/sessions/${encodeURIComponent(sessionId)}/close`,
    jsonOptions("POST", {}, lecturerKey)
  );
}

function randomToken() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `p-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function participantToken(activityId, sessionId) {
  const key = `gedl:cwd:${activityId}:${sessionId}:participant`;
  let token = localStorage.getItem(key);
  if (!token) {
    token = randomToken();
    localStorage.setItem(key, token);
  }
  return token;
}

const LECTURER_KEY_STORAGE = "gedl:cwd:lecturer-key";

export function storedLecturerKey() {
  return sessionStorage.getItem(LECTURER_KEY_STORAGE) || "";
}

export function rememberLecturerKey(value) {
  if (value) sessionStorage.setItem(LECTURER_KEY_STORAGE, value);
  else sessionStorage.removeItem(LECTURER_KEY_STORAGE);
}
