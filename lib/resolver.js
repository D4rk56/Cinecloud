"use strict";

const axios = require("axios");
const { getUserByUuid, deleteMovieVersion, getNextMovieCandidate, deleteCachedTorrent, getCachedTorrentsByImdb } = require("./db");
const { decryptConfig } = require("./crypto");
const { unlockLink, adPost, adGet, adHeaders } = require("./alldebrid");
const { parseSeasonEpisode, extractCleanTitle } = require("./helpers");

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Extrait la clé AllDebrid depuis le paramètre userRef (UUID moderne ou token legacy k_base64)
 */
function resolveUserApiKey(userRef) {
    if (!userRef) return null;
    // Format moderne : UUID v4
    if (userRef.length === 36 && userRef.includes("-")) {
        const user = getUserByUuid(userRef);
        if (!user || !user.configEncrypted) return null;
        try {
            const config = decryptConfig(user.configEncrypted);
            return config.apiKey || null;
        } catch (e) {
            console.error(`[Resolver] Erreur déchiffrement config pour utilisateur ${userRef}:`, e.message);
            return null;
        }
    }
    // Format rétro-compatible / legacy : k_<base64UrlApiKey>
    if (userRef.startsWith("k_")) {
        try {
            return Buffer.from(userRef.slice(2), "base64url").toString("utf8");
        } catch (e) {
            return null;
        }
    }
    // Si c'est directement une clé API brute passée en rétro-compatibilité
    if (userRef.length >= 20 && !userRef.includes("-")) {
        return userRef;
    }
    return null;
}

/**
 * Test rapide de la validité d'une URL CDN (HEAD avec timeout de 3s)
 */
async function testStreamAlive(url) {
    if (!url) return false;
    try {
        const res = await axios.head(url, {
            headers: { "User-Agent": BROWSER_UA },
            timeout: 3000,
            maxRedirects: 3,
            validateStatus: (status) => (status >= 200 && status < 400)
        });
        return res.status >= 200 && res.status < 400;
    } catch (e) {
        // Certains CDN bloquent le HEAD mais acceptent un GET partiel avec Range
        try {
            const rangeRes = await axios.get(url, {
                headers: {
                    "User-Agent": BROWSER_UA,
                    "Range": "bytes=0-1024"
                },
                responseType: "stream",
                timeout: 3000,
                maxRedirects: 3,
                validateStatus: (status) => (status === 200 || status === 206 || status === 302)
            });
            const isAlive = rangeRes.status === 200 || rangeRes.status === 206 || rangeRes.status === 302;
            if (rangeRes.data && typeof rangeRes.data.destroy === "function") {
                rangeRes.data.destroy();
            }
            return isAlive;
        } catch (e2) {
            return false;
        }
    }
}

/**
 * Sélectionne le meilleur fichier vidéo dans une arborescence (avec détection SxxExx si série)
 */
function pickBestVideoFile(files, imdbId = "") {
    if (!files || files.length === 0) return null;
    if (imdbId && imdbId.includes(":")) {
        const parts = imdbId.split(":");
        const season = parseInt(parts[parts.length - 2], 10);
        const episode = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(season) && !isNaN(episode)) {
            const match = files.find(f => {
                const name = f.n || f.name || f.filename || "";
                const se = parseSeasonEpisode(name);
                return se && se.season === season && se.episode === episode;
            });
            if (match) return match;
        }
    }
    // Par défaut : fichier le plus volumineux (meilleur débit / qualité)
    const sorted = [...files].sort((a, b) => ((b.s || b.size || b.filesize || 0) - (a.s || a.size || a.filesize || 0)));
    return sorted[0];
}

function flattenFiles(entries) {
    if (!entries) return [];
    let result = [];
    const list = Array.isArray(entries) ? entries : Object.values(entries);
    for (const e of list) {
        if (!e) continue;
        const sub = e.e || e.files || e.children || e.elements;
        if (sub && (Array.isArray(sub) || typeof sub === "object")) {
            result = result.concat(flattenFiles(sub));
        } else {
            result.push(e);
        }
    }
    return result;
}

function isRealVideoFile(filename) {
    if (!filename) return false;
    const clean = String(filename).split("?")[0].split("#")[0].toLowerCase();
    const videoExts = [".mkv", ".mp4", ".avi", ".mov", ".m4v", ".ts", ".webm"];
    const isVideo = videoExts.some(ext => clean.endsWith(ext));
    if (!isVideo) return false;
    const sampleKeywords = ["sample", "trailer", "promo", "preview", "bonus"];
    return !sampleKeywords.some(w => clean.includes(w));
}

/**
 * Récupère les fichiers d'un magnet avec bascule intelligente entre POST, GET et v4.1
 */
async function fetchFilesForMagnet(magnetId, apiKey) {
    if (!magnetId || !apiKey) return [];
    // 1. Essai /v4/magnet/files via POST
    try {
        const res = await adPost("/v4/magnet/files", apiKey, { id: [magnetId] });
        if (res && res.data && res.data.status === "success" && res.data.data) {
            const mag = (res.data.data.magnets && res.data.data.magnets[0]) || res.data.data;
            const files = mag.files || mag.links;
            if (files && files.length > 0) return files;
        }
    } catch (e) {}

    // 2. Essai /v4/magnet/files via GET
    try {
        const res = await adGet("/v4/magnet/files", apiKey, { id: magnetId });
        if (res && res.data && res.data.status === "success" && res.data.data) {
            const mag = (res.data.data.magnets && res.data.data.magnets[0]) || res.data.data;
            const files = mag.files || mag.links;
            if (files && files.length > 0) return files;
        }
    } catch (e) {}

    // 3. Essai /v4.1/magnet/status
    try {
        const res = await adGet("/v4.1/magnet/status", apiKey, { id: magnetId });
        if (res && res.data && res.data.status === "success" && res.data.data) {
            const mag = (res.data.data.magnets && res.data.data.magnets[0]) || res.data.data;
            const files = mag.files || mag.links;
            if (files && files.length > 0) return files;
        }
    } catch (e) {}

    // 4. Essai getMagnetFiles
    try {
        const { getMagnetFiles } = require("./alldebrid");
        const map = await getMagnetFiles([magnetId], apiKey);
        if (map[magnetId] && map[magnetId].length > 0) return map[magnetId];
    } catch (e) {}

    return [];
}

/**
 * Débloque un fichier spécifique à partir de son alldebridId ou hash
 */
async function unlockFileTarget(apiKey, fileRef, imdbId = "") {
    if (!fileRef || !apiKey) return null;

    // Cas 1 : Lien brut ou URL encodée
    if (fileRef.startsWith("http://") || fileRef.startsWith("https://")) {
        const unlock = await unlockLink(fileRef, apiKey);
        if (unlock.success && unlock.downloadUrl) {
            return unlock.downloadUrl;
        }
        if (/(\.mkv|\.mp4|\.avi|\.mov|\.m4v|\.ts|\.webm)(?:$|\?)/i.test(fileRef) || fileRef.includes("debrid.it") || fileRef.includes("alldebrid.com/dl/")) {
            return fileRef;
        }
    }

    // Cas 2 : Fichier issu d'une série cloud (ad_series:<titre>:<saison>:<episode>)
    if (fileRef.startsWith("ad_series:")) {
        try {
            const parts = fileRef.replace("ad_series:", "").split(":");
            const episode = parseInt(parts.pop(), 10);
            const season = parseInt(parts.pop(), 10);
            const groupTitle = decodeURIComponent(parts.join(":"));

            const statusRes = await adGet("/v4.1/magnet/status", apiKey).catch(() => null);
            const magnets = (statusRes && statusRes.data && statusRes.data.data && statusRes.data.data.magnets) || [];
            const match = magnets.find(m => {
                if (extractCleanTitle(m.filename || "").title.toLowerCase() !== groupTitle.toLowerCase()) return false;
                const se = parseSeasonEpisode(m.filename || "");
                return se && se.season === season && se.episode === episode;
            });
            if (match && match.id) {
                return unlockFileTarget(apiKey, String(match.id), imdbId);
            }
        } catch (err) {
            console.error("[Resolver] Erreur résolution ad_series:", err.message);
        }
        return null;
    }

    // Cas 3 : Hash de torrent (hash_<infoHash>)
    if (fileRef.startsWith("hash_")) {
        const infoHash = fileRef.replace("hash_", "").toLowerCase();
        let uploadedId = null;
        let uploadedNew = false;
        try {
            // 1. Vérification si le torrent est déjà présent dans le compte AllDebrid
            const statusRes = await adGet("/v4.1/magnet/status", apiKey).catch(() => null);
            const existingMagnets = (statusRes && statusRes.data && statusRes.data.data && statusRes.data.data.magnets) || [];
            const existing = existingMagnets.find(m => {
                const mHash = (m.hash || "").toLowerCase();
                if (mHash === infoHash) return true;
                if (m.magnet) {
                    const match = m.magnet.match(/btih:([a-f0-9]{40})/i);
                    if (match && match[1].toLowerCase() === infoHash) return true;
                }
                return false;
            });

            if (existing && existing.id) {
                uploadedId = existing.id;
            } else {
                // 2. Non présent : upload du magnet
                const magnetUri = infoHash.startsWith("magnet:") ? infoHash : `magnet:?xt=urn:btih:${infoHash}`;
                let uploadRes = await adPost("/v4/magnet/upload", apiKey, { magnets: [magnetUri] }).catch(err => err.response || null);

                // Si le quota de 30 magnets est atteint, purge le plus ancien terminé et réessaie
                if (uploadRes && uploadRes.data && uploadRes.data.status === "error" && (uploadRes.data.error?.code === "MAGNET_TOO_MANY" || /too many/i.test(uploadRes.data.error?.message || ""))) {
                    console.log("[Resolver] Quota 30 magnets AllDebrid atteint. Nettoyage du plus ancien magnet terminé...");
                    const readyMagnets = existingMagnets.filter(m => m.statusCode === 4 || m.ready);
                    if (readyMagnets.length > 0) {
                        const oldest = readyMagnets[0];
                        await adGet("/v4/magnet/delete", apiKey, { id: oldest.id }).catch(() => {});
                        uploadRes = await adPost("/v4/magnet/upload", apiKey, { magnets: [magnetUri] }).catch(() => null);
                    }
                }

                const magData = uploadRes && uploadRes.data && uploadRes.data.data && uploadRes.data.data.magnets && uploadRes.data.data.magnets[0];
                if (magData && magData.id) {
                    uploadedId = magData.id;
                    uploadedNew = true;
                }
            }

            if (uploadedId) {
                let files = await fetchFilesForMagnet(uploadedId, apiKey);

                // Si AllDebrid traite encore les métadonnées (statut 0), légère attente de 600ms
                if (!files || files.length === 0) {
                    await new Promise(r => setTimeout(r, 600));
                    files = await fetchFilesForMagnet(uploadedId, apiKey);
                }

                if (files && files.length > 0) {
                    const flat = flattenFiles(files).filter(f => (f.l || f.link || f.url) && isRealVideoFile(f.n || f.name || f.filename));
                    const chosen = pickBestVideoFile(flat, imdbId);
                    const targetLink = chosen && (chosen.l || chosen.link || chosen.url);
                    if (targetLink) {
                        const unlock = await unlockLink(targetLink, apiKey);
                        if (unlock.success && unlock.downloadUrl) {
                            return unlock.downloadUrl;
                        }
                        if (typeof targetLink === "string" && (targetLink.startsWith("http://") || targetLink.startsWith("https://"))) {
                            return targetLink;
                        }
                    }
                }

                // Si l'upload était nouveau et que le déblocage a échoué, nettoyage pour préserver les 30 slots
                if (uploadedNew) {
                    adGet("/v4/magnet/delete", apiKey, { id: uploadedId }).catch(() => {});
                }
            }
        } catch (err) {
            console.error(`[Resolver] Erreur déblocage hash ${infoHash}:`, err.message);
            if (uploadedId && uploadedNew) {
                adGet("/v4/magnet/delete", apiKey, { id: uploadedId }).catch(() => {});
            }
        }
        return null;
    }

    // Cas 4 : ID de magnet AllDebrid (numérique)
    if (/^\d+$/.test(fileRef)) {
        try {
            const files = await fetchFilesForMagnet(fileRef, apiKey);
            if (files && files.length > 0) {
                const flat = flattenFiles(files).filter(f => (f.l || f.link || f.url) && isRealVideoFile(f.n || f.name || f.filename));
                const chosen = pickBestVideoFile(flat, imdbId);
                const targetLink = chosen && (chosen.l || chosen.link || chosen.url);
                if (targetLink) {
                    const unlock = await unlockLink(targetLink, apiKey);
                    if (unlock.success && unlock.downloadUrl) {
                        return unlock.downloadUrl;
                    }
                    if (typeof targetLink === "string" && (targetLink.startsWith("http://") || targetLink.startsWith("https://"))) {
                        return targetLink;
                    }
                }
            }
        } catch (err) {
            console.error(`[Resolver] Erreur déblocage magnetId ${fileRef}:`, err.message);
        }
        return null;
    }

    return null;
}

/**
 * Endpoint de résolution Lazy : /resolve/:userRef/:imdbId/:fileRef
 */
async function handleResolve(req, res) {
    const { userRef, imdbId, fileRef } = req.params;
    const apiKey = resolveUserApiKey(userRef);

    if (!apiKey) {
        return res.status(401).json({ error: "Utilisateur introuvable ou clé API AllDebrid manquante." });
    }

    let targetFile;
    try {
        targetFile = decodeURIComponent(fileRef);
    } catch (e) {
        targetFile = fileRef;
    }

    // Tentative 1 : Résolution de la cible demandée
    let downloadUrl = await unlockFileTarget(apiKey, targetFile, imdbId);
    if (downloadUrl) {
        // Succès : Redirection 302 instantanée vers le CDN AllDebrid
        return res.redirect(302, downloadUrl);
    }

    // Le flux est inaccessible ou déblocage échoué :
    console.warn(`[Resolver] Échec résolution pour ${imdbId} (${targetFile}). Purge et bascule automatique en cours...`);

    // 1. Suppression immédiate de l'entrée morte en base SQLite
    if (targetFile.startsWith("hash_")) {
        deleteCachedTorrent(targetFile.replace("hash_", ""));
    } else {
        deleteMovieVersion(imdbId, targetFile);
    }

    // 2. Sélection automatique du meilleur candidat suivant dans le cache SQLite
    // A. Recherche dans la table movies (fichiers cloud AllDebrid)
    const nextCandidate = getNextMovieCandidate(imdbId, targetFile);
    if (nextCandidate && nextCandidate.alldebridId) {
        console.log(`[Resolver] Candidat suivant trouvé pour ${imdbId} : ${nextCandidate.alldebridId} (${nextCandidate.filename})`);
        const fallbackUrl = await unlockFileTarget(apiKey, nextCandidate.alldebridId, imdbId);
        if (fallbackUrl) {
            console.log(`[Resolver] Failover réussi vers ${nextCandidate.filename} !`);
            return res.redirect(302, fallbackUrl);
        }
        deleteMovieVersion(imdbId, nextCandidate.alldebridId);
    }

    // B. Élargissement du failover vers les flux cached_torrents
    const currentHash = targetFile.startsWith("hash_") ? targetFile.replace("hash_", "").toLowerCase() : "";
    const cachedTorrents = getCachedTorrentsByImdb(imdbId);
    const nextTorrent = cachedTorrents.find(t => t.infoHash && t.infoHash.toLowerCase() !== currentHash);
    if (nextTorrent && nextTorrent.infoHash) {
        console.log(`[Resolver] Candidat torrent suivant trouvé pour ${imdbId} : ${nextTorrent.infoHash} (${nextTorrent.title})`);
        const fallbackTorrentUrl = await unlockFileTarget(apiKey, `hash_${nextTorrent.infoHash}`, imdbId);
        if (fallbackTorrentUrl) {
            console.log(`[Resolver] Failover réussi vers torrent ${nextTorrent.title} !`);
            return res.redirect(302, fallbackTorrentUrl);
        }
        deleteCachedTorrent(nextTorrent.infoHash);
    }

    // Aucun flux valide
    return res.status(404).send(`
        <html>
            <body style="font-family:sans-serif; text-align:center; padding:50px; background:#111; color:#eee;">
                <h2>⚠️ Flux indisponible</h2>
                <p>Le lien source n'est plus accessible sur AllDebrid et a été automatiquement retiré du cache.</p>
                <p>Veuillez rafraîchir Stremio pour sélectionner une autre version.</p>
            </body>
        </html>
    `);
}

module.exports = {
    handleResolve,
    resolveUserApiKey,
    testStreamAlive,
    pickBestVideoFile,
    unlockFileTarget
};
