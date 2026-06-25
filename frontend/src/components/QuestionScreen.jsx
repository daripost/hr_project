import { useEffect, useRef, useState, useCallback } from 'react';
import Timer from './Timer.jsx';

const MIN_TIME = 15;

export default function QuestionScreen({
  block,
  questions,
  timeLimit,
  sessionId,
  startIndex = 0,
  onBlockComplete,
}) {
  const [index, setIndex] = useState(startIndex);
  const [timeLeft, setTimeLeft] = useState(timeLimit);
  const [answer, setAnswer] = useState('');
  const [pasteBlocked, setPasteBlocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [minTimeLeft, setMinTimeLeft] = useState(MIN_TIME);
  const canAdvance = minTimeLeft <= 0;
  const startTime = useRef(Date.now());
  const endTimeRef = useRef(Date.now() + timeLimit * 1000);
  const textareaRef = useRef(null);
  const answerRef = useRef('');

  const question = questions[index];
  const total = questions.length;

  const handleAnswerChange = (e) => {
    const inputType = e.nativeEvent?.inputType;
    if (
      inputType === 'insertFromPaste' ||
      inputType === 'insertFromDrop' ||
      inputType === 'insertFromPasteAsQuotation'
    ) {
      e.target.value = answerRef.current;
      setAnswer(answerRef.current);
      setPasteBlocked(true);
      setTimeout(() => setPasteBlocked(false), 2000);
      fetch('/api/paste-attempts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, block, questionIndex: index }),
      }).catch(() => {});
      return;
    }
    answerRef.current = e.target.value;
    setAnswer(e.target.value);
  };

  const saveAndAdvance = useCallback(async (auto) => {
    if (saving) return;
    setSaving(true);
    setSaveError(false);

    const answerText = answerRef.current.trim() || null;
    const timeSpent = Math.round((Date.now() - startTime.current) / 1000);
    const payload = { sessionId, block, questionIndex: index, questionText: question, answerText, timeSpent, autoSubmitted: auto };
    const doFetch = () => fetch('/api/answers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    let ok = false;
    try {
      const res = await doFetch();
      ok = res.ok;
    } catch {
      await new Promise(r => setTimeout(r, 1200));
      try { const res2 = await doFetch(); ok = res2.ok; } catch { ok = false; }
    }
    if (!ok) setSaveError(true);

    const next = index + 1;
    if (next >= total) {
      onBlockComplete();
    } else {
      const now = Date.now();
      endTimeRef.current = now + timeLimit * 1000;
      startTime.current = now;
      setIndex(next);
      setTimeLeft(timeLimit);
      answerRef.current = '';
      setAnswer('');
    }
    setSaving(false);
  }, [saving, index, total, block, question, sessionId, timeLimit, onBlockComplete]);

  useEffect(() => {
    if (timeLeft <= 0) {
      saveAndAdvance(true);
      return;
    }
    const id = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((endTimeRef.current - Date.now()) / 1000));
      setTimeLeft(remaining);
    }, 500);
    return () => clearInterval(id);
  }, [timeLeft, saveAndAdvance]);

  useEffect(() => {
    if (minTimeLeft <= 0) return;
    const id = setTimeout(() => setMinTimeLeft(t => Math.max(0, t - 1)), 1000);
    return () => clearTimeout(id);
  }, [minTimeLeft]);

  useEffect(() => {
    startTime.current = Date.now();
    setMinTimeLeft(MIN_TIME);
    textareaRef.current?.focus();
  }, [index]);

  useEffect(() => {
    const blockCopy = (e) => { if (e.target.tagName !== 'TEXTAREA') e.preventDefault(); };
    document.addEventListener('copy', blockCopy);
    document.addEventListener('cut', blockCopy);
    return () => {
      document.removeEventListener('copy', blockCopy);
      document.removeEventListener('cut', blockCopy);
    };
  }, []);

  const handlePasteAttempt = (e) => {
    e.preventDefault();
    setPasteBlocked(true);
    setTimeout(() => setPasteBlocked(false), 2000);
    fetch('/api/paste-attempts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, block, questionIndex: index }),
    }).catch(() => {});
  };

  const blockLabel = block === 'soft' ? 'Soft Skills' : 'Hard Skills';
  const blockColor = block === 'soft' ? '#7c3aed' : '#0369a1';

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <div style={styles.header}>
          <div style={{ ...styles.blockBadge, background: blockColor + '18', color: blockColor }}>
            {blockLabel}
          </div>
          <div style={styles.progress}>
            {Array.from({ length: total }).map((_, i) => (
              <div
                key={i}
                style={{
                  ...styles.dot,
                  background: i < index ? blockColor : i === index ? blockColor : '#e2e8f0',
                  opacity: i < index ? 0.4 : 1,
                }}
              />
            ))}
          </div>
          <span style={styles.counter}>{index + 1} / {total}</span>
        </div>

        <Timer timeLeft={timeLeft} total={timeLimit} />

        <div style={styles.questionWrap}>
          <p style={styles.questionText}>{question}</p>
        </div>

        <div style={styles.textareaWrap}>
          <textarea
            ref={textareaRef}
            value={answer}
            onChange={handleAnswerChange}
            onPaste={handlePasteAttempt}
            onDrop={handlePasteAttempt}
            onContextMenu={e => e.preventDefault()}
            placeholder="Начните печатать ответ..."
            style={styles.textarea}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
          {pasteBlocked && (
            <div style={styles.pasteWarning}>
              Вставка запрещена — печатайте ответ вручную
            </div>
          )}
        </div>

        {saveError && (
          <div style={styles.saveError}>
            ⚠ Ответ мог не сохраниться — проверьте соединение
          </div>
        )}
        <div style={styles.footer}>
          <span style={styles.charCount}>{answer.length} символов</span>
          <button
            style={{
              ...styles.nextBtn,
              opacity: (saving || !canAdvance) ? 0.6 : 1,
              cursor: (saving || !canAdvance) ? 'not-allowed' : 'pointer',
            }}
            onClick={() => canAdvance && saveAndAdvance(false)}
            disabled={saving || !canAdvance}
          >
            {saving
              ? 'Сохранение...'
              : !canAdvance
                ? `Подождите ${minTimeLeft} с...`
                : index + 1 < total
                  ? 'Следующий вопрос →'
                  : 'Завершить блок →'}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: '1.5rem',
    paddingTop: '2rem',
  },
  card: {
    background: 'white',
    borderRadius: '16px',
    padding: '1.75rem',
    maxWidth: '720px',
    width: '100%',
    boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    flexWrap: 'wrap',
  },
  blockBadge: {
    fontSize: '0.75rem',
    fontWeight: '700',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    padding: '4px 12px',
    borderRadius: '20px',
  },
  progress: {
    display: 'flex',
    gap: '5px',
    flex: 1,
    flexWrap: 'wrap',
  },
  dot: {
    width: '20px',
    height: '6px',
    borderRadius: '99px',
    transition: 'background 0.3s',
  },
  counter: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#64748b',
    whiteSpace: 'nowrap',
  },
  questionWrap: {
    background: '#f8fafc',
    borderRadius: '10px',
    padding: '1rem 1.25rem',
    border: '1px solid #e2e8f0',
  },
  questionText: {
    fontSize: '1.05rem',
    lineHeight: '1.6',
    color: '#1e293b',
    fontWeight: '500',
    userSelect: 'none',
  },
  textareaWrap: {
    position: 'relative',
  },
  textarea: {
    width: '100%',
    minHeight: '200px',
    padding: '1rem',
    fontSize: '1rem',
    lineHeight: '1.6',
    border: '1.5px solid #e2e8f0',
    borderRadius: '12px',
    resize: 'vertical',
    outline: 'none',
    fontFamily: 'inherit',
    color: '#1e293b',
    background: 'white',
    boxSizing: 'border-box',
    transition: 'border-color 0.2s',
  },
  saveError: {
    background: '#fef3c7',
    border: '1px solid #fcd34d',
    borderRadius: '8px',
    padding: '0.5rem 1rem',
    fontSize: '0.82rem',
    color: '#92400e',
    fontWeight: '500',
  },
  pasteWarning: {
    position: 'absolute',
    bottom: '10px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#1e293b',
    color: 'white',
    fontSize: '0.8rem',
    padding: '6px 14px',
    borderRadius: '20px',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
  },
  charCount: {
    fontSize: '0.8rem',
    color: '#94a3b8',
    whiteSpace: 'nowrap',
  },
  nextBtn: {
    flex: 1,
    padding: '0.875rem',
    background: '#2563eb',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: '600',
    transition: 'opacity 0.2s',
  },
};
