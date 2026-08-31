import express from "express";
import cors from "cors";
import pg from "pg";
import { createStage3CwdRouter } from "./stage3-cwd.js";

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
const ENABLE_STAGE3_CWD = process.env.ENABLE_STAGE3_CWD === "true";
const CWD_LECTURER_KEY = process.env.CWD_LECTURER_KEY || "";

// The live mechanic is a hidden two-dimensional space. Before reveal,
// learners may reposition themselves. At reveal, the cohort landscape is
// frozen. The point is then to locate and interpret one's position in that
// landscape, not to optimise or change it afterwards.
//
// This legacy in-memory path remains intact during the Stage 3 transition.
const sessionStore = new Map();

function emptySession() {
  return {
    responses: {},
    snapshot: null,
    revealed: false,
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

function analyseLandscape(row, responseMap) {
  const entries = Object.values(responseMap || {});
  const total = entries.length;
  if (!total) {
    return {
      total: 0,
      dominant_option: null,
      dominant_pct: null,
      mean_confidence: null,
      occupied_cells: 0,
      occupied_options: 0,
      high_confidence_pct: null,
      signals: [],
    };
  }

  const optionStats = row.options.map((option) => {
    const matching = entries.filter((response) => response.option === option);
    const count = matching.length;
    const mean = count
      ? matching.reduce((sum, response) => sum + response.confidence, 0) / count
      : null;
    return { option, count, pct: (count / total) * 100, mean_confidence: mean };
  });

  const sorted = [...optionStats].sort((a, b) => b.count - a.count);
  const dominant = sorted[0];
  const overallMean = meanConfidence(responseMap);
  const highCutoff = Math.max(2, Math.ceil(row.confidence_points * 0.8));
  const highCount = entries.filter((response) => response.confidence >= highCutoff).length;
  const occupied = new Set(entries.map((response) => `${response.option}::${response.confidence}`));
  const occupiedOptions = optionStats.filter((stat) => stat.count > 0).length;

  const signals = [];
  if (dominant.pct >= 60) {
    signals.push(`${Math.round(dominant.pct)}% of the room selected ${dominant.option}.`);
  } else if (dominant.pct < 50 && occupiedOptions > 1) {
    signals.push("No single verdict accounts for half of the room.");
  }

  const confidenceRatio = overallMean / row.confidence_points;
  if (confidenceRatio >= 0.74) {
    signals.push("Confidence is relatively high across the room.");
  } else if (confidenceRatio <= 0.52) {
    signals.push("The room is relatively cautious in its confidence.");
  } else {
    signals.push("Confidence is mixed rather than uniformly high or low.");
  }

  const minorityConviction = optionStats
    .filter((stat) => stat.count >= 2 && stat.pct <= 35 && stat.mean_confidence != null)
    .sort((a, b) => b.mean_confidence - a.mean_confidence)[0];
  if (
    minorityConviction &&
    minorityConviction.mean_confidence >= row.confidence_points * 0.74 &&
    minorityConviction.mean_confidence >= overallMean + 0.35
  ) {
    signals.push(
      `${minorityConviction.option} is a smaller group, but its average confidence is comparatively high.`
    );
  }

  return {
    total,
    dominant_option: dominant.option,
    dominant_pct: dominant.pct,
    mean_confidence: overallMean,
    occupied_cells: occupied.size,
    occupied_options: occupiedOptions,
    high_confidence_pct: (highCount / total) * 100,
    option_stats: optionStats,
    signals,
  };
}

async function persistResponse(activityId, token, response) {
  if (!PERSIST_RESPONSES) return;
  await pool.query(
    `INSERT INTO responses
      (activity_id, respondent_token, option, confidence, phase, reconsideration_scope)
     VALUES ($1, $2, $3, $4, 'initial', NULL)`,
    [activityId, token, response.option, response.confidence]
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
  const response = { option, confidence };

  // Existing pre-reveal participants may reposition themselves. Once the
  // landscape has been revealed, their committed position is locked because
  // that is the position to which the feedback refers.
  if (session.revealed && session.snapshot?.[token]) {
    return res.status(409).json({ error: "Your position was locked when the class landscape was revealed" });
  }

  // Late participants may still place themselves after reveal. They receive
  // personal feedback against the frozen class landscape, but do not alter it.
  session.responses[token] = response;
  await persistResponse(req.params.id, token, response);

  res.json({
    ok: true,
    count: Object.keys(session.responses).length,
    late: Boolean(session.revealed),
  });
});

app.get("/api/aggregate/confidence/:id", async (req, res) => {
  const row = await findActivity(req.params.id);
  if (!row) return res.status(404).json({ error: "Unknown activity" });
  const session = getSession(req.params.id);

  const liveTotal = Object.keys(session.responses).length;
  const thresholdMet =
    !!row.cohort_size &&
    liveTotal / row.cohort_size >= (row.reveal_threshold ?? 1);

  const automaticReveal =
    row.reveal_mode === "immediate" ||
    (row.reveal_mode === "threshold" && thresholdMet);
  if (automaticReveal && !session.revealed) freezeSnapshot(session);

  const visibleSource = session.revealed ? session.snapshot || {} : session.responses;
  const total = Object.keys(visibleSource).length;
  const matrix = buildMatrix(row, visibleSource);
  const landscape = analyseLandscape(row, visibleSource);

  res.json({
    id: req.params.id,
    total,
    live_total: liveTotal,
    matrix,
    revealed: session.revealed,
    phase: session.revealed ? "revealed" : "hidden",
    thresholdMet,
    mean_confidence: meanConfidence(visibleSource),
    landscape,
  });
});

app.get("/api/personal/confidence/:id", async (req, res) => {
  const row = await findActivity(req.params.id);
  if (!row) return res.status(404).json({ error: "Unknown activity" });
  const token = req.query.token;
  if (typeof token !== "string" || token.length < 8) {
    return res.status(400).json({ error: "Missing or invalid token" });
  }

  const session = getSession(req.params.id);
  const position = session.snapshot?.[token] || session.responses[token] || null;
  if (!position) return res.status(404).json({ error: "No committed response for this session" });

  if (!session.revealed) {
    return res.json({ revealed: false, position });
  }

  // Compare the learner with the frozen cohort. If they were part of that
  // snapshot, exclude them from their own peer statistics. If they arrived
  // after reveal, the whole snapshot is their peer landscape.
  const peerEntries = Object.entries(session.snapshot || {})
    .filter(([peerToken]) => peerToken !== token)
    .map(([, response]) => response);
  const sameOptionPeers = peerEntries.filter((response) => response.option === position.option);
  const sameCellPeers = peerEntries.filter(
    (response) => response.option === position.option && response.confidence === position.confidence
  );
  const peerMean = sameOptionPeers.length
    ? sameOptionPeers.reduce((sum, response) => sum + response.confidence, 0) / sameOptionPeers.length
    : null;

  res.json({
    revealed: true,
    position,
    peers_total: peerEntries.length,
    same_option_count: sameOptionPeers.length,
    same_option_pct: peerEntries.length ? (sameOptionPeers.length / peerEntries.length) * 100 : null,
    same_cell_count: sameCellPeers.length,
    same_cell_pct: peerEntries.length ? (sameCellPeers.length / peerEntries.length) * 100 : null,
    peer_same_option_mean_confidence: peerMean,
    landscape: analyseLandscape(row, session.snapshot || {}),
  });
});

app.post("/api/session/:id/reveal", (req, res) => {
  const session = getSession(req.params.id);
  freezeSnapshot(session);
  res.json({ ok: true, phase: "revealed" });
});

app.post("/api/session/:id/clear", (req, res) => {
  sessionStore.set(req.params.id, emptySession());
  res.json({ ok: true });
});

// The Stage 3 persistent engine is mounted alongside, not instead of, the
// legacy routes. It remains unreachable unless explicitly enabled.
if (ENABLE_STAGE3_CWD) {
  app.use(
    "/api/cwd",
    createStage3CwdRouter({ pool, lecturerKey: CWD_LECTURER_KEY })
  );
}

app.get("/api/health", (req, res) =>
  res.json({
    ok: true,
    persisting: PERSIST_RESPONSES,
    stage3_cwd_enabled: ENABLE_STAGE3_CWD,
  })
);

// Keep the additive columns introduced by the earlier calibration prototype.
// They are harmless for existing databases and avoid destructive migrations;
// this legacy model path writes only phase='initial'.
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
    console.log(
      `Confidence-verdict API listening on :${PORT} (persist=${PERSIST_RESPONSES}, stage3_cwd=${ENABLE_STAGE3_CWD})`
    )
  );
}

start().catch((error) => {
  console.error("Failed to start confidence-verdict API", error);
  process.exit(1);
});
