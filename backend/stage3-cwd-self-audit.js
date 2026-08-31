import express from "express";
import { randomUUID } from "node:crypto";
import { hashParticipantToken, lecturerKeyMatches } from "./lib/cwd.js";
import {
  CwdSelfAuditConfigError,
  assertCwdSelfAuditConfig,
  buildDiagnosticAggregate,
  guidanceForDiagnosticTarget,
  validateDiagnosticProfile,
  validateDiagnosticRerating,
  validateDiagnosticTarget,
  weakestDiagnosticCandidates,
} from "./lib/cwd-self-audit.js";

const MODEL = "confidence_weighted_response";
const VARIANT = "self_audit";

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

function requireLecturer(lecturerKey) {
  return (req, res, next) => {
    const supplied = req.get("X-GEDL-Lecturer-Key");
    if (!lecturerKeyMatches(lecturerKey, supplied)) {
      return res.status(401).json({ error: "Lecturer authorisation required" });
    }
    next();
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
  if (row.model !== MODEL || row.variant !== VARIANT) return { error: "wrong_variant" };
  if (requireActive && !row.active) return { error: "inactive" };
  assertCwdSelfAuditConfig(row.config, row.variant);
  return { row };
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
  if (row.model_snapshot !== MODEL || row.variant_snapshot !== VARIANT) return null;
  assertCwdSelfAuditConfig(row.config_snapshot, row.variant_snapshot);
  return row;
}

function publicSessionState(session) {
  return {
    id: session.id,
    activity_id: session.activity_id,
    phase: session.closed_at ? "closed" : "open",
    closed: Boolean(session.closed_at),
    opened_at: session.opened_at,
  };
}

function serializeActivity(row) {
  return {
    id: row.id,
    module: row.module,
    week: row.week,
    activity: row.activity,
    title: row.title,
    model: row.model,
    variant: row.variant,
    schema_version: row.schema_version,
    config: row.config,
  };
}

function tracePersonalPayload(session, trace) {
  const profile = trace?.committed_diagnostic_profile || null;
  const targetCandidates = profile
    ? weakestDiagnosticCandidates(session.config_snapshot, profile)
    : [];
  const targetGuidance = trace?.diagnostic_target_id
    ? guidanceForDiagnosticTarget(session.config_snapshot, trace.diagnostic_target_id)
    : null;
  return {
    ...publicSessionState(session),
    profile,
    target_candidates: targetCandidates,
    target_id: trace?.diagnostic_target_id || null,
    guidance: targetGuidance,
    guidance_reached: Boolean(trace?.guidance_reached_at),
    completed: Boolean(trace?.completed_at),
    final_profile: trace?.final_diagnostic_profile || null,
  };
}

export function createStage3CwdSelfAuditRouter({ pool, lecturerKey }) {
  if (!pool) throw new Error("Stage 3 CWD self-audit router requires a PostgreSQL pool");
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
      if (result.error === "wrong_variant") return res.status(409).json({ error: "Activity is not a CWD self-audit" });
      if (result.error === "inactive") return res.status(410).json({ error: "Inactive" });
      res.json(serializeActivity(result.row));
    })
  );

  router.get(
    "/activities/:id/session",
    asyncRoute(async (req, res) => {
      const activity = await loadCurrentActivity(pool, req.params.id);
      if (activity.error === "not_found") return res.status(404).json({ error: "Unknown activity" });
      if (activity.error === "wrong_variant") return res.status(409).json({ error: "Activity is not a CWD self-audit" });
      if (activity.error === "inactive") return res.status(410).json({ error: "Inactive" });

      const { rows } = await pool.query(
        `SELECT * FROM activity_sessions
          WHERE activity_id = $1 AND closed_at IS NULL
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
          `SELECT * FROM activity_sessions
            WHERE activity_id = $1 AND closed_at IS NULL
            ORDER BY opened_at DESC
            LIMIT 1
            FOR UPDATE`,
          [req.params.id]
        );
        if (existing.rows[0]) return { session: existing.rows[0], created: false };

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
           VALUES ($1, $2, NULL, $3, $4, $5::jsonb, $6, NULL)
           RETURNING *`,
          [
            id,
            activity.row.id,
            activity.row.model,
            activity.row.variant,
            JSON.stringify(activity.row.config),
            activity.row.schema_version,
          ]
        );
        return { session: inserted.rows[0], created: true };
      });

      if (result.activityError === "not_found") return res.status(404).json({ error: "Unknown activity" });
      if (result.activityError === "wrong_variant") return res.status(409).json({ error: "Activity is not a CWD self-audit" });
      if (result.activityError === "inactive") return res.status(410).json({ error: "Inactive" });
      res.status(result.created ? 201 : 200).json({ ...publicSessionState(result.session), created: result.created });
    })
  );

  router.get(
    "/sessions/:sessionId/state",
    asyncRoute(async (req, res) => {
      const session = await loadSession(pool, req.params.sessionId);
      if (!session) return res.status(404).json({ error: "Unknown self-audit session" });
      res.json(publicSessionState(session));
    })
  );

  router.post(
    "/sessions/:sessionId/profile",
    asyncRoute(async (req, res) => {
      const token = tokenFromBody(req.body);
      const result = await withTransaction(pool, async (client) => {
        const session = await loadSession(client, req.params.sessionId, { lock: true });
        if (!session) return { notFound: true };
        if (session.closed_at) return { conflict: "Session is closed" };

        const validation = validateDiagnosticProfile(session.config_snapshot, req.body?.ratings);
        if (!validation.valid) return { badRequest: validation.errors.join("; ") };

        const participantHash = hashParticipantToken(session.id, token);
        const existing = await client.query(
          `SELECT * FROM response_traces
            WHERE session_id = $1 AND participant_token_hash = $2
            FOR UPDATE`,
          [session.id, participantHash]
        );
        if (existing.rows[0]?.committed_at) {
          return { conflict: "Your diagnostic profile is already committed" };
        }

        const now = new Date();
        const ratings = req.body.ratings;
        const inserted = await client.query(
          `INSERT INTO response_traces (
             session_id,
             participant_token_hash,
             committed_diagnostic_profile,
             committed_at,
             included_in_reveal,
             updated_at
           )
           VALUES ($1, $2, $3::jsonb, $4, false, $4)
           ON CONFLICT (session_id, participant_token_hash)
           DO UPDATE SET
             committed_diagnostic_profile = EXCLUDED.committed_diagnostic_profile,
             committed_at = EXCLUDED.committed_at,
             included_in_reveal = false,
             updated_at = EXCLUDED.updated_at
           WHERE response_traces.committed_at IS NULL
           RETURNING *`,
          [session.id, participantHash, JSON.stringify(ratings), now]
        );
        if (!inserted.rows[0]) return { conflict: "Your diagnostic profile is already committed" };
        return {
          session,
          trace: inserted.rows[0],
          candidates: weakestDiagnosticCandidates(session.config_snapshot, ratings),
        };
      });

      if (result.notFound) return res.status(404).json({ error: "Unknown self-audit session" });
      if (result.badRequest) return res.status(400).json({ error: result.badRequest });
      if (result.conflict) return res.status(409).json({ error: result.conflict });
      res.json({
        ok: true,
        session_id: req.params.sessionId,
        profile: result.trace.committed_diagnostic_profile,
        target_candidates: result.candidates,
      });
    })
  );

  router.post(
    "/sessions/:sessionId/target",
    asyncRoute(async (req, res) => {
      const token = tokenFromBody(req.body);
      const itemId = req.body?.item_id;
      const result = await withTransaction(pool, async (client) => {
        const session = await loadSession(client, req.params.sessionId, { lock: true });
        if (!session) return { notFound: true };
        if (session.closed_at) return { conflict: "Session is closed" };
        const participantHash = hashParticipantToken(session.id, token);
        const traceResult = await client.query(
          `SELECT * FROM response_traces
            WHERE session_id = $1 AND participant_token_hash = $2
            FOR UPDATE`,
          [session.id, participantHash]
        );
        const trace = traceResult.rows[0];
        if (!trace?.committed_diagnostic_profile) return { noTrace: true };
        if (trace.completed_at) return { conflict: "Self-audit is already complete" };
        if (trace.diagnostic_target_id && trace.diagnostic_target_id !== itemId) {
          return { conflict: "Diagnostic target is already selected" };
        }

        const targetValidation = validateDiagnosticTarget(
          session.config_snapshot,
          trace.committed_diagnostic_profile,
          itemId
        );
        if (!targetValidation.valid) {
          return {
            badRequest: "Choose one of the lowest-rated diagnostic areas",
            candidates: targetValidation.candidates,
          };
        }

        const updated = await client.query(
          `UPDATE response_traces
              SET diagnostic_target_id = COALESCE(diagnostic_target_id, $3),
                  updated_at = now()
            WHERE session_id = $1 AND participant_token_hash = $2
            RETURNING *`,
          [session.id, participantHash, itemId]
        );
        return {
          session,
          trace: updated.rows[0],
          guidance: guidanceForDiagnosticTarget(session.config_snapshot, itemId),
        };
      });

      if (result.notFound) return res.status(404).json({ error: "Unknown self-audit session" });
      if (result.noTrace) return res.status(404).json({ error: "No committed diagnostic profile" });
      if (result.badRequest) return res.status(400).json({ error: result.badRequest, target_candidates: result.candidates });
      if (result.conflict) return res.status(409).json({ error: result.conflict });
      res.json({ ok: true, target_id: result.trace.diagnostic_target_id, guidance: result.guidance });
    })
  );

  router.post(
    "/sessions/:sessionId/progress",
    asyncRoute(async (req, res) => {
      const token = tokenFromBody(req.body);
      if (req.body?.event !== "guidance_reached") {
        return res.status(400).json({ error: "Unsupported self-audit progress event" });
      }
      const result = await withTransaction(pool, async (client) => {
        const session = await loadSession(client, req.params.sessionId, { lock: true });
        if (!session) return { notFound: true };
        const participantHash = hashParticipantToken(session.id, token);
        const now = new Date();
        const updated = await client.query(
          `UPDATE response_traces
              SET guidance_reached_at = COALESCE(guidance_reached_at, $3),
                  updated_at = $3
            WHERE session_id = $1
              AND participant_token_hash = $2
              AND committed_diagnostic_profile IS NOT NULL
              AND diagnostic_target_id IS NOT NULL
            RETURNING guidance_reached_at`,
          [session.id, participantHash, now]
        );
        if (!updated.rows[0]) return { noTrace: true };
        return { row: updated.rows[0] };
      });
      if (result.notFound) return res.status(404).json({ error: "Unknown self-audit session" });
      if (result.noTrace) return res.status(409).json({ error: "Select a diagnostic target before guidance" });
      res.json({ ok: true, ...result.row });
    })
  );

  router.post(
    "/sessions/:sessionId/resolution",
    asyncRoute(async (req, res) => {
      const token = tokenFromBody(req.body);
      const result = await withTransaction(pool, async (client) => {
        const session = await loadSession(client, req.params.sessionId, { lock: true });
        if (!session) return { notFound: true };
        if (session.closed_at) return { conflict: "Session is closed" };
        const participantHash = hashParticipantToken(session.id, token);
        const traceResult = await client.query(
          `SELECT * FROM response_traces
            WHERE session_id = $1 AND participant_token_hash = $2
            FOR UPDATE`,
          [session.id, participantHash]
        );
        const trace = traceResult.rows[0];
        if (!trace?.committed_diagnostic_profile) return { noTrace: true };
        if (!trace.diagnostic_target_id) return { conflict: "Select a diagnostic target first" };
        if (!trace.guidance_reached_at) return { conflict: "Review the targeted guidance before rerating" };
        if (trace.completed_at) return { conflict: "Self-audit is already complete" };

        const validation = validateDiagnosticRerating(
          session.config_snapshot,
          trace.committed_diagnostic_profile,
          trace.diagnostic_target_id,
          req.body?.rating
        );
        if (!validation.valid) return { badRequest: validation.errors.join("; ") };

        const now = new Date();
        const updated = await client.query(
          `UPDATE response_traces
              SET resolution_state = 'diagnostic_rerating',
                  final_diagnostic_profile = $3::jsonb,
                  completed_at = $4,
                  updated_at = $4
            WHERE session_id = $1 AND participant_token_hash = $2
            RETURNING *`,
          [session.id, participantHash, JSON.stringify(validation.finalProfile), now]
        );
        return {
          trace: updated.rows[0],
          originalRating: validation.originalRating,
          finalRating: validation.finalRating,
        };
      });

      if (result.notFound) return res.status(404).json({ error: "Unknown self-audit session" });
      if (result.noTrace) return res.status(404).json({ error: "No committed diagnostic profile" });
      if (result.badRequest) return res.status(400).json({ error: result.badRequest });
      if (result.conflict) return res.status(409).json({ error: result.conflict });
      res.json({
        ok: true,
        target_id: result.trace.diagnostic_target_id,
        original_rating: result.originalRating,
        final_rating: result.finalRating,
        final_profile: result.trace.final_diagnostic_profile,
      });
    })
  );

  router.get(
    "/sessions/:sessionId/personal",
    asyncRoute(async (req, res) => {
      const session = await loadSession(pool, req.params.sessionId);
      if (!session) return res.status(404).json({ error: "Unknown self-audit session" });
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
      if (!rows[0]) return res.status(404).json({ error: "No self-audit response for this session" });
      res.json(tracePersonalPayload(session, rows[0]));
    })
  );

  router.get(
    "/sessions/:sessionId/lecturer",
    lecturerOnly,
    asyncRoute(async (req, res) => {
      const session = await loadSession(pool, req.params.sessionId);
      if (!session) return res.status(404).json({ error: "Unknown self-audit session" });
      const { rows } = await pool.query(
        `SELECT committed_diagnostic_profile, diagnostic_target_id
           FROM response_traces
          WHERE session_id = $1
            AND committed_diagnostic_profile IS NOT NULL`,
        [session.id]
      );
      res.json({
        ...publicSessionState(session),
        diagnostic: buildDiagnosticAggregate(session.config_snapshot, rows),
      });
    })
  );

  router.post(
    "/sessions/:sessionId/close",
    lecturerOnly,
    asyncRoute(async (req, res) => {
      const session = await loadSession(pool, req.params.sessionId);
      if (!session) return res.status(404).json({ error: "Unknown self-audit session" });
      const { rows } = await pool.query(
        `UPDATE activity_sessions
            SET closed_at = COALESCE(closed_at, now()),
                updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [req.params.sessionId]
      );
      res.json({ ok: true, ...publicSessionState(rows[0]) });
    })
  );

  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof CwdSelfAuditConfigError) {
      console.error("Invalid Stage 3 CWD self-audit configuration", error.errors);
      return res.status(500).json({ error: "Invalid self-audit activity configuration" });
    }
    if (error?.status) return res.status(error.status).json({ error: error.message });
    console.error("Stage 3 CWD self-audit API error", error);
    res.status(500).json({ error: "Stage 3 CWD self-audit backend error" });
  });

  return router;
}
