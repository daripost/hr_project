FROM node:20-alpine
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .
RUN mkdir -p /app/data
ENV DB_PATH=/app/data/assessments.db
EXPOSE 3001
CMD ["node", "server.js"]
