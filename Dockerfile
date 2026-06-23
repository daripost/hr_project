# ── Stage 1: Build React frontend ─────────────────────────────────────────
FROM node:20-alpine AS frontend
WORKDIR /build
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Production backend + built frontend ───────────────────────────
FROM node:20-alpine
WORKDIR /app
COPY backend/package.json ./
RUN npm install --omit=dev
COPY backend/ ./
# Кладём собранный React в папку public — Express отдаёт как статику
COPY --from=frontend /build/dist ./public
RUN mkdir -p /data && chown -R node:node /app /data
USER node
ENV NODE_ENV=production
EXPOSE 10000
CMD ["node", "server.js"]
