const WARNING_THRESHOLD = 15;

export default function Timer({ timeLeft, total }) {
  const pct = (timeLeft / total) * 100;
  const isWarning = timeLeft <= WARNING_THRESHOLD;

  const color = isWarning ? '#dc2626' : timeLeft <= total * 0.4 ? '#d97706' : '#2563eb';
  const bgColor = isWarning ? '#fee2e2' : '#f1f5f9';

  const mm = String(Math.floor(timeLeft / 60)).padStart(2, '0');
  const ss = String(timeLeft % 60).padStart(2, '0');

  return (
    <div style={{ ...styles.wrap, background: bgColor }}>
      <span style={{ ...styles.time, color }}>
        {mm}:{ss}
      </span>
      <div style={styles.barTrack}>
        <div
          style={{
            ...styles.barFill,
            width: `${pct}%`,
            background: color,
            transition: 'width 1s linear, background 0.3s',
          }}
        />
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.5rem 1rem',
    borderRadius: '8px',
    transition: 'background 0.3s',
  },
  time: {
    fontVariantNumeric: 'tabular-nums',
    fontWeight: '700',
    fontSize: '1.25rem',
    minWidth: '3.5rem',
  },
  barTrack: {
    flex: 1,
    height: '6px',
    background: '#e2e8f0',
    borderRadius: '99px',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: '99px',
  },
};
