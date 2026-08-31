import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { validateCwdConfig } from "../lib/cwd.js";
import { validateCwdSelfAuditConfig } from "../lib/cwd-self-audit.js";

const { Pool } = pg;
const DATABASE_URL = process.env.TEST_DATABASE_URL;

const EXPECTED = [
  ["b1141-w1-who-is-excluded", 1, "social_immediate", "categorical", "confidence_shift"],
  ["b1141-w2-bad-apple-or-system-cwd", 2, "social_delayed", "bipolar", "confidence_shift"],
  ["b1141-w5-biometric-data", 5, "social_immediate", "ordinal", "retain_qualify_revise"],
  ["b1141-w6-sky-premier-league-1992", 6, "social_immediate", "bipolar", "retain_qualify_revise"],
  ["b1141-w7-universal-code", 7, "social_immediate", "ordinal", "retain_qualify_revise"],
  ["b1141-w9-audit-own-confidence", 9, "self_audit", "diagnostic_rating", "diagnostic_rerating"],
];

test(
  "all six canonical B1141 CWD configurations are present, inactive and runtime-valid",
  { skip: !DATABASE_URL },
  async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    try {
      const { rows } = await pool.query(
        `SELECT id, week, model, variant, config, schema_version, active
           FROM activities
          WHERE id = ANY($1::text[])
          ORDER BY week, id`,
        [EXPECTED.map(([id]) => id)]
      );

      assert.equal(rows.length, EXPECTED.length);
      const byId = new Map(rows.map((row) => [row.id, row]));

      for (const [id, week, variant, semantics, resolutionProfile] of EXPECTED) {
        const row = byId.get(id);
        assert.ok(row, `missing ${id}`);
        assert.equal(row.week, week);
        assert.equal(row.model, "confidence_weighted_response");
        assert.equal(row.variant, variant);
        assert.equal(row.schema_version, 1);
        assert.equal(row.active, false);
        assert.equal(row.config.judgement.semantics, semantics);
        assert.equal(row.config.resolution.profile, resolutionProfile);

        const validation = variant === "self_audit"
          ? validateCwdSelfAuditConfig(row.config, row.variant)
          : validateCwdConfig(row.config, row.variant);
        assert.deepEqual(validation, { valid: true, errors: [] }, `${id} failed runtime validation`);
      }

      const legacyW2 = await pool.query(
        `SELECT id, model, variant
           FROM activities
          WHERE id = 'b1141-w2-bad-apple-or-system'`
      );
      assert.equal(legacyW2.rows.length, 1);
      assert.equal(legacyW2.rows[0].model, null);
      assert.equal(legacyW2.rows[0].variant, null);
    } finally {
      await pool.end();
    }
  }
);
