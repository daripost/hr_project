export default function Complete({ candidateName }) {
  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <div style={styles.icon}>🎉</div>
        <h2 style={styles.title}>Тестирование завершено!</h2>
        <p style={styles.text}>
          Спасибо, <strong>{candidateName}</strong>! Ваши ответы записаны.
        </p>
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
    gap: '0.75rem',
    alignItems: 'center',
  },
  icon: { fontSize: '3.5rem' },
  title: { fontSize: '1.75rem', fontWeight: '700', color: '#0f172a' },
  text: { color: '#475569', lineHeight: '1.6', fontSize: '0.95rem' },
};
