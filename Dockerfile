# ─────────────────────────────────────────────────────────────────────────────
# EMROD Marketplace — image de production
# Build du front (Vite) puis runtime Node léger servant dist/ + API Express.
# La base de données est PostgreSQL externe (Neon) : DATABASE_URL obligatoire.
# ─────────────────────────────────────────────────────────────────────────────

# ── Étape 1 : build du frontend ─────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Étape 2 : runtime ───────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000

# tsx/vite restent en `dependencies` (server.ts importe vite au boot) :
# --omit=dev ne retire que les @types et l'outillage CSS.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY server.ts ./
COPY server ./server
# server/*.ts importe src/shared/* (domaine, schémas Zod, types)
COPY src ./src
COPY tsconfig.json ./

RUN mkdir -p uploads

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["npm", "start"]
