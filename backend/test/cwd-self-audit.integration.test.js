import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import pg from "pg";
import { createStage3CwdSelfAuditRouter } from "../stage3-cwd-self-audit.js";

const { Pool } = pg;
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const ACTIVITY_ID = "b1141-w9-audit-own-confidence";
const LECTURER_KEY = "stage3-self-audit-integration-key";

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
  "Stage 3 CWD self-audit persists diagnostic profile, target, guidance and rerating",
  { skip: !DATABASE_URL },
  async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    let server;

    try {
      await pool.query("UPDATE activities SET active = true WHERE id = $1", [ACTIVITY_ID]);
      await pool.query("DELETE FROM activity_sessions WHERE activity_id = $1", [ACTIVITY_ID]);

      const app = express();
      app.use(express.json());
      app.use("/api/cwd/audit", createStage3CwdSelfAuditRouter({ pool, lecturerKey: LECTURER_KEY }));
      server = await new Promise((resolve) => {
        const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
      });
      const address = server.address();
      const baseUrl = `http://127.0.0.1:${address.port}/api/cwd/audit`;

      const activity = await jsonRequest(baseUrl, `/activities/${ACTIVITY_ID}`);
      assert.equal(activity.response.status, 200);
      assert.equal(activity.payload.variant, "self_audit");
      assert.equal(activity.payload.config.judgement.semantics, "diagnostic_rating");
      assert.equal(activity.payload.config.judgement.items.length, 6);
      assert.equal(activity.payload.config.confidence.enabled, false);
      assert.equal(activity.payload.config.lecturer.projector_summary, false);

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
      assert.equal(created.payload.phase, "open");
      const sessionId = created.payload.id;

      const snapshot = await pool.query(
        `SELECT variant_snapshot, config_snapshot, confidence_scale_snapshot
           FROM activity_sessions
          WHERE id = $1`,
        [sessionId]
      );
      assert.equal(snapshot.rows[0].variant_snapshot, "self_audit");
      assert.equal(snapshot.rows[0].config_snapshot.judgement.items.length, 6);
      assert.equal(snapshot.rows[0].confidence_scale_snapshot, null);

      const token = "self-audit-participant-token-123456";
      const ratings = {
        functionalism: 2,
        conflict_hegemony: 1,
        intersectionality: 1,
        self_determination: 3,
        foucault_surveillance: 2,
        ethical_frameworks: 3,
      };

      const profile = await jsonRequest(baseUrl, `/sessions/${sessionId}/profile`, {
        method: "POST",
        body: { token, ratings },
      });
      assert.equal(profile.response.status, 200);
      assert.deepEqual(profile.payload.target_candidates, ["conflict_hegemony", "intersectionality"]);

      const invalidTarget = await jsonRequest(baseUrl, `/sessions/${sessionId}/target`, {
        method: "POST",
        body: { token, item_id: "functionalism" },
      });
      assert.equal(invalidTarget.response.status, 400);
      assert.deepEqual(invalidTarget.payload.target_candidates, ["conflict_hegemony", "intersectionality"]);

      const target = await jsonRequest(baseUrl, `/sessions/${sessionId}/target`, {
        method: "POST",
        body: { token, item_id: "intersectionality" },
      });
      assert.equal(target.response.status, 200);
      assert.equal(target.payload.target_id, "intersectionality");
      assert.match(target.payload.guidance.text, /social positions/i);

      const beforeGuidanceResolution = await jsonRequest(baseUrl, `/sessions/${sessionId}/resolution`, {
        method: "POST",
        body: { token, rating: 2 },
      });
      assert.equal(beforeGuidanceResolution.response.status, 409);

      const progress = await jsonRequest(baseUrl, `/sessions/${sessionId}/progress`, {
        method: "POST",
        body: { token, event: "guidance_reached" },
      });
      assert.equal(progress.response.status, 200);

      const resolution = await jsonRequest(baseUrl, `/sessions/${sessionId}/resolution`, {
        method: "POST",
        body: { token, rating: 2 },
      });
      assert.equal(resolution.response.status, 200);
      assert.equal(resolution.payload.target_id, "intersectionality");
      assert.equal(resolution.payload.original_rating, 1);
      assert.equal(resolution.payload.final_rating, 2);
      assert.equal(resolution.payload.final_profile.intersectionality, 2);
      assert.equal(resolution.payload.final_profile.conflict_hegemony, 1);

      const personal = await jsonRequest(baseUrl, `/sessions/${sessionId}/personal?token=${encodeURIComponent(token)}`);
      assert.equal(personal.response.status, 200);
      assert.equal(personal.payload.completed, true);
      assert.equal(personal.payload.guidance_reached, true);
      assert.equal(personal.payload.target_id, "intersectionality");

      const stored = await pool.query(
        `SELECT participant_token_hash,
                committed_option_id,
                committed_confidence,
                committed_diagnostic_profile,
                diagnostic_target_id,
                final_diagnostic_profile,
                resolution_state,
                included_in_reveal
           FROM response_traces
          WHERE session_id = $1`,
        [sessionId]
      );
      assert.equal(stored.rows.length, 1);
      assert.match(stored.rows[0].participant_token_hash, /^[0-9a-f]{64}$/);
      assert.notEqual(stored.rows[0].participant_token_hash, token);
      assert.equal(stored.rows[0].committed_option_id, null);
      assert.equal(stored.rows[0].committed_confidence, null);
      assert.equal(stored.rows[0].committed_diagnostic_profile.intersectionality, 1);
      assert.equal(stored.rows[0].final_diagnostic_profile.intersectionality, 2);
      assert.equal(stored.rows[0].diagnostic_target_id, "intersectionality");
      assert.equal(stored.rows[0].resolution_state, "diagnostic_rerating");
      assert.equal(stored.rows[0].included_in_reveal, false);

      const lecturer = await jsonRequest(baseUrl, `/sessions/${sessionId}/lecturer`, { lecturer: true });
      assert.equal(lecturer.response.status, 200);
      assert.equal(lecturer.payload.diagnostic.total_profiles, 1);
      assert.equal(lecturer.payload.diagnostic.items.intersectionality.ratings["1"], 1);
      assert.equal(lecturer.payload.diagnostic.items.intersectionality.targeted, 1);

      const close = await jsonRequest(baseUrl, `/sessions/${sessionId}/close`, {
        method: "POST",
        body: {},
        lecturer: true,
      });
      assert.equal(close.response.status, 200);
      assert.equal(close.payload.closed, true);

      const nextSession = await jsonRequest(baseUrl, `/activities/${ACTIVITY_ID}/sessions`, {
        method: "POST",
        body: {},
        lecturer: true,
      });
      assert.equal(nextSession.response.status, 201);
      assert.notEqual(nextSession.payload.id, sessionId);
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      await pool.query("UPDATE activities SET active = false WHERE id = $1", [ACTIVITY_ID]).catch(() => {});
      await pool.end();
    }
  }
);
