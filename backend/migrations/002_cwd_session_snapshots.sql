-- CWD Stage 3 session snapshot hardening
-- 2026-08-31
--
-- Purpose:
--   Preserve the exact CWD interpretation context used by each classroom
--   session so later Stage 4 changes to an activity do not retrospectively
--   alter historical response traces. Also prevent more than one open session
--   for the same activity.
--
-- Migration 001 created activity_sessions before any Stage 3 session rows were
-- written. This migration is designed to run before the Stage 3 backend is
-- enabled. If incompatible pre-existing session rows are found, it aborts
-- rather than silently creating incomplete historical snapshots.

BEGIN;

ALTER TABLE activity_sessions
  ADD COLUMN IF NOT EXISTS model_snapshot TEXT;

ALTER TABLE activity_sessions
  ADD COLUMN IF NOT EXISTS variant_snapshot TEXT;

ALTER TABLE activity_sessions
  ADD COLUMN IF NOT EXISTS config_snapshot JSONB;

ALTER TABLE activity_sessions
  ADD COLUMN IF NOT EXISTS schema_version_snapshot INTEGER;

ALTER TABLE activity_sessions
  ADD COLUMN IF NOT EXISTS confidence_scale_snapshot JSONB;

-- Backfill is included for defensive replay. In the controlled 31 August 2026
-- migration sequence activity_sessions is empty at this point.
UPDATE activity_sessions s
SET
  model_snapshot = a.model,
  variant_snapshot = a.variant,
  config_snapshot = a.config,
  schema_version_snapshot = a.schema_version,
  confidence_scale_snapshot = CASE
    WHEN COALESCE((a.config #>> '{confidence,enabled}')::boolean, false) = false THEN NULL
    ELSE (
      SELECT jsonb_build_object(
        'id', cs.id,
        'name', cs.name,
        'schema_version', cs.schema_version,
        'points', cs.points
      )
      FROM confidence_scales cs
      WHERE cs.id = a.config #>> '{confidence,scale_id}'
    )
  END
FROM activities a
WHERE a.id = s.activity_id
  AND (
    s.model_snapshot IS NULL
    OR s.variant_snapshot IS NULL
    OR s.config_snapshot IS NULL
    OR s.schema_version_snapshot IS NULL
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM activity_sessions
    WHERE model_snapshot IS NULL
       OR variant_snapshot IS NULL
       OR config_snapshot IS NULL
       OR schema_version_snapshot IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot apply CWD session snapshot constraints: existing activity_sessions rows lack a complete Stage 3 activity snapshot';
  END IF;
END
$$;

ALTER TABLE activity_sessions
  ALTER COLUMN model_snapshot SET NOT NULL;

ALTER TABLE activity_sessions
  ALTER COLUMN variant_snapshot SET NOT NULL;

ALTER TABLE activity_sessions
  ALTER COLUMN config_snapshot SET NOT NULL;

ALTER TABLE activity_sessions
  ALTER COLUMN schema_version_snapshot SET NOT NULL;

ALTER TABLE activity_sessions
  DROP CONSTRAINT IF EXISTS chk_activity_session_snapshot_model;

ALTER TABLE activity_sessions
  ADD CONSTRAINT chk_activity_session_snapshot_model
  CHECK (
    model_snapshot = 'confidence_weighted_response'
    AND variant_snapshot IN ('social_immediate', 'social_delayed')
    AND jsonb_typeof(config_snapshot) = 'object'
    AND schema_version_snapshot > 0
  );

ALTER TABLE activity_sessions
  DROP CONSTRAINT IF EXISTS chk_activity_session_confidence_snapshot;

ALTER TABLE activity_sessions
  ADD CONSTRAINT chk_activity_session_confidence_snapshot
  CHECK (
    confidence_scale_snapshot IS NULL
    OR (
      jsonb_typeof(confidence_scale_snapshot) = 'object'
      AND jsonb_typeof(confidence_scale_snapshot -> 'points') = 'array'
    )
  );

-- A classroom activity has one current run. Closing a session releases the
-- activity for a fresh session while preserving the historical row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_activity_sessions_one_open
  ON activity_sessions(activity_id)
  WHERE closed_at IS NULL;

COMMIT;

-- Read-only post-migration checks:
--
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'activity_sessions'
-- ORDER BY ordinal_position;
--
-- SELECT COUNT(*) FROM activity_sessions;
--
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE tablename = 'activity_sessions'
-- ORDER BY indexname;
