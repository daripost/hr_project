const Database = require('better-sqlite3');
const path = require('path');

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

const dbPath = process.env.DB_PATH || path.join(__dirname, 'assessments.db');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    candidate_name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    block TEXT NOT NULL,
    question_index INTEGER NOT NULL,
    question_text TEXT NOT NULL,
    answer_text TEXT,
    time_spent INTEGER,
    auto_submitted INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );

  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    block TEXT NOT NULL,
    order_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    time_limit INTEGER NOT NULL DEFAULT 60
  );
`);

// Засеять дефолтные вопросы если таблица пустая
const { cnt } = db.prepare('SELECT COUNT(*) as cnt FROM questions').get();
if (cnt === 0) {
  const ins = db.prepare('INSERT INTO questions (block, order_index, text, time_limit) VALUES (?, ?, ?, ?)');
  db.transaction(() => {
    SOFT_DEFAULTS.forEach((text, i) => ins.run('soft', i, text, 60));
    HARD_DEFAULTS.forEach((text, i) => ins.run('hard', i, text, 60));
  })();
}

module.exports = db;
