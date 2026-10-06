# ☁️🎬 Cinécloud

[![Docker Image](https://img.shields.io/badge/docker-ghcr.io%2Fd4rk56%2Fcinecloud-blue?logo=docker)](https://github.com/D4rk56/Cinecloud/pkgs/container/cinecloud)
[![Node Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen?logo=node.js)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Debrid](https://img.shields.io/badge/debrid-AllDebrid%20%7C%20Torbox-orange)](https://alldebrid.com)

**Cinécloud** est un addon auto-hébergé haute performance pour **Stremio** et **Nuvio**, spécialement conçu pour offrir une expérience de streaming fluide, instantanée et organisée.

Il unifie le débridage de vos comptes **AllDebrid** et **Torbox**, synchronise vos indexeurs **Prowlarr** en tâche de fond et à la demande, intègre un parseur spécialisé pour les **animés**, et offre une interface moderne avec profils en 1 clic et panneau d'administration en temps réel.

---

## ✨ Fonctionnalités Principales

### ⚡ Double Support Débrideur (AllDebrid & Torbox)

- **AllDebrid** : Intégration complète avec débridage instantané, flux Cloud personnels (_Mes Magnets_, _Liens Débridés_, _Historique_) et gestion du pré-cache.
- **Torbox** : Support complet avec vérification instantanée de disponibilité et lecture directe haute performance.
- **Résolveur Lazy intelligent** : Redirection 302 instantanée vers les flux CDN avec bascule automatique (failover) sur les miroirs disponibles.

### 🛡️ Contournement des Blocages IP VPS (Cloudflare WARP)

- Sur un serveur VPS ou Cloud (Hetzner, OVH, Scaleway, Oracle, etc.), les requêtes vers AllDebrid peuvent être restreintes en raison des IP de datacenters.
- Cinécloud intègre un conteneur sidecar **Cloudflare WARP** qui achemine les requêtes de débridage via une IP résidentielle/edge propre et acceptée sans restriction.
- Les requêtes Cinemeta, TMDB et le trafic de streaming vidéo direct restent acheminés hors proxy pour une vitesse maximale.

### 🔍 Indexation Prowlarr & Crowdsourcing Intelligent

- **Cache mutualisé SQLite (WAL)** : Tous les torrents indexés et vérifiés comme instantanément disponibles sont partagés entre utilisateurs selon le mode choisi (_Partagé_, _Local_ ou _Privé_).
- **Synchronisation RSS d'arrière-plan** : Alimentation continue des dernières sorties films et séries.
- **Recherche à la demande (On-Demand)** : Interrogation instantanée de **votre propre** Prowlarr lorsqu'un contenu n'est pas encore en cache.
  - **Chacun son instance** : l'instance Prowlarr du serveur (`.env`) sert **uniquement à la synchronisation RSS** qui alimente le cache partagé — elle n'est **jamais** utilisée pour les recherches des utilisateurs. Sans clé Prowlarr personnelle, vous bénéficiez du cache mutualisé, sans recherche à la demande.
  - **Budget borné** : une recherche à la demande ne dépasse jamais le réglage **Admin → Paramètres → « Budget d'une recherche Prowlarr à la demande »** (défaut 8 s), tentatives de repli comprises.
  - **Disjoncteur** : après 3 échecs consécutifs, l'instance est mise en pause 10 min (plus aucune requête) au lieu de ralentir chaque zap ; le compteur repart au premier succès.
- **Intégration Lumio** : Option pour enrichir les flux instantanés à la demande via votre manifest perso Lumio.
- **Intégration Torrentio** : Collez l'URL de manifest Torrentio **contenant vos filtres** (Taille, Seed, Langue, Résolutions) ; l'addon récupère les torrents en cache et lit avec **votre propre clé AllDebrid/Torbox** (le débridage doit rester désactivé côté Torrentio). Cloudflare renvoyant un **403** aux IP de serveur, le proxy **WARP** est utilisé automatiquement (repli direct), et une instance Torrentio **auto-hébergée** est également acceptée.
  - **Diagnostic** : en cas d'échec, le test affiche le résultat de **chaque tentative** (ex. `tentatives : proxy:403 • direct:403`) — vous savez immédiatement si c'est le proxy ou l'IP du serveur qui est bloqué.
  - **Choix de l'egress** : Admin → Paramètres permet de basculer entre _Auto_ (proxy/WARP puis IP du serveur) et _Direct d'abord_. Un proxy dédié peut être fourni via `TORRENTIO_PROXY` sans toucher au WARP utilisé par AllDebrid.
  - **Si les deux chemins sont bloqués** : hébergez votre propre instance Torrentio, placez un Cloudflare Worker en façade, ou utilisez une autre instance publique — le champ accepte n'importe quelle URL de manifest.

### 🎨 Personnalisation de la Page Publique (Admin)

- **Embed sous le titre** : un bloc de contenu (texte, liens, images, listes) affiché juste sous le titre de la page d'accueil, **entièrement configurable depuis l'admin**.
- **Iframe externe** (YouTube, widget…) : HTTPS uniquement, rendue en **bac à sable** (`sandbox`), chargement différé.
- **Bouton Discord** : lien vers votre communauté (`discord.gg` / `discord.com` uniquement), masqué tant qu'aucune URL n'est enregistrée.
- **Sécurité** : le HTML est **assaini par liste blanche** (aucun `script`, `iframe`, `style`, gestionnaire d'événements ni schéma `javascript:`), validé à l'enregistrement **et** au rendu — voir `SECURITY.md` § I.

### 🇯🇵 Module Spécialisé Animés (Anitomy & Mapping Fribb)

- **Extraction précise des métadonnées** via `@iktakahiro/anitomy-js` (titre épuré, saison, épisode, groupe de release, résolution, codec).
- **Mapping communautaire Fribb (`anime-lists`)** indexé en mémoire au démarrage pour une conversion instantanée `Kitsu` ↔ `IMDb` ↔ `TheTVDB` ↔ `TMDB`.
- **Fuzzy matching** et normalisation robuste pour réconcilier les numérotations absolues (ex. _Ep 35_) avec les saisons IMDb/TMDB (ex. _S02E11_).

### 🎨 Formateur de Flux Épuré & Lisible

- Format compact style AIOStreams en 2 colonnes :
  - **Gauche :** `[AD ⚡]` ou `[TB ⚡]` + Résolution (`4K ⭐`, `1080p ⭐`, etc.).
  - **Droite (4 lignes) :** statut (`⚡ IMMÉDIAT`, `⏳ TÉLÉCHARGEMENT`, `🔍 À VÉRIFIER`), titre propre, détails vidéo/audio fusionnés, langues (`🇫🇷` `🌐` `VOSTFR`) + source (`| YGG • FW`).

### 🔗 Utilisation derrière AIOStreams (et autres agrégateurs)

Les flux exposent un `behaviorHints` complet (`filename`, `videoSize`, `seeders`, `indexer`, `service`, `cached`) afin que les agrégateurs les **parsent correctement** (résolution, qualité, langue, taille) et les classent comme flux **débridés** avec leur statut de cache.

**Si rien ne s'affiche dans AIOStreams**, vérifiez dans cet ordre :

1. **Addons → Cinécloud → `Timeout`** : c'est le temps maximal accordé à l'addon. L'augmenter (ex. 20–30 s). Le journal admin affiche la latence réelle de chaque requête :
   `[Stream] movie/tt1375666 → 42 flux en 1840 ms`.
2. **Filters → Cache** : nos flux déclarent désormais `cached: true` (⚡ cache AllDebrid/Torbox, cloud personnel) ou `false` (« ⏳ Téléchargement », « 🔍 Vérif. au clic »). Ne pas exclure la catégorie _uncached_ si vous voulez les voir.
3. **Filters → Generic Stream Attributes** : un filtre **`Resolution` / `Language` / `Quality` en mode _Required_** est la cause la plus fréquente de disparition totale — vérifiez qu'il correspond bien à ce que vous cherchez.
4. **Filters → Result Limits / Deduplicator** : un dédoublonnage par `filename` trop agressif peut réduire la liste à un seul flux.
5. Rappel : les filtres de Cinécloud (résolutions, langues, taille) **et** ceux d'AIOStreams s'appliquent **tous les deux**.

### 📱 Configuration Ergonomique & Profils en 1 Clic

- **3 Profils Rapides en 1 clic** :
  - 📱 **Mobile 4G** : 1080p max, limitation de taille de fichier (~6 Go), économie de données.
  - 📺 **Smart TV** : 4K & 1080p équilibré, tri par qualité et disponibilité immédiate.
  - 🍿 **Home Cinéma** : 4K HDR/Dolby Vision en priorité, aucune limite de taille (Remux / Bitrate maximal).
- **QR Code dynamique** : Affichez un QR Code dans l'interface pour installer l'addon en un éclair sur votre TV ou smartphone.
- **Mise à jour sans réinstallation** : Modifiez vos réglages (langues, résolutions, tris) à tout moment grâce à votre UUID et mot de passe, sans réinstaller l'addon dans Stremio.

### 🛡️ Panneau d'Administration en Temps Réel (`/admin`)

- **Tableau de bord KPI** : Utilisateurs inscrits, actifs 24h, torrents en cache et **Taux de Disponibilité Instantanée (%)**.
- **Sondes de santé en direct** : Test instantané de latence et connectivité des APIs AllDebrid et Torbox.
- **Classement des Top Recherches** : Visualisation des titres les plus demandés avec filtre textuel en direct.
- **Gestion des comptes** : Recherche instantanée dans les utilisateurs et suppression en 1 clic.
- **Console de logs avancée** : Filtrage par niveau (`INFO`, `WARN`, `ERROR`), recherche textuelle instantanée, bouton pause du défilement et copie dans le presse-papiers.
- **Maintenance SQLite** : Purge des torrents expirés (+30j), optimisation (`VACUUM` / checkpoint WAL) et téléchargement de backup en 1 clic.

---

## 🚀 Déploiement Rapide avec Docker Compose

L'image officielle est disponible sur **GitHub Container Registry (GHCR)** :
`ghcr.io/d4rk56/cinecloud:latest` _(compatible architectures `linux/amd64` et `linux/arm64`)_.

### Option 1 : Déploiement avec Cloudflare Tunnel & WARP (Recommandé)

Ce mode lance :

1. **`warp`** : Proxy Cloudflare WARP pour contourner les blocages VPS.
2. **`cinecloud`** : L'addon Cinécloud.
3. **`tunnel`** : Cloudflare Tunnel éphémère (`trycloudflare.com`) pour un accès HTTPS sécurisé **sans ouvrir de port sur votre routeur**.

#### 1. Démarrer les services

```bash
docker compose up -d
```

#### 2. Récupérer l'URL sécurisée

Affichez les logs du tunnel pour récupérer votre URL `https://xxxx.trycloudflare.com` :

```bash
docker logs cinecloud-tunnel 2>&1 | grep trycloudflare
```

#### 3. Configurer vos accès

Ouvrez l'URL obtenue dans votre navigateur :

- Page de configuration : `https://xxxx.trycloudflare.com/`
- Panneau d'administration : `https://xxxx.trycloudflare.com/admin` (mot de passe auto-généré au premier démarrage, affiché dans les logs)

---

### Option 2 : Déploiement derrière un Reverse Proxy (Nginx, Traefik, Caddy)

Si vous possédez votre propre nom de domaine :

```bash
docker compose -f docker-compose.reverse-proxy.yml up -d
```

Ce mode lie le port de l'addon exclusivement sur `127.0.0.1:3000` (localhost) pour une sécurité maximale.

Exemple de bloc Nginx :

```nginx
server {
    server_name cinecloud.mondomaine.fr;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## ⚙️ Variables d'Environnement

| Variable         | Description                                                    | Valeur par défaut                    |
| :--------------- | :------------------------------------------------------------- | :----------------------------------- |
| `PORT`           | Port d'écoute HTTP du serveur                                  | `3000`                               |
| `NODE_ENV`       | Environnement d'exécution                                      | `production`                         |
| `TRUST_PROXY`    | Confiance aux en-têtes `X-Forwarded-*` (`true`/`false`/entier) | `false`                              |
| `WARP_PROXY`     | Adresse du proxy WARP sortant (HTTP ou SOCKS5)                 | `http://warp:1080`                   |
| `APP_SECRET`     | Clé secrète AES-256-GCM pour le chiffrement des données        | _Générée automatiquement si absente_ |
| `ADMIN_PASSWORD` | Mot de passe d'accès au panneau `/admin`                       | _Généré automatiquement si absent_   |
| `PROWLARR_URL`   | URL de votre instance Prowlarr globale (optionnel)             | `http://prowlarr:9696`               |
| `PROWLARR_KEY`   | Clé API de votre instance Prowlarr globale (optionnel)         | _Vide_                               |

> **Note** : les timeouts HTTP AllDebrid et Prowlarr ne se règlent **pas** par variable d'environnement mais depuis le panneau d'administration (`/admin` → Paramètres), puis enregistrés en base.

---

## 🛠️ Développement Local

```bash
# 1. Cloner le projet
git clone https://github.com/D4rk56/nuvio-alldebrid.git
cd nuvio-alldebrid

# 2. Installer les dépendances
npm install

# 3. Lancer les tests unitaires
npm test

# 4. Démarrer en développement
npm start
```

---

## 🔒 Sécurité & Confidentialité

- **Chiffrement AES-256-GCM** : Toutes les clés API AllDebrid et Torbox sont chiffrées au repos dans la base SQLite locale.
- **Hachage scrypt** : Les mots de passe utilisateurs sont hachés avec `crypto.scryptSync` (sel aléatoire de 16 octets, clé de 64 octets) et vérifiés en temps constant (`timingSafeEqual`).
- **Protection Rate-Limiting** : Protection contre les attaques par force brute sur `/api/user/login`, `/api/admin/login` et les requêtes manifestes.
- **Échappement XSS & Protection Injections** : Toutes les requêtes SQLite sont préparées (`db.prepare(...)`) et toutes les sorties HTML/logs sont strictement assainies.

---

## 📜 Licence

Ce projet est sous licence MIT. Distribué pour un usage personnel et auto-hébergé.
