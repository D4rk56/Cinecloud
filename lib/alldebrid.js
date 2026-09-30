"use strict";

const axios = require("axios");
const { ProxyAgent } = require("proxy-agent");

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const PROXY_URL = process.env.WARP_PROXY;

let warpAgent = null;
let warpActive = false;

if (PROXY_URL) {
    try {
        warpAgent = new ProxyAgent({ uri: PROXY_URL });
        warpActive = true;
    } catch (e) {
        console.warn(`[Proxy] Erreur configuration proxy WARP (${PROXY_URL}):`, e.message);
        warpActive = false;
    }
}

// Instance Axios ISOLÉE exclusivement pour l'API AllDebrid
const alldebridApi = axios.create({
    baseURL: "https://api.alldebrid.com",
    timeout: 10000,
    headers: {
        "User-Agent": BROWSER_UA,
        "Accept": "application/json"
    },
    httpAgent: warpActive ? warpAgent : undefined,
    httpsAgent: warpActive ? warpAgent : undefined
});

// Avertissement unique au démarrage si le proxy est configuré mais inaccessible
let healthcheckDone = false;
async function verifyWarpConnectivity() {
    if (!PROXY_URL || healthcheckDone) return;
    healthcheckDone = true;
    try {
        // Test rapide vers AllDebrid à travers le proxy
        await alldebridApi.get("/v4/user", {
            headers: { "User-Agent": BROWSER_UA },
            timeout: 5000
        }).catch(err => {
            // Si c'est une 401 Unauthorized, le proxy fonctionne et a bien joint AllDebrid !
            if (err.response && (err.response.status === 401 || err.response.status === 403)) {
                return;
            }
            throw err;
        });
        console.log(`[Proxy] Proxy WARP actif et opérationnel pour AllDebrid (${PROXY_URL}).`);
    } catch (err) {
        console.warn(`[Proxy] Avertissement: Le proxy WARP (${PROXY_URL}) n'est pas joignable (${err.message}). Les requêtes AllDebrid s'exécuteront en direct.`);
        alldebridApi.defaults.httpAgent = undefined;
        alldebridApi.defaults.httpsAgent = undefined;
        warpActive = false;
    }
}

// Lancement de la vérification non-bloquante au démarrage
if (PROXY_URL) {
    setTimeout(verifyWarpConnectivity, 1500);
}

function adHeaders(apiKey) {
    return {
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": BROWSER_UA,
        "Accept": "application/json"
    };
}

async function adGet(endpoint, apiKey, params = {}) {
    const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    return alldebridApi.get(cleanEndpoint, {
        headers: adHeaders(apiKey),
        params,
        timeout: 10000
    });
}

async function adPost(endpoint, apiKey, data = {}) {
    const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(data)) {
        if (v !== undefined && v !== null) {
            if (Array.isArray(v)) {
                for (const item of v) form.append(`${k}[]`, String(item));
            } else {
                form.append(k, String(v));
            }
        }
    }
    return alldebridApi.post(cleanEndpoint, form.toString(), {
        headers: {
            ...adHeaders(apiKey),
            "Content-Type": "application/x-www-form-urlencoded"
        },
        timeout: 10000
    });
}

/**
 * Débloque un lien via /v4/link/unlock
 */
async function unlockLink(link, apiKey) {
    try {
        const res = await adPost("/v4/link/unlock", apiKey, { link });
        if (res.data && res.data.status === "success" && res.data.data && res.data.data.link) {
            return {
                success: true,
                downloadUrl: res.data.data.link,
                filename: res.data.data.filename,
                filesize: res.data.data.filesize
            };
        }
        return {
            success: false,
            error: (res.data && res.data.error) ? res.data.error.message : "Échec du débridage AllDebrid"
        };
    } catch (err) {
        return {
            success: false,
            error: err.response ? `HTTP ${err.response.status}` : err.message
        };
    }
}

/**
 * Vérifie la disponibilité instantanée d'une liste de magnets/hashes
 * @param {string[]} hashes
 * @param {string} apiKey
 */
async function checkInstantMagnets(hashes, apiKey) {
    if (!hashes || hashes.length === 0) return {};
    const map = {};
    const BATCH_SIZE = 25;

    for (let i = 0; i < hashes.length; i += BATCH_SIZE) {
        const batch = hashes.slice(i, i + BATCH_SIZE);
        // Garantit que chaque hash est envoyé sous forme d'URI magnet valide (requis par AllDebrid)
        const magnetUris = batch.map(h => {
            const str = String(h).trim();
            return str.startsWith("magnet:") ? str : `magnet:?xt=urn:btih:${str}`;
        });

        try {
            const res = await adPost("/v4/magnet/upload", apiKey, { magnets: magnetUris });
            if (res.data && res.data.status === "success" && res.data.data && res.data.data.magnets) {
                const toDelete = [];
                for (const item of res.data.data.magnets) {
                    const isReady = item.ready === true;
                    let itemHash = item.hash ? item.hash.toLowerCase() : "";
                    if (!itemHash && item.magnet) {
                        const m = item.magnet.match(/btih:([a-f0-9]{40})/i);
                        if (m) itemHash = m[1].toLowerCase();
                    }

                    if (itemHash) {
                        map[itemHash] = isReady;
                    }
                    if (item.magnet) {
                        map[item.magnet.toLowerCase()] = isReady;
                    }
                    if (item.id) {
                        toDelete.push(item.id);
                    }
                }
                // Nettoyage immédiat en arrière-plan des magnets temporaires créés pour le test
                if (toDelete.length > 0) {
                    for (const id of toDelete) {
                        adGet("/v4/magnet/delete", apiKey, { id }).catch(() => {});
                    }
                }
            }
        } catch (err) {
            console.warn("[AllDebrid] Note vérification disponibilité magnets :", err.response ? `HTTP ${err.response.status}` : err.message);
        }
    }
    return map;
}

/**
 * Récupère les fichiers internes de magnets AllDebrid via /v4.1/magnet/files
 * @param {Array<number|string>} magnetIds
 * @param {string} apiKey
 * @returns {Promise<Object>} Map { [magnetId]: Array<fileObject> }
 */
async function getMagnetFiles(magnetIds, apiKey) {
    if (!magnetIds || magnetIds.length === 0) return {};
    const ids = Array.isArray(magnetIds) ? magnetIds : [magnetIds];
    const map = {};

    const BATCH_SIZE = 30;
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const batch = ids.slice(i, i + BATCH_SIZE);
        try {
            let res;
            try {
                res = await adPost("/v4/magnet/files", apiKey, { id: batch });
            } catch (e) {
                res = await adPost("/v4.1/magnet/files", apiKey, { id: batch });
            }
            if (res && res.data && res.data.status === "success" && res.data.data && res.data.data.magnets) {
                for (const m of res.data.data.magnets) {
                    if (m.id && m.files) {
                        map[m.id] = m.files;
                    }
                }
            }
        } catch (err) {
            // Ignorer silencieusement
        }
    }
    return map;
}

module.exports = {
    alldebridApi,
    adHeaders,
    adGet,
    adPost,
    unlockLink,
    checkInstantMagnets,
    getMagnetFiles,
    verifyWarpConnectivity
};
