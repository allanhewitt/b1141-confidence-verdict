import express from "express";
import { randomUUID } from "node:crypto";
import {
  CwdConfigError,
  assertCwdConfig,
  buildCohortAggregate,
  correctnessVisibleForTrace,
  deriveCorrectness,
  hashParticipantToken,
  learnerSafeConfig,
  lecturerKeyMatches,
  normalizeConfidenceScale,
  resolutionAvailable,
  sessionPhase,
  shouldAutoReveal,
  validateJudgementResponse,
  validateResolution,
} from "./lib/cwd.js";

const MODEL = "confidence_weighted_response";

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

async function withTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function loadCurrentActivity(db, id, { requireActive = true, lock = false } = {}) {
  const { rows } = await db.query(
    `SELECT id, module, week, activity, title, model, variant, config, schema_version, active
       FROM activities
      WHERE id = $1
      ${lock ? "FOR UPDATE" : ""}`,
    [id]
  );
  const row = rows[0] || null;
  if (!row) return { error: "not_found" };
  if (row.model !== MODEL) return { error: "wrong_model" };
  if (requireActive && !row.active) return { error: "inactive" };
  assertCwdConfig(row.config, row.variant);
  return { row };
}

async function loadConfidenceScale(db, config) {
  if (!config.confidence.enabled) return null;
  const { rows } = await db.query(
    `SELECT id, name, points, schema_version, active
       FROM confidence_scales
      WHERE id = $1`,
    [config.confidence.scale_id]
  );
  const row = rows[0];
  if (!row || !row.active) {
    throw new Error(`Active confidence scale ${config.confidence.scale_id} was not found`);
  }
  return normalizeConfidenceScale(row);
}

async function loadSession(db, id, { lock = false } = {}) {
  const { rows } = await db.query(
    `SELECT s.*,
            a.module,
            a.week,
            a.activity,
            a.title,
            a.active AS activity_active
       FROM activity_sessions s
       JOIN activities a ON a.id = s.activity_id
      WHERE s.id = $1
      ${lock ? "FOR UPDATE OF s" : ""}`,
    [id]
  );
  const row = rows[0] || null;
  if (!row) return null;
  assertCwdConfig(row.config_snapshot, row.variant_snapshot);
  return row;
}

function publicSessionState(session) {
  return {
    id: session.id,
    activity_id: session.activity_id,
    phase: sessionPhase(session),
    revealed: Boolean(session.revealed_at),
    resolution_available: resolutionAvailable(session.config_snapshot, session),
    closed: Boolean(session.closed_at),
    opened_at: session.opened_at,
  };
}

function serializeActivity(row, confidenceScale) {
  return {
    id: row.id,
    module: row.module,
    week: row.week,
    activity: row.activity,
    title: row.title,
    model: row.model,
    variant: row.variant,
    schema_version: row.schema_version,
    config: learnerSafeConfig(row.config),
    confidence_scale: confidenceScale,
  };
}

function tokenFromBody(body) {
  const token = body?.token;
  if (typeof token !== "string" || token.length < 8 || token.length > 512) {
    const error = new Error("Missing or invalid token");
    error.status = 400;
    throw error;
  }
  return token;
}

async function freezeSession(db, session) {
  if (session.revealed_at) return session;
  if (session.closed_at) {
    const error = new Error("Session is closed");
    error.status = 409;
    throw error;
  }

  const now = new Date();
  await db.query(
    `UPDATE response_traces
        SET committed_option_id = current_option_id,
            committed_confidence = current_confidence,
            committed_at = $2,
            included_in_reveal = true,
            updated_at = $2
      WHERE session_id = $1
        AND committed_at IS NULL
        AND current_option_id IS NOT NULL`,
    [session.id, now]
  );

  const immediateResolution = session.config_snapshot.resolution.release === "immediate";
  const { rows } = await db.query(
    `UPDATE activity_sessions
        SET revealed_at = COALESCE(revealed_at, $2),
            resolution_opened_at = CASE
              WHEN $3::boolean THEN COALESCE(resolution_opened_at, $2)
              ELSE resolution_opened_at
            END,
            updated_at = $2
      WHERE id = $1
      RETURNING *`,
    [session.id, now, immediateResolution]
  );
  return { ...session, ...rows[0] };
}

async function cohortTraceRows(db, sessionId) {
  const { rows } = await db.query(
    `SELECT committed_option_id, committed_confidence
       FROM response_traces
      WHERE session_id = $1
        AND included_in_reveal = true
        AND committed_at IS NOT NULL`,
    [sessionId]
  );
  return rows;
}

async function liveResponseCount(db, sessionId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS count
       FROM response_traces
      WHERE session_id = $1
        AND current_option_id IS NOT NULL`,
    [sessionId]
  );
  return rows[0]?.count ?? 0;
}

function requireLecturer(lecturerKey) {
  return (req, res, next) => {
    const supplied = req.get("X-GEDL-Lecturer-Key");
    if (!lecturerKeyMatches(lecturerKey, supplied)) {
      return res.status(401).json({ error: "Lecturer authorisation required" });
    }
    next();
  };
}

export function createStage3CwdRouter({ pool, lecturerKey }) {
  if (!pool) throw new Error("Stage 3 CWD router requires a PostgreSQL pool");
  if (typeof lecturerKey !== "string" || lecturerKey.length < 16) {
    throw new Error("ENABLE_STAGE3_CWD requires CWD_LECTURER_KEY of at least 16 characters");
  }

  const router = express.Router();
  const lecturerOnly = requireLecturer(lecturerKey);

  router.get(
    "/activities/:id",
    asyncRoute(async (req, res) => {
      const result = await loadCurrentActivity(pool, req.params.id);
      if (result.error === "not_found") return res.status(404).json({ error: "Unknown activity" });
      if (result.error === "wrong_model") return res.status(409).json({ error: "Activity is not a CWD activity" });
      if (result.error === "inactive") return res.status(410).json({ error: "Inactive" });
      const scale = await loadConfidenceScale(pool, result.row.config);
      res.json(serializeActivity(result.row, scale));
    })
  );

  router.get(
    "/activities/:id/session",
    asyncRoute(async (req, res) => {
      const activity = await loadCurrentActivity(pool, req.params.id);
      if (activity.error === "not_found") return res.status(404).json({ error: "Unknown activity" });
      if (activity.error === "wrong_model") return res.status(409).json({ error: "Activity is not a CWD activity" });
      if (activity.error === "inactive") return res.status(410).json({ error: "Inactive" });

      const { rows } = await pool.query(
        `SELECT *
           FROM activity_sessions
          WHERE activity_id = $1
            AND closed_at IS NULL
          ORDER BY opened_at DESC
          LIMIT 1`,
        [req.params.id]
      );
      if (!rows[0]) return res.status(404).json({ error: "No open session" });
      res.json(publicSessionState(rows[0]));
    })
  );

  router.post(
    "/activities/:id/sessions",
    lecturerOnly,
    asyncRoute(async (req, res) => {
      const result = await withTransaction(pool, async (client) => {
        const activity = await loadCurrentActivity(client, req.params.id, { lock: true });
        if (activity.error) return { activityError: activity.error };

        const existing = await client.query(
          `SELECT *
             FROM activity_sessions
            WHERE activity_id = $1
              AND closed_at IS NULL
            ORDER BY opened_at DESC
            LIMIT 1
            FOR UPDATE`,
          [req.params.id]
        );
        if (existing.rows[0]) return { session: existing.rows[0], created: false };

        const scale = await loadConfidenceScale(client, activity.row.config);
        const suppliedCohortSize = req.body?.expected_cohort_size;
        if (suppliedCohortSize != null && (!Number.isInteger(suppliedCohortSize) || suppliedCohortSize <= 0)) {
          return { badRequest: "expected_cohort_size must be a positive integer" };
        }
        const expectedCohortSize =
          suppliedCohortSize ?? activity.row.config.confrontation.expected_cohort_size ?? null;

        const id = randomUUID();
        const inserted = await client.query(
          `INSERT INTO activity_sessions (
             id,
             activity_id,
             expected_cohort_size,
             model_snapshot,
             variant_snapshot,
             config_snapshot,
             schema_version_snapshot,
             confidence_scale_snapshot
           )
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb)
           RETURNING *`,
          [
            id,
            activity.row.id,
            expectedCohortSize,
            activity.row.model,
            activity.row.variant,
            JSON.stringify(activity.row.config),
            activity.row.schema_version,
            scale ? JSON.stringify(scale) : null,
          ]
        );
        return { session: inserted.rows[0], created: true };
      });

      if (result.activityError === "not_found") return res.status(404).json({ error: "Unknown activity" });
      if (result.activityError === "wrong_model") return res.status(409).json({ error: "Activity is not a CWD activity" });
      if (result.activityError === "inactive") return res.status(410).json({ error: "Inactive" });
      if (result.badRequest) return res.status(400).json({ error: result.badRequest });
      res.status(result.created ? 201 : 200).json({ ...publicSessionState(result.session), created: result.created });
    })
  );

  router.get(
    "/sessions/:sessionId/state",
    asyncRoute(async (req, res) => {
      const session = await loadSession(pool, req.params.sessionId);
      if (!session) return res.status(404).json({ error: "Unknown session" });
      res.json(publicSessionState(session));
    })
  );

  router.post(
    "/sessions/:sessionId/response",
    asyncRoute(async (req, res) => {
      const token = tokenFromBody(req.body);
      const result = await withTransaction(pool, async (client) => {
        let session = await loadSession(client, req.params.sessionId, { lock: true });
        if (!session) return { notFound: true };
        if (session.closed_at) return { conflict: "Session is closed" };

        const validation = validateJudgementResponse(
          session.config_snapshot,
          session.confidence_scale_snapshot,
          { option_id: req.body?.option_id, confidence: req.body?.confidence }
        );
        if (!validation.valid) return { badRequest: validation.errors.join("; ") };

        const participantHash = hashParticipantToken(session.id, token);
        const existing = await client.query(
          `SELECT * FROM response_traces
            WHERE session_id = $1 AND participant_token_hash = $2
            FOR UPDATE`,
          [session.id, participantHash]
        );
        const trace = existing.rows[0] || null;

        if (session.revealed_at) {
          if (trace?.committed_at) {
            return { conflict: "Your initial position is already committed" };
          }
          const now = new Date();
          const late = await client.query(
            `INSERT INTO response_traces (
               session_id,
               participant_token_hash,
               current_option_id,
               current_confidence,
               committed_option_id,
               committed_confidence,
               committed_at,
               included_in_reveal,
               updated_at
             )
             VALUES ($1, $2, $3, $4, $3, $4, $5, false, $5)
             ON CONFLICT (session_id, participant_token_hash)
             DO UPDATE SET
               current_option_id = EXCLUDED.current_option_id,
               current_confidence = EXCLUDED.current_confidence,
               committed_option_id = EXCLUDED.committed_option_id,
               committed_confidence = EXCLUDED.committed_confidence,
               committed_at = EXCLUDED.committed_at,
               included_in_reveal = false,
               updated_at = EXCLUDED.updated_at
             WHERE response_traces.committed_at IS NULL
             RETURNING *`,
            [session.id, participantHash, req.body.option_id, req.body.confidence ?? null, now]
          );
          if (!late.rows[0]) return { conflict: "Your initial position is already committed" };
          return { session, late: true, count: await liveResponseCount(client, session.id) };
        }

        const upserted = await client.query(
          `INSERT INTO response_traces (
             session_id,
             participant_token_hash,
             current_option_id,
             current_confidence
           )
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (session_id, participant_token_hash)
           DO UPDATE SET
             current_option_id = EXCLUDED.current_option_id,
             current_confidence = EXCLUDED.current_confidence,
             updated_at = now()
           WHERE response_traces.committed_at IS NULL
           RETURNING *`,
          [session.id, participantHash, req.body.option_id, req.body.confidence ?? null]
        );
        if (!upserted.rows[0]) return { conflict: "Your initial position is already committed" };

        const count = await liveResponseCount(client, session.id);
        if (shouldAutoReveal(session.config_snapshot, session.expected_cohort_size, count)) {
          session = await freezeSession(client, session);
        }
        return { session, late: false, count };
      });

      if (result.notFound) return res.status(404).json({ error: "Unknown session" });
      if (result.badRequest) return res.status(400).json({ error: result.badRequest });
      if (result.conflict) return res.status(409).json({ error: result.conflict });
      res.json({
        ok: true,
        session_id: req.params.sessionId,
        count: result.count,
        late: result.late,
        revealed: Boolean(result.session.revealed_at),
      });
    })
  );

  router.post(
    "/sessions/:sessionId/reveal",
    lecturerOnly,
    asyncRoute(async (req, res) => {
      const result = await withTransaction(pool, async (client) => {
        const session = await loadSession(client, req.params.sessionId, { lock: true });
        if (!session) return { notFound: true };
        const revealed = await freezeSession(client, session);
        return { session: revealed };
      });
      if (result.notFound) return res.status(404).json({ error: "Unknown session" });
      res.json({ ok: true, ...publicSessionState(result.session) });
    })
  );

  router.get(
    "/sessions/:sessionId/aggregate",
    asyncRoute(async (req, res) => {
      const session = await loadSession(pool, req.params.sessionId);
      if (!session) return res.status(404).json({ error: "Unknown session" });
      if (!session.revealed_at) {
        return res.json({ ...publicSessionState(session), cohort: null });
      }
      const traces = await cohortTraceRows(pool, session.id);
      res.json({
        ...publicSessionState(session),
        cohort: buildCohortAggregate(session.config_snapshot, session.confidence_scale_snapshot, traces),
      });
    })
  );

  router.get(
    "/sessions/:sessionId/lecturer",
    lecturerOnly,
    asyncRoute(async (req, res) => {
      const session = await loadSession(pool, req.params.sessionId);
      if (!session) return res.status(404).json({ error: "Unknown session" });
      const liveTotal = await liveResponseCount(pool, session.id);
      if (!session.revealed_at) {
        return res.json({ ...publicSessionState(session), live_total: liveTotal, cohort: null });
      }
      const traces = await cohortTraceRows(pool, session.id);
      res.json({
        ...publicSessionState(session),
        live_total: liveTotal,
        cohort: buildCohortAggregate(session.config_snapshot, session.confidence_scale_snapshot, traces),
      });
    })
  );

  router.get(
    "/sessions/:sessionId/personal",
    asyncRoute(async (req, res) => {
      const session = await loadSession(pool, req.params.sessionId);
      if (!session) return res.status(404).json({ error: "Unknown session" });
      const token = req.query.token;
      if (typeof token !== "string" || token.length < 8 || token.length > 512) {
        return res.status(400).json({ error: "Missing or invalid token" });
      }
      const participantHash = hashParticipantToken(session.id, token);
      const { rows } = await pool.query(
        `SELECT * FROM response_traces
          WHERE session_id = $1 AND participant_token_hash = $2`,
        [session.id, participantHash]
      );
      const trace = rows[0];
      if (!trace) return res.status(404).json({ error: "No response for this session" });

      const position = session.revealed_at
        ? {
            option_id: trace.committed_option_id ?? trace.current_option_id,
            confidence: trace.committed_confidence ?? trace.current_confidence,
          }
        : { option_id: trace.current_option_id, confidence: trace.current_confidence };

      if (!session.revealed_at) {
        return res.json({ ...publicSessionState(session), position });
      }

      const peerResult = await pool.query(
        `SELECT committed_option_id, committed_confidence, participant_token_hash
           FROM response_traces
          WHERE session_id = $1
            AND included_in_reveal = true
            AND committed_at IS NOT NULL`,
        [session.id]
      );
      const peers = peerResult.rows.filter(
        (peer) => !trace.included_in_reveal || peer.participant_token_hash !== participantHash
      );
      const sameOption = peers.filter((peer) => peer.committed_option_id === position.option_id);
      const sameCell = sameOption.filter((peer) => peer.committed_confidence === position.confidence);
      const sameOptionConfidences = sameOption.map((peer) => peer.committed_confidence).filter(Number.isInteger);
      const peerMean = sameOptionConfidences.length
        ? sameOptionConfidences.reduce((sum, value) => sum + value, 0) / sameOptionConfidences.length
        : null;

      const cohortRows = peerResult.rows.map((peer) => ({
        committed_option_id: peer.committed_option_id,
        committed_confidence: peer.committed_confidence,
      }));
      const correctnessVisible = correctnessVisibleForTrace(session.config_snapshot, session, trace);
      const correctness = correctnessVisible
        ? {
            accepted_option_ids: session.config_snapshot.evaluation.accepted_option_ids,
            committed_correctness: deriveCorrectness(session.config_snapshot, position.option_id),
            final_correctness: trace.final_option_id
              ? deriveCorrectness(session.config_snapshot, trace.final_option_id)
              : null,
          }
        : null;

      res.json({
        ...publicSessionState(session),
        position,
        included_in_reveal: trace.included_in_reveal,
        peers_total: peers.length,
        same_option_count: sameOption.length,
        same_option_pct: peers.length ? (sameOption.length / peers.length) * 100 : null,
        same_cell_count: sameCell.length,
        same_cell_pct: peers.length ? (sameCell.length / peers.length) * 100 : null,
        peer_same_option_mean_confidence: peerMean,
        cohort: buildCohortAggregate(session.config_snapshot, session.confidence_scale_snapshot, cohortRows),
        guidance_reached: Boolean(trace.guidance_reached_at),
        completed: Boolean(trace.completed_at),
        correctness,
      });
    })
  );

  router.post(
    "/sessions/:sessionId/progress",
    asyncRoute(async (req, res) => {
      const token = tokenFromBody(req.body);
      const event = req.body?.event;
      if (event !== "reveal_encountered" && event !== "guidance_reached") {
        return res.status(400).json({ error: "Unsupported progress event" });
      }

      const result = await withTransaction(pool, async (client) => {
        const session = await loadSession(client, req.params.sessionId, { lock: true });
        if (!session) return { notFound: true };
        if (!session.revealed_at) return { conflict: "The cohort has not been revealed" };
        const participantHash = hashParticipantToken(session.id, token);
        const now = new Date();
        const updated = await client.query(
          event === "guidance_reached"
            ? `UPDATE response_traces
                  SET reveal_encountered_at = COALESCE(reveal_encountered_at, $3),
                      guidance_reached_at = COALESCE(guidance_reached_at, $3),
                      updated_at = $3
                WHERE session_id = $1 AND participant_token_hash = $2
                RETURNING reveal_encountered_at, guidance_reached_at`
            : `UPDATE response_traces
                  SET reveal_encountered_at = COALESCE(reveal_encountered_at, $3),
                      updated_at = $3
                WHERE session_id = $1 AND participant_token_hash = $2
                RETURNING reveal_encountered_at, guidance_reached_at`,
          [session.id, participantHash, now]
        );
        if (!updated.rows[0]) return { noTrace: true };
        return { row: updated.rows[0] };
      });

      if (result.notFound) return res.status(404).json({ error: "Unknown session" });
      if (result.noTrace) return res.status(404).json({ error: "No response for this session" });
      if (result.conflict) return res.status(409).json({ error: result.conflict });
      res.json({ ok: true, ...result.row });
    })
  );

  router.post(
    "/sessions/:sessionId/resolution/open",
    lecturerOnly,
    asyncRoute(async (req, res) => {
      const result = await withTransaction(pool, async (client) => {
        const session = await loadSession(client, req.params.sessionId, { lock: true });
        if (!session) return { notFound: true };
        if (!session.revealed_at) return { conflict: "Reveal the cohort before opening resolution" };
        if (session.closed_at) return { conflict: "Session is closed" };
        if (session.config_snapshot.resolution.release !== "lecturer_controlled") {
          return { conflict: "This activity does not use lecturer-controlled resolution" };
        }
        const { rows } = await client.query(
          `UPDATE activity_sessions
              SET resolution_opened_at = COALESCE(resolution_opened_at, now()),
                  updated_at = now()
            WHERE id = $1
            RETURNING *`,
          [session.id]
        );
        return { session: { ...session, ...rows[0] } };
      });
      if (result.notFound) return res.status(404).json({ error: "Unknown session" });
      if (result.conflict) return res.status(409).json({ error: result.conflict });
      res.json({ ok: true, ...publicSessionState(result.session) });
    })
  );

  router.post(
    "/sessions/:sessionId/resolution",
    asyncRoute(async (req, res) => {
      const token = tokenFromBody(req.body);
      const result = await withTransaction(pool, async (client) => {
        const session = await loadSession(client, req.params.sessionId, { lock: true });
        if (!session) return { notFound: true };
        if (!resolutionAvailable(session.config_snapshot, session)) {
          return { conflict: "Resolution is not currently available" };
        }
        const participantHash = hashParticipantToken(session.id, token);
        const traceResult = await client.query(
          `SELECT * FROM response_traces
            WHERE session_id = $1 AND participant_token_hash = $2
            FOR UPDATE`,
          [session.id, participantHash]
        );
        const trace = traceResult.rows[0];
        if (!trace?.committed_at) return { noTrace: true };
        if (trace.completed_at) return { conflict: "Resolution has already been completed" };
        if (session.config_snapshot.guidance.source === "in_app" && !trace.guidance_reached_at) {
          return { conflict: "Complete the guidance before resolution" };
        }

        const validation = validateResolution(
          session.config_snapshot,
          session.confidence_scale_snapshot,
          { option_id: trace.committed_option_id, confidence: trace.committed_confidence },
          req.body
        );
        if (!validation.valid) return { badRequest: validation.errors.join("; ") };

        const now = new Date();
        const updated = await client.query(
          `UPDATE response_traces
              SET resolution_state = $3,
                  final_option_id = $4,
                  final_confidence = $5,
                  completed_at = $6,
                  updated_at = $6
            WHERE session_id = $1 AND participant_token_hash = $2
            RETURNING *`,
          [
            session.id,
            participantHash,
            validation.normalized.resolution_state,
            validation.normalized.final_option_id,
            validation.normalized.final_confidence,
            now,
          ]
        );
        return { session, trace: updated.rows[0] };
      });

      if (result.notFound) return res.status(404).json({ error: "Unknown session" });
      if (result.noTrace) return res.status(404).json({ error: "No committed response for this session" });
      if (result.badRequest) return res.status(400).json({ error: result.badRequest });
      if (result.conflict) return res.status(409).json({ error: result.conflict });

      const correctnessVisible = correctnessVisibleForTrace(
        result.session.config_snapshot,
        result.session,
        result.trace
      );
      res.json({
        ok: true,
        resolution_state: result.trace.resolution_state,
        final_option_id: result.trace.final_option_id,
        final_confidence: result.trace.final_confidence,
        correctness: correctnessVisible
          ? deriveCorrectness(result.session.config_snapshot, result.trace.final_option_id)
          : null,
      });
    })
  );

  router.post(
    "/sessions/:sessionId/close",
    lecturerOnly,
    asyncRoute(async (req, res) => {
      const { rows } = await pool.query(
        `UPDATE activity_sessions
            SET closed_at = COALESCE(closed_at, now()),
                updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [req.params.sessionId]
      );
      if (!rows[0]) return res.status(404).json({ error: "Unknown session" });
      res.json({ ok: true, ...publicSessionState(rows[0]) });
    })
  );

  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof CwdConfigError) {
      console.error("Invalid Stage 3 CWD configuration", error.errors);
      return res.status(500).json({ error: "Invalid activity configuration" });
    }
    if (error?.status) return res.status(error.status).json({ error: error.message });
    console.error("Stage 3 CWD API error", error);
    res.status(500).json({ error: "Stage 3 CWD backend error" });
  });

  return router;
}
