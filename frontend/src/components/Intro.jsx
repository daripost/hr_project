import { useState, useRef } from 'react';

const fmtTime = (sec) => {
  if (sec < 60) return sec + ' секунд';
  const m = Math.floor(sec / 60);
  if (m === 1) return '1 минута';
  if (m < 5) return m + ' минуты';
  return m + ' минут';
};

export default function Intro({ onStart, softTimeLimit = 60, hardTimeLimit = 60 }) {
  const [name, setName] = useState('');
  const [resume, setResume] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) { setResume(null); return; }
    if (file.type !== 'application/pdf') {
      setResume(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setError('Пожалуйста, выберите файл в формате PDF.');
      return;
    }
    setError('');
    setResume(file);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!resume) { setError('Пожалуйста, прикрепите резюме в формате PDF.'); return; }

    setLoading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('candidateName', trimmed);
      formData.append('resume', resume);

      const res = await fetch('/api/sessions', {
        method: 'POST',
        body: formData,
      });
      if (res.status === 409) {
        setError('Повторное прохождение тестирования не предусмотрено.');
        return;
      }
      if (!res.ok) throw new Error('Ошибка сервера');
      const { sessionId } = await res.json();
      onStart(sessionId, trimmed);
    } catch {
      setError('Не удалось подключиться к серверу. Проверьте, что бэкенд запущен.');
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = !loading && name.trim() && resume;

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <div style={styles.badge}>Middle PHP Developer</div>
        <h1 style={styles.title}>Оценка кандидата</h1>
        <p style={styles.subtitle}>
          Тест состоит из двух блоков: <strong>Soft Skills</strong> ({fmtTime(softTimeLimit)} на каждый вопрос)
          и <strong>Hard Skills</strong> ({fmtTime(hardTimeLimit)} на каждый вопрос).
        </p>

        <div style={styles.rules}>
          <div style={styles.rule}><span style={styles.ruleIcon}>⏱️</span> Таймер запускается автоматически</div>
          <div style={styles.rule}><span style={styles.ruleIcon}>➡️</span> При истечении времени — автопереход к следующему вопросу</div>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.label}>Ваше имя и фамилия</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Иванов Иван"
            style={styles.input}
            autoFocus
            required
          />

          <label style={styles.label}>
            Резюме <span style={styles.required}>*</span>
            <span style={styles.labelHint}> — только PDF</span>
          </label>
          <div style={styles.fileWrap}>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              onChange={handleFileChange}
              style={styles.fileInput}
              required
            />
            {resume && (
              <div style={styles.fileChosen}>
                <span style={styles.fileIcon}>📄</span>
                <span style={styles.fileName}>{resume.name}</span>
                <button
                  type="button"
                  style={styles.fileRemove}
                  onClick={() => { setResume(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                >×</button>
              </div>
            )}
          </div>

          {error && <p style={styles.error}>{error}</p>}
          <button type="submit" style={{ ...styles.btn, ...(canSubmit ? {} : styles.btnDisabled) }} disabled={!canSubmit}>
            {loading ? 'Подготовка...' : 'Начать тестирование →'}
          </button>
        </form>
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
    maxWidth: '520px',
    width: '100%',
    boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
  },
  badge: {
    display: 'inline-block',
    background: '#dbeafe',
    color: '#1d4ed8',
    fontSize: '0.75rem',
    fontWeight: '600',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    padding: '4px 12px',
    borderRadius: '20px',
    marginBottom: '1rem',
  },
  title: {
    fontSize: '1.75rem',
    fontWeight: '700',
    marginBottom: '0.75rem',
    color: '#0f172a',
  },
  subtitle: {
    color: '#475569',
    lineHeight: '1.6',
    marginBottom: '1.5rem',
    fontSize: '0.95rem',
  },
  rules: {
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: '10px',
    padding: '1rem 1.25rem',
    marginBottom: '1.75rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  rule: {
    fontSize: '0.875rem',
    color: '#374151',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  ruleIcon: { fontSize: '1rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  label: { fontWeight: '500', fontSize: '0.875rem', color: '#374151' },
  required: { color: '#ef4444' },
  labelHint: { fontWeight: '400', color: '#94a3b8', fontSize: '0.8rem' },
  input: {
    padding: '0.75rem 1rem',
    borderRadius: '8px',
    border: '1.5px solid #e2e8f0',
    fontSize: '1rem',
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  fileWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  fileInput: {
    padding: '0.5rem 0',
    fontSize: '0.9rem',
    color: '#374151',
    cursor: 'pointer',
  },
  fileChosen: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    background: '#f0fdf4',
    border: '1px solid #bbf7d0',
    borderRadius: '8px',
    padding: '0.5rem 0.75rem',
  },
  fileIcon: { fontSize: '1rem' },
  fileName: {
    fontSize: '0.875rem',
    color: '#166534',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  fileRemove: {
    background: 'none',
    border: 'none',
    color: '#64748b',
    fontSize: '1.1rem',
    cursor: 'pointer',
    padding: '0 2px',
    lineHeight: 1,
  },
  btn: {
    marginTop: '0.5rem',
    padding: '0.875rem',
    background: '#2563eb',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'background 0.2s',
  },
  btnDisabled: {
    background: '#93c5fd',
    cursor: 'not-allowed',
  },
  error: {
    color: '#dc2626',
    fontSize: '0.875rem',
  },
};
