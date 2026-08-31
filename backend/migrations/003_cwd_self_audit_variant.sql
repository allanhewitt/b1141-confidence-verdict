-- CWD Stage 3 self-audit extension
-- 2026-08-31
--
-- Purpose:
--   Extend the additive CWD Stage 3 architecture to support the validated
--   self_audit variant without disturbing the existing social engine or
--   legacy compatibility path.
--
-- The self-audit stores one multi-item diagnostic profile per anonymous
-- participant/session, identifies a weakest diagnostic target, records the
-- targeted guidance point, and preserves a full rerated final profile.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Permit the bounded self_audit variant in activity/session contracts.
-- ---------------------------------------------------------------------------

ALTER TABLE activities
  DROP CONSTRAINT IF EXISTS chk_cwd_stage3_contract;

ALTER TABLE activities
  ADD CONSTRAINT chk_cwd_stage3_contract
  CHECK (
    model IS DISTINCT FROM 'confidence_weighted_response'
    OR (
      variant IN ('social_immediate', 'social_delayed', 'self_audit')
      AND config IS NOT NULL
      AND schema_version IS NOT NULL
      AND schema_version > 0
    )
  );

ALTER TABLE activity_sessions
  DROP CONSTRAINT IF EXISTS chk_activity_session_snapshot_model;

ALTER TABLE activity_sessions
  ADD CONSTRAINT chk_activity_session_snapshot_model
  CHECK (
    model_snapshot = 'confidence_weighted_response'
    AND variant_snapshot IN ('social_immediate', 'social_delayed', 'self_audit')
    AND jsonb_typeof(config_snapshot) = 'object'
    AND schema_version_snapshot > 0
  );

-- ---------------------------------------------------------------------------
-- 2. Add self-audit trace fields alongside the existing scalar social fields.
-- ---------------------------------------------------------------------------

ALTER TABLE response_traces
  ADD COLUMN IF NOT EXISTS committed_diagnostic_profile JSONB;

ALTER TABLE response_traces
  ADD COLUMN IF NOT EXISTS diagnostic_target_id TEXT;

ALTER TABLE response_traces
  ADD COLUMN IF NOT EXISTS final_diagnostic_profile JSONB;

ALTER TABLE response_traces
  DROP CONSTRAINT IF EXISTS chk_response_trace_diagnostic_profiles;

ALTER TABLE response_traces
  ADD CONSTRAINT chk_response_trace_diagnostic_profiles
  CHECK (
    (committed_diagnostic_profile IS NULL OR jsonb_typeof(committed_diagnostic_profile) = 'object')
    AND (final_diagnostic_profile IS NULL OR jsonb_typeof(final_diagnostic_profile) = 'object')
  );

-- A committed trace is either a social scalar judgement or a self-audit
-- diagnostic profile. The two forms are mutually exclusive.
ALTER TABLE response_traces
  DROP CONSTRAINT IF EXISTS chk_response_trace_commit_consistency;

ALTER TABLE response_traces
  ADD CONSTRAINT chk_response_trace_commit_consistency
  CHECK (
    (
      committed_at IS NULL
      AND committed_option_id IS NULL
      AND committed_confidence IS NULL
      AND committed_diagnostic_profile IS NULL
    )
    OR
    (
      committed_at IS NOT NULL
      AND (
        (
          committed_option_id IS NOT NULL
          AND committed_diagnostic_profile IS NULL
        )
        OR
        (
          committed_option_id IS NULL
          AND committed_confidence IS NULL
          AND committed_diagnostic_profile IS NOT NULL
        )
      )
    )
  );

ALTER TABLE response_traces
  DROP CONSTRAINT IF EXISTS chk_response_trace_resolution_state;

ALTER TABLE response_traces
  ADD CONSTRAINT chk_response_trace_resolution_state
  CHECK (
    resolution_state IS NULL
    OR resolution_state IN (
      'same_more_confident',
      'same_less_confident',
      'same_similar_confidence',
      'different',
      'retain',
      'qualify',
      'revise',
      'diagnostic_rerating'
    )
  );

-- Social traces still require reveal before guidance in application logic.
-- The DB constraint is broadened because self_audit has an internal diagnostic
-- confrontation and therefore reaches guidance without a cohort reveal event.
ALTER TABLE response_traces
  DROP CONSTRAINT IF EXISTS chk_response_trace_temporal_order;

ALTER TABLE response_traces
  ADD CONSTRAINT chk_response_trace_temporal_order
  CHECK (
    (reveal_encountered_at IS NULL OR committed_at IS NOT NULL)
    AND (guidance_reached_at IS NULL OR committed_at IS NOT NULL)
    AND (completed_at IS NULL OR committed_at IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- 3. Add the canonical inactive Week 9 self-audit development instance.
-- ---------------------------------------------------------------------------

INSERT INTO activities (
  id,
  module,
  week,
  activity,
  sequence,
  question,
  options,
  confidence_points,
  correct_option,
  reveal_mode,
  reveal_threshold,
  cohort_size,
  active,
  model,
  variant,
  title,
  config,
  schema_version
)
VALUES (
  'b1141-w9-audit-own-confidence',
  'B1141',
  9,
  'audit-own-confidence',
  1,
  'For each lens, choose the statement that best describes where you are now.',
  '["Functionalism","Conflict Theory and Hegemony","Intersectionality","Self-Determination Theory","Foucault''s Surveillance","Ethical Frameworks"]'::jsonb,
  4,
  NULL,
  'manual',
  NULL,
  NULL,
  false,
  'confidence_weighted_response',
  'self_audit',
  'Audit Your Own Confidence',
  $config$
  {
    "entry": {
      "text": "Before we start applying the theories together, check what you can currently do with each one."
    },
    "judgement": {
      "mode": "multi_item",
      "semantics": "diagnostic_rating",
      "prompt": "For each lens, choose the statement that best describes where you are now.",
      "items": [
        {"id":"functionalism","label":"Functionalism","order":1},
        {"id":"conflict_hegemony","label":"Conflict Theory and Hegemony","order":2},
        {"id":"intersectionality","label":"Intersectionality","order":3},
        {"id":"self_determination","label":"Self-Determination Theory","order":4},
        {"id":"foucault_surveillance","label":"Foucault's Surveillance","order":5},
        {"id":"ethical_frameworks","label":"Ethical Frameworks","order":6}
      ],
      "scale": {
        "id":"theory_use_4",
        "name":"Theory-use diagnostic scale",
        "points":[
          {"value":0,"label":"I'm not yet sure what it does"},
          {"value":1,"label":"I recognise it and know broadly what it is about"},
          {"value":2,"label":"I can explain what it does"},
          {"value":3,"label":"I can apply it to a sporting case"}
        ]
      }
    },
    "evaluation": {
      "mode":"non_keyed",
      "accepted_option_ids":[],
      "reveal_stage":"never"
    },
    "confidence": {
      "enabled":false
    },
    "confrontation": {
      "source":"self_diagnostic",
      "reveal_mode":"not_applicable",
      "target_selection":"lowest_or_learner_choice_on_tie",
      "required_outputs":["personal_profile","lowest_rated_items"]
    },
    "guidance": {
      "source":"targeted_diagnostic",
      "content":[
        {
          "type":"diagnostic_cue",
          "target_item_id":"functionalism",
          "text":"Functionalism asks what function a practice or institution serves for the wider social system. In a sporting case, identify what it contributes, then ask what costs or exclusions that account may leave outside the frame."
        },
        {
          "type":"diagnostic_cue",
          "target_item_id":"conflict_hegemony",
          "text":"Conflict Theory asks who controls valued resources and who benefits. Hegemony adds the question of how unequal arrangements come to look normal or legitimate. In a case, identify interests, power and the story that makes the arrangement acceptable."
        },
        {
          "type":"diagnostic_cue",
          "target_item_id":"intersectionality",
          "text":"Intersectionality asks how social positions such as race, gender, class and disability combine rather than operate one at a time. In a case, identify which intersections change exposure, opportunity or treatment."
        },
        {
          "type":"diagnostic_cue",
          "target_item_id":"self_determination",
          "text":"Self-Determination Theory asks whether autonomy, competence and relatedness are supported or frustrated. In a sporting case, trace how the environment shapes motivation and wellbeing through those needs."
        },
        {
          "type":"diagnostic_cue",
          "target_item_id":"foucault_surveillance",
          "text":"Foucault's surveillance lens asks who observes, records and judges whom, and how the possibility of being watched changes behaviour. In a case, identify the monitoring system and the discipline it produces."
        },
        {
          "type":"diagnostic_cue",
          "target_item_id":"ethical_frameworks",
          "text":"Ethical frameworks ask what ought to be done by different routes. Compare consequences, duties or rights, and character or virtues rather than treating 'ethical' as one answer. Apply more than one framework to the same decision."
        }
      ]
    },
    "resolution": {
      "profile":"diagnostic_rerating",
      "release":"immediate",
      "prompt":"After that reminder, where would you rate yourself on this lens now?",
      "allow_same_rating":true
    },
    "lecturer": {
      "aggregate_view":"diagnostic_needs",
      "post_metrics":["rating_distribution_by_item","target_count_by_item"],
      "projector_summary":false,
      "reset_session":true
    }
  }
  $config$::jsonb,
  1
)
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- Read-only verification suggestions:
-- SELECT id, variant, active, schema_version, config->'judgement'->>'semantics'
-- FROM activities
-- WHERE id = 'b1141-w9-audit-own-confidence';
--
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'response_traces'
--   AND column_name IN ('committed_diagnostic_profile','diagnostic_target_id','final_diagnostic_profile')
-- ORDER BY column_name;
--
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid IN ('activities'::regclass,'activity_sessions'::regclass,'response_traces'::regclass)
-- ORDER BY conrelid::regclass::text, conname;
