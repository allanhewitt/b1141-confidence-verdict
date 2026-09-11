import test from "node:test";
import assert from "node:assert/strict";
import { copyText } from "../src/cwd/copy.js";

test("copyText reads nested pedagogical copy", () => {
  const config = {
    copy: {
      reveal: {
        heading: "How did the room respond?",
      },
    },
  };

  assert.equal(copyText(config, "reveal.heading", "fallback"), "How did the room respond?");
});

test("copyText falls back for missing or blank values", () => {
  assert.equal(copyText({ copy: { reveal: { heading: "   " } } }, "reveal.heading", "fallback"), "fallback");
  assert.equal(copyText({}, ["reveal", "heading"], "fallback"), "fallback");
});
