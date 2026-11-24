# EMROD Marketplace — Mobilier d'Exception

Marketplace de mobilier artisanal haut de gamme (Guinée) : React 19 + Tailwind 4 + PWA côté client, Express + SQLite (`node:sqlite`) côté serveur, paiements Djomy (Orange Money, MTN MoMo, Kulu, Soutra Money, PayCard).

Genéré via Google AI Studio : https://ai.studio/apps/cd8d0c6b-7a38-4477-8925-bfe1e5e8b438

## Run Locally

**Prerequisites:** Node.js 22+ (ou Bun 1.4+) — `node:sqlite` est requis.

1. Install dependencies:
   `bun install` (ou `npm install`)
2. Copiez `.env.example` vers `.env.local` et renseignez :
   - `GEMINI_API_KEY` — clé Gemini
   - `JWT_SECRET` — **obligatoire en production** (`openssl rand -hex 32`) ; sans lui le serveur refuse de démarrer en prod et utilise un secret éphémère en dev
   - `DJOMY_CLIENT_ID` / `DJOMY_CLIENT_SECRET` / `DJOMY_WEBHOOK_SECRET` — paiement Djomy (sans eux : simulateur sandbox local)
   - `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` — Web Push (sinon générées et **persistées en base** au premier démarrage)
   - `SEED_EMROD_ADMIN_PASSWORD`, `SEED_VENDOR_NIMBA_PASSWORD`, `SEED_VENDOR_FOUTA_PASSWORD` — mots de passe des comptes de démonstration (sinon générés aléatoirement et affichés une fois en console au premier démarrage)
3. Run the app:
   `bun run dev` (ou `npm run dev`)

## Tests & lint

- `bun run test` — tests métier (domaine partagé) + tests du provider Djomy
- `bun run lint` — typecheck TypeScript

## Notes de sécurité

- Les mots de passe ne sont jamais codés en dur : les comptes de démo reçoivent un mot de passe aléatoire imprimé en console au premier démarrage.
- `emrod.db`, `uploads/` et `dev-dist/` sont des données d'exécution : ne les versionnez jamais (déjà ignorés par `.gitignore`).
- Le callback `POST /api/payments/djomy/portal-complete` est réservé au simulateur sandbox ; en production, le statut des paiements provient uniquement du webhook signé Djomy ou d'une vérification serveur.
