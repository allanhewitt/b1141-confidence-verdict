import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import pg from "pg";
import { createStage3CwdRouter } from "../stage3-cwd.js";

const { Pool } = pg;
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const ACTIVITY_ID = "b1141-w2-bad-apple-or-system-cwd";
const LECTURER_KEY = "stage3-delayed-integration-key";

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
  try { payload = await response.json(); } catch { payload = null; }
  return { response, payload };
}

test(
  "Stage 3 CWD delays final response until lecturer reopens it",
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
      const { port } = server.address();
      const baseUrl = `http://127.0.0.1:${port}/api/cwd`;

      const activity = await jsonRequest(baseUrl, `/activities/${ACTIVITY_ID}`);
      assert.equal(activity.response.status, 200);
      assert.equal(activity.payload.variant, "social_delayed");
      assert.equal(activity.payload.config.resolution.release, "lecturer_controlled");
      assert.equal(activity.payload.config.lecturer.pre_reveal_view, "response_count_only");

      const created = await jsonRequest(baseUrl, `/activities/${ACTIVITY_ID}/sessions`, {
        method: "POST", body: {}, lecturer: true,
      });
      assert.equal(created.response.status, 201);
      const sessionId = created.payload.id;
      const token = "delayed-participant-token-123456";

      const response = await jsonRequest(baseUrl, `/sessions/${sessionId}/response`, {
        method: "POST",
        body: { token, option_id: "system", confidence: 3 },
      });
      assert.equal(response.response.status, 200);
      assert.equal(response.payload.revealed, false);

      const before = await jsonRequest(baseUrl, `/sessions/${sessionId}/lecturer`, { lecturer: true });
      assert.equal(before.response.status, 200);
      assert.equal(before.payload.live_total, 1);
      assert.equal(before.payload.cohort, null);

      const reveal = await jsonRequest(baseUrl, `/sessions/${sessionId}/reveal`, {
        method: "POST", body: {}, lecturer: true,
      });
      assert.equal(reveal.response.status, 200);
      assert.equal(reveal.payload.phase, "revealed_waiting_for_resolution");
      assert.equal(reveal.payload.resolution_available, false);

      const blocked = await jsonRequest(baseUrl, `/sessions/${sessionId}/resolution`, {
        method: "POST",
        body: {
          token,
          resolution_state: "same_similar_confidence",
          final_option_id: "system",
          final_confidence: 3,
        },
      });
      assert.equal(blocked.response.status, 409);

      const opened = await jsonRequest(baseUrl, `/sessions/${sessionId}/resolution/open`, {
        method: "POST", body: {}, lecturer: true,
      });
      assert.equal(opened.response.status, 200);
      assert.equal(opened.payload.phase, "resolution_open");
      assert.equal(opened.payload.resolution_available, true);

      const resolution = await jsonRequest(baseUrl, `/sessions/${sessionId}/resolution`, {
        method: "POST",
        body: {
          token,
          resolution_state: "same_more_confident",
          final_option_id: "system",
          final_confidence: 4,
        },
      });
      assert.equal(resolution.response.status, 200);
      assert.equal(resolution.payload.final_option_id, "system");
      assert.equal(resolution.payload.final_confidence, 4);

      const personal = await jsonRequest(
        baseUrl,
        `/sessions/${sessionId}/personal?token=${encodeURIComponent(token)}`
      );
      assert.equal(personal.response.status, 200);
      assert.equal(personal.payload.completed, true);

      const close = await jsonRequest(baseUrl, `/sessions/${sessionId}/close`, {
        method: "POST", body: {}, lecturer: true,
      });
      assert.equal(close.response.status, 200);
      assert.equal(close.payload.closed, true);
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      await pool.query("DELETE FROM activity_sessions WHERE activity_id = $1", [ACTIVITY_ID]).catch(() => {});
      await pool.query("UPDATE activities SET active = false WHERE id = $1", [ACTIVITY_ID]).catch(() => {});
      await pool.end();
    }
  }
);
