# Déploiement gratuit : Render + PostgreSQL externe

Cette version ne stocke plus les contacts, les vCards ou SQLite sur le disque de Render.
Les contacts et le contenu des vCards sont stockés dans PostgreSQL via `DATABASE_URL`.

## Pourquoi ?

Le disque local d'un service Render Free est éphémère. Cette version stocke donc toutes les données importantes dans PostgreSQL.

## Option recommandée à 0 € : Neon

1. Crée un compte Neon et un projet PostgreSQL gratuit.
2. Copie la chaîne de connexion PostgreSQL (`postgresql://...`).
3. Sur Render, crée un **Web Service** depuis ton dépôt GitHub.
4. Render détecte `render.yaml`.
5. Dans les variables d'environnement, ajoute :

   `DATABASE_URL` = ta chaîne de connexion Neon.

6. Déploie.

La table `contacts` est créée automatiquement au premier démarrage.
Les deux VCF présents dans `documents/` sont importés automatiquement dans PostgreSQL.

## Important sur les offres gratuites

- Render Free permet d'héberger le Web Service, mais son système de fichiers est éphémère.
- Render propose aussi un Postgres Free, mais sa documentation actuelle indique une expiration après 30 jours. Il n'est donc pas adapté si tu veux éviter toute migration au bout de 30 jours.
- Neon propose actuellement un plan Free PostgreSQL sans abonnement mensuel ; ses limites sont à respecter.

## Test local

Crée un fichier `.env` (ne le commit pas) :

```env
DATABASE_URL=postgresql://...
PORT=3000
```

Puis :

```bash
npm install
npm start
```

Ouvre `http://localhost:3000`.

## Fonctionnement

Formulaire → `POST /contacts` → PostgreSQL → génération de la vCard → `/api/vcf-list` → téléchargement via `/documents/:filename`.

Aucun fichier VCF utilisateur n'est écrit sur le disque Render.
