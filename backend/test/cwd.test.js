import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCohortAggregate,
  correctnessVisibleForTrace,
  deriveCorrectness,
  hashParticipantToken,
  learnerSafeConfig,
  lecturerKeyMatches,
  resolutionAvailable,
  sessionPhase,
  shouldAutoReveal,
  validateCwdConfig,
  validateJudgementResponse,
  validateResolution,
} from "../lib/cwd.js";

function canonicalConfig() {
  return {
    entry: { text: "Sport is often said to give people important benefits." },
    judgement: {
      mode: "single",
      semantics: "categorical",
      prompt: "Which benefit is least equally available?",
      options: [
        { id: "health", label: "Better health and wellbeing", order: 1 },
        { id: "belonging", label: "A sense of belonging and community", order: 2 },
        { id: "identity", label: "Identity and pride", order: 3 },
        { id: "opportunity", label: "Opportunities to progress and succeed", order: 4 },
      ],
    },
    evaluation: { mode: "non_keyed", accepted_option_ids: [], reveal_stage: "never" },
    confidence: { enabled: true, prompt: "How confident are you?", scale_id: "confidence_5" },
    confrontation: {
      source: "cohort",
      reveal_mode: "lecturer_gated",
      required_outputs: ["response_count", "judgement_distribution"],
    },
    guidance: {
      source: "in_app",
      content: [{ type: "bridge", text: "A benefit can exist without equal access to it." }],
    },
    resolution: {
      profile: "confidence_shift",
      release: "immediate",
      prompt: "Where are you now?",
      options: [
        { id: "same_more_confident", label: "Same, more confident", order: 1 },
        { id: "same_less_confident", label: "Same, less confident", order: 2 },
        { id: "same_similar_confidence", label: "Same, similar confidence", order: 3 },
        { id: "different", label: "Different judgement", order: 4 },
      ],
      allow_revised_judgement: true,
      reassess_confidence: "conditional",
    },
    lecturer: {
      pre_reveal_view: "response_count_only",
      reveal_control: "manual",
      resolution_control: "immediate",
      post_reveal_metrics: [],
      projector_summary: true,
      reset_session: true,
    },
  };
}

const confidenceScale = {
  id: "confidence_5",
  name: "Five-point confidence scale",
  schema_version: 1,
  points: [
    { value: 1, label: "Not at all confident" },
    { value: 2, label: "Slightly confident" },
    { value: 3, label: "Moderately confident" },
    { value: 4, label: "Very confident" },
    { value: 5, label: "Extremely confident" },
  ],
};

test("canonical social_immediate config validates", () => {
  const result = validateCwdConfig(canonicalConfig(), "social_immediate");
  assert.equal(result.valid, true, result.errors.join("; "));
});

test("non-keyed config cannot smuggle an answer key", () => {
  const config = canonicalConfig();
  config.evaluation.accepted_option_ids = ["health"];
  const result = validateCwdConfig(config, "social_immediate");
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("non_keyed")));
});

test("resolution profile must use its canonical option ids", () => {
  const config = canonicalConfig();
  config.resolution.options[0].id = "custom_state";
  const result = validateCwdConfig(config, "social_immediate");
  assert.equal(result.valid, false);
});

test("participant hashes are stable within a session and unlinkable across sessions", () => {
  const token = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const first = hashParticipantToken("11111111-1111-4111-8111-111111111111", token);
  const same = hashParticipantToken("11111111-1111-4111-8111-111111111111", token);
  const other = hashParticipantToken("22222222-2222-4222-8222-222222222222", token);
  assert.equal(first, same);
  assert.notEqual(first, other);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test("lecturer key comparison rejects missing or short keys", () => {
  assert.equal(lecturerKeyMatches("short", "short"), false);
  assert.equal(lecturerKeyMatches("0123456789abcdef", "0123456789abcdef"), true);
  assert.equal(lecturerKeyMatches("0123456789abcdef", "0123456789abcdeg"), false);
});

test("judgement validation uses option ids and confidence scale values", () => {
  const config = canonicalConfig();
  assert.equal(validateJudgementResponse(config, confidenceScale, { option_id: "health", confidence: 5 }).valid, true);
  assert.equal(validateJudgementResponse(config, confidenceScale, { option_id: "missing", confidence: 5 }).valid, false);
  assert.equal(validateJudgementResponse(config, confidenceScale, { option_id: "health", confidence: 6 }).valid, false);
});

test("cohort aggregation freezes judgement and confidence summaries by option id", () => {
  const aggregate = buildCohortAggregate(canonicalConfig(), confidenceScale, [
    { committed_option_id: "health", committed_confidence: 5 },
    { committed_option_id: "health", committed_confidence: 4 },
    { committed_option_id: "identity", committed_confidence: 2 },
  ]);
  assert.equal(aggregate.total, 3);
  assert.deepEqual(aggregate.matrix.health, [0, 0, 0, 1, 1]);
  assert.equal(aggregate.judgement_distribution.find((entry) => entry.option_id === "health").count, 2);
  assert.equal(aggregate.dominant_option_id, "health");
});

test("automatic threshold reveal is derived from the frozen session expectation", () => {
  const config = canonicalConfig();
  config.confrontation.reveal_mode = "automatic";
  config.confrontation.automatic_rule = "threshold";
  config.confrontation.threshold = 0.75;
  config.confrontation.expected_cohort_size = 20;
  config.lecturer.reveal_control = "automatic";
  assert.equal(shouldAutoReveal(config, 20, 14), false);
  assert.equal(shouldAutoReveal(config, 20, 15), true);
});

test("session phase and resolution availability are timestamp-derived", () => {
  const config = canonicalConfig();
  const collecting = { revealed_at: null, resolution_opened_at: null, closed_at: null };
  assert.equal(sessionPhase(collecting), "collecting");
  assert.equal(resolutionAvailable(config, collecting), false);

  const revealed = { revealed_at: new Date(), resolution_opened_at: new Date(), closed_at: null };
  assert.equal(sessionPhase(revealed), "resolution_open");
  assert.equal(resolutionAvailable(config, revealed), true);
});

test("different resolution requires a genuinely different judgement", () => {
  const config = canonicalConfig();
  const bad = validateResolution(
    config,
    confidenceScale,
    { option_id: "health", confidence: 4 },
    { resolution_state: "different", final_option_id: "health", final_confidence: 3 }
  );
  assert.equal(bad.valid, false);

  const good = validateResolution(
    config,
    confidenceScale,
    { option_id: "health", confidence: 4 },
    { resolution_state: "different", final_option_id: "identity", final_confidence: 3 }
  );
  assert.equal(good.valid, true, good.errors.join("; "));
});

test("learner-safe config removes accepted option ids", () => {
  const config = canonicalConfig();
  config.evaluation = { mode: "keyed", accepted_option_ids: ["health"], reveal_stage: "guidance" };
  const safe = learnerSafeConfig(config);
  assert.deepEqual(safe.evaluation.accepted_option_ids, []);
  assert.deepEqual(config.evaluation.accepted_option_ids, ["health"]);
});

test("keyed correctness appears only at the configured pedagogical stage", () => {
  const config = canonicalConfig();
  config.evaluation = { mode: "keyed", accepted_option_ids: ["health"], reveal_stage: "guidance" };
  assert.equal(deriveCorrectness(config, "health"), true);
  assert.equal(deriveCorrectness(config, "identity"), false);

  const session = { revealed_at: new Date(), resolution_opened_at: new Date() };
  assert.equal(correctnessVisibleForTrace(config, session, { guidance_reached_at: null }), false);
  assert.equal(correctnessVisibleForTrace(config, session, { guidance_reached_at: new Date() }), true);
});
