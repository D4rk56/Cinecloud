# ☁️🎬 Cinécloud

**Addon de streaming haute performance pour Stremio et Nuvio** — débridage AllDebrid & Torbox, indexation Prowlarr (RSS + recherche à la demande), module animés, catalogues Cloud personnels et personnalisation complète depuis un panneau d'administration.

> Auto-hébergé, chiffré au repos, sans dépendance à un service tiers autre que les débrideurs que **vous** configurez.

---

## 📑 Sommaire

- [Prérequis](#-prérequis)
- [Fonctionnalités](#-fonctionnalités)
- [Démarrage rapide](#-démarrage-rapide)
- [Utilisation](#-utilisation)
- [Prowlarr : RSS partagé et recherche à la demande](#-prowlarr--rss-partagé-et-recherche-à-la-demande)
- [Sources externes : Torrentio & Lumio](#-sources-externes--torrentio--lumio)
- [Utilisation derrière AIOStreams](#-utilisation-derrière-aiostreams-et-autres-agrégateurs)
- [Panneau d'administration](#-panneau-dadministration-admin)
- [Référence API](#-référence-api)
- [Variables d'environnement](#-variables-denvironnement)
- [Dépannage & FAQ](#-dépannage--faq)
- [Structure du projet](#-structure-du-projet)
- [Sécurité](#-sécurité--confidentialité)
- [Développement](#-développement-local)
- [Licence](#-licence)

---

## 🧩 Prérequis

| Élément        | Détail                                                                             |
| :------------- | :--------------------------------------------------------------------------------- |
| **Runtime**    | Node.js **≥ 22** (testé sur 24) — ou Docker / Docker Compose                       |
| **Débrideur**  | Un compte **AllDebrid** et/ou **Torbox** (clé API)                                 |
| **Prowlarr**   | _Optionnel mais recommandé_ : votre propre instance pour la recherche à la demande |
| **Exposition** | Domaine **HTTPS** (Stremio desktop/mobile refusent HTTP pour une URL distante)     |

---

## ✨ Fonctionnalités

### ⚡ Double Support Débrideur (AllDebrid & Torbox)

- **AllDebrid** : débridage instantané, flux Cloud personnels (_Mes Magnets_, _Liens Débridés_, _Historique_) et pré-cache.
- **Torbox** : vérification instantanée de disponibilité et lecture directe haute performance.
- **Résolveur Lazy intelligent** : redirection 302 immédiate vers le flux CDN, avec bascule automatique (_failover_) sur un autre candidat du cache si la cible est morte.
  - **Seuls les magnets réellement prêts sont proposés** : un téléchargement en cours n'est plus annoncé comme « ⚡ Instantané / Cloud ».
  - **Quarantaine automatique (10 min)** : une cible qui échoue n'est plus réinterrogée, disparaît de la liste des flux, et le journal indique **la raison exacte**.
  - **Cache de résolution (10 min)** : un flux déjà résolu est servi instantanément, sans aucun appel au débrideur.

### 🛡️ Contournement des Blocages IP VPS (Cloudflare WARP)

- Côté serveur, un **proxy WARP** (ou tout proxy HTTP/SOCKS5) est utilisé pour AllDebrid, avec **repli direct automatique**.
- **Torrentio** profite du même mécanisme, avec un egress dédié optionnel (`TORRENTIO_PROXY`) et un **diagnostic par tentative** (`proxy:403 • direct:403`).

### 🔍 Indexation Prowlarr & Crowdsourcing Intelligent

- **Cache mutualisé SQLite (WAL)** : les torrents vérifiés comme instantanément disponibles sont partagés entre utilisateurs selon le mode choisi (_Partagé_, _Local_ ou _Privé_).
- **Synchronisation RSS d'arrière-plan** : alimentation continue du cache par le serveur (et les instances partagées), avec mise en pause automatique d'une instance en échecs répétés.
- **Recherche à la demande (On-Demand)** : interrogation de **votre propre** Prowlarr lorsqu'un contenu n'est pas encore en cache — voir la [section dédiée](#-prowlarr--rss-partagé-et-recherche-à-la-demande).
- **Budget borné** et **disjoncteur** : une recherche ne dépasse jamais le budget configuré, et une instance lente est mise en pause 10 min au lieu de ralentir chaque zap.

### 🎨 Personnalisation de la Page Publique (Admin)

- **Embed sous le titre** : bloc HTML (texte, liens, images, listes) affiché juste sous le titre de la page d'accueil, **entièrement configurable** depuis l'admin et **assaini par liste blanche** (aucun `script`, `iframe`, `style`, gestionnaire d'événements ni schéma `javascript:`).
- **Iframe externe** (YouTube, widget…) : HTTPS uniquement, rendue en **bac à sable** (`sandbox`), chargement différé.
- **Bouton Discord** : lien vers votre communauté (`discord.gg` / `discord.com` uniquement), masqué tant qu'aucune URL n'est enregistrée.

### 🇯🇵 Module Spécialisé Animés (Anitomy & Mapping Fribb)

- Extraction précise des métadonnées via `@iktakahiro/anitomy-js` (titre épuré, saison, épisode, groupe de release, résolution, codec).
- Correspondance **AniDB ↔ IMDb** par la table communautaire _Fribb anime-lists_ (indexée en mémoire au démarrage), catalogues animés dédiés.

### 🎨 Formateur de Flux Épuré & Lisible

- Format compact en 2 colonnes : badge de statut (`[AD ⚡]`, `[TB 🔍]`, `[AD ☁️]`) + résolution à gauche, puis 4 lignes à droite (statut normalisé, titre propre, détails vidéo/audio, langues et provenance).
- Chaque flux déclare un **`behaviorHints`** complet (`filename`, `videoSize`, `seeders`, `indexer`, `service`, `cached`) : indispensable pour que les agrégateurs (AIOStreams) parsent correctement résolution, qualité, langue et statut de cache.

### 📱 Configuration Ergonomique & Profils en 1 Clic

- **3 profils rapides** : 📱 Mobile 4G (1080p max, ~6 Go), 📺 Smart TV (4K/1080p équilibré), 🍿 Home Cinéma (4K HDR/DV sans limite).
- **QR Code dynamique** pour installer l'addon sur TV/mobile en un éclair.
- **Mise à jour sans réinstallation** : reconnectez-vous avec votre **UUID + mot de passe** pour modifier vos réglages.
- **Enregistrement sans ressaisie** : après un chargement de configuration, un **jeton de session (1 h)** permet d'enregistrer vos réglages non sensibles sans retaper le mot de passe — les **clés API et le mot de passe** restent protégés.

### 🛡️ Panneau d'Administration en Temps Réel (`/admin`)

- Statistiques d'usage, **utilisateurs** (avec état Prowlarr par utilisateur), **journal** filtrable, **paramètres runtime**, outils de maintenance et sauvegarde SQLite.

---

## 🚀 Démarrage rapide

### Option 1 : Docker Compose avec Cloudflare Tunnel & WARP (recommandé)

```bash
git clone https://github.com/D4rk56/Cinecloud.git
cd Cinecloud
cp .env.example .env      # puis ajustez si besoin
docker compose up -d
```

Le compose fournit : le serveur, un sidecar **WARP** (contournement VPS) et un **Cloudflare Tunnel** pour l'exposition HTTPS.

**Récupérer le mot de passe administrateur** (généré au premier démarrage s'il n'est pas défini) :

```bash
docker compose exec cinecloud cat data/.admin_password
```

**Configurer vos accès** : ouvrez `https://votre-domaine/` → créez un profil (mot de passe + clé AllDebrid/Torbox) → installez le manifeste dans Stremio. Le panneau d'administration est sur `https://votre-domaine/admin`.

### Option 2 : Reverse Proxy (Nginx, Traefik, Caddy)

Exposez le port `3000` derrière votre reverse proxy **en HTTPS**, et définissez `TRUST_PROXY=1` pour restaurer un _rate limiting_ par IP client (voir [Variables d'environnement](#-variables-denvironnement)).

---

## 📚 Utilisation

### Créer un profil

1. `https://votre-domaine/` → onglet **Nouveau Manifest / Profil**.
2. Renseignez un **pseudo**, un **mot de passe** (≥ 4 caractères) et votre **clé AllDebrid** et/ou **Torbox**.
3. Choisissez vos préférences : résolutions, langues (ordre de priorité), tri, taille maximale, nombre de flux, catalogues activés.
4. Installez le manifeste dans Stremio (bouton d'installation ou QR Code).

Le manifeste a la forme `https://votre-domaine/<uuid>/manifest.json`.

### Modifier un profil

Onglet **Gérer mon Profil / Manifest** → UUID + mot de passe → **Charger ma Configuration**. Vos réglages non sensibles peuvent ensuite être enregistrés sans retaper le mot de passe pendant 1 h (jeton de session). Modifier une **clé API** ou le **mot de passe** redemande explicitement le mot de passe.

### Catalogues fournis

| Catalogue                                       | Type         | Contenu                                   |
| :---------------------------------------------- | :----------- | :---------------------------------------- |
| Mes Liens Débridés ☁️ / Mes Séries Débridées 📺 | film / série | Liens débridés AllDebrid                  |
| Mon Historique 🕒 / Mon Historique Séries 🕒    | film / série | Historique de lecture                     |
| Mes Films Cloud ☁️ / Mes Séries Cloud 📺        | film / série | Fichiers présents dans votre cloud        |
| Mes Animés (Séries) 🇯🇵 / (Films) 🇯🇵             | série / film | Contenus animés détectés                  |
| Recommandations Films 🍿 / Séries 📺            | film / série | Suggestions basées sur votre bibliothèque |
| Recommandations Animés (Séries) 🇯🇵 / (Films) 🎌 | série / film | Suggestions animés                        |

Les artefacts (`.zip`, `.rar`, `.srt`, images, `sample`, `bonus`, `trailer`…) sont automatiquement exclus de l'historique et du cloud : **seuls les fichiers vidéo** sont proposés.

---

## 🔍 Prowlarr : RSS partagé et recherche à la demande

Le modèle est volontairement **double**, et c'est essentiel pour la performance :

| Usage                                                     | Instance utilisée                                                                                                       |
| :-------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------- |
| **Synchronisation RSS** (alimentation du cache mutualisé) | L'instance du serveur (`PROWLARR_URL` / `PROWLARR_KEY` dans `.env`) **et** les instances « partagées » des utilisateurs |
| **Recherche à la demande** (contenu non encore en cache)  | **Uniquement l'instance personnelle de l'utilisateur**                                                                  |

> ⚠️ **L'instance Prowlarr du serveur n'est jamais empruntée pour les recherches d'un utilisateur.** Sans clé Prowlarr personnelle, un utilisateur bénéficie exclusivement du **cache RSS mutualisé** — jamais d'une recherche faite en son nom sur l'instance du propriétaire (cela saturait l'instance et produisait des « timeout » pour tout le monde).

**Garde-fous de la recherche à la demande** :

- **Budget total** : réglable dans **Admin → Paramètres** (« Budget d'une recherche Prowlarr à la demande », défaut **8 000 ms**). Toutes les tentatives de repli (pack de saison, titre alternatif) partagent ce budget : une recherche ne peut pas le dépasser.
- **Disjoncteur** : après **3 échecs consécutifs**, l'instance est mise en pause **10 minutes** (plus aucune requête émise) ; le compteur repart au premier succès.
- **Journal** : chaque échec indique l'**hôte**, la **durée** et le compteur (`2/3 avant pause`).

Le mode choisi (`Partagé` / `Privé` / `Local`) ne conditionne que la **mise en cache commune** des résultats, jamais l'instance interrogée.

---

## 🔗 Sources externes : Torrentio & Lumio

### Torrentio

1. Configurez vos filtres (Taille, Seed, Langue, Résolutions) sur `https://torrentio.strem.fun/configure` et **laissez le débridage désactivé**.
2. Collez l'URL de manifest obtenue dans le champ **Torrentio** de votre profil.
3. L'addon récupère les torrents (`infoHash`) et lit avec **votre propre clé** AllDebrid/Torbox.

- **403 Cloudflare** : les IP de datacenter sont bloquées. Le proxy **WARP** est utilisé automatiquement (repli direct), et le test affiche **chaque tentative** (`proxy:403 • direct:403`).
- **Ordre des tentatives** réglable dans **Admin → Paramètres** (_Auto_ ou _Direct d'abord_).
- **Si les deux chemins sont bloqués** : hébergez votre propre instance Torrentio, placez un Cloudflare Worker en façade, ou utilisez une autre instance publique — le champ accepte n'importe quelle URL de manifest.

### Lumio

Collez l'URL de votre manifest `mylumio.tv` pour enrichir les flux instantanés à la demande (optionnel).

---

## 🔗 Utilisation derrière AIOStreams (et autres agrégateurs)

Les flux exposent un `behaviorHints` complet (`filename`, `videoSize`, `seeders`, `indexer`, `service`, `cached`) afin que les agrégateurs les **parsent correctement** (résolution, qualité, langue, taille) et les classent comme flux **débridés** avec leur statut de cache.

**Si rien ne s'affiche dans AIOStreams**, commencez par le **diagnostic officiel** d'AIOStreams :

> **Advanced Mode** (menu _About_) → **Miscellaneous → Display → Statistic Streams** : activez-le et sélectionnez `filter` dans _Statistics to Show_. Relancez une recherche : des flux-statistiques indiquent **quel filtre a retiré chaque résultat**.

Puis vérifiez, dans cet ordre :

1. **Filters → Stream Type** : piège n°1. Un filtre retirant `HTTP` (ou `P2P`/`Live`) élimine tout. **Sur une instance publique (ElfHosted), `P2P`, `HTTP` et `Live` sont désactivés de force** — nos flux déclarent `behaviorHints.service`/`cached`, ils sont donc classés **`debrid`** et ne sont pas concernés.
2. **Filters → Generic Stream Attributes** : filtre **`Language` en mode _Required_** (beaucoup de releases n'ont pas de tag de langue) ou `Resolution`/`Quality` _Required_ trop stricts.
3. **Filters → Cache** : nos flux déclarent `cached: true` (⚡ cache AllDebrid/Torbox, cloud personnel) ou `false` (« ⏳ Téléchargement », « 🔍 Vérif. au clic »). Ne pas exclure la catégorie _uncached_ si vous voulez les voir.
4. **Addons → Cinécloud → `Timeout`** : AIOStreams **attend tous les addons** avant de répondre ; un addon lent retarde tout. Le baisser (ex. 5 000 ms) et/ou l'augmenter selon votre tolérance. Le journal admin Cinécloud affiche la latence réelle de chaque requête :
   `[Stream] movie/tt1375666 → 42 flux en 1840 ms`.
5. **Filters → Result Limits / Deduplicator** : un dédoublonnage par `filename` trop agressif peut réduire la liste à un seul flux.
6. Rappel : les filtres de Cinécloud (résolutions, langues, taille) **et** ceux d'AIOStreams s'appliquent **tous les deux**.

**Après une mise à jour de Cinécloud, réinstallez/rafraîchissez l'addon dans AIOStreams.** AIOStreams **met en cache le manifeste** des addons (`manifestCache`, avec son propre TTL) : un redéploiement côté Cinécloud n'est pas vu immédiatement, et d'anciens avertissements (ex. `addon provides no idPrefixes`) peuvent subsister alors que le manifeste servi est déjà corrigé. Pour vérifier ce que Cinécloud expose réellement :

```bash
curl -s https://votre-domaine/<uuid>/manifest.json | jq '.resources'
# "meta" et "stream" doivent contenir un tableau "idPrefixes" non vide
```

---

## 🛡️ Panneau d'Administration (`/admin`)

| Onglet           | Contenu                                                                                                                                                     |
| :--------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Statistiques** | Utilisateurs inscrits, actifs sur 24 h, état des services, top des recherches                                                                               |
| **Utilisateurs** | Liste (UUID, pseudo, **mode Prowlarr**, **Prowlarr on-demand : ✅ configuré / ❌ non configuré** + hôte), tri et suppression                                |
| **Journal**      | Logs en direct (INFO/WARN/ERROR), recherche, pause, copie, purge                                                                                            |
| **Paramètres**   | Budget Prowlarr à la demande, **timeout HTTP AllDebrid**, TTL du cache, **personnalisation de la page publique** (embed, iframe, Discord), egress Torrentio |
| **Maintenance**  | Cycle RSS forcé, purge des torrents expirés, `VACUUM`/WAL, sauvegarde SQLite, nettoyage des magnets bloqués, vidage ciblé du cache                          |

> Le panneau est protégé par `ADMIN_PASSWORD` (généré automatiquement au premier démarrage, voir `data/.admin_password`). Les sessions administrateur durent 8 h.

---

## 🔌 Référence API

### Addon (protocole Stremio)

| Route                                    | Description                                                                                          |
| :--------------------------------------- | :--------------------------------------------------------------------------------------------------- |
| `GET /:uuid/manifest.json`               | Manifeste de l'addon (`resources` objets avec `idPrefixes`, `catalogs`, `logo`, `background`)        |
| `GET /:uuid/stream/:type/:id.json`       | Flux (`movie`, `series`, `anime` / `tt…`, `kitsu:…`, `tt…:s:e`)                                      |
| `GET /:uuid/meta/:type/:id.json`         | Métadonnées (y compris les identifiants internes `ad_cloud:`, `ad_link:`, `ad_series:`, `tb_cloud:`) |
| `GET /:uuid/catalog/:type/:id.json`      | Catalogues (voir la table des catalogues)                                                            |
| `GET /resolve/:userRef/:imdbId/:fileRef` | Résolution _lazy_ : `302` vers le flux CDN du débrideur                                              |

### Utilisateur

| Route                                                                           | Auth                                       | Description                                                                                          |
| :------------------------------------------------------------------------------ | :----------------------------------------- | :--------------------------------------------------------------------------------------------------- |
| `POST /api/user/register`                                                       | —                                          | Crée un profil (mot de passe + clés) et renvoie son **UUID**                                         |
| `POST /api/user/login`                                                          | mot de passe                               | Charge la configuration, **délivre un jeton de session** (`sessionToken`, 1 h)                       |
| `POST /api/user/update`                                                         | mot de passe **ou** en-tête `x-user-token` | Met à jour les réglages. Le **jeton** ne suffit pas pour modifier une **clé API** ou le mot de passe |
| `POST /api/user/delete`                                                         | mot de passe                               | Supprime définitivement le profil et ses données                                                     |
| `POST /api/user/cleanup-magnets`                                                | mot de passe                               | Purge les magnets bloqués côté AllDebrid                                                             |
| `POST /api/check/alldebrid` · `/torbox` · `/prowlarr` · `/lumio` · `/torrentio` | —                                          | Tests de connectivité (garde SSRF, _rate limit_ 30/min)                                              |
| `POST /api/check/tmdb`                                                          | —                                          | Validation d'une clé TMDB                                                                            |
| `GET /api/stats`                                                                | —                                          | Statistiques publiques (inscrits, actifs 24 h)                                                       |

### Administrateur (en-tête `x-admin-token`)

| Route                                                                          | Description                                                                                       |
| :----------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------ |
| `POST /api/admin/login`                                                        | Authentification (mot de passe admin) → jeton valable **8 h**                                     |
| `GET /api/admin/stats` · `/logs` · `/users`                                    | Statistiques, journal filtrable, utilisateurs (**avec statut Prowlarr**)                          |
| `GET`/`POST /api/admin/settings`                                               | Lecture / mise à jour des paramètres runtime (validation Zod + assainissement du contenu d'embed) |
| `POST /api/admin/logs/clear` · `/cache/clear` · `/cleanup-magnets`             | Purge du journal, vidage ciblé du cache, nettoyage des magnets                                    |
| `POST /api/admin/prowlarr/sync` · `/torrents/purge` · `/db/vacuum` · `/backup` | Cycle RSS forcé, purge des torrents expirés, optimisation SQLite, sauvegarde                      |

---

## ⚙️ Variables d'Environnement

| Variable                     | Description                                                                                              | Défaut                               |
| :--------------------------- | :------------------------------------------------------------------------------------------------------- | :----------------------------------- |
| `NODE_ENV`                   | Environnement d'exécution (`production`, `development`, `test`)                                          | `production`                         |
| `PORT`                       | Port d'écoute HTTP                                                                                       | `3000`                               |
| `CORS_ALLOWED_ORIGINS`       | Origines supplémentaires autorisées pour `/api` (séparées par des virgules)                              | _vide_                               |
| `TRUST_PROXY`                | Confiance aux en-têtes `X-Forwarded-*` (`true`/`false`/entier) — à activer **derrière** un reverse proxy | `false`                              |
| `APP_SECRET`                 | Clé de chiffrement **AES-256-GCM** des clés API stockées en base                                         | _généré dans `data/.app_secret`_     |
| `ADMIN_PASSWORD`             | Mot de passe du panneau `/admin`                                                                         | _généré dans `data/.admin_password`_ |
| `WARP_PROXY`                 | Proxy sortant (HTTP/SOCKS5) pour AllDebrid **et** Torrentio                                              | `http://warp:1080`                   |
| `HTTP_PROXY` / `HTTPS_PROXY` | Proxies de sortie standards (repli si `WARP_PROXY` est absent)                                           | _vide_                               |
| `TORRENTIO_PROXY`            | Proxy **dédié** à Torrentio, prioritaire sur `WARP_PROXY`                                                | _vide_                               |
| `PROWLARR_URL`               | Instance Prowlarr du serveur (RSS + usage du propriétaire)                                               | `http://prowlarr:9696`               |
| `PROWLARR_KEY`               | Clé API de l'instance du serveur (`off` ou vide = aucun RSS global)                                      | _vide_                               |
| `ALLDEBRID_API_KEY`          | Clé AllDebrid globale optionnelle (maintenance, nettoyage des magnets)                                   | _vide_                               |
| `TORBOX_API_KEY`             | Clé Torbox globale optionnelle                                                                           | _vide_                               |
| `TMDB_API_KEY`               | Clé TMDB optionnelle (métadonnées et affiches)                                                           | _fallback public_                    |

> **Note** : les tolérances réseau se règlent aussi depuis **`/admin` → Paramètres** et sont enregistrées en base : **budget d'une recherche Prowlarr à la demande** (`prowlarrTimeoutMs`) et **timeout des requêtes AllDebrid** (`httpTimeoutMs`). Ces deux réglages sont réellement appliqués.

---

## 🩺 Dépannage & FAQ

### Aucun flux ne s'affiche

1. Vérifiez que votre clé AllDebrid/Torbox est valide (`Tester` dans le formulaire).
2. Vérifiez vos **filtres** : résolutions sélectionnées, `hideUnknownLanguages`, taille maximale — ils s'appliquent aussi aux flux cloud.
3. Derrière AIOStreams, suivez la [procédure dédiée](#-utilisation-derrière-aiostreams-et-autres-agrégateurs) (filtres + cache de manifeste).

### « Flux indisponible » au clic

La cible a échoué (magnet supprimé, ou pas encore prêt). Elle est **mise en quarantaine 10 minutes** et retirée de la liste : rafraîchissez Stremio pour choisir une autre version. Le journal admin indique la raison exacte (`0 fichier (magnet non prêt ou supprimé)`, `aucun fichier vidéo exploitable`…).

### La recherche Prowlarr ne donne rien pour un utilisateur

C'est **attendu** si l'utilisateur n'a pas configuré **sa propre** instance : il ne dispose alors que du cache RSS mutualisé. Vérifiez la colonne **« Prowlarr On-Demand »** dans **Admin → Utilisateurs** (✅ configuré / ❌ non configuré), et le journal (`Échec sur <hôte> après <ms>`).

### Les flux sont lents à apparaître

- Côté Cinécloud : le journal affiche la latence (`[Stream] … en X ms`). La recherche Prowlarr est bornée par son budget ; une instance en échecs répétés est mise en pause.
- Côté AIOStreams : l'agrégateur attend **tous** les addons ; réduisez le `Timeout` par addon.

### Torrentio renvoie 403

Blocage Cloudflare des IP de datacenter. Vérifiez `WARP_PROXY` (conteneur `warp` démarré), essayez « Direct d'abord » dans **Admin → Paramètres**, ou branchez un egress dédié via `TORRENTIO_PROXY`. En dernier recours, hébergez votre instance Torrentio.

### Stremio refuse de se connecter (« Failed to fetch »)

Stremio desktop/mobile exigent **HTTPS** pour une URL distante. Utilisez un tunnel/reverse proxy TLS, puis réinstallez l'addon avec l'URL `https://`.

---

## 🗂️ Structure du projet

```
Cinecloud/
├── index.js                  # Serveur Express : routes addon, API utilisateur & admin
├── lib/
│   ├── stremio.js            # Manifeste, catalogue, meta, construction des flux
│   ├── resolver.js           # Résolution lazy (/resolve) : AllDebrid & Torbox
│   ├── alldebrid.js          # Client AllDebrid, WARP, instant-cache, quarantaine
│   ├── torbox.js             # Client Torbox, disponibilité, quarantaine
│   ├── prowlarr-worker.js    # RSS, crowdsourcing, recherche à la demande (budget + disjoncteur)
│   ├── helpers.js            # Formatage des flux, parsing titres/animés, filtrage
│   ├── ui.js                 # Pages publiques et panneau d'administration
│   ├── db.js                 # SQLite (node:sqlite) : utilisateurs, cache, réglages
│   ├── net-guard.js          # Garde SSRF des requêtes sortantes
│   ├── sanitize.js           # Assainissement du HTML d'embed (anti-XSS)
│   ├── crypto.js             # AES-256-GCM, scrypt, permissions de fichiers
│   ├── env.js                # Validation fail-fast des variables d'environnement
│   ├── logger.js             # Journal circulaire exposé dans l'admin
│   └── admin-schemas.js      # Schémas Zod (API utilisateur & admin)
├── test/                     # node:test (addon, format des flux, sécurité)
├── data/                     # SQLite + secrets générés (non versionné)
└── docker-compose.yml        # Serveur + WARP + Cloudflare Tunnel
```

---

## 🔒 Sécurité & Confidentialité

- **Chiffrement AES-256-GCM** : les clés API sont chiffrées au repos dans la base SQLite locale.
- **Hachage scrypt** : les mots de passe sont hachés (`scryptSync`, sel 16 o, clé 64 o) et vérifiés en temps constant (`timingSafeEqual`).
- **Jetons** : sessions admin (8 h) et jetons utilisateur (1 h, liés à l'UUID, en-tête dédié, **jamais en URL**) ; le jeton utilisateur ne permet **jamais** de modifier une clé API ou le mot de passe.
- **Anti-XSS** : le contenu d'embed saisi par l'admin est assaini **par reconstruction** (liste blanche close), à l'enregistrement **et** au rendu ; les iframes sont en bac à sable ; le bouton Discord n'accepte que les hôtes Discord.
- **Anti-SSRF** : `lib/net-guard.js` bloque les cibles dangereuses (link-local, métadonnées cloud, multicast…) tout en autorisant les services auto-hébergés, y compris après résolution DNS.
- **Rate limiting** sur les routes sensibles (authentification, vérifications API, résolution).
- **CORS strict**, validation **Zod** de toutes les entrées, requêtes SQLite préparées.
- Détails complets et procédure de signalement : **[SECURITY.md](SECURITY.md)**.

---

## 🛠️ Développement Local

```bash
# 1. Cloner le projet
git clone https://github.com/D4rk56/Cinecloud.git
cd Cinecloud

# 2. Installer les dépendances
npm install

# 3. Lancer les tests unitaires
npm test

# 4. Vérifier le lint et le formatage (exigés par le CI)
npm run lint
npm run format:check     # corriger avec: npm run format

# 5. Démarrer
npm start
```

Le CI (`.github/workflows/docker-publish.yml`) exécute **les tests, ESLint (0 erreur) et `prettier --check`**, puis publie l'image multi-arch sur GHCR.

Contributions : voir **[CONTRIBUTING.md](CONTRIBUTING.md)**. Historique des correctifs : **[CHANGELOG.md](CHANGELOG.md)**.

---

## 📜 Licence

Ce projet est sous licence MIT. Distribué pour un usage personnel et auto-hébergé.
