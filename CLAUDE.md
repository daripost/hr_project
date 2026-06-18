# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the project

**Preferred (Docker):**
```bash
docker compose up --build
```
- Frontend: http://localhost:3000
- Backend: http://localhost:3001
- HR results page: http://localhost:3001/results/<session-id>

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

## Architecture

This is a two-part app: a Node.js/Express backend and a React/Vite frontend. They are completely separate packages with their own `package.json` files.

### Assessment flow (frontend)

`App.jsx` owns a simple screen state machine: `intro → soft → transition → hard → complete`. The `QuestionScreen` component is reused for both blocks, parameterised by `block`, `questions`, and `timeLimit`.

The core timer logic is in `QuestionScreen.jsx`: a `setTimeout`-based countdown decrements `timeLeft` each second. When `timeLeft` reaches 0, `saveAndAdvance(true)` fires automatically — it grabs `canvasRef.current.toDataURL()` (whatever was drawn, even if incomplete), POSTs it to the backend, then advances the index. The candidate can also trigger `saveAndAdvance(false)` manually via the button.

Answer input is a plain `<textarea>` with paste, drop, and context-menu disabled (`onPaste`, `onDrop`, `onContextMenu` all call `e.preventDefault()`). A toast warning appears for 2 seconds when paste is attempted. The textarea auto-focuses on each question change.

All styling is inline JS objects (no CSS modules, no Tailwind). `index.css` only provides global resets.

### Backend

`backend/server.js` — Express app (CommonJS), port 3001. No auth. All routes:
- `POST /api/sessions` — creates a session, returns `{ sessionId }`
- `POST /api/answers` — saves one answer (base64 PNG + metadata)
- `POST /api/sessions/:id/complete` — stamps `completed_at`
- `GET /api/sessions` — lists all sessions (for HR tooling)
- `GET /api/sessions/:id/results` — JSON results
- `GET /results/:id` — server-rendered HTML report for HR review (shows answer images inline)

`backend/db.js` — initialises better-sqlite3. The DB path is `./assessments.db` locally, or `$DB_PATH` env var (used by Docker to persist to a mounted volume at `/app/data`).

### Database schema

```
sessions  — id (uuid), candidate_name, created_at, completed_at
answers   — session_id, block ('soft'|'hard'), question_index, question_text,
            answer_text (plain text or null), time_spent (seconds),
            auto_submitted (0|1)
```

`answer_text` is null when the candidate typed nothing before the timer expired.

### Questions and time limits

All questions and time constants live in `frontend/src/data/questions.js`:
- `SOFT_SKILLS` — 9 questions, `SOFT_TIME_LIMIT = 60` seconds
- `HARD_SKILLS` — 8 questions, `HARD_TIME_LIMIT = 60` seconds

To change questions or time limits, edit only this file.
