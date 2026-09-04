import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  allowedFinalConfidenceValues,
  cohortDots,
  diagnosticStage,
  markerPoint,
  optionAnchor,
  resolutionChoices,
  resolutionPayload,
} from "../src/cwd/model.js";
import { defaultCwdVisualProfile } from "../src/cwd/visual-profile.js";

const activity = {
  variant: "social_immediate",
  confidence_scale: {
    points: [
      { value: 1, label: "Not at all confident" },
      { value: 2, label: "Slightly confident" },
      { value: 3, label: "Moderately confident" },
      { value: 4, label: "Very confident" },
      { value: 5, label: "Extremely confident" },
    ],
  },
  config: {
    judgement: {
      options: [
        { id: "a", label: "A", order: 1 },
        { id: "b", label: "B", order: 2 },
        { id: "c", label: "C", order: 3 },
        { id: "d", label: "D", order: 4 },
      ],
    },
    confidence: { enabled: true },
    resolution: {
      options: [
        { id: "same_more_confident", label: "More", order: 1 },
        { id: "same_less_confident", label: "Less", order: 2 },
        { id: "same_similar_confidence", label: "Same", order: 3 },
        { id: "different", label: "Different", order: 4 },
      ],
    },
  },
};

test("the initial visual profile is explicitly replaceable", () => {
  assert.equal(defaultCwdVisualProfile.id, "cwd_hidden_field_v1");
  assert.ok(defaultCwdVisualProfile.tokens["--cwd-accent"]);
  assert.ok(defaultCwdVisualProfile.tokens["--cwd-bg"]);
});

test("four-option activities use four stable field anchors", () => {
  assert.deepEqual(optionAnchor(0, 4), [24, 24]);
  assert.deepEqual(optionAnchor(3, 4), [76, 76]);
});

test("higher confidence moves a response farther into its selected area", () => {
  const options = activity.config.judgement.options;
  const values = activity.confidence_scale.points.map((point) => point.value);
  const low = markerPoint("a", 1, options, values);
  const high = markerPoint("a", 5, options, values);
  const lowDistance = Math.hypot(low.x - 50, low.y - 50);
  const highDistance = Math.hypot(high.x - 50, high.y - 50);
  assert.ok(highDistance > lowDistance);
});

test("cohort matrix becomes a bounded constellation", () => {
  const dots = cohortDots(activity, {
    matrix: {
      a: [0, 0, 3, 0, 0],
      b: [0, 0, 0, 12, 0],
      c: [0, 0, 0, 0, 0],
      d: [1, 0, 0, 0, 0],
    },
  });
  assert.equal(dots.filter((dot) => dot.optionId === "a").length, 3);
  assert.equal(dots.filter((dot) => dot.optionId === "b").length, 8);
  assert.equal(dots.filter((dot) => dot.optionId === "d").length, 1);
});

test("impossible confidence-shift choices are disabled at scale edges", () => {
  const atMax = resolutionChoices(activity, 5);
  assert.equal(atMax.find((choice) => choice.id === "same_more_confident").disabled, true);
  const atMin = resolutionChoices(activity, 1);
  assert.equal(atMin.find((choice) => choice.id === "same_less_confident").disabled, true);
});

test("final confidence choices preserve the meaning of stronger and weaker", () => {
  assert.deepEqual(allowedFinalConfidenceValues(activity, "same_more_confident", 3), [4, 5]);
  assert.deepEqual(allowedFinalConfidenceValues(activity, "same_less_confident", 3), [1, 2]);
  assert.deepEqual(allowedFinalConfidenceValues(activity, "same_similar_confidence", 3), [3]);
});

test("resolution payload preserves the committed option unless a revision is supplied", () => {
  assert.deepEqual(
    resolutionPayload({
      resolutionState: "same_similar_confidence",
      committedOptionId: "a",
      finalOptionId: null,
      finalConfidence: 3,
    }),
    { resolution_state: "same_similar_confidence", final_option_id: "a", final_confidence: 3 }
  );
});

test("self-audit stage is recoverable from persisted personal state", () => {
  assert.equal(diagnosticStage(null), "profile");
  assert.equal(diagnosticStage({ profile: { x: 1 }, target_id: null, completed: false }), "target");
  assert.equal(diagnosticStage({ profile: { x: 1 }, target_id: "x", guidance_reached: false, completed: false }), "guidance");
  assert.equal(diagnosticStage({ profile: { x: 1 }, target_id: "x", guidance_reached: true, completed: false }), "rerate");
  assert.equal(diagnosticStage({ profile: { x: 1 }, target_id: "x", guidance_reached: true, completed: true }), "complete");
});

test("student and presentation source contains no institutional scaffolding", () => {
  const base = path.resolve("src");
  const files = [
    "Respond.jsx",
    "cwd/SocialStudent.jsx",
    "cwd/SelfAuditStudent.jsx",
    "cwd/PresentationView.jsx",
  ];
  const banned = [/\bB1141\b/i, /\buniversity\b/i, /\bmodule\b/i, /\blecture\b/i, /\bweek\s+\d+\b/i];
  for (const file of files) {
    const content = fs.readFileSync(path.join(base, file), "utf8");
    for (const pattern of banned) {
      assert.equal(pattern.test(content), false, `${file} contains ${pattern}`);
    }
  }
});
