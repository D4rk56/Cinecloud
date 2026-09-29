# ☁️🎬 Nuvio Alldebrid Addon (Auto-hébergé)

Addon Alldebrid auto-hébergé pour **Nuvio**, conçu pour organiser votre bibliothèque Alldebrid et vous offrir une intégration fluide (films, séries, métadonnées et lecture directe).

L'application agit en tant que serveur relais local pour débrider les liens via votre propre IP résidentielle (évitant les blocages de datacenters de certains hébergeurs).

---

## 🛡️ Contournement des blocages IP Alldebrid (Cloudflare WARP)

Lorsque vous hébergez cet addon sur un **VPS ou serveur Cloud** (OVH, Hetzner, Scaleway, Oracle, AWS, etc.), **Alldebrid bloque ou restreint fréquemment les requêtes de débridage (`/link/unlock`)** car l'adresse IP provient d'un datacenter.

Pour résoudre ce problème de manière transparente :
- Un conteneur sidecar **Cloudflare WARP** (`caomingjun/warp`) est intégré dans nos fichiers Docker Compose.
- Il génère automatiquement un compte WARP gratuit au démarrage et achemine le trafic sortant de Nuvio via le réseau Cloudflare Edge avec une **adresse IP résidentielle/clean**, acceptée sans restriction par Alldebrid.
- **Zéro configuration manuelle requise.**

> [!TIP]
> **Vous hébergez sur votre machine personnelle / Box Internet (IP résidentielle) ?**  
> Vous n'avez pas besoin de WARP. Vous pouvez simplement commenter le service `warp` ainsi que la ligne `WARP_PROXY=http://warp:1080` dans votre fichier `docker-compose.yml` : l'application effectuera alors ses requêtes directement sans proxy.

---

## 📋 Prérequis

- **Docker & Docker Compose** (recommandé pour une installation simple et isolée)  
  *OU*
- **Node.js** (version 22 ou supérieure recommandée) et **npm**

---

## 🐳 Déploiement avec Docker Compose (Recommandé)

Deux modes de déploiement Docker Compose sont disponibles selon votre infrastructure réseau.

L'image est automatiquement compilée et publiée sur **GitHub Container Registry (GHCR)** :
`ghcr.io/d4rk56/nuvio-alldebrid:latest` *(compatible multi-architecture `linux/amd64` et `linux/arm64` pour Raspberry Pi / VPS ARM / Apple Silicon)*.

Vous pouvez au choix :
- **Utiliser l'image pré-compilée :** `docker compose pull nuvio && docker compose up -d`
- **Compiler localement les sources :** `docker compose up -d --build`

### Option 1 : Déploiement avec Cloudflare Tunnel & WARP (Accès distant sans ouvrir de port)

Ce mode lance :
1. **`warp`** : Le proxy Cloudflare WARP pour contourner les blocages Alldebrid.
2. **`nuvio`** : L'addon Nuvio Alldebrid (image GHCR ou build local).
3. **`tunnel`** : Un conteneur Cloudflare Tunnel éphémère (`trycloudflare.com`) pour accéder à l'addon depuis n'importe où (TV, smartphone) **sans ouvrir de port sur votre box / pare-feu**.

#### 1. Démarrer les services
```bash
docker compose up -d
```
*(ou `docker compose up -d --build` pour forcer la compilation locale)*

#### 2. Récupérer l'URL publique Cloudflare
Une fois les conteneurs démarrés, affichez les logs du tunnel pour récupérer votre URL sécurisée `https://xxxx.trycloudflare.com` :

- **Linux / macOS :**
  ```bash
  docker logs nuvio-tunnel 2>&1 | grep trycloudflare
  ```
- **Windows (PowerShell) :**
  ```powershell
  docker logs nuvio-tunnel 2>&1 | Select-String trycloudflare
  ```

#### 3. Vérifier le bon fonctionnement de Cloudflare WARP
```bash
docker logs nuvio-warp
```
Vous devriez voir `Status: Connected` et l'adresse de proxy prête sur le port 1080.

#### 4. Configurer l'addon
Ouvrez l'URL obtenue dans votre navigateur web pour accéder à l'interface de configuration, saisir votre clé API Alldebrid et installer le lien dans Nuvio.

#### 5. Arrêter les services
```bash
docker compose down
```

---

### Option 2 : Déploiement derrière un Reverse Proxy (avec WARP)

Si vous disposez déjà de votre propre nom de domaine et d'un Reverse Proxy (Nginx, Caddy, Traefik, Nginx Proxy Manager, SWAG, etc.), utilisez le fichier Compose dédié :

```bash
docker compose -f docker-compose.reverse-proxy.yml up -d --build
```

- **Sécurité :** Ce mode lie le port de l'addon exclusivement sur `127.0.0.1:3000` (localhost), empêchant toute exposition directe non filtrée sur Internet.
- **WARP inclus :** Vos requêtes vers Alldebrid continuent de bénéficier du bypass WARP.
- **Arrêt :**
  ```bash
  docker compose -f docker-compose.reverse-proxy.yml down
  ```

#### Exemples de configuration Reverse Proxy :

<details>
<summary><b>Exemple avec Nginx</b></summary>

```nginx
server {
    server_name nuvio.mondomaine.fr;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
</details>

<details>
<summary><b>Exemple avec Caddy</b></summary>

```caddy
nuvio.mondomaine.fr {
    reverse_proxy 127.0.0.1:3000
}
```
</details>

---

## 💾 Persistance des données (Volumes & Base SQLite)

- **`nuvio-data`** : Conserve la base de données SQLite embarquée (`/app/data/nuvio.db`). Grâce au mode **WAL (Write-Ahead Logging)**, l'accès au cache des correspondances IMDb/TMDB et classifications est instantané (`O(1)`), résistant aux pannes (transactions ACID, aucune corruption de fichier) et sans blocage de l'Event Loop.
  - *Migration automatique :* Si vous possédiez un ancien fichier `id-cache.json`, celui-ci est automatiquement migré vers SQLite au premier démarrage.
- **`nuvio-warp`** : Conserve l'enregistrement du compte WARP (`/var/lib/cloudflare-warp`) pour ne pas recréer de compte inutilement à chaque redémarrage.

---

## 💻 Déploiement classique (sans Docker)

Si vous préférez exécuter l'application directement avec Node.js :

1. **Installer les dépendances :**
   ```bash
   npm install --omit=dev
   ```

2. **Démarrer l'application :**
   ```bash
   npm start
   ```

3. **Accéder à l'addon :**
   Ouvrez [http://localhost:3000](http://localhost:3000) dans votre navigateur.

*(Optionnel) Si vous souhaitez utiliser un proxy avec le mode classique : définissez la variable d'environnement `WARP_PROXY` ou `HTTP_PROXY` (ex: `export WARP_PROXY=http://127.0.0.1:1080`) avant de lancer `npm start`.*

---

## 🔒 Bonnes pratiques de sécurité & Performance intégrées

- **Architecture Multi-Utilisateurs & Sécurité Zéro Fuite :** L'URL du manifeste n'expose plus vos clés API en clair dans le chemin (`/:uuid/manifest.json`). Vos identifiants sont chiffrés au repos en **AES-256-GCM** via une clé dérivée de `APP_SECRET`. La gestion des réglages est sécurisée par un hachage de mot de passe cryptographique (`crypto.scrypt`) et protégée contre la force brute (`express-rate-limit`).
- **Résolution de Flux "Lazy" avec Auto-Failover (< 5 ms) :** Les listes de flux Stremio sont construites instantanément en interrogeant les index locaux SQLite sans appel bloquant. La validation et le débridage se font à la volée lors de la lecture (`/resolve/:uuid/:imdbId/:fileRef`). Si un lien est mort (404/410), il est automatiquement purgé de la base et le meilleur candidat suivant prend le relais de manière transparente.
- **Découplage Prowlarr & Worker RSS :** Plus aucun appel Prowlarr synchrone ne ralentit la navigation. Un worker d'arrière-plan synchronise périodiquement les releases Newznab (catégories 2000/5000), vérifie l'instantanéité par lot auprès d'AllDebrid et alimente la table `cached_torrents`.
- **Isolation Stricte du Proxy WARP :** Le proxy WARP est strictement isolé pour les requêtes à `api.alldebrid.com`. Les appels à TMDB, Cinemeta, Torrentio et Prowlarr s'effectuent en accès direct, éliminant tout ralentissement ou log verbeux.
- **Base de données SQLite intégrée (`node:sqlite`) :** Mode WAL, normal synchronous et `busy_timeout=5000` pour une réactivité maximale et zéro corruption.
- **Utilisateur non-root (`node`) :** Le conteneur s'exécute sous le compte utilisateur restreint `node` (UID 1000) et non en tant que `root`.
- **Image minimale & moderne :** L'image Docker s'appuie sur `node:22-alpine` pour limiter la surface d'attaque et intégrer nativement SQLite sans dépendance de compilation C++.
- **Dépendances de production :** Seules les dépendances nécessaires au fonctionnement en production (`--omit=dev`) sont installées.
- **Healthcheck intégré :** Contrôle régulier de la santé des conteneurs via requêtes locales.
- **Isolation réseau :** Exclusion des fichiers sensibles (`.env`, logs) via `.dockerignore`.
