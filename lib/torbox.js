"use strict";

const axios = require("axios");
const { makeLRU } = require("./helpers");

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

// Cibles Torbox rejetées de façon déterministe (422/404) : évite de marteler l'API
// quand le client (Stremio) relance la lecture en boucle sur un lien mort.
const deadTargets = makeLRU(500, 10 * 60 * 1000);

/**
 * Vérifie qu'un torrent Torbox est réellement disponible en lecture.
 * Liste de refus volontairement conservatrice : seuls les états explicitement non prêts
 * sont exclus, afin de ne jamais masquer un fichier lisible dont l'état serait inconnu.
 */
function isTorboxTorrentReady(torrent) {
    if (!torrent) return false;
    const state = String(torrent.download_state || "").toLowerCase();
    // Correspondance par inclusion : « stalled (no seeds) », « checkingResumeData »,
    // « metaDL », « queued »… sont ainsi tous exclus, même si le libellé d'état évolue.
    const notReady = ["downloading", "stalled", "paused", "metadl", "checking", "queued", "error", "failed"];
    return !notReady.some(s => state.includes(s));
}

/**
 * Le torrent est-il disponible en lecture ?
 * D'après la doc Torbox, `download_state` vaut « cached » pour un torrent déjà sur les
 * serveurs (lisible immédiatement) et « uploading » pour un torrent en seed (donc
 * intégralement téléchargé) — ces deux états sont lisibles même si `progress` vaut 0
 * (rien à télécharger) et `download_finished` est absent. Ne pas les prendre en compte
 * faisait échouer la lecture de tout torrent pourtant en cache.
 */
function isTorboxTorrentDownloaded(torrent) {
    if (!torrent) return false;
    const state = String(torrent.download_state || "").toLowerCase();
    return Boolean(
        torrent.download_finished ||
        torrent.download_present ||
        torrent.progress === 1 ||
        state === "completed" ||
        state === "cached" ||
        state === "uploading"
    );
}

/**
 * Extrait un message lisible du corps d'erreur Torbox.
 * L'API FastAPI renvoie soit `detail` (chaîne ou tableau [{loc,msg}]), soit `error`/`message`.
 */
function extractTorboxError(err) {
    const data = err && err.response && err.response.data;
    if (data) {
        const detail = data.detail !== undefined ? data.detail : data.error || data.message;
        if (typeof detail === "string" && detail.trim()) return detail.trim();
        if (Array.isArray(detail)) {
            const parts = detail.map(d => (d && (d.msg || d.message)) || "").filter(Boolean);
            if (parts.length > 0) return parts.join(" ; ");
        }
        if (detail && typeof detail === "object" && detail.msg) return String(detail.msg);
    }
    return (err && err.message) || "Erreur Torbox inconnue";
}

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

const PUBLIC_TRACKERS = [
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://tracker.bittor.pw:1337/announce",
    "udp://public.popcorn-tracker.org:6969/announce",
    "udp://tracker.dler.org:6969/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://open.demonii.com:1337/announce"
];

const TORBOX_PLAN_SLOTS = {
    0: 1, // Gratuit : 1 slot
    1: 3, // Essential : 3 slots
    2: 5, // Standard : 5 slots
    3: 10 // Pro : 10 slots
};

/**
 * Crée un torrent sur Torbox via son magnet ou infoHash
 * Options :
 * - seed : 1 (auto), 2 (seed), 3 (do not seed - par défaut si !allowDownload pour 0 slot de seed)
 * - addOnlyIfCached : booléen (si true, n'ajoute que si 100% en cache, 0 slot de download)
 * - allowDownload : booléen (si false, force seed: 3 et addOnlyIfCached: true)
 */
async function createTorboxTorrent(magnetOrHash, apiKey, seedOrOptions = 1) {
    if (!magnetOrHash || !apiKey) {
        return { success: false, error: "Magnet et clé API requis." };
    }

    let seed = 1;
    let addOnlyIfCached = false;

    if (typeof seedOrOptions === "object" && seedOrOptions !== null) {
        const allowDownload = Boolean(seedOrOptions.allowDownload);
        seed = seedOrOptions.seed !== undefined ? seedOrOptions.seed : allowDownload ? 1 : 3;
        addOnlyIfCached =
            seedOrOptions.addOnlyIfCached !== undefined ? Boolean(seedOrOptions.addOnlyIfCached) : !allowDownload;
    } else if (typeof seedOrOptions === "number") {
        seed = seedOrOptions;
    }

    const cleanKey = apiKey.trim();
    let magnetUri = magnetOrHash;
    const trackersQuery = PUBLIC_TRACKERS.map(tr => `&tr=${encodeURIComponent(tr)}`).join("");
    if (!magnetUri.startsWith("magnet:")) {
        magnetUri = `magnet:?xt=urn:btih:${magnetOrHash}${trackersQuery}`;
    } else if (!magnetUri.includes("&tr=")) {
        magnetUri = `${magnetUri}${trackersQuery}`;
    }

    try {
        const params = new URLSearchParams();
        params.append("magnet", magnetUri);
        params.append("seed", String(seed));
        params.append("allow_zip", "false");
        if (addOnlyIfCached) {
            params.append("add_only_if_cached", "true");
        }

        let res;
        try {
            res = await torboxApi.post("/torrents/createtorrent", params.toString(), {
                headers: {
                    Authorization: `Bearer ${cleanKey}`,
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                timeout: 10000
            });
        } catch (firstErr) {
            const status = firstErr.response?.status;
            // Repli en JSON si rejet de format (FastAPI 422 / 415)
            if (status === 422 || status === 415) {
                const jsonBody = {
                    magnet: magnetUri,
                    seed: Number(seed),
                    allow_zip: false,
                    add_only_if_cached: addOnlyIfCached
                };
                res = await torboxApi.post("/torrents/createtorrent", jsonBody, {
                    headers: {
                        Authorization: `Bearer ${cleanKey}`,
                        "Content-Type": "application/json"
                    },
                    timeout: 10000
                });
            } else {
                throw firstErr;
            }
        }

        if (res.data && res.data.success && res.data.data) {
            return {
                success: true,
                torrentId: res.data.data.torrent_id || res.data.data.id,
                authId: res.data.data.auth_id,
                hash: res.data.data.hash,
                data: res.data.data
            };
        }

        const errMsg =
            res.data?.detail || res.data?.error || res.data?.message || "Échec de l'ajout du torrent sur Torbox";
        console.warn(`[Torbox] createtorrent a renvoyé un échec: ${errMsg}`);
        return {
            success: false,
            error: errMsg
        };
    } catch (err) {
        const status = err.response?.status;
        const detail = extractTorboxError(err);
        const fullMsg = `Erreur ajout torrent Torbox (HTTP ${status || err.code || "?"}): ${detail}`;
        console.warn(`[Torbox] ${fullMsg}`);
        return { success: false, error: fullMsg, status, detail };
    }
}

/**
 * Récupère la liste des torrents du compte Torbox (ou un torrent spécifique si id fourni)
 */
async function getTorboxTorrentList(apiKey, idOrOptions = null, options = {}) {
    if (!apiKey) return [];
    const cleanKey = apiKey.trim();

    let id = idOrOptions;
    let opts = options;
    if (idOrOptions && typeof idOrOptions === "object") {
        opts = idOrOptions;
        id = opts.id || null;
    }
    const bypassCache = Boolean(opts && opts.bypassCache);

    try {
        let url = id ? `/torrents/mylist?id=${encodeURIComponent(id)}` : "/torrents/mylist";
        // Torbox met en cache la liste ~600 s. Pour connaître l'état RÉEL d'un torrent
        // (transition metaDL → cached/uploading) il faut demander les données fraîches.
        if (bypassCache) {
            url += `${url.includes("?") ? "&" : "?"}bypass_cache=true`;
        }
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
 * Récupère les métadonnées et fichiers d'un torrent Torbox spécifique.
 * Utilise bypass_cache : sans cela, un torrent fraîchement ajouté restait figé à
 * l'état « metaDL » (création) pendant ~10 min et la lecture échouait à tort.
 */
async function getTorboxTorrentInfo(torrentId, apiKey) {
    if (!torrentId || !apiKey) return null;
    const list = await getTorboxTorrentList(apiKey, torrentId, { bypassCache: true });
    if (Array.isArray(list) && list.length > 0) {
        const match = list.find(t => t && String(t.id) === String(torrentId));
        if (match) return match;
        if (list[0] && list[0].id) return list[0];
    }
    return null;
}

/**
 * Récupère l'URL de streaming CDN d'un fichier Torbox côté serveur.
 * La clé API n'est JAMAIS embarquée dans l'URL : elle est transmise uniquement
 * via l'en-tête Authorization.
 */
async function getTorboxStreamUrl(torrentId, fileId, apiKey) {
    if (!torrentId || !fileId || !apiKey) return null;
    const cleanKey = apiKey.trim();
    const targetKey = `${torrentId}:${fileId}`;

    // Cible déjà rejetée récemment par Torbox : on ne relance pas l'appel (anti-boucle).
    if (deadTargets.has(targetKey)) return null;

    try {
        const res = await torboxApi.get("/torrents/requestdl", {
            params: {
                // Torbox exige le token en PARAMÈTRE DE REQUÊTE sur cet endpoint : l'en-tête
                // Authorization seul provoque un HTTP 422 ("query.token: Field required").
                // La requête reste strictement côté serveur ; l'URL n'est jamais journalisée
                // et le token n'est jamais transmis au client.
                token: cleanKey,
                torrent_id: torrentId,
                file_id: fileId,
                redirect: false
            },
            headers: {
                Authorization: `Bearer ${cleanKey}`
            },
            timeout: 8000
        });

        const streamUrl = res.data && res.data.success ? res.data.data : null;
        // Garde anti-fuite : la clé API ne doit jamais atteindre le client.
        if (typeof streamUrl === "string" && streamUrl) {
            if (streamUrl.includes(cleanKey)) {
                console.warn("[Torbox] URL CDN refusée : elle contient la clé API.");
                return null;
            }
            return streamUrl;
        }
        return null;
    } catch (err) {
        const status = err.response && err.response.status;
        // 422/404 = rejet déterministe de la cible : quarantaine pour arrêter les relances.
        if (status === 422 || status === 404) {
            deadTargets.set(targetKey, true);
        }
        // Jamais d'URL dans le log : elle contient le token en paramètre.
        console.warn(
            `[Torbox] Erreur getTorboxStreamUrl (torrentId: ${torrentId}, fileId: ${fileId}): HTTP ${status || err.code || "?"} — ${extractTorboxError(err)}`
        );
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

/**
 * Analyse les slots du compte Torbox : nombre de slots autorisés selon le plan,
 * nombre de slots actuellement occupés par des torrents actifs, et liste des torrents
 * inactifs/terminés pouvant être libérés si besoin.
 */
async function getTorboxSlotStatus(apiKey) {
    if (!apiKey)
        return {
            plan: 0,
            planName: "Inconnu",
            maxSlots: 1,
            usedSlots: 0,
            availableSlots: 1,
            activeList: [],
            purgeableList: []
        };
    const [account, list] = await Promise.all([
        checkTorboxKey(apiKey).catch(() => ({ valid: false, plan: 0, planName: "Gratuit" })),
        getTorboxTorrentList(apiKey, null, { bypassCache: true }).catch(() => [])
    ]);

    const plan = account && account.plan !== undefined ? account.plan : 0;
    const maxSlots = TORBOX_PLAN_SLOTS[plan] || 3;
    const torrents = Array.isArray(list) ? list : [];

    // États consommant un slot de téléchargement ou seeding actif :
    const activeStates = ["downloading", "queued", "metadl", "stalled", "checking", "uploading"];
    const activeList = [];
    const purgeableList = [];

    for (const t of torrents) {
        const state = String((t && t.download_state) || "").toLowerCase();
        const isActive = activeStates.some(s => state.includes(s));
        if (isActive) {
            activeList.push(t);
        } else {
            // Torrents complétés / inactifs / terminés qui peuvent être supprimés pour libérer de la place
            purgeableList.push(t);
        }
    }

    const usedSlots = activeList.length;
    const availableSlots = Math.max(0, maxSlots - usedSlots);

    return {
        plan,
        planName: account.planName || `Plan #${plan}`,
        maxSlots,
        usedSlots,
        availableSlots,
        activeList,
        purgeableList
    };
}

/**
 * Libère un slot Torbox si le compte est saturé en supprimant le plus ancien torrent
 * terminé ou inactif.
 */
async function freeTorboxSlotIfFull(apiKey) {
    try {
        const slotStatus = await getTorboxSlotStatus(apiKey);
        if (slotStatus.availableSlots > 0) return true; // Déjà de la place disponible

        // Pas de slot libre : on cherche dans les torrents inactifs/terminés
        if (slotStatus.purgeableList.length > 0) {
            // On trie par ID croissant (les plus anciens)
            const sorted = [...slotStatus.purgeableList].sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
            const oldest = sorted[0];
            if (oldest && oldest.id) {
                console.log(
                    `[Torbox] Slots saturés (${slotStatus.usedSlots}/${slotStatus.maxSlots}) : suppression du torrent terminé ${oldest.id} (${oldest.name || "sans nom"}) pour libérer un slot.`
                );
                await deleteTorboxTorrent(oldest.id, apiKey);
                return true;
            }
        }
        return false;
    } catch (e) {
        console.warn(`[Torbox] Erreur tentative libération slot:`, e.message);
        return false;
    }
}

module.exports = {
    TORBOX_API_BASE,
    TORBOX_PLAN_SLOTS,
    torboxApi,
    checkTorboxKey,
    checkInstantTorbox,
    createTorboxTorrent,
    getTorboxTorrentList,
    getTorboxTorrentInfo,
    getTorboxStreamUrl,
    deleteTorboxTorrent,
    isTorboxTorrentReady,
    isTorboxTorrentDownloaded,
    extractTorboxError,
    getTorboxSlotStatus,
    freeTorboxSlotIfFull
};
