# SPÉCIFICATION — Centre de Commandement Administrateur EMROD (v2)

Objectif : l'administrateur dispose de **toutes** les données, statistiques, informations et contrôles
de la plateforme, y compris le **moteur de commissions** (pourcentage prélevé par la plateforme sur
chaque transaction).

Légende : **[OK]** existe déjà · **[+]** à ajouter (données déjà en base) · **[NEW]** nouveau moteur/à créer

---

## 1. 💰 MOTEUR DE COMMISSIONS & REVENUS PLATEFORME [NEW — cœur de la demande]

### 1.1 Configuration des commissions
| Élément | Détail |
|---|---|
| Commission globale par défaut | % appliqué à toutes les ventes (ex. 10 %) — modifiable en direct |
| Commission par atelier | Override par vendeur (contrat négocié) |
| Commission par catégorie | Override par catégorie (ex. prestige 12 %) — priorité : vendeur > catégorie > global |
| Base de calcul | Choix : sous-total produits HT frais de livraison (défaut) OU total TTC |
| Règles complémentaires | Commission minimale (GNF), arrondi, application ou non aux ventes sur devis |
| Snapshot | Le taux en vigueur est **figé sur la transaction** au moment du calcul (historique inaltérable) |
| Acomptes | Commission prélevée au prorata des montants **réellement encaissés** (acompte puis solde) |
| Virements bancaires | Commission calculée à la confirmation du virement |
| Remboursements | **Extourne automatique** de la commission au prorata du montant remboursé |

### 1.2 Grand livre des commissions (ledger)
| Élément | Détail |
|---|---|
| Journal ligne par ligne | Date, n° commande, vendeur, catégorie, brut GNF, taux appliqué, commission GNF, net vendeur, statut (due/encaissée/extournée), référence paiement Djomy |
| Détail par transaction | Décomposition visible depuis chaque paiement : brut → commission → net |
| Commissions dues vs perçues | Encours (commandes en cours) vs réalisées (commandes livrées/encaissées) |
| Impact remboursement | Ligne d'extournée rattachée à la ligne d'origine |

### 1.3 Rapports de revenus
| Rapport | Contenu |
|---|---|
| Revenu plateforme | CA commissions par jour/semaine/mois/trimestre/année + évolution N-1 |
| Par atelier | Commissions générées par vendeur, taux effectif moyen |
| Par catégorie | Commissions générées par catégorie |
| Projection | Encours de commissions à venir (commandes en fabrication) |
| Export comptable | CSV/Excel du journal filtré par période, total de contrôle |

### 1.4 Transparence vendeur
Le portail vendeur affiche sur chaque versement : brut, commission plateforme (taux + montant), net à percevoir.

---

## 2. 📊 TABLEAU DE BORD GÉNÉRAL (temps réel)

| Indicateur | Source |
|---|---|
| GMV (volume d'affaires brut) du jour/semaine/mois/année | orders **[+]** |
| Revenu net plateforme (commissions) période | commissions **[NEW]** |
| Encaissé réel Djomy (toutes transactions SUCCESS) | payments **[+]** |
| Remboursements (montant, nombre, taux) | payments refunded **[+]** |
| Commandes : total, par statut, en retard (âge > délai zone) | orders **[+]** |
| Panier moyen & médian | orders **[+]** |
| Taux d'annulation, taux de remboursement, taux d'échec paiement | orders/payments **[+]** |
| Vendeurs : validés, en attente KYC, suspendus, rejetés | users **[OK]** |
| Produits : publiés, en attente, retirés | products **[+]** |
| Litiges ouverts, messages signalés, avis en modération | disputes/messages/reviews **[OK]** |
| Devis : en cours par étape, convertis, valeur du pipe | quote_requests **[+]** |
| Abonnés push, acheteurs uniques (30 j), nouveaux acheteurs (30 j) | push_subscriptions/orders **[+]** |
| Comparaison période précédente (Δ % sur chaque KPI principal) | **[+]** |
| Graphiques : ventes 30 j (courbe), commandes par statut (donut), top 5 ateliers (barres), ventes par zone | **[+]** |
| Fil d'activité temps réel (dernières commandes/paiements/inscriptions) | **[+]** |

---

## 3. 💳 TRANSACTIONS & PAIEMENTS (tout ce qui circule)

| Donnée/Contrôle | Statut |
|---|---|
| Liste TOUTES transactions : référence Djomy, commande/devis, acheteur, vendeur(s), montant brut, commission, net, opérateur (Orange/MTN/Kulu/Soutra/PayCard/Carte/Virement), statut brut Djomy, frais Djomy, montant reçu, dates | **[+]** enrichi commissions |
| Filtres : période, statut, opérateur, vendeur, type (payment/payment_link/refund), plan (intégral/acompte/virement) | **[+]** |
| Détail transaction : payload webhook brut, événements de vie, réconciliation manuelle | **[OK]** |
| Totaux dynamiques sur sélection (Σ montants, Σ commissions, Σ frais) | **[+]** |
| Répartition par opérateur et par plan (parts %, montants) | **[+]** |
| Paiements en échec : taux, motifs, montant perdu | **[+]** |
| Actions : rembourser (partiel), réconcilier avec Djomy, rejouer un webhook | **[OK]** (+ partiel **[+]**) |
| Journal webhook_events complet avec statut de traitement | **[+]** |
| Diagnostics intégration : mode live/sandbox, clés configurées, URL de rappel | **[OK]** |

---

## 4. 📦 COMMANDES (gestion complète)

| Donnée/Contrôle | Statut |
|---|---|
| Liste exhaustive + recherche (n°, nom, email, téléphone) + filtres (statut, vendeur, plan, zone, montant min/max, période) + tri + pagination | **[+]** |
| Détail 360° : articles, timeline complète, paiements, messages, litige, avis, acheteur, adresses, **jeton de suivi + lien direct** | **[+]** |
| Changer le statut manuellement (override avec raison, journalisé) | **[+]** |
| Rembourser, annoter (notes internes), renvoyer l'e-mail de confirmation/suivi | **[+]** |
| Statuts par étape + âge moyen par étape + commandes bloquées (acompte non soldé, virement non déclaré) | **[+]** |
| Délai moyen commande → livrée (global et par atelier) | **[+]** |
| Export CSV/Excel complet filtré | **[OK]** (à enrichir des nouveaux champs) |

---

## 5. 🏪 VENDEURS / ATELIERS

| Donnée/Contrôle | Statut |
|---|---|
| Fiche atelier complète : identité, statut, historique statuts, documents KYC **avec visualisation**, conformité, badges | **[OK]** (+ visu **[+]**) |
| Vue **portrait complet** par atelier : CA brut, commissions générées, net perçu, panier moyen, note moyenne, délai de réponse, délai de fabrication moyen, taux d'annulation, litiges ouverts/historiques | **[+]** |
| Pipeline KYC : file d'attente, délai moyen de validation, taux de rejet, motifs | **[+]** |
| Actions : valider/rejeter/suspendre, badges (grant/revoke), **commission spécifique par atelier**, plafond produits personnalisé | **[+]** |
| Historique reversements complet + balance ( dû / versé ) | **[+]** |
| Top/flop ateliers par ventes, note, délais, annulations | **[+]** |
| Export CSV vendeurs | **[OK]** |

---

## 6. 🛍️ CATALOGUE & PRODUITS

| Donnée/Contrôle | Statut |
|---|---|
| Liste TOUS produits (tous statuts, tous vendeurs) + recherche + filtres + tri | **[+]** (actuellement par vendeur uniquement) |
| Statistiques par produit : vues, taux de conversion vue→vente, ventes, CA brut, commissions générées, stock restant, note | **[+]** |
| Produits les plus vus / plus vendus / mieux convertis / en rupture | **[+]** |
| Actions : publier/dépublier/modérer (existe **[OK]**), éditer n'importe quelle fiche, ajuster le featured | **[+]** |
| Santé catalogue : fiches sans media, descriptions courtes, prix anormaux | **[+]** |
| Répartition par catégorie (nombre, CA, commission) | **[+]** |
| Export CSV produits | **[OK]** |

---

## 7. 👤 ACHETEURS (CRM invités)

| Donnée/Contrôle | Statut |
|---|---|
| Base acheteurs consolidée (par email) : nom, téléphone, zone, nb commandes, CA total, date 1ʳᵉ/dernière commande, statut RGPD | **[+]** |
| Fiche acheteur : commandes, devis, avis, litiges, messages | **[+]** |
| Top acheteurs (CA, fréquence), taux de réachat (≥2 commandes) | **[+]** |
| Nouveaux vs récurrents par période | **[+]** |
| Actions : export, renvoyer un lien de suivi, demande RGPD (accès/suppression/anonymisation) | **[+]** |
| Liste noire acheteurs (annulations abusives, litiges répétés) — à valider juridiquement | **[+] optionnel** |

---

## 8. 📈 STATISTIQUES COMMERCIALES AVANCÉES

| Statistique | Détail |
|---|---|
| Entonnoir de conversion | vues produit → ajouts panier → checkouts → paiements réussis (taux par étape) **[+]** |
| Par période | Jour/semaine/mois/trimestre/année + comparaison N-1 + export **[+]** |
| Par catégorie / atelier / zone / produit | CA brut, commissions, panier moyen, nb commandes **[+]** |
| Par mode d'achat | Direct vs sur devis (parts, paniers moyens, délais) **[+]** |
| Par plan de règlement | Intégral / acompte (montants encaissés vs soldes en attente) / virement **[+]** |
| Saisonnalité | Heatmap ventes jour×heure, jour de semaine le plus fort **[+]** |
| Prix | Distribution des paniers, montants min/max/moyens **[+]** |
| Paiement mobile | Parts par opérateur guinéen, taux d'échec par opérateur **[+]** |

---

## 9. 🧭 DEVIS SUR MESURE (pipeline)

| Donnée/Contrôle | Statut |
|---|---|
| Liste complète + filtres par étape/atelier/valeur/période | **[+]** |
| Entonnoir : demandes → cotées → payées → livrées (taux de conversion, valeur à chaque étape) | **[+]** |
| Délais moyens : demande→coté, coté→payé, payé→livré | **[+]** |
| Valeur moyenne des devis acceptés vs refusés | **[+]** |
| Devis en souffrance (cotés non payés > X jours) | **[+]** |
| Taux d'acceptation par atelier | **[+]** |

---

## 10. 🚚 LIVRAISON & LOGISTIQUE

| Donnée/Contrôle | Statut |
|---|---|
| Livraisons par zone : volume, frais collectés, délai moyen réel vs estimé | **[+]** |
| Retraits atelier : part des commandes | **[+]** |
| Simulateur de tarif (existe **[OK]**) + gestion des zones/tarifs/paliers | **[OK]** |
| Commandes par zone avec statut (carte ou tableau) | **[+]** |

---

## 11. ⭐ AVIS & RÉPUTATION

| Donnée/Contrôle | Statut |
|---|---|
| Note moyenne plateforme + distribution (1→5) | **[+]** |
| Liste tous avis + modération publier/masquer | **[OK]** |
| Taux de réponse vendeurs, délai moyen de réponse | **[+]** |
| Avis signalés / litiges liés | **[+]** |
| Impact : corrélation note ↔ ventes par atelier | **[+]** |

---

## 12. 💬 MESSAGERIE & MODÉRATION

| Donnée/Contrôle | Statut |
|---|---|
| Signalements : file, motifs, décisions (masquer/rétablir/bannir l'auteur) | **[OK]** (à enrichir décision) |
| Vue superviseur des conversations (ordre/produit/devis) avec messages privés — pour arbitrage | **[+]** |
| Détection contournement plateforme : tentatives bloquées (journal) | **[+]** |

---

## 13. 💸 REVERSEMENTS VENDEURS (PAYOUTS)

| Donnée/Contrôle | Statut |
|---|---|
| Liste complète : vendeur, commande, brut, commission, **net**, référence, statut, dates | enrichi **[NEW]** |
| Balance par vendeur : total dû, versé, en attente | **[+]** |
| Actions : marquer versé (existe **[OK]**), versement partiel, note de virement | **[+]** |
| Cycle de versement : config (à la commande / à la livraison / différé X jours) | **[+]** |
| Relevé mensuel par atelier (récapitulatif brut/commission/net) exportable | **[+]** |

---

## 14. 🔔 NOTIFICATIONS & CAMPAGNES

| Donnée/Contrôle | Statut |
|---|---|
| Campagnes push : envoi, historique, taux de délivrance/ouverture/désabonnement | **[OK]** (taux ouverture **[+]**) |
| Base abonnés : push vs e-mail, par catégorie/région/fréquence | **[+]** |
| E-mails transactionnels : journal des envois (confirmation, devis), erreurs SMTP | **[+]** |
| Prévisualisation avant envoi, planification | **[+]** |

---

## 15. ⚖️ LITIGES & REMBOURSEMENTS

| Donnée/Contrôle | Statut |
|---|---|
| File des litiges : commande, acheteur, atelier, motif, âge | **[OK]** |
| Arbitrage : rembourser (avec extourne commission), rejeter, clôturer | **[OK]** + extourne **[NEW]** |
| SLA : litiges ouverts > 14 jours en alerte | **[+]** |
| Historique des remboursements + motifs + impact commission | **[+]** |

---

## 16. 🔐 RGPD & DONNÉES PERSONNELLES

| Donnée/Contrôle | Statut |
|---|---|
| Demandes d'accès/suppression : file, traitement, anonymisation | **[OK]** |
| Export des données d'un acheteur (commandes, messages, avis) en un fichier | **[+]** |
| Statistiques : demandes traitées, délai moyen | **[+]** |

---

## 17. 🛡️ SÉCURITÉ & SESSIONS

| Donnée/Contrôle | Statut |
|---|---|
| Journal d'audit complet (existe **[OK]**) + filtres avancés par acteur/action/cible/période + export | **[+]** |
| Sessions actives admin/vendeurs : liste, dernière activité, **révocation individuelle/globale** | **[+]** |
| Tentatives de connexion échouées (IP, cible, horodatage), lockouts | **[+]** |
| Rotation du JWT_SECRET (déconnexion globale planifiée) | **[+]** |
| Changement du passcode admin | **[+]** |
| Comptes administrateurs multiples + rôles (super-admin / opérateur lecture seule) | **[+] optionnel** |

---

## 18. ⚙️ CONFIGURATION PLATEFORME

| Donnée/Contrôle | Statut |
|---|---|
| Règles commerciales (inscription, modération, plafonds, acompte, seuil virement, jetons) | **[OK]** + **commission [NEW]** |
| Champs d'inscription dynamiques + pièces KYC exigées | **[OK]** |
| Badges & certifications (création, critères, effets) | **[OK]** |
| Catégories (restrictions, badges requis, tri) | **[OK]** |
| Zones & tarifs de livraison (fixe/paliers) | **[OK]** |
| Éditorial vitrine + textes légaux | **[OK]** |
| Mode maintenance (bannière + blocage commande) | **[+] optionnel** |

---

## 19. 📉 SEO & CONTENU

| Donnée/Contrôle | Statut |
|---|---|
| Produits les plus vus (semaine/mois) | **[+]** |
| Termes de recherche : top requêtes, requêtes **sans résultat** (opportunités catalogue) | **[+]** |
| CTR des suggestions de recherche accueil | **[+]** |
| Statut sitemap (URLs incluses, dernière génération) | **[+]** |

---

## 20. 🖨️ EXPORTS & RAPPORTS

| Export | Format |
|---|---|
| Commandes, produits, vendeurs | CSV **[OK]** → + Excel/JSON, filtres |
| Transactions, journal commissions, payouts, acheteurs, avis, litiges, audit | CSV/Excel **[+]** |
| Rapport périodique consolidé (CA, commissions, KPIs, top/flop) — mensuel | CSV/JSON **[+]** |
| Rapport comptable des commissions (total de contrôle signé) | CSV **[NEW]** |

---

## 21. 🩺 SANTÉ SYSTÈME & INTÉGRATIONS

| Donnée/Contrôle | Statut |
|---|---|
| Mode Djomy (live/sandbox), clés configurées, dernières erreurs API | **[OK]** |
| File webhooks : reçus, traités, rejetés (signature invalide) | **[+]** |
| Statut SMTP : configuré, derniers envois/erreurs | **[+]** |
| VAPID push : configuré (env vs base) | **[+]** |
| Base de données : taille (db+WAL), nombre de lignes par table, dernière sauvegarde | **[+]** |
| Uptime, version application/nœud, mémoire | **[+]** |
| Variables d'environnement actives (valeurs masquées) | **[+]** |

---

## 22. 🔎 PRINCIPES TRANSVERSES

1. **Toutes les listes** : recherche plein texte, filtres combinables, tri, pagination, total dynamique, export de la sélection.
2. **Tous les montants** affichés en GNF avec la ventilation **brut / commission / net** partout où un transactionnel apparaît.
3. **Toute action sensible** passe par le journal d'audit (avant/après, acteur, horodatage).
4. **Drill-down** : chaque KPI du tableau de bord est cliquable et mène à la liste filtrée correspondante.
5. **Rafraîchissement** : manuel + auto (30 s) sur le tableau de bord.
6. **Permissions** : à terme, rôles admin (lecture seule vs opérateur vs super-admin).

---

## Implémentation proposée (phases)

| Phase | Contenu | Effort |
|---|---|---|
| **P1 — Moteur de commissions** | Config (global/atelier/catégorie), calcul au webhook/virement, ledger `commissions`, extourne remboursement, ventilation partout (transactions, payouts, dashboard, portail vendeur), rapport/export comptable | Cœur |
| **P2 — Dashboard v2** | GMV, commissions, comparaisons périodes, graphiques, fil d'activité, drill-down | Moyen |
| **P3 — Vues opérationnelles** | Commandes 360° + filtres, produits global, acheteurs CRM, transactions enrichies, payouts enrichis | Moyen |
| **P4 — Statistiques avancées** | Conversion, devis pipeline, livraison, avis, SEO/recherches, saisons | Moyen |
| **P5 — Sécurité/système** | Sessions+révocation, échecs login, santé système, webhooks file, SMTP journal | Faible |
| **P6 — Optionnels** | Rôles multi-admins, mode maintenance, liste noire, rapport mensuel automatique | Faible |
