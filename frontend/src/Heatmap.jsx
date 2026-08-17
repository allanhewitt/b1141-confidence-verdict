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
  showCounts = true,
  showTotals = true,
  hiddenSpace = false,
  ariaLabel = "Class responses by verdict and confidence",
}) {
  const safeMatrix = matrix || {};
  const allCounts = options.flatMap((opt) => safeMatrix[opt] || []);
  const max = Math.max(1, ...allCounts);
  const confidenceLevels = Array.from({ length: confidencePoints }, (_, i) => i + 1);
  const columns = `minmax(150px, 1.55fr) repeat(${confidencePoints}, minmax(44px, 1fr))${showTotals ? " 58px" : ""}`;

  return (
    <div className={`heatmap${hiddenSpace ? " hidden-space" : ""}`} role="img" aria-label={ariaLabel}>
      <div className="heatmap-grid heatmap-header" style={{ gridTemplateColumns: columns }}>
        <div />
        <div className="heatmap-axis-label" style={{ gridColumn: `span ${confidencePoints}` }}>
          Confidence
        </div>
        {showTotals && <div />}
      </div>
      <div className="heatmap-grid" style={{ gridTemplateColumns: columns }}>
        <div />
        {confidenceLevels.map((n) => (
          <div className="heatmap-col-number" key={n}>{n}</div>
        ))}
        {showTotals && <div className="heatmap-col-number">Total</div>}
      </div>

      {options.map((opt) => {
        const counts = safeMatrix[opt] || Array.from({ length: confidencePoints }, () => 0);
        const total = counts.reduce((a, b) => a + b, 0);
        const isCorrect = correctOption && opt === correctOption;
        const ramp = isCorrect ? RED_RAMP : BLUE_RAMP;
        return (
          <div className="heatmap-grid heatmap-row" style={{ gridTemplateColumns: columns }} key={opt}>
            <div className="heatmap-row-label">
              {opt}
              {isCorrect && <span className="heatmap-check">✓</span>}
            </div>
            {counts.map((count, index) => {
              const cellMarkers = markers.filter(
                (marker) => marker.option === opt && marker.confidence === index + 1
              );
              return (
                <div
                  key={index}
                  className={`heatmap-cell${cellMarkers.length ? " marked" : ""}${hiddenSpace ? " concealed" : ""}`}
                  style={{
                    background: hiddenSpace ? undefined : colorFor(count, max, ramp),
                    color: hiddenSpace || count === 0 ? "var(--muted)" : textColorFor(count, max),
                  }}
                >
                  {showCounts && !hiddenSpace && <span className="heatmap-count">{count === 0 ? "" : count}</span>}
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
            {showTotals && <div className="heatmap-total">{hiddenSpace ? "" : total}</div>}
          </div>
        );
      })}
    </div>
  );
}
