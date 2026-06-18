# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the project

**Preferred (Docker):**
```bash
docker compose up --build
```

**With Node.js (requires `brew install node`):**
```bash
# Install dependencies (first time only)
cd backend && npm install
cd frontend && npm install

# Start both servers
./start.sh

# Or individually:
cd backend && npm run dev     # node --watch, port 3001
cd frontend && npm run dev    # vite dev server, port 3000
```

The frontend Vite dev server proxies `/api/*` to `http://localhost:3001`, so no CORS issues in development.

## URLs

- Candidate assessment: `http://localhost:3000`
- HR dashboard (requires login): `http://localhost:3001/hr`
- Individual results: `http://localhost:3001/results/<session-id>`
- AI export: `http://localhost:3001/results/<session-id>/export.json`

## HR credentials

Users are stored in the `hr_users` table with PBKDF2-SHA512 hashed passwords. Register at `/hr/register`. If no users exist yet, the login page shows a prompt to register first. Sessions expire after 8 hours of inactivity; the session store is in-memory so restarts require re-login.

## Architecture

Two separate packages: `backend/` (Node.js/Express/CommonJS) and `frontend/` (React/Vite/ESM).

### Assessment flow (frontend)

`App.jsx` is a screen state machine: `loading → intro → soft → transition → hard → complete`. On mount it fetches questions from `/api/questions`; if that fails it falls back to the hardcoded values in `frontend/src/data/questions.js`.

`QuestionScreen.jsx` is reused for both blocks. The timer uses `setTimeout` decrementing `timeLeft` each second. **Important:** `answer` state is mirrored in `answerRef` so `saveAndAdvance` can read the answer text without being listed as a `useCallback` dependency — this prevents timer resets on every keystroke.

Paste, drop, and context-menu are blocked on the textarea. Each blocked paste attempt fires `POST /api/paste-attempts` to the backend for logging.

All styling is inline JS objects (no CSS modules, no Tailwind).

### Backend

`backend/server.js` — Express app (CommonJS), port 3001. Routes:

**Public (candidate-facing):**
- `POST /api/sessions` — create session
- `POST /api/answers` — save one answer
- `POST /api/paste-attempts` — log paste attempt
- `POST /api/sessions/:id/complete` — stamp `completed_at`
- `GET /api/questions` — fetch questions and time limits

**Protected by `requireAuth` middleware (HR only):**
- `GET /hr` — HR dashboard (candidates list + question editor)
- `GET /hr/login` / `POST /hr/login` — login
- `GET /hr/register` / `POST /hr/register` — registration (open, no invite needed)
- `GET /hr/logout` — logout
- `PUT /api/questions` — update questions
- `GET /api/sessions` — list all sessions
- `GET /api/sessions/:id/results` — JSON results
- `GET /results/:id` — server-rendered HTML results page
- `GET /results/:id/export.json` — AI-friendly JSON export

Auth uses `cookie-parser` + an in-memory `Map` of `token → { expires }`. Tokens are 32-byte hex strings; cookies are `httpOnly` + `sameSite: strict`.

`backend/db.js` — initialises better-sqlite3. DB path is `./assessments.db` locally or `$DB_PATH` env var (Docker volume). Runs schema migrations on startup (e.g. renames `image_data` → `answer_text` if upgrading from old schema). Seeds default questions if the `questions` table is empty.

### Database schema

```
hr_users       — id, username (unique), password_hash (salt:pbkdf2hex), created_at
sessions       — id (uuid), candidate_name, created_at, completed_at
answers        — session_id, block, question_index, question_text,
                 answer_text (null if nothing typed), time_spent (s), auto_submitted (0|1)
questions      — block, order_index, text, time_limit (s)
paste_attempts — session_id, block, question_index, created_at
```

### Questions and time limits

Questions and fallback time limits live in `frontend/src/data/questions.js` but are **authoritative in the DB**. The HR dashboard question editor writes to the DB via `PUT /api/questions`. The frontend always fetches from the API on load.
