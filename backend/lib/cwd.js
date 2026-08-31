import { createHash, timingSafeEqual } from "node:crypto";

const JUDGEMENT_SEMANTICS = new Set(["categorical", "ordinal", "bipolar"]);
const REVEAL_STAGES = new Set(["never", "confrontation", "guidance", "resolution"]);
const GUIDANCE_SOURCES = new Set(["in_app", "teaching_interlude", "none"]);
const GUIDANCE_TYPES = new Set([
  "bridge",
  "evidence",
  "comparison",
  "stakeholder_prompt",
  "diagnostic_cue",
  "source_reference",
]);
const RESOLUTION_PROFILES = {
  confidence_shift: new Set([
    "same_more_confident",
    "same_less_confident",
    "same_similar_confidence",
    "different",
  ]),
  retain_qualify_revise: new Set(["retain", "qualify", "revise"]),
};

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function push(errors, condition, message) {
  if (!condition) errors.push(message);
}

function unique(values) {
  return new Set(values).size === values.length;
}

export class CwdConfigError extends Error {
  constructor(errors) {
    super(`Invalid CWD configuration: ${errors.join("; ")}`);
    this.name = "CwdConfigError";
    this.errors = errors;
  }
}

export function validateCwdConfig(config, variant) {
  const errors = [];
  push(errors, isObject(config), "config must be an object");
  if (!isObject(config)) return { valid: false, errors };

  const required = [
    "entry",
    "judgement",
    "evaluation",
    "confidence",
    "confrontation",
    "guidance",
    "resolution",
    "lecturer",
  ];
  required.forEach((key) => push(errors, key in config, `missing ${key}`));
  if (errors.length) return { valid: false, errors };

  push(errors, isObject(config.entry), "entry must be an object");
  if (isObject(config.entry)) {
    push(errors, typeof config.entry.text === "string" && config.entry.text.trim().length > 0, "entry.text must be non-empty");
  }

  const judgement = config.judgement;
  push(errors, isObject(judgement), "judgement must be an object");
  const judgementOptionIds = [];
  if (isObject(judgement)) {
    push(errors, judgement.mode === "single", "judgement.mode must be single");
    push(errors, JUDGEMENT_SEMANTICS.has(judgement.semantics), "judgement.semantics is unsupported");
    push(errors, typeof judgement.prompt === "string" && judgement.prompt.trim().length > 0, "judgement.prompt must be non-empty");
    push(errors, Array.isArray(judgement.options) && judgement.options.length >= 2 && judgement.options.length <= 12, "judgement.options must contain 2-12 options");
    if (Array.isArray(judgement.options)) {
      for (const [index, option] of judgement.options.entries()) {
        push(errors, isObject(option), `judgement.options[${index}] must be an object`);
        if (!isObject(option)) continue;
        push(errors, typeof option.id === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(option.id), `judgement.options[${index}].id is invalid`);
        push(errors, typeof option.label === "string" && option.label.trim().length > 0, `judgement.options[${index}].label must be non-empty`);
        push(errors, Number.isInteger(option.order) && option.order >= 1, `judgement.options[${index}].order must be a positive integer`);
        if (typeof option.id === "string") judgementOptionIds.push(option.id);
      }
      push(errors, unique(judgementOptionIds), "judgement option ids must be unique");
      const orders = judgement.options.map((option) => option?.order).filter(Number.isInteger);
      push(errors, unique(orders), "judgement option order values must be unique");
    }
  }

  const evaluation = config.evaluation;
  push(errors, isObject(evaluation), "evaluation must be an object");
  if (isObject(evaluation)) {
    push(errors, evaluation.mode === "non_keyed" || evaluation.mode === "keyed", "evaluation.mode must be non_keyed or keyed");
    push(errors, Array.isArray(evaluation.accepted_option_ids), "evaluation.accepted_option_ids must be an array");
    push(errors, REVEAL_STAGES.has(evaluation.reveal_stage), "evaluation.reveal_stage is unsupported");
    if (Array.isArray(evaluation.accepted_option_ids)) {
      push(errors, unique(evaluation.accepted_option_ids), "accepted option ids must be unique");
      for (const optionId of evaluation.accepted_option_ids) {
        push(errors, judgementOptionIds.includes(optionId), `accepted option id ${optionId} is not a judgement option`);
      }
      if (evaluation.mode === "non_keyed") {
        push(errors, evaluation.accepted_option_ids.length === 0, "non_keyed evaluation cannot contain accepted option ids");
        push(errors, evaluation.reveal_stage === "never", "non_keyed evaluation reveal_stage must be never");
      }
      if (evaluation.mode === "keyed") {
        push(errors, evaluation.accepted_option_ids.length > 0, "keyed evaluation requires at least one accepted option id");
      }
    }
  }

  const confidence = config.confidence;
  push(errors, isObject(confidence), "confidence must be an object");
  if (isObject(confidence)) {
    push(errors, typeof confidence.enabled === "boolean", "confidence.enabled must be boolean");
    if (confidence.enabled === true) {
      push(errors, typeof confidence.prompt === "string" && confidence.prompt.trim().length > 0, "confidence.prompt must be non-empty when enabled");
      push(errors, typeof confidence.scale_id === "string" && confidence.scale_id.trim().length > 0, "confidence.scale_id is required when enabled");
    }
  }

  const confrontation = config.confrontation;
  push(errors, isObject(confrontation), "confrontation must be an object");
  if (isObject(confrontation)) {
    push(errors, confrontation.source === "cohort", "confrontation.source must be cohort");
    push(errors, confrontation.reveal_mode === "lecturer_gated" || confrontation.reveal_mode === "automatic", "confrontation.reveal_mode is unsupported");
    push(errors, Array.isArray(confrontation.required_outputs), "confrontation.required_outputs must be an array");
    if (confrontation.reveal_mode === "lecturer_gated") {
      push(errors, confrontation.automatic_rule == null, "lecturer_gated confrontation cannot define automatic_rule");
      push(errors, confrontation.threshold == null, "lecturer_gated confrontation cannot define threshold");
    }
    if (confrontation.reveal_mode === "automatic") {
      push(errors, confrontation.automatic_rule === "immediate" || confrontation.automatic_rule === "threshold", "automatic confrontation requires immediate or threshold automatic_rule");
      if (confrontation.automatic_rule === "threshold") {
        push(errors, typeof confrontation.threshold === "number" && confrontation.threshold > 0 && confrontation.threshold <= 1, "threshold automatic reveal requires threshold in (0,1]");
        push(errors, Number.isInteger(confrontation.expected_cohort_size) && confrontation.expected_cohort_size > 0, "threshold automatic reveal requires expected_cohort_size");
      }
    }
  }

  const guidance = config.guidance;
  push(errors, isObject(guidance), "guidance must be an object");
  if (isObject(guidance)) {
    push(errors, GUIDANCE_SOURCES.has(guidance.source), "guidance.source is unsupported");
    push(errors, Array.isArray(guidance.content), "guidance.content must be an array");
    if (Array.isArray(guidance.content)) {
      if (guidance.source === "in_app") push(errors, guidance.content.length > 0, "in_app guidance requires content");
      if (guidance.source === "none") push(errors, guidance.content.length === 0, "guidance source none requires empty content");
      for (const [index, block] of guidance.content.entries()) {
        push(errors, isObject(block), `guidance.content[${index}] must be an object`);
        if (!isObject(block)) continue;
        push(errors, GUIDANCE_TYPES.has(block.type), `guidance.content[${index}].type is unsupported`);
        push(errors, typeof block.text === "string" && block.text.trim().length > 0, `guidance.content[${index}].text must be non-empty`);
      }
    }
  }

  const resolution = config.resolution;
  push(errors, isObject(resolution), "resolution must be an object");
  if (isObject(resolution)) {
    const allowedIds = RESOLUTION_PROFILES[resolution.profile];
    push(errors, Boolean(allowedIds), "resolution.profile is unsupported");
    push(errors, resolution.release === "immediate" || resolution.release === "lecturer_controlled", "resolution.release is unsupported");
    push(errors, typeof resolution.prompt === "string" && resolution.prompt.trim().length > 0, "resolution.prompt must be non-empty");
    push(errors, typeof resolution.allow_revised_judgement === "boolean", "resolution.allow_revised_judgement must be boolean");
    push(errors, typeof resolution.reassess_confidence === "boolean" || resolution.reassess_confidence === "conditional", "resolution.reassess_confidence is unsupported");
    push(errors, Array.isArray(resolution.options), "resolution.options must be an array");
    if (Array.isArray(resolution.options) && allowedIds) {
      const ids = resolution.options.map((option) => option?.id);
      for (const [index, option] of resolution.options.entries()) {
        push(errors, isObject(option), `resolution.options[${index}] must be an object`);
        if (!isObject(option)) continue;
        push(errors, allowedIds.has(option.id), `resolution option id ${option.id} does not belong to profile ${resolution.profile}`);
        push(errors, typeof option.label === "string" && option.label.trim().length > 0, `resolution.options[${index}].label must be non-empty`);
        push(errors, Number.isInteger(option.order) && option.order >= 1, `resolution.options[${index}].order must be a positive integer`);
      }
      push(errors, unique(ids), "resolution option ids must be unique");
      push(errors, ids.length === allowedIds.size && [...allowedIds].every((id) => ids.includes(id)), `resolution profile ${resolution.profile} must define its complete canonical option set`);
    }
  }

  const lecturer = config.lecturer;
  push(errors, isObject(lecturer), "lecturer must be an object");
  if (isObject(lecturer)) {
    push(errors, lecturer.pre_reveal_view === "response_count_only" || lecturer.pre_reveal_view === "configured_summary", "lecturer.pre_reveal_view is unsupported");
    push(errors, lecturer.reveal_control === "manual" || lecturer.reveal_control === "automatic", "lecturer.reveal_control is unsupported");
    push(errors, lecturer.resolution_control === "immediate" || lecturer.resolution_control === "lecturer_reopen", "lecturer.resolution_control is unsupported");
    push(errors, Array.isArray(lecturer.post_reveal_metrics), "lecturer.post_reveal_metrics must be an array");
    push(errors, typeof lecturer.projector_summary === "boolean", "lecturer.projector_summary must be boolean");
    push(errors, typeof lecturer.reset_session === "boolean", "lecturer.reset_session must be boolean");
  }

  if (isObject(confrontation) && isObject(lecturer)) {
    if (confrontation.reveal_mode === "lecturer_gated") {
      push(errors, lecturer.reveal_control === "manual", "lecturer_gated confrontation requires manual lecturer reveal_control");
    }
    if (confrontation.reveal_mode === "automatic") {
      push(errors, lecturer.reveal_control === "automatic", "automatic confrontation requires automatic lecturer reveal_control");
    }
  }

  if (variant === "social_immediate" && isObject(resolution) && isObject(lecturer)) {
    push(errors, resolution.release === "immediate", "social_immediate requires immediate resolution release");
    push(errors, lecturer.resolution_control === "immediate", "social_immediate requires immediate lecturer resolution control");
  }
  if (variant === "social_delayed" && isObject(resolution) && isObject(lecturer)) {
    push(errors, resolution.release === "lecturer_controlled", "social_delayed requires lecturer_controlled resolution release");
    push(errors, lecturer.resolution_control === "lecturer_reopen", "social_delayed requires lecturer_reopen resolution control");
  }
  if (variant !== "social_immediate" && variant !== "social_delayed") {
    errors.push(`unsupported CWD variant ${variant}`);
  }

  return { valid: errors.length === 0, errors };
}

export function assertCwdConfig(config, variant) {
  const result = validateCwdConfig(config, variant);
  if (!result.valid) throw new CwdConfigError(result.errors);
  return config;
}

export function normalizeConfidenceScale(row) {
  if (!row) return null;
  const points = Array.isArray(row.points) ? row.points : [];
  const values = points.map((point) => point?.value);
  if (!points.length || !values.every((value) => Number.isInteger(value)) || !unique(values)) {
    throw new Error(`Invalid confidence scale ${row.id || "unknown"}`);
  }
  return {
    id: row.id,
    name: row.name,
    schema_version: row.schema_version,
    points: points
      .map((point) => ({ value: point.value, label: point.label }))
      .sort((a, b) => a.value - b.value),
  };
}

export function hashParticipantToken(sessionId, token) {
  if (typeof sessionId !== "string" || !sessionId) throw new Error("sessionId is required");
  if (typeof token !== "string" || token.length < 8 || token.length > 512) {
    throw new Error("Missing or invalid token");
  }
  return createHash("sha256").update(sessionId).update("\0").update(token).digest("hex");
}

export function lecturerKeyMatches(expected, supplied) {
  if (typeof expected !== "string" || expected.length < 16) return false;
  if (typeof supplied !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function confidenceValues(scaleSnapshot) {
  return Array.isArray(scaleSnapshot?.points)
    ? scaleSnapshot.points.map((point) => point.value)
    : [];
}

export function validateJudgementResponse(config, scaleSnapshot, response) {
  const errors = [];
  const optionIds = new Set((config?.judgement?.options || []).map((option) => option.id));
  push(errors, typeof response?.option_id === "string" && optionIds.has(response.option_id), "Invalid option");

  if (config?.confidence?.enabled) {
    const values = confidenceValues(scaleSnapshot);
    push(errors, Number.isInteger(response?.confidence) && values.includes(response.confidence), "Invalid confidence value");
  } else {
    push(errors, response?.confidence == null, "Confidence must be omitted when disabled");
  }

  return { valid: errors.length === 0, errors };
}

export function deriveCorrectness(config, optionId) {
  if (config?.evaluation?.mode !== "keyed") return null;
  return (config.evaluation.accepted_option_ids || []).includes(optionId);
}

export function sessionPhase(session) {
  if (session?.closed_at) return "closed";
  if (!session?.revealed_at) return "collecting";
  if (!session?.resolution_opened_at) return "revealed_waiting_for_resolution";
  return "resolution_open";
}

export function resolutionAvailable(config, session) {
  if (!session?.revealed_at || session?.closed_at) return false;
  if (config?.resolution?.release === "immediate") return true;
  return Boolean(session?.resolution_opened_at);
}

export function shouldAutoReveal(config, expectedCohortSize, liveCount) {
  const confrontation = config?.confrontation;
  if (confrontation?.reveal_mode !== "automatic") return false;
  if (confrontation.automatic_rule === "immediate") return liveCount > 0;
  if (confrontation.automatic_rule === "threshold") {
    const expected = expectedCohortSize ?? confrontation.expected_cohort_size;
    return Number.isInteger(expected) && expected > 0 && liveCount / expected >= confrontation.threshold;
  }
  return false;
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function buildCohortAggregate(config, scaleSnapshot, traces) {
  const options = [...(config?.judgement?.options || [])].sort((a, b) => a.order - b.order);
  const scaleValues = confidenceValues(scaleSnapshot);
  const entries = (traces || [])
    .filter((trace) => trace.committed_option_id)
    .map((trace) => ({
      option_id: trace.committed_option_id,
      confidence: trace.committed_confidence,
    }));
  const total = entries.length;

  const matrix = Object.fromEntries(
    options.map((option) => [option.id, scaleValues.map(() => 0)])
  );
  for (const entry of entries) {
    const confidenceIndex = scaleValues.indexOf(entry.confidence);
    if (matrix[entry.option_id] && confidenceIndex >= 0) matrix[entry.option_id][confidenceIndex] += 1;
  }

  const judgementDistribution = options.map((option) => {
    const matching = entries.filter((entry) => entry.option_id === option.id);
    const confidences = matching.map((entry) => entry.confidence).filter(Number.isInteger);
    return {
      option_id: option.id,
      label: option.label,
      count: matching.length,
      pct: total ? (matching.length / total) * 100 : null,
      mean_confidence: mean(confidences),
    };
  });

  const overallConfidences = entries.map((entry) => entry.confidence).filter(Number.isInteger);
  const sorted = [...judgementDistribution].sort((a, b) => b.count - a.count || a.option_id.localeCompare(b.option_id));
  const dominant = total ? sorted[0] : null;
  const occupiedCells = new Set(entries.map((entry) => `${entry.option_id}::${entry.confidence}`)).size;
  const occupiedOptions = judgementDistribution.filter((entry) => entry.count > 0).length;
  const highCutoffIndex = Math.max(0, Math.ceil(scaleValues.length * 0.8) - 1);
  const highCutoff = scaleValues[highCutoffIndex];
  const highCount = highCutoff == null ? 0 : entries.filter((entry) => entry.confidence >= highCutoff).length;
  const overallMean = mean(overallConfidences);

  const signals = [];
  if (dominant?.pct >= 60) {
    signals.push(`${Math.round(dominant.pct)}% of the room selected ${dominant.label}.`);
  } else if (dominant?.pct != null && dominant.pct < 50 && occupiedOptions > 1) {
    signals.push("No single judgement accounts for half of the room.");
  }
  if (overallMean != null && scaleValues.length) {
    const min = scaleValues[0];
    const max = scaleValues[scaleValues.length - 1];
    const span = Math.max(1, max - min);
    const ratio = (overallMean - min) / span;
    if (ratio >= 0.74) signals.push("Confidence is relatively high across the room.");
    else if (ratio <= 0.52) signals.push("The room is relatively cautious in its confidence.");
    else signals.push("Confidence is mixed rather than uniformly high or low.");
  }

  return {
    total,
    matrix,
    judgement_distribution: judgementDistribution,
    overall_confidence: overallMean,
    dominant_option_id: dominant?.option_id ?? null,
    dominant_pct: dominant?.pct ?? null,
    occupied_cells: occupiedCells,
    occupied_options: occupiedOptions,
    high_confidence_pct: total && highCutoff != null ? (highCount / total) * 100 : null,
    signals,
  };
}

export function validateResolution(config, scaleSnapshot, committedPosition, payload) {
  const errors = [];
  const allowedStates = RESOLUTION_PROFILES[config?.resolution?.profile] || new Set();
  push(errors, typeof payload?.resolution_state === "string" && allowedStates.has(payload.resolution_state), "Invalid resolution state");

  const optionIds = new Set((config?.judgement?.options || []).map((option) => option.id));
  let finalOptionId = payload?.final_option_id ?? committedPosition?.option_id ?? null;
  if (finalOptionId != null) push(errors, optionIds.has(finalOptionId), "Invalid final option");

  if (config?.resolution?.allow_revised_judgement === false && finalOptionId !== committedPosition?.option_id) {
    errors.push("Revised judgement is not allowed");
  }
  if (payload?.resolution_state === "different") {
    push(errors, finalOptionId != null && finalOptionId !== committedPosition?.option_id, "different resolution requires a different final option");
  }

  let finalConfidence = payload?.final_confidence ?? null;
  if (config?.confidence?.enabled) {
    const values = confidenceValues(scaleSnapshot);
    if (finalConfidence != null) push(errors, Number.isInteger(finalConfidence) && values.includes(finalConfidence), "Invalid final confidence");
    if (config?.resolution?.reassess_confidence === true) {
      push(errors, finalConfidence != null, "Final confidence is required");
    }
  } else {
    finalConfidence = null;
  }

  return {
    valid: errors.length === 0,
    errors,
    normalized: {
      resolution_state: payload?.resolution_state,
      final_option_id: finalOptionId,
      final_confidence: finalConfidence,
    },
  };
}

export function learnerSafeConfig(config) {
  const clone = structuredClone(config);
  if (clone?.evaluation) clone.evaluation.accepted_option_ids = [];
  return clone;
}

export function correctnessVisibleForTrace(config, session, trace) {
  if (config?.evaluation?.mode !== "keyed") return false;
  switch (config.evaluation.reveal_stage) {
    case "never":
      return false;
    case "confrontation":
      return Boolean(session?.revealed_at);
    case "guidance":
      return Boolean(trace?.guidance_reached_at);
    case "resolution":
      return Boolean(session?.resolution_opened_at);
    default:
      return false;
  }
}
