# Politique de Sécurité — CinéCloud FR

La sécurité et la confidentialité des utilisateurs de **CinéCloud FR** sont des priorités absolues. Ce document décrit notre politique de sécurité, les mesures architecturales mises en œuvre, et la procédure de signalement responsable de vulnérabilités.

---

## 1. Versions Supportées

Nous fournissons activement des correctifs de sécurité pour les versions suivantes :

| Version              | Statut                                                                    |
| :------------------- | :------------------------------------------------------------------------ |
| **2.4.x** (Actuelle) | :white_check_mark: Support actif (mises à jour de sécurité et correctifs) |
| **2.x**              | :white_check_mark: Support des correctifs critiques                       |
| **< 2.0**            | :x: Fin de vie (non supporté)                                             |

Nous encourageons l'ensemble des administrateurs d'instances à déployer la dernière version disponible (`ghcr.io/d4rk5/cinecloud:latest`).

---

## 2. Modèle de Menace & Protections Intégrées

CinéCloud FR est conçu selon le principe de **défense en profondeur** (_defense-in-depth_) :

### A. Chiffrement au repos des identifiants (AES-256-GCM)

- Les clés API tierces (AllDebrid, Torbox, Prowlarr) fournies par les utilisateurs ne sont **jamais stockées en clair** dans la base SQLite (`nuvio.db`).
- Elles sont systématiquement chiffrées avec **AES-256-GCM** avec vecteur d'initialisation unique (IV) et tag d'authentification cryptographique généré via l'API native `node:crypto`.
- La clé de chiffrement principale (`APP_SECRET`) est soit injectée par l'administrateur, soit auto-générée au premier démarrage dans `data/.app_secret` avec un caractère aléatoire cryptographique fort (32 octets).

### B. Durcissement des permissions de fichiers (0600 / ACL Windows)

- Les fichiers contenant des secrets critiques (`data/.app_secret` et `data/.admin_password`) sont protégés avec des permissions strictes :
  - **POSIX (Linux, Docker, macOS)** : permissions `0600` (`-rw-------`), accessibles uniquement par l'utilisateur du processus (non-root `node` en conteneur Docker).
  - **Windows** : permissions restreintes à l'utilisateur courant via `icacls` avec suppression de l'héritage d'accès.

### C. Validation stricte des entrées (Zod)

- Les variables d'environnement sont validées au démarrage (**fail-fast**) via `lib/env.js` afin d'empêcher tout démarrage avec des paramètres corrompus ou des secrets par défaut vulnérables.
- L'ensemble des routes d'administration (`/api/admin/*`) appliquent des schémas de validation stricts via **Zod** (`lib/admin-schemas.js`), prévenant les injections, les pollutions de paramètres et les données malformées.

### D. Protection contre les attaques temporelles (_Timing Attacks_)

- Les comparaisons de mots de passe administrateur et de hachages utilisateurs sont réalisées via `crypto.timingSafeEqual` pour empêcher l'analyse différentielle de temps de réponse.
- Le hachage des mots de passe utilisateurs utilise l'algorithme standard **scrypt** avec sel cryptographique aléatoire de 16 octets (`crypto.scryptSync`).

### E. Politique CORS stricte & Isolation des requêtes

- Les routes publiques Stremio (`/manifest.json`, `/catalog/*`, `/stream/*`) autorisent les clients Stremio Web et applications tierces.
- Les routes sensibles (`/api/*` et `/api/admin/*`) appliquent un contrôle d'origine strict (`Origin` / `Referer`) pour bloquer les requêtes de sites web tiers malveillants (_Cross-Site Request Forgery / CSRF_).

### F. Limitation de débit (_Rate Limiting_)

- Des limiteurs de débit dédiés (`express-rate-limit`) protègent les surfaces sensibles contre les attaques par force brute et par déni de service (DoS) :
  - Connexion administrateur (`authLimiter` : 30 tentatives / 15 min)
  - Sondes et vérifications de clés (`apiCheckLimiter` : 30 requêtes / min)
  - Résolution de flux (`resolveLimiter` : 60 requêtes / min)
  - Maintenance & actions admin (`adminActionLimiter` : 30 requêtes / min)

### G. Protection SSRF & confiance proxy

- Un garde-fou réseau dédié (`lib/net-guard.js`) protège les requêtes sortantes déclenchées par
  l'utilisateur. Il **autorise les adresses privées/loopback** (indispensables aux services
  auto-hébergés : `prowlarr:9696`, `host.docker.internal`, LAN, `127.0.0.1`) mais **bloque les
  cibles dangereuses** : link-local et métadonnées cloud (`169.254.0.0/16`, dont
  `169.254.169.254`), adresses non spécifiées, multicast et réservées — y compris après
  résolution DNS (anti DNS-rebinding). Il est appliqué aux sondes `/api/check/prowlarr` et
  `/api/check/lumio`, ainsi qu'à la validation des URL Prowlarr partagées.
- Pour les instances **exposées publiquement** (tunnel/Internet) où le test de connectivité
  Prowlarr n'est pas nécessaire à des tiers, il est recommandé de restreindre l'accès aux
  endpoints `/api/check/*` (reverse proxy, authentification amont) : ils permettent par nature
  de faire sonder un service interne à l'instance.
- La confiance accordée aux en-têtes `X-Forwarded-*` est désactivée par défaut (`TRUST_PROXY=false`) :
  `req.ip` correspond alors à l'adresse socket réelle, non falsifiable. Elle ne doit être activée
  (`TRUST_PROXY=1`) que derrière un reverse proxy / tunnel de confiance.

### H. Secrets dans les URLs : contrainte imposée par l'API Torbox

- Principe général : les clés API sont transmises en **en-tête** (`Authorization: Bearer …`) et
  **jamais** dans les URLs, afin d'éviter leur fuite via les journaux, proxys et historiques.
- **Exception documentée** : l'endpoint `GET /v1/api/torrents/requestdl` de Torbox **exige** le token
  en **paramètre de requête** (`?token=…`). Un appel avec le seul en-tête `Authorization` échoue en
  **HTTP 422** (`{"detail":[{"loc":["query","token"],"msg":"Field required"}]}`) — vérifié sur
  `api.torbox.app`. L'en-tête est donc envoyé en plus du paramètre, jamais à sa place.
- Mesures compensatoires appliquées : la requête vers l'API Torbox est **strictement côté serveur**
  (l'URL de requête et le token ne sont jamais journalisés dans les journaux du serveur, seuls le code
  HTTP et le message d'erreur de l'API le sont), et la redirection HTTP 302 vers le permalien CDN de
  streaming n'est transmise qu'au client Stremio authentifié configuré avec ce compte.

### I. Personnalisation de la page publique (embed admin) — anti-XSS

- L'administrateur peut publier un bloc de contenu sous le titre de la page d'accueil
  (`embedHtml`) ainsi qu'une iframe et un bouton Discord. Ce contenu étant affiché à **tous les
  visiteurs**, il est traité comme une entrée non fiable.
- `lib/sanitize.js` applique un assainissement **par reconstruction** : la chaîne fournie n'est
  **jamais réémise** telle quelle. Elle est tokenisée, filtrée par une **liste blanche close**, puis
  reconstruite — tout texte étant échappé.
  - Balises autorisées uniquement : `p, div, span, br, hr, strong, b, em, i, u, s, small, ul, ol, li,
blockquote, code, pre, h1…h6, figure, figcaption, table, thead, tbody, tr, td, th, a, img`.
    **Aucun** `script`, `iframe`, `object`, `embed`, `form`, `style`, `link`, `meta`, `base`, `svg`.
  - Attributs autorisés uniquement : `href`, `title` (liens) et `src`, `alt`, `title`, `width`,
    `height`, `loading` (images). **Aucun** `on*`, `style`, `class`, `id`, `srcset`.
  - Les URL sont validées **après décodage des références de caractères et suppression des caractères
    ignorés** (`&#106;avascript:`, `java&#9;script:`, casse mixte, attributs sans guillemets), afin
    qu'aucun schéma `javascript:` ou `data:` ne passe.
  - Les liens sortants sont forcés en `target="_blank" rel="noopener noreferrer nofollow"` et la
    sortie est **équilibrée** (aucune balise laissée ouverte).
- L'iframe éventuelle est **HTTPS uniquement** et rendue avec
  `sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"` +
  `referrerpolicy="no-referrer"` : origine isolée, pas d'accès au DOM parent ni aux cookies.
- Le bouton Discord n'accepte que les hôtes `discord.gg` / `discord.com` en HTTPS : le champ ne peut
  pas être détourné en redirection vers un site tiers.
- Le champ est borné (4000 caractères pour le HTML, 500 pour l'iframe, 200 pour Discord) et validé par
  Zod ; l'assainissement est appliqué **à l'enregistrement** (API admin) **et au rendu** (défense en
  profondeur, y compris pour une valeur écrite par un autre chemin).

### J. Jeton de session utilisateur (`x-user-token`)

- Le chargement d'une configuration (`POST /api/user/login`, UUID + mot de passe) délivre un
  **jeton de session** de 32 octets (`randomBytes`), conservé côté serveur dans une `Map` avec
  **expiration glissante de 1 heure** et purge périodique. Il évite de ressaisir le mot de passe
  à chaque enregistrement depuis `/configure`.
- **Portée volontairement limitée** : le jeton **n'autorise jamais** la modification des clés API
  (`apiKey`, `torboxApiKey`, `prowlarrKey`, `tmdbKey`) ni du mot de passe. Dès qu'un de ces champs
  change réellement (une valeur vide signifiant « conserver l'existant »), le mot de passe est
  exigé et la requête est refusée en **401** avec un message explicite.
- Le jeton est **lié à un UUID** (un jeton valide pour un compte ne fonctionne pas pour un autre),
  transmis via un **en-tête dédié** (jamais en URL, donc absent des journaux et des référents), et
  **révoqué immédiatement** lors d'un changement de mot de passe.
- Côté client, il est conservé dans `sessionStorage` (effacé à la fermeture de l'onglet, jamais
  partagé entre onglets) : en cas de vol via XSS, l'attaquant ne peut modifier que des réglages
  non sensibles, puisque les clés API restent protégées par le mot de passe.

### K. Aucune création automatique de clé AllDebrid

- La validation d'une clé (`checkAllDebridKey`) appelle `/v4/user` **sans le paramètre `agent`**.
  En effet, AllDebrid interprète `agent` comme une demande de **création automatique d'une clé API**
  dédiée dans le compte (cf. [Aide AllDebrid — gérer vos clés API](https://help.alldebrid.com/fr/faq/apikeys)),
  ce qui dupliquait une clé « cinécloud » à chaque vérification.
- La clé utilisateur n'est transmise **qu'en en-tête `Authorization: Bearer`** : aucune clé n'est
  jamais générée ni modifiée côté compte, et aucun secret ne transite en URL.

---

## 3. Signalement Responsable de Vulnérabilité

Si vous découvrez une faille de sécurité dans CinéCloud FR, **merci de ne pas ouvrir d'issue publique sur GitHub**.

### Procédure de signalement :

1. Utilisez les [Advisories de Sécurité GitHub](https://github.com/D4rk56/Cinecloud/security/advisories/new) pour soumettre un rapport privé et confidentiel.
2. Décrivez avec précision la vulnérabilité observée :
   - Type de vulnérabilité (ex: injection, fuite de mémoire, contournement d'authentification)
   - Étapes claires de reproduction (PoC / commande curl / script)
   - Impact potentiel estimé
3. **Engagements de l'équipe :**
   - **Accusé de réception sous 48 heures ouvrées**.
   - Analyse et échange direct pour convenir d'un correctif.
   - Publication coordonnée d'un avis de sécurité et d'une nouvelle version corrective sous forme de release taggée.
