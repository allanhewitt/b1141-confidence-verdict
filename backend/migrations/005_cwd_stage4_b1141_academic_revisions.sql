-- CWD Stage 4 B1141 academic language/configuration revisions
-- 2026-09-03
--
-- Purpose:
--   Apply the agreed Stage 4 academic review revisions to all six canonical
--   B1141 CWD instances without altering the accepted Stage 3 engine.
--
-- Boundary:
--   * configuration/content only;
--   * all six rows must still be inactive;
--   * no live activation or deployment change;
--   * no legacy row is modified;
--   * Week 9 guidance becomes application-oriented within the existing
--     self_audit engine, but this migration does not add a new response-capture
--     step (which would be an engine change).
--
-- This migration is intentionally additive in history: migrations 001-004
-- remain immutable records of the Stage 3 baseline.

BEGIN;

DO $guard$
DECLARE
  canonical_count integer;
  active_count integer;
BEGIN
  SELECT COUNT(*), COUNT(*) FILTER (WHERE active)
    INTO canonical_count, active_count
  FROM activities
  WHERE id IN (
    'b1141-w1-who-is-excluded',
    'b1141-w2-bad-apple-or-system-cwd',
    'b1141-w5-biometric-data',
    'b1141-w6-sky-premier-league-1992',
    'b1141-w7-universal-code',
    'b1141-w9-audit-own-confidence'
  )
    AND model = 'confidence_weighted_response';

  IF canonical_count <> 6 THEN
    RAISE EXCEPTION 'Stage 4 CWD update expected 6 canonical rows, found %', canonical_count;
  END IF;

  IF active_count <> 0 THEN
    RAISE EXCEPTION 'Stage 4 CWD update requires all canonical rows inactive; % are active', active_count;
  END IF;
END
$guard$;

-- Week 1 — Who Is Excluded?
UPDATE activities
SET
  question = $q$Which of these benefits of sport do you think is least equally available?$q$,
  options = $o$["Better health and wellbeing","A sense of belonging and community","Identity and pride","Opportunities to progress and succeed"]$o$::jsonb,
  confidence_points = 5,
  config = $config$
{
  "entry": {
    "text": "Sport is routinely associated with a range of social and personal benefits."
  },
  "judgement": {
    "mode": "single",
    "semantics": "categorical",
    "prompt": "Which of these benefits of sport do you think is least equally available?",
    "options": [
      {"id":"health","label":"Better health and wellbeing","order":1},
      {"id":"belonging","label":"A sense of belonging and community","order":2},
      {"id":"identity","label":"Identity and pride","order":3},
      {"id":"opportunity","label":"Opportunities to progress and succeed","order":4}
    ]
  },
  "evaluation": {"mode":"non_keyed","accepted_option_ids":[],"reveal_stage":"never"},
  "confidence": {"enabled":true,"prompt":"How confident are you in that judgement?","scale_id":"confidence_5"},
  "confrontation": {
    "source":"cohort","reveal_mode":"lecturer_gated",
    "required_outputs":["response_count","judgement_distribution","confidence_by_judgement","overall_confidence","learner_original_position"]
  },
  "guidance": {
    "source":"in_app",
    "content":[{"type":"bridge","text":"A benefit may be real without being equally available. Does that change how you interpret the pattern in the room?"}]
  },
  "resolution": {
    "profile":"confidence_shift","release":"immediate",
    "prompt":"Having seen the pattern of responses, how would you now describe your position?",
    "options":[
      {"id":"same_more_confident","label":"I would keep my answer, but I'm more confident in it","order":1},
      {"id":"same_less_confident","label":"I would keep my answer, but I'm less confident in it","order":2},
      {"id":"same_similar_confidence","label":"I would keep my answer and feel about as confident","order":3},
      {"id":"different","label":"I would choose a different benefit now","order":4}
    ],
    "allow_revised_judgement":true,"reassess_confidence":"conditional"
  },
  "lecturer": {
    "pre_reveal_view":"response_count_only","reveal_control":"manual","resolution_control":"immediate",
    "post_reveal_metrics":[],"projector_summary":true,"reset_session":true
  }
}
$config$::jsonb,
  updated_at = now()
WHERE id = 'b1141-w1-who-is-excluded'
  AND model = 'confidence_weighted_response'
  AND active = false;

-- Week 2 — Bad Apple or Bad System?
UPDATE activities
SET
  question = $q$When serious harm occurs in sport, where does the main explanation usually lie?$q$,
  options = $o$["Mainly with the individual involved","With both the individual and the surrounding system","Mainly with the situation or system around them"]$o$::jsonb,
  confidence_points = 5,
  config = $config$
{
  "entry": {"text":"Consider how serious harm in sport should be explained."},
  "judgement": {
    "mode":"single","semantics":"bipolar",
    "prompt":"When serious harm occurs in sport, where does the main explanation usually lie?",
    "options":[
      {"id":"individual","label":"Mainly with the individual involved","order":1,"value":-1},
      {"id":"both","label":"With both the individual and the surrounding system","order":2,"value":0},
      {"id":"system","label":"Mainly with the situation or system around them","order":3,"value":1}
    ]
  },
  "evaluation":{"mode":"non_keyed","accepted_option_ids":[],"reveal_stage":"never"},
  "confidence":{"enabled":true,"prompt":"How confident are you in that judgement?","scale_id":"confidence_5"},
  "confrontation":{
    "source":"cohort","reveal_mode":"lecturer_gated",
    "required_outputs":["response_count","judgement_distribution","confidence_by_judgement","overall_confidence","learner_original_position"]
  },
  "guidance":{"source":"teaching_interlude","content":[]},
  "resolution":{
    "profile":"confidence_shift","release":"lecturer_controlled",
    "prompt":"Return to your original judgement. Would you now make the same judgement?",
    "options":[
      {"id":"same_more_confident","label":"Yes — with greater confidence","order":1},
      {"id":"same_less_confident","label":"Yes — with less confidence","order":2},
      {"id":"same_similar_confidence","label":"Yes — with about the same confidence","order":3},
      {"id":"different","label":"No — I would take a different position","order":4}
    ],
    "allow_revised_judgement":true,"reassess_confidence":"conditional"
  },
  "lecturer":{
    "pre_reveal_view":"response_count_only","reveal_control":"manual","resolution_control":"lecturer_reopen",
    "post_reveal_metrics":[],"projector_summary":true,"reset_session":true
  }
}
$config$::jsonb,
  updated_at = now()
WHERE id = 'b1141-w2-bad-apple-or-system-cwd'
  AND model = 'confidence_weighted_response'
  AND active = false;

-- Week 5 — The Biometric Data Scenario
UPDATE activities
SET
  question = $q$Which position comes closest to your view?$q$,
  options = $o$["The use is acceptable in principle","It is acceptable only with clear safeguards and meaningful consent","It raises serious ethical concerns even if safeguards are in place","It should not be used for these purposes"]$o$::jsonb,
  confidence_points = 5,
  config = $config$
{
  "entry":{"text":"A youth coach has access to athletes' GPS, heart-rate and sleep data and uses those data to inform training-load and selection decisions. The athletes are fifteen years old."},
  "judgement":{
    "mode":"single","semantics":"ordinal","prompt":"Which position comes closest to your view?",
    "options":[
      {"id":"acceptable_in_principle","label":"The use is acceptable in principle","order":1,"value":1},
      {"id":"safeguards_required","label":"It is acceptable only with clear safeguards and meaningful consent","order":2,"value":2},
      {"id":"serious_concerns","label":"It raises serious ethical concerns even if safeguards are in place","order":3,"value":3},
      {"id":"should_not_use","label":"It should not be used for these purposes","order":4,"value":4}
    ]
  },
  "evaluation":{"mode":"non_keyed","accepted_option_ids":[],"reveal_stage":"never"},
  "confidence":{"enabled":true,"prompt":"How confident are you in that judgement?","scale_id":"confidence_5"},
  "confrontation":{
    "source":"cohort","reveal_mode":"lecturer_gated",
    "required_outputs":["response_count","judgement_distribution","confidence_by_judgement","overall_confidence","learner_original_position"]
  },
  "guidance":{
    "source":"in_app",
    "content":[
      {"type":"comparison","text":"The same data can serve several purposes: supporting training, monitoring wellbeing and informing selection. Those purposes need not carry the same ethical justification."},
      {"type":"diagnostic_cue","text":"What changes when the person being monitored is fifteen and the person controlling the data also influences selection?"}
    ]
  },
  "resolution":{
    "profile":"retain_qualify_revise","release":"immediate","prompt":"Where do you now stand?",
    "options":[
      {"id":"retain","label":"I would retain my original position","order":1},
      {"id":"qualify","label":"I would retain it, but with important qualifications","order":2},
      {"id":"revise","label":"I would take a different position","order":3}
    ],
    "allow_revised_judgement":true,"reassess_confidence":"conditional"
  },
  "lecturer":{
    "pre_reveal_view":"response_count_only","reveal_control":"manual","resolution_control":"immediate",
    "post_reveal_metrics":[],"projector_summary":true,"reset_session":true
  }
}
$config$::jsonb,
  updated_at = now()
WHERE id = 'b1141-w5-biometric-data'
  AND model = 'confidence_weighted_response'
  AND active = false;

-- Week 6 — Sky and the Premier League, 1992
UPDATE activities
SET
  question = $q$Compared with the period before the Premier League broadcasting deal, is English top-flight football better or worse off overall?$q$,
  options = $o$["Much worse off","Somewhat worse off","Mixed","Somewhat better off","Much better off"]$o$::jsonb,
  confidence_points = 5,
  config = $config$
{
  "entry":{"text":"In 1992, BSkyB acquired the first live Premier League television rights in a deal worth approximately £304 million. The agreement transformed the financing, reach and accessibility of English top-flight football."},
  "judgement":{
    "mode":"single","semantics":"bipolar",
    "prompt":"Compared with the period before the Premier League broadcasting deal, is English top-flight football better or worse off overall?",
    "options":[
      {"id":"much_worse","label":"Much worse off","order":1,"value":-2},
      {"id":"somewhat_worse","label":"Somewhat worse off","order":2,"value":-1},
      {"id":"mixed","label":"Mixed","order":3,"value":0},
      {"id":"somewhat_better","label":"Somewhat better off","order":4,"value":1},
      {"id":"much_better","label":"Much better off","order":5,"value":2}
    ]
  },
  "evaluation":{"mode":"non_keyed","accepted_option_ids":[],"reveal_stage":"never"},
  "confidence":{"enabled":true,"prompt":"How confident are you in that judgement?","scale_id":"confidence_5"},
  "confrontation":{
    "source":"cohort","reveal_mode":"lecturer_gated",
    "required_outputs":["response_count","judgement_distribution","confidence_by_judgement","overall_confidence","learner_original_position"]
  },
  "guidance":{
    "source":"in_app",
    "content":[
      {"type":"comparison","text":"Club revenues, player earnings and international exposure increased dramatically. At the same time, access increasingly depended on paid subscriptions, broadcasters gained influence over scheduling, and financial inequalities within the game widened."},
      {"type":"diagnostic_cue","text":"Which evidence should count most in deciding whether football became 'better' — and better for whom?"}
    ]
  },
  "resolution":{
    "profile":"retain_qualify_revise","release":"immediate","prompt":"Where do you now stand?",
    "options":[
      {"id":"retain","label":"I would retain my original judgement","order":1},
      {"id":"qualify","label":"I would retain it, but with important qualifications","order":2},
      {"id":"revise","label":"I would take a different position","order":3}
    ],
    "allow_revised_judgement":true,"reassess_confidence":"conditional"
  },
  "lecturer":{
    "pre_reveal_view":"response_count_only","reveal_control":"manual","resolution_control":"immediate",
    "post_reveal_metrics":[],"projector_summary":true,"reset_session":true
  }
}
$config$::jsonb,
  updated_at = now()
WHERE id = 'b1141-w6-sky-premier-league-1992'
  AND model = 'confidence_weighted_response'
  AND active = false;

-- Week 7 — The Universal Code
UPDATE activities
SET
  question = $q$How far should global sport apply the same ethical standards when local cultural norms differ?$q$,
  options = $o$["The same core ethical standards should apply everywhere","Common standards should apply, with limited allowance for local context","The balance between common standards and local context should be judged case by case","Local cultural context should normally take priority","There should be no expectation of universal ethical standards"]$o$::jsonb,
  confidence_points = 5,
  config = $config$
{
  "entry":{"text":"Global sport crosses societies with different moral traditions. Governing bodies nevertheless make rules and ethical claims intended to apply across all of them."},
  "judgement":{
    "mode":"single","semantics":"ordinal",
    "prompt":"How far should global sport apply the same ethical standards when local cultural norms differ?",
    "options":[
      {"id":"universal_core","label":"The same core ethical standards should apply everywhere","order":1,"value":1},
      {"id":"mostly_universal","label":"Common standards should apply, with limited allowance for local context","order":2,"value":2},
      {"id":"negotiated_balance","label":"The balance between common standards and local context should be judged case by case","order":3,"value":3},
      {"id":"mostly_contextual","label":"Local cultural context should normally take priority","order":4,"value":4},
      {"id":"fully_contextual","label":"There should be no expectation of universal ethical standards","order":5,"value":5}
    ]
  },
  "evaluation":{"mode":"non_keyed","accepted_option_ids":[],"reveal_stage":"never"},
  "confidence":{"enabled":true,"prompt":"How confident are you in that position?","scale_id":"confidence_5"},
  "confrontation":{
    "source":"cohort","reveal_mode":"lecturer_gated",
    "required_outputs":["response_count","judgement_distribution","confidence_by_judgement","overall_confidence","learner_original_position"]
  },
  "guidance":{
    "source":"in_app",
    "content":[
      {"type":"diagnostic_cue","text":"If ethical standards are always culturally situated, on what basis could an international sporting body condemn coercion, discrimination or unsafe treatment elsewhere?"},
      {"type":"diagnostic_cue","text":"If universal standards are possible, who gets to define them?"}
    ]
  },
  "resolution":{
    "profile":"retain_qualify_revise","release":"immediate",
    "prompt":"Having considered the limits of both universalism and cultural relativism, where do you now stand?",
    "options":[
      {"id":"retain","label":"I would retain my original position","order":1},
      {"id":"qualify","label":"I would retain it, but with important qualifications","order":2},
      {"id":"revise","label":"I would take a different position","order":3}
    ],
    "allow_revised_judgement":true,"reassess_confidence":"conditional"
  },
  "lecturer":{
    "pre_reveal_view":"response_count_only","reveal_control":"manual","resolution_control":"immediate",
    "post_reveal_metrics":[],"projector_summary":true,"reset_session":true
  }
}
$config$::jsonb,
  updated_at = now()
WHERE id = 'b1141-w7-universal-code'
  AND model = 'confidence_weighted_response'
  AND active = false;

-- Week 9 — Audit Your Own Confidence
UPDATE activities
SET
  question = $q$For each perspective, choose the statement that best describes what you could currently do with it.$q$,
  options = $o$["Functionalism","Conflict Theory and Hegemony","Intersectionality","Self-Determination Theory","Foucault's Surveillance","Ethical Frameworks"]$o$::jsonb,
  confidence_points = 4,
  config = $config$
{
  "entry":{"text":"How confidently can you currently use each of these perspectives in analysis?"},
  "judgement":{
    "mode":"multi_item","semantics":"diagnostic_rating",
    "prompt":"For each perspective, choose the statement that best describes what you could currently do with it.",
    "items":[
      {"id":"functionalism","label":"Functionalism","order":1},
      {"id":"conflict_hegemony","label":"Conflict Theory and Hegemony","order":2},
      {"id":"intersectionality","label":"Intersectionality","order":3},
      {"id":"self_determination","label":"Self-Determination Theory","order":4},
      {"id":"foucault_surveillance","label":"Foucault's Surveillance","order":5},
      {"id":"ethical_frameworks","label":"Ethical Frameworks","order":6}
    ],
    "scale":{
      "id":"theory_use_4","name":"Theory-use diagnostic scale",
      "points":[
        {"value":0,"label":"I could not yet use this perspective confidently"},
        {"value":1,"label":"I understand its central idea"},
        {"value":2,"label":"I could explain its analytical value"},
        {"value":3,"label":"I could use it independently to analyse a sporting case"}
      ]
    }
  },
  "evaluation":{"mode":"non_keyed","accepted_option_ids":[],"reveal_stage":"never"},
  "confidence":{"enabled":false},
  "confrontation":{
    "source":"self_diagnostic","reveal_mode":"not_applicable",
    "target_selection":"lowest_or_learner_choice_on_tie",
    "required_outputs":["personal_profile","lowest_rated_items"]
  },
  "guidance":{
    "source":"targeted_diagnostic",
    "content":[
      {"type":"diagnostic_cue","target_item_id":"functionalism","text":"Choose a sporting institution or practice. What function might a functionalist argue that it performs for the wider social system? What might that account overlook?"},
      {"type":"diagnostic_cue","target_item_id":"conflict_hegemony","text":"In a sporting case of your choice, identify who controls a valued resource, who benefits from the current arrangement, and what makes that arrangement appear normal or legitimate."},
      {"type":"diagnostic_cue","target_item_id":"intersectionality","text":"Choose a sporting opportunity or disadvantage. Would analysing gender, class, race or disability separately miss anything important about who experiences it and how?"},
      {"type":"diagnostic_cue","target_item_id":"self_determination","text":"Take a sporting environment you know. Where are autonomy, competence and relatedness being supported — or frustrated? What consequences would the theory predict?"},
      {"type":"diagnostic_cue","target_item_id":"foucault_surveillance","text":"Identify a sporting practice involving monitoring or evaluation. Who observes whom, what becomes measurable, and how might being observable change behaviour?"},
      {"type":"diagnostic_cue","target_item_id":"ethical_frameworks","text":"Take one sporting decision and analyse it twice: once in terms of consequences and once in terms of duties or rights. Do the two approaches produce the same conclusion?"}
    ]
  },
  "resolution":{
    "profile":"diagnostic_rerating","release":"immediate",
    "prompt":"After working through that prompt, where would you rate your ability to use this perspective now?",
    "allow_same_rating":true
  },
  "lecturer":{
    "aggregate_view":"diagnostic_needs",
    "post_metrics":["rating_distribution_by_item","target_count_by_item"],
    "projector_summary":false,"reset_session":true
  }
}
$config$::jsonb,
  updated_at = now()
WHERE id = 'b1141-w9-audit-own-confidence'
  AND model = 'confidence_weighted_response'
  AND active = false;

DO $verify$
DECLARE
  revised_count integer;
BEGIN
  SELECT COUNT(*)
    INTO revised_count
  FROM activities
  WHERE id IN (
    'b1141-w1-who-is-excluded',
    'b1141-w2-bad-apple-or-system-cwd',
    'b1141-w5-biometric-data',
    'b1141-w6-sky-premier-league-1992',
    'b1141-w7-universal-code',
    'b1141-w9-audit-own-confidence'
  )
    AND model = 'confidence_weighted_response'
    AND active = false
    AND config IS NOT NULL
    AND schema_version = 1;

  IF revised_count <> 6 THEN
    RAISE EXCEPTION 'Stage 4 CWD postcondition expected 6 revised inactive rows, found %', revised_count;
  END IF;
END
$verify$;

COMMIT;

-- Read-only verification suggestions:
-- SELECT week, id, question, options, config->'guidance' AS guidance,
--        config->'resolution' AS resolution, active
-- FROM activities
-- WHERE model='confidence_weighted_response'
-- ORDER BY week, sequence, id;
