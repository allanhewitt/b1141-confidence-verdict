import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDiagnosticAggregate,
  guidanceForDiagnosticTarget,
  validateCwdSelfAuditConfig,
  validateDiagnosticProfile,
  validateDiagnosticRerating,
  validateDiagnosticTarget,
  weakestDiagnosticCandidates,
} from "../lib/cwd-self-audit.js";

const config = {
  entry: { text: "Check what you can currently do with each lens." },
  judgement: {
    mode: "multi_item",
    semantics: "diagnostic_rating",
    prompt: "Rate each lens.",
    items: [
      { id: "a", label: "Lens A", order: 1 },
      { id: "b", label: "Lens B", order: 2 },
      { id: "c", label: "Lens C", order: 3 },
    ],
    scale: {
      id: "theory_use_4",
      name: "Theory-use diagnostic scale",
      points: [
        { value: 0, label: "Not sure yet" },
        { value: 1, label: "Recognise it" },
        { value: 2, label: "Can explain it" },
        { value: 3, label: "Can apply it" },
      ],
    },
  },
  evaluation: { mode: "non_keyed", accepted_option_ids: [], reveal_stage: "never" },
  confidence: { enabled: false },
  confrontation: {
    source: "self_diagnostic",
    reveal_mode: "not_applicable",
    target_selection: "lowest_or_learner_choice_on_tie",
    required_outputs: ["personal_profile", "lowest_rated_items"],
  },
  guidance: {
    source: "targeted_diagnostic",
    content: [
      { type: "diagnostic_cue", target_item_id: "a", text: "Guidance A" },
      { type: "diagnostic_cue", target_item_id: "b", text: "Guidance B" },
      { type: "diagnostic_cue", target_item_id: "c", text: "Guidance C" },
    ],
  },
  resolution: {
    profile: "diagnostic_rerating",
    release: "immediate",
    prompt: "Rate this lens again.",
    allow_same_rating: true,
  },
  lecturer: {
    aggregate_view: "diagnostic_needs",
    post_metrics: ["rating_distribution_by_item", "target_count_by_item"],
    projector_summary: false,
    reset_session: true,
  },
};

test("self-audit config validates as a bounded CWD variant", () => {
  assert.deepEqual(validateCwdSelfAuditConfig(config, "self_audit"), { valid: true, errors: [] });
  const social = validateCwdSelfAuditConfig(config, "social_immediate");
  assert.equal(social.valid, false);
});

test("diagnostic profile requires every item and valid rating", () => {
  assert.equal(validateDiagnosticProfile(config, { a: 2, b: 1, c: 3 }).valid, true);
  assert.equal(validateDiagnosticProfile(config, { a: 2, b: 1 }).valid, false);
  assert.equal(validateDiagnosticProfile(config, { a: 2, b: 9, c: 3 }).valid, false);
});

test("weakest diagnostic candidates preserve ties for learner choice", () => {
  const ratings = { a: 2, b: 1, c: 1 };
  assert.deepEqual(weakestDiagnosticCandidates(config, ratings), ["b", "c"]);
  assert.equal(validateDiagnosticTarget(config, ratings, "a").valid, false);
  assert.equal(validateDiagnosticTarget(config, ratings, "c").valid, true);
  assert.equal(guidanceForDiagnosticTarget(config, "c").text, "Guidance C");
});

test("diagnostic rerating preserves the full before/after profile", () => {
  const result = validateDiagnosticRerating(config, { a: 2, b: 1, c: 3 }, "b", 2);
  assert.equal(result.valid, true);
  assert.equal(result.originalRating, 1);
  assert.equal(result.finalRating, 2);
  assert.deepEqual(result.finalProfile, { a: 2, b: 2, c: 3 });
});

test("lecturer aggregate contains only anonymous diagnostic distributions", () => {
  const aggregate = buildDiagnosticAggregate(config, [
    { committed_diagnostic_profile: { a: 2, b: 1, c: 3 }, diagnostic_target_id: "b" },
    { committed_diagnostic_profile: { a: 1, b: 1, c: 2 }, diagnostic_target_id: "a" },
  ]);
  assert.equal(aggregate.total_profiles, 2);
  assert.equal(aggregate.items.a.ratings["1"], 1);
  assert.equal(aggregate.items.b.ratings["1"], 2);
  assert.equal(aggregate.items.a.targeted, 1);
  assert.equal(aggregate.items.b.targeted, 1);
});
