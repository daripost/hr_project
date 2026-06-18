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

export default function App() {
  const [screen, setScreen] = useState('loading');
  const [questions, setQuestions] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [candidateName, setCandidateName] = useState('');

  useEffect(() => {
    fetch('/api/questions')
      .then(r => r.json())
      .then(data => { setQuestions(data); setScreen('intro'); })
      .catch(() => { setQuestions(FALLBACK); setScreen('intro'); });
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
    setScreen('soft');
  };

  const handleSoftComplete = () => setScreen('transition');

  const handleHardComplete = async () => {
    try { await fetch('/api/sessions/' + sessionId + '/complete', { method: 'POST' }); } catch { /* ignore */ }
    setScreen('complete');
  };

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
