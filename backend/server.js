require('express-async-errors');
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const Anthropic = require('@anthropic-ai/sdk');
const multer = require('multer');
const { pool, init } = require('./db');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const app = express();

const CORS_ORIGIN = process.env.CORS_ORIGIN;
app.use(cors(CORS_ORIGIN ? { origin: CORS_ORIGIN, credentials: true } : {}));
app.use(morgan('short'));
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'public')));
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Слишком много попыток, попробуйте через 15 минут' },
  standardHeaders: true,
  legacyHeaders: false,
});

const esc = (str) => String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const toISO = (d) => d ? new Date(d).toISOString() : '';
const fmtDate = (d) => d ? new Date(d).toISOString().slice(0, 19).replace('T', ' ') : '—';

// ─── Авторизация HR ───────────────────────────────────────────────────────────

const SESSION_TTL = 24 * 60 * 60 * 1000;

const dbSession = {
  get: async (token) => {
    const { rows } = await pool.query(
      'SELECT expires_at, username FROM hr_sessions WHERE token = $1', [token]
    );
    return rows[0] || null;
  },
  set: async (token, expiresAt, username) => {
    await pool.query(
      `INSERT INTO hr_sessions (token, expires_at, username) VALUES ($1, $2, $3)
       ON CONFLICT (token) DO UPDATE SET expires_at = EXCLUDED.expires_at, username = EXCLUDED.username`,
      [token, expiresAt, username || null]
    );
  },
  touch: async (token, expiresAt) => {
    await pool.query('UPDATE hr_sessions SET expires_at = $1 WHERE token = $2', [expiresAt, token]);
  },
  del: async (token) => {
    await pool.query('DELETE FROM hr_sessions WHERE token = $1', [token]);
  },
};

setInterval(async () => {
  await pool.query('DELETE FROM hr_sessions WHERE expires_at < $1', [Date.now()]).catch(() => {});
}, 60 * 60 * 1000);

const hashPassword = (password) => new Promise((resolve, reject) => {
  const salt = crypto.randomBytes(16).toString('hex');
  crypto.pbkdf2(password, salt, 100_000, 64, 'sha512', (err, key) => {
    if (err) reject(err);
    else resolve(`${salt}:${key.toString('hex')}`);
  });
});

const verifyPassword = (password, stored) => new Promise((resolve) => {
  const [salt, hash] = stored.split(':');
  const expected = Buffer.from(hash, 'hex');
  crypto.pbkdf2(password, salt, 100_000, 64, 'sha512', (err, key) => {
    if (err || key.length !== expected.length) return resolve(false);
    resolve(crypto.timingSafeEqual(key, expected));
  });
});

const requireAuth = async (req, res, next) => {
  try {
    const token = req.cookies?.hr_session;
    if (token) {
      const s = await dbSession.get(token);
      if (s && Date.now() < Number(s.expires_at)) {
        await dbSession.touch(token, Date.now() + SESSION_TTL);
        req.hrUser = s.username ? { username: s.username } : null;
        return next();
      }
      if (s) await dbSession.del(token);
    }
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    res.redirect('/hr/login');
  } catch (err) {
    next(err);
  }
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
app.get('/hr/login', async (req, res) => {
  const token = req.cookies?.hr_session;
  const s = token ? await dbSession.get(token) : null;
  if (s && Date.now() < Number(s.expires_at)) return res.redirect('/hr');
  const { rows } = await pool.query('SELECT COUNT(*) AS cnt FROM hr_users');
  const noUsers = parseInt(rows[0].cnt) === 0;
  res.send(authPageShell('Вход', `
    <div class="logo">HR Dashboard</div>
    <h1>Вход</h1>
    <p class="sub">Middle PHP Developer · Оценка кандидатов</p>
    ${noUsers ? '<div class="alert-info">Пользователей ещё нет — <a href="/hr/register">создайте первый аккаунт</a>.</div>' : ''}
    <form method="POST" action="/hr/login">
      <label>Логин</label>
      <input type="text" name="username" autocomplete="username" autofocus required/>
      <label>Пароль</label>
      <input type="password" name="password" autocomplete="current-password" required/>
      <button class="btn" type="submit">Войти →</button>
    </form>
  `));
});

app.post('/hr/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  const { rows } = await pool.query('SELECT password_hash FROM hr_users WHERE username = $1', [username?.trim()]);
  const user = rows[0];
  if (user && await verifyPassword(password, user.password_hash)) {
    const token = crypto.randomBytes(32).toString('hex');
    await dbSession.set(token, Date.now() + SESSION_TTL, username?.trim());
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

const isLoggedIn = async (req) => {
  const token = req.cookies?.hr_session;
  if (!token) return false;
  const s = await dbSession.get(token);
  return !!(s && Date.now() < Number(s.expires_at));
};

const canRegister = async (req) => {
  if (await isLoggedIn(req)) return true;
  const { rows } = await pool.query('SELECT COUNT(*) AS cnt FROM hr_users');
  return parseInt(rows[0].cnt) === 0;
};

app.get('/hr/register', async (req, res) => {
  if (!await canRegister(req)) return res.redirect('/hr/login');
  const loggedIn = await isLoggedIn(req);
  res.send(authPageShell('Регистрация', `
    <div class="logo">HR Dashboard</div>
    <h1>${loggedIn ? 'Добавить пользователя' : 'Регистрация'}</h1>
    <p class="sub">Создайте аккаунт для доступа к результатам тестирования</p>
    <form method="POST" action="/hr/register">
      <label>Логин</label>
      <input type="text" name="username" autocomplete="username" autofocus required minlength="3" maxlength="50"/>
      <label>Пароль</label>
      <input type="password" name="password" autocomplete="new-password" required minlength="6"/>
      <p class="hint">Минимум 6 символов</p>
      <label>Повторите пароль</label>
      <input type="password" name="password2" autocomplete="new-password" required minlength="6"/>
      <button class="btn" type="submit">${loggedIn ? 'Создать' : 'Создать аккаунт'} →</button>
    </form>
    <div class="link-row">${loggedIn ? '<a href="/hr">← Назад</a>' : 'Уже есть аккаунт? <a href="/hr/login">Войти</a>'}</div>
  `));
});

app.post('/hr/register', async (req, res) => {
  if (!await canRegister(req)) return res.status(403).redirect('/hr/login');

  const { username, password, password2 } = req.body;
  const name = username?.trim();
  const loggedIn = await isLoggedIn(req);

  const fail = (msg) => res.status(400).send(authPageShell('Регистрация', `
    <div class="logo">HR Dashboard</div>
    <h1>${loggedIn ? 'Добавить пользователя' : 'Регистрация'}</h1>
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
      <button class="btn" type="submit">${loggedIn ? 'Создать' : 'Создать аккаунт'} →</button>
    </form>
    <div class="link-row">${loggedIn ? '<a href="/hr">← Назад</a>' : 'Уже есть аккаунт? <a href="/hr/login">Войти</a>'}</div>
  `));

  if (!name || name.length < 3) return fail('Логин должен содержать минимум 3 символа');
  if (!password || password.length < 6) return fail('Пароль должен содержать минимум 6 символов');
  if (password !== password2) return fail('Пароли не совпадают');

  const { rows } = await pool.query('SELECT id FROM hr_users WHERE username = $1', [name]);
  if (rows[0]) return fail('Пользователь с таким логином уже существует');

  await pool.query('INSERT INTO hr_users (username, password_hash) VALUES ($1, $2)', [name, await hashPassword(password)]);

  if (loggedIn) return res.redirect('/hr/account');

  const token = crypto.randomBytes(32).toString('hex');
  await dbSession.set(token, Date.now() + SESSION_TTL, name);
  res.cookie('hr_session', token, { httpOnly: true, sameSite: 'strict', maxAge: SESSION_TTL });
  res.redirect('/hr');
});

app.get('/hr/logout', async (req, res) => {
  const token = req.cookies?.hr_session;
  if (token) await dbSession.del(token);
  res.clearCookie('hr_session');
  res.redirect('/hr/login');
});

// ─── Аккаунт HR ─────────────────────────────────────────────────────────────

const accountShell = (username, content, flash) => `<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>HR · Аккаунт</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#f1f5f9;color:#1e293b}
  .sidebar{position:fixed;top:0;left:0;width:220px;height:100vh;background:#0f172a;padding:1.5rem 1rem;display:flex;flex-direction:column;gap:.25rem}
  .sidebar-logo{color:white;font-weight:700;font-size:1rem;padding:.75rem .75rem 1.25rem}
  .sidebar-logo span{display:block;font-size:.7rem;font-weight:400;color:#94a3b8;margin-top:2px}
  .nav-btn{display:flex;align-items:center;gap:.625rem;padding:.625rem .75rem;border-radius:8px;border:none;background:transparent;color:#94a3b8;font-size:.875rem;font-weight:500;cursor:pointer;width:100%;text-align:left;transition:background .15s,color .15s;text-decoration:none}
  .nav-btn:hover{background:#1e293b;color:white}
  .nav-btn.active{background:#1e3a5f;color:#60a5fa}
  .nav-icon{font-size:1rem;width:18px;text-align:center}
  .nav-logout{display:flex;align-items:center;gap:.625rem;padding:.625rem .75rem;border-radius:8px;border:none;background:transparent;color:#64748b;font-size:.8rem;cursor:pointer;width:100%;text-align:left;margin-top:auto;text-decoration:none}
  .nav-logout:hover{background:#1e293b;color:#f87171}
  .main{margin-left:220px;padding:2rem;max-width:860px}
  h1{font-size:1.35rem;font-weight:700;margin-bottom:1.5rem}
  .section{background:white;border-radius:14px;box-shadow:0 1px 4px rgba(0,0,0,.07);padding:1.5rem 2rem;margin-bottom:1.25rem}
  .section h2{font-size:.9rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin-bottom:1.25rem}
  label{display:block;font-size:.8rem;font-weight:600;color:#374151;margin-bottom:.3rem;margin-top:.75rem}
  label:first-of-type{margin-top:0}
  input[type=text],input[type=password]{width:100%;max-width:340px;padding:.65rem .9rem;border:1.5px solid #e2e8f0;border-radius:8px;font-size:.9rem;outline:none;transition:border-color .15s;font-family:inherit}
  input:focus{border-color:#2563eb}
  .btn{padding:.65rem 1.5rem;background:#2563eb;color:white;border:none;border-radius:8px;font-size:.875rem;font-weight:600;cursor:pointer;margin-top:1rem}
  .btn:hover{background:#1d4ed8}
  .btn-danger{background:#ef4444}
  .btn-danger:hover{background:#dc2626}
  .btn-sm{padding:.4rem .9rem;font-size:.78rem;margin-top:0}
  .alert-ok{background:#d1fae5;color:#065f46;font-size:.82rem;padding:.5rem .9rem;border-radius:8px;margin-bottom:1rem}
  .alert-err{background:#fee2e2;color:#991b1b;font-size:.82rem;padding:.5rem .9rem;border-radius:8px;margin-bottom:1rem}
  table{width:100%;border-collapse:collapse}
  th{text-align:left;font-size:.75rem;font-weight:600;color:#64748b;letter-spacing:.04em;text-transform:uppercase;padding:.6rem 1rem;border-bottom:1px solid #f1f5f9}
  td{padding:.75rem 1rem;font-size:.875rem;border-bottom:1px solid #f8fafc;vertical-align:middle}
  tr:last-child td{border-bottom:none}
  .you-badge{font-size:.7rem;background:#dbeafe;color:#1d4ed8;padding:2px 8px;border-radius:20px;font-weight:600;margin-left:.5rem}
</style></head>
<body>
<nav class="sidebar">
  <div class="sidebar-logo">HR Dashboard<span>Middle PHP Developer</span></div>
  <a href="/hr" class="nav-btn"><span class="nav-icon">👥</span> Кандидаты</a>
  <a href="/hr/account" class="nav-btn active"><span class="nav-icon">⚙️</span> Аккаунт</a>
  <a href="/hr/logout" class="nav-logout"><span class="nav-icon">↩</span> Выйти</a>
</nav>
<div class="main">
  <h1>Аккаунт</h1>
  ${flash ? (flash.ok ? '<div class="alert-ok">' + esc(flash.ok) + '</div>' : '<div class="alert-err">' + esc(flash.err) + '</div>') : ''}
  ${content}
</div>
<script>
async function deleteUser(id, name) {
  if (!confirm('Удалить пользователя «' + name + '»?\\nЭто действие нельзя отменить.')) return;
  var btn = document.querySelector('[data-uid="' + id + '"]');
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  var res = await fetch('/api/hr/users/' + id, { method: 'DELETE', credentials: 'same-origin' });
  if (res.ok) {
    var row = document.getElementById('urow-' + id);
    if (row) row.remove();
  } else {
    if (btn) { btn.disabled = false; btn.textContent = 'Удалить'; }
    alert('Ошибка при удалении');
  }
}
</script>
</body></html>`;

const buildUsersTable = (allUsers, currentUsername) => allUsers.map(u => {
  const isMe = u.username === currentUsername;
  return '<tr id="urow-' + u.id + '">' +
    '<td>' + esc(u.username) + (isMe ? '<span class="you-badge">вы</span>' : '') + '</td>' +
    '<td style="color:#64748b;font-size:.8rem">' + (u.created_at ? new Date(u.created_at).toLocaleDateString('ru-RU') : '—') + '</td>' +
    '<td>' + (!isMe ? '<button class="btn btn-danger btn-sm" data-uid="' + u.id + '" onclick="deleteUser(' + u.id + ', \'' + esc(u.username) + '\')">Удалить</button>' : '') + '</td>' +
    '</tr>';
}).join('');

const accountContent = (username, userRows) => `
  <div class="section">
    <h2>Сменить логин</h2>
    <form method="POST" action="/hr/account/username">
      <label>Новый логин</label>
      <input type="text" name="new_username" value="${esc(username)}" required minlength="3" maxlength="50"/>
      <label>Текущий пароль</label>
      <input type="password" name="password" required/>
      <button class="btn" type="submit">Сохранить логин</button>
    </form>
  </div>
  <div class="section">
    <h2>Сменить пароль</h2>
    <form method="POST" action="/hr/account/password">
      <label>Текущий пароль</label>
      <input type="password" name="old_password" required/>
      <label>Новый пароль</label>
      <input type="password" name="new_password" required minlength="6"/>
      <label>Повторите новый пароль</label>
      <input type="password" name="new_password2" required minlength="6"/>
      <button class="btn" type="submit">Сменить пароль</button>
    </form>
  </div>
  <div class="section">
    <h2>Пользователи</h2>
    <table>
      <thead><tr><th>Логин</th><th>Создан</th><th></th></tr></thead>
      <tbody>${userRows}</tbody>
    </table>
    <a href="/hr/register" style="display:inline-block;margin-top:1rem;font-size:.875rem;color:#2563eb;font-weight:500">+ Добавить пользователя</a>
  </div>
  <div class="section">
    <h2>Резервная копия</h2>
    <p style="font-size:.85rem;color:#64748b;margin-bottom:1rem">Скачать все данные в формате JSON.</p>
    <a href="/hr/backup" class="btn" style="display:inline-block;text-decoration:none;background:#0f172a">↓ Скачать бэкап (JSON)</a>
  </div>`;

app.get('/hr/account', requireAuth, async (req, res) => {
  const username = req.hrUser?.username || '?';
  const { rows: allUsers } = await pool.query('SELECT id, username, created_at FROM hr_users ORDER BY created_at');
  res.send(accountShell(username, accountContent(username, buildUsersTable(allUsers, username)), null));
});

app.post('/hr/account/username', requireAuth, async (req, res) => {
  const currentUsername = req.hrUser?.username;
  if (!currentUsername) return res.redirect('/hr/login');
  const { new_username, password } = req.body;
  const newName = new_username?.trim();

  const sendPage = async (ok, err) => {
    const { rows: allUsers } = await pool.query('SELECT id, username, created_at FROM hr_users ORDER BY created_at');
    const displayName = ok ? newName : currentUsername;
    res.send(accountShell(displayName, accountContent(displayName, buildUsersTable(allUsers, displayName)), ok ? { ok } : { err }));
  };

  if (!newName || newName.length < 3) return sendPage(null, 'Логин должен содержать минимум 3 символа');

  const { rows: userRows } = await pool.query('SELECT password_hash FROM hr_users WHERE username = $1', [currentUsername]);
  if (!userRows[0] || !await verifyPassword(password, userRows[0].password_hash)) return sendPage(null, 'Неверный пароль');

  if (newName !== currentUsername) {
    const { rows: existing } = await pool.query('SELECT id FROM hr_users WHERE username = $1', [newName]);
    if (existing[0]) return sendPage(null, 'Пользователь с таким логином уже существует');
    await pool.query('UPDATE hr_users SET username = $1 WHERE username = $2', [newName, currentUsername]);
    const token = req.cookies?.hr_session;
    if (token) await pool.query('UPDATE hr_sessions SET username = $1 WHERE token = $2', [newName, token]);
  }
  return sendPage('Логин успешно изменён', null);
});

app.post('/hr/account/password', requireAuth, async (req, res) => {
  const currentUsername = req.hrUser?.username;
  if (!currentUsername) return res.redirect('/hr/login');
  const { old_password, new_password, new_password2 } = req.body;

  const sendPage = async (ok, err) => {
    const { rows: allUsers } = await pool.query('SELECT id, username, created_at FROM hr_users ORDER BY created_at');
    res.send(accountShell(currentUsername, accountContent(currentUsername, buildUsersTable(allUsers, currentUsername)), ok ? { ok } : { err }));
  };

  const { rows } = await pool.query('SELECT password_hash FROM hr_users WHERE username = $1', [currentUsername]);
  if (!rows[0] || !await verifyPassword(old_password, rows[0].password_hash)) return sendPage(null, 'Неверный текущий пароль');
  if (!new_password || new_password.length < 6) return sendPage(null, 'Новый пароль должен содержать минимум 6 символов');
  if (new_password !== new_password2) return sendPage(null, 'Пароли не совпадают');

  await pool.query('UPDATE hr_users SET password_hash = $1 WHERE username = $2', [await hashPassword(new_password), currentUsername]);
  return sendPage('Пароль успешно изменён', null);
});

app.delete('/api/hr/users/:id', requireAuth, async (req, res) => {
  const currentUsername = req.hrUser?.username;
  const { rows } = await pool.query('SELECT id, username FROM hr_users WHERE id = $1', [req.params.id]);
  const target = rows[0];
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.username === currentUsername) return res.status(400).json({ error: 'Cannot delete yourself' });
  await pool.query('DELETE FROM hr_sessions WHERE username = $1', [target.username]);
  await pool.query('DELETE FROM hr_users WHERE id = $1', [target.id]);
  res.json({ ok: true });
});

// ─── Вопросы ────────────────────────────────────────────────────────────────

app.get('/api/questions', async (req, res) => {
  const { rows: soft } = await pool.query("SELECT text, time_limit FROM questions WHERE block='soft' ORDER BY order_index");
  const { rows: hard } = await pool.query("SELECT text, time_limit FROM questions WHERE block='hard' ORDER BY order_index");
  res.json({
    soft: { timeLimit: soft[0]?.time_limit ?? 120, questions: soft.map(q => q.text) },
    hard: { timeLimit: hard[0]?.time_limit ?? 120, questions: hard.map(q => q.text) },
  });
});

app.put('/api/questions', requireAuth, async (req, res) => {
  const { soft, hard } = req.body;
  if (!soft?.questions?.length || !hard?.questions?.length) {
    return res.status(400).json({ error: 'Both blocks required' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM questions');
    for (let i = 0; i < soft.questions.length; i++) {
      await client.query('INSERT INTO questions (block, order_index, text, time_limit) VALUES ($1,$2,$3,$4)',
        ['soft', i, soft.questions[i].trim(), Math.max(10, parseInt(soft.timeLimit) || 120)]);
    }
    for (let i = 0; i < hard.questions.length; i++) {
      await client.query('INSERT INTO questions (block, order_index, text, time_limit) VALUES ($1,$2,$3,$4)',
        ['hard', i, hard.questions[i].trim(), Math.max(10, parseInt(hard.timeLimit) || 120)]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  res.json({ ok: true });
});

// ─── Сессии ──────────────────────────────────────────────────────────────────

app.post('/api/sessions', upload.single('resume'), async (req, res) => {
  const candidateName = req.body?.candidateName;
  if (!candidateName?.trim()) return res.status(400).json({ error: 'candidateName is required' });
  if (!req.file) return res.status(400).json({ error: 'resume is required' });
  if (req.file.mimetype !== 'application/pdf') return res.status(400).json({ error: 'resume must be a PDF file' });
  const { rows } = await pool.query('SELECT id FROM sessions WHERE LOWER(candidate_name) = LOWER($1)', [candidateName.trim()]);
  if (rows[0]) return res.status(409).json({ error: 'already_exists' });
  const id = uuidv4();
  await pool.query(
    'INSERT INTO sessions (id, candidate_name, resume_pdf, resume_filename) VALUES ($1, $2, $3, $4)',
    [id, candidateName.trim(), req.file.buffer, req.file.originalname]
  );
  res.json({ sessionId: id });
});

app.post('/api/sessions/:id/complete', async (req, res) => {
  await pool.query('UPDATE sessions SET completed_at = NOW() WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

app.post('/api/sessions/:id/archive', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT id FROM sessions WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Session not found' });
  await pool.query('UPDATE sessions SET archived = TRUE WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

app.post('/api/sessions/:id/unarchive', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT id FROM sessions WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Session not found' });
  await pool.query('UPDATE sessions SET archived = FALSE WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

app.put('/api/sessions/:id/notes', requireAuth, async (req, res) => {
  const { notes } = req.body;
  const { rows } = await pool.query('SELECT id FROM sessions WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Session not found' });
  await pool.query('UPDATE sessions SET notes = $1 WHERE id = $2', [notes || null, req.params.id]);
  res.json({ ok: true });
});

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.get('/hr/backup', requireAuth, async (req, res) => {
  const [sessRes, ansRes, qRes] = await Promise.all([
    pool.query('SELECT * FROM sessions ORDER BY created_at'),
    pool.query('SELECT * FROM answers ORDER BY session_id, block, question_index'),
    pool.query('SELECT * FROM questions ORDER BY block, order_index'),
  ]);
  const data = {
    exported_at: new Date().toISOString(),
    sessions: sessRes.rows,
    answers: ansRes.rows,
    questions: qRes.rows,
  };
  const filename = 'hr_backup_' + new Date().toISOString().slice(0, 10) + '.json';
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(filename));
  res.send(JSON.stringify(data, null, 2));
});

app.get('/hr/sessions/:id/resume', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT resume_pdf, resume_filename FROM sessions WHERE id = $1', [req.params.id]);
  if (!rows[0] || !rows[0].resume_pdf) return res.status(404).send('Резюме не найдено');
  const filename = rows[0].resume_filename || 'resume.pdf';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', "inline; filename*=UTF-8''" + encodeURIComponent(filename));
  res.send(rows[0].resume_pdf);
});

app.post('/api/sessions/:id/analyze', requireAuth, async (req, res) => {
  const { rows: sRows } = await pool.query('SELECT * FROM sessions WHERE id = $1', [req.params.id]);
  if (!sRows[0]) return res.status(404).json({ error: 'Session not found' });
  if (!sRows[0].completed_at) return res.status(400).json({ error: 'Session not completed' });

  const { rows: answers } = await pool.query(
    'SELECT * FROM answers WHERE session_id = $1 ORDER BY block, question_index', [req.params.id]
  );

  const fmt = (items, title) => {
    let t = `\n## ${title}\n`;
    items.forEach((a, i) => {
      t += `\nВопрос ${i + 1}: ${a.question_text}\n`;
      t += `Ответ: ${a.answer_text || '(нет ответа)'}\n`;
      t += `Время: ${a.time_spent}с ${a.auto_submitted ? '[время вышло]' : '[сам перешёл]'}\n`;
    });
    return t;
  };

  const softAnswers = answers.filter(a => a.block === 'soft');
  const hardAnswers = answers.filter(a => a.block === 'hard');

  const prompt = `Ты опытный технический HR-специалист. Проанализируй ответы кандидата на вакансию Middle PHP Developer.
${fmt(softAnswers, 'Soft Skills')}
${fmt(hardAnswers, 'Hard Skills')}

Оцени кандидата, учитывая качество ответов, глубину знаний, конкретность примеров, количество пропущенных ответов и автопереходов по таймеру.

Ответь строго в JSON без markdown:
{"verdict":"recommend"|"questionable"|"reject","score":1-10,"summary":"2-3 предложения на русском"}`;

  const message = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  });

  let result;
  try {
    result = JSON.parse(message.content[0].text);
  } catch {
    return res.status(500).json({ error: 'Не удалось разобрать ответ AI' });
  }

  const { verdict, score, summary } = result;
  if (!['recommend', 'questionable', 'reject'].includes(verdict) || !score || !summary) {
    return res.status(500).json({ error: 'Некорректный формат ответа AI' });
  }

  await pool.query(
    'UPDATE sessions SET ai_verdict = $1, ai_score = $2, ai_summary = $3 WHERE id = $4',
    [verdict, parseInt(score), summary, req.params.id]
  );

  res.json({ verdict, score: parseInt(score), summary });
});

app.get('/api/sessions/archived', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT id, candidate_name, created_at, completed_at, notes, ai_verdict, ai_score, ai_summary FROM sessions WHERE archived = TRUE ORDER BY created_at DESC');
  res.json(rows);
});

app.get('/api/sessions', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT id, candidate_name, created_at, completed_at, notes, ai_verdict, ai_score, ai_summary FROM sessions WHERE archived = FALSE ORDER BY created_at DESC');
  res.json(rows);
});

// ─── Попытки вставки ─────────────────────────────────────────────────────────

app.post('/api/paste-attempts', async (req, res) => {
  const { sessionId, block, questionIndex } = req.body;
  if (!sessionId || !block || questionIndex === undefined) {
    return res.status(400).json({ error: 'sessionId, block, questionIndex are required' });
  }
  await pool.query('INSERT INTO paste_attempts (session_id, block, question_index) VALUES ($1, $2, $3)', [sessionId, block, questionIndex]);
  res.json({ ok: true });
});

// ─── Ответы ───────────────────────────────────────────────────────────────────

app.post('/api/answers', async (req, res) => {
  const { sessionId, block, questionIndex, questionText, answerText, timeSpent, autoSubmitted } = req.body;
  if (!sessionId || !block || questionIndex === undefined) {
    return res.status(400).json({ error: 'sessionId, block, questionIndex are required' });
  }
  const { rows } = await pool.query('SELECT id FROM sessions WHERE id = $1', [sessionId]);
  if (!rows[0]) return res.status(404).json({ error: 'Session not found' });
  await pool.query(`
    INSERT INTO answers (session_id, block, question_index, question_text, answer_text, time_spent, auto_submitted)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (session_id, block, question_index) DO UPDATE SET
      question_text = EXCLUDED.question_text,
      answer_text = EXCLUDED.answer_text,
      time_spent = EXCLUDED.time_spent,
      auto_submitted = EXCLUDED.auto_submitted
  `, [sessionId, block, questionIndex, questionText, answerText || null, timeSpent || 0, !!autoSubmitted]);
  res.json({ ok: true });
});

app.delete('/api/sessions/:id', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT id FROM sessions WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Session not found' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM paste_attempts WHERE session_id = $1', [req.params.id]);
    await client.query('DELETE FROM answers WHERE session_id = $1', [req.params.id]);
    await client.query('DELETE FROM sessions WHERE id = $1', [req.params.id]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  res.json({ ok: true });
});

app.get('/api/sessions/:id/results', requireAuth, async (req, res) => {
  const { rows: sRows } = await pool.query('SELECT * FROM sessions WHERE id = $1', [req.params.id]);
  if (!sRows[0]) return res.status(404).json({ error: 'Session not found' });
  const { rows: answers } = await pool.query('SELECT * FROM answers WHERE session_id = $1 ORDER BY block, question_index', [req.params.id]);
  res.json({ session: sRows[0], answers });
});

// ─── HR: результаты кандидата ─────────────────────────────────────────────────

app.get('/results/:id', requireAuth, async (req, res) => {
  const { rows: sRows } = await pool.query('SELECT * FROM sessions WHERE id = $1', [req.params.id]);
  if (!sRows[0]) return res.status(404).send('<h1>Сессия не найдена</h1>');
  const session = sRows[0];

  const [ansRes, pasteRes, softTLRes, hardTLRes] = await Promise.all([
    pool.query('SELECT * FROM answers WHERE session_id = $1 ORDER BY block, question_index', [req.params.id]),
    pool.query('SELECT block, question_index FROM paste_attempts WHERE session_id = $1', [req.params.id]),
    pool.query("SELECT time_limit FROM questions WHERE block='soft' LIMIT 1"),
    pool.query("SELECT time_limit FROM questions WHERE block='hard' LIMIT 1"),
  ]);

  const answers = ansRes.rows;
  const pastes  = pasteRes.rows;
  const softTL  = softTLRes.rows[0]?.time_limit ?? 120;
  const hardTL  = hardTLRes.rows[0]?.time_limit ?? 120;

  const softAnswers = answers.filter(a => a.block === 'soft');
  const hardAnswers = answers.filter(a => a.block === 'hard');

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
  .notes-section{background:white;border-radius:12px;padding:1.25rem 1.5rem;margin-bottom:2rem;box-shadow:0 1px 3px rgba(0,0,0,.06)}
  .notes-label{font-size:.7rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#94a3b8;margin-bottom:.5rem}
  .notes-textarea{width:100%;min-height:100px;padding:.75rem 1rem;border:1.5px solid #e2e8f0;border-radius:8px;font-size:.9rem;line-height:1.6;font-family:inherit;resize:vertical;outline:none;transition:border-color .15s;box-sizing:border-box}
  .notes-textarea:focus{border-color:#2563eb}
  .save-notes-btn{padding:.45rem 1.1rem;background:#0f172a;color:white;border:none;border-radius:6px;font-size:.8rem;font-weight:600;cursor:pointer;margin-top:.5rem}
  .save-notes-btn:hover{background:#1e293b}
  .ai-result{background:white;border-radius:12px;padding:1.25rem 1.5rem;margin-bottom:1.25rem;box-shadow:0 1px 3px rgba(0,0,0,.06);display:flex;align-items:flex-start;gap:1.25rem;flex-wrap:wrap}
  .ai-verdict-badge{font-size:.95rem;font-weight:700;padding:.45rem 1rem;border-radius:8px;white-space:nowrap}
  .ai-recommend{background:#d1fae5;color:#065f46}
  .ai-questionable{background:#fef3c7;color:#92400e}
  .ai-reject{background:#fee2e2;color:#991b1b}
  .ai-summary-text{font-size:.875rem;color:#475569;line-height:1.6;flex:1}
  .ai-score{font-size:1.1rem;font-weight:700;color:#1e293b;white-space:nowrap}
</style></head>
<body><div class="page">
  <div class="top-nav">
    <a href="/hr" class="back">← Все кандидаты</a>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap">
      ${session.resume_filename ? `<a href="/hr/sessions/${session.id}/resume" class="export-btn" target="_blank">📄 Резюме PDF</a>` : ''}
      <a href="/results/${session.id}/export.txt" class="export-btn" download>↓ Скачать результаты (TXT)</a>
    </div>
  </div>
  <div class="page-header">
    <div class="candidate-name">${esc(session.candidate_name)}</div>
    <div class="session-meta">
      <span>Начало: <span class="local-date" data-ts="${toISO(session.created_at)}"></span></span>
      <span>${session.completed_at ? 'Завершено: <span class="local-date" data-ts="' + toISO(session.completed_at) + '"></span>' : 'Не завершено'}</span>
    </div>
  </div>
  ${session.ai_verdict ? `
  <div class="ai-result">
    <span class="ai-verdict-badge ai-${session.ai_verdict}">${{ recommend: '✅ Рекомендовать', questionable: '⚠️ Сомнительно', reject: '❌ Не подходит' }[session.ai_verdict]}</span>
    <span class="ai-score">${session.ai_score}/10</span>
    <p class="ai-summary-text">${esc(session.ai_summary || '')}</p>
  </div>` : ''}
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
  <div class="notes-section">
    <div class="notes-label">Заметки HR</div>
    <textarea id="hr-notes" class="notes-textarea" placeholder="Добавьте комментарий по кандидату...">${esc(session.notes || '')}</textarea>
    <div style="display:flex;align-items:center;gap:.75rem">
      <button class="save-notes-btn" onclick="saveNotes()">Сохранить заметку</button>
      <span id="notes-status" style="font-size:.82rem"></span>
    </div>
  </div>
</div>
<script>
document.querySelectorAll('.local-date[data-ts]').forEach(function(el){var ts=el.getAttribute('data-ts');if(!ts)return;var d=new Date(ts);el.textContent=isNaN(d)?ts:d.toLocaleString('ru-RU');});
async function saveNotes(){
  var status=document.getElementById('notes-status');
  status.textContent='Сохранение...'; status.style.color='#64748b';
  try{
    var res=await fetch('/api/sessions/${session.id}/notes',{method:'PUT',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({notes:document.getElementById('hr-notes').value})});
    if(res.ok){status.textContent='Сохранено ✓';status.style.color='#10b981';}
    else{status.textContent='Ошибка';status.style.color='#ef4444';}
  }catch(e){status.textContent='Ошибка сети';status.style.color='#ef4444';}
  setTimeout(function(){status.textContent='';},3000);
}
document.getElementById('hr-notes').addEventListener('blur', saveNotes);
</script>
</body></html>`);
});

// ─── Экспорт TXT ─────────────────────────────────────────────────────────────

app.get('/results/:id/export.txt', requireAuth, async (req, res) => {
  const { rows: sRows } = await pool.query('SELECT * FROM sessions WHERE id = $1', [req.params.id]);
  if (!sRows[0]) return res.status(404).send('Session not found');
  const session = sRows[0];

  const [ansRes, pasteRes, softTLRes, hardTLRes] = await Promise.all([
    pool.query('SELECT * FROM answers WHERE session_id = $1 ORDER BY block, question_index', [req.params.id]),
    pool.query('SELECT block, question_index FROM paste_attempts WHERE session_id = $1', [req.params.id]),
    pool.query("SELECT time_limit FROM questions WHERE block='soft' LIMIT 1"),
    pool.query("SELECT time_limit FROM questions WHERE block='hard' LIMIT 1"),
  ]);

  const answers      = ansRes.rows;
  const pastes       = pasteRes.rows;
  const softTL       = softTLRes.rows[0]?.time_limit ?? 120;
  const hardTL       = hardTLRes.rows[0]?.time_limit ?? 120;
  const softAnswers  = answers.filter(a => a.block === 'soft');
  const hardAnswers  = answers.filter(a => a.block === 'hard');

  const fmtTime = (sec) => {
    if (!sec && sec !== 0) return '—';
    if (sec >= 60) { const m = Math.floor(sec / 60), s = sec % 60; return s ? m + ' мин ' + s + ' с' : m + ' мин'; }
    return sec + ' с';
  };
  const pasteCount = (block, qi) => pastes.filter(p => p.block === block && p.question_index === qi).length;

  const lines = [];
  lines.push('РЕЗУЛЬТАТЫ ТЕСТИРОВАНИЯ');
  lines.push('='.repeat(60));
  lines.push('Кандидат: ' + session.candidate_name);
  lines.push('Начало: ' + fmtDate(session.created_at));
  lines.push('Завершено: ' + (session.completed_at ? fmtDate(session.completed_at) : 'нет'));
  lines.push('');

  const renderBlock = (items, block, timeLimit, title) => {
    lines.push(title);
    lines.push('-'.repeat(40));
    items.forEach((a, i) => {
      const pc = pasteCount(block, a.question_index);
      lines.push('');
      lines.push('Вопрос ' + (i + 1) + ':');
      lines.push(a.question_text);
      lines.push('');
      lines.push('Ответ:');
      lines.push(a.answer_text || '(ответ не был записан)');
      lines.push('');
      const meta = ['Время: ' + fmtTime(a.time_spent) + ' из ' + fmtTime(timeLimit)];
      if (a.auto_submitted) meta.push('[время вышло]'); else meta.push('[сам перешёл]');
      if (pc > 0) meta.push('попыток вставить: ' + pc);
      lines.push(meta.join(' '));
      lines.push('- '.repeat(30).trim());
    });
  };

  renderBlock(softAnswers, 'soft', softTL, 'SOFT SKILLS');
  lines.push('');
  renderBlock(hardAnswers, 'hard', hardTL, 'HARD SKILLS');

  const filename = 'assessment_' + session.candidate_name.replace(/\s+/g, '_') + '_' + session.id.slice(0, 8) + '.txt';
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(filename));
  res.send(lines.join('\n'));
});

// ─── Экспорт для AI (JSON) ────────────────────────────────────────────────────

app.get('/results/:id/export.json', requireAuth, async (req, res) => {
  const { rows: sRows } = await pool.query('SELECT * FROM sessions WHERE id = $1', [req.params.id]);
  if (!sRows[0]) return res.status(404).json({ error: 'Session not found' });
  const session = sRows[0];

  const [ansRes, pasteRes, softTLRes, hardTLRes] = await Promise.all([
    pool.query('SELECT * FROM answers WHERE session_id = $1 ORDER BY block, question_index', [req.params.id]),
    pool.query('SELECT block, question_index, created_at FROM paste_attempts WHERE session_id = $1 ORDER BY created_at', [req.params.id]),
    pool.query("SELECT time_limit FROM questions WHERE block='soft' LIMIT 1"),
    pool.query("SELECT time_limit FROM questions WHERE block='hard' LIMIT 1"),
  ]);

  const answers     = ansRes.rows;
  const pastes      = pasteRes.rows;
  const softTL      = softTLRes.rows[0]?.time_limit ?? 120;
  const hardTL      = hardTLRes.rows[0]?.time_limit ?? 120;
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
      paste_attempt_timestamps: qPastes.map(p => toISO(p.created_at)),
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
      started_at: toISO(session.created_at),
      completed_at: toISO(session.completed_at) || null,
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
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(filename));
  res.send(JSON.stringify(payload, null, 2));
});

// ─── HR: дашборд ──────────────────────────────────────────────────────────────

app.get('/hr', requireAuth, async (req, res) => {
  const { rows: sessions } = await pool.query('SELECT id, candidate_name, created_at, completed_at, notes, ai_verdict, ai_score, ai_summary FROM sessions WHERE archived = FALSE ORDER BY created_at DESC');
  const initialIds = JSON.stringify(sessions.map(s => s.id));

  const rows = sessions.length === 0
    ? '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:2rem">Нет пройденных тестов</td></tr>'
    : sessions.map(s => {
        const done = !!s.completed_at;
        const dur = done
          ? Math.round((new Date(s.completed_at) - new Date(s.created_at)) / 60000) + ' мин'
          : '—';
        const aiCell = s.ai_verdict
          ? '<span class="ai-badge ai-' + s.ai_verdict + '" title="' + esc(s.ai_summary || '') + '">' +
            ({ recommend: '✅ Рекомендовать', questionable: '⚠️ Сомнительно', reject: '❌ Не подходит' }[s.ai_verdict]) +
            ' · ' + s.ai_score + '/10</span>'
          : (done ? '<button class="ai-btn" data-sid="' + s.id + '">🤖 Анализ</button>' : '—');
        return '<tr id="row-' + s.id + '" data-name="' + esc(s.candidate_name) + '" data-date="' + toISO(s.created_at) + '" data-status="' + (done ? 'done' : 'active') + '">' +
          '<td><strong>' + esc(s.candidate_name) + '</strong>' + (s.notes ? ' <span class="note-badge" title="' + esc(s.notes) + '">📝</span>' : '') + '</td>' +
          '<td><span class="local-date" data-ts="' + toISO(s.created_at) + '"></span></td>' +
          '<td>' + (done ? '<span class="status-done">Завершено</span>' : '<span class="status-prog">В процессе</span>') + '</td>' +
          '<td>' + dur + '</td>' +
          '<td id="ai-' + s.id + '">' + aiCell + '</td>' +
          '<td><a href="/results/' + s.id + '" target="_blank" class="res-link">Результаты →</a></td>' +
          '<td><button class="arch-btn" data-sid="' + s.id + '" data-name="' + esc(s.candidate_name) + '">В архив</button> <button class="del-btn" data-sid="' + s.id + '" data-name="' + esc(s.candidate_name) + '">Удалить</button></td>' +
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
  .arch-btn{background:none;border:1px solid #bfdbfe;color:#2563eb;font-size:.78rem;font-weight:600;padding:4px 10px;border-radius:6px;cursor:pointer;transition:background .15s,color .15s;margin-right:4px}
  .arch-btn:hover{background:#dbeafe}
  .arch-btn:disabled{opacity:.4;cursor:default}
  .unarch-btn{background:none;border:1px solid #bbf7d0;color:#16a34a;font-size:.78rem;font-weight:600;padding:4px 10px;border-radius:6px;cursor:pointer;transition:background .15s;margin-right:4px}
  .unarch-btn:hover{background:#dcfce7}
  .unarch-btn:disabled{opacity:.4;cursor:default}
  .note-badge{font-size:.85rem;cursor:default;margin-left:4px}
  .search-input{padding:.45rem .75rem;border:1.5px solid #e2e8f0;border-radius:8px;font-size:.85rem;outline:none;width:220px;font-family:inherit}
  .search-input:focus{border-color:#2563eb}
  th.sortable{cursor:pointer;user-select:none}
  th.sortable:hover{color:#0f172a}
  .sort-icon{font-size:.7rem;margin-left:3px;color:#94a3b8}
  .notify-banner{position:fixed;top:1rem;right:1rem;background:#0f172a;color:white;padding:.75rem 1.25rem;border-radius:10px;font-size:.875rem;z-index:1000;display:flex;align-items:center;gap:.75rem;box-shadow:0 4px 20px rgba(0,0,0,.3)}
  .del-btn{background:none;border:1px solid #fecaca;color:#ef4444;font-size:.78rem;font-weight:600;padding:4px 10px;border-radius:6px;cursor:pointer;transition:background .15s,color .15s}
  .del-btn:hover{background:#fee2e2}
  .del-btn:disabled{opacity:.4;cursor:default}
  .ai-badge{display:inline-block;font-size:.75rem;font-weight:600;padding:3px 10px;border-radius:20px;cursor:default}
  .ai-recommend{background:#d1fae5;color:#065f46}
  .ai-questionable{background:#fef3c7;color:#92400e}
  .ai-reject{background:#fee2e2;color:#991b1b}
  .ai-btn{background:none;border:1px solid #e0e7ff;color:#4f46e5;font-size:.78rem;font-weight:600;padding:4px 10px;border-radius:6px;cursor:pointer;transition:background .15s}
  .ai-btn:hover{background:#e0e7ff}
  .ai-btn:disabled{opacity:.4;cursor:default}
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
  <button class="nav-btn" data-tab="archive" onclick="switchTab('archive', this)">
    <span class="nav-icon">📦</span> Архив
  </button>
  <a href="/hr/account" class="nav-btn" style="text-decoration:none">
    <span class="nav-icon">⚙️</span> Аккаунт
  </a>
  <a href="/hr/logout" class="nav-logout"><span class="nav-icon">↩</span> Выйти</a>
</nav>

<div class="main">

  <!-- Кандидаты -->
  <div id="tab-candidates" class="tab-content active">
    <h1>Кандидаты</h1>
    <div class="table-wrap">
      <div class="table-header">
        <h2>Все тесты</h2>
        <div style="display:flex;align-items:center;gap:.75rem">
          <input type="text" id="search-input" class="search-input" placeholder="Поиск по имени..." oninput="filterCandidates(this.value)"/>
          <button class="refresh-btn" onclick="location.reload()">↻ Обновить</button>
        </div>
      </div>
      <table>
        <thead><tr>
          <th class="sortable" onclick="sortTable('name')">Кандидат <span class="sort-icon" id="sort-name"></span></th>
          <th class="sortable" onclick="sortTable('date')">Дата начала <span class="sort-icon" id="sort-date">↓</span></th>
          <th class="sortable" onclick="sortTable('status')">Статус <span class="sort-icon" id="sort-status"></span></th>
          <th>Длительность</th><th>AI-оценка</th><th>Результаты</th><th></th>
        </tr></thead>
        <tbody id="candidates-tbody">${rows}</tbody>
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

  <!-- Архив -->
  <div id="tab-archive" class="tab-content">
    <h1>Архив</h1>
    <div class="table-wrap">
      <div class="table-header">
        <h2>Архивные тесты</h2>
        <button class="refresh-btn" onclick="loadArchive(true)">↻ Обновить</button>
      </div>
      <table>
        <thead><tr>
          <th>Кандидат</th><th>Дата начала</th><th>Статус</th><th>Длительность</th><th>Результаты</th><th></th>
        </tr></thead>
        <tbody id="archive-tbody">
          <tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:2rem">Загрузка...</td></tr>
        </tbody>
      </table>
    </div>
  </div>

</div>

<script>
var questionsData = null;
var initialSessionIds = new Set(${initialIds});

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

document.addEventListener('click', function(e) {
  var btn = e.target.closest('.del-btn');
  if (btn) { deleteSession(btn.getAttribute('data-sid'), btn.getAttribute('data-name')); return; }
  var aibtn = e.target.closest('.ai-btn');
  if (aibtn) { analyzeSession(aibtn.getAttribute('data-sid')); return; }
  var abtn = e.target.closest('.arch-btn');
  if (abtn) { archiveSession(abtn.getAttribute('data-sid'), abtn.getAttribute('data-name')); return; }
  var ubtn = e.target.closest('.unarch-btn');
  if (ubtn) unarchiveSession(ubtn.getAttribute('data-sid'), ubtn.getAttribute('data-name'));
});

var aiLabels = { recommend: '✅ Рекомендовать', questionable: '⚠️ Сомнительно', reject: '❌ Не подходит' };

async function analyzeSession(id) {
  var btn = document.querySelector('.ai-btn[data-sid="' + id + '"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Анализ...'; }
  try {
    var res = await fetch('/api/sessions/' + id + '/analyze', { method: 'POST', credentials: 'same-origin' });
    if (res.status === 401) { location.href = '/hr/login'; return; }
    if (!res.ok) throw new Error((await res.json()).error || 'Ошибка');
    var data = await res.json();
    var cell = document.getElementById('ai-' + id);
    if (cell) {
      cell.innerHTML = '<span class="ai-badge ai-' + data.verdict + '" title="' + escHtml(data.summary) + '">' +
        aiLabels[data.verdict] + ' · ' + data.score + '/10</span>';
    }
  } catch(e) {
    alert('Ошибка AI-анализа: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '🤖 Анализ'; }
  }
}

async function deleteSession(id, name) {
  if (!confirm('Удалить тест кандидата «' + name + '»?\\nЭто действие нельзя отменить.')) return;
  var btn = document.querySelector('.del-btn[data-sid="' + id + '"]');
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  try {
    var res = await fetch('/api/sessions/' + id, { method: 'DELETE', credentials: 'same-origin' });
    if (res.status === 401) { alert('Сессия истекла — войдите заново.'); location.href = '/hr/login'; return; }
    if (!res.ok) throw new Error('status ' + res.status);
    var row = document.getElementById('row-' + id);
    if (row) {
      var tbody = row.parentNode;
      row.remove();
      if (tbody && !tbody.querySelector('tr')) {
        var inArchive = tbody.id === 'archive-tbody';
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:2rem">' + (inArchive ? 'Архив пуст' : 'Нет пройденных тестов') + '</td></tr>';
      }
    }
  } catch(e) {
    alert('Ошибка при удалении: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Удалить'; }
  }
}

async function archiveSession(id, name) {
  if (!confirm('Переместить тест кандидата «' + name + '» в архив?')) return;
  var btn = document.querySelector('.arch-btn[data-sid="' + id + '"]');
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  try {
    var res = await fetch('/api/sessions/' + id + '/archive', { method: 'POST', credentials: 'same-origin' });
    if (res.status === 401) { alert('Сессия истекла — войдите заново.'); location.href = '/hr/login'; return; }
    if (!res.ok) throw new Error('status ' + res.status);
    var row = document.getElementById('row-' + id);
    if (row) {
      var tbody = row.parentNode;
      row.remove();
      if (tbody && !tbody.querySelector('tr')) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:2rem">Нет пройденных тестов</td></tr>';
      }
    }
    archiveLoaded = false;
  } catch(e) {
    alert('Ошибка при архивировании: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = 'В архив'; }
  }
}

async function unarchiveSession(id, name) {
  if (!confirm('Вернуть тест «' + name + '» из архива?')) return;
  var btn = document.querySelector('.unarch-btn[data-sid="' + id + '"]');
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  try {
    var res = await fetch('/api/sessions/' + id + '/unarchive', { method: 'POST', credentials: 'same-origin' });
    if (res.status === 401) { location.href = '/hr/login'; return; }
    if (!res.ok) throw new Error();
    var row = document.getElementById('row-' + id);
    if (row) {
      var tbody = row.parentNode;
      row.remove();
      if (tbody && !tbody.querySelector('tr')) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:2rem">Архив пуст</td></tr>';
      }
    }
  } catch(e) {
    alert('Ошибка: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Из архива'; }
  }
}

function filterCandidates(query) {
  var q = query.toLowerCase().trim();
  var rows = document.querySelectorAll('#candidates-tbody tr[data-name]');
  var visible = 0;
  rows.forEach(function(row) {
    var match = !q || row.getAttribute('data-name').toLowerCase().includes(q);
    row.style.display = match ? '' : 'none';
    if (match) visible++;
  });
  var empty = document.getElementById('search-empty-row');
  if (visible === 0 && rows.length > 0) {
    if (!empty) {
      empty = document.createElement('tr');
      empty.id = 'search-empty-row';
      empty.innerHTML = '<td colspan="7" style="text-align:center;color:#94a3b8;padding:2rem">Ничего не найдено</td>';
    }
    document.getElementById('candidates-tbody').appendChild(empty);
  } else if (empty) {
    empty.remove();
  }
}

var sortState = { col: 'date', dir: -1 };
function sortTable(col) {
  if (sortState.col === col) { sortState.dir *= -1; }
  else { sortState.col = col; sortState.dir = col === 'date' ? -1 : 1; }
  document.querySelectorAll('.sort-icon').forEach(function(el) { el.textContent = ''; });
  var icon = document.getElementById('sort-' + col);
  if (icon) icon.textContent = sortState.dir === 1 ? '↑' : '↓';
  var tbody = document.getElementById('candidates-tbody');
  var rows = Array.from(tbody.querySelectorAll('tr[data-name]'));
  rows.sort(function(a, b) {
    var av = a.getAttribute('data-' + col) || '';
    var bv = b.getAttribute('data-' + col) || '';
    return sortState.dir * av.localeCompare(bv, 'ru');
  });
  rows.forEach(function(row) { tbody.appendChild(row); });
}

async function checkNewSessions() {
  try {
    var res = await fetch('/api/sessions', { credentials: 'same-origin' });
    if (!res.ok) return;
    var data = await res.json();
    var newCompleted = data.filter(function(s) { return s.completed_at && !initialSessionIds.has(s.id); });
    if (newCompleted.length > 0) {
      var old = document.getElementById('notify-banner');
      if (old) old.remove();
      var banner = document.createElement('div');
      banner.id = 'notify-banner';
      banner.className = 'notify-banner';
      banner.innerHTML = '<span>🔔 Новых результатов: ' + newCompleted.length + '</span>' +
        '<button onclick="location.reload()" style="background:#2563eb;color:white;border:none;padding:.35rem .9rem;border-radius:6px;cursor:pointer;font-size:.8rem;font-weight:600">Обновить</button>' +
        '<button onclick="this.parentNode.remove()" style="background:transparent;color:#94a3b8;border:none;cursor:pointer;font-size:1.2rem;line-height:1">×</button>';
      document.body.appendChild(banner);
    }
  } catch(e) {}
}
setInterval(checkNewSessions, 60000);

var archiveLoaded = false;
async function loadArchive(force) {
  if (archiveLoaded && !force) return;
  var tbody = document.getElementById('archive-tbody');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:2rem">Загрузка...</td></tr>';
  try {
    var res = await fetch('/api/sessions/archived', { credentials: 'same-origin' });
    if (res.status === 401) { location.href = '/hr/login'; return; }
    if (!res.ok) throw new Error();
    var sessions = await res.json();
    if (!sessions.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:2rem">Архив пуст</td></tr>';
    } else {
      tbody.innerHTML = sessions.map(function(s) {
        var done = !!s.completed_at;
        var dur = done ? Math.round((new Date(s.completed_at) - new Date(s.created_at)) / 60000) + ' мин' : '—';
        return '<tr id="row-' + s.id + '">' +
          '<td><strong>' + escHtml(s.candidate_name) + '</strong></td>' +
          '<td><span class="local-date" data-ts="' + (s.created_at || '') + '"></span></td>' +
          '<td>' + (done ? '<span class="status-done">Завершено</span>' : '<span class="status-prog">В процессе</span>') + '</td>' +
          '<td>' + dur + '</td>' +
          '<td><a href="/results/' + s.id + '" target="_blank" class="res-link">Результаты →</a></td>' +
          '<td><button class="unarch-btn" data-sid="' + s.id + '" data-name="' + escHtml(s.candidate_name) + '">Из архива</button><button class="del-btn" data-sid="' + s.id + '" data-name="' + escHtml(s.candidate_name) + '">Удалить</button></td>' +
          '</tr>';
      }).join('');
      formatLocalDates();
    }
    archiveLoaded = true;
  } catch(e) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:2rem">Ошибка загрузки</td></tr>';
  }
}

function formatLocalDates() {
  document.querySelectorAll('.local-date[data-ts]').forEach(function(el) {
    var ts = el.getAttribute('data-ts');
    if (!ts) return;
    var d = new Date(ts);
    el.textContent = isNaN(d) ? ts : d.toLocaleString('ru-RU');
  });
}
formatLocalDates();

function switchTab(tab, btn) {
  document.querySelectorAll('.tab-content').forEach(function(el) { el.classList.remove('active'); });
  document.querySelectorAll('.nav-btn').forEach(function(el) { el.classList.remove('active'); });
  document.getElementById('tab-' + tab).classList.add('active');
  btn.classList.add('active');
  if (tab === 'questions' && !questionsData) loadQuestions();
  if (tab === 'archive') loadArchive(false);
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
    var num = document.createElement('span');
    num.className = 'q-num';
    num.textContent = i + 1;
    var ta = document.createElement('textarea');
    ta.className = 'q-textarea';
    ta.value = q;
    ta.rows = 3;
    ta.addEventListener('input', function() { questionsData[block].questions[i] = ta.value; });
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
  if (questionsData[block].questions.length <= 1) { alert('Должен быть хотя бы один вопрос'); return; }
  if (!confirm('Удалить вопрос ' + (index + 1) + '?')) return;
  questionsData[block].questions.splice(index, 1);
  renderList(block);
}

async function saveQuestions() {
  var softQs = questionsData.soft.questions.map(function(q) { return q.trim(); }).filter(Boolean);
  var hardQs = questionsData.hard.questions.map(function(q) { return q.trim(); }).filter(Boolean);
  if (!softQs.length || !hardQs.length) { alert('Нельзя сохранить пустой блок вопросов'); return; }
  var payload = {
    soft: { timeLimit: parseInt(document.getElementById('time-soft').value) || 120, questions: softQs },
    hard: { timeLimit: parseInt(document.getElementById('time-hard').value) || 120, questions: hardQs }
  };
  var btn = document.getElementById('save-btn');
  var msg = document.getElementById('save-msg');
  var err = document.getElementById('save-err');
  btn.disabled = true; btn.textContent = 'Сохранение...';
  msg.style.display = 'none'; err.style.display = 'none';
  try {
    var res = await fetch('/api/questions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
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
    btn.disabled = false; btn.textContent = 'Сохранить изменения';
  }
}
</script>
</body></html>`);
});

// ─── Глобальный обработчик ошибок ────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error(err);
  if (!res.headersSent) {
    if (req.path.startsWith('/api/')) {
      res.status(500).json({ error: 'Internal server error' });
    } else {
      res.status(500).send('<h1>Внутренняя ошибка сервера</h1><p>' + err.message + '</p>');
    }
  }
});

const PORT = process.env.PORT || 3001;
init()
  .then(() => app.listen(PORT, () => console.log('Backend running on port ' + PORT)))
  .catch(err => { console.error('DB init failed:', err); process.exit(1); });
