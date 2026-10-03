# Guide de Contribution — CinéCloud FR

Merci de votre intérêt pour **CinéCloud FR** ! Ce projet open-source vise à offrir un addon Stremio & Nuvio haute performance, multi-utilisateurs, sécurisé et respectueux de la vie privée pour les services AllDebrid, Torbox et Prowlarr.

Toutes les contributions sont les bienvenues : signalements de bugs, améliorations de documentation, optimisations de performance ou nouvelles fonctionnalités.

---

## 1. Prérequis & Environnement de Développement

- **Node.js** : `>= 22.0.0` (testé et validé sous Node 24)
- **npm** : `>= 10.0.0`
- **Git**
- *(Optionnel)* **Docker** & **Docker Compose** pour tester l'environnement complet avec conteneur Cloudflare WARP et Prowlarr.

---

## 2. Installation Locale

1. **Cloner le dépôt :**
   ```bash
   git clone https://github.com/D4rk56/Cinecloud.git
   cd Cinecloud
   ```

2. **Créer le fichier d'environnement local :**
   ```bash
   cp .env.example .env
   ```
   *(Vous pouvez laisser les valeurs par défaut : les secrets et mots de passe d'administration sont auto-générés de façon sécurisée au démarrage).*

3. **Installer les dépendances :**
   ```bash
   npm install
   ```

4. **Démarrer le serveur en mode développement :**
   ```bash
   npm start
   ```
   L'addon sera accessible sur `http://localhost:3000` et le panneau d'administration sur `http://localhost:3000/admin`.

---

## 3. Architecture du Projet

```
nuvio-alldebrid/
├── index.js                  # Point d'entrée HTTP Express, routes Stremio, API et Admin
├── lib/
│   ├── admin-schemas.js      # Schémas de validation Zod pour l'API d'administration
│   ├── alldebrid.js          # Client AllDebrid (upload, streaming, statut, instantanéité)
│   ├── animeMapping.js       # Indexation mémoire O(1) de la table Fribb (Kitsu/IMDb/TMDB)
│   ├── animeParser.js        # Normalisation Romaji, fuzzy matching et parsing épisodes
│   ├── crypto.js             # Chiffrement AES-256-GCM, hachage scrypt et permissions 0600
│   ├── db.js                 # Persistance SQLite native, WAL checkpoint et requêtes préparées
│   ├── db-worker.js          # Worker thread pour les opérations DB lourdes en arrière-plan
│   ├── env.js                # Validation au démarrage fail-fast des variables d'environnement (Zod)
│   ├── helpers.js            # Normalisation des flux, regex titres, détection MULTi et langues
│   ├── logger.js             # Tampon circulaire mémoire de logs console pour l'admin UI
│   ├── prowlarr-worker.js    # Tâche d'arrière-plan de synchronisation RSS crowdsourcée
│   ├── resolver.js           # Résolveur lazy de flux vidéo, failover et sélection de fichier
│   ├── stremio.js            # Moteur de génération des manifests, catalogues et flux Stremio
│   ├── torbox.js             # Client Torbox (recherche cache, instantanéité, streaming)
│   └── ui.js                 # Interface web utilisateur et panneau d'administration HTML/CSS/JS
├── test/
│   └── addon.test.js         # Suite complète de tests unitaires et d'intégration (node:test)
├── .env.example              # Exemple complet et documenté des variables d'environnement
├── eslint.config.js          # Configuration moderne ESLint 9/10 (flat config)
└── .prettierrc               # Règles de formatage de code Prettier
```

---

## 4. Tests & Qualité de Code

Le projet applique des exigences de qualité strictes. Tout changement doit être validé par la suite de tests et respecter le linter.

### Lancer les tests unitaires et d'intégration
```bash
npm test
```
*ou directement avec Node.js :*
```bash
node --test test/addon.test.js
```
> [!NOTE]
> L'ensemble des 99+ tests existants doivent passer avec succès (`0 fail`, `0 error`).

### Vérifier le style avec ESLint
```bash
npm run lint
```

### Vérifier / Appliquer le formatage Prettier
```bash
# Vérifier la conformité du code
npm run format:check

# Appliquer le formatage automatique
npm run format
```

---

## 5. Règles de Contribution & Bonnes Pratiques

1. **Sécurité d'abord :**
   - Ne commitez **jamais** de fichiers contenant des secrets (`data/.app_secret`, `data/.admin_password`, `nuvio.db`, `.env`).
   - Toute nouvelle route d'administration doit être protégée par `requireAdmin` et validée avec un schéma Zod dédié dans `lib/admin-schemas.js`.
   - N'affichez jamais de clés API en clair dans les logs console ou réponses HTTP publiques.

2. **Performance :**
   - Évitez les appels bloquants synchrones dans les chemins critiques de streaming (`handleStream`, `handleResolve`).
   - Privilégiez les caches LRU en mémoire et les requêtes préparées SQLite existantes.

3. **Compatibilité Node.js 22 & 24 :**
   - Privilégiez les modules natifs Node.js (`node:crypto`, `node:fs`, `node:path`, `node:test`).
   - Assurez-vous que le code fonctionne de manière identique sous Linux (conteneur Docker) et sous Windows.

---

## 6. Processus de Pull Request (PR)

1. Créez une branche dédiée avec un nom explicite :
   ```bash
   git checkout -b feature/ma-fonctionnalite
   # ou
   git checkout -b fix/mon-correctif
   ```
2. Implémentez vos changements et ajoutez des tests correspondants dans `test/addon.test.js`.
3. Lancez `npm test` et `npm run lint` pour vous assurer qu'aucune régression n'est introduite.
4. Rédigez des messages de commit clairs et concis.
5. Ouvrez une Pull Request sur GitHub vers la branche `main` en décrivant le contexte, le problème résolu et les tests effectués.
