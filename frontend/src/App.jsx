import { useState, useEffect } from 'react';
import Intro from './components/Intro.jsx';
import QuestionScreen from './components/QuestionScreen.jsx';
import BlockTransition from './components/BlockTransition.jsx';
import Complete from './components/Complete.jsx';

// Запасной вариант если API недоступен
import { SOFT_SKILLS, HARD_SKILLS } from './data/questions.js';
const FALLBACK = {
  soft: { timeLimit: 60, questions: SOFT_SKILLS },
  hard: { timeLimit: 60, questions: HARD_SKILLS },
};

const STORAGE_KEY = 'hr_assessment_done';

export default function App() {
  const [screen, setScreen] = useState('loading');
  const [questions, setQuestions] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [candidateName, setCandidateName] = useState('');
  const [prevAttempt, setPrevAttempt] = useState(null);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try { setPrevAttempt(JSON.parse(stored)); } catch { localStorage.removeItem(STORAGE_KEY); }
    }
    fetch('/api/questions')
      .then(r => r.json())
      .then(data => { setQuestions(data); setScreen(stored ? 'already_done' : 'intro'); })
      .catch(() => { setQuestions(FALLBACK); setScreen(stored ? 'already_done' : 'intro'); });
  }, []);

  if (screen === 'loading') {
    return (
      <div style={styles.loading}>
        <p style={styles.loadingText}>Загрузка...</p>
      </div>
    );
  }

  const handleStart = (sid, name) => {
    setSessionId(sid);
    setCandidateName(name);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ name, startedAt: Date.now() }));
    setScreen('soft');
  };

  const handleSoftComplete = () => setScreen('transition');

  const handleHardComplete = async () => {
    try { await fetch('/api/sessions/' + sessionId + '/complete', { method: 'POST' }); } catch { /* ignore */ }
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...stored, completedAt: Date.now() }));
    setScreen('complete');
  };

  if (screen === 'already_done') {
    const date = prevAttempt?.completedAt
      ? new Date(prevAttempt.completedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : null;
    return (
      <div style={stylesApp.wrap}>
        <div style={stylesApp.card}>
          <div style={stylesApp.icon}>⚠️</div>
          <h2 style={stylesApp.title}>Вы уже проходили тестирование</h2>
          <p style={stylesApp.text}>
            {prevAttempt?.name && <><strong>{prevAttempt.name}</strong>, вы{' '}</>}
            уже проходили это тестирование{date && <> {date}</>}.
            Повторное прохождение не предусмотрено.
          </p>
          <p style={stylesApp.sub}>Если вы считаете, что это ошибка — обратитесь к HR.</p>
          <button
            style={stylesApp.resetBtn}
            onClick={() => { localStorage.removeItem(STORAGE_KEY); setScreen('intro'); setPrevAttempt(null); }}
          >
            Начать заново
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {screen === 'intro' && (
        <Intro
          onStart={handleStart}
          softTimeLimit={questions.soft.timeLimit}
          hardTimeLimit={questions.hard.timeLimit}
        />
      )}
      {screen === 'soft' && (
        <QuestionScreen
          key="soft"
          block="soft"
          questions={questions.soft.questions}
          timeLimit={questions.soft.timeLimit}
          sessionId={sessionId}
          onBlockComplete={handleSoftComplete}
        />
      )}
      {screen === 'transition' && (
        <BlockTransition
          hardTimeLimit={questions.hard.timeLimit}
          onContinue={() => setScreen('hard')}
        />
      )}
      {screen === 'hard' && (
        <QuestionScreen
          key="hard"
          block="hard"
          questions={questions.hard.questions}
          timeLimit={questions.hard.timeLimit}
          sessionId={sessionId}
          onBlockComplete={handleHardComplete}
        />
      )}
      {screen === 'complete' && (
        <Complete candidateName={candidateName} />
      )}
    </>
  );
}

const styles = {
  loading: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#94a3b8',
    fontSize: '1rem',
  },
};

const stylesApp = {
  wrap: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1.5rem',
    background: '#f1f5f9',
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
  icon: { fontSize: '3rem' },
  title: { fontSize: '1.5rem', fontWeight: '700', color: '#0f172a' },
  text: { color: '#475569', lineHeight: '1.6', fontSize: '0.95rem' },
  sub: { color: '#94a3b8', fontSize: '0.85rem' },
  resetBtn: { marginTop: '0.5rem', background: 'none', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.5rem 1.25rem', fontSize: '0.8rem', color: '#64748b', cursor: 'pointer' },
};
