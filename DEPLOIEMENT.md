# Déploiement EMROD Marketplace

Guide complet pour mettre la plateforme en production. La base de données est
**PostgreSQL hébergé (Neon)** — plus aucun fichier SQLite n'est utilisé.

---

## 0. Prérequis

| Élément | Où l'obtenir |
|---|---|
| Base PostgreSQL | [neon.tech](https://neon.tech) → copier la chaîne `postgresql://…?sslmode=require` |
| Hébergement applicatif | **Vercel** (recommandé, config fournie), Railway, Docker anywhere |
| Secrets | `DATABASE_URL`, `JWT_SECRET` — **jamais dans le code source** |

> ⚠️ **Sécurité des identifiants** : quiconque possède `DATABASE_URL` peut se
> connecter à la base (y compris réclamer le compte admin au premier démarrage).
> Ne le partagez jamais, ne le commitez jamais. Si une URL a déjà circulé en
> clair (chat, mail, capture), **rotez le mot de passe** dans la console Neon
> (Roles & Passwords → Reset password) avant la mise en production.

---

## 1. Variables d'environnement

| Variable | Obligatoire | Rôle |
|---|---|---|
| `DATABASE_URL` | ✅ | Chaîne PostgreSQL Neon (`sslmode=require`) |
| `JWT_SECRET` | ✅ | Clé de signature des sessions (64 hex recommandé : `openssl rand -hex 32`) |
| `PG_POOL_MAX` | recommandé | **`1` sur Vercel** (chaque instance serverless a son pool ; le pooler Neon fait le multiplexage). Défaut 5 ailleurs. |
| `NODE_ENV` | auto | `production` sur Vercel/Docker → sert le build `dist/` |
| `PURGE_DEMO_DATA` | non | `true` = supprime le catalogue/commandes de démonstration au prochain boot (idempotent, mémorisé) |
| `APP_URL` | recommandé | URL publique (sitemap SEO). Ex. `https://emrod-mkp.vercel.app` |
| `SMTP_HOST/PORT/USER/PASS` | non | Envoi réel des courriels (sinon journalisés en base, table `email_log`) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | non | Notifications push stables entre déploiements (sinon générées et stockées en base — fonctionne aussi) |
| `DJOMY_*` | prod paiements | Clés API Djomy ; sans clés = simulateur sandbox |

En local, ces valeurs vivent dans `.env` (ignoré par git — voir `.env.example`).

---

## 2. Option A — Vercel (config fournie : `vercel.json` + `api/`)

Le backend Express tourne en fonction serverless (`api/index.ts`) et le front
Vite est servi depuis le CDN Vercel (`dist/`).

1. Pousser ce repo sur GitHub (déjà fait : `emrod_mkp`, branche `main`).
2. Aller sur **vercel.com/new** → importer le repo `Lycarisgbessi/emrod_mkp`.
3. Dans **Environment Variables**, ajouter au minimum :
   - `DATABASE_URL` = chaîne Neon
   - `JWT_SECRET` = 64 hex
   - `PG_POOL_MAX` = `1`
   - `APP_URL` = l'URL finale du site
4. **Deploy**. La config `vercel.json` s'applique automatiquement :
   - build `npm run build` → statique `dist/` sur le CDN ;
   - `/api/*` et `/sitemap.xml` → fonction serverless (timeout 60 s) ;
   - tout le reste → SPA (`index.html`).

Vercel redéploie automatiquement à chaque push sur `main`.

### Comportement serverless à connaître

- **Cold start** : la première requête d'une instance initialise la connexion
  à la base (fast-path versionné : le schéma/seed ne se rejouent qu'une fois —
  flag `schema_ready` dans `platform_rules`; incrémenter `SCHEMA_VERSION` dans
  `server/db.ts` après toute évolution de schéma).
- **Filesystem read-only** : aucune écriture disque n'est faite par le serveur
  (KYC en base, push VAPID en base/env) — déjà compatible.
- **Neon scale-to-zero** : après une pause, la première requête peut prendre
  1-2 s de plus (réveil de la base). Un plan Neon always-on supprime la latence.

### Première connexion admin (first-run claim)

La plateforme n'a **pas de mot de passe admin par défaut** : la première
personne qui ouvre la page de connexion admin et réclame le compte définit le
mot de passe. Faites-le **immédiatement** après le déploiement.

### Passage en production « propre »

Mettre `PURGE_DEMO_DATA=true`, redéployer (une requête suffit à déclencher le
boot), puis remettre `false`. Les données vitrines (commandes, avis, payouts,
produits Fouta fictifs, coordonnées bancaires de démo) sont retirées.

### Alternative : CLI Vercel

```bash
npm i -g vercel
vercel login
vercel --prod        # lie le repo et déploie ; env vars via vercel env add
```

---

## 3. Option B — Docker (anywhere)

```bash
docker build -t emrod-marketplace .
docker run -d --name emrod \
  -p 3000:3000 \
  -e DATABASE_URL="postgresql://user:password@host/neondb?sslmode=require" \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e NODE_ENV=production \
  emrod-marketplace
```

Health check Docker intégré sur `/api/health`. Fonctionne aussi sur Railway,
Fly.io, une VPS, etc. ( Railway : build `npm ci && npm run build`, start
`npm start`, mêmes variables d'environnement.)

---

## 4. Vérifications post-déploiement

1. `GET /api/health` → `{"status":"ok"}` (base joignable).
2. Page d'accueil + catalogue rendus (build `dist/` servi).
3. Réclamer le compte admin, activer la 2FA si disponible.
4. Commander en sandbox (sans clés Djomy) pour valider le tunnel de paiement.
5. Configurer les clés Djomy **live** et refaire un paiement réel de contrôle.

## 5. Exploitation

- **Migrations** : automatiques au boot (`initDatabase`, idempotent + fast-path
  versionné). Aucune étape manuelle — incrémenter `SCHEMA_VERSION` si le
  schéma change.
- **Backups** : activer les backups Neon (point-in-time restore) — la base
  contient les comptes, commandes et pièces KYC.
- **Logs** : audit applicatif en base (tables `audit_logs`, `email_log`,
  `security_events`) + logs de la plateforme (Vercel → Deployments → Functions).
- **Domaine** : pointer le domaine personnalisé sur Vercel et renseigner
  `APP_URL` (sitemap SEO).
