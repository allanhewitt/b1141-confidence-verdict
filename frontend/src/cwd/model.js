export const CWD_VISUAL_PROFILE = "cwd_hidden_field_v1";

export function sortByOrder(items = []) {
  return [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function socialOptions(activity) {
  return sortByOrder(activity?.config?.judgement?.options || []);
}

export function confidencePoints(activity) {
  return activity?.confidence_scale?.points || [];
}

export function diagnosticItems(activity) {
  return sortByOrder(activity?.config?.judgement?.items || []);
}

export function diagnosticScale(activity) {
  return activity?.config?.judgement?.scale?.points || [];
}

const ANCHORS = {
  1: [[50, 50]],
  2: [[24, 50], [76, 50]],
  3: [[50, 22], [25, 74], [75, 74]],
  4: [[24, 24], [76, 24], [24, 76], [76, 76]],
  5: [[50, 18], [82, 42], [70, 79], [30, 79], [18, 42]],
};

export function optionAnchor(index, count) {
  if (ANCHORS[count]) return ANCHORS[count][index] || [50, 50];
  const angle = -Math.PI / 2 + (index / Math.max(1, count)) * Math.PI * 2;
  return [50 + Math.cos(angle) * 33, 50 + Math.sin(angle) * 33];
}

export function markerPoint(optionId, confidence, options, scaleValues) {
  const optionIndex = Math.max(0, options.findIndex((option) => option.id === optionId));
  const [ax, ay] = optionAnchor(optionIndex, Math.max(1, options.length));
  const scaleIndex = Math.max(0, scaleValues.indexOf(confidence));
  const fraction = scaleValues.length <= 1 ? 0.8 : scaleIndex / (scaleValues.length - 1);
  const reach = 0.48 + fraction * 0.44;
  return {
    x: 50 + (ax - 50) * reach,
    y: 50 + (ay - 50) * reach,
    strength: fraction,
  };
}

function deterministicOffset(seed) {
  const angle = ((seed * 137.508) % 360) * (Math.PI / 180);
  const radius = 2.4 + (seed % 5) * 1.1;
  return [Math.cos(angle) * radius, Math.sin(angle) * radius];
}

export function cohortDots(activity, cohort) {
  const options = socialOptions(activity);
  const scaleValues = confidencePoints(activity).map((point) => point.value);
  const matrix = cohort?.matrix || {};
  const dots = [];

  options.forEach((option, optionIndex) => {
    const row = matrix[option.id] || [];
    row.forEach((count, confidenceIndex) => {
      if (!count) return;
      const confidence = scaleValues[confidenceIndex];
      const base = markerPoint(option.id, confidence, options, scaleValues);
      const visibleDots = Math.min(count, 8);
      for (let i = 0; i < visibleDots; i += 1) {
        const seed = optionIndex * 101 + confidenceIndex * 17 + i + 1;
        const [dx, dy] = deterministicOffset(seed);
        dots.push({
          key: `${option.id}-${confidence}-${i}`,
          optionId: option.id,
          confidence,
          count,
          x: Math.max(5, Math.min(95, base.x + dx)),
          y: Math.max(7, Math.min(93, base.y + dy)),
          weight: Math.max(1, count / visibleDots),
        });
      }
    });
  });

  return dots;
}

export function resolutionChoices(activity, committedConfidence) {
  const choices = sortByOrder(activity?.config?.resolution?.options || []);
  const scaleValues = confidencePoints(activity).map((point) => point.value);
  const min = scaleValues[0];
  const max = scaleValues[scaleValues.length - 1];

  return choices.map((choice) => ({
    ...choice,
    disabled:
      (choice.id === "same_more_confident" && committedConfidence === max) ||
      (choice.id === "same_less_confident" && committedConfidence === min),
  }));
}

export function allowedFinalConfidenceValues(activity, resolutionState, committedConfidence) {
  const values = confidencePoints(activity).map((point) => point.value);
  if (resolutionState === "same_more_confident") return values.filter((value) => value > committedConfidence);
  if (resolutionState === "same_less_confident") return values.filter((value) => value < committedConfidence);
  if (resolutionState === "same_similar_confidence") return values.filter((value) => value === committedConfidence);
  return values;
}

export function needsRevisedOption(resolutionState) {
  return resolutionState === "different" || resolutionState === "revise";
}

export function resolutionPayload({
  resolutionState,
  committedOptionId,
  finalOptionId,
  finalConfidence,
}) {
  return {
    resolution_state: resolutionState,
    final_option_id: finalOptionId || committedOptionId,
    final_confidence: finalConfidence ?? null,
  };
}

export function diagnosticTargetCandidates(activity, personal) {
  const ids = personal?.target_candidates || [];
  const byId = new Map(diagnosticItems(activity).map((item) => [item.id, item]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

export function diagnosticItem(activity, itemId) {
  return diagnosticItems(activity).find((item) => item.id === itemId) || null;
}

export function diagnosticStage(personal) {
  if (!personal?.profile) return "profile";
  if (personal.completed) return "complete";
  if (!personal.target_id) return "target";
  if (!personal.guidance_reached) return "guidance";
  return "rerate";
}

export function ratingLabel(activity, value) {
  return diagnosticScale(activity).find((point) => point.value === value)?.label || String(value);
}
