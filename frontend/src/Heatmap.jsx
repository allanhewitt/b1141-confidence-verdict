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

export default function Heatmap({ options, confidencePoints, matrix, correctOption }) {
  const allCounts = options.flatMap((opt) => matrix[opt] || []);
  const max = Math.max(1, ...allCounts);
  const confidenceLevels = Array.from({ length: confidencePoints }, (_, i) => i + 1);

  return (
    <div className="heatmap">
      <div
        className="heatmap-grid heatmap-header"
        style={{ gridTemplateColumns: `150px repeat(${confidencePoints}, 1fr) 56px` }}
      >
        <div />
        <div className="heatmap-axis-label" style={{ gridColumn: `span ${confidencePoints}` }}>
          Confidence
        </div>
        <div />
      </div>
      <div
        className="heatmap-grid"
        style={{ gridTemplateColumns: `150px repeat(${confidencePoints}, 1fr) 56px` }}
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
        const counts = matrix[opt] || Array.from({ length: confidencePoints }, () => 0);
        const total = counts.reduce((a, b) => a + b, 0);
        const isCorrect = correctOption && opt === correctOption;
        const ramp = isCorrect ? RED_RAMP : BLUE_RAMP;
        return (
          <div
            className="heatmap-grid heatmap-row"
            style={{ gridTemplateColumns: `150px repeat(${confidencePoints}, 1fr) 56px` }}
            key={opt}
          >
            <div className="heatmap-row-label">
              {opt}
              {isCorrect && <span className="heatmap-check">✓</span>}
            </div>
            {counts.map((c, i) => (
              <div
                key={i}
                className="heatmap-cell"
                style={{
                  background: colorFor(c, max, ramp),
                  color: c === 0 ? "var(--muted)" : textColorFor(c, max),
                }}
              >
                {c === 0 ? "" : c}
              </div>
            ))}
            <div className="heatmap-total">{total}</div>
          </div>
        );
      })}
    </div>
  );
}
