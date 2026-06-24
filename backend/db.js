const { Pool } = require('pg');

const SOFT_DEFAULTS = [
  'Расскажите о случае, когда вам пришлось разрешать конфликт внутри команды. Что вы сделали и к чему это привело?',
  'Как вы расставляете приоритеты задач, когда несколько из них имеют одинаковый дедлайн?',
  'Опишите ситуацию, когда вы допустили серьёзную ошибку в проекте. Как вы с ней справились?',
  'Как вы объясняете технические решения коллегам без технического бэкграунда?',
  'Расскажите о проекте, которым вы особенно гордитесь. Какова была ваша роль?',
  'Как вы реагируете на критику вашего кода во время code review?',
  'Опишите, как вы адаптируетесь при входе в новую команду с устоявшимися процессами.',
  'Что вы делаете, если не согласны с техническим решением, принятым тимлидом?',
  'Как вы поддерживаете и развиваете свои профессиональные знания?',
];

const HARD_DEFAULTS = [
  'В чём разница между абстрактным классом и интерфейсом в PHP? Когда применять каждый?',
  'Что такое PSR-стандарты? Назовите основные из них и их назначение.',
  'Объясните принципы SOLID. Приведите пример нарушения одного из них.',
  'Как работает сборщик мусора в PHP? Что такое circular reference?',
  'В чём основные архитектурные отличия Laravel и Symfony? Когда выбрать каждый?',
  'Что такое транзакция в БД? Как реализовать её через PDO в PHP?',
  'Объясните паттерн Repository и его назначение в PHP-проекте.',
  'Как реализовать асинхронность в PHP? Назовите известные инструменты и подходы.',
];

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hr_users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS hr_sessions (
      token TEXT PRIMARY KEY,
      expires_at BIGINT NOT NULL,
      username TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      candidate_name TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      archived BOOLEAN NOT NULL DEFAULT FALSE,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS answers (
      id SERIAL PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      block TEXT NOT NULL,
      question_index INTEGER NOT NULL,
      question_text TEXT NOT NULL,
      answer_text TEXT,
      time_spent INTEGER,
      auto_submitted BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(session_id, block, question_index)
    );
    CREATE TABLE IF NOT EXISTS questions (
      id SERIAL PRIMARY KEY,
      block TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      time_limit INTEGER NOT NULL DEFAULT 120
    );
    CREATE TABLE IF NOT EXISTS paste_attempts (
      id SERIAL PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      block TEXT NOT NULL,
      question_index INTEGER NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // AI-колонки — добавляем если ещё нет
  await pool.query('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ai_verdict TEXT');
  await pool.query('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ai_score INTEGER');
  await pool.query('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ai_summary TEXT');
  // Резюме — добавляем если ещё нет
  await pool.query('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS resume_pdf BYTEA');
  await pool.query('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS resume_filename TEXT');

  const { rows } = await pool.query('SELECT COUNT(*) AS cnt FROM questions');
  if (parseInt(rows[0].cnt) === 0) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < SOFT_DEFAULTS.length; i++) {
        await client.query(
          'INSERT INTO questions (block, order_index, text, time_limit) VALUES ($1, $2, $3, $4)',
          ['soft', i, SOFT_DEFAULTS[i], 120]
        );
      }
      for (let i = 0; i < HARD_DEFAULTS.length; i++) {
        await client.query(
          'INSERT INTO questions (block, order_index, text, time_limit) VALUES ($1, $2, $3, $4)',
          ['hard', i, HARD_DEFAULTS[i], 120]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}

module.exports = { pool, init };
