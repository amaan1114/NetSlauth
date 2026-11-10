export function Brand() {
  return (
    <div className="brand" aria-label="NetSleuth">
      <span className="brand-mark" aria-hidden="true">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
          <path d="M4 12h4l2.1-5 4 10 2.1-5H20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.3" opacity=".45" />
        </svg>
      </span>
      <span>
        <span className="brand-name">NetSleuth</span>
        <span className="brand-caption" style={{ display: "block" }}>Infrastructure signals</span>
      </span>
    </div>
  );
}
