"use strict";

const axios = require("axios");
const {
    getUserByUuid,
    deleteMovieVersion,
    getNextMovieCandidate,
    deleteCachedTorrent,
    getCachedTorrentsByImdb
} = require("./db");
const { decryptConfig } = require("./crypto");
const {
    unlockLink,
    adPost,
    adGet,
    deleteMagnet,
    isAllDebridMagnetReady,
    isAllDebridTargetDead,
    markAllDebridTargetDead
} = require("./alldebrid");
const {
    getTorboxTorrentList,
    getTorboxTorrentInfo,
    createTorboxTorrent,
    getTorboxStreamUrl,
    deleteTorboxTorrent,
    isTorboxTorrentDownloaded
} = require("./torbox");
const { parseSeasonEpisode, extractCleanTitle, isRealVideoFile, makeLRU } = require("./helpers");
const crypto = require("crypto");

// Résolutions déjà obtenues (10 min) : Stremio appelle /resolve DEUX fois par clic et
// l'utilisateur rejoue volontiers le même flux — sans ce cache, tout le travail AllDebrid
// (jusqu'à 4 tentatives de récupération de fichiers + unlock) était refait à chaque fois.
const resolutionCache = makeLRU(500, 10 * 60 * 1000);
// Listes de fichiers par magnet : évite de répéter les tentatives séquentielles.
const magnetFilesCache = makeLRU(500, 10 * 60 * 1000);
// Échecs de récupération de fichiers : mémorisés 60 s seulement (le magnet peut devenir prêt).
const magnetFilesNegativeCache = makeLRU(500, 60 * 1000);

/** Clé de cache liée à la clé API (hachée : jamais la clé en clair) et à la cible. */
function cacheKeyFor(apiKey, ref) {
    const digest = crypto.createHash("sha256").update(String(apiKey)).digest("hex").slice(0, 16);
    return `${digest}|${ref}`;
}

const BROWSER_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Extrait la clé AllDebrid ou Torbox depuis le paramètre userRef (UUID moderne ou token legacy k_base64)
 */
function resolveUserApiKey(userRef) {
    if (!userRef) return null;
    // Format moderne : UUID v4 (les formats legacy k_base64 / clé brute ont été retirés)
    if (userRef.length === 36 && userRef.includes("-")) {
        const user = getUserByUuid(userRef);
        if (!user || !user.configEncrypted) return null;
        try {
            const config = decryptConfig(user.configEncrypted);
            if (config.debridProvider === "torbox") {
                return config.torboxApiKey || config.apiKey || null;
            }
            return config.apiKey || config.torboxApiKey || null;
        } catch (e) {
            console.error(`[Resolver] Erreur déchiffrement config pour utilisateur ${userRef}:`, e.message);
            return null;
        }
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
            validateStatus: status => status >= 200 && status < 400
        });
        return res.status >= 200 && res.status < 400;
    } catch (e) {
        // Certains CDN bloquent le HEAD mais acceptent un GET partiel avec Range
        try {
            const rangeRes = await axios.get(url, {
                headers: {
                    "User-Agent": BROWSER_UA,
                    Range: "bytes=0-1024"
                },
                responseType: "stream",
                timeout: 3000,
                maxRedirects: 3,
                validateStatus: status => status === 200 || status === 206 || status === 302
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
    const sorted = [...files].sort((a, b) => (b.s || b.size || b.filesize || 0) - (a.s || a.size || a.filesize || 0));
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

/**
 * Récupère les fichiers d'un magnet (avec cache : évite de répéter jusqu'à 4 tentatives).
 */
async function fetchFilesForMagnet(magnetId, apiKey) {
    if (!magnetId || !apiKey) return [];

    const cacheKey = cacheKeyFor(apiKey, `files:${magnetId}`);
    const cached = magnetFilesCache.get(cacheKey);
    if (cached) return cached;
    if (magnetFilesNegativeCache.has(cacheKey)) return [];

    const files = await fetchFilesForMagnetUncached(magnetId, apiKey);
    if (files && files.length > 0) magnetFilesCache.set(cacheKey, files);
    else magnetFilesNegativeCache.set(cacheKey, true);
    return files || [];
}

/**
 * Récupère les fichiers d'un magnet avec bascule intelligente entre POST, GET et v4.1
 */
async function fetchFilesForMagnetUncached(magnetId, apiKey) {
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

function resolveUserConfig(userRef) {
    if (!userRef) return null;
    if (userRef.length === 36 && userRef.includes("-")) {
        const user = getUserByUuid(userRef);
        if (!user || !user.configEncrypted) return null;
        try {
            return decryptConfig(user.configEncrypted) || null;
        } catch (e) {
            return null;
        }
    }
    return null;
}

/**
 * Débloque un fichier spécifique à partir de son alldebridId ou hash
 */
async function unlockFileTarget(apiKey, fileRef, imdbId = "", allowDownload = false) {
    if (!fileRef || !apiKey) return null;

    // Cas 1 : Lien brut ou URL encodée
    if (fileRef.startsWith("http://") || fileRef.startsWith("https://")) {
        const unlock = await unlockLink(fileRef, apiKey);
        if (unlock.success && unlock.downloadUrl) {
            return unlock.downloadUrl;
        }
        if (
            /(\.mkv|\.mp4|\.avi|\.mov|\.m4v|\.ts|\.webm)(?:$|\?)/i.test(fileRef) ||
            fileRef.includes("debrid.it") ||
            fileRef.includes("alldebrid.com/dl/")
        ) {
            return fileRef;
        }
    }

    // Quarantaine : une cible déjà rejetée récemment (magnet absent/non prêt) n'est pas
    // réinterrogée — Stremio appelle l'URL /resolve deux fois par clic et l'utilisateur
    // reclique volontiers : sans cela, les mêmes appels AllDebrid se répètent sans fin.
    if (isAllDebridTargetDead(fileRef)) {
        return null;
    }

    // Cas 2 : Fichier issu d'une série cloud (ad_series:<titre>:<saison>:<episode>)
    if (fileRef.startsWith("ad_series:")) {
        try {
            const parts = fileRef.replace("ad_series:", "").split(":");
            const episode = parseInt(parts.pop(), 10);
            const season = parseInt(parts.pop(), 10);
            const groupTitle = decodeURIComponent(parts.join(":"));
            const cleanTargetGroup = groupTitle.toLowerCase();

            // 1. Recherche dans les magnets
            const statusRes = await adGet("/v4.1/magnet/status", apiKey).catch(() => null);
            const magnets = (statusRes && statusRes.data && statusRes.data.data && statusRes.data.data.magnets) || [];

            // A. Magnet individuel direct
            const match = magnets.find(m => {
                if (extractCleanTitle(m.filename || "").title.toLowerCase() !== cleanTargetGroup) return false;
                const se = parseSeasonEpisode(m.filename || "");
                return se && se.season === season && se.episode === episode;
            });
            if (match && match.id) {
                return unlockFileTarget(apiKey, String(match.id), imdbId || fileRef, allowDownload);
            }

            // B. Magnet sous forme de pack de saison (contenant les fichiers dans files)
            for (const m of magnets) {
                const mTitle = extractCleanTitle(m.filename || "").title.toLowerCase();
                if (mTitle.includes(cleanTargetGroup) || cleanTargetGroup.includes(mTitle)) {
                    const files = await fetchFilesForMagnet(m.id, apiKey);
                    const flat = flattenFiles(files);
                    const fileMatch = flat.find(f => {
                        const fname = f.n || f.name || f.filename || "";
                        const se = parseSeasonEpisode(fname);
                        return se && se.season === season && se.episode === episode;
                    });
                    if (fileMatch) {
                        const fileLink = fileMatch.l || fileMatch.link || fileMatch.url;
                        if (fileLink) {
                            const unlock = await unlockLink(fileLink, apiKey);
                            if (unlock.success && unlock.downloadUrl) return unlock.downloadUrl;
                            if (
                                typeof fileLink === "string" &&
                                (fileLink.startsWith("http://") || fileLink.startsWith("https://"))
                            )
                                return fileLink;
                        }
                        return unlockFileTarget(apiKey, String(m.id), imdbId || fileRef, allowDownload);
                    }
                }
            }

            // 2. Recherche dans les liens débridés et l'historique
            const [linksRes, histRes] = await Promise.all([
                adGet("/v4/user/links", apiKey).catch(() => null),
                adGet("/v4/user/history", apiKey).catch(() => null)
            ]);
            const histData = histRes && histRes.data && histRes.data.data;
            const histLinks = Array.isArray(histData)
                ? histData
                : Array.isArray(histData?.history)
                  ? histData.history
                  : Array.isArray(histData?.links)
                    ? histData.links
                    : [];
            const activeLinks =
                linksRes && linksRes.data && linksRes.data.data && Array.isArray(linksRes.data.data.links)
                    ? linksRes.data.data.links
                    : [];
            const allLinks = [...activeLinks, ...histLinks];
            const linkMatch = allLinks.find(l => {
                if (extractCleanTitle(l.filename || "").title.toLowerCase() !== cleanTargetGroup) return false;
                const se = parseSeasonEpisode(l.filename || "");
                return se && se.season === season && se.episode === episode;
            });
            if (linkMatch && linkMatch.link) {
                return unlockFileTarget(apiKey, linkMatch.link, imdbId || fileRef, allowDownload);
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
            const existingMagnets =
                (statusRes && statusRes.data && statusRes.data.data && statusRes.data.data.magnets) || [];
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
                let uploadRes = await adPost("/v4/magnet/upload", apiKey, { magnets: [magnetUri] }).catch(
                    err => err.response || null
                );

                // Si le quota de 30 magnets est atteint, purge le plus ancien terminé et réessaie
                if (
                    uploadRes &&
                    uploadRes.data &&
                    uploadRes.data.status === "error" &&
                    (uploadRes.data.error?.code === "MAGNET_TOO_MANY" ||
                        /too many/i.test(uploadRes.data.error?.message || ""))
                ) {
                    console.log(
                        "[Resolver] Quota 30 magnets AllDebrid atteint. Nettoyage du plus ancien magnet terminé..."
                    );
                    const readyMagnets = existingMagnets.filter(m => isAllDebridMagnetReady(m));
                    if (readyMagnets.length > 0) {
                        const oldest = readyMagnets[0];
                        await deleteMagnet(oldest.id, apiKey);
                        uploadRes = await adPost("/v4/magnet/upload", apiKey, { magnets: [magnetUri] }).catch(
                            () => null
                        );
                    }
                }

                const magData =
                    uploadRes &&
                    uploadRes.data &&
                    uploadRes.data.data &&
                    uploadRes.data.data.magnets &&
                    uploadRes.data.data.magnets[0];
                if (magData && magData.id) {
                    uploadedId = magData.id;
                    uploadedNew = true;
                    // Si un upload a lieu et qu'AllDebrid renvoie ready !== true : si !allowDownload, supprimer immédiatement
                    if (!allowDownload && magData.ready !== true) {
                        console.log(
                            `[Resolver] Torrent ${infoHash} téléversé mais AllDebrid ready !== true et allowDownload=false. Suppression immédiate.`
                        );
                        await deleteMagnet(uploadedId, apiKey);
                        return null;
                    }
                    if (magData.ready === true) {
                        try {
                            const { asyncUpsertCachedTorrent, upsertCachedTorrent } = require("./db");
                            (asyncUpsertCachedTorrent || upsertCachedTorrent)({
                                infoHash,
                                imdbId,
                                title: magData.filename || magData.name || "Torrent AllDebrid",
                                filename: magData.filename || magData.name || "",
                                size: magData.size || 0,
                                isInstant: 1
                            });
                        } catch (e) {}
                    }
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
                    const flat = flattenFiles(files).filter(
                        f => (f.l || f.link || f.url) && isRealVideoFile(f.n || f.name || f.filename)
                    );
                    const chosen = pickBestVideoFile(flat, imdbId);
                    const targetLink = chosen && (chosen.l || chosen.link || chosen.url);
                    if (targetLink) {
                        const unlock = await unlockLink(targetLink, apiKey);
                        if (unlock.success && unlock.downloadUrl) {
                            return unlock.downloadUrl;
                        }
                        if (
                            typeof targetLink === "string" &&
                            (targetLink.startsWith("http://") || targetLink.startsWith("https://"))
                        ) {
                            return targetLink;
                        }
                    }
                }

                // Si le mode download est actif, on conserve le magnet dans AllDebrid pour téléchargement
                if (allowDownload) {
                    console.log(
                        `[Resolver] Mode download actif pour ${infoHash} (AllDebrid ID: ${uploadedId}). Conservé dans le cloud.`
                    );
                    return { downloading: true, magnetId: uploadedId };
                }

                // Si l'upload était nouveau et que le déblocage a échoué, nettoyage pour préserver les 30 slots
                if (uploadedNew) {
                    await deleteMagnet(uploadedId, apiKey);
                }
            }
        } catch (err) {
            console.error(`[Resolver] Erreur déblocage hash ${infoHash}:`, err.message);
            if (uploadedId && uploadedNew && !allowDownload) {
                await deleteMagnet(uploadedId, apiKey);
            }
        }
        if (uploadedId) {
            console.warn(
                `[Resolver] hash_${infoHash} : magnet ${uploadedId} sans fichier vidéo exploitable (non prêt ou en erreur).`
            );
        }
        return null;
    }

    // Cas 4 : ID de magnet AllDebrid (numérique)
    if (/^\d+$/.test(fileRef)) {
        try {
            const files = await fetchFilesForMagnet(fileRef, apiKey);
            if (!files || files.length === 0) {
                console.warn(
                    `[Resolver] MagnetId ${fileRef} : 0 fichier — magnet supprimé ou encore en préparation côté AllDebrid.`
                );
                markAllDebridTargetDead(fileRef, "0 fichier (magnet non prêt ou supprimé)");
                return null;
            }

            const flat = flattenFiles(files).filter(
                f => (f.l || f.link || f.url) && isRealVideoFile(f.n || f.name || f.filename)
            );
            if (flat.length === 0) {
                console.warn(
                    `[Resolver] MagnetId ${fileRef} : ${files.length} fichier(s) mais aucun fichier vidéo exploitable.`
                );
                markAllDebridTargetDead(fileRef, "aucun fichier vidéo exploitable");
                return null;
            }

            const chosen = pickBestVideoFile(flat, imdbId);
            const targetLink = chosen && (chosen.l || chosen.link || chosen.url);
            if (targetLink) {
                const unlock = await unlockLink(targetLink, apiKey);
                if (unlock.success && unlock.downloadUrl) {
                    return unlock.downloadUrl;
                }
                if (
                    typeof targetLink === "string" &&
                    (targetLink.startsWith("http://") || targetLink.startsWith("https://"))
                ) {
                    return targetLink;
                }
            }

            console.warn(`[Resolver] MagnetId ${fileRef} : déblocage du lien impossible (fichier non prêt).`);
            markAllDebridTargetDead(fileRef, "déblocage du lien impossible");
        } catch (err) {
            const status = err.response && err.response.status;
            console.error(`[Resolver] Erreur déblocage magnetId ${fileRef}:`, status ? `HTTP ${status}` : err.message);
            // Seules les erreurs définitives mettent la cible en quarantaine : une erreur
            // transitoire (réseau, 429) ne doit pas masquer un contenu valable 10 minutes.
            if (status === 404 || status === 410) {
                markAllDebridTargetDead(fileRef, `HTTP ${status}`);
            }
        }
        return null;
    }

    return null;
}

/**
 * Débloque un fichier spécifique à partir de son torrentId, fileId ou hash sur Torbox
 */
async function unlockTorboxFileTarget(apiKey, fileRef, imdbId = "", allowDownload = false) {
    if (!fileRef || !apiKey) return null;

    // Cas 1 : Lien HTTP direct
    if (fileRef.startsWith("http://") || fileRef.startsWith("https://")) {
        return fileRef;
    }

    // Cas 2 : Fichier cloud Torbox direct (tb_cloud:<torrentId>:<fileId>)
    if (fileRef.startsWith("tb_cloud:")) {
        const parts = fileRef.replace("tb_cloud:", "").split(":");
        const torrentId = parts[0];
        const fileId = parts[1];
        if (torrentId && fileId) {
            return getTorboxStreamUrl(torrentId, fileId, apiKey);
        }
        return null;
    }

    // Cas 3 : Hash de torrent (tb_hash_<infoHash> ou hash_<infoHash>)
    if (fileRef.startsWith("tb_hash_") || fileRef.startsWith("hash_")) {
        const infoHash = fileRef.replace(/^(tb_)?hash_/, "").toLowerCase();
        let uploadedId = null;
        let uploadedNew = false;

        try {
            // 1. Vérification si le torrent existe déjà dans le compte Torbox
            const myTorrents = await getTorboxTorrentList(apiKey).catch(() => []);
            const existing = (Array.isArray(myTorrents) ? myTorrents : []).find(t => {
                const h = (t.hash || "").toLowerCase();
                return h === infoHash;
            });

            if (existing && existing.id) {
                uploadedId = existing.id;
            } else {
                // 2. Ajout du magnet à Torbox
                const uploadRes = await createTorboxTorrent(infoHash, apiKey, 1);
                if (uploadRes && uploadRes.success && uploadRes.torrentId) {
                    uploadedId = uploadRes.torrentId;
                    uploadedNew = true;
                }
            }

            if (uploadedId) {
                let info = await getTorboxTorrentInfo(uploadedId, apiKey);
                if (!info || !info.files || info.files.length === 0) {
                    await new Promise(r => setTimeout(r, 600));
                    info = await getTorboxTorrentInfo(uploadedId, apiKey);
                }

                const files = (info && info.files) || [];
                const videoFiles = files.filter(f => isRealVideoFile(f.name || f.filename || f.n));
                const chosen = pickBestVideoFile(videoFiles.length > 0 ? videoFiles : files, imdbId);

                if (chosen && chosen.id !== undefined) {
                    const isCompleted = isTorboxTorrentDownloaded(info);
                    if (isCompleted || !uploadedNew) {
                        return getTorboxStreamUrl(uploadedId, chosen.id, apiKey);
                    }

                    if (allowDownload) {
                        console.log(
                            `[Resolver] Mode download actif pour ${infoHash} (Torbox ID: ${uploadedId}). Conservé dans le cloud.`
                        );
                        return { downloading: true, torrentId: uploadedId, provider: "Torbox" };
                    }

                    // Si pas instantané et mode download non actif, suppression pour libérer le compte
                    if (uploadedNew) {
                        deleteTorboxTorrent(uploadedId, apiKey).catch(() => {});
                    }
                    return null;
                }

                if (allowDownload) {
                    return { downloading: true, torrentId: uploadedId, provider: "Torbox" };
                }
                if (uploadedNew) {
                    deleteTorboxTorrent(uploadedId, apiKey).catch(() => {});
                }
            }
        } catch (err) {
            console.error(`[Resolver] Erreur déblocage Torbox hash ${infoHash}:`, err.message);
            if (uploadedId && uploadedNew && !allowDownload) {
                deleteTorboxTorrent(uploadedId, apiKey).catch(() => {});
            }
        }
        return null;
    }

    return null;
}

/**
 * Vérifie qu'une URL de redirection est sûre : http/https uniquement et ne pointe
 * pas vers l'hôte de l'addon (prévention open-redirect / boucle de redirection).
 * @param {string} url
 * @param {string} ownHost - hostname de la requête (sans port)
 * @returns {boolean}
 */
function isSafeRedirectUrl(url, ownHost) {
    if (!url || typeof url !== "string") return false;
    let parsed;
    try {
        parsed = new URL(url);
    } catch (e) {
        return false;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (ownHost) {
        try {
            if (parsed.hostname.toLowerCase() === String(ownHost).toLowerCase()) return false;
        } catch (e) {}
    }
    return true;
}

/**
 * Endpoint de résolution Lazy : /resolve/:userRef/:imdbId/:fileRef
 */
async function handleResolve(req, res) {
    const { userRef, imdbId, fileRef } = req.params;
    const apiKey = resolveUserApiKey(userRef);

    if (!apiKey) {
        return res.status(401).json({ error: "Utilisateur introuvable ou clé API debrid manquante." });
    }

    const userConfig = resolveUserConfig(userRef);
    const allowDownload = Boolean(userConfig && userConfig.allowDownload);

    let targetFile;
    try {
        targetFile = decodeURIComponent(fileRef);
    } catch (e) {
        targetFile = fileRef;
    }

    const isTorbox = Boolean(
        targetFile.startsWith("tb_") ||
        (userConfig &&
            userConfig.debridProvider === "torbox" &&
            !targetFile.startsWith("hash_") &&
            !targetFile.startsWith("ad_"))
    );
    const providerName = isTorbox ? "Torbox" : "AllDebrid";
    const activeApiKey = isTorbox
        ? userConfig?.torboxApiKey || (userConfig?.debridProvider === "torbox" ? userConfig?.apiKey : null) || apiKey
        : userConfig?.apiKey || apiKey;

    // Cache de résolution : réponse instantanée (aucun appel debrid) pour un flux déjà résolu.
    const resolutionKey = cacheKeyFor(activeApiKey, targetFile);
    const cachedResolution = resolutionCache.get(resolutionKey);
    if (cachedResolution) {
        return res.redirect(302, cachedResolution);
    }

    // Tentative 1 : Résolution de la cible demandée
    let downloadResult = isTorbox
        ? await unlockTorboxFileTarget(activeApiKey, targetFile, imdbId, allowDownload)
        : await unlockFileTarget(activeApiKey, targetFile, imdbId, allowDownload);

    if (downloadResult) {
        if (typeof downloadResult === "string") {
            // Garde open-redirect : http/https uniquement + refus de rediriger vers l'hôte de l'addon
            let ownHost = "";
            try {
                const rawHost = req.get && req.get("host") ? req.get("host") : "";
                if (rawHost) ownHost = new URL(`http://${rawHost}`).hostname;
            } catch (e) {}
            if (!isSafeRedirectUrl(downloadResult, ownHost)) {
                return res.status(400).send("Cible de redirection invalide.");
            }
            resolutionCache.set(resolutionKey, downloadResult);
            // Succès : Redirection 302 instantanée vers le CDN du provider
            return res.redirect(302, downloadResult);
        }
        if (downloadResult.downloading) {
            return res.status(200).send(`
                <!DOCTYPE html>
                <html lang="fr">
                <head>
                    <meta charset="utf-8">
                    <title>${providerName} • Téléchargement en cours</title>
                </head>
                <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; text-align:center; padding:50px 20px; background:#07090e; color:#eee;">
                    <div style="max-width:500px; margin:0 auto; background:#0d121d; border:1px solid #1a2333; border-radius:18px; padding:32px;">
                        <div style="font-size:48px; margin-bottom:12px;">⏳</div>
                        <h2 style="color:#38bdf8; margin-bottom:12px;">Téléchargement ${providerName} en cours</h2>
                        <p style="font-size:14px; line-height:1.6; color:#94a3b8; margin-bottom:16px;">
                            Ce torrent a été envoyé avec succès à votre compte ${providerName}.<br>
                            Le fichier n'étant pas encore disponible en cache instantané, ${providerName} est en train de le récupérer via ses seeders.
                        </p>
                        <p style="font-size:12px; color:#64748b;">
                            Dès la fin du téléchargement, vous le retrouverez dans vos catalogues <strong>Mes Fichiers Cloud</strong> ou en relançant la lecture.
                        </p>
                    </div>
                </body>
                </html>
            `);
        }
    }

    // Le flux est inaccessible ou déblocage échoué :
    console.warn(
        `[Resolver] Échec résolution pour ${imdbId} (${targetFile}). Purge et bascule automatique en cours...`
    );

    // 1. Suppression immédiate de l'entrée morte en base SQLite
    if (targetFile.startsWith("hash_") || targetFile.startsWith("tb_hash_")) {
        deleteCachedTorrent(targetFile.replace(/^(tb_)?hash_/, ""));
    } else {
        deleteMovieVersion(imdbId, targetFile);
    }

    // 2. Sélection automatique du meilleur candidat suivant dans le cache SQLite
    if (!isTorbox) {
        // A. Recherche dans la table movies (fichiers cloud AllDebrid)
        const nextCandidate = getNextMovieCandidate(imdbId, targetFile);
        if (nextCandidate && nextCandidate.alldebridId) {
            console.log(
                `[Resolver] Candidat suivant trouvé pour ${imdbId} : ${nextCandidate.alldebridId} (${nextCandidate.filename})`
            );
            const fallbackUrl = await unlockFileTarget(activeApiKey, nextCandidate.alldebridId, imdbId, allowDownload);
            if (typeof fallbackUrl === "string") {
                console.log(`[Resolver] Failover réussi vers ${nextCandidate.filename} !`);
                resolutionCache.set(resolutionKey, fallbackUrl);
                return res.redirect(302, fallbackUrl);
            }
            console.warn(
                `[Resolver] Candidat ${nextCandidate.alldebridId} (${nextCandidate.filename}) également indisponible — purgé.`
            );
            deleteMovieVersion(imdbId, nextCandidate.alldebridId);
        }
    }

    // B. Élargissement du failover vers les flux cached_torrents
    const currentHash = targetFile.replace(/^(tb_)?hash_/, "").toLowerCase();
    const cachedTorrents = getCachedTorrentsByImdb(imdbId);
    const nextTorrent = cachedTorrents.find(t => t.infoHash && t.infoHash.toLowerCase() !== currentHash);
    if (nextTorrent && nextTorrent.infoHash) {
        console.log(
            `[Resolver] Candidat torrent suivant trouvé pour ${imdbId} : ${nextTorrent.infoHash} (${nextTorrent.title}) [${providerName}]`
        );
        const fallbackTarget = isTorbox ? `tb_hash_${nextTorrent.infoHash}` : `hash_${nextTorrent.infoHash}`;
        const fallbackTorrentUrl = isTorbox
            ? await unlockTorboxFileTarget(activeApiKey, fallbackTarget, imdbId, allowDownload)
            : await unlockFileTarget(activeApiKey, fallbackTarget, imdbId, allowDownload);

        if (typeof fallbackTorrentUrl === "string") {
            console.log(`[Resolver] Failover réussi vers torrent ${nextTorrent.title} !`);
            resolutionCache.set(resolutionKey, fallbackTorrentUrl);
            return res.redirect(302, fallbackTorrentUrl);
        }
        deleteCachedTorrent(nextTorrent.infoHash);
    }

    // Aucun flux valide
    return res.status(404).send(`
        <html>
            <body style="font-family:sans-serif; text-align:center; padding:50px; background:#111; color:#eee;">
                <h2>⚠️ Flux indisponible</h2>
                <p>Le lien source n'est plus accessible sur ${providerName} et a été automatiquement retiré du cache.</p>
                <p>Veuillez rafraîchir Stremio pour sélectionner une autre version.</p>
            </body>
        </html>
    `);
}

module.exports = {
    handleResolve,
    resolveUserApiKey,
    resolveUserConfig,
    testStreamAlive,
    pickBestVideoFile,
    unlockFileTarget,
    unlockTorboxFileTarget
};
