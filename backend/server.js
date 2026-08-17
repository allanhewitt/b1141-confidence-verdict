import express from "express";
import cors from "cors";
import pg from "pg";

const { Pool } = pg;

const app = express();
app.use(express.json());

const rawOrigins = (process.env.ALLOWED_ORIGINS || "").trim();
const corsOrigin =
  rawOrigins === "*"
    ? "*"
    : rawOrigins === ""
    ? "*"
    : rawOrigins.split(",").map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: corsOrigin }));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PERSIST_RESPONSES = process.env.PERSIST_RESPONSES === "true";

// Live state is deliberately richer than the original poll. Before reveal,
// responses[token] is simply the learner's latest commitment. At reveal we
// freeze a snapshot of those commitments. Subsequent calibration changes the
// current response but never the snapshot that generated the confrontation.
const sessionStore = new Map();

function emptySession() {
  return {
    responses: {},
    snapshot: null,
    resolutions: {},
    revealed: false,
    complete: false,
  };
}

function getSession(id) {
  if (!sessionStore.has(id)) sessionStore.set(id, emptySession());
  return sessionStore.get(id);
}

function freezeSnapshot(session) {
  if (!session.snapshot) {
    session.snapshot = Object.fromEntries(
      Object.entries(session.responses).map(([token, response]) => [token, { ...response }])
    );
  }
  session.revealed = true;
}

async function findActivity(id) {
  const { rows } = await pool.query("SELECT * FROM activities WHERE id = $1", [id]);
  return rows[0] || null;
}

function serializeActivity(row) {
  return {
    id: row.id,
    module: row.module,
    week: row.week,
    activity: row.activity,
    sequence: row.sequence,
    question: row.question,
    options: row.options,
    confidence_points: row.confidence_points,
    correct_option: row.correct_option,
    reveal_mode: row.reveal_mode,
    reveal_threshold: row.reveal_threshold,
    cohort_size: row.cohort_size,
    active: row.active,
  };
}

function buildMatrix(row, responseMap) {
  const matrix = {};
  row.options.forEach((opt) => {
    matrix[opt] = Array.from({ length: row.confidence_points }, () => 0);
  });
  Object.values(responseMap || {}).forEach(({ option, confidence }) => {
    if (matrix[option] && Number.isInteger(confidence)) matrix[option][confidence - 1]++;
  });
  return matrix;
}

function meanConfidence(responseMap) {
  const values = Object.values(responseMap || {});
  if (!values.length) return null;
  return values.reduce((sum, response) => sum + response.confidence, 0) / values.length;
}

function movementSummary(session) {
  const movement = {
    judgement_only: 0,
    confidence_only: 0,
    both_changed: 0,
    neither_changed: 0,
  };
  const scopeCounts = { judgement: 0, confidence: 0, both: 0, neither: 0 };

  Object.entries(session.resolutions).forEach(([token, resolution]) => {
    if (scopeCounts[resolution.scope] !== undefined) scopeCounts[resolution.scope]++;
    const before = session.snapshot?.[token];
    const after = session.responses[token];
    if (!before || !after) return;

    const judgementChanged = before.option !== after.option;
    const confidenceChanged = before.confidence !== after.confidence;
    if (judgementChanged && confidenceChanged) movement.both_changed++;
    else if (judgementChanged) movement.judgement_only++;
    else if (confidenceChanged) movement.confidence_only++;
    else movement.neither_changed++;
  });

  return { movement, scope_counts: scopeCounts };
}

async function persistResponse(activityId, token, response, phase, scope = null) {
  if (!PERSIST_RESPONSES) return;
  await pool.query(
    `INSERT INTO responses
      (activity_id, respondent_token, option, confidence, phase, reconsideration_scope)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [activityId, token, response.option, response.confidence, phase, scope]
  );
}

app.get("/api/config/confidence", async (req, res) => {
  const { module: mod, week, activity } = req.query;
  const clauses = [];
  const params = [];
  if (mod) {
    params.push(mod);
    clauses.push(`module = $${params.length}`);
  }
  if (week) {
    params.push(week);
    clauses.push(`week = $${params.length}`);
  }
  if (activity) {
    params.push(activity);
    clauses.push(`activity = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT * FROM activities ${where} ORDER BY week, sequence`,
    params
  );
  res.json(rows.map(serializeActivity));
});

app.get("/api/config/confidence/:id", async (req, res) => {
  const row = await findActivity(req.params.id);
  if (!row) return res.status(404).json({ error: "Not found" });
  if (!row.active) return res.status(410).json({ error: "Inactive" });
  res.json(serializeActivity(row));
});

// Before reveal this endpoint records/replaces the learner's current
// commitment. After reveal, the same endpoint records one explicit final
// calibration. The requested scope controls which dimensions may change.
app.post("/api/response/confidence/:id", async (req, res) => {
  const row = await findActivity(req.params.id);
  if (!row) return res.status(404).json({ error: "Unknown activity" });

  const { option, confidence, token, scope = null } = req.body;
  if (!row.options.includes(option)) {
    return res.status(400).json({ error: "Invalid option" });
  }
  if (
    !Number.isInteger(confidence) ||
    confidence < 1 ||
    confidence > row.confidence_points
  ) {
    return res.status(400).json({ error: "Invalid confidence value" });
  }
  if (typeof token !== "string" || token.length < 8) {
    return res.status(400).json({ error: "Missing or invalid token" });
  }

  const session = getSession(req.params.id);
  if (session.complete) {
    return res.status(409).json({ error: "This activity is complete" });
  }

  // Normal pre-reveal commitment: revisions simply replace the current
  // position. The snapshot is not created until the reveal actually occurs.
  if (!session.revealed) {
    const response = { option, confidence };
    session.responses[token] = response;
    await persistResponse(req.params.id, token, response, "initial");
    return res.json({
      ok: true,
      count: Object.keys(session.responses).length,
      phase: "initial",
    });
  }

  // A learner who submits for the first time after a threshold/manual reveal
  // has not seen results through this UI yet. Admit the late initial response
  // and add it to the reveal snapshot so they can still receive feedback.
  if (!session.snapshot?.[token]) {
    const response = { option, confidence };
    session.responses[token] = response;
    session.snapshot[token] = { ...response };
    await persistResponse(req.params.id, token, response, "initial");
    return res.json({
      ok: true,
      count: Object.keys(session.responses).length,
      phase: "revealed",
      late_initial: true,
    });
  }

  if (session.resolutions[token]) {
    return res.status(409).json({ error: "Your reconsideration is already locked in" });
  }

  const allowedScopes = ["judgement", "confidence", "both", "neither"];
  if (!allowedScopes.includes(scope)) {
    return res.status(400).json({ error: "Choose what you want to reconsider" });
  }

  const initial = session.snapshot[token];
  let finalResponse = { option, confidence };

  if (scope === "neither") {
    finalResponse = { ...initial };
  } else if (scope === "judgement" && confidence !== initial.confidence) {
    return res.status(400).json({ error: "Confidence is locked for this reconsideration" });
  } else if (scope === "confidence" && option !== initial.option) {
    return res.status(400).json({ error: "Judgement is locked for this reconsideration" });
  }

  session.responses[token] = finalResponse;
  session.resolutions[token] = { scope, submitted_at: new Date().toISOString() };
  await persistResponse(req.params.id, token, finalResponse, "reconsideration", scope);

  res.json({
    ok: true,
    phase: "reconsideration",
    initial,
    current: finalResponse,
    resolution: session.resolutions[token],
  });
});

app.get("/api/aggregate/confidence/:id", async (req, res) => {
  const row = await findActivity(req.params.id);
  if (!row) return res.status(404).json({ error: "Unknown activity" });
  const session = getSession(req.params.id);

  const total = Object.keys(session.responses).length;
  const thresholdMet =
    !!row.cohort_size &&
    total / row.cohort_size >= (row.reveal_threshold ?? 1);

  const automaticReveal =
    row.reveal_mode === "immediate" ||
    (row.reveal_mode === "threshold" && thresholdMet);
  if (automaticReveal && !session.revealed) freezeSnapshot(session);

  const initialSource = session.snapshot || session.responses;
  const initialMatrix = buildMatrix(row, initialSource);
  const currentMatrix = buildMatrix(row, session.responses);
  const { movement, scope_counts } = movementSummary(session);
  const phase = session.complete ? "complete" : session.revealed ? "revealed" : "initial";

  res.json({
    id: req.params.id,
    total,
    matrix: session.revealed ? initialMatrix : currentMatrix,
    initial_matrix: initialMatrix,
    current_matrix: currentMatrix,
    initial_mean_confidence: meanConfidence(initialSource),
    current_mean_confidence: meanConfidence(session.responses),
    revealed: session.revealed,
    complete: session.complete,
    phase,
    thresholdMet,
    resolved_count: Object.keys(session.resolutions).length,
    movement,
    scope_counts,
  });
});

// Personal feedback is derived from the frozen reveal snapshot and excludes
// the learner from peer comparison. It remains anonymous: the token is only
// an activity-scoped browser key, never a student identity.
app.get("/api/personal/confidence/:id", async (req, res) => {
  const row = await findActivity(req.params.id);
  if (!row) return res.status(404).json({ error: "Unknown activity" });
  const token = req.query.token;
  if (typeof token !== "string" || token.length < 8) {
    return res.status(400).json({ error: "Missing or invalid token" });
  }

  const session = getSession(req.params.id);
  const current = session.responses[token] || null;
  if (!session.revealed) {
    return res.json({ revealed: false, current });
  }

  const initial = session.snapshot?.[token] || null;
  if (!initial) return res.status(404).json({ error: "No committed response for this session" });

  const peerEntries = Object.entries(session.snapshot)
    .filter(([peerToken]) => peerToken !== token)
    .map(([, response]) => response);
  const sameOptionPeers = peerEntries.filter((response) => response.option === initial.option);
  const peerMean = sameOptionPeers.length
    ? sameOptionPeers.reduce((sum, response) => sum + response.confidence, 0) / sameOptionPeers.length
    : null;

  res.json({
    revealed: true,
    complete: session.complete,
    initial,
    current,
    resolution: session.resolutions[token] || null,
    peers_total: peerEntries.length,
    same_option_count: sameOptionPeers.length,
    same_option_pct: peerEntries.length ? (sameOptionPeers.length / peerEntries.length) * 100 : null,
    peer_same_option_mean_confidence: peerMean,
  });
});

app.post("/api/session/:id/reveal", (req, res) => {
  const session = getSession(req.params.id);
  freezeSnapshot(session);
  res.json({ ok: true, phase: "revealed" });
});

app.post("/api/session/:id/complete", (req, res) => {
  const session = getSession(req.params.id);
  if (!session.revealed) {
    return res.status(409).json({ error: "Reveal the class response first" });
  }
  session.complete = true;
  res.json({ ok: true, phase: "complete" });
});

app.post("/api/session/:id/clear", (req, res) => {
  sessionStore.set(req.params.id, emptySession());
  res.json({ ok: true });
});

app.get("/api/health", (req, res) => res.json({ ok: true, persisting: PERSIST_RESPONSES }));

async function ensureSchema() {
  await pool.query(`
    ALTER TABLE responses
      ADD COLUMN IF NOT EXISTS phase TEXT NOT NULL DEFAULT 'initial';
    ALTER TABLE responses
      ADD COLUMN IF NOT EXISTS reconsideration_scope TEXT;
  `);
}

const PORT = process.env.PORT || 4000;

async function start() {
  await ensureSchema();
  app.listen(PORT, () =>
    console.log(`Confidence-verdict API listening on :${PORT} (persist=${PERSIST_RESPONSES})`)
  );
}

start().catch((error) => {
  console.error("Failed to start confidence-verdict API", error);
  process.exit(1);
});
