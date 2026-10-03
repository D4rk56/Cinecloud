"use strict";

/**
 * @file animeMapping.js
 * @description Module de mapping d'identifiants et de métadonnées d'animes pour Stremio.
 * Charge et indexe la table communautaire Fribb/anime-lists au démarrage en mémoire (O(1)),
 * permettant de mapper instantanément kitsu_id ↔ imdb_id ↔ thetvdb_id ↔ tmdb_id.
 * Intègre un cache LRU, une validation stricte des inputs (anti-injection/anti-DoS),
 * et un timeout strict de 2 500 ms avec AbortController sur les requêtes externes.
 */

const fs = require("node:fs");
const path = require("node:path");
const axios = require("axios");

/**
 * URL officielle du dump complet Fribb anime-lists sur GitHub
 */
const FRIBB_DUMP_URL = "https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json";

/**
 * Chemin vers le fichier de persistance locale dans le dossier data/
 */
const DATA_DIR = path.join(__dirname, "..", "data");
const LOCAL_MAPPING_FILE = path.join(DATA_DIR, "anime-list-full.json");

/**
 * Timeout strict pour les requêtes externes de métadonnées (en millisecondes)
 */
const EXTERNAL_TIMEOUT_MS = 2500;

// =============================================================================
// CACHE LRU (LEAST RECENTLY USED) POUR LES METADONNEES ET RECHERCHES
// =============================================================================

/**
 * Implémentation haute performance d'un cache LRU en mémoire
 */
class LruCache {
    /**
     * @param {number} [maxSize=1000] - Capacité maximale d'éléments
     * @param {number} [ttlMs=86400000] - Durée de vie par défaut (24h)
     */
    constructor(maxSize = 1000, ttlMs = 24 * 60 * 60 * 1000) {
        this.maxSize = maxSize;
        this.ttlMs = ttlMs;
        this.cache = new Map();
    }

    /**
     * Récupère un élément du cache
     * @param {string} key
     * @returns {*|null}
     */
    get(key) {
        if (!this.cache.has(key)) return null;
        const entry = this.cache.get(key);
        if (Date.now() > entry.expiry) {
            this.cache.delete(key);
            return null;
        }
        // Rafraîchir l'ordre LRU
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry.value;
    }

    /**
     * Enregistre un élément dans le cache
     * @param {string} key
     * @param {*} value
     * @param {number} [customTtl]
     */
    set(key, value, customTtl) {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            // Éviction de l'élément le plus ancien (premier de la Map)
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey) this.cache.delete(oldestKey);
        }
        const ttl = customTtl || this.ttlMs;
        this.cache.set(key, {
            value,
            expiry: Date.now() + ttl
        });
    }

    has(key) {
        return this.get(key) !== null;
    }

    clear() {
        this.cache.clear();
    }

    get size() {
        return this.cache.size;
    }
}

const metaCache = new LruCache(1000, 24 * 60 * 60 * 1000);

// =============================================================================
// STRUCTURES D'INDEXATION EN MEMOIRE (O(1))
// =============================================================================

/** @type {Map<string, object>} */
const byKitsu = new Map();

/** @type {Map<string, Array<object>>} */
const byImdb = new Map();

/** @type {Map<string, Array<object>>} */
const byTvdb = new Map();

/** @type {Map<string, Array<object>>} */
const byTmdb = new Map();

/** @type {Map<string, object>} */
const byMal = new Map();

/** @type {Map<string, object>} */
const byAnidb = new Map();

let isLoaded = false;
let loadPromise = null;

// =============================================================================
// VALIDATION & SANITIZATION STRICTE DES IDENTIFIANTS (SECURITE / HARDENING)
// =============================================================================

/**
 * Valide et extrait un identifiant IMDb valide (^tt\d+$).
 * @param {string} imdbId - Chaîne à vérifier
 * @returns {string|null} ID IMDb assaini ou null si invalide
 */
function sanitizeImdbId(imdbId) {
    if (!imdbId || typeof imdbId !== "string") return null;
    const clean = imdbId.trim();
    // Supporte "tt1234567" ou la forme "tt1234567:1:1"
    const match = clean.match(/^(tt\d+)(?::\d+:\d+)?$/);
    return match ? match[1] : null;
}

/**
 * Valide et extrait un identifiant Kitsu numérique valide.
 * @param {string|number} kitsuId - Chaîne ou nombre Kitsu (ex: 7442 ou "kitsu:7442:1")
 * @returns {number|null} ID Kitsu sous forme d'entier ou null si invalide
 */
function sanitizeKitsuId(kitsuId) {
    if (kitsuId === null || kitsuId === undefined) return null;
    const str = String(kitsuId).trim();
    const clean = str.replace(/^kitsu:/, "");
    const base = clean.split(":")[0];
    if (/^\d+$/.test(base)) {
        const num = parseInt(base, 10);
        return !isNaN(num) && num > 0 ? num : null;
    }
    return null;
}

/**
 * Valide un ID numérique (TMDB ou TVDB).
 * @param {string|number} id
 * @returns {number|null}
 */
function sanitizeNumericId(id) {
    if (id === null || id === undefined) return null;
    const str = String(id).trim();
    if (/^\d+$/.test(str)) {
        const num = parseInt(str, 10);
        return !isNaN(num) && num > 0 ? num : null;
    }
    return null;
}

// =============================================================================
// CHARGEMENT & INDEXATION AU DEMARRAGE (BOOTSTRAPPER)
// =============================================================================

/**
 * Indexe la liste brute Fribb dans les Maps O(1).
 * @param {Array<object>} list - Liste brute issue de anime-list-full.json
 */
function indexFribbList(list) {
    byKitsu.clear();
    byImdb.clear();
    byTvdb.clear();
    byTmdb.clear();
    byMal.clear();
    byAnidb.clear();

    for (const item of list) {
        if (!item || typeof item !== "object") continue;

        // 1. Indexation Kitsu
        if (item.kitsu_id != null) {
            byKitsu.set(String(item.kitsu_id), item);
        }

        // 2. Indexation IMDb (supporte tableau ou chaîne)
        if (item.imdb_id) {
            const arr = Array.isArray(item.imdb_id) ? item.imdb_id : [item.imdb_id];
            for (const rawId of arr) {
                const id = sanitizeImdbId(rawId);
                if (id) {
                    let existing = byImdb.get(id);
                    if (!existing) {
                        existing = [];
                        byImdb.set(id, existing);
                    }
                    existing.push(item);
                }
            }
        }

        // 3. Indexation TVDB
        if (item.tvdb_id != null) {
            const tvdbKey = String(item.tvdb_id);
            let existing = byTvdb.get(tvdbKey);
            if (!existing) {
                existing = [];
                byTvdb.set(tvdbKey, existing);
            }
            existing.push(item);
        }

        // 4. Indexation TMDB (objet { tv, movie } ou entier)
        if (item.themoviedb_id != null) {
            const tm = item.themoviedb_id;
            if (typeof tm === "object") {
                if (tm.tv) {
                    const tvKey = `tv:${tm.tv}`;
                    let existingTv = byTmdb.get(tvKey);
                    if (!existingTv) {
                        existingTv = [];
                        byTmdb.set(tvKey, existingTv);
                    }
                    existingTv.push(item);

                    let plain = byTmdb.get(String(tm.tv));
                    if (!plain) {
                        plain = [];
                        byTmdb.set(String(tm.tv), plain);
                    }
                    plain.push(item);
                }
                if (tm.movie) {
                    const movieKey = `movie:${tm.movie}`;
                    let existingMovie = byTmdb.get(movieKey);
                    if (!existingMovie) {
                        existingMovie = [];
                        byTmdb.set(movieKey, existingMovie);
                    }
                    existingMovie.push(item);

                    let plain = byTmdb.get(String(tm.movie));
                    if (!plain) {
                        plain = [];
                        byTmdb.set(String(tm.movie), plain);
                    }
                    plain.push(item);
                }
            } else if (typeof tm === "number" || typeof tm === "string") {
                const tmKey = String(tm);
                let existing = byTmdb.get(tmKey);
                if (!existing) {
                    existing = [];
                    byTmdb.set(tmKey, existing);
                }
                existing.push(item);
            }
        }

        // 5. Indexation MyAnimeList & AniDB
        if (item.mal_id != null) {
            byMal.set(String(item.mal_id), item);
        }
        if (item.anidb_id != null) {
            byAnidb.set(String(item.anidb_id), item);
        }
    }
}

/**
 * Charge la table Fribb en mémoire au démarrage.
 * Lit d'abord data/anime-list-full.json en cache disque local.
 * Si le fichier n'existe pas, tente de le télécharger depuis GitHub et de le persister.
 * Si le réseau échoue, démarre gracieusement sans bloquer le serveur.
 *
 * @param {Object} [options={}]
 * @param {boolean} [options.forceReload=false] - Forcer le rechargement même si déjà chargé
 * @param {string} [options.customFilePath] - Chemin alternatif pour les tests unitaires
 * @returns {Promise<{ isLoaded: boolean, count: number, loadTimeMs: number }>}
 */
async function loadAnimeMapping(options = {}) {
    if (isLoaded && !options.forceReload) {
        return { isLoaded: true, count: byKitsu.size, loadTimeMs: 0 };
    }

    if (loadPromise && !options.forceReload) {
        return loadPromise;
    }

    loadPromise = (async () => {
        const startTime = Date.now();
        const targetPath = options.customFilePath || LOCAL_MAPPING_FILE;

        try {
            if (!fs.existsSync(DATA_DIR)) {
                fs.mkdirSync(DATA_DIR, { recursive: true });
            }

            let data = null;

            // 1. Tentative de lecture du fichier local
            if (fs.existsSync(targetPath)) {
                try {
                    const rawContent = fs.readFileSync(targetPath, "utf8");
                    if (rawContent && rawContent.length > 10) {
                        data = JSON.parse(rawContent);
                    }
                } catch (readErr) {
                    console.warn("[AnimeMapping] Erreur lecture fichier local :", readErr.message);
                }
            }

            // 2. Si pas de fichier local, téléchargement depuis GitHub
            if (!data || !Array.isArray(data) || data.length === 0) {
                console.log("[AnimeMapping] Fichier local manquant. Téléchargement de la table Fribb depuis GitHub...");
                const response = await axios.get(FRIBB_DUMP_URL, {
                    timeout: 25000,
                    responseType: "json",
                    headers: { "User-Agent": "CineCloudFR/2.3.0" }
                });

                if (response.data && Array.isArray(response.data)) {
                    data = response.data;
                    try {
                        fs.writeFileSync(targetPath, JSON.stringify(data));
                        console.log(`[AnimeMapping] Table Fribb sauvegardée avec succès dans ${targetPath}`);
                    } catch (writeErr) {
                        console.warn("[AnimeMapping] Impossible d'écrire le cache disque local :", writeErr.message);
                    }
                }
            }

            // 3. Indexation mémoire
            if (data && Array.isArray(data)) {
                indexFribbList(data);
                isLoaded = true;
                const elapsed = Date.now() - startTime;
                console.log(
                    `[AnimeMapping] Table communautaire indexée avec succès : ${byKitsu.size} Kitsu, ${byImdb.size} IMDb (${elapsed} ms).`
                );
                return { isLoaded: true, count: byKitsu.size, loadTimeMs: elapsed };
            }

            console.warn("[AnimeMapping] Données Fribb non disponibles. Initialisation avec tables vides.");
            isLoaded = true;
            return { isLoaded: true, count: 0, loadTimeMs: Date.now() - startTime };
        } catch (err) {
            console.error("[AnimeMapping] Erreur critique lors du chargement :", err.message);
            isLoaded = true;
            return { isLoaded: false, count: 0, loadTimeMs: Date.now() - startTime, error: err.message };
        } finally {
            loadPromise = null;
        }
    })();

    return loadPromise;
}

// =============================================================================
// MAPPING D'IDENTIFIANTS ET RECHERCHES O(1)
// =============================================================================

/**
 * @typedef {Object} AnimeMappingResult
 * @property {number} kitsuId
 * @property {string|null} imdbId - Premier ID IMDb associé
 * @property {string[]} imdbIds - Tous les IDs IMDb associés
 * @property {number|null} tvdbId
 * @property {number|null} tmdbId
 * @property {"tv"|"movie"|null} tmdbType
 * @property {number|null} season - Saison TMDB/TVDB (1, 2, ...)
 * @property {{ tvdb: number, tmdb: number }|null} seasonData
 * @property {string} type - "TV", "MOVIE", "OVA", "SPECIAL", etc.
 * @property {number|null} malId
 * @property {number|null} anidbId
 * @property {object} raw - Entrée brute de la table
 */

/**
 * Normalise une entrée brute Fribb en un objet résultat typé et propre.
 * @param {object} item - Entrée Fribb
 * @returns {AnimeMappingResult}
 */
function formatMappingEntry(item) {
    if (!item) return null;

    let imdbIds = [];
    if (item.imdb_id) {
        imdbIds = (Array.isArray(item.imdb_id) ? item.imdb_id : [item.imdb_id]).map(sanitizeImdbId).filter(Boolean);
    }

    let tmdbId = null;
    let tmdbType = null;
    if (item.themoviedb_id) {
        if (typeof item.themoviedb_id === "object") {
            if (item.themoviedb_id.tv) {
                tmdbId = item.themoviedb_id.tv;
                tmdbType = "tv";
            } else if (item.themoviedb_id.movie) {
                tmdbId = item.themoviedb_id.movie;
                tmdbType = "movie";
            }
        } else if (typeof item.themoviedb_id === "number") {
            tmdbId = item.themoviedb_id;
            tmdbType = item.type === "MOVIE" ? "movie" : "tv";
        }
    }

    const seasonData = item.season && typeof item.season === "object" ? item.season : null;
    let season = null;
    if (seasonData) {
        season = seasonData.tmdb !== undefined && seasonData.tmdb !== null ? seasonData.tmdb : seasonData.tvdb;
    }

    return {
        kitsuId: item.kitsu_id || null,
        imdbId: imdbIds.length > 0 ? imdbIds[0] : null,
        imdbIds,
        tvdbId: item.tvdb_id || null,
        tmdbId,
        tmdbType,
        season,
        seasonData,
        type: item.type || "TV",
        malId: item.mal_id || null,
        anidbId: item.anidb_id || null,
        raw: item
    };
}

/**
 * Récupère le mapping complet d'un anime à partir d'un ID Kitsu.
 * @param {string|number} kitsuId - ID Kitsu (ex: 7442 ou "kitsu:7442:1")
 * @returns {AnimeMappingResult|null}
 */
function getAnimeMappingByKitsu(kitsuId) {
    const cleanId = sanitizeKitsuId(kitsuId);
    if (!cleanId) return null;

    const entry = byKitsu.get(String(cleanId));
    return entry ? formatMappingEntry(entry) : null;
}

/**
 * Récupère toutes les fiches d'anime associées à un ID IMDb (ex: saisons successives).
 * @param {string} imdbId - ID IMDb (ex: "tt2560140")
 * @returns {AnimeMappingResult[]}
 */
function getAnimeMappingByImdb(imdbId) {
    const cleanId = sanitizeImdbId(imdbId);
    if (!cleanId) return [];

    const entries = byImdb.get(cleanId);
    if (!entries || !Array.isArray(entries)) return [];
    return entries.map(formatMappingEntry);
}

/**
 * Récupère le mapping d'une saison spécifique pour un ID IMDb donné.
 * @param {string} imdbId - ID IMDb (ex: "tt2560140")
 * @param {number} seasonNumber - Numéro de la saison (1, 2, ...)
 * @returns {AnimeMappingResult|null}
 */
function getAnimeMappingByImdbAndSeason(imdbId, seasonNumber) {
    const cleanId = sanitizeImdbId(imdbId);
    if (!cleanId) return null;

    const list = getAnimeMappingByImdb(cleanId);
    if (!list || list.length === 0) return null;

    const targetSeason = parseInt(seasonNumber, 10);
    // 1. Chercher la saison exacte
    const exact = list.find(e => e.season === targetSeason);
    if (exact) return exact;

    // 2. Si saison 1 demandée et aucun tag de saison, prendre la première fiche TV
    if (targetSeason === 1) {
        const tv = list.find(e => e.type === "TV");
        if (tv) return tv;
        return list[0];
    }

    return null;
}

/**
 * Récupère le mapping pour un identifiant TVDB.
 * @param {string|number} tvdbId
 * @returns {AnimeMappingResult[]}
 */
function getAnimeMappingByTvdb(tvdbId) {
    const cleanId = sanitizeNumericId(tvdbId);
    if (!cleanId) return [];

    const entries = byTvdb.get(String(cleanId));
    if (!entries || !Array.isArray(entries)) return [];
    return entries.map(formatMappingEntry);
}

/**
 * Récupère le mapping pour un identifiant TMDB.
 * @param {string|number} tmdbId
 * @param {"tv"|"movie"} [mediaType]
 * @returns {AnimeMappingResult[]}
 */
function getAnimeMappingByTmdb(tmdbId, mediaType) {
    const cleanId = sanitizeNumericId(tmdbId);
    if (!cleanId) return [];

    if (mediaType) {
        const typedKey = `${mediaType}:${cleanId}`;
        const entries = byTmdb.get(typedKey);
        if (entries && Array.isArray(entries)) return entries.map(formatMappingEntry);
    }

    const entries = byTmdb.get(String(cleanId));
    if (!entries || !Array.isArray(entries)) return [];
    return entries.map(formatMappingEntry);
}

// =============================================================================
// RESOLUTION DE METADONNEES EXTERNES (AVEC TIMEOUT STRICT 2500ms ET ABORTCONTROLLER)
// =============================================================================

/**
 * @typedef {Object} AnimeMetaDetails
 * @property {string} canonicalTitle - Titre canonique officiel
 * @property {string|null} titleEn - Titre en anglais
 * @property {string|null} titleRomaji - Titre en romaji (en_jp)
 * @property {string|null} titleJapanese - Titre en kanji/japonais (ja_jp)
 * @property {string[]} aliases - Liste complète des synonymes et titres alternatifs
 * @property {number|null} episodeCount - Nombre total d'épisodes de cette saison/partie
 * @property {string|null} year - Année de sortie
 * @property {string|null} showType - Type de show ("TV", "movie", etc.)
 */

/**
 * Récupère les métadonnées détaillées et la liste d'alias d'un anime depuis Kitsu.
 * Utilise le cache LRU en priorité, et applique un timeout strict de 2 500 ms
 * avec interruption via AbortController pour garantir la réactivité sans bloquer l'addon.
 *
 * @param {string|number} kitsuId - ID Kitsu
 * @param {Object} [options={}]
 * @param {number} [options.timeout=2500] - Timeout en ms (défaut: 2500ms)
 * @returns {Promise<AnimeMetaDetails|null>}
 */
async function fetchKitsuDetails(kitsuId, options = {}) {
    const cleanId = sanitizeKitsuId(kitsuId);
    if (!cleanId) return null;

    const cacheKey = `kitsu_meta_${cleanId}`;
    const cached = metaCache.get(cacheKey);
    if (cached) return cached;

    const timeoutMs = options.timeout || EXTERNAL_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const url = `https://kitsu.io/api/edge/anime/${cleanId}`;
        const res = await axios.get(url, {
            signal: controller.signal,
            timeout: timeoutMs,
            headers: {
                Accept: "application/vnd.api+json",
                "Content-Type": "application/vnd.api+json",
                "User-Agent": "CineCloudFR/2.3.0"
            }
        });

        clearTimeout(timer);

        if (res.data && res.data.data && res.data.data.attributes) {
            const attr = res.data.data.attributes;
            const canonicalTitle = attr.canonicalTitle || "";
            const titlesObj = attr.titles || {};
            const titleEn = titlesObj.en || titlesObj.en_us || null;
            const titleRomaji = titlesObj.en_jp || null;
            const titleJapanese = titlesObj.ja_jp || null;

            const aliasesSet = new Set();
            if (canonicalTitle) aliasesSet.add(canonicalTitle);
            if (titleEn) aliasesSet.add(titleEn);
            if (titleRomaji) aliasesSet.add(titleRomaji);
            if (titleJapanese) aliasesSet.add(titleJapanese);

            if (Array.isArray(attr.abbreviatedTitles)) {
                for (const ab of attr.abbreviatedTitles) {
                    if (ab && typeof ab === "string") aliasesSet.add(ab.trim());
                }
            }

            const details = {
                canonicalTitle,
                titleEn,
                titleRomaji,
                titleJapanese,
                aliases: Array.from(aliasesSet),
                episodeCount: attr.episodeCount || null,
                year: attr.startDate ? attr.startDate.slice(0, 4) : null,
                showType: attr.showType || null
            };

            metaCache.set(cacheKey, details);
            return details;
        }
    } catch (err) {
        clearTimeout(timer);
        // Erreur réseau ou timeout AbortController : fallback gracieux
    }

    return null;
}

/**
 * Construit la table des décalages d'épisodes par saison pour un anime IMDb.
 * Récupère le nombre d'épisodes de chaque saison via Kitsu ou Cinemeta.
 *
 * @param {string} imdbId - ID IMDb (ex: "tt2560140")
 * @returns {Promise<Object.<number, number>>} Carte { [saison]: nombreDEpisodes }
 */
async function buildAnimeSeasonOffsets(imdbId) {
    const cleanId = sanitizeImdbId(imdbId);
    if (!cleanId) return {};

    const cacheKey = `offsets_${cleanId}`;
    const cached = metaCache.get(cacheKey);
    if (cached) return cached;

    const seasonCounts = {};
    const kitsuEntries = getAnimeMappingByImdb(cleanId);

    // Tentative 1 : Extraction via Kitsu pour chaque saison répertoriée
    if (kitsuEntries.length > 0) {
        for (const entry of kitsuEntries) {
            if (entry.kitsuId && entry.season && entry.season > 0) {
                const details = await fetchKitsuDetails(entry.kitsuId);
                if (details && details.episodeCount) {
                    seasonCounts[entry.season] = details.episodeCount;
                }
            }
        }
    }

    // Tentative 2 : Fallback via Cinemeta avec timeout strict de 2 500 ms
    if (Object.keys(seasonCounts).length === 0) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), EXTERNAL_TIMEOUT_MS);
        try {
            const cinemetaUrl = `https://v3-cinemeta.strem.io/meta/series/${cleanId}.json`;
            const res = await axios.get(cinemetaUrl, {
                signal: controller.signal,
                timeout: EXTERNAL_TIMEOUT_MS,
                headers: { "User-Agent": "CineCloudFR/2.3.0" }
            });
            clearTimeout(timer);

            const videos = res.data?.meta?.videos || [];
            for (const v of videos) {
                if (v.season && v.season > 0) {
                    seasonCounts[v.season] = (seasonCounts[v.season] || 0) + 1;
                }
            }
        } catch (e) {
            clearTimeout(timer);
        }
    }

    if (Object.keys(seasonCounts).length > 0) {
        metaCache.set(cacheKey, seasonCounts);
    }

    return seasonCounts;
}

module.exports = {
    loadAnimeMapping,
    getAnimeMappingByKitsu,
    getAnimeMappingByImdb,
    getAnimeMappingByImdbAndSeason,
    getAnimeMappingByTvdb,
    getAnimeMappingByTmdb,
    fetchKitsuDetails,
    buildAnimeSeasonOffsets,
    sanitizeImdbId,
    sanitizeKitsuId,
    sanitizeNumericId,
    LruCache,
    metaCache,
    FRIBB_DUMP_URL,
    LOCAL_MAPPING_FILE
};
