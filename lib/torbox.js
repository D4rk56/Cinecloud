"use strict";

const axios = require("axios");

const TORBOX_API_BASE = "https://api.torbox.app/v1/api";
const BROWSER_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const torboxApi = axios.create({
    baseURL: TORBOX_API_BASE,
    timeout: 10000,
    headers: {
        "User-Agent": BROWSER_UA,
        Accept: "application/json"
    }
});

/**
 * Vérifie la validité d'une clé API Torbox et récupère les informations du compte
 */
async function checkTorboxKey(apiKey) {
    if (!apiKey || typeof apiKey !== "string" || apiKey.trim() === "") {
        return { valid: false, error: "Clé API Torbox requise." };
    }

    try {
        const cleanKey = apiKey.trim();
        const res = await torboxApi.get("/user/me", {
            headers: {
                Authorization: `Bearer ${cleanKey}`
            },
            timeout: 7000
        });

        if (res.data && res.data.success && res.data.data) {
            const data = res.data.data;
            const planNames = { 0: "Gratuit", 1: "Essential", 2: "Standard", 3: "Pro" };
            const planName = planNames[data.plan] || `Plan #${data.plan}`;
            const email = data.email || "Utilisateur Torbox";
            return {
                valid: true,
                username: email,
                email: email,
                plan: data.plan,
                planName: planName,
                isPremium: Boolean(data.is_subscribed || (data.plan && data.plan > 0)),
                customer: data.customer
            };
        }

        return {
            valid: false,
            error: res.data?.detail || "Clé API Torbox invalide ou non reconnue."
        };
    } catch (err) {
        const status = err.response?.status;
        const detail = err.response?.data?.detail || err.response?.data?.message || err.message;
        if (status === 401 || status === 403) {
            return { valid: false, error: "Clé API Torbox non autorisée (401/403)." };
        }
        return { valid: false, error: `Erreur Torbox: ${detail}` };
    }
}

/**
 * Vérifie instantanément le cache Torbox pour une liste de hashes (jusqu'à 100 par lot)
 * Retourne un objet indexé par infoHash en minuscules : { [hash]: true }
 */
async function checkInstantTorbox(hashes, apiKey) {
    if (!hashes || !Array.isArray(hashes) || hashes.length === 0 || !apiKey) {
        return {};
    }

    const uniqueHashes = [...new Set(hashes.map(h => (h || "").trim().toLowerCase()).filter(Boolean))];
    if (uniqueHashes.length === 0) return {};

    const cleanKey = apiKey.trim();
    const instantMap = {};
    const detailsMap = {};

    // Découpage en lots de 50 pour respecter les limites HTTP et de l'API Torbox
    const BATCH_SIZE = 50;
    for (let i = 0; i < uniqueHashes.length; i += BATCH_SIZE) {
        const batch = uniqueHashes.slice(i, i + BATCH_SIZE);
        try {
            const res = await torboxApi.get("/torrents/checkcached", {
                params: {
                    hash: batch.join(","),
                    format: "object",
                    list_files: "true"
                },
                headers: {
                    Authorization: `Bearer ${cleanKey}`
                },
                timeout: 8000
            });

            if (res.data && res.data.success && res.data.data) {
                const data = res.data.data;
                // Cas 1 : format objet { "<hash>": { name, size, files, ... } }
                if (typeof data === "object" && !Array.isArray(data)) {
                    for (const [k, v] of Object.entries(data)) {
                        if (v) {
                            const h = k.toLowerCase();
                            instantMap[h] = true;
                            detailsMap[h] = v;
                        }
                    }
                } else if (Array.isArray(data)) {
                    // Cas 2 : format liste [ { hash, name, size, files, ... } ]
                    for (const item of data) {
                        if (item && item.hash) {
                            const h = item.hash.toLowerCase();
                            instantMap[h] = true;
                            detailsMap[h] = item;
                        }
                    }
                }
            }
        } catch (err) {
            console.warn(`[Torbox] Erreur lors de checkInstantTorbox (lot ${i}):`, err.message);
        }
    }

    instantMap._details = detailsMap;
    return instantMap;
}

/**
 * Crée un torrent sur Torbox via son magnet ou infoHash
 */
async function createTorboxTorrent(magnetOrHash, apiKey, seed = 1) {
    if (!magnetOrHash || !apiKey) {
        return { success: false, error: "Magnet et clé API requis." };
    }

    const cleanKey = apiKey.trim();
    let magnetUri = magnetOrHash;
    if (!magnetUri.startsWith("magnet:")) {
        magnetUri = `magnet:?xt=urn:btih:${magnetOrHash}`;
    }

    try {
        const params = new URLSearchParams();
        params.append("magnet", magnetUri);
        params.append("seed", String(seed));
        params.append("allow_zip", "false");

        const res = await torboxApi.post("/torrents/createtorrent", params.toString(), {
            headers: {
                Authorization: `Bearer ${cleanKey}`,
                "Content-Type": "application/x-www-form-urlencoded"
            },
            timeout: 10000
        });

        if (res.data && res.data.success && res.data.data) {
            return {
                success: true,
                torrentId: res.data.data.torrent_id,
                authId: res.data.data.auth_id,
                hash: res.data.data.hash,
                data: res.data.data
            };
        }

        return {
            success: false,
            error: res.data?.detail || "Échec de l'ajout du torrent sur Torbox"
        };
    } catch (err) {
        const detail = err.response?.data?.detail || err.response?.data?.message || err.message;
        return { success: false, error: `Erreur ajout torrent Torbox: ${detail}` };
    }
}

/**
 * Récupère la liste des torrents du compte Torbox (ou un torrent spécifique si id fourni)
 */
async function getTorboxTorrentList(apiKey, id = null) {
    if (!apiKey) return [];
    const cleanKey = apiKey.trim();

    try {
        const url = id ? `/torrents/mylist?id=${encodeURIComponent(id)}` : "/torrents/mylist";
        const res = await torboxApi.get(url, {
            headers: {
                Authorization: `Bearer ${cleanKey}`
            },
            timeout: 9000
        });

        if (res.data && res.data.success) {
            const data = res.data.data;
            if (Array.isArray(data)) return data;
            if (data && typeof data === "object") return [data];
        }
        return [];
    } catch (err) {
        console.warn(`[Torbox] Erreur getTorboxTorrentList:`, err.message);
        return [];
    }
}

/**
 * Récupère les métadonnées et fichiers d'un torrent Torbox spécifique
 */
async function getTorboxTorrentInfo(torrentId, apiKey) {
    if (!torrentId || !apiKey) return null;
    const list = await getTorboxTorrentList(apiKey, torrentId);
    if (list && list.length > 0) {
        return list.find(t => String(t.id) === String(torrentId)) || list[0];
    }
    return null;
}

/**
 * Génère ou récupère l'URL de streaming CDN d'un fichier Torbox
 * Si redirect === true, renvoie le lien permanent de redirection 302
 */
async function getTorboxStreamUrl(torrentId, fileId, apiKey, redirect = false) {
    if (!torrentId || !fileId || !apiKey) return null;
    const cleanKey = apiKey.trim();

    if (redirect) {
        return `${TORBOX_API_BASE}/torrents/requestdl?token=${encodeURIComponent(cleanKey)}&torrent_id=${encodeURIComponent(torrentId)}&file_id=${encodeURIComponent(fileId)}&redirect=true`;
    }

    try {
        const res = await torboxApi.get("/torrents/requestdl", {
            params: {
                token: cleanKey,
                torrent_id: torrentId,
                file_id: fileId,
                redirect: "false"
            },
            headers: {
                Authorization: `Bearer ${cleanKey}`
            },
            timeout: 8000
        });

        if (res.data && res.data.success && res.data.data) {
            return res.data.data;
        }
        return null;
    } catch (err) {
        console.warn(`[Torbox] Erreur getTorboxStreamUrl (torrentId: ${torrentId}, fileId: ${fileId}):`, err.message);
        return null;
    }
}

/**
 * Supprime un torrent du compte Torbox
 */
async function deleteTorboxTorrent(torrentId, apiKey) {
    if (!torrentId || !apiKey) return false;
    const cleanKey = apiKey.trim();

    try {
        const res = await torboxApi.post(
            "/torrents/controltorrent",
            {
                torrent_id: torrentId,
                operation: "delete"
            },
            {
                headers: {
                    Authorization: `Bearer ${cleanKey}`,
                    "Content-Type": "application/json"
                },
                timeout: 7000
            }
        );

        return Boolean(res.data && res.data.success);
    } catch (err) {
        console.warn(`[Torbox] Erreur deleteTorboxTorrent (${torrentId}):`, err.message);
        return false;
    }
}

module.exports = {
    TORBOX_API_BASE,
    torboxApi,
    checkTorboxKey,
    checkInstantTorbox,
    createTorboxTorrent,
    getTorboxTorrentList,
    getTorboxTorrentInfo,
    getTorboxStreamUrl,
    deleteTorboxTorrent
};
