#!/bin/bash
echo "Starting HR Assessment Service..."

# Backend
cd "$(dirname "$0")/backend" && node server.js &
BACKEND_PID=$!
echo "Backend started (PID $BACKEND_PID) → http://localhost:3001"

# Frontend
cd "$(dirname "$0")/frontend" && npx vite &
FRONTEND_PID=$!
echo "Frontend started (PID $FRONTEND_PID) → http://localhost:3000"

echo ""
echo "Press Ctrl+C to stop both servers"

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT
wait
