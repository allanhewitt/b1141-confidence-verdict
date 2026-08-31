import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import pg from "pg";
import { createStage3CwdRouter } from "../stage3-cwd.js";

const { Pool } = pg;
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const ACTIVITY_ID = "b1141-w1-who-is-excluded";
const LECTURER_KEY = "stage3-integration-test-key";

async function jsonRequest(baseUrl, path, { method = "GET", body, lecturer = false } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (lecturer) headers["X-GEDL-Lecturer-Key"] = LECTURER_KEY;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { response, payload };
}

test(
  "Stage 3 CWD persists a complete immediate social session against PostgreSQL",
  { skip: !DATABASE_URL },
  async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    let server;

    try {
      await pool.query("UPDATE activities SET active = true WHERE id = $1", [ACTIVITY_ID]);
      await pool.query("DELETE FROM activity_sessions WHERE activity_id = $1", [ACTIVITY_ID]);

      const app = express();
      app.use(express.json());
      app.use("/api/cwd", createStage3CwdRouter({ pool, lecturerKey: LECTURER_KEY }));
      server = await new Promise((resolve) => {
        const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
      });
      const address = server.address();
      const baseUrl = `http://127.0.0.1:${address.port}/api/cwd`;

      const activity = await jsonRequest(baseUrl, `/activities/${ACTIVITY_ID}`);
      assert.equal(activity.response.status, 200);
      assert.equal(activity.payload.model, "confidence_weighted_response");
      assert.equal(activity.payload.variant, "social_immediate");
      assert.equal(activity.payload.confidence_scale.points.length, 5);
      assert.deepEqual(activity.payload.config.evaluation.accepted_option_ids, []);

      const deniedCreate = await jsonRequest(baseUrl, `/activities/${ACTIVITY_ID}/sessions`, {
        method: "POST",
        body: {},
      });
      assert.equal(deniedCreate.response.status, 401);

      const created = await jsonRequest(baseUrl, `/activities/${ACTIVITY_ID}/sessions`, {
        method: "POST",
        body: {},
        lecturer: true,
      });
      assert.equal(created.response.status, 201);
      assert.equal(created.payload.created, true);
      assert.equal(created.payload.phase, "collecting");
      const sessionId = created.payload.id;
      assert.match(sessionId, /^[0-9a-f-]{36}$/i);

      const snapshot = await pool.query(
        `SELECT model_snapshot,
                variant_snapshot,
                schema_version_snapshot,
                config_snapshot,
                confidence_scale_snapshot
           FROM activity_sessions
          WHERE id = $1`,
        [sessionId]
      );
      assert.equal(snapshot.rows.length, 1);
      assert.equal(snapshot.rows[0].model_snapshot, "confidence_weighted_response");
      assert.equal(snapshot.rows[0].variant_snapshot, "social_immediate");
      assert.equal(snapshot.rows[0].schema_version_snapshot, 1);
      assert.equal(snapshot.rows[0].config_snapshot.judgement.options.length, 4);
      assert.equal(snapshot.rows[0].confidence_scale_snapshot.points.length, 5);

      const duplicateCreate = await jsonRequest(baseUrl, `/activities/${ACTIVITY_ID}/sessions`, {
        method: "POST",
        body: {},
        lecturer: true,
      });
      assert.equal(duplicateCreate.response.status, 200);
      assert.equal(duplicateCreate.payload.created, false);
      assert.equal(duplicateCreate.payload.id, sessionId);

      const tokenA = "participant-token-A-123456";
      const tokenB = "participant-token-B-123456";
      const tokenC = "participant-token-C-123456";

      const responseA1 = await jsonRequest(baseUrl, `/sessions/${sessionId}/response`, {
        method: "POST",
        body: { token: tokenA, option_id: "health", confidence: 4 },
      });
      assert.equal(responseA1.response.status, 200);
      assert.equal(responseA1.payload.count, 1);
      assert.equal(responseA1.payload.revealed, false);

      const responseA2 = await jsonRequest(baseUrl, `/sessions/${sessionId}/response`, {
        method: "POST",
        body: { token: tokenA, option_id: "belonging", confidence: 3 },
      });
      assert.equal(responseA2.response.status, 200);
      assert.equal(responseA2.payload.count, 1);

      const responseB = await jsonRequest(baseUrl, `/sessions/${sessionId}/response`, {
        method: "POST",
        body: { token: tokenB, option_id: "identity", confidence: 5 },
      });
      assert.equal(responseB.response.status, 200);
      assert.equal(responseB.payload.count, 2);

      const persistedBeforeReveal = await pool.query(
        `SELECT participant_token_hash, current_option_id, current_confidence, committed_at
           FROM response_traces
          WHERE session_id = $1
          ORDER BY current_option_id`,
        [sessionId]
      );
      assert.equal(persistedBeforeReveal.rows.length, 2);
      for (const row of persistedBeforeReveal.rows) {
        assert.match(row.participant_token_hash, /^[0-9a-f]{64}$/);
        assert.notEqual(row.participant_token_hash, tokenA);
        assert.notEqual(row.participant_token_hash, tokenB);
        assert.equal(row.committed_at, null);
      }

      const lecturerBeforeReveal = await jsonRequest(baseUrl, `/sessions/${sessionId}/lecturer`, {
        lecturer: true,
      });
      assert.equal(lecturerBeforeReveal.response.status, 200);
      assert.equal(lecturerBeforeReveal.payload.live_total, 2);
      assert.equal(lecturerBeforeReveal.payload.cohort, null);

      const aggregateBeforeReveal = await jsonRequest(baseUrl, `/sessions/${sessionId}/aggregate`);
      assert.equal(aggregateBeforeReveal.response.status, 200);
      assert.equal(aggregateBeforeReveal.payload.cohort, null);

      const deniedReveal = await jsonRequest(baseUrl, `/sessions/${sessionId}/reveal`, {
        method: "POST",
      });
      assert.equal(deniedReveal.response.status, 401);

      const reveal = await jsonRequest(baseUrl, `/sessions/${sessionId}/reveal`, {
        method: "POST",
        lecturer: true,
      });
      assert.equal(reveal.response.status, 200);
      assert.equal(reveal.payload.revealed, true);
      assert.equal(reveal.payload.resolution_available, true);

      const committed = await pool.query(
        `SELECT current_option_id,
                current_confidence,
                committed_option_id,
                committed_confidence,
                included_in_reveal,
                committed_at
           FROM response_traces
          WHERE session_id = $1
          ORDER BY current_option_id`,
        [sessionId]
      );
      assert.equal(committed.rows.length, 2);
      assert.ok(committed.rows.every((row) => row.included_in_reveal));
      assert.ok(committed.rows.every((row) => row.committed_at));
      const committedA = committed.rows.find((row) => row.current_option_id === "belonging");
      assert.equal(committedA.committed_option_id, "belonging");
      assert.equal(committedA.committed_confidence, 3);

      const aggregate = await jsonRequest(baseUrl, `/sessions/${sessionId}/aggregate`);
      assert.equal(aggregate.response.status, 200);
      assert.equal(aggregate.payload.cohort.total, 2);
      assert.equal(aggregate.payload.cohort.matrix.belonging[2], 1);
      assert.equal(aggregate.payload.cohort.matrix.identity[4], 1);

      const late = await jsonRequest(baseUrl, `/sessions/${sessionId}/response`, {
        method: "POST",
        body: { token: tokenC, option_id: "opportunity", confidence: 2 },
      });
      assert.equal(late.response.status, 200);
      assert.equal(late.payload.late, true);
      assert.equal(late.payload.count, 3);

      const lateTrace = await jsonRequest(
        baseUrl,
        `/sessions/${sessionId}/personal?token=${encodeURIComponent(tokenC)}`
      );
      assert.equal(lateTrace.response.status, 200);
      assert.equal(lateTrace.payload.included_in_reveal, false);
      assert.equal(lateTrace.payload.peers_total, 2);
      assert.equal(lateTrace.payload.cohort.total, 2);

      const locked = await jsonRequest(baseUrl, `/sessions/${sessionId}/response`, {
        method: "POST",
        body: { token: tokenA, option_id: "health", confidence: 5 },
      });
      assert.equal(locked.response.status, 409);

      const progress = await jsonRequest(baseUrl, `/sessions/${sessionId}/progress`, {
        method: "POST",
        body: { token: tokenA, event: "guidance_reached" },
      });
      assert.equal(progress.response.status, 200);
      assert.ok(progress.payload.reveal_encountered_at);
      assert.ok(progress.payload.guidance_reached_at);

      const resolution = await jsonRequest(baseUrl, `/sessions/${sessionId}/resolution`, {
        method: "POST",
        body: {
          token: tokenA,
          resolution_state: "same_more_confident",
          final_option_id: "belonging",
          final_confidence: 5,
        },
      });
      assert.equal(resolution.response.status, 200);
      assert.equal(resolution.payload.resolution_state, "same_more_confident");
      assert.equal(resolution.payload.final_option_id, "belonging");
      assert.equal(resolution.payload.final_confidence, 5);
      assert.equal(resolution.payload.correctness, null);

      const completed = await pool.query(
        `SELECT resolution_state, final_option_id, final_confidence, completed_at
           FROM response_traces
          WHERE session_id = $1
            AND current_option_id = 'belonging'`,
        [sessionId]
      );
      assert.equal(completed.rows[0].resolution_state, "same_more_confident");
      assert.equal(completed.rows[0].final_option_id, "belonging");
      assert.equal(completed.rows[0].final_confidence, 5);
      assert.ok(completed.rows[0].completed_at);

      const close = await jsonRequest(baseUrl, `/sessions/${sessionId}/close`, {
        method: "POST",
        lecturer: true,
      });
      assert.equal(close.response.status, 200);
      assert.equal(close.payload.phase, "closed");

      const nextSession = await jsonRequest(baseUrl, `/activities/${ACTIVITY_ID}/sessions`, {
        method: "POST",
        body: {},
        lecturer: true,
      });
      assert.equal(nextSession.response.status, 201);
      assert.notEqual(nextSession.payload.id, sessionId);
    } finally {
      if (server) {
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        );
      }
      try {
        await pool.query("DELETE FROM activity_sessions WHERE activity_id = $1", [ACTIVITY_ID]);
        await pool.query("UPDATE activities SET active = false WHERE id = $1", [ACTIVITY_ID]);
      } finally {
        await pool.end();
      }
    }
  }
);
