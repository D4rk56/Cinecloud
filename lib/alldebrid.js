"use strict";

const axios = require("axios");
const { SocksProxyAgent } = require("socks-proxy-agent");
const { ProxyAgent } = require("proxy-agent");

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const PROXY_URL = process.env.WARP_PROXY || process.env.HTTP_PROXY || process.env.HTTPS_PROXY;

/**
 * Crée un agent proxy adapté au protocole (SOCKS5, SOCKS5h, SOCKS4, HTTP, HTTPS)
 * avec normalisation automatique des URLs sans protocole explicite.
 */
function createProxyAgent(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") return null;
    let url = rawUrl.trim();
    if (!url) return null;

    // Normalisation : si aucun protocole n'est spécifié (ex: "warp:1080" ou "127.0.0.1:1080")
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) {
        url = `http://${url}`;
    }

    try {
        const parsed = new URL(url);
        const protocol = parsed.protocol.toLowerCase();

        // 1. Détection des protocoles SOCKS (socks5, socks5h, socks4, socks4a, socks)
        if (protocol.startsWith("socks")) {
            return new SocksProxyAgent(url, {
                timeout: 8000
            });
        }

        // 2. Protocoles HTTP / HTTPS ou autres via ProxyAgent
        return new ProxyAgent({
            getProxyForUrl: () => url
        });
    } catch (e) {
        console.warn(`[Proxy] Impossible d'analyser l'URL de proxy (${rawUrl}):`, e.message);
        return null;
    }
}

let warpAgent = null;
let warpActive = false;
let warpCheckTimer = null;

if (PROXY_URL) {
    try {
        warpAgent = createProxyAgent(PROXY_URL);
        warpActive = Boolean(warpAgent);
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
    httpsAgent: warpActive ? warpAgent : undefined,
    proxy: false
});

function isProxyTransportError(err) {
    if (!err) return false;
    const code = err.code || "";
    const msg = (err.message || "").toLowerCase();
    return code === "ENOTFOUND" ||
           code === "ECONNREFUSED" ||
           code === "EHOSTUNREACH" ||
           code === "ECONNRESET" ||
           code === "ETIMEDOUT" ||
           code === "ECONNABORTED" ||
           msg.includes("enotfound") ||
           msg.includes("econnrefused") ||
           msg.includes("ehostunreach") ||
           msg.includes("econnreset") ||
           msg.includes("etimedout") ||
           msg.includes("timeout") ||
           msg.includes("timed out") ||
           msg.includes("proxy") ||
           msg.includes("socks") ||
           msg.includes("socket closed") ||
           msg.includes("handshake");
}

function disableWarpWithFallback(reason) {
    if (warpActive) {
        warpActive = false;
        alldebridApi.defaults.httpAgent = undefined;
        alldebridApi.defaults.httpsAgent = undefined;
        delete alldebridApi.defaults.httpAgent;
        delete alldebridApi.defaults.httpsAgent;
        console.warn(`[Proxy] Avertissement: Proxy WARP désactivé (${reason}). Bascule automatique en accès direct pour AllDebrid.`);
        scheduleWarpCheck();
    }
}

function scheduleWarpCheck(intervalMs = 60000) {
    if (warpCheckTimer || !PROXY_URL) return;
    warpCheckTimer = setTimeout(async () => {
        warpCheckTimer = null;
        try {
            await axios.get("https://api.alldebrid.com/v4/user", {
                httpAgent: warpAgent,
                httpsAgent: warpAgent,
                proxy: false,
                timeout: 5000,
                headers: { "User-Agent": BROWSER_UA }
            }).catch(e => {
                if (e.response && [200, 401, 403].includes(e.response.status)) return;
                throw e;
            });
            console.log(`[Proxy] Proxy WARP opérationnel (${PROXY_URL}). Réactivation du proxy.`);
            warpActive = true;
            alldebridApi.defaults.httpAgent = warpAgent;
            alldebridApi.defaults.httpsAgent = warpAgent;
        } catch (e) {
            scheduleWarpCheck(intervalMs);
        }
    }, intervalMs);
    if (warpCheckTimer.unref) {
        warpCheckTimer.unref();
    }
}

// Vérification de connectivité au démarrage
async function verifyWarpConnectivity(retryCount = 0) {
    if (!PROXY_URL || !warpAgent) return;
    try {
        await axios.get("https://api.alldebrid.com/v4/user", {
            httpAgent: warpAgent,
            httpsAgent: warpAgent,
            proxy: false,
            headers: { "User-Agent": BROWSER_UA },
            timeout: 5000
        }).catch(err => {
            if (err.response && (err.response.status === 200 || err.response.status === 401 || err.response.status === 403)) {
                return;
            }
            throw err;
        });
        warpActive = true;
        alldebridApi.defaults.httpAgent = warpAgent;
        alldebridApi.defaults.httpsAgent = warpAgent;
        console.log(`[Proxy] Proxy WARP actif et opérationnel pour AllDebrid (${PROXY_URL}).`);
    } catch (err) {
        if (err.code === "ENOTFOUND" || err.code === "ECONNREFUSED") {
            disableWarpWithFallback(err.code || err.message);
        } else if (retryCount < 2) {
            setTimeout(() => verifyWarpConnectivity(retryCount + 1), 3000);
        } else {
            disableWarpWithFallback(err.message);
        }
    }
}

// Lancement de la vérification non-bloquante au démarrage
if (PROXY_URL) {
    setTimeout(() => verifyWarpConnectivity(0), 1000);
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
    try {
        return await alldebridApi.get(cleanEndpoint, {
            headers: adHeaders(apiKey),
            params,
            timeout: 10000
        });
    } catch (err) {
        if (warpActive && isProxyTransportError(err)) {
            disableWarpWithFallback(err.code || err.message);
            return axios.get(`https://api.alldebrid.com${cleanEndpoint}`, {
                headers: adHeaders(apiKey),
                params,
                timeout: 10000,
                proxy: false
            });
        }
        throw err;
    }
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
    const bodyStr = form.toString();
    const headers = {
        ...adHeaders(apiKey),
        "Content-Type": "application/x-www-form-urlencoded"
    };

    try {
        return await alldebridApi.post(cleanEndpoint, bodyStr, {
            headers,
            timeout: 10000
        });
    } catch (err) {
        if (warpActive && isProxyTransportError(err)) {
            disableWarpWithFallback(err.code || err.message);
            return axios.post(`https://api.alldebrid.com${cleanEndpoint}`, bodyStr, {
                headers,
                timeout: 10000,
                proxy: false
            });
        }
        throw err;
    }
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
    const BATCH_SIZE = 10;

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
                // Nettoyage immédiat des magnets temporaires avec attente pour ne pas saturer les 30 slots
                if (toDelete.length > 0) {
                    await Promise.all(toDelete.map(id => adGet("/v4/magnet/delete", apiKey, { id }).catch(() => {})));
                }
            } else if (res.data && res.data.status === "error") {
                console.warn("[AllDebrid] Note vérification disponibilité magnets :", res.data.error?.message || res.data.error?.code || "Réponse d'erreur API");
                break;
            }
        } catch (err) {
            console.warn("[AllDebrid] Note vérification disponibilité magnets :", err.response ? `HTTP ${err.response.status}` : err.message);
            break;
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
            if (!res || !res.data || res.data.status !== "success") {
                res = await adGet("/v4/magnet/files", apiKey, { id: batch.length === 1 ? batch[0] : batch }).catch(() => null);
            }
            if (res && res.data && res.data.status === "success" && res.data.data) {
                if (Array.isArray(res.data.data.magnets)) {
                    for (const m of res.data.data.magnets) {
                        if (m.id && (m.files || m.links)) {
                            map[m.id] = m.files || m.links;
                        }
                    }
                } else if (res.data.data.files && batch.length === 1) {
                    map[batch[0]] = res.data.data.files;
                }
            }
        } catch (err) {
            // Ignorer silencieusement
        }
    }
    return map;
}

function isWarpActive() {
    return warpActive;
}

function getWarpStatus() {
    let mode = "direct";
    if (PROXY_URL) {
        const lower = PROXY_URL.toLowerCase();
        if (lower.startsWith("socks5h://")) mode = "socks5h";
        else if (lower.startsWith("socks5://")) mode = "socks5";
        else if (lower.startsWith("socks")) mode = "socks";
        else mode = "http";
    }

    return {
        configured: Boolean(PROXY_URL),
        proxyUrl: PROXY_URL ? PROXY_URL.replace(/:\/\/[^@]*@/, "://***@") : null,
        active: warpActive,
        mode: warpActive ? mode : (PROXY_URL ? "fallback_direct" : "direct")
    };
}

async function checkAllDebridKey(apiKey) {
    if (!apiKey || typeof apiKey !== "string" || apiKey.trim() === "") {
        return { valid: false, error: "La clé API AllDebrid est requise." };
    }
    const key = apiKey.trim();
    try {
        const res = await adGet("/v4/user", key, { agent: "cinécloud" });
        if (res.data && res.data.status === "success" && res.data.data && res.data.data.user) {
            const u = res.data.data.user;
            return {
                valid: true,
                username: u.username || "Utilisateur",
                email: u.email || "",
                isPremium: Boolean(u.isPremium),
                premiumUntil: u.premiumUntil || 0
            };
        }
        return {
            valid: false,
            error: (res.data && res.data.error && res.data.error.message) || "Clé API AllDebrid invalide"
        };
    } catch (err) {
        const msg = err.response?.data?.error?.message || err.message;
        return { valid: false, error: msg };
    }
}

module.exports = {
    alldebridApi,
    adHeaders,
    adGet,
    adPost,
    unlockLink,
    checkInstantMagnets,
    getMagnetFiles,
    verifyWarpConnectivity,
    isWarpActive,
    getWarpStatus,
    checkAllDebridKey,
    disableWarpWithFallback,
    createProxyAgent
};
