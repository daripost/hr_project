const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

const app = express();
app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));

const esc = (str) => String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// ─── Авторизация HR ───────────────────────────────────────────────────────────

const SESSION_TTL = 8 * 60 * 60 * 1000; // 8 часов
const hrSessions = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [token, { expires }] of hrSessions) {
    if (now > expires) hrSessions.delete(token);
  }
}, 60 * 60 * 1000);

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100_000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
};

const verifyPassword = (password, stored) => {
  const [salt, hash] = stored.split(':');
  const check = crypto.pbkdf2Sync(password, salt, 100_000, 64, 'sha512').toString('hex');
  return check === hash;
};

const requireAuth = (req, res, next) => {
  const token = req.cookies?.hr_session;
  if (token && hrSessions.has(token)) {
    const s = hrSessions.get(token);
    if (Date.now() < s.expires) {
      s.expires = Date.now() + SESSION_TTL;
      return next();
    }
    hrSessions.delete(token);
  }
  res.redirect('/hr/login');
};

const authPageShell = (title, content) => `<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>HR · ${esc(title)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#f1f5f9;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem}
  .card{background:white;border-radius:16px;padding:2.5rem;width:100%;max-width:400px;box-shadow:0 4px 24px rgba(0,0,0,.08)}
  .logo{font-size:.7rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#2563eb;margin-bottom:.75rem}
  h1{font-size:1.5rem;font-weight:700;color:#0f172a;margin-bottom:.35rem}
  .sub{font-size:.875rem;color:#64748b;margin-bottom:1.75rem;line-height:1.5}
  label{display:block;font-size:.8rem;font-weight:600;color:#374151;margin-bottom:.3rem}
  input{width:100%;padding:.7rem .9rem;border:1.5px solid #e2e8f0;border-radius:8px;font-size:.95rem;margin-bottom:1rem;outline:none;transition:border-color .15s;font-family:inherit}
  input:focus{border-color:#2563eb}
  .alert-error{background:#fee2e2;color:#991b1b;font-size:.82rem;padding:.6rem .9rem;border-radius:8px;margin-bottom:1rem}
  .alert-info{background:#dbeafe;color:#1e40af;font-size:.82rem;padding:.6rem .9rem;border-radius:8px;margin-bottom:1rem}
  .btn{width:100%;padding:.8rem;background:#2563eb;color:white;border:none;border-radius:8px;font-size:.95rem;font-weight:600;cursor:pointer;margin-top:.25rem}
  .btn:hover{background:#1d4ed8}
  .link-row{text-align:center;margin-top:1.25rem;font-size:.82rem;color:#64748b}
  .link-row a{color:#2563eb;text-decoration:none;font-weight:500}
  .link-row a:hover{text-decoration:underline}
  .hint{font-size:.78rem;color:#94a3b8;margin-top:-.6rem;margin-bottom:1rem}
</style></head>
<body><div class="card">${content}</div></body></html>`;

// Вход
app.get('/hr/login', (req, res) => {
  const token = req.cookies?.hr_session;
  if (token && hrSessions.has(token)) return res.redirect('/hr');
  const noUsers = db.prepare('SELECT COUNT(*) as cnt FROM hr_users').get().cnt === 0;
  res.send(authPageShell('Вход', `
    <div class="logo">HR Dashboard</div>
    <h1>Вход</h1>
    <p class="sub">Middle PHP Developer · Оценка кандидатов</p>
    ${noUsers ? '<div class="alert-info">Пользователей ещё нет — создайте первый аккаунт.</div>' : ''}
    <form method="POST" action="/hr/login">
      <label>Логин</label>
      <input type="text" name="username" autocomplete="username" autofocus required/>
      <label>Пароль</label>
      <input type="password" name="password" autocomplete="current-password" required/>
      <button class="btn" type="submit">Войти →</button>
    </form>
    <div class="link-row"><a href="/hr/register">Зарегистрироваться</a></div>
  `));
});

app.post('/hr/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT password_hash FROM hr_users WHERE username = ?').get(username?.trim());
  if (user && verifyPassword(password, user.password_hash)) {
    const token = crypto.randomBytes(32).toString('hex');
    hrSessions.set(token, { expires: Date.now() + SESSION_TTL });
    res.cookie('hr_session', token, { httpOnly: true, sameSite: 'strict', maxAge: SESSION_TTL });
    return res.redirect('/hr');
  }
  res.status(401).send(authPageShell('Вход', `
    <div class="logo">HR Dashboard</div>
    <h1>Вход</h1>
    <p class="sub">Middle PHP Developer · Оценка кандидатов</p>
    <div class="alert-error">Неверный логин или пароль</div>
    <form method="POST" action="/hr/login">
      <label>Логин</label>
      <input type="text" name="username" autocomplete="username" autofocus required/>
      <label>Пароль</label>
      <input type="password" name="password" autocomplete="current-password" required/>
      <button class="btn" type="submit">Войти →</button>
    </form>
    <div class="link-row"><a href="/hr/register">Зарегистрироваться</a></div>
  `));
});

// Регистрация
app.get('/hr/register', (req, res) => {
  const token = req.cookies?.hr_session;
  if (token && hrSessions.has(token)) return res.redirect('/hr');
  res.send(authPageShell('Регистрация', `
    <div class="logo">HR Dashboard</div>
    <h1>Регистрация</h1>
    <p class="sub">Создайте аккаунт для доступа к результатам тестирования</p>
    <form method="POST" action="/hr/register">
      <label>Логин</label>
      <input type="text" name="username" autocomplete="username" autofocus required minlength="3" maxlength="50"/>
      <label>Пароль</label>
      <input type="password" name="password" autocomplete="new-password" required minlength="6"/>
      <p class="hint">Минимум 6 символов</p>
      <label>Повторите пароль</label>
      <input type="password" name="password2" autocomplete="new-password" required minlength="6"/>
      <button class="btn" type="submit">Создать аккаунт →</button>
    </form>
    <div class="link-row">Уже есть аккаунт? <a href="/hr/login">Войти</a></div>
  `));
});

app.post('/hr/register', (req, res) => {
  const { username, password, password2 } = req.body;
  const name = username?.trim();

  const fail = (msg) => res.status(400).send(authPageShell('Регистрация', `
    <div class="logo">HR Dashboard</div>
    <h1>Регистрация</h1>
    <p class="sub">Создайте аккаунт для доступа к результатам тестирования</p>
    <div class="alert-error">${esc(msg)}</div>
    <form method="POST" action="/hr/register">
      <label>Логин</label>
      <input type="text" name="username" value="${esc(name || '')}" autocomplete="username" autofocus required minlength="3" maxlength="50"/>
      <label>Пароль</label>
      <input type="password" name="password" autocomplete="new-password" required minlength="6"/>
      <p class="hint">Минимум 6 символов</p>
      <label>Повторите пароль</label>
      <input type="password" name="password2" autocomplete="new-password" required minlength="6"/>
      <button class="btn" type="submit">Создать аккаунт →</button>
    </form>
    <div class="link-row">Уже есть аккаунт? <a href="/hr/login">Войти</a></div>
  `));

  if (!name || name.length < 3) return fail('Логин должен содержать минимум 3 символа');
  if (!password || password.length < 6) return fail('Пароль должен содержать минимум 6 символов');
  if (password !== password2) return fail('Пароли не совпадают');

  const exists = db.prepare('SELECT id FROM hr_users WHERE username = ?').get(name);
  if (exists) return fail('Пользователь с таким логином уже существует');

  db.prepare('INSERT INTO hr_users (username, password_hash) VALUES (?, ?)')
    .run(name, hashPassword(password));

  const token = crypto.randomBytes(32).toString('hex');
  hrSessions.set(token, { expires: Date.now() + SESSION_TTL });
  res.cookie('hr_session', token, { httpOnly: true, sameSite: 'strict', maxAge: SESSION_TTL });
  res.redirect('/hr');
});

// Выход
app.get('/hr/logout', (req, res) => {
  const token = req.cookies?.hr_session;
  if (token) hrSessions.delete(token);
  res.clearCookie('hr_session');
  res.redirect('/hr/login');
});

// ─── Вопросы ────────────────────────────────────────────────────────────────

app.get('/api/questions', (req, res) => {
  const soft = db.prepare("SELECT text, time_limit FROM questions WHERE block='soft' ORDER BY order_index").all();
  const hard = db.prepare("SELECT text, time_limit FROM questions WHERE block='hard' ORDER BY order_index").all();
  res.json({
    soft: { timeLimit: soft[0]?.time_limit ?? 60, questions: soft.map(q => q.text) },
    hard: { timeLimit: hard[0]?.time_limit ?? 60, questions: hard.map(q => q.text) },
  });
});

app.put('/api/questions', requireAuth, (req, res) => {
  const { soft, hard } = req.body;
  if (!soft?.questions?.length || !hard?.questions?.length) {
    return res.status(400).json({ error: 'Both blocks required' });
  }
  const del = db.prepare('DELETE FROM questions');
  const ins = db.prepare('INSERT INTO questions (block, order_index, text, time_limit) VALUES (?, ?, ?, ?)');
  db.transaction(() => {
    del.run();
    soft.questions.forEach((t, i) => ins.run('soft', i, t.trim(), Math.max(10, parseInt(soft.timeLimit) || 60)));
    hard.questions.forEach((t, i) => ins.run('hard', i, t.trim(), Math.max(10, parseInt(hard.timeLimit) || 60)));
  })();
  res.json({ ok: true });
});

// ─── Сессии ──────────────────────────────────────────────────────────────────

app.post('/api/sessions', (req, res) => {
  const { candidateName } = req.body;
  if (!candidateName?.trim()) return res.status(400).json({ error: 'candidateName is required' });
  const id = uuidv4();
  db.prepare('INSERT INTO sessions (id, candidate_name) VALUES (?, ?)').run(id, candidateName.trim());
  res.json({ sessionId: id });
});

app.post('/api/sessions/:id/complete', (req, res) => {
  db.prepare('UPDATE sessions SET completed_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/sessions', requireAuth, (req, res) => {
  const sessions = db.prepare('SELECT id, candidate_name, created_at, completed_at FROM sessions ORDER BY created_at DESC').all();
  res.json(sessions);
});

// ─── Попытки вставки ─────────────────────────────────────────────────────────

app.post('/api/paste-attempts', (req, res) => {
  const { sessionId, block, questionIndex } = req.body;
  if (!sessionId || !block || questionIndex === undefined) {
    return res.status(400).json({ error: 'sessionId, block, questionIndex are required' });
  }
  db.prepare('INSERT INTO paste_attempts (session_id, block, question_index) VALUES (?, ?, ?)')
    .run(sessionId, block, questionIndex);
  res.json({ ok: true });
});

// ─── Ответы ───────────────────────────────────────────────────────────────────

app.post('/api/answers', (req, res) => {
  const { sessionId, block, questionIndex, questionText, answerText, timeSpent, autoSubmitted } = req.body;
  if (!sessionId || !block || questionIndex === undefined) {
    return res.status(400).json({ error: 'sessionId, block, questionIndex are required' });
  }
  db.prepare(`
    INSERT INTO answers (session_id, block, question_index, question_text, answer_text, time_spent, auto_submitted)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, block, questionIndex, questionText, answerText || null, timeSpent || 0, autoSubmitted ? 1 : 0);
  res.json({ ok: true });
});

app.delete('/api/sessions/:id', requireAuth, (req, res) => {
  const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  db.transaction(() => {
    db.prepare('DELETE FROM paste_attempts WHERE session_id = ?').run(req.params.id);
    db.prepare('DELETE FROM answers WHERE session_id = ?').run(req.params.id);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);
  })();
  res.json({ ok: true });
});

app.get('/api/sessions/:id/results', requireAuth, (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const answers = db.prepare('SELECT * FROM answers WHERE session_id = ? ORDER BY block, question_index').all(req.params.id);
  res.json({ session, answers });
});

// ─── HR: результаты кандидата ─────────────────────────────────────────────────

app.get('/results/:id', requireAuth, (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).send('<h1>Сессия не найдена</h1>');
  const answers = db.prepare('SELECT * FROM answers WHERE session_id = ? ORDER BY block, question_index').all(req.params.id);
  const pastes  = db.prepare('SELECT block, question_index FROM paste_attempts WHERE session_id = ?').all(req.params.id);

  const softAnswers = answers.filter(a => a.block === 'soft');
  const hardAnswers = answers.filter(a => a.block === 'hard');
  const softTL = db.prepare("SELECT time_limit FROM questions WHERE block='soft' LIMIT 1").get()?.time_limit ?? 60;
  const hardTL = db.prepare("SELECT time_limit FROM questions WHERE block='hard' LIMIT 1").get()?.time_limit ?? 60;

  const pasteCount = (block, qi) => pastes.filter(p => p.block === block && p.question_index === qi).length;

  const formatTime = (sec) => {
    if (!sec && sec !== 0) return '—';
    if (sec >= 60) { const m = Math.floor(sec / 60), s = sec % 60; return s ? m + ' мин ' + s + ' с' : m + ' мин'; }
    return sec + ' с';
  };

  const renderAnswers = (items, block, timeLimit) => items.map((a, i) => {
    const pc = pasteCount(block, a.question_index);
    return `
    <div class="answer-card ${a.auto_submitted ? 'card-auto' : 'card-manual'}">
      <div class="card-header">
        <span class="num">Вопрос ${i + 1}</span>
        <div class="badges">
          <span class="badge-time">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            ${formatTime(a.time_spent)} из ${formatTime(timeLimit)}
          </span>
          ${a.auto_submitted ? '<span class="badge badge-auto">⏱ Время вышло</span>' : '<span class="badge badge-manual">✓ Сам перешёл</span>'}
          ${pc > 0 ? '<span class="badge badge-paste">⚠ Попыток вставить: ' + pc + '</span>' : ''}
        </div>
      </div>
      <p class="q-label">Вопрос</p>
      <p class="q-text">${esc(a.question_text)}</p>
      <p class="q-label">Ответ кандидата</p>
      <div class="answer-text ${a.answer_text ? '' : 'answer-empty'}">${a.answer_text ? esc(a.answer_text) : 'Ответ не был записан'}</div>
    </div>`;
  }).join('');

  const sAuto  = softAnswers.filter(a => a.auto_submitted).length;
  const hAuto  = hardAnswers.filter(a => a.auto_submitted).length;
  const sEmpty = softAnswers.filter(a => !a.answer_text).length;
  const hEmpty = hardAnswers.filter(a => !a.answer_text).length;
  const sPaste = pastes.filter(p => p.block === 'soft').length;
  const hPaste = pastes.filter(p => p.block === 'hard').length;

  res.send(`<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Результаты — ${esc(session.candidate_name)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#f1f5f9;color:#1e293b;padding:2rem 1.5rem}
  .page{max-width:900px;margin:0 auto}
  .top-nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem}
  .back{display:inline-flex;align-items:center;gap:6px;color:#2563eb;text-decoration:none;font-size:.875rem;font-weight:500}
  .export-btn{display:inline-flex;align-items:center;gap:6px;padding:.5rem 1rem;background:#0f172a;color:white;border-radius:8px;text-decoration:none;font-size:.8rem;font-weight:600}
  .export-btn:hover{background:#1e293b}
  .page-header{background:white;border-radius:14px;padding:1.5rem 2rem;margin-bottom:1.25rem;box-shadow:0 1px 4px rgba(0,0,0,.07)}
  .candidate-name{font-size:1.4rem;font-weight:700;margin-bottom:.3rem}
  .session-meta{font-size:.85rem;color:#64748b}
  .session-meta span{margin-right:1.5rem}
  .summary{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem}
  .summary-card{background:white;border-radius:12px;padding:1.25rem 1.5rem;box-shadow:0 1px 4px rgba(0,0,0,.07)}
  .s-title{font-size:.7rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:.75rem}
  .s-title.soft{color:#7c3aed}.s-title.hard{color:#0369a1}
  .stats{display:flex;gap:1.25rem;flex-wrap:wrap}
  .stat{font-size:.8rem;color:#475569}
  .stat strong{display:block;font-size:1.25rem;font-weight:700;color:#1e293b;line-height:1.2}
  .stat.warn strong{color:#dc2626}
  section{margin-bottom:2rem}
  .block-title{font-size:1rem;font-weight:700;margin-bottom:1rem;padding:.5rem 0;border-bottom:2px solid #e2e8f0;display:flex;align-items:center;gap:.5rem}
  .dot{width:10px;height:10px;border-radius:50%;display:inline-block}
  .dot-soft{background:#7c3aed}.dot-hard{background:#0369a1}
  .answer-card{background:white;border-radius:12px;padding:1.25rem 1.5rem;margin-bottom:.75rem;box-shadow:0 1px 3px rgba(0,0,0,.06);border-left:4px solid transparent}
  .card-auto{border-left-color:#f59e0b}.card-manual{border-left-color:#10b981}
  .card-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;flex-wrap:wrap;gap:.5rem}
  .num{font-weight:700;font-size:.9rem;color:#374151}
  .badges{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
  .badge-time{font-size:.8rem;color:#64748b;display:flex;align-items:center;gap:4px}
  .badge{font-size:.75rem;font-weight:600;padding:3px 10px;border-radius:20px}
  .badge-auto{background:#fef3c7;color:#92400e}
  .badge-manual{background:#d1fae5;color:#065f46}
  .badge-paste{background:#fee2e2;color:#991b1b}
  .q-label{font-size:.7rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#94a3b8;margin-bottom:.3rem}
  .q-text{font-size:.95rem;color:#374151;line-height:1.55;margin-bottom:1rem}
  .answer-text{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:.875rem 1rem;font-size:.95rem;line-height:1.7;color:#1e293b;white-space:pre-wrap;min-height:3rem}
  .answer-empty{color:#94a3b8;font-style:italic}
</style></head>
<body><div class="page">
  <div class="top-nav">
    <a href="/hr" class="back">← Все кандидаты</a>
    <a href="/results/${session.id}/export.json" class="export-btn" download>↓ Экспорт для AI (JSON)</a>
  </div>
  <div class="page-header">
    <div class="candidate-name">${esc(session.candidate_name)}</div>
    <div class="session-meta">
      <span>Начало: ${new Date(session.created_at).toLocaleString('ru-RU')}</span>
      <span>${session.completed_at ? 'Завершено: ' + new Date(session.completed_at).toLocaleString('ru-RU') : 'Не завершено'}</span>
    </div>
  </div>
  <div class="summary">
    <div class="summary-card">
      <div class="s-title soft">Soft Skills</div>
      <div class="stats">
        <div class="stat"><strong>${softAnswers.length}</strong>вопросов</div>
        <div class="stat"><strong>${softAnswers.length - sAuto}</strong>сам перешёл</div>
        <div class="stat"><strong>${sAuto}</strong>время вышло</div>
        <div class="stat"><strong>${sEmpty}</strong>без ответа</div>
        <div class="stat ${sPaste > 0 ? 'warn' : ''}"><strong>${sPaste}</strong>попыток вставить</div>
      </div>
    </div>
    <div class="summary-card">
      <div class="s-title hard">Hard Skills</div>
      <div class="stats">
        <div class="stat"><strong>${hardAnswers.length}</strong>вопросов</div>
        <div class="stat"><strong>${hardAnswers.length - hAuto}</strong>сам перешёл</div>
        <div class="stat"><strong>${hAuto}</strong>время вышло</div>
        <div class="stat"><strong>${hEmpty}</strong>без ответа</div>
        <div class="stat ${hPaste > 0 ? 'warn' : ''}"><strong>${hPaste}</strong>попыток вставить</div>
      </div>
    </div>
  </div>
  <section>
    <div class="block-title"><span class="dot dot-soft"></span>Soft Skills · ${formatTime(softTL)} на вопрос</div>
    ${renderAnswers(softAnswers, 'soft', softTL)}
  </section>
  <section>
    <div class="block-title"><span class="dot dot-hard"></span>Hard Skills · ${formatTime(hardTL)} на вопрос</div>
    ${renderAnswers(hardAnswers, 'hard', hardTL)}
  </section>
</div></body></html>`);
});

// ─── Экспорт для AI ──────────────────────────────────────────────────────────

app.get('/results/:id/export.json', requireAuth, (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const answers = db.prepare('SELECT * FROM answers WHERE session_id = ? ORDER BY block, question_index').all(req.params.id);
  const pastes  = db.prepare('SELECT block, question_index, created_at FROM paste_attempts WHERE session_id = ? ORDER BY created_at').all(req.params.id);

  const softTL = db.prepare("SELECT time_limit FROM questions WHERE block='soft' LIMIT 1").get()?.time_limit ?? 60;
  const hardTL = db.prepare("SELECT time_limit FROM questions WHERE block='hard' LIMIT 1").get()?.time_limit ?? 60;

  const softAnswers = answers.filter(a => a.block === 'soft');
  const hardAnswers = answers.filter(a => a.block === 'hard');

  const mapBlock = (items, block, timeLimit) => items.map(a => {
    const qPastes = pastes.filter(p => p.block === block && p.question_index === a.question_index);
    return {
      question_number: a.question_index + 1,
      question: a.question_text,
      answer: a.answer_text || null,
      has_answer: !!a.answer_text,
      time_spent_seconds: a.time_spent,
      time_limit_seconds: timeLimit,
      time_used_percent: timeLimit > 0 ? Math.round((a.time_spent / timeLimit) * 100) : 0,
      transition: a.auto_submitted ? 'auto_timeout' : 'manual',
      paste_attempts: qPastes.length,
      paste_attempt_timestamps: qPastes.map(p => p.created_at),
    };
  });

  const calcStats = (items, block) => ({
    total_questions: items.length,
    answered: items.filter(a => a.answer_text).length,
    unanswered: items.filter(a => !a.answer_text).length,
    auto_advanced: items.filter(a => a.auto_submitted).length,
    manually_advanced: items.filter(a => !a.auto_submitted).length,
    paste_attempts_total: pastes.filter(p => p.block === block).length,
    avg_time_used_percent: items.length
      ? Math.round(items.reduce((s, a) => s + (a.time_spent / (block === 'soft' ? softTL : hardTL)), 0) / items.length * 100)
      : 0,
  });

  const durationMin = session.completed_at
    ? Math.round((new Date(session.completed_at) - new Date(session.created_at)) / 60000)
    : null;

  const payload = {
    _meta: {
      format: 'hr-assessment-v1',
      position: 'Middle PHP Developer',
      exported_at: new Date().toISOString(),
      session_id: session.id,
    },
    candidate: {
      name: session.candidate_name,
      started_at: session.created_at,
      completed_at: session.completed_at || null,
      completed: !!session.completed_at,
      duration_minutes: durationMin,
    },
    summary: {
      soft_skills: calcStats(softAnswers, 'soft'),
      hard_skills: calcStats(hardAnswers, 'hard'),
      total_paste_attempts: pastes.length,
      integrity_flag: pastes.length > 0,
    },
    soft_skills: mapBlock(softAnswers, 'soft', softTL),
    hard_skills: mapBlock(hardAnswers, 'hard', hardTL),
  };

  const filename = `assessment_${session.candidate_name.replace(/\s+/g, '_')}_${session.id.slice(0, 8)}.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(payload, null, 2));
});

// ─── HR: дашборд ──────────────────────────────────────────────────────────────

app.get('/hr', requireAuth, (req, res) => {
  const sessions = db.prepare('SELECT id, candidate_name, created_at, completed_at FROM sessions ORDER BY created_at DESC').all();

  const rows = sessions.length === 0
    ? '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:2rem">Нет пройденных тестов</td></tr>'
    : sessions.map(s => {
        const done = !!s.completed_at;
        const dur = done
          ? Math.round((new Date(s.completed_at) - new Date(s.created_at)) / 60000) + ' мин'
          : '—';
        return '<tr id="row-' + s.id + '">' +
          '<td><strong>' + esc(s.candidate_name) + '</strong></td>' +
          '<td>' + new Date(s.created_at).toLocaleString('ru-RU') + '</td>' +
          '<td>' + (done ? '<span class="status-done">Завершено</span>' : '<span class="status-prog">В процессе</span>') + '</td>' +
          '<td>' + dur + '</td>' +
          '<td><a href="/results/' + s.id + '" target="_blank" class="res-link">Результаты →</a></td>' +
          '<td><button class="del-btn" onclick="deleteSession(\'' + s.id + '\', \'' + esc(s.candidate_name) + '\')">Удалить</button></td>' +
          '</tr>';
      }).join('');

  res.send(`<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>HR Dashboard</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#f1f5f9;color:#1e293b}
  .sidebar{position:fixed;top:0;left:0;width:220px;height:100vh;background:#0f172a;padding:1.5rem 1rem;display:flex;flex-direction:column;gap:.25rem}
  .sidebar-logo{color:white;font-weight:700;font-size:1rem;padding:.75rem .75rem 1.25rem}
  .sidebar-logo span{display:block;font-size:.7rem;font-weight:400;color:#94a3b8;margin-top:2px}
  .nav-btn{display:flex;align-items:center;gap:.625rem;padding:.625rem .75rem;border-radius:8px;border:none;background:transparent;color:#94a3b8;font-size:.875rem;font-weight:500;cursor:pointer;width:100%;text-align:left;transition:background .15s,color .15s}
  .nav-btn:hover{background:#1e293b;color:white}
  .nav-btn.active{background:#1e3a5f;color:#60a5fa}
  .nav-icon{font-size:1rem;width:18px;text-align:center}
  .nav-logout{display:flex;align-items:center;gap:.625rem;padding:.625rem .75rem;border-radius:8px;border:none;background:transparent;color:#64748b;font-size:.8rem;cursor:pointer;width:100%;text-align:left;margin-top:auto;text-decoration:none}
  .nav-logout:hover{background:#1e293b;color:#f87171}
  .main{margin-left:220px;padding:2rem}
  .tab-content{display:none}.tab-content.active{display:block}
  h1{font-size:1.35rem;font-weight:700;margin-bottom:1.5rem}

  /* Кандидаты */
  .table-wrap{background:white;border-radius:14px;box-shadow:0 1px 4px rgba(0,0,0,.07);overflow:hidden}
  .table-header{display:flex;align-items:center;justify-content:space-between;padding:1rem 1.5rem;border-bottom:1px solid #f1f5f9}
  .table-header h2{font-size:1rem;font-weight:600}
  .refresh-btn{font-size:.8rem;color:#2563eb;background:none;border:none;cursor:pointer;font-weight:500}
  table{width:100%;border-collapse:collapse}
  th{text-align:left;font-size:.75rem;font-weight:600;color:#64748b;letter-spacing:.04em;text-transform:uppercase;padding:.75rem 1.5rem;border-bottom:1px solid #f1f5f9}
  td{padding:.875rem 1.5rem;font-size:.875rem;border-bottom:1px solid #f8fafc;vertical-align:middle}
  tr:last-child td{border-bottom:none}
  tr:hover td{background:#fafafa}
  .status-done{background:#d1fae5;color:#065f46;font-size:.75rem;font-weight:600;padding:3px 10px;border-radius:20px}
  .status-prog{background:#fef3c7;color:#92400e;font-size:.75rem;font-weight:600;padding:3px 10px;border-radius:20px}
  .res-link{color:#2563eb;text-decoration:none;font-weight:500;font-size:.875rem}
  .res-link:hover{text-decoration:underline}
  .del-btn{background:none;border:1px solid #fecaca;color:#ef4444;font-size:.78rem;font-weight:600;padding:4px 10px;border-radius:6px;cursor:pointer;transition:background .15s,color .15s}
  .del-btn:hover{background:#fee2e2}
  .del-btn:disabled{opacity:.4;cursor:default}

  /* Редактор вопросов */
  .editor-grid{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem}
  .q-block{background:white;border-radius:14px;box-shadow:0 1px 4px rgba(0,0,0,.07);overflow:hidden}
  .q-block-header{padding:1rem 1.5rem;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between;gap:1rem}
  .q-block-title{font-size:.875rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
  .title-soft{color:#7c3aed}.title-hard{color:#0369a1}
  .time-control{display:flex;align-items:center;gap:.5rem;font-size:.8rem;color:#64748b;white-space:nowrap}
  .time-control input{width:60px;padding:3px 6px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:.85rem;text-align:center}
  .q-list{padding:1rem 1.5rem;display:flex;flex-direction:column;gap:.625rem;max-height:520px;overflow-y:auto}
  .q-row{display:flex;align-items:flex-start;gap:.5rem}
  .q-num{font-size:.75rem;font-weight:700;color:#94a3b8;min-width:20px;padding-top:.55rem;text-align:right}
  .q-textarea{flex:1;padding:.625rem .75rem;font-size:.875rem;line-height:1.5;border:1.5px solid #e2e8f0;border-radius:8px;resize:vertical;font-family:inherit;min-height:64px;transition:border-color .15s}
  .q-textarea:focus{outline:none;border-color:#2563eb}
  .btn-remove{background:none;border:none;color:#cbd5e1;cursor:pointer;font-size:1.1rem;padding:.25rem;line-height:1;margin-top:.35rem;border-radius:4px;transition:color .15s}
  .btn-remove:hover{color:#ef4444}
  .q-block-footer{padding:.75rem 1.5rem;border-top:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between}
  .btn-add{background:none;border:none;color:#2563eb;font-size:.8rem;font-weight:600;cursor:pointer;padding:0}
  .btn-add:hover{text-decoration:underline}
  .q-count{font-size:.75rem;color:#94a3b8}
  .save-bar{margin-top:1.5rem;display:flex;align-items:center;gap:1rem}
  .save-btn{padding:.75rem 2rem;background:#2563eb;color:white;border:none;border-radius:8px;font-size:.9rem;font-weight:600;cursor:pointer;transition:opacity .2s}
  .save-btn:disabled{opacity:.6;cursor:default}
  .save-msg{font-size:.875rem;color:#10b981;font-weight:500;display:none}
  .save-err{font-size:.875rem;color:#ef4444;font-weight:500;display:none}
</style>
</head>
<body>

<nav class="sidebar">
  <div class="sidebar-logo">HR Dashboard<span>Middle PHP Developer</span></div>
  <button class="nav-btn active" data-tab="candidates" onclick="switchTab('candidates', this)">
    <span class="nav-icon">👥</span> Кандидаты
  </button>
  <button class="nav-btn" data-tab="questions" onclick="switchTab('questions', this)">
    <span class="nav-icon">📝</span> Вопросы теста
  </button>
  <a href="/hr/logout" class="nav-logout"><span class="nav-icon">↩</span> Выйти</a>
</nav>

<div class="main">

  <!-- Кандидаты -->
  <div id="tab-candidates" class="tab-content active">
    <h1>Кандидаты</h1>
    <div class="table-wrap">
      <div class="table-header">
        <h2>Все тесты</h2>
        <button class="refresh-btn" onclick="location.reload()">↻ Обновить</button>
      </div>
      <table>
        <thead><tr>
          <th>Кандидат</th><th>Дата начала</th><th>Статус</th><th>Длительность</th><th>Результаты</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>

  <!-- Редактор вопросов -->
  <div id="tab-questions" class="tab-content">
    <h1>Вопросы теста</h1>
    <div id="editor-loading" style="color:#64748b;font-size:.9rem">Загрузка вопросов...</div>
    <div id="editor-wrap" style="display:none">
      <div class="editor-grid">

        <div class="q-block">
          <div class="q-block-header">
            <span class="q-block-title title-soft">Soft Skills</span>
            <div class="time-control">
              Время: <input type="number" id="time-soft" min="10" max="600" value="60"> с
            </div>
          </div>
          <div class="q-list" id="qs-soft"></div>
          <div class="q-block-footer">
            <button class="btn-add" onclick="addQuestion('soft')">+ Добавить вопрос</button>
            <span class="q-count" id="cnt-soft"></span>
          </div>
        </div>

        <div class="q-block">
          <div class="q-block-header">
            <span class="q-block-title title-hard">Hard Skills</span>
            <div class="time-control">
              Время: <input type="number" id="time-hard" min="10" max="600" value="60"> с
            </div>
          </div>
          <div class="q-list" id="qs-hard"></div>
          <div class="q-block-footer">
            <button class="btn-add" onclick="addQuestion('hard')">+ Добавить вопрос</button>
            <span class="q-count" id="cnt-hard"></span>
          </div>
        </div>

      </div>
      <div class="save-bar">
        <button class="save-btn" id="save-btn" onclick="saveQuestions()">Сохранить изменения</button>
        <span class="save-msg" id="save-msg">Сохранено</span>
        <span class="save-err" id="save-err">Ошибка при сохранении</span>
      </div>
    </div>
  </div>

</div>

<script>
var questionsData = null;

async function deleteSession(id, name) {
  if (!confirm('Удалить тест кандидата «' + name + '»?\nЭто действие нельзя отменить.')) return;
  var btn = document.querySelector('#row-' + id + ' .del-btn');
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  try {
    var res = await fetch('/api/sessions/' + id, { method: 'DELETE' });
    if (!res.ok) throw new Error();
    var row = document.getElementById('row-' + id);
    if (row) row.remove();
    var tbody = document.querySelector('tbody');
    if (tbody && !tbody.querySelector('tr')) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:2rem">Нет пройденных тестов</td></tr>';
    }
  } catch(e) {
    alert('Ошибка при удалении');
    if (btn) { btn.disabled = false; btn.textContent = 'Удалить'; }
  }
}

function switchTab(tab, btn) {
  document.querySelectorAll('.tab-content').forEach(function(el) { el.classList.remove('active'); });
  document.querySelectorAll('.nav-btn').forEach(function(el) { el.classList.remove('active'); });
  document.getElementById('tab-' + tab).classList.add('active');
  btn.classList.add('active');
  if (tab === 'questions' && !questionsData) loadQuestions();
}

async function loadQuestions() {
  try {
    var res = await fetch('/api/questions');
    questionsData = await res.json();
    document.getElementById('editor-loading').style.display = 'none';
    document.getElementById('editor-wrap').style.display = 'block';
    document.getElementById('time-soft').value = questionsData.soft.timeLimit;
    document.getElementById('time-hard').value = questionsData.hard.timeLimit;
    renderList('soft');
    renderList('hard');
  } catch(e) {
    document.getElementById('editor-loading').textContent = 'Ошибка загрузки вопросов';
  }
}

function renderList(block) {
  var qs = questionsData[block].questions;
  var container = document.getElementById('qs-' + block);
  container.innerHTML = '';
  qs.forEach(function(q, i) {
    var row = document.createElement('div');
    row.className = 'q-row';
    row.setAttribute('data-block', block);
    row.setAttribute('data-index', i);

    var num = document.createElement('span');
    num.className = 'q-num';
    num.textContent = i + 1;

    var ta = document.createElement('textarea');
    ta.className = 'q-textarea';
    ta.value = q;
    ta.setAttribute('data-block', block);
    ta.setAttribute('data-index', i);
    ta.rows = 3;
    ta.addEventListener('input', function() {
      questionsData[block].questions[i] = ta.value;
    });

    var btn = document.createElement('button');
    btn.className = 'btn-remove';
    btn.title = 'Удалить';
    btn.innerHTML = '&times;';
    btn.addEventListener('click', function() { removeQuestion(block, i); });

    row.appendChild(num);
    row.appendChild(ta);
    row.appendChild(btn);
    container.appendChild(row);
  });
  document.getElementById('cnt-' + block).textContent = qs.length + ' вопр.';
}

function addQuestion(block) {
  questionsData[block].questions.push('');
  renderList(block);
  var textareas = document.querySelectorAll('#qs-' + block + ' .q-textarea');
  if (textareas.length) textareas[textareas.length - 1].focus();
}

function removeQuestion(block, index) {
  if (questionsData[block].questions.length <= 1) {
    alert('Должен быть хотя бы один вопрос');
    return;
  }
  if (!confirm('Удалить вопрос ' + (index + 1) + '?')) return;
  questionsData[block].questions.splice(index, 1);
  renderList(block);
}

async function saveQuestions() {
  var softQs = questionsData.soft.questions.map(function(q) { return q.trim(); }).filter(Boolean);
  var hardQs = questionsData.hard.questions.map(function(q) { return q.trim(); }).filter(Boolean);

  if (!softQs.length || !hardQs.length) {
    alert('Нельзя сохранить пустой блок вопросов');
    return;
  }

  var payload = {
    soft: { timeLimit: parseInt(document.getElementById('time-soft').value) || 60, questions: softQs },
    hard: { timeLimit: parseInt(document.getElementById('time-hard').value) || 60, questions: hardQs }
  };

  var btn = document.getElementById('save-btn');
  var msg = document.getElementById('save-msg');
  var err = document.getElementById('save-err');
  btn.disabled = true;
  btn.textContent = 'Сохранение...';
  msg.style.display = 'none';
  err.style.display = 'none';

  try {
    var res = await fetch('/api/questions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error();
    questionsData = payload;
    renderList('soft');
    renderList('hard');
    msg.style.display = 'inline';
    setTimeout(function() { msg.style.display = 'none'; }, 3000);
  } catch(e) {
    err.style.display = 'inline';
    setTimeout(function() { err.style.display = 'none'; }, 3000);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Сохранить изменения';
  }
}
</script>
</body></html>`);
});

const PORT = 3001;
app.listen(PORT, () => console.log('Backend running on http://localhost:' + PORT));
