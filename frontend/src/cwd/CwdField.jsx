import { cohortDots, confidencePoints, markerPoint, optionAnchor, socialOptions } from "./model.js";

function pct(value) {
  return `${Number(value).toFixed(2)}%`;
}

export default function CwdField({
  activity,
  selectedOptionId = null,
  confidence = null,
  cohort = null,
  interactive = false,
  onSelect = null,
  hidden = false,
  showPersonal = true,
  className = "",
  ariaLabel = "Response field",
}) {
  const options = socialOptions(activity);
  const scaleValues = confidencePoints(activity).map((point) => point.value);
  const dots = hidden ? [] : cohortDots(activity, cohort);
  const personal =
    selectedOptionId && confidence != null
      ? markerPoint(selectedOptionId, confidence, options, scaleValues)
      : null;

  return (
    <div
      className={`cwd-field ${interactive ? "cwd-field--interactive" : ""} ${hidden ? "cwd-field--hidden" : ""} ${className}`}
      role={interactive ? "group" : "img"}
      aria-label={ariaLabel}
    >
      <div className="cwd-field-grid" aria-hidden="true" />
      <div className="cwd-field-glow" aria-hidden="true" />

      {options.map((option, index) => {
        const [x, y] = optionAnchor(index, options.length);
        const selected = selectedOptionId === option.id;
        const style = { "--cwd-x": pct(x), "--cwd-y": pct(y), "--cwd-option-index": index, "--cwd-zone-color": `var(--cwd-option-${index + 1}, var(--cwd-accent))` };

        if (interactive) {
          return (
            <button
              key={option.id}
              type="button"
              className={`cwd-zone ${selected ? "is-selected" : ""}`}
              style={style}
              onClick={() => onSelect?.(option.id)}
              aria-pressed={selected}
            >
              {option.label}
            </button>
          );
        }

        return (
          <div key={option.id} className="cwd-zone-label" style={style}>
            {option.label}
          </div>
        );
      })}

      {dots.map((dot) => {
        const optionIndex = Math.max(0, options.findIndex((option) => option.id === dot.optionId));
        return (
          <span
            key={dot.key}
            className="cwd-cohort-dot"
            data-option-index={optionIndex}
            style={{
              left: pct(dot.x),
              top: pct(dot.y),
              "--cwd-dot-scale": Math.min(1.85, 0.8 + Math.log2(dot.weight + 1) * 0.28),
              "--cwd-zone-color": `var(--cwd-option-${optionIndex + 1}, var(--cwd-accent))`,
            }}
            aria-hidden="true"
          />
        );
      })}

      {showPersonal && personal && (
        <span
          className="cwd-personal-marker"
          style={{
            left: pct(personal.x),
            top: pct(personal.y),
            "--cwd-personal-strength": 0.82 + personal.strength * 0.42,
          }}
        >
          <span aria-hidden="true" />
          <span className="sr-only">Your response</span>
        </span>
      )}
    </div>
  );
}
