const BLUE_RAMP = ["#E6F1FB", "#B5D4F4", "#85B7EB", "#378ADD", "#185FA5", "#0C447C"];
const RED_RAMP = ["#FCEBEB", "#F7C1C1", "#F09595", "#E24B4A", "#A32D2D", "#791F1F"];

function colorFor(count, max, ramp) {
  if (count === 0) return "transparent";
  const idx = Math.min(ramp.length - 1, Math.round((count / max) * (ramp.length - 1)));
  return ramp[idx];
}

function textColorFor(count, max) {
  const idx = Math.min(5, Math.round((count / max) * 5));
  return idx >= 3 ? "#fff" : "var(--text)";
}

export default function Heatmap({
  options,
  confidencePoints,
  matrix,
  correctOption,
  markers = [],
  ariaLabel = "Class responses by verdict and confidence",
}) {
  const safeMatrix = matrix || {};
  const allCounts = options.flatMap((opt) => safeMatrix[opt] || []);
  const max = Math.max(1, ...allCounts);
  const confidenceLevels = Array.from({ length: confidencePoints }, (_, i) => i + 1);

  return (
    <div className="heatmap" role="img" aria-label={ariaLabel}>
      <div
        className="heatmap-grid heatmap-header"
        style={{ gridTemplateColumns: `minmax(150px, 1.55fr) repeat(${confidencePoints}, minmax(44px, 1fr)) 58px` }}
      >
        <div />
        <div className="heatmap-axis-label" style={{ gridColumn: `span ${confidencePoints}` }}>
          Confidence
        </div>
        <div />
      </div>
      <div
        className="heatmap-grid"
        style={{ gridTemplateColumns: `minmax(150px, 1.55fr) repeat(${confidencePoints}, minmax(44px, 1fr)) 58px` }}
      >
        <div />
        {confidenceLevels.map((n) => (
          <div className="heatmap-col-number" key={n}>
            {n}
          </div>
        ))}
        <div className="heatmap-col-number">Total</div>
      </div>

      {options.map((opt) => {
        const counts = safeMatrix[opt] || Array.from({ length: confidencePoints }, () => 0);
        const total = counts.reduce((a, b) => a + b, 0);
        const isCorrect = correctOption && opt === correctOption;
        const ramp = isCorrect ? RED_RAMP : BLUE_RAMP;
        return (
          <div
            className="heatmap-grid heatmap-row"
            style={{ gridTemplateColumns: `minmax(150px, 1.55fr) repeat(${confidencePoints}, minmax(44px, 1fr)) 58px` }}
            key={opt}
          >
            <div className="heatmap-row-label">
              {opt}
              {isCorrect && <span className="heatmap-check">✓</span>}
            </div>
            {counts.map((c, i) => {
              const cellMarkers = markers.filter(
                (marker) => marker.option === opt && marker.confidence === i + 1
              );
              return (
                <div
                  key={i}
                  className={`heatmap-cell${cellMarkers.length ? " marked" : ""}`}
                  style={{
                    background: colorFor(c, max, ramp),
                    color: c === 0 ? "var(--muted)" : textColorFor(c, max),
                  }}
                >
                  <span className="heatmap-count">{c === 0 ? "" : c}</span>
                  {cellMarkers.map((marker, markerIndex) => (
                    <span
                      className={`heatmap-marker ${marker.kind || "personal"}`}
                      key={`${marker.label}-${markerIndex}`}
                    >
                      {marker.label}
                    </span>
                  ))}
                </div>
              );
            })}
            <div className="heatmap-total">{total}</div>
          </div>
        );
      })}
    </div>
  );
}
