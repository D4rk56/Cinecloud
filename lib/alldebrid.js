"use strict";

const axios = require("axios");
const { SocksProxyAgent } = require("socks-proxy-agent");
const { ProxyAgent } = require("proxy-agent");
const { makeLRU } = require("./helpers");

const instantCacheLRU = makeLRU(1000, 3600_000); // Cache mémoire 1 heure

// Cibles AllDebrid rejetées de façon définitive (magnet absent, aucun fichier vidéo
// exploitable, déblocage en échec). Évite de rejouer les mêmes appels API à chaque
// requête du client (Stremio interroge l'URL /resolve deux fois par clic).
const deadTargets = makeLRU(500, 10 * 60 * 1000);
const DEAD_TARGET_LOG_MS = 10 * 60 * 1000;

/**
 * Un magnet AllDebrid n'est lisible que s'il est PRÊT (statusCode 4 = Ready, ou ready: true).
 * Sémantique volontairement tolérante : un état non rapporté par l'API ne masque jamais
 * un contenu (on n'exclut que ce qui est explicitement non prêt : 0-3 en cours, 5+ en erreur).
 * Même règle que cleanupPendingMagnets() et le resolver.
 */
function isAllDebridMagnetReady(magnet) {
    if (!magnet) return false;
    if (magnet.ready === true) return true;
    const code = Number(magnet.statusCode);
    if (!Number.isFinite(code)) return true;
    return code === 4;
}

/** La cible (id magnétique, hash_..., ad_series:...) a-t-elle déjà échoué récemment ? */
function isAllDebridTargetDead(targetRef) {
    if (!targetRef) return false;
    return deadTargets.has(String(targetRef));
}

/** Met une cible en quarantaine (10 min) et journalise une seule fois. */
function markAllDebridTargetDead(targetRef, reason) {
    if (!targetRef) return;
    const key = String(targetRef);
    if (deadTargets.has(key)) return;
    deadTargets.set(key, { reason: reason || "indisponible", at: Date.now() });
    console.warn(
        `[Resolver] Cible ${key} mise en quarantaine ${DEAD_TARGET_LOG_MS / 60000} min (${reason || "indisponible"}).`
    );
}

/** Réinitialise la quarantaine (tests / maintenance). */
function resetAllDebridDeadTargets() {
    deadTargets.clear();
}

const BROWSER_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
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
        Accept: "application/json"
    },
    httpAgent: warpActive ? warpAgent : undefined,
    httpsAgent: warpActive ? warpAgent : undefined,
    proxy: false
});

function isProxyTransportError(err) {
    if (!err) return false;
    const code = err.code || "";
    const msg = (err.message || "").toLowerCase();
    return (
        code === "ENOTFOUND" ||
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
        msg.includes("handshake")
    );
}

// Statuts HTTP justifiant une nouvelle tentative via l'autre chemin (proxy ↔ direct)
const FALLBACK_STATUS_CODES = [403, 500, 502, 503, 521, 522, 523, 524, 530];

let fallbackProxyAgent;
let fallbackProxyResolved = false;

// Egress dédié aux requêtes hors AllDebrid (ex. Torrentio) : permet de brancher un proxy
// qui fonctionne sans toucher au WARP utilisé par AllDebrid.
const FALLBACK_PROXY_URL = process.env.TORRENTIO_PROXY || PROXY_URL;

// Agent proxy partagé par les requêtes sortantes hors AllDebrid, résolu une seule fois.
function getFallbackProxyAgent() {
    if (!fallbackProxyResolved) {
        fallbackProxyResolved = true;
        fallbackProxyAgent = FALLBACK_PROXY_URL ? createProxyAgent(FALLBACK_PROXY_URL) : null;
    }
    return fallbackProxyAgent;
}

/**
 * Requête GET avec repli automatique proxy ↔ direct.
 *
 * Certains services (Cloudflare — ex. Torrentio) bloquent les IP datacenter : on tente
 * via le proxy (WARP ou TORRENTIO_PROXY) puis en direct, ou l'inverse selon `prefer`.
 * Chaque tentative est mémorisée sur l'erreur levée (`err.attempts`) afin que l'appelant
 * puisse diagnostiquer précisément quel chemin réseau a échoué et avec quel statut.
 *
 * @param {string} url
 * @param {object} [options] Options axios (headers, timeout, …)
 * @param {object|null} [proxyAgentOverride] Agent à utiliser (réservé aux tests)
 * @param {"auto"|"direct"} [prefer] Ordre des tentatives : "direct" essaie l'IP du serveur d'abord
 */
async function fetchWithWarpFallback(url, options = {}, proxyAgentOverride = undefined, prefer = "auto") {
    const { headers, timeout = 5000, ...rest } = options;
    const agent = proxyAgentOverride !== undefined ? proxyAgentOverride : getFallbackProxyAgent();

    const proxyAttempt = agent ? { httpAgent: agent, httpsAgent: agent, proxy: false } : null;
    const directAttempt = { proxy: false };

    // "direct" = on tente d'abord l'IP du serveur (utile quand le proxy est bloqué).
    const plan = prefer === "direct" && proxyAttempt ? [directAttempt, proxyAttempt] : [proxyAttempt, directAttempt];

    const attemptLog = [];
    let lastErr = null;

    for (const route of plan) {
        if (!route) continue;
        const path = route === directAttempt ? "direct" : "proxy";
        attemptLog.push(path);
        try {
            const res = await axios.get(url, { headers, timeout, ...route, ...rest });
            return res;
        } catch (err) {
            lastErr = err;
            const status = err.response && err.response.status;
            attemptLog[attemptLog.length - 1] = `${path}:${status || err.code || "?"}`;
            const retryable = isProxyTransportError(err) || (status && FALLBACK_STATUS_CODES.includes(status));
            if (!retryable) break;
        }
    }

    if (lastErr) {
        lastErr.attempts = attemptLog;
        lastErr.attemptsSummary = attemptLog.join(" • ");
        console.warn(`[Proxy] Échec des tentatives réseau : ${lastErr.attemptsSummary}`);
    }
    throw lastErr;
}

function disableWarpWithFallback(reason) {
    if (warpActive) {
        warpActive = false;
        alldebridApi.defaults.httpAgent = undefined;
        alldebridApi.defaults.httpsAgent = undefined;
        delete alldebridApi.defaults.httpAgent;
        delete alldebridApi.defaults.httpsAgent;
        console.warn(
            `[Proxy] Avertissement: Proxy WARP désactivé (${reason}). Bascule automatique en accès direct pour AllDebrid.`
        );
        scheduleWarpCheck();
    }
}

function scheduleWarpCheck(intervalMs = 60000) {
    if (warpCheckTimer || !PROXY_URL) return;
    warpCheckTimer = setTimeout(async () => {
        warpCheckTimer = null;
        try {
            await axios
                .get("https://api.alldebrid.com/v4/user", {
                    httpAgent: warpAgent,
                    httpsAgent: warpAgent,
                    proxy: false,
                    timeout: 5000,
                    headers: { "User-Agent": BROWSER_UA }
                })
                .catch(e => {
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
        await axios
            .get("https://api.alldebrid.com/v4/user", {
                httpAgent: warpAgent,
                httpsAgent: warpAgent,
                proxy: false,
                headers: { "User-Agent": BROWSER_UA },
                timeout: 5000
            })
            .catch(err => {
                if (
                    err.response &&
                    (err.response.status === 200 || err.response.status === 401 || err.response.status === 403)
                ) {
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
        Accept: "application/json"
    };
}

// Le réglage admin « Timeout Requêtes AllDebrid (ms) » était stocké, validé et affiché…
// mais jamais appliqué : les appels utilisaient 10 000 ms en dur. Il est désormais lu
// (cache 30 s pour éviter une lecture SQLite à chaque requête) et borne réellement la
// latence de chaque appel AllDebrid, donc du résolveur.
let cachedAllDebridTimeout = 0;
let cachedAllDebridTimeoutAt = 0;

function getAllDebridTimeoutMs() {
    if (cachedAllDebridTimeout && Date.now() - cachedAllDebridTimeoutAt < 30_000) {
        return cachedAllDebridTimeout;
    }
    let value = 10000;
    try {
        const settings = require("./db").getSystemSettings();
        const parsed = Number(settings && settings.httpTimeoutMs);
        if (Number.isFinite(parsed) && parsed >= 1000) value = parsed;
    } catch (e) {}
    cachedAllDebridTimeout = value;
    cachedAllDebridTimeoutAt = Date.now();
    return value;
}

async function adGet(endpoint, apiKey, params = {}) {
    const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    try {
        return await alldebridApi.get(cleanEndpoint, {
            headers: adHeaders(apiKey),
            params,
            timeout: getAllDebridTimeoutMs()
        });
    } catch (err) {
        if (warpActive && isProxyTransportError(err)) {
            disableWarpWithFallback(err.code || err.message);
            return axios.get(`https://api.alldebrid.com${cleanEndpoint}`, {
                headers: adHeaders(apiKey),
                params,
                timeout: getAllDebridTimeoutMs(),
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
            timeout: getAllDebridTimeoutMs()
        });
    } catch (err) {
        if (warpActive && isProxyTransportError(err)) {
            disableWarpWithFallback(err.code || err.message);
            return axios.post(`https://api.alldebrid.com${cleanEndpoint}`, bodyStr, {
                headers,
                timeout: getAllDebridTimeoutMs(),
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
            error: res.data && res.data.error ? res.data.error.message : "Échec du débridage AllDebrid"
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
    if (!hashes || hashes.length === 0 || !apiKey) return {};
    const map = {};
    const BATCH_SIZE = 20;
    const batches = [];
    for (let i = 0; i < hashes.length; i += BATCH_SIZE) {
        batches.push(hashes.slice(i, i + BATCH_SIZE));
    }

    const MAX_PARALLEL = 3;
    for (let i = 0; i < batches.length; i += MAX_PARALLEL) {
        const chunk = batches.slice(i, i + MAX_PARALLEL);
        const results = await Promise.all(
            chunk.map(async batch => {
                const magnetUris = batch.map(h => {
                    const str = String(h).trim();
                    return str.startsWith("magnet:") ? str : `magnet:?xt=urn:btih:${str}`;
                });
                try {
                    const res = await (module.exports.adGet || adGet)("/v4/magnet/instant", apiKey, {
                        magnets: magnetUris
                    }).catch(() => null);
                    if (res && res.data && res.data.status === "success" && res.data.data && res.data.data.magnets) {
                        return res.data.data.magnets;
                    }
                } catch (err) {}
                return [];
            })
        );

        for (const magnets of results) {
            for (const item of magnets) {
                const isReady = item.instant === true || item.ready === true;
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
            }
        }
    }
    return map;
}

/**
 * Pré-validation active du cache AllDebrid pour une liste de torrents Prowlarr
 * - Envoie les meilleurs candidats en un seul appel POST /v4/magnet/upload
 * - Détecte ready === true (en cache) et enregistre dans SQLite cached_torrents
 * - Détecte ready === false (non en cache) et supprime IMMÉDIATEMENT via deleteMagnet
 *   pour ne jamais polluer le compte ni bloquer les 30 slots de téléchargement.
 *
 * @param {Array<Object>} torrents - Liste d'objets torrents ({ infoHash, filename, title, size, indexer, seeders })
 * @param {string} apiKey - Clé API AllDebrid
 * @param {Object} options - { maxProbes = 8, imdbId = null, deleteUnready = true }
 * @returns {Promise<Object>} Map { [infoHash]: boolean }
 */
async function preValidateMagnets(torrents, apiKey, options = {}) {
    if (!Array.isArray(torrents) || torrents.length === 0 || !apiKey) return {};
    const { maxProbes = 8, imdbId = null, deleteUnready = true } = options;
    const map = {};
    const toProbe = [];

    for (const t of torrents) {
        const h = (t.infoHash || "").toLowerCase();
        if (!h) continue;
        if (instantCacheLRU.has(h)) {
            map[h] = instantCacheLRU.get(h);
        } else if (toProbe.length < maxProbes) {
            toProbe.push(t);
        }
    }

    if (toProbe.length === 0) return map;

    const magnetUris = toProbe.map(t => {
        const h = t.infoHash.toLowerCase();
        return h.startsWith("magnet:") ? h : `magnet:?xt=urn:btih:${h}`;
    });

    try {
        let uploadRes = await (module.exports.adPost || adPost)("/v4/magnet/upload", apiKey, {
            magnets: magnetUris
        }).catch(err => err.response || null);

        // Si quota 30 atteint, on déclenche un nettoyage des magnets bloqués
        if (
            uploadRes?.data?.status === "error" &&
            (uploadRes.data.error?.code === "MAGNET_TOO_MANY" || /too many/i.test(uploadRes.data.error?.message || ""))
        ) {
            cleanupPendingMagnets(apiKey).catch(() => {});
        }

        if (
            uploadRes?.data?.status === "success" &&
            uploadRes.data.data &&
            Array.isArray(uploadRes.data.data.magnets)
        ) {
            const returned = uploadRes.data.data.magnets;
            const unreadyIds = [];

            for (const item of returned) {
                let h = item.hash ? item.hash.toLowerCase() : "";
                if (!h && item.magnet) {
                    const m = item.magnet.match(/btih:([a-f0-9]{40})/i);
                    if (m) h = m[1].toLowerCase();
                }

                const isReady = Boolean(item.ready === true || item.instant === true);
                if (h) {
                    map[h] = isReady;
                    instantCacheLRU.set(h, isReady);

                    // Si en cache, promotion immédiate dans SQLite cached_torrents
                    if (isReady && imdbId) {
                        try {
                            const { asyncUpsertCachedTorrent, upsertCachedTorrent } = require("./db");
                            const originalTorrent = toProbe.find(p => (p.infoHash || "").toLowerCase() === h);
                            (asyncUpsertCachedTorrent || upsertCachedTorrent)({
                                infoHash: h,
                                imdbId,
                                title:
                                    (originalTorrent && (originalTorrent.filename || originalTorrent.title)) ||
                                    item.filename ||
                                    item.name ||
                                    "Torrent AllDebrid",
                                filename:
                                    (originalTorrent && (originalTorrent.filename || originalTorrent.title)) ||
                                    item.filename ||
                                    item.name ||
                                    "",
                                size: (originalTorrent && originalTorrent.size) || item.size || 0,
                                indexer: (originalTorrent && originalTorrent.indexer) || "Prowlarr",
                                seeders: (originalTorrent && originalTorrent.seeders) || 0,
                                isInstant: 1
                            });
                        } catch (e) {}
                    }
                }

                // Si pas en cache, on collecte l'ID pour suppression immédiate
                if (!isReady && item.id && deleteUnready) {
                    unreadyIds.push(item.id);
                }
            }

            // Suppression immédiate et non-bloquante de tous les torrents non en cache avec retry défensif
            if (unreadyIds.length > 0) {
                const runCleanup = async () => {
                    const failedIds = [];
                    await Promise.all(
                        unreadyIds.map(async id => {
                            try {
                                const ok = await (module.exports.deleteMagnet || deleteMagnet)(id, apiKey);
                                if (!ok) failedIds.push(id);
                            } catch (e) {
                                failedIds.push(id);
                            }
                        })
                    ).catch(() => {});

                    // Retry différé de 2s pour les éventuels échecs réseau AllDebrid
                    if (failedIds.length > 0) {
                        const t = setTimeout(() => {
                            Promise.all(
                                failedIds.map(id => (module.exports.deleteMagnet || deleteMagnet)(id, apiKey))
                            ).catch(() => {});
                        }, 2000);
                        if (t && typeof t.unref === "function") t.unref();
                    }
                };
                runCleanup().catch(() => {});
            }
        }
    } catch (e) {
        // En cas d'erreur réseau ou AllDebrid, on ignore silencieusement
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
                res = await adGet("/v4/magnet/files", apiKey, { id: batch.length === 1 ? batch[0] : batch }).catch(
                    () => null
                );
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
        mode: warpActive ? mode : PROXY_URL ? "fallback_direct" : "direct"
    };
}

async function checkAllDebridKey(apiKey) {
    if (!apiKey || typeof apiKey !== "string" || apiKey.trim() === "") {
        return { valid: false, error: "La clé API AllDebrid est requise." };
    }
    const key = apiKey.trim();
    try {
        // NB : ne PAS envoyer de paramètre `agent` ici. AllDebrid interprète `agent` comme
        // une demande de création automatique d'une clé API dédiée dans le compte (cf. aide
        // AllDebrid « gérer vos clés API ») : chaque validation de clé dupliquait donc une clé
        // « cinécloud » dans le compte de l'utilisateur. La clé reste transmise en en-tête
        // Authorization uniquement, ce qui suffit à valider le compte.
        const res = await adGet("/v4/user", key);
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

async function deleteMagnet(magnetId, apiKey) {
    if (!magnetId || !apiKey) return false;
    try {
        let res;
        try {
            res = await (module.exports.adPost || adPost)("/v4/magnet/delete", apiKey, { id: magnetId });
        } catch (e) {
            res = null;
        }
        if (!res || !res.data || res.data.status !== "success") {
            res = await (module.exports.adGet || adGet)("/v4/magnet/delete", apiKey, { id: magnetId }).catch(
                () => null
            );
        }
        return Boolean(res && res.data && res.data.status === "success");
    } catch (err) {
        return false;
    }
}

async function cleanupPendingMagnets(apiKey) {
    if (!apiKey) {
        return { success: false, error: "Clé API AllDebrid manquante.", deletedCount: 0 };
    }
    try {
        const res = await (module.exports.adGet || adGet)("/v4.1/magnet/status", apiKey).catch(
            err => err.response || null
        );
        if (!res || !res.data || res.data.status !== "success" || !res.data.data) {
            const errMsg =
                (res && res.data && res.data.error && res.data.error.message) ||
                "Impossible de récupérer les magnets AllDebrid";
            return { success: false, error: errMsg, deletedCount: 0 };
        }
        const magnets = Array.isArray(res.data.data.magnets) ? res.data.data.magnets : [];
        const pending = magnets.filter(m => !m.ready && Number(m.statusCode) !== 4);
        let deletedCount = 0;
        for (const m of pending) {
            if (m.id) {
                const ok = await (module.exports.deleteMagnet || deleteMagnet)(m.id, apiKey);
                if (ok) deletedCount++;
            }
        }
        return {
            success: true,
            totalPending: pending.length,
            deletedCount,
            message: `${deletedCount} magnet(s) bloqué(s) supprimé(s) avec succès.`
        };
    } catch (err) {
        return { success: false, error: err.message, deletedCount: 0 };
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
    createProxyAgent,
    fetchWithWarpFallback,
    deleteMagnet,
    cleanupPendingMagnets,
    preValidateMagnets,
    instantCacheLRU,
    isAllDebridMagnetReady,
    isAllDebridTargetDead,
    markAllDebridTargetDead,
    resetAllDebridDeadTargets
};
