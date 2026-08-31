-- CWD Stage 3 B1141 canonical activity repertoire
-- 2026-08-31
--
-- Purpose:
--   Add the remaining four canonical B1141 social CWD activity configurations
--   as inactive Stage 3 records. Together with the existing canonical Week 1
--   row and the self-audit Week 9 row from migration 003, this yields the six
--   B1141 CWD instances used to stress-test the reusable model.
--
-- The legacy Week 2 activity already uses the title/slug "Bad Apple or Bad
-- System?". It is deliberately NOT rewritten or reclassified here. A separate
-- canonical Stage 3 row is inserted so rollback and historical interpretation
-- remain explicit.

BEGIN;

-- ---------------------------------------------------------------------------
-- Week 2 — Bad Apple or Bad System? (social_delayed)
-- ---------------------------------------------------------------------------

INSERT INTO activities (
  id, module, week, activity, sequence,
  question, options, confidence_points, correct_option,
  reveal_mode, reveal_threshold, cohort_size, active,
  model, variant, title, config, schema_version
)
VALUES (
  'b1141-w2-bad-apple-or-system-cwd',
  'B1141', 2, 'bad-apple-or-system', 1,
  'When serious harm occurs in sport, where does the main explanation usually lie?',
  '["Mainly with the individual involved","Both about equally","Mainly with the situation or system around them"]'::jsonb,
  5, NULL,
  'manual', NULL, NULL, false,
  'confidence_weighted_response', 'social_delayed', 'Bad Apple or Bad System?',
  $config$
  {
    "entry": {
      "text": "When something goes badly wrong in sport, it is tempting to start by asking what was wrong with the person involved."
    },
    "judgement": {
      "mode": "single",
      "semantics": "bipolar",
      "prompt": "When serious harm occurs in sport, where does the main explanation usually lie?",
      "options": [
        {"id":"individual","label":"Mainly with the individual involved","order":1,"value":-1},
        {"id":"both","label":"Both about equally","order":2,"value":0},
        {"id":"system","label":"Mainly with the situation or system around them","order":3,"value":1}
      ]
    },
    "evaluation": {
      "mode":"non_keyed",
      "accepted_option_ids":[],
      "reveal_stage":"never"
    },
    "confidence": {
      "enabled":true,
      "prompt":"How confident are you in that judgement?",
      "scale_id":"confidence_5"
    },
    "confrontation": {
      "source":"cohort",
      "reveal_mode":"lecturer_gated",
      "required_outputs":[
        "response_count",
        "judgement_distribution",
        "confidence_by_judgement",
        "overall_confidence",
        "learner_original_position"
      ]
    },
    "guidance": {
      "source":"teaching_interlude",
      "content":[]
    },
    "resolution": {
      "profile":"confidence_shift",
      "release":"lecturer_controlled",
      "prompt":"After the explanations and examples we have just worked through, where are you now?",
      "options":[
        {"id":"same_more_confident","label":"I would keep my answer, but I'm more confident in it","order":1},
        {"id":"same_less_confident","label":"I would keep my answer, but I'm less confident in it","order":2},
        {"id":"same_similar_confidence","label":"I would keep my answer and feel about as confident","order":3},
        {"id":"different","label":"I would choose a different position now","order":4}
      ],
      "allow_revised_judgement":true,
      "reassess_confidence":"conditional"
    },
    "lecturer": {
      "pre_reveal_view":"response_count_only",
      "reveal_control":"manual",
      "resolution_control":"lecturer_reopen",
      "post_reveal_metrics":[],
      "projector_summary":true,
      "reset_session":true
    }
  }
  $config$::jsonb,
  1
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Week 5 — The Biometric Data Scenario (social_immediate)
-- ---------------------------------------------------------------------------

INSERT INTO activities (
  id, module, week, activity, sequence,
  question, options, confidence_points, correct_option,
  reveal_mode, reveal_threshold, cohort_size, active,
  model, variant, title, config, schema_version
)
VALUES (
  'b1141-w5-biometric-data',
  'B1141', 5, 'biometric-data', 2,
  'Overall, how acceptable is it for the coach to use these data in this way?',
  '["Completely unacceptable","Mostly unacceptable","Unsure / depends","Mostly acceptable","Completely acceptable"]'::jsonb,
  5, NULL,
  'manual', NULL, NULL, false,
  'confidence_weighted_response', 'social_immediate', 'The Biometric Data Scenario',
  $config$
  {
    "entry": {
      "text": "A youth coach has complete access to athletes' GPS data, heart rate and sleep patterns, and uses them for selection and training-load decisions. The athletes are fifteen years old."
    },
    "judgement": {
      "mode":"single",
      "semantics":"ordinal",
      "prompt":"Overall, how acceptable is it for the coach to use these data in this way?",
      "options":[
        {"id":"completely_unacceptable","label":"Completely unacceptable","order":1,"value":1},
        {"id":"mostly_unacceptable","label":"Mostly unacceptable","order":2,"value":2},
        {"id":"depends","label":"Unsure / depends","order":3,"value":3},
        {"id":"mostly_acceptable","label":"Mostly acceptable","order":4,"value":4},
        {"id":"completely_acceptable","label":"Completely acceptable","order":5,"value":5}
      ]
    },
    "evaluation": {
      "mode":"non_keyed",
      "accepted_option_ids":[],
      "reveal_stage":"never"
    },
    "confidence": {
      "enabled":true,
      "prompt":"How confident are you in that judgement?",
      "scale_id":"confidence_5"
    },
    "confrontation": {
      "source":"cohort",
      "reveal_mode":"lecturer_gated",
      "required_outputs":[
        "response_count",
        "judgement_distribution",
        "confidence_by_judgement",
        "overall_confidence",
        "learner_original_position"
      ]
    },
    "guidance": {
      "source":"in_app",
      "content":[
        {
          "type":"comparison",
          "text":"The data may be useful for coaching, but usefulness does not settle whether the collection and use are proportionate."
        },
        {
          "type":"diagnostic_cue",
          "text":"Consider four separate questions: meaningful consent at age fifteen; how much data are necessary; who owns or controls the data; and what happens when the same data influence selection."
        }
      ]
    },
    "resolution": {
      "profile":"retain_qualify_revise",
      "release":"immediate",
      "prompt":"Having separated those issues, what best describes your position now?",
      "options":[
        {"id":"retain","label":"I would retain my original judgement","order":1},
        {"id":"qualify","label":"I would keep the broad judgement, but qualify it","order":2},
        {"id":"revise","label":"I would revise my judgement","order":3}
      ],
      "allow_revised_judgement":true,
      "reassess_confidence":"conditional"
    },
    "lecturer": {
      "pre_reveal_view":"response_count_only",
      "reveal_control":"manual",
      "resolution_control":"immediate",
      "post_reveal_metrics":[],
      "projector_summary":true,
      "reset_session":true
    }
  }
  $config$::jsonb,
  1
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Week 6 — Sky and the Premier League, 1992 (social_immediate)
-- ---------------------------------------------------------------------------

INSERT INTO activities (
  id, module, week, activity, sequence,
  question, options, confidence_points, correct_option,
  reveal_mode, reveal_threshold, cohort_size, active,
  model, variant, title, config, schema_version
)
VALUES (
  'b1141-w6-sky-premier-league-1992',
  'B1141', 6, 'sky-premier-league-1992', 1,
  'Football is better off today than before the Sky deal. Where do you stand?',
  '["Strongly disagree","Disagree","Neither / unsure","Agree","Strongly agree"]'::jsonb,
  5, NULL,
  'manual', NULL, NULL, false,
  'confidence_weighted_response', 'social_immediate', 'Sky and the Premier League, 1992',
  $config$
  {
    "entry": {
      "text": "In 1992, Sky paid around £304 million for Premier League rights, moving regular live football behind a paywall. The deal brought new revenue while changing how football was organised and accessed."
    },
    "judgement": {
      "mode":"single",
      "semantics":"bipolar",
      "prompt":"Football is better off today than before the Sky deal. Where do you stand?",
      "options":[
        {"id":"strongly_disagree","label":"Strongly disagree","order":1,"value":-2},
        {"id":"disagree","label":"Disagree","order":2,"value":-1},
        {"id":"neutral","label":"Neither / unsure","order":3,"value":0},
        {"id":"agree","label":"Agree","order":4,"value":1},
        {"id":"strongly_agree","label":"Strongly agree","order":5,"value":2}
      ]
    },
    "evaluation": {
      "mode":"non_keyed",
      "accepted_option_ids":[],
      "reveal_stage":"never"
    },
    "confidence": {
      "enabled":true,
      "prompt":"How confident are you in that judgement?",
      "scale_id":"confidence_5"
    },
    "confrontation": {
      "source":"cohort",
      "reveal_mode":"lecturer_gated",
      "required_outputs":[
        "response_count",
        "judgement_distribution",
        "confidence_by_judgement",
        "overall_confidence",
        "learner_original_position"
      ]
    },
    "guidance": {
      "source":"in_app",
      "content":[
        {
          "type":"stakeholder_prompt",
          "text":"Clubs and players gained enormous new revenues and global exposure. Supporters gained more televised football but also faced paywalls, altered kick-off times and a game increasingly organised around broadcast markets."
        },
        {
          "type":"comparison",
          "text":"A single 'better or worse' verdict depends on what counts as better: playing standard, club revenue, supporter access, competitive balance, grassroots benefit or wider public value."
        },
        {
          "type":"diagnostic_cue",
          "text":"Which evidence would actually settle your judgement, and whose experience would that evidence privilege?"
        }
      ]
    },
    "resolution": {
      "profile":"retain_qualify_revise",
      "release":"immediate",
      "prompt":"Having separated the gains, losses and stakeholders, what best describes your position now?",
      "options":[
        {"id":"retain","label":"I would retain my original judgement","order":1},
        {"id":"qualify","label":"I would keep the broad judgement, but qualify it","order":2},
        {"id":"revise","label":"I would revise my judgement","order":3}
      ],
      "allow_revised_judgement":true,
      "reassess_confidence":"conditional"
    },
    "lecturer": {
      "pre_reveal_view":"response_count_only",
      "reveal_control":"manual",
      "resolution_control":"immediate",
      "post_reveal_metrics":[],
      "projector_summary":true,
      "reset_session":true
    }
  }
  $config$::jsonb,
  1
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Week 7 — The Universal Code (social_immediate)
-- ---------------------------------------------------------------------------

INSERT INTO activities (
  id, module, week, activity, sequence,
  question, options, confidence_points, correct_option,
  reveal_mode, reveal_threshold, cohort_size, active,
  model, variant, title, config, schema_version
)
VALUES (
  'b1141-w7-universal-code',
  'B1141', 7, 'universal-code', 4,
  'How far should global sport apply the same ethical standards when local cultural norms differ?',
  '["The same core standards should apply everywhere","Mostly universal, with limited local variation","A balance must be negotiated case by case","Local cultural context should usually take priority","Ethical standards should not be imposed universally"]'::jsonb,
  5, NULL,
  'manual', NULL, NULL, false,
  'confidence_weighted_response', 'social_immediate', 'The Universal Code',
  $config$
  {
    "entry": {
      "text":"Global sport crosses societies with different moral traditions. Governing bodies nevertheless make rules and ethical claims intended to apply across all of them."
    },
    "judgement": {
      "mode":"single",
      "semantics":"ordinal",
      "prompt":"How far should global sport apply the same ethical standards when local cultural norms differ?",
      "options":[
        {"id":"universal_core","label":"The same core standards should apply everywhere","order":1,"value":1},
        {"id":"mostly_universal","label":"Mostly universal, with limited local variation","order":2,"value":2},
        {"id":"negotiated_balance","label":"A balance must be negotiated case by case","order":3,"value":3},
        {"id":"mostly_contextual","label":"Local cultural context should usually take priority","order":4,"value":4},
        {"id":"fully_contextual","label":"Ethical standards should not be imposed universally","order":5,"value":5}
      ]
    },
    "evaluation": {
      "mode":"non_keyed",
      "accepted_option_ids":[],
      "reveal_stage":"never"
    },
    "confidence": {
      "enabled":true,
      "prompt":"How confident are you in that position?",
      "scale_id":"confidence_5"
    },
    "confrontation": {
      "source":"cohort",
      "reveal_mode":"lecturer_gated",
      "required_outputs":[
        "response_count",
        "judgement_distribution",
        "confidence_by_judgement",
        "overall_confidence",
        "learner_original_position"
      ]
    },
    "guidance": {
      "source":"in_app",
      "content":[
        {
          "type":"comparison",
          "text":"Cultural relativism asks whether standards presented as universal actually come from one powerful tradition. That is a challenge to authority, not a claim that every practice is beyond criticism."
        },
        {
          "type":"diagnostic_cue",
          "text":"Now test the limit of your position: is there anything in sport — for example basic safety, coercion or exploitation — that you would judge wrong regardless of cultural context?"
        }
      ]
    },
    "resolution": {
      "profile":"retain_qualify_revise",
      "release":"immediate",
      "prompt":"Having tested the limits of both universalism and cultural relativism, what best describes your position now?",
      "options":[
        {"id":"retain","label":"I would retain my original position","order":1},
        {"id":"qualify","label":"I would keep the broad position, but qualify it","order":2},
        {"id":"revise","label":"I would revise my position","order":3}
      ],
      "allow_revised_judgement":true,
      "reassess_confidence":"conditional"
    },
    "lecturer": {
      "pre_reveal_view":"response_count_only",
      "reveal_control":"manual",
      "resolution_control":"immediate",
      "post_reveal_metrics":[],
      "projector_summary":true,
      "reset_session":true
    }
  }
  $config$::jsonb,
  1
)
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- Read-only verification suggestions:
-- SELECT id, week, title, variant, active, schema_version,
--        config->'judgement'->>'semantics' AS semantics,
--        config->'resolution'->>'profile' AS resolution_profile
-- FROM activities
-- WHERE model = 'confidence_weighted_response'
-- ORDER BY week, sequence, id;
