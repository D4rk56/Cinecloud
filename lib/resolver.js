"use strict";

const axios = require("axios");
const { getUserByUuid, deleteMovieVersion, getNextMovieCandidate, deleteCachedTorrent } = require("./db");
const { decryptConfig } = require("./crypto");
const { unlockLink, adPost, adGet, adHeaders } = require("./alldebrid");

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
                timeout: 3000,
                maxRedirects: 3,
                validateStatus: (status) => (status === 200 || status === 206 || status === 302)
            });
            return rangeRes.status === 200 || rangeRes.status === 206 || rangeRes.status === 302;
        } catch (e2) {
            return false;
        }
    }
}

/**
 * Débloque un fichier spécifique à partir de son alldebridId ou hash
 */
async function unlockFileTarget(apiKey, fileRef) {
    if (!fileRef || !apiKey) return null;

    // Cas 1 : Lien brut ou URL encodée
    if (fileRef.startsWith("http://") || fileRef.startsWith("https://")) {
        const unlock = await unlockLink(fileRef, apiKey);
        if (unlock.success && unlock.downloadUrl) {
            return unlock.downloadUrl;
        }
    }

    // Cas 2 : Hash de torrent (hash_<infoHash>)
    if (fileRef.startsWith("hash_")) {
        const infoHash = fileRef.replace("hash_", "");
        try {
            const uploadRes = await adGet("/v4/magnet/upload", apiKey, { "magnets[]": infoHash });
            const magData = uploadRes.data && uploadRes.data.data && uploadRes.data.data.magnets && uploadRes.data.data.magnets[0];
            if (magData && magData.id) {
                const filesRes = await adPost("/v4/magnet/files", apiKey, { "id[]": magData.id });
                const magnetFiles = filesRes.data && filesRes.data.data && filesRes.data.data.magnets && filesRes.data.data.magnets[0];
                if (magnetFiles && magnetFiles.files) {
                    const flat = flattenFiles(magnetFiles.files).filter(f => f.l && isRealVideoFile(f.n));
                    if (flat.length > 0) {
                        // Prendre le plus volumineux (meilleure qualité)
                        flat.sort((a, b) => (b.s || 0) - (a.s || 0));
                        const unlock = await unlockLink(flat[0].l, apiKey);
                        if (unlock.success && unlock.downloadUrl) {
                            return unlock.downloadUrl;
                        }
                    }
                }
            }
        } catch (err) {
            console.error(`[Resolver] Erreur déblocage hash ${infoHash}:`, err.message);
        }
        return null;
    }

    // Cas 3 : ID de magnet AllDebrid (numérique)
    if (/^\d+$/.test(fileRef)) {
        try {
            const filesRes = await adPost("/v4/magnet/files", apiKey, { "id[]": fileRef });
            const magnetFiles = filesRes.data && filesRes.data.data && filesRes.data.data.magnets && filesRes.data.data.magnets[0];
            if (magnetFiles && magnetFiles.files) {
                const flat = flattenFiles(magnetFiles.files).filter(f => f.l && isRealVideoFile(f.n));
                if (flat.length > 0) {
                    flat.sort((a, b) => (b.s || 0) - (a.s || 0));
                    const unlock = await unlockLink(flat[0].l, apiKey);
                    if (unlock.success && unlock.downloadUrl) {
                        return unlock.downloadUrl;
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

function flattenFiles(entries) {
    let result = [];
    for (const e of entries) {
        if (e.e) {
            result = result.concat(flattenFiles(e.e));
        } else {
            result.push(e);
        }
    }
    return result;
}

function isRealVideoFile(filename) {
    if (!filename) return false;
    const lower = filename.toLowerCase();
    const videoExts = [".mkv", ".mp4", ".avi", ".mov", ".m4v", ".ts", ".webm"];
    const isVideo = videoExts.some(ext => lower.endsWith(ext));
    if (!isVideo) return false;
    const sampleKeywords = ["sample", "trailer", "promo", "preview", "bonus"];
    return !sampleKeywords.some(w => lower.includes(w));
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

    let targetFile = decodeURIComponent(fileRef);

    // Tentative 1 : Résolution de la cible demandée
    let downloadUrl = await unlockFileTarget(apiKey, targetFile);
    let isAlive = downloadUrl ? await testStreamAlive(downloadUrl) : false;

    if (downloadUrl && isAlive) {
        // Succès : Redirection 302 instantanée vers le CDN AllDebrid
        return res.redirect(302, downloadUrl);
    }

    // Le flux est mort ou inaccessible (404/410/403) :
    console.warn(`[Resolver] Flux mort détecté pour ${imdbId} (${targetFile}). Purge et bascule automatique en cours...`);

    // 1. Suppression immédiate de l'entrée morte en base SQLite
    if (targetFile.startsWith("hash_")) {
        deleteCachedTorrent(targetFile.replace("hash_", ""));
    } else {
        deleteMovieVersion(imdbId, targetFile);
    }

    // 2. Sélection automatique du meilleur candidat suivant dans le cache SQLite
    const nextCandidate = getNextMovieCandidate(imdbId, targetFile);
    if (nextCandidate && nextCandidate.alldebridId) {
        console.log(`[Resolver] Candidat suivant trouvé pour ${imdbId} : ${nextCandidate.alldebridId} (${nextCandidate.filename})`);
        const fallbackUrl = await unlockFileTarget(apiKey, nextCandidate.alldebridId);
        if (fallbackUrl && await testStreamAlive(fallbackUrl)) {
            console.log(`[Resolver] Failover réussi vers ${nextCandidate.filename} !`);
            return res.redirect(302, fallbackUrl);
        }
        // Si le suivant est également mort, on le purge également
        deleteMovieVersion(imdbId, nextCandidate.alldebridId);
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
    testStreamAlive
};
