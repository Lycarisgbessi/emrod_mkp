# Déploiement EMROD Marketplace

Guide complet pour mettre la plateforme en production. La base de données est
**PostgreSQL hébergé (Neon)** — plus aucun fichier SQLite n'est utilisé.

---

## 0. Prérequis

| Élément | Où l'obtenir |
|---|---|
| Base PostgreSQL | [neon.tech](https://neon.tech) → copier la chaîne `postgresql://…?sslmode=require` |
| Hébergement applicatif | Render (blueprint fourni), Railway, ou Docker anywhere |
| Secrets | `DATABASE_URL`, `JWT_SECRET` — **jamais dans le code source** |

> ⚠️ **Sécurité des identifiants** : quiconque possède `DATABASE_URL` peut se
> connecter à la base (y compris réclamer le compte admin au premier démarrage).
> Ne le partagez jamais, ne le commitez jamais. Si une URL a déjà circulé en
> clair (chat, mail, capture), **rotez le mot de passe** dans la console Neon
> (Roles &_PASSWORD → Reset password) avant la mise en production.

---

## 1. Variables d'environnement

| Variable | Obligatoire | Rôle |
|---|---|---|
| `DATABASE_URL` | ✅ | Chaîne PostgreSQL Neon (`sslmode=require`) |
| `JWT_SECRET` | ✅ | Clé de signature des sessions (64 hex recommandé : `openssl rand -hex 32`) |
| `NODE_ENV` | recommandé | `production` → sert le build `dist/` au lieu du middleware Vite |
| `PORT` | non | Port d'écoute (défaut 3000 ; Render/Railway l'injectent) |
| `PG_POOL_MAX` | non | Taille du pool PostgreSQL (défaut 5 ; Neon free = 5 max conseillé) |
| `PURGE_DEMO_DATA` | non | `true` = supprime le catalogue/commandes de démonstration au boot (idempotent) |
| `APP_URL` | non | URL publique pour le sitemap (défaut `https://emroddf.com`) |
| `SMTP_HOST/PORT/USER/PASS` | non | Envoi réel des courriels (sinon journalisés en base, table `email_log`) |
| `DJOMY_*` | prod paiements | Clés API Djomy ; sans clés = simulateur sandbox |

En local, ces valeurs vivent dans `.env` (ignoré par git — voir `.env.example`).

---

## 2. Option A — Render (blueprint fourni)

1. Pousser ce repo sur GitHub (branche `main`).
2. Render Dashboard → **New → Blueprint** → sélectionner le repo.
3. Render lit `render.yaml` et demande `DATABASE_URL` : coller la chaîne Neon.
   `JWT_SECRET` est généré automatiquement.
4. **Apply** → build `npm ci && npm run build`, démarrage `npm start`,
   health check sur `/api/health`.

Au premier boot, le serveur crée le schéma et les données de base sur Neon
(idempotent — les redémarrages ne dupliquent rien).

### Première connexion admin (first-run claim)

La plateforme n'a **pas de mot de passe admin par défaut** : la première
personne qui ouvre la page de connexion admin et réclame le compte définit le
mot de passe. Faites-le **immédiatement** après le déploiement.

### Passage en production « propre »

Mettre `PURGE_DEMO_DATA=true` une fois, redémarrer, puis remettre `false`.
Toutes les données vitrines (commandes, avis, payouts, produits Fouta fictifs,
coordonnées bancaires de démo) sont retirées ; le flag mémorise l'opération.

---

## 3. Option B — Railway / n'importe quel host Node

- Build : `npm ci && npm run build`
- Start : `npm start`
- Mêmes variables d'environnement que ci-dessus.

---

## 4. Option C — Docker

```bash
docker build -t emrod-marketplace .
docker run -d --name emrod \
  -p 3000:3000 \
  -e DATABASE_URL="postgresql://user:password@host/neondb?sslmode=require" \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e NODE_ENV=production \
  emrod-marketplace
```

Health check Docker intégré sur `/api/health`.

---

## 5. Vérifications post-déploiement

1. `GET /api/health` → `{"status":"ok"}` (base joignable).
2. Page d'accueil + catalogue rendus (build `dist/` servi).
3. Réclamer le compte admin, activer la 2FA si disponible.
4. Commander en sandbox (sans clés Djomy) pour valider le tunnel de paiement.
5. Configurer les clés Djomy **live** et refaire un paiement réel de contrôle.

## 6. Exploitation

- **Scale** : Neon scale-to-zero sur le plan free — la première requête après
  une pause peut prendre 1-2 s ; un plan compute always-on supprime la latence.
- **Migrations** : automatiques au boot (`initSchema` + `runMigrations`,
  idempotents). Aucune étape manuelle.
- **Backups** : activer les backups Neon (point-in-time restore) — la base
  contient les comptes, commandes et pièces KYC.
- **Logs** : audit applicatif en base (tables `audit_logs`, `email_log`,
  `security_events`) + logs stdout de l'hébergeur.
