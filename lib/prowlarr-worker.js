"use strict";

const axios = require("axios");
const { upsertCachedTorrent, getCachedTorrentsByImdb, getSharedProwlarrInstances, db } = require("./db");
const { checkInstantMagnets } = require("./alldebrid");
const { extractCleanTitle, parseSeasonEpisode, searchCinemeta } = require("./helpers");

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

let workerTimer = null;
let isSyncing = false;
const failedProwlarrInstances = new Map();

function isLocalOrPrivateUrl(urlStr) {
    if (!urlStr) return true;
    try {
        const parsed = new URL(urlStr);
        const h = parsed.hostname.toLowerCase();
        if (h === "localhost" || h === "127.0.0.1" || h === "::1") return true;
        if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
        if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
        const match172 = h.match(/^172\.(\d{1,2})\.\d{1,3}\.\d{1,3}$/);
        if (match172) {
            const second = parseInt(match172[1], 10);
            if (second >= 16 && second <= 31) return true;
        }
        return false;
    } catch (e) {
        return true;
    }
}

async function checkProwlarrConnectivity(url, key) {
    if (!url || !key) return { success: false, error: "URL et clé API Prowlarr requises" };
    const cleanUrl = url.trim().replace(/\/+$/, "");
    try {
        const res = await axios.get(`${cleanUrl}/api/v1/system/status`, {
            headers: {
                "User-Agent": BROWSER_UA,
                "Accept": "application/json",
                "X-Api-Key": key.trim()
            },
            timeout: 5000
        });
        if (res.status === 200 && res.data) {
            return {
                success: true,
                version: res.data.version || "Connecté",
                appName: res.data.appName || "Prowlarr",
                instanceName: res.data.instanceName || "Prowlarr"
            };
        }
        return { success: false, error: `Statut HTTP ${res.status}` };
    } catch (err) {
        return {
            success: false,
            error: err.response ? `HTTP ${err.response.status}` : err.message
        };
    }
}

// Cache en mémoire pour éviter d'interroger plusieurs fois les mêmes titres
const imdbResolutionCache = new Map();

async function resolveReleaseImdbId(title, isSeriesHint = false) {
    if (!title) return null;
    const isSeries = Boolean(isSeriesHint || parseSeasonEpisode(title));
    const { title: clean, year } = extractCleanTitle(title);
    if (!clean || clean.length < 2) return null;
    const cacheKey = `${isSeries ? "series" : "movie"}_${clean.toLowerCase()}_${year || ""}`;
    if (imdbResolutionCache.has(cacheKey)) {
        return imdbResolutionCache.get(cacheKey);
    }
    const primaryType = isSeries ? "series" : "movie";
    const fallbackType = isSeries ? "movie" : "series";
    try {
        const cin1 = await searchCinemeta(clean, primaryType);
        if (cin1 && cin1.imdbId) {
            imdbResolutionCache.set(cacheKey, cin1.imdbId);
            return cin1.imdbId;
        }
        const cin2 = await searchCinemeta(clean, fallbackType);
        if (cin2 && cin2.imdbId) {
            imdbResolutionCache.set(cacheKey, cin2.imdbId);
            return cin2.imdbId;
        }
    } catch (e) {}
    imdbResolutionCache.set(cacheKey, null);
    return null;
}

/**
 * Récupère une clé API AllDebrid pour le worker (depuis l'environnement ou le premier utilisateur enregistré)
 */
function getWorkerAlldebridKey() {
    if (process.env.ALLDEBRID_API_KEY && process.env.ALLDEBRID_API_KEY.trim() !== "") {
        return process.env.ALLDEBRID_API_KEY.trim();
    }
    try {
        const { decryptConfig } = require("./crypto");
        const row = db.prepare("SELECT config_encrypted FROM users ORDER BY created_at ASC LIMIT 1").get();
        if (row && row.config_encrypted) {
            const config = decryptConfig(row.config_encrypted);
            if (config && config.apiKey) return config.apiKey;
        }
    } catch (e) {
        // Aucun utilisateur ou table users vide
    }
    return null;
}

/**
 * Synchronise les catégories Movies (2000) et TV (5000) depuis une instance Prowlarr
 */
async function syncProwlarrReleases(prowlarrUrl, prowlarrKey, instanceLabel = "Prowlarr") {
    try {
        const cleanUrl = prowlarrUrl.replace(/\/+$/, "");
        console.log(`[Prowlarr Worker] Sync RSS pour [${instanceLabel}] (${cleanUrl})...`);

        // Requête REST directe vers l'API de recherche Newznab/Torznab de Prowlarr
        const endpoint = `${cleanUrl}/api/v1/search?categories=2000&categories=5000&limit=100&apikey=${prowlarrKey}`;
        const res = await axios.get(endpoint, {
            headers: {
                "User-Agent": BROWSER_UA,
                "Accept": "application/json",
                "X-Api-Key": prowlarrKey
            },
            timeout: 15000
        });

        const releases = Array.isArray(res.data) ? res.data : [];
        if (releases.length === 0) {
            console.log(`[Prowlarr Worker] Aucune nouvelle release trouvée sur [${instanceLabel}].`);
            return true;
        }

        // Filtre les releases ayant un infoHash valide (40 caractères hexadécimaux)
        const validReleases = releases.filter(r => r.infoHash && /^[0-9a-fA-F]{40}$/.test(r.infoHash));
        const hashes = [...new Set(validReleases.map(r => r.infoHash.toLowerCase()))];

        if (hashes.length === 0) {
            return true;
        }

        // Vérification par lot d'instantanéité auprès d'AllDebrid
        const adKey = getWorkerAlldebridKey();
        let instantMap = {};
        if (adKey) {
            instantMap = await checkInstantMagnets(hashes, adKey);
        }

        let savedCount = 0;
        let imdbMappedCount = 0;

        for (const rel of validReleases) {
            const hash = rel.infoHash.toLowerCase();
            const isInstant = adKey ? Boolean(instantMap[hash]) : true;

            // Extraction de l'IMDb id si fourni par Prowlarr, sinon résolution par titre
            let imdbId = null;
            if (rel.imdbId && String(rel.imdbId) !== "0") {
                imdbId = String(rel.imdbId).startsWith("tt") ? String(rel.imdbId) : `tt${String(rel.imdbId).padStart(7, "0")}`;
            }

            const titleToParse = rel.fileName || rel.title || "";
            const se = parseSeasonEpisode(titleToParse);

            const isTvCategory = (Array.isArray(rel.categories) && rel.categories.some(c => (typeof c === "object" ? (c.id >= 5000 && c.id < 6000) : (Number(c) >= 5000 && Number(c) < 6000)))) ||
                (typeof rel.category === "number" && rel.category >= 5000 && rel.category < 6000);
            const isSeriesRelease = Boolean(se || isTvCategory);

            if (!imdbId && titleToParse) {
                const resolvedBase = await resolveReleaseImdbId(titleToParse, isSeriesRelease);
                if (resolvedBase) {
                    imdbId = se ? `${resolvedBase}:${se.season}:${se.episode}` : resolvedBase;
                }
            } else if (imdbId && se && !imdbId.includes(":")) {
                imdbId = `${imdbId}:${se.season}:${se.episode}`;
            }

            if (imdbId) imdbMappedCount++;

            upsertCachedTorrent({
                infoHash: hash,
                imdbId: imdbId,
                title: rel.title || "Release Prowlarr",
                filename: titleToParse,
                size: rel.size || 0,
                indexer: rel.indexer || "Prowlarr",
                seeders: rel.seeders || 0,
                isInstant: isInstant
            });
            if (isInstant) savedCount++;
        }

        console.log(`[Prowlarr Worker] Sync [${instanceLabel}] terminée avec succès : ${validReleases.length} releases analysées (${imdbMappedCount} associées à un ID IMDb, ${savedCount} instantanées).`);
        return true;
    } catch (err) {
        console.warn(`[Prowlarr Worker] Erreur sync [${instanceLabel}] :`, err.response ? `HTTP ${err.response.status}` : err.message);
        return false;
    }
}

/**
 * Synchronisation globale échelonnée (staggered) sur l'ensemble des instances Prowlarr partagées
 */
async function syncAllSharedProwlarrInstances() {
    if (isSyncing) return;
    isSyncing = true;
    try {
        const instances = getSharedProwlarrInstances();
        if (instances.length === 0) {
            console.log("[Prowlarr Worker] Aucune instance Prowlarr partagée active pour la synchronisation.");
            return;
        }

        console.log(`[Prowlarr Worker] Début du cycle RSS crowdsourcing sur ${instances.length} instance(s)...`);
        for (let i = 0; i < instances.length; i++) {
            const inst = instances[i];
            const now = Date.now();
            const failInfo = failedProwlarrInstances.get(inst.url);
            if (failInfo && failInfo.failCount >= 3 && (now - failInfo.lastFail < 60 * 60 * 1000)) {
                console.log(`[Prowlarr Worker] Instance "${inst.pseudo}" (${inst.url}) en pause suite à échecs répétés.`);
                continue;
            }

            // Pause décalée de 25s entre deux instances
            if (i > 0) {
                await new Promise(r => setTimeout(r, 25000));
            }

            const ok = await syncProwlarrReleases(inst.url, inst.key, inst.pseudo);
            if (ok) {
                failedProwlarrInstances.delete(inst.url);
            } else {
                const count = (failInfo ? failInfo.failCount : 0) + 1;
                failedProwlarrInstances.set(inst.url, { failCount: count, lastFail: now });
            }
        }
    } catch (err) {
        console.warn("[Prowlarr Worker] Erreur globale lors du cycle RSS crowdsourcing :", err.message);
    } finally {
        isSyncing = false;
    }
}

/**
 * Récupère une configuration de secours si besoin
 */
function getWorkerProwlarrConfig() {
    let url = process.env.PROWLARR_URL || "http://prowlarr:9696";
    let key = process.env.PROWLARR_KEY;
    if (!key || key.trim() === "" || key === "off") {
        try {
            const { decryptConfig } = require("./crypto");
            const row = db.prepare("SELECT config_encrypted FROM users WHERE prowlarr_mode != 'local' ORDER BY created_at ASC LIMIT 1").get();
            if (row && row.config_encrypted) {
                const config = decryptConfig(row.config_encrypted);
                if (config && config.prowlarrKey && config.prowlarrKey !== "off") {
                    key = config.prowlarrKey;
                    if (config.prowlarrUrl && config.prowlarrUrl.trim()) {
                        url = config.prowlarrUrl.trim();
                    }
                }
            }
        } catch (e) {}
    }
    return { url, key };
}

/**
 * Initialise le worker en tâche de fond si au moins une instance est configurée
 */
function startProwlarrWorker() {
    const instances = getSharedProwlarrInstances();

    if (instances.length === 0) {
        console.log("[Prowlarr Worker] Inactif (aucune instance Prowlarr partagée configurée). L'addon fonctionne en mode cache local et Torrentio.");
        return;
    }

    console.log(`[Prowlarr Worker] Démarrage du cycle de synchronisation périodique crowdsourcing (${instances.length} instance(s), intervalle: 15 min)...`);

    // Premier déclenchement différé de 5s
    setTimeout(() => {
        syncAllSharedProwlarrInstances();
    }, 5000);

    // Planification récurrente
    workerTimer = setInterval(() => {
        syncAllSharedProwlarrInstances();
    }, SYNC_INTERVAL_MS);

    if (workerTimer && workerTimer.unref) {
        workerTimer.unref();
    }
}

function stopProwlarrWorker() {
    if (workerTimer) {
        clearInterval(workerTimer);
        workerTimer = null;
    }
}

/**
 * Recherche à la demande sur Prowlarr pour un film ou un épisode de série
 */
async function searchProwlarrOnDemand({ id, type, cleanTitle, season, episode, prowlarrUrl, prowlarrKey, prowlarrMode = "shared", apiKey }) {
    if (prowlarrMode === "local") {
        return [];
    }

    let effectiveKey = prowlarrKey;
    let effectiveUrl = prowlarrUrl;

    if (!effectiveKey || effectiveKey === "off" || effectiveKey.trim() === "") {
        // En mode shared, chercher dans les instances partagées
        const shared = getSharedProwlarrInstances();
        if (shared.length > 0) {
            effectiveKey = shared[0].key;
            effectiveUrl = shared[0].url;
        } else {
            const workerConfig = getWorkerProwlarrConfig();
            effectiveKey = workerConfig.key;
            if (!effectiveUrl) effectiveUrl = workerConfig.url;
        }
    }

    if (!effectiveKey || effectiveKey === "off" || effectiveKey.trim() === "") return [];
    if (!cleanTitle || cleanTitle.trim().length < 2) return [];

    const cleanUrl = (effectiveUrl || "http://prowlarr:9696").replace(/\/+$/, "");
    const isSeries = type === "series" || Boolean(id && id.includes(":"));
    const category = isSeries ? 5000 : 2000;

    // Nettoyage de la ponctuation (les deux-points et apostrophes bloquent souvent la recherche Prowlarr)
    const sanitizedTitle = cleanTitle.replace(/[:’'\/\\#&]/g, " ").replace(/\s+/g, " ").trim();
    let searchQuery = sanitizedTitle;
    if (isSeries && season !== undefined && !isNaN(season) && episode !== undefined && !isNaN(episode)) {
        const sStr = String(season).padStart(2, "0");
        const eStr = String(episode).padStart(2, "0");
        searchQuery = `${sanitizedTitle} S${sStr}E${eStr}`;
    }

    try {
        console.log(`[Prowlarr On-Demand] Recherche pour "${searchQuery}" (${isSeries ? "TV" : "Movie"}) [Mode: ${prowlarrMode}]...`);
        const endpoint = `${cleanUrl}/api/v1/search?query=${encodeURIComponent(searchQuery)}&categories=${category}&type=search&apikey=${effectiveKey}`;
        const prowlarrHeaders = {
            "User-Agent": BROWSER_UA,
            "Accept": "application/json",
            "X-Api-Key": effectiveKey
        };

        const res = await axios.get(endpoint, {
            headers: prowlarrHeaders,
            timeout: 8000
        });

        let releases = Array.isArray(res.data) ? res.data : [];

        // Si aucun résultat pour SxxExx précis sur une série, tentative avec le pack de saison complet (Sxx)
        if (isSeries && releases.length === 0 && season !== undefined && !isNaN(season)) {
            const sStr = String(season).padStart(2, "0");
            const seasonEndpoint = `${cleanUrl}/api/v1/search?query=${encodeURIComponent(`${sanitizedTitle} S${sStr}`)}&categories=${category}&type=search&apikey=${effectiveKey}`;
            const seasonRes = await axios.get(seasonEndpoint, {
                headers: prowlarrHeaders,
                timeout: 6000
            }).catch(() => null);
            if (seasonRes && Array.isArray(seasonRes.data)) {
                releases = seasonRes.data;
            }
        }

        if (releases.length === 0) {
            console.log(`[Prowlarr On-Demand] Aucun résultat trouvé pour "${searchQuery}".`);
            return [];
        }

        const validReleases = releases.filter(r => r.infoHash && /^[0-9a-fA-F]{40}$/.test(r.infoHash));
        const hashes = [...new Set(validReleases.map(r => r.infoHash.toLowerCase()))];
        if (hashes.length === 0) return [];

        // Récupération des statuts d'instantanéité déjà vérifiés en cache SQLite
        const existingCached = getCachedTorrentsByImdb(id);
        const instantHashes = new Set(
            (existingCached || []).filter(c => c.isInstant).map(c => (c.infoHash || "").toLowerCase())
        );

        const torrents = [];
        for (const rel of validReleases) {
            const hash = rel.infoHash.toLowerCase();
            const isInstant = instantHashes.has(hash) || Boolean(rel.seeders && rel.seeders >= 10);
            const titleToUse = rel.fileName || rel.title || "Release Prowlarr";

            // Pour une série, si la release est un épisode précis, vérifier qu'elle correspond à l'épisode demandé
            if (isSeries && season !== undefined && !isNaN(season) && episode !== undefined && !isNaN(episode)) {
                const se = parseSeasonEpisode(titleToUse);
                if (se) {
                    if (se.season !== season || se.episode !== episode) continue;
                } else {
                    const seasonPackMatch = titleToUse.match(/\bS(\d{1,2})\b/i);
                    if (seasonPackMatch && parseInt(seasonPackMatch[1], 10) !== season) {
                        continue;
                    }
                }
            }

            const item = {
                infoHash: hash,
                imdbId: id,
                title: rel.title || titleToUse,
                filename: titleToUse,
                size: rel.size || 0,
                indexer: rel.indexer || "Prowlarr",
                seeders: rel.seeders || 0,
                isInstant
            };

            // En mode shared, mettre en cache dans SQLite pour tous les utilisateurs
            if (prowlarrMode === "shared") {
                upsertCachedTorrent(item);
            }
            torrents.push(item);
        }

        console.log(`[Prowlarr On-Demand] ${torrents.length} torrent(s) trouvé(s) pour ${id} [Mode: ${prowlarrMode}].`);
        return torrents;
    } catch (err) {
        console.warn("[Prowlarr On-Demand] Erreur lors de la recherche Prowlarr :", err.response ? `HTTP ${err.response.status}` : err.message);
        return [];
    }
}

module.exports = {
    startProwlarrWorker,
    stopProwlarrWorker,
    syncProwlarrReleases,
    syncAllSharedProwlarrInstances,
    resolveReleaseImdbId,
    searchProwlarrOnDemand,
    getWorkerProwlarrConfig,
    checkProwlarrConnectivity,
    isLocalOrPrivateUrl
};
