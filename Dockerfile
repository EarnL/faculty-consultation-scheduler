FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node . .
RUN mkdir -p /data/backups && chown -R node:node /data
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/scheduler.db SESSION_DB_PATH=/data/sessions.db BACKUP_DIR=/data/backups SEED_DEMO=false
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
