import { useState, useEffect } from 'react';

const AUTO_START = 30;

const fmtTime = (sec) => {
  if (sec < 60) return sec + ' секунд';
  const m = Math.floor(sec / 60);
  if (m === 1) return '1 минута';
  if (m < 5) return m + ' минуты';
  return m + ' минут';
};

export default function BlockTransition({ onContinue, hardTimeLimit = 60 }) {
  const [countdown, setCountdown] = useState(AUTO_START);

  useEffect(() => {
    if (countdown <= 0) { onContinue(); return; }
    const id = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(id);
  }, [countdown, onContinue]);

  const mm = String(Math.floor(countdown / 60)).padStart(2, '0');
  const ss = String(countdown % 60).padStart(2, '0');

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <div style={styles.icon}>✅</div>
        <h2 style={styles.title}>Блок Soft Skills завершён</h2>
        <p style={styles.text}>
          Отлично! Теперь переходим к блоку <strong>Hard Skills</strong>.
          У вас будет <strong>{fmtTime(hardTimeLimit)}</strong> на каждый вопрос.
          При истечении времени ответ сохраняется автоматически.
        </p>
        <p style={styles.countdown}>Автопереход через {mm}:{ss}</p>
        <button style={styles.btn} onClick={onContinue}>
          Начать Hard Skills →
        </button>
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1.5rem',
  },
  card: {
    background: 'white',
    borderRadius: '16px',
    padding: '2.5rem',
    maxWidth: '480px',
    width: '100%',
    textAlign: 'center',
    boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    alignItems: 'center',
  },
  icon: { fontSize: '3rem' },
  title: { fontSize: '1.5rem', fontWeight: '700', color: '#0f172a' },
  text: { color: '#475569', lineHeight: '1.6', fontSize: '0.95rem' },
  countdown: { fontSize: '0.85rem', color: '#94a3b8', fontVariantNumeric: 'tabular-nums' },
  btn: {
    marginTop: '0.5rem',
    padding: '0.875rem 2rem',
    background: '#0369a1',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
  },
};
