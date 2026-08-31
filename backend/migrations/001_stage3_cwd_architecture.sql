-- CWD Stage 3 additive architecture migration
-- 2026-08-31
--
-- Purpose:
--   Add the persistent, versioned structures required by the approved
--   Confidence-Weighted Response (CWD) Stage 3 architecture while preserving
--   all legacy tables/columns for compatibility and rollback.
--
-- This migration is intentionally non-destructive:
--   * no legacy columns are dropped;
--   * the legacy responses table is retained;
--   * existing server/frontend code can continue to operate until the
--     application is explicitly switched to the Stage 3 path;
--   * only an explicitly audited CWD development instance is backfilled;
--   * other legacy activity rows remain unclassified until reconciled against
--     the current model repertoire;
--   * keyed activities must never acquire answer disclosure automatically.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Extend activity identity with a versioned semantic configuration object.
-- ---------------------------------------------------------------------------

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS model TEXT;

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS variant TEXT;

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS title TEXT;

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS config JSONB;

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS schema_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Current CWD Stage 3 scope is deliberately bounded to the two validated
-- social variants. The constraint applies only when a row is classified as CWD.
ALTER TABLE activities
  DROP CONSTRAINT IF EXISTS chk_cwd_variant;

ALTER TABLE activities
  ADD CONSTRAINT chk_cwd_variant
  CHECK (
    model IS DISTINCT FROM 'confidence_weighted_response'
    OR variant IN ('social_immediate', 'social_delayed')
  );

-- ---------------------------------------------------------------------------
-- 2. Reusable confidence-scale registry.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS confidence_scales (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  points JSONB NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_confidence_scale_points_array
    CHECK (jsonb_typeof(points) = 'array')
);

INSERT INTO confidence_scales (id, name, points, schema_version, active)
VALUES (
  'confidence_5',
  'Five-point confidence scale',
  '[
    {"value":1,"label":"Not at all confident"},
    {"value":2,"label":"Slightly confident"},
    {"value":3,"label":"Moderately confident"},
    {"value":4,"label":"Very confident"},
    {"value":5,"label":"Extremely confident"}
  ]'::jsonb,
  1,
  true
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Persistent classroom/session orchestration.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS activity_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id TEXT NOT NULL REFERENCES activities(id),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revealed_at TIMESTAMPTZ,
  resolution_opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  expected_cohort_size INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_session_cohort_size
    CHECK (expected_cohort_size IS NULL OR expected_cohort_size > 0),
  CONSTRAINT chk_session_temporal_order
    CHECK (
      (revealed_at IS NULL OR revealed_at >= opened_at)
      AND (resolution_opened_at IS NULL OR revealed_at IS NOT NULL)
      AND (resolution_opened_at IS NULL OR resolution_opened_at >= revealed_at)
      AND (closed_at IS NULL OR closed_at >= opened_at)
    )
);

CREATE INDEX IF NOT EXISTS idx_activity_sessions_activity
  ON activity_sessions(activity_id, opened_at DESC);

-- ---------------------------------------------------------------------------
-- 4. One persistent learner trace per anonymous participant per session.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS response_traces (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES activity_sessions(id) ON DELETE CASCADE,
  participant_token_hash TEXT NOT NULL,

  current_option_id TEXT,
  current_confidence INTEGER,

  committed_option_id TEXT,
  committed_confidence INTEGER,
  committed_at TIMESTAMPTZ,

  included_in_reveal BOOLEAN NOT NULL DEFAULT false,

  reveal_encountered_at TIMESTAMPTZ,
  guidance_reached_at TIMESTAMPTZ,

  resolution_state TEXT,
  final_option_id TEXT,
  final_confidence INTEGER,

  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_response_trace_session_participant
    UNIQUE(session_id, participant_token_hash),

  CONSTRAINT chk_response_trace_resolution_state
    CHECK (
      resolution_state IS NULL
      OR resolution_state IN (
        'retain_more_confident',
        'retain_less_confident',
        'retain_similar_confidence',
        'change_judgement',
        'retain',
        'qualify',
        'revise'
      )
    ),

  CONSTRAINT chk_response_trace_commit_consistency
    CHECK (
      (committed_at IS NULL AND committed_option_id IS NULL AND committed_confidence IS NULL)
      OR
      (committed_at IS NOT NULL AND committed_option_id IS NOT NULL)
    ),

  CONSTRAINT chk_response_trace_temporal_order
    CHECK (
      (reveal_encountered_at IS NULL OR committed_at IS NOT NULL)
      AND (guidance_reached_at IS NULL OR reveal_encountered_at IS NOT NULL)
      AND (completed_at IS NULL OR committed_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_response_traces_session
  ON response_traces(session_id);

CREATE INDEX IF NOT EXISTS idx_response_traces_committed_option
  ON response_traces(session_id, committed_option_id)
  WHERE committed_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Conservative semantic backfill: one audited CWD development instance.
-- ---------------------------------------------------------------------------
--
-- The repository contains legacy activities whose model classification may no
-- longer match the current GEDL repertoire. Stage 3 therefore does not infer
-- CWD membership from repository location. Only the explicitly audited
-- development instance is classified/backfilled here.
--
-- "Who Is Excluded?" is the approved CWD development instance. It is non-keyed
-- and currently uses the social_immediate variant. Guidance/resolution content
-- remains configuration data and can be enriched as the engine is wired to the
-- canonical Stage 2 instance specification.

UPDATE activities
SET
  model = 'confidence_weighted_response',
  variant = 'social_immediate',
  title = COALESCE(title, 'Who Is Excluded?'),
  config = COALESCE(
    config,
    jsonb_build_object(
      'judgement', jsonb_build_object(
        'mode', 'single',
        'semantics', 'categorical',
        'prompt', question,
        'options', (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', 'option_' || ordinality,
              'label', value,
              'order', ordinality
            )
            ORDER BY ordinality
          )
          FROM jsonb_array_elements_text(options) WITH ORDINALITY AS legacy(value, ordinality)
        )
      ),
      'evaluation', jsonb_build_object(
        'mode', 'non_keyed',
        'accepted_option_ids', jsonb_build_array(),
        'reveal_stage', 'never'
      ),
      'confidence', jsonb_build_object(
        'enabled', true,
        'prompt', 'How confident are you in your judgement?',
        'scale_id', CASE
          WHEN confidence_points = 5 THEN 'confidence_5'
          ELSE NULL
        END,
        'legacy_points', confidence_points
      ),
      'confrontation', jsonb_build_object(
        'source', 'cohort',
        'reveal_mode', CASE
          WHEN reveal_mode = 'manual' THEN 'lecturer_gated'
          ELSE 'automatic'
        END,
        'automatic_rule', CASE
          WHEN reveal_mode = 'threshold' THEN 'threshold'
          WHEN reveal_mode = 'immediate' THEN 'immediate'
          ELSE NULL
        END,
        'threshold', reveal_threshold,
        'expected_cohort_size', cohort_size,
        'required_outputs', jsonb_build_array(
          'response_count',
          'judgement_distribution',
          'confidence_by_judgement',
          'overall_confidence',
          'learner_original_position'
        )
      ),
      'guidance', jsonb_build_object(
        'source', 'in_app',
        'content', jsonb_build_array()
      ),
      'resolution', jsonb_build_object(
        'profile', 'confidence_shift',
        'release', 'immediate',
        'allow_revised_judgement', true,
        'reassess_confidence', 'conditional'
      ),
      'lecturer', jsonb_build_object(
        'pre_reveal_view', 'response_count_only',
        'reveal_control', CASE
          WHEN reveal_mode = 'manual' THEN 'manual'
          ELSE 'automatic'
        END,
        'resolution_control', 'immediate',
        'post_reveal_metrics', jsonb_build_array(),
        'projector_summary', true,
        'reset_session', true
      )
    )
  ),
  schema_version = 1,
  updated_at = now()
WHERE id = 'b1141-w1-least-shared-benefit';

-- No other legacy activity is classified automatically. This query should
-- return the rows still requiring explicit model reconciliation after migration:
-- SELECT id, module, week, activity, question FROM activities WHERE model IS NULL;

-- ---------------------------------------------------------------------------
-- 6. Indexes useful for configuration lookup.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_activities_model_active
  ON activities(model, active);

CREATE INDEX IF NOT EXISTS idx_activities_config_gin
  ON activities USING GIN(config);

COMMIT;

-- ---------------------------------------------------------------------------
-- Post-migration verification suggestions (read-only):
-- ---------------------------------------------------------------------------
-- SELECT id, model, variant, schema_version, config->'evaluation'
-- FROM activities
-- ORDER BY module, week, sequence;
--
-- SELECT id, name, points FROM confidence_scales;
--
-- SELECT id, module, week, activity FROM activities WHERE model IS NULL;
--
-- \d activity_sessions
-- \d response_traces
--
-- No application code is switched by this migration alone.
