# 📜 Journal des modifications — Cinécloud

Les changements notables de ce projet. Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).

## [2.4.5] — 2026-10-06

### Corrigé

- **Torbox : la lecture échouait même pour un torrent déjà en cache.** D'après la documentation officielle, `download_state` vaut **`cached`** pour un torrent présent sur les serveurs (et **`uploading`** pour un torrent en seed) — ces deux états sont lisibles immédiatement, y compris quand `progress` vaut 0 (rien à télécharger) et `download_finished` est absent. `isTorboxTorrentDownloaded` ne reconnaissait que `completed`/`progress===1`/`download_finished`, donc tout torrent en cache était jugé « pas prêt » puis supprimé → bascule. Les états `cached` et `uploading` sont désormais pris en compte.
- **`isTorboxTorrentReady`** : la liste d'exclusion est passée en correspondance par inclusion et enrichie (`stalled (no seeds)`, `queued`, `metaDL`, `checkingResumeData`), corrigeant l'affichage des torrents cloud non lisibles.

## [2.4.4] — 2026-10-06

### Changement

- **Les flux non instantanés (⏳ Téléchargement / 🔍 Vérif. au clic) sont désormais masqués par défaut.** Ils ne s'affichent que si l'utilisateur a coché l'option **« Téléchargement »** (`allowDownload`) dans sa configuration. Par défaut, seuls les flux **⚡ instantanés** (déjà en cache chez le débrideur) sont listés — cohérent avec le fait que, sans cette option, le résolveur ne pouvait pas les lancer (suppression immédiate du torrent non prêt).

## [2.4.3] — 2026-10-06

### Corrigé

- **Torbox + Prowlarr on-demand : aucun flux ne se lançait.** Le résolveur vérifiait une seule fois si un torrent fraîchement ajouté était `download_finished` ; sinon il le **supprimait immédiatement** et basculait vers un autre candidat. Or un torrent **déjà en cache** Torbox peut rester marqué « en téléchargement » 1 à 3 secondes après l'ajout. Le résolveur attend désormais une disponibilité certaine (fichiers peuplés + `download_finished`) dans un **budget borné** (8 re-vérifications espacées de 700 ms pour un torrent fraîchement ajouté), sans régression pour le chemin « torrent déjà présent » ni pour le mode _download_.

## [2.4.2] — 2026-10-06

### Corrigé

- **Clés AllDebrid générées « à la volée »** : `checkAllDebridKey` envoyait `agent=cinécloud` à `/v4/user`, ce qui amenait AllDebrid à **créer automatiquement une clé API** dans le compte de l'utilisateur à chaque validation (mécanisme documenté « certains logiciels tiers créent une clé »). Le paramètre `agent` est supprimé : la clé n'est plus transmise qu'en en-tête `Authorization`, et aucune clé n'est plus dupliquée. Les clés déjà créées restent supprimables manuellement sur `alldebrid.com/apikeys`.
- **« Le nouveau mot de passe doit comporter au moins 4 caractères »** alors qu'aucun changement n'était demandé : le champ vide est désormais omis côté client **et** accepté côté serveur.

### Refonte de l'interface

- **Thème dark « cinéma » modernisé** : palette unifiée, cartes/boutons/champs/tableaux harmonisés, responsive mobile-first, états de focus et accessibilité améliorés.
- **Page utilisateur** : fin de l'assistant multi-étapes → **formulaire unique à sections** (Débrideur, Profil & mot de passe, Préférences, Catalogues, Sources externes).
- **Panneau d'administration** : fin des onglets → **barre latérale de navigation** (drawer sur mobile).
- Aucun changement d'API ni de logique : toutes les fonctions JS et les identifiants DOM sont conservés.

## [2.4.1] — 2026-10-06

Dernière passe d'amélioration avant mise en pause du développement : sécurité, fiabilité du résolveur, interopérabilité AIOStreams et documentation.

### Sécurité

- **Assainissement du contenu d'embed administrateur** (`lib/sanitize.js`) : reconstruction par liste blanche close (ni `script`, `iframe`, `style`, `on*`, ni schéma `javascript:`), appliquée **à l'enregistrement et au rendu**. Ajout de la section **I** de `SECURITY.md`.
- **Jeton de session utilisateur** (`x-user-token`, 1 h, lié à l'UUID) : enregistrement des réglages **sans ressaisir le mot de passe**, tandis que les **clés API et le mot de passe** exigent toujours le mot de passe. Révocation automatique au changement de mot de passe. Ajout de la section **J** de `SECURITY.md`.
- **Jeton AllDebrid limité à l'en-tête** : suppression des clés API des URLs et durcissement des redirections (garde open-redirect).
- **Garde SSRF** (`lib/net-guard.js`) : autorise les services auto-hébergés, bloque link-local / métadonnées cloud / multicast, y compris après résolution DNS.
- `TRUST_PROXY` désactivé par défaut ; rate limiting par IP client restauré derrière un reverse proxy.

### Corrigé

- **Torbox — HTTP 422 sur `requestdl`** : l'API exige le token en **paramètre de requête** (l'en-tête seul est rejeté). Le corps d'erreur FastAPI est désormais extrait et journalisé, et l'URL CDN est refusée si elle contient la clé.
- **Boucles de résolution** : quarantaine automatique (10 min) des cibles mortes côté **AllDebrid** et **Torbox**, avec suppression de la cible de la liste des flux.
- **Magnets AllDebrid non prêts** : plus annoncés comme « ⚡ Instantané / Cloud » (`statusCode` 0-3 exclus), ce qui provoquait des échecs au clic.
- **Prowlarr** : l'instance du serveur n'est **plus empruntée** pour les recherches des utilisateurs (cause des « timeout » universels) ; budget borné et disjoncteur (3 échecs → pause 10 min) sur la recherche à la demande ; le réglage `prowlarrTimeoutMs` est **enfin appliqué**.
- **Tags Git** : migration des endpoints Torbox et élimination des clés API des URLs.

### Ajouté

- **Intégration Torrentio** : filtres (Taille, Seed, Langue, Résolutions) dans l'URL de manifest, lecture via **votre propre clé** AllDebrid/Torbox, egress WARP avec **diagnostic par tentative** (`proxy:403 • direct:403`) et choix de l'ordre (_Auto_ / _Direct d'abord_).
- **`behaviorHints` complet** sur chaque flux (`filename`, `videoSize`, `seeders`, `indexer`, `service`, `cached`) — nécessaire pour qu'AIOStreams parse correctement résolution, qualité, langue et statut de cache.
- **Manifeste** : ressources `meta`/`stream` déclarées en objets avec `idPrefixes` (+ champ global), supprimant l'avertissement AIOStreams « addon provides no idPrefixes ».
- **Personnalisation de la page publique** (admin) : embed HTML assaini, iframe en bac à sable, bouton Discord.
- **Exclusions intelligentes** : artefacts (`zip`, `rar`, `srt`, images, `sample`, `bonus`, `trailer`…) retirés de l'historique et du cloud ; détection des packs « COMPLETE / INTEGRALE / COFFRET / BATCH ».
- **Colonne « Prowlarr On-Demand »** dans **Admin → Utilisateurs** : ✅ configuré / ❌ non configuré, avec l'hôte de l'instance.
- **Optimisations du résolveur** : cache de résolution (10 min), cache des listes de fichiers par magnet, timeout AllDebrid réellement piloté par le réglage admin (`httpTimeoutMs`).
- **Documentation** : README restructuré (API, catalogues, dépannage, structure), `CHANGELOG.md`, sections `SECURITY.md`, `CONTRIBUTING.md` aligné sur les gardes CI.

### Infrastructure

- **CI** : actions mises à jour vers leurs versions **Node 24** (fin de l'avertissement « Node.js 20 is deprecated »), ajout des étapes **lint** et **format:check**, sérialisation des exécutions (`concurrency`) et plafonds de durée (`timeout-minutes`).

## [2.4.0] — 2026-09

- Validation stricte des entrées (Zod), CORS strict, en-têtes CSP, limites de taille de corps.
- Cache Prowlarr mutualisé, revalidation `is_instant`, tri des catalogues historique/cloud.
- Module animés (Anitomy + mapping Fribb), formateur de flux épuré, profils rapides et QR Code.

## [2.0.0] — 2026-08

- Première version publique : support AllDebrid + Torbox, Prowlarr, panneau d'administration, chiffrement des clés.
