-- Run once against the b1141_confidence_verdict database.
-- Safe to re-run: IF NOT EXISTS / ON CONFLICT DO NOTHING throughout.

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  week INTEGER NOT NULL,
  activity TEXT NOT NULL,
  sequence INTEGER,
  question TEXT NOT NULL,
  options JSONB NOT NULL,
  confidence_points INTEGER NOT NULL DEFAULT 5,
  correct_option TEXT,
  reveal_mode TEXT NOT NULL DEFAULT 'threshold',
  reveal_threshold REAL,
  cohort_size INTEGER,
  active BOOLEAN NOT NULL DEFAULT true
);

-- Every submission is retained as an event when persistence is enabled.
-- `phase` distinguishes the latest pre-reveal commitment from the explicit
-- post-reveal calibration event; `reconsideration_scope` records what the
-- learner chose to reopen (judgement, confidence, both, or neither).
CREATE TABLE IF NOT EXISTS responses (
  id SERIAL PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(id),
  respondent_token TEXT NOT NULL,
  option TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  phase TEXT NOT NULL DEFAULT 'initial',
  reconsideration_scope TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Safe upgrade path for an already-created 2026-27 database.
ALTER TABLE responses
  ADD COLUMN IF NOT EXISTS phase TEXT NOT NULL DEFAULT 'initial';
ALTER TABLE responses
  ADD COLUMN IF NOT EXISTS reconsideration_scope TEXT;

CREATE INDEX IF NOT EXISTS idx_responses_activity ON responses(activity_id);
CREATE INDEX IF NOT EXISTS idx_responses_token ON responses(activity_id, respondent_token);

-- Week One seed: "Who is excluded?"
INSERT INTO activities (
  id, module, week, activity, sequence,
  question, options, confidence_points, correct_option,
  reveal_mode, reveal_threshold, cohort_size, active
) VALUES (
  'b1141-w1-least-shared-benefit', 'B1141', 1, 'least-shared-benefit', 3,
  'Which of these benefits of sport do you think is LEAST equally shared among everyone who takes part?',
  '["Health", "Pride / belonging", "Profit / money", "Identity"]'::jsonb,
  5, NULL,
  'threshold', 0.8, 45, true
) ON CONFLICT (id) DO NOTHING;

-- Week Three seed: "Why this geography of cricket?"
-- This is an initial causal judgement before Postcolonial Theory is introduced.
-- Manual reveal lets the lecturer surface the class model after everyone commits.
INSERT INTO activities (
  id, module, week, activity, sequence,
  question, options, confidence_points, correct_option,
  reveal_mode, reveal_threshold, cohort_size, active
) VALUES (
  'b1141-w3-geography-of-cricket', 'B1141', 3, 'geography-of-cricket', 3,
  'Which factor is the strongest explanation for why cricket became deeply established in South Asia, the Caribbean, East Africa and Australia, but not most of continental Europe?',
  '["The game''s inherent appeal", "Modern media and commercialisation", "Patterns of economic development", "Historical British imperial relationships"]'::jsonb,
  5, NULL,
  'manual', NULL, 45, true
) ON CONFLICT (id) DO NOTHING;
