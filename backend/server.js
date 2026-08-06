import express from "express";
import cors from "cors";
import pg from "pg";

const { Pool } = pg;

const app = express();
app.use(express.json());

// --- CORS --- (same fix as b1141-likert-poll: a literal "*" must be
// passed straight through, not split into the array ["*"])
const rawOrigins = (process.env.ALLOWED_ORIGINS || "").trim();
const corsOrigin =
  rawOrigins === "*"
    ? "*"
    : rawOrigins === ""
    ? "*"
    : rawOrigins.split(",").map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: corsOrigin }));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Off by default (ephemeral, matching the pending-ethics-approval
// position) — one flag away from persisting every submission, initial
// or revised, as its own permanent row.
const PERSIST_RESPONSES = process.env.PERSIST_RESPONSES === "true";

// --- In-memory live session store ---
// Keyed by token -> { option, confidence }, so a revised submission
// replaces the earlier answer in the live view rather than adding a
// second entry. Cleared on restart and by "clear session".
const sessionStore = new Map();

function getSession(id) {
  if (!sessionStore.has(id)) {
    sessionStore.set(id, { responses: {}, revealed: false });
  }
  return sessionStore.get(id);
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
    options: row.options, // jsonb column comes back already parsed
    confidence_points: row.confidence_points,
    correct_option: row.correct_option,
    reveal_mode: row.reveal_mode,
    reveal_threshold: row.reveal_threshold,
    cohort_size: row.cohort_size,
    active: row.active,
  };
}

// ---- Config: list (for a future multi-activity dashboard shell) ----
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

// ---- Config: single instance ----
app.get("/api/config/confidence/:id", async (req, res) => {
  const row = await findActivity(req.params.id);
  if (!row) return res.status(404).json({ error: "Not found" });
  if (!row.active) return res.status(410).json({ error: "Inactive" });
  res.json(serializeActivity(row));
});

// ---- Submit a response (initial or revised) ----
app.post("/api/response/confidence/:id", async (req, res) => {
  const row = await findActivity(req.params.id);
  if (!row) return res.status(404).json({ error: "Unknown activity" });

  const { option, confidence, token } = req.body;
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
  session.responses[token] = { option, confidence };

  if (PERSIST_RESPONSES) {
    await pool.query(
      "INSERT INTO responses (activity_id, respondent_token, option, confidence) VALUES ($1, $2, $3, $4)",
      [req.params.id, token, option, confidence]
    );
  }

  res.json({ ok: true, count: Object.keys(session.responses).length });
});

// ---- Aggregate: matrix of option -> counts per confidence level ----
app.get("/api/aggregate/confidence/:id", async (req, res) => {
  const row = await findActivity(req.params.id);
  if (!row) return res.status(404).json({ error: "Unknown activity" });
  const session = getSession(req.params.id);

  const entries = Object.values(session.responses);
  const matrix = {};
  row.options.forEach((opt) => {
    matrix[opt] = Array.from({ length: row.confidence_points }, () => 0);
  });
  entries.forEach(({ option, confidence }) => {
    if (matrix[option]) matrix[option][confidence - 1]++;
  });

  const total = entries.length;
  const thresholdMet =
    !!row.cohort_size &&
    total / row.cohort_size >= (row.reveal_threshold ?? 1);

  let revealed = false;
  if (row.reveal_mode === "immediate") revealed = true;
  else if (row.reveal_mode === "threshold") revealed = thresholdMet || session.revealed;
  else if (row.reveal_mode === "manual") revealed = session.revealed;

  res.json({ id: req.params.id, total, matrix, revealed, thresholdMet });
});

// ---- Lecturer controls ----
app.post("/api/session/:id/reveal", (req, res) => {
  getSession(req.params.id).revealed = true;
  res.json({ ok: true });
});

app.post("/api/session/:id/clear", (req, res) => {
  sessionStore.set(req.params.id, { responses: {}, revealed: false });
  res.json({ ok: true });
});

app.get("/api/health", (req, res) => res.json({ ok: true, persisting: PERSIST_RESPONSES }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () =>
  console.log(`Confidence-verdict API listening on :${PORT} (persist=${PERSIST_RESPONSES})`)
);
