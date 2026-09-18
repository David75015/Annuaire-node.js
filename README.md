# Annuaire Node.js — vCards

## Fonctionnement

Le formulaire envoie uniquement les champs `name`, `email` et `phone` au serveur.

Le serveur :
1. construit la vCard au format vCard 3.0 ;
2. la sauvegarde dans `documents/<Nom>.vcf` ;
3. ajoute le fichier à `sources/vcf-list.json` ;
4. enregistre le contact dans SQLite (`data/app.db`) ;
5. garde une sauvegarde JSON dans `sources/contacts.json`.

Les vCards générées utilisent la même structure générale que les cartes existantes :
`BEGIN:VCARD`, `VERSION:3.0`, `N`, `FN`, `ORG`, `TEL`, `EMAIL`, `END:VCARD`.

## Lancer

```bash
npm install
npm start
```

Puis ouvrir `http://localhost:3000`.

## Important

Le projet fourni est une application **Node.js + Express**, pas une application Next.js.  
La solution ci-dessus utilise SQLite côté serveur, ce qui évite de stocker les données uniquement dans le navigateur.
