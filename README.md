# ☁️🎬 Nuvio Alldebrid Addon (Auto-hébergé)

Addon Alldebrid auto-hébergé pour **Nuvio**, conçu pour organiser votre bibliothèque Alldebrid et vous offrir une intégration fluide (films, séries, métadonnées et lecture directe).

L'application agit en tant que serveur relais local pour débrider les liens via votre propre IP résidentielle (évitant les blocages de datacenters de certains hébergeurs).

---

## 📋 Prérequis

- **Docker & Docker Compose** (recommandé pour une installation simple et isolée)  
  *OU*
- **Node.js** (version 20 ou supérieure) et **npm**

---

## 🐳 Déploiement avec Docker Compose (Recommandé)

Deux modes de déploiement Docker Compose sont disponibles selon votre infrastructure réseau.

### Option 1 : Déploiement avec Cloudflare Tunnel (Accès distant sans ouvrir de port)

Ce mode lance à la fois l'addon Nuvio et un conteneur Cloudflare Tunnel éphémère (`trycloudflare.com`). Cela vous permet d'accéder à votre addon depuis vos appareils mobiles ou TV à l'extérieur de chez vous, **sans avoir à ouvrir de port sur votre box Internet**.

#### 1. Démarrer les services
```bash
docker compose up -d --build
```

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

#### 3. Configurer l'addon
Ouvrez l'URL obtenue dans votre navigateur web pour accéder à l'interface de configuration, saisir votre clé API Alldebrid et installer le lien dans Nuvio.

#### 4. Arrêter les services
```bash
docker compose down
```

---

### Option 2 : Déploiement derrière un Reverse Proxy (sans Cloudflare Tunnel)

Si vous disposez déjà de votre propre nom de domaine et d'un Reverse Proxy (Nginx, Caddy, Traefik, Nginx Proxy Manager, SWAG, etc.), utilisez le fichier Compose dédié :

```bash
docker compose -f docker-compose.reverse-proxy.yml up -d --build
```

- **Sécurité :** Ce mode lie le port de l'addon exclusivement sur `127.0.0.1:3000` (localhost), empêchant toute exposition directe non filtrée sur Internet.
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

## 💾 Persistance des données (Cache)

L'application met en cache les correspondances IMDb/TMDB dans le dossier `/app/data/id-cache.json`.  
Les fichiers `docker-compose*.yml` définissent automatiquement un volume persistant nommé `nuvio-data` pour conserver ce cache entre les redémarrages et les mises à jour des conteneurs.

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

---

## 🔒 Bonnes pratiques de sécurité intégrées

- **Utilisateur non-root (`node`) :** Le conteneur s'exécute sous le compte utilisateur restreint `node` (UID 1000) et non en tant que `root`.
- **Image minimale :** L'image Docker s'appuie sur `node:20-alpine` pour limiter la surface d'attaque et réduire la taille de l'image.
- **Dépendances de production :** Seules les dépendances nécessaires au fonctionnement en production (`--omit=dev`) sont installées.
- **Healthcheck intégré :** Contrôle régulier de la santé du conteneur via requêtes HTTP locales.
- **Isolation réseau :** Exclusion des fichiers sensibles (`.env`, logs) via `.dockerignore`.
