"use strict";

const axios = require("axios");
const { upsertCachedTorrent, db } = require("./db");
const { checkInstantMagnets } = require("./alldebrid");

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

let workerTimer = null;
let isSyncing = false;

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
 * Synchronise les catégories Movies (2000) et TV (5000) depuis Prowlarr
 */
async function syncProwlarrReleases(prowlarrUrl, prowlarrKey) {
    if (isSyncing) return;
    isSyncing = true;

    try {
        const cleanUrl = prowlarrUrl.replace(/\/+$/, "");
        console.log("[Prowlarr Worker] Démarrage de la synchronisation RSS / Newznab en arrière-plan...");

        // Requête REST directe vers l'API de recherche Newznab/Torznab de Prowlarr
        const endpoint = `${cleanUrl}/api/v1/search?categories=2000&categories=5000&limit=100&apikey=${prowlarrKey}`;
        const res = await axios.get(endpoint, {
            headers: {
                "User-Agent": BROWSER_UA,
                "Accept": "application/json"
            },
            timeout: 15000
        });

        const releases = Array.isArray(res.data) ? res.data : [];
        if (releases.length === 0) {
            console.log("[Prowlarr Worker] Aucune nouvelle release trouvée.");
            isSyncing = false;
            return;
        }

        // Filtre les releases ayant un infoHash valide (40 caractères hexadécimaux)
        const validReleases = releases.filter(r => r.infoHash && /^[0-9a-fA-F]{40}$/.test(r.infoHash));
        const hashes = [...new Set(validReleases.map(r => r.infoHash.toLowerCase()))];

        if (hashes.length === 0) {
            isSyncing = false;
            return;
        }

        // Vérification par lot d'instantanéité auprès d'AllDebrid
        const adKey = getWorkerAlldebridKey();
        let instantMap = {};
        if (adKey) {
            instantMap = await checkInstantMagnets(hashes.slice(0, 80), adKey);
        }

        let savedCount = 0;
        for (const rel of validReleases) {
            const hash = rel.infoHash.toLowerCase();
            const isInstant = adKey ? Boolean(instantMap[hash]) : true;

            // Extraction de l'IMDb id si fourni par Prowlarr
            let imdbId = null;
            if (rel.imdbId) {
                imdbId = String(rel.imdbId).startsWith("tt") ? String(rel.imdbId) : `tt${String(rel.imdbId).padStart(7, "0")}`;
            }

            upsertCachedTorrent({
                infoHash: hash,
                imdbId: imdbId,
                title: rel.title || "Release Prowlarr",
                filename: rel.fileName || rel.title || "",
                size: rel.size || 0,
                indexer: rel.indexer || "Prowlarr",
                seeders: rel.seeders || 0,
                isInstant: isInstant
            });
            if (isInstant) savedCount++;
        }

        console.log(`[Prowlarr Worker] Sync terminée avec succès : ${validReleases.length} releases analysées, ${savedCount} torrents instantanés stockés en base SQLite.`);
    } catch (err) {
        console.warn("[Prowlarr Worker] Erreur non bloquante lors de la sync Prowlarr :", err.response ? `HTTP ${err.response.status}` : err.message);
    } finally {
        isSyncing = false;
    }
}

/**
 * Initialise le worker en tâche de fond si les variables Prowlarr sont présentes
 */
function startProwlarrWorker() {
    const prowlarrUrl = process.env.PROWLARR_URL || "http://localhost:9696";
    const prowlarrKey = process.env.PROWLARR_KEY;

    if (!prowlarrKey || prowlarrKey.trim() === "" || prowlarrKey === "off") {
        console.log("[Prowlarr Worker] Inactif (PROWLARR_KEY absent). L'addon fonctionne en mode lecture seule sur le cache local et Torrentio.");
        return;
    }

    console.log(`[Prowlarr Worker] Configuré pour ${prowlarrUrl}. Démarrage du cycle de synchronisation périodique (toutes les 15 min)...`);

    // Premier déclenchement différé (laisse le serveur HTTP et SQLite s'initialiser)
    setTimeout(() => {
        syncProwlarrReleases(prowlarrUrl, prowlarrKey);
    }, 5000);

    // Planification récurrente
    workerTimer = setInterval(() => {
        syncProwlarrReleases(prowlarrUrl, prowlarrKey);
    }, SYNC_INTERVAL_MS);

    if (workerTimer && workerTimer.unref) {
        workerTimer.unref(); // N'empêche pas l'arrêt propre de Node.js
    }
}

function stopProwlarrWorker() {
    if (workerTimer) {
        clearInterval(workerTimer);
        workerTimer = null;
    }
}

module.exports = {
    startProwlarrWorker,
    stopProwlarrWorker,
    syncProwlarrReleases
};
