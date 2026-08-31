function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function push(errors, condition, message) {
  if (!condition) errors.push(message);
}

function unique(values) {
  return new Set(values).size === values.length;
}

export class CwdSelfAuditConfigError extends Error {
  constructor(errors) {
    super(`Invalid CWD self-audit configuration: ${errors.join("; ")}`);
    this.name = "CwdSelfAuditConfigError";
    this.errors = errors;
  }
}

export function validateCwdSelfAuditConfig(config, variant) {
  const errors = [];
  push(errors, variant === "self_audit", `unsupported CWD self-audit variant ${variant}`);
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

  push(errors, typeof config.entry?.text === "string" && config.entry.text.trim().length > 0, "entry.text must be non-empty");

  const judgement = config.judgement;
  push(errors, isObject(judgement), "judgement must be an object");
  const itemIds = [];
  const ratingValues = [];
  if (isObject(judgement)) {
    push(errors, judgement.mode === "multi_item", "judgement.mode must be multi_item");
    push(errors, judgement.semantics === "diagnostic_rating", "judgement.semantics must be diagnostic_rating");
    push(errors, typeof judgement.prompt === "string" && judgement.prompt.trim().length > 0, "judgement.prompt must be non-empty");
    push(errors, Array.isArray(judgement.items) && judgement.items.length >= 2 && judgement.items.length <= 20, "judgement.items must contain 2-20 items");
    if (Array.isArray(judgement.items)) {
      const orders = [];
      judgement.items.forEach((item, index) => {
        push(errors, isObject(item), `judgement.items[${index}] must be an object`);
        if (!isObject(item)) return;
        push(errors, typeof item.id === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(item.id), `judgement.items[${index}].id is invalid`);
        push(errors, typeof item.label === "string" && item.label.trim().length > 0, `judgement.items[${index}].label must be non-empty`);
        push(errors, Number.isInteger(item.order) && item.order >= 1, `judgement.items[${index}].order must be a positive integer`);
        if (typeof item.id === "string") itemIds.push(item.id);
        if (Number.isInteger(item.order)) orders.push(item.order);
      });
      push(errors, unique(itemIds), "diagnostic item ids must be unique");
      push(errors, unique(orders), "diagnostic item order values must be unique");
    }

    const scale = judgement.scale;
    push(errors, isObject(scale), "judgement.scale must be an object");
    if (isObject(scale)) {
      push(errors, typeof scale.id === "string" && scale.id.trim().length > 0, "judgement.scale.id must be non-empty");
      push(errors, typeof scale.name === "string" && scale.name.trim().length > 0, "judgement.scale.name must be non-empty");
      push(errors, Array.isArray(scale.points) && scale.points.length >= 3 && scale.points.length <= 7, "judgement.scale.points must contain 3-7 points");
      if (Array.isArray(scale.points)) {
        scale.points.forEach((point, index) => {
          push(errors, isObject(point), `judgement.scale.points[${index}] must be an object`);
          if (!isObject(point)) return;
          push(errors, Number.isInteger(point.value) && point.value >= 0, `judgement.scale.points[${index}].value must be a non-negative integer`);
          push(errors, typeof point.label === "string" && point.label.trim().length > 0, `judgement.scale.points[${index}].label must be non-empty`);
          if (Number.isInteger(point.value)) ratingValues.push(point.value);
        });
        push(errors, unique(ratingValues), "diagnostic rating values must be unique");
      }
    }
  }

  const evaluation = config.evaluation;
  push(errors, evaluation?.mode === "non_keyed", "self-audit evaluation must be non_keyed");
  push(errors, Array.isArray(evaluation?.accepted_option_ids) && evaluation.accepted_option_ids.length === 0, "self-audit accepted_option_ids must be empty");
  push(errors, evaluation?.reveal_stage === "never", "self-audit evaluation reveal_stage must be never");

  push(errors, config.confidence?.enabled === false, "self-audit confidence object must be disabled; diagnostic ratings are the judgement object");

  const confrontation = config.confrontation;
  push(errors, confrontation?.source === "self_diagnostic", "confrontation.source must be self_diagnostic");
  push(errors, confrontation?.reveal_mode === "not_applicable", "self-audit confrontation.reveal_mode must be not_applicable");
  push(errors, confrontation?.target_selection === "lowest_or_learner_choice_on_tie", "unsupported self-audit target_selection");
  push(errors, Array.isArray(confrontation?.required_outputs), "confrontation.required_outputs must be an array");

  const guidance = config.guidance;
  push(errors, guidance?.source === "targeted_diagnostic", "guidance.source must be targeted_diagnostic");
  push(errors, Array.isArray(guidance?.content) && guidance.content.length > 0, "targeted_diagnostic guidance requires content");
  if (Array.isArray(guidance?.content)) {
    const targets = [];
    guidance.content.forEach((block, index) => {
      push(errors, isObject(block), `guidance.content[${index}] must be an object`);
      if (!isObject(block)) return;
      push(errors, block.type === "diagnostic_cue", `guidance.content[${index}].type must be diagnostic_cue`);
      push(errors, itemIds.includes(block.target_item_id), `guidance.content[${index}].target_item_id is not a diagnostic item`);
      push(errors, typeof block.text === "string" && block.text.trim().length > 0, `guidance.content[${index}].text must be non-empty`);
      if (typeof block.target_item_id === "string") targets.push(block.target_item_id);
    });
    push(errors, unique(targets), "targeted guidance must define at most one block per item");
    push(errors, targets.length === itemIds.length && itemIds.every((id) => targets.includes(id)), "targeted guidance must cover every diagnostic item");
  }

  const resolution = config.resolution;
  push(errors, resolution?.profile === "diagnostic_rerating", "resolution.profile must be diagnostic_rerating");
  push(errors, resolution?.release === "immediate", "self-audit resolution.release must be immediate");
  push(errors, typeof resolution?.prompt === "string" && resolution.prompt.trim().length > 0, "resolution.prompt must be non-empty");
  push(errors, typeof resolution?.allow_same_rating === "boolean", "resolution.allow_same_rating must be boolean");

  const lecturer = config.lecturer;
  push(errors, lecturer?.aggregate_view === "diagnostic_needs", "lecturer.aggregate_view must be diagnostic_needs");
  push(errors, Array.isArray(lecturer?.post_metrics), "lecturer.post_metrics must be an array");
  push(errors, lecturer?.projector_summary === false, "self-audit projector_summary must be false");
  push(errors, typeof lecturer?.reset_session === "boolean", "lecturer.reset_session must be boolean");

  return { valid: errors.length === 0, errors };
}

export function assertCwdSelfAuditConfig(config, variant) {
  const result = validateCwdSelfAuditConfig(config, variant);
  if (!result.valid) throw new CwdSelfAuditConfigError(result.errors);
  return config;
}

export function diagnosticItemIds(config) {
  return (config?.judgement?.items || [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((item) => item.id);
}

export function diagnosticRatingValues(config) {
  return (config?.judgement?.scale?.points || [])
    .map((point) => point.value)
    .filter(Number.isInteger)
    .sort((a, b) => a - b);
}

export function validateDiagnosticProfile(config, ratings) {
  const errors = [];
  push(errors, isObject(ratings), "ratings must be an object");
  if (!isObject(ratings)) return { valid: false, errors };
  const itemIds = diagnosticItemIds(config);
  const allowed = new Set(diagnosticRatingValues(config));
  const keys = Object.keys(ratings);
  push(errors, keys.length === itemIds.length, "ratings must contain every diagnostic item exactly once");
  push(errors, keys.every((id) => itemIds.includes(id)), "ratings contain an unknown diagnostic item");
  for (const id of itemIds) {
    push(errors, Number.isInteger(ratings[id]) && allowed.has(ratings[id]), `Invalid rating for ${id}`);
  }
  return { valid: errors.length === 0, errors };
}

export function weakestDiagnosticCandidates(config, ratings) {
  const itemIds = diagnosticItemIds(config);
  if (!itemIds.length) return [];
  const values = itemIds.map((id) => ratings?.[id]).filter(Number.isInteger);
  if (values.length !== itemIds.length) return [];
  const minimum = Math.min(...values);
  return itemIds.filter((id) => ratings[id] === minimum);
}

export function validateDiagnosticTarget(config, ratings, itemId) {
  const candidates = weakestDiagnosticCandidates(config, ratings);
  return {
    valid: typeof itemId === "string" && candidates.includes(itemId),
    candidates,
  };
}

export function guidanceForDiagnosticTarget(config, itemId) {
  return (config?.guidance?.content || []).find((block) => block.target_item_id === itemId) || null;
}

export function validateDiagnosticRerating(config, committedProfile, targetItemId, rating) {
  const errors = [];
  const allowed = new Set(diagnosticRatingValues(config));
  push(errors, isObject(committedProfile), "Missing committed diagnostic profile");
  push(errors, typeof targetItemId === "string" && diagnosticItemIds(config).includes(targetItemId), "Missing diagnostic target");
  push(errors, Number.isInteger(rating) && allowed.has(rating), "Invalid rerating value");
  if (isObject(committedProfile) && typeof targetItemId === "string" && Number.isInteger(rating)) {
    const original = committedProfile[targetItemId];
    if (config?.resolution?.allow_same_rating === false) {
      push(errors, rating !== original, "Rerating must differ from the original rating");
    }
  }
  if (errors.length) return { valid: false, errors };
  const finalProfile = { ...committedProfile, [targetItemId]: rating };
  return {
    valid: true,
    errors: [],
    finalProfile,
    originalRating: committedProfile[targetItemId],
    finalRating: rating,
  };
}

export function buildDiagnosticAggregate(config, traces) {
  const itemIds = diagnosticItemIds(config);
  const ratingValues = diagnosticRatingValues(config);
  const items = Object.fromEntries(
    itemIds.map((id) => [
      id,
      {
        total: 0,
        ratings: Object.fromEntries(ratingValues.map((value) => [String(value), 0])),
        targeted: 0,
      },
    ])
  );

  for (const trace of traces || []) {
    const profile = trace.committed_diagnostic_profile;
    if (isObject(profile)) {
      for (const id of itemIds) {
        const rating = profile[id];
        if (Number.isInteger(rating) && items[id] && String(rating) in items[id].ratings) {
          items[id].total += 1;
          items[id].ratings[String(rating)] += 1;
        }
      }
    }
    if (trace.diagnostic_target_id && items[trace.diagnostic_target_id]) {
      items[trace.diagnostic_target_id].targeted += 1;
    }
  }

  return { total_profiles: (traces || []).filter((trace) => isObject(trace.committed_diagnostic_profile)).length, items };
}
