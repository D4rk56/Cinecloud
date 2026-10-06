"use strict";

const axios = require("axios");
const alldebrid = require("./alldebrid");
const adGet = (...args) => alldebrid.adGet(...args);
const getMagnetFiles = (...args) => alldebrid.getMagnetFiles(...args);
const { isTorboxTorrentReady } = require("./torbox");

// Version du manifeste, lue depuis package.json (source de vérité unique).
const { version: ADDON_VERSION } = require("../package.json");
const { getCachedTorrentsByImdb, getMovieVersions, asyncTouchUserActivity, getSystemSettings } = require("./db");
const { searchProwlarrOnDemand } = require("./prowlarr-worker");
const {
    TMDB_KEY_DEFAULT,
    isCustomTmdbKey,
    ALL_CATALOGS,
    flattenFiles,
    isRealVideoFile,
    isExcludedArtifact,
    isCompleteSeriesPack,
    extractTechBadge,
    classifyContent,
    sortByLangPref,
    filterAndSortStreams,
    resolveKitsuMeta,
    parseSeasonEpisode,
    extractCleanTitle,
    getTmdbMetadata,
    generateFallbackPoster,
    tmdbToImdbId,
    imdbIdToTitle,
    imdbIdToTitleAndYear,
    getFrenchTitle,
    isConfidentTitleMatch,
    formatAioStream,
    parseSizeFromString,
    searchCinemeta,
    ERROR_PATTERNS_RE,
    makeLRU,
    isObfuscated,
    hasNonLatinCharacters,
    pickBestReleaseFilename
} = require("./helpers");

const BROWSER_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
let lumioDownUntil = 0;
let torrentioDownUntil = 0;

function safeDecode(str) {
    if (typeof str !== "string") return str;
    try {
        return decodeURIComponent(str);
    } catch (e) {
        return str;
    }
}

function handleManifest(config = {}, baseUrl = "", _userRef = "") {
    const isCatalogsDisabled = Boolean(config.disableCatalogs);
    let enabled = [];
    if (!isCatalogsDisabled) {
        if (config.enabledCatalogs && config.enabledCatalogs !== "all") {
            const parsed = Array.isArray(config.enabledCatalogs)
                ? config.enabledCatalogs
                : safeDecode(config.enabledCatalogs).split(",");
            enabled = parsed.length > 0 ? parsed : ALL_CATALOGS.map(c => c.id);
        } else {
            enabled = ALL_CATALOGS.map(c => c.id);
        }
    }

    const base = baseUrl ? baseUrl.replace(/\/+$/, "") : "";

    const pseudoStr =
        config.pseudo && typeof config.pseudo === "string" && config.pseudo.trim() ? ` (${config.pseudo.trim()})` : "";

    // Ces préfixes correspondent EXACTEMENT aux IDs émis au client. Les formes `ad_<id>` /
    // `tb_<id>` construites en interne ne sont que des clés de cache de classification et ne
    // franchissent jamais cette frontière : un ID non déclaré ici est ignoré par le client.
    // Source de vérité unique, partagée par les ressources `stream` ET `meta`.
    const ADDON_TYPES = ["movie", "series", "anime"];
    const ADDON_ID_PREFIXES = ["tt", "kitsu", "ad_cloud:", "ad_link:", "ad_series:", "tb_cloud:"];

    // Chaque ressource est déclarée en notation OBJET : les agrégateurs (AIOStreams) lisent
    // `idPrefixes` par ressource et avertissent (« addon provides no idPrefixes ») quand la
    // notation abrégée par chaîne ne leur permet pas de savoir quels IDs sont servis.
    // `catalog` n'a pas d'`idPrefixes` : la spec Stremio précise qu'ils sont sans objet pour
    // cette ressource, toujours demandée dès lors qu'elle figure dans `catalogs`.
    const resources = [
        ...(isCatalogsDisabled
            ? []
            : [
                  { name: "catalog", types: ADDON_TYPES },
                  { name: "meta", types: ADDON_TYPES, idPrefixes: ADDON_ID_PREFIXES }
              ]),
        { name: "stream", types: ADDON_TYPES, idPrefixes: ADDON_ID_PREFIXES }
    ];

    const manifest = {
        id: "org.nuvio.alldebrid",
        // Source de vérité unique : évite qu'une montée de version soit oubliée
        // ici et que Stremio continue de servir un manifeste périmé.
        version: ADDON_VERSION,
        name: `Cinécloud${pseudoStr}`,
        description:
            " ☁️🎬 Addon de streaming haute performance pour Stremio et Nuvio. ✨ Débridage AllDebrid & Torbox, indexeur Prowlarr en temps réel, module d'animes et catalogues Cloud.",
        behaviorHints: {
            configurable: true,
            configurationRequired: false
        },
        types: ADDON_TYPES,
        resources: resources,
        catalogs: isCatalogsDisabled
            ? []
            : ALL_CATALOGS.filter(c => enabled.includes(c.id)).map(c => ({
                  id: c.id,
                  type: c.type,
                  name: c.name,
                  extra: [
                      { name: "search", isRequired: false },
                      { name: "skip", isRequired: false }
                  ]
              }))
    };

    // `logo` et `background` ne sont ajoutés que s'ils sont calculables : les
    // émettre à `undefined` produirait un manifeste invalide si le client
    // demande le manifeste sans Host (baseUrl vide).
    if (base) {
        manifest.logo = `${base}/logo.png`;
        manifest.background = `${base}/background.png`;
    }

    return manifest;
}

async function handleMeta(config, type, id, cache) {
    const { apiKey } = config;
    const tmdbKey = config.tmdbKey && config.tmdbKey !== "default" ? config.tmdbKey : TMDB_KEY_DEFAULT;

    // Fichier issu de "Mes Liens" ou "Historique"
    if (id.startsWith("ad_link:")) {
        const originalLink = Buffer.from(id.replace("ad_link:", ""), "base64url").toString();
        let fname = originalLink.split("/").pop() || "Fichier";
        try {
            fname = decodeURIComponent(fname);
        } catch (e) {}

        const targetType = type === "series" ? "series" : "movie";
        const tmdb = await getTmdbMetadata(fname, targetType, tmdbKey, true);
        const se = parseSeasonEpisode(fname);
        const badge = extractTechBadge(fname);

        const videoEntry =
            targetType === "series"
                ? [
                      {
                          id: id,
                          title: fname,
                          season: se ? se.season : 1,
                          episode: se ? se.episode : 1,
                          released: new Date().toISOString()
                      }
                  ]
                : undefined;

        return {
            meta: {
                id,
                type: targetType,
                name: tmdb.name || fname,
                poster: tmdb.poster || generateFallbackPoster(tmdb.name || fname),
                background: tmdb.backdrop || null,
                description: `${badge ? badge + "\n" : ""}${fname}\n\n${tmdb.description || ""}`,
                genres: tmdb.genres || [],
                cast: tmdb.cast || [],
                imdbRating: tmdb.imdbRating || null,
                videos: videoEntry
            }
        };
    }

    // Fiche Série ou Épisode de série depuis le cloud
    if (id.startsWith("ad_series:")) {
        const payload = id.replace("ad_series:", "");
        const parts = payload.split(":");
        const lastPart = parts[parts.length - 1];
        const secondLastPart = parts[parts.length - 2];
        const isEpisode = parts.length >= 3 && !isNaN(parseInt(lastPart, 10)) && !isNaN(parseInt(secondLastPart, 10));

        if (isEpisode) {
            const episode = parseInt(parts.pop(), 10);
            const season = parseInt(parts.pop(), 10);
            let groupTitle;
            try {
                groupTitle = decodeURIComponent(parts.join(":"));
            } catch (e) {
                groupTitle = parts.join(":");
            }
            const tmdb = await getTmdbMetadata(groupTitle, "series", tmdbKey, true);
            return {
                meta: {
                    id,
                    type: "series",
                    name: `${tmdb.name || groupTitle} S${season}E${episode}`,
                    poster: tmdb.poster || generateFallbackPoster(groupTitle),
                    background: tmdb.backdrop || null,
                    description: `Saison ${season} Épisode ${episode}\n\n${tmdb.description || ""}`,
                    genres: tmdb.genres || [],
                    cast: tmdb.cast || [],
                    imdbRating: tmdb.imdbRating || null
                }
            };
        } else {
            // Dossier Série (fiche principale avec arborescence des épisodes)
            let seriesTitle;
            try {
                seriesTitle = decodeURIComponent(payload);
            } catch (e) {
                seriesTitle = payload;
            }
            const tmdb = await getTmdbMetadata(seriesTitle, "series", tmdbKey, true);
            const displayTitle = tmdb.name || seriesTitle;
            const cleanLower = seriesTitle.toLowerCase();

            // Récupération des épisodes disponibles dans le cache ou compte AllDebrid
            let episodes = [];
            if (cache && cache.series && cache.series[cleanLower] && Array.isArray(cache.series[cleanLower].episodes)) {
                episodes = cache.series[cleanLower].episodes;
            } else {
                try {
                    const [statusRes, linksRes, histRes] = await Promise.all([
                        adGet("/v4.1/magnet/status", apiKey).catch(() => null),
                        adGet("/v4/user/links", apiKey).catch(() => null),
                        adGet("/v4/user/history", apiKey).catch(() => null)
                    ]);
                    const magnets =
                        (statusRes && statusRes.data && statusRes.data.data && statusRes.data.data.magnets) || [];
                    const linksData =
                        (linksRes && linksRes.data && linksRes.data.data && linksRes.data.data.links) || [];
                    const histData = histRes && histRes.data && histRes.data.data;
                    const histLinks = Array.isArray(histData)
                        ? histData
                        : Array.isArray(histData?.history)
                          ? histData.history
                          : Array.isArray(histData?.links)
                            ? histData.links
                            : [];
                    const allUserLinks = [
                        ...(Array.isArray(linksData) ? linksData : []),
                        ...(Array.isArray(histLinks) ? histLinks : [])
                    ];

                    const found = [];
                    for (const m of magnets) {
                        const mTitle = extractCleanTitle(m.filename || "").title.toLowerCase();
                        if (mTitle === cleanLower || mTitle.includes(cleanLower) || cleanLower.includes(mTitle)) {
                            const se = parseSeasonEpisode(m.filename || "");
                            if (!se || se.isSeasonPack || se.episode === null) {
                                let filesMap = {};
                                try {
                                    filesMap = await getMagnetFiles(m.id, apiKey);
                                } catch (e) {}
                                const rawFiles = filesMap[m.id];
                                const flat = flattenFiles(rawFiles).filter(f =>
                                    isRealVideoFile(f.n || f.name || f.filename)
                                );
                                if (flat.length > 0) {
                                    for (const f of flat) {
                                        const fname = f.n || f.name || f.filename || "";
                                        const fSe = parseSeasonEpisode(fname);
                                        const epSeason = fSe && fSe.season ? fSe.season : (se && se.season) || 1;
                                        const epNum =
                                            fSe && fSe.episode !== null && !isNaN(fSe.episode) ? fSe.episode : 1;
                                        found.push({ season: epSeason, episode: epNum, filename: fname });
                                    }
                                } else if (se) {
                                    found.push({
                                        season: se.season || 1,
                                        episode: se.episode || 1,
                                        filename: m.filename
                                    });
                                }
                            } else {
                                found.push({ season: se.season || 1, episode: se.episode, filename: m.filename });
                            }
                        }
                    }
                    for (const l of allUserLinks) {
                        if (!l) continue;
                        const lName = l.filename || l.name || "";
                        if (isObfuscated(lName)) continue;
                        const lTitle = extractCleanTitle(lName).title.toLowerCase();
                        if (lTitle === cleanLower || lTitle.includes(cleanLower) || cleanLower.includes(lTitle)) {
                            const se = parseSeasonEpisode(lName);
                            if (se) {
                                const epNum = se.episode !== null && !isNaN(se.episode) ? se.episode : 1;
                                found.push({ season: se.season || 1, episode: epNum, filename: lName });
                            }
                        }
                    }
                    const seen = new Set();
                    for (const ep of found) {
                        const k = `${ep.season}:${ep.episode}`;
                        if (!seen.has(k)) {
                            seen.add(k);
                            episodes.push(ep);
                        }
                    }
                } catch (e) {}
            }

            episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
            if (episodes.length === 0) {
                episodes = [{ season: 1, episode: 1, filename: displayTitle }];
            }

            return {
                meta: {
                    id,
                    type: "series",
                    name: displayTitle,
                    poster: tmdb.poster || generateFallbackPoster(displayTitle),
                    background: tmdb.backdrop || null,
                    description: `Dossier Série • ${episodes.length} épisode(s) disponible(s)\n\n${tmdb.description || ""}`,
                    genres: tmdb.genres || [],
                    cast: tmdb.cast || [],
                    imdbRating: tmdb.imdbRating || null,
                    videos: episodes.map(ep => ({
                        id: `ad_series:${encodeURIComponent(seriesTitle)}:${ep.season}:${ep.episode}`,
                        title: `Saison ${ep.season} Épisode ${ep.episode}`,
                        season: ep.season,
                        episode: ep.episode,
                        released: new Date().toISOString()
                    }))
                }
            };
        }
    }

    // Fiche pour un fichier cloud AllDebrid ou Torbox
    let filename = "";
    if (id.startsWith("ad_cloud:") || id.startsWith("tb_cloud:")) {
        const isTb = id.startsWith("tb_cloud:");
        const cloudRef = id.replace(/^(ad|tb)_cloud:/, "");

        if (isTb) {
            // Format : tb_cloud:<torrentId> ou tb_cloud:<torrentId>:<fileId>
            const parts = cloudRef.split(":");
            const torrentId = parts[0];
            const fileId = parts[1];
            const tbApiKey = config.torboxApiKey || process.env.TORBOX_API_KEY || apiKey;
            try {
                const { getTorboxTorrentList } = require("./torbox");
                const list = await getTorboxTorrentList(tbApiKey, torrentId).catch(() => []);
                const tor = Array.isArray(list) ? list.find(t => String(t.id) === String(torrentId)) || list[0] : null;
                if (tor) {
                    if (fileId && Array.isArray(tor.files)) {
                        const f = tor.files.find(x => String(x.id) === String(fileId));
                        if (f) filename = f.name || f.filename || tor.name || "";
                        else filename = tor.name || "";
                    } else {
                        filename = tor.name || "";
                    }
                }
            } catch (e) {}
        } else {
            const statusRes = await adGet("/v4.1/magnet/status", apiKey, { id: cloudRef }).catch(() => null);
            const rawMagnets = statusRes && statusRes.data && statusRes.data.data && statusRes.data.data.magnets;
            const magnetData = Array.isArray(rawMagnets) ? rawMagnets[0] : rawMagnets;
            if (magnetData) filename = magnetData.filename || "";

            if (isObfuscated(filename)) {
                const filesMap = await getMagnetFiles([cloudRef], apiKey).catch(() => ({}));
                const files = filesMap[cloudRef] || [];
                const flat = flattenFiles(files).filter(f => f.n && isRealVideoFile(f.n));
                if (flat.length > 0) {
                    flat.sort((a, b) => (b.s || 0) - (a.s || 0));
                    filename = flat[0].n;
                }
            }
        }
    } else {
        const versions = getMovieVersions(id);
        if (versions && versions[0]) filename = versions[0].filename;
    }

    if (id.startsWith("tt")) {
        const cleanId = id.split(":")[0];
        const isSeries = type === "series" || id.includes(":");
        const hasCustomTmdbKey = isCustomTmdbKey(tmdbKey);

        // Priorité TMDB (cohérent avec resolveCatalogMeta qui affiche le titre FR dans le catalogue)
        if (hasCustomTmdbKey) {
            const titleMeta = await imdbIdToTitleAndYear(cleanId, tmdbKey, type);
            if (titleMeta && titleMeta.title) {
                const tmdb = await getTmdbMetadata(titleMeta.title, type, tmdbKey, true);
                if (tmdb && tmdb.name) {
                    return {
                        meta: {
                            id,
                            type,
                            name: tmdb.name,
                            poster: tmdb.poster || generateFallbackPoster(tmdb.name),
                            background: tmdb.backdrop || null,
                            description: tmdb.description || "Disponible sur Cinécloud.",
                            genres: tmdb.genres || [],
                            cast: tmdb.cast || [],
                            imdbRating: tmdb.imdbRating || null
                        }
                    };
                }
            }
        }

        // Repli direct sur Cinemeta par identifiant IMDb (100% fiable, poster et synopsis officiels)
        try {
            const cType = isSeries ? "series" : "movie";
            const cinRes = await axios
                .get(`https://v3-cinemeta.strem.io/meta/${cType}/${encodeURIComponent(cleanId)}.json`, {
                    headers: { "User-Agent": BROWSER_UA },
                    timeout: 5000
                })
                .catch(() => null);
            if (cinRes && cinRes.data && cinRes.data.meta) {
                const cm = cinRes.data.meta;
                return {
                    meta: {
                        id,
                        type,
                        name: cm.name,
                        poster: cm.poster || generateFallbackPoster(cm.name),
                        background: cm.background || cm.poster || null,
                        description: cm.description || "Disponible sur Cinécloud.",
                        genres: cm.genres || (cm.genre ? [cm.genre] : []),
                        cast: cm.cast || [],
                        imdbRating: cm.imdbRating || null,
                        videos: isSeries ? cm.videos || [] : undefined
                    }
                };
            }
        } catch (e) {}
    }

    const tmdb = await getTmdbMetadata(filename, type, tmdbKey, true);
    return {
        meta: {
            id,
            type,
            name: tmdb.name,
            poster: tmdb.poster,
            background: tmdb.backdrop,
            description: `${filename}\n\n${tmdb.description || ""}`,
            genres: tmdb.genres,
            cast: tmdb.cast,
            imdbRating: tmdb.imdbRating
        }
    };
}

const recoMemoryCache = new Map();
const RECO_CACHE_TTL = 60 * 60 * 1000; // 1 heure de cache mémoire

/**
 * Plafond d'éléments envoyés à `classifyContent` par requête de catalogue.
 *
 * Chaque classification déclenche potentiellement une recherche TMDB/Cinemeta.
 * Sans plafond, un compte AllDebrid mature (plusieurs milliers de liens dans
 * /v4/user/history) déclenchait autant d'appels en parallèle : la page mettait
 * plusieurs minutes à répondre, la requête TMDB était saturée (limite
 * ~40 req/min) et le catalogue finissait vide. Le tri C1 s'appliquant APRÈS
 * cette étape, limiter le volume n'introduit pas d'incohérence de pagination.
 */
const MAX_CLASSIFY_PER_REQUEST = 200;

/**
 * Limite de concurrence simple (pLimit)
 */
function pLimit(concurrency) {
    let active = 0;
    const queue = [];
    const next = () => {
        if (active < concurrency && queue.length > 0) {
            active++;
            const { fn, resolve, reject } = queue.shift();
            fn()
                .then(v => {
                    active--;
                    resolve(v);
                    next();
                })
                .catch(e => {
                    active--;
                    reject(e);
                    next();
                });
        }
    };
    return fn =>
        new Promise((resolve, reject) => {
            queue.push({ fn, resolve, reject });
            next();
        });
}

async function getRecommendations(apiKey, tmdbKey, catalogId, _cache) {
    const cacheKey = `${catalogId}_${apiKey ? apiKey.slice(0, 8) : "default"}`;
    const cached = recoMemoryCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < RECO_CACHE_TTL) {
        return { metas: cached.metas };
    }

    const wantAnime = catalogId === "my_ad_reco_animes" || catalogId === "my_ad_reco_animes_movies";
    const isSeries = catalogId === "my_ad_reco_series" || catalogId === "my_ad_reco_animes";
    const targetType = isSeries ? "series" : "movie";
    const tmdbType = isSeries ? "tv" : "movie";

    const metas = [];

    // Tenter TMDB uniquement si une clé personnalisée explicite et non-default est fournie
    const hasCustomTmdbKey = isCustomTmdbKey(tmdbKey);
    if (hasCustomTmdbKey) {
        let sampleFilenames = [];
        try {
            const [statusRes, histRes] = await Promise.all([
                adGet("/v4.1/magnet/status", apiKey).catch(() => null),
                adGet("/v4/user/history", apiKey).catch(() => null)
            ]);
            const magnets = (statusRes && statusRes.data && statusRes.data.data && statusRes.data.data.magnets) || [];
            const histData = histRes && histRes.data && histRes.data.data;
            const histLinks = Array.isArray(histData)
                ? histData
                : Array.isArray(histData?.history)
                  ? histData.history
                  : Array.isArray(histData?.links)
                    ? histData.links
                    : [];
            const allNames = [
                ...magnets.map(m => m && (m.filename || m.name)),
                ...histLinks.map(l => l && (l.filename || l.name))
            ].filter(Boolean);

            sampleFilenames = allNames
                .filter(name => {
                    const fn = String(name || "").trim();
                    if (!fn || fn.length < 2) return false;
                    const alphanum = fn.replace(/[^a-z0-9]/gi, "").toLowerCase();
                    if (
                        alphanum.includes("ipnotallowed") ||
                        alphanum.includes("notallowed") ||
                        ERROR_PATTERNS_RE.test(fn)
                    )
                        return false;
                    return isRealVideoFile(fn) || !/\.[a-z0-9]{2,4}$/i.test(fn);
                })
                .slice(0, 8);
        } catch (e) {}

        const genreCounts = {};
        const knownTmdbIds = new Set();

        for (const filename of sampleFilenames) {
            try {
                const tmdb = await getTmdbMetadata(filename, targetType, tmdbKey);
                if (tmdb && tmdb.tmdbId) knownTmdbIds.add(tmdb.tmdbId);
                if (tmdb && Array.isArray(tmdb.genreIds)) {
                    for (const g of tmdb.genreIds) genreCounts[g] = (genreCounts[g] || 0) + 1;
                }
            } catch (e) {}
        }

        let topGenres = Object.entries(genreCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 2)
            .map(([g]) => g);

        if (wantAnime && !topGenres.includes("16")) {
            topGenres = ["16", ...topGenres].slice(0, 2);
        }

        const originFilter = wantAnime ? "&with_origin_country=JP" : "";
        const genreFilter = topGenres.length > 0 ? `&with_genres=${topGenres.join(",")}` : "";

        let discoverUrl = `https://api.themoviedb.org/3/discover/${tmdbType}?api_key=${tmdbKey}${genreFilter}${originFilter}&sort_by=popularity.desc&language=fr-FR&page=1`;
        let discoverRes = await axios.get(discoverUrl, { timeout: 4000 }).catch(() => null);

        let results = (discoverRes && discoverRes.data && discoverRes.data.results) || [];

        // Repli sur les tendances populaires générales si aucun résultat filtré
        if (results.length === 0) {
            const fallbackUrl = `https://api.themoviedb.org/3/trending/${tmdbType}/week?api_key=${tmdbKey}&language=fr-FR`;
            discoverRes = await axios.get(fallbackUrl, { timeout: 4000 }).catch(() => null);
            results = (discoverRes && discoverRes.data && discoverRes.data.results) || [];
        }

        const filtered = results
            .filter(r => !knownTmdbIds.has(r.id))
            .filter(r =>
                wantAnime
                    ? (r.genre_ids || []).includes(16) || (r.origin_country || []).includes("JP")
                    : !(r.genre_ids || []).includes(16)
            )
            .slice(0, 20);

        if (filtered.length > 0) {
            const resolvedMetas = await Promise.all(
                filtered.map(async r => {
                    const imdbId = await tmdbToImdbId(r.id, targetType, tmdbKey);
                    if (!imdbId) return null;
                    return {
                        id: imdbId,
                        type: targetType,
                        name: r.title || r.name,
                        poster: r.poster_path
                            ? `https://image.tmdb.org/t/p/w500${r.poster_path}`
                            : generateFallbackPoster(r.title || r.name),
                        description: r.overview || "Recommandé pour vous sur Cinécloud."
                    };
                })
            );
            metas.push(...resolvedMetas.filter(Boolean));
        }
    }

    // Repli de secours instantané et fiable sur Cinemeta si TMDB n'a rien renvoyé ou est absent/default
    if (metas.length === 0) {
        try {
            const cinemetaUrl = wantAnime
                ? `https://v3-cinemeta.strem.io/catalog/${targetType}/top/genre=Animation.json`
                : `https://v3-cinemeta.strem.io/catalog/${targetType}/top.json`;
            const cinemetaRes = await axios
                .get(cinemetaUrl, {
                    headers: { "User-Agent": BROWSER_UA },
                    timeout: 5000
                })
                .catch(() => null);
            const cinMetas = (cinemetaRes && cinemetaRes.data && cinemetaRes.data.metas) || [];
            for (const cm of cinMetas.slice(0, 25)) {
                const cmName = cm.name || "";
                const alphanum = cmName.replace(/[^a-z0-9]/gi, "").toLowerCase();
                if (
                    alphanum.includes("ipnotallowed") ||
                    alphanum.includes("notallowed") ||
                    ERROR_PATTERNS_RE.test(cmName)
                )
                    continue;
                metas.push({
                    id: cm.imdb_id || cm.id,
                    type: targetType,
                    name: cmName,
                    poster: cm.poster || generateFallbackPoster(cmName),
                    description: cm.description || "Recommandé pour vous sur Cinécloud."
                });
            }
        } catch (e) {}
    }

    if (metas.length > 0) {
        recoMemoryCache.set(cacheKey, { timestamp: Date.now(), metas });
    }

    return { metas };
}

// Cache mémoire rapide pour les métadonnées résolues du catalogue (évite de re-résoudre à chaque scroll)
const catalogMemCache = makeLRU(500, 15 * 60_000); // 500 entrées max, TTL 15 min
async function resolveCatalogMeta(cleanTitle, type, tmdbKey, expectedYear = null, altTitle = null) {
    if (!cleanTitle || cleanTitle.length < 2) return null;
    const key = `${type}_${cleanTitle.toLowerCase()}_${altTitle ? altTitle.toLowerCase() : ""}_${expectedYear || ""}`;
    if (catalogMemCache.has(key)) {
        return catalogMemCache.get(key);
    }
    let result = null;
    try {
        const tmdb = await getTmdbMetadata(cleanTitle, type, tmdbKey).catch(() => null);
        if (tmdb) {
            let imdbId = tmdb.imdbId || null;
            if (!imdbId && tmdb.tmdbId) {
                imdbId = await tmdbToImdbId(tmdb.tmdbId, type, tmdbKey).catch(() => null);
            }
            result = {
                imdbId,
                name: tmdb.name || cleanTitle,
                poster: tmdb.poster || null,
                description: tmdb.description || null
            };
        }
    } catch (e) {}

    // Recherche de repli sur altTitle avec TMDB si disponible
    if ((!result || !result.imdbId) && altTitle && altTitle.trim()) {
        try {
            const tmdbAlt = await getTmdbMetadata(altTitle, type, tmdbKey).catch(() => null);
            if (tmdbAlt) {
                let imdbId = tmdbAlt.imdbId || null;
                if (!imdbId && tmdbAlt.tmdbId) {
                    imdbId = await tmdbToImdbId(tmdbAlt.tmdbId, type, tmdbKey).catch(() => null);
                }
                result = {
                    imdbId,
                    name: tmdbAlt.name || altTitle,
                    poster: tmdbAlt.poster || null,
                    description: tmdbAlt.description || null
                };
            }
        } catch (e) {}
    }

    if (!result || !result.imdbId) {
        try {
            const cin = await searchCinemeta(cleanTitle, type, expectedYear, altTitle).catch(() => null);
            if (cin && cin.imdbId) {
                result = {
                    imdbId: cin.imdbId,
                    name: cin.name || cleanTitle,
                    poster: cin.poster || null,
                    description: cin.description || null
                };
            }
        } catch (e) {}
    }

    // Repli croisé sur l'autre type (movie <-> series) si aucun id trouvé (cas des animés/miniséries)
    if (!result || !result.imdbId) {
        const altType = type === "series" ? "movie" : "series";
        try {
            const cinAlt = await searchCinemeta(cleanTitle, altType, expectedYear, altTitle).catch(() => null);
            if (cinAlt && cinAlt.imdbId) {
                result = {
                    imdbId: cinAlt.imdbId,
                    name: cinAlt.name || cleanTitle,
                    poster: cinAlt.poster || null,
                    description: cinAlt.description || null
                };
            }
        } catch (e) {}
    }

    // Francisation du titre affiché sous les affiches dans les catalogues
    if (result && result.imdbId) {
        try {
            const frName = await getFrenchTitle(result.imdbId, result.name, tmdbKey, type);
            if (frName && frName.trim()) {
                result.name = frName.trim();
            }
        } catch (e) {}
    }

    if (result && result.name && hasNonLatinCharacters(result.name)) {
        result.name = cleanTitle;
    }

    catalogMemCache.set(key, result);
    return result;
}

async function handleCatalog(config, type, id, cache, extra = null) {
    if (config && config.disableCatalogs) {
        return { metas: [] };
    }

    const { apiKey } = config;
    const tmdbKey = config.tmdbKey && config.tmdbKey !== "default" ? config.tmdbKey : TMDB_KEY_DEFAULT;

    // Pagination et recherche Stremio (skip, search)
    let skip = 0;
    let searchQuery = "";
    if (typeof extra === "string") {
        const searchMatch = extra.match(/(?:^|[&?])search=([^&]+)/);
        if (searchMatch) {
            try {
                searchQuery = decodeURIComponent(searchMatch[1].replace(/\+/g, " ")).trim().toLowerCase();
            } catch (e) {
                searchQuery = searchMatch[1].replace(/\+/g, " ").trim().toLowerCase();
            }
        }
        const skipMatch = extra.match(/(?:^|[&?])skip=(\d+)/);
        if (skipMatch) skip = parseInt(skipMatch[1], 10);
    } else if (extra && typeof extra === "object") {
        if (extra.search) searchQuery = String(extra.search).trim().toLowerCase();
        if (extra.skip !== undefined) skip = parseInt(extra.skip, 10);
    }
    if (isNaN(skip) || skip < 0) skip = 0;
    const PAGE_SIZE = 50;

    // Helper pour appliquer la pagination skip si fournie
    function applyPagination(result) {
        if (!result || !Array.isArray(result.metas)) return { metas: [] };
        let filtered = result.metas;
        if (searchQuery) {
            filtered = filtered.filter(m => {
                const nameLower = (m.name || "").toLowerCase();
                return nameLower.includes(searchQuery) || isConfidentTitleMatch(searchQuery, m.name || "");
            });
        }
        return { metas: filtered.slice(skip, skip + PAGE_SIZE) };
    }

    // Catalogues de Recommandations Personnalisées TMDB
    if (id.startsWith("my_ad_reco_")) {
        const recoResult = await getRecommendations(apiKey, tmdbKey, id, cache);
        return applyPagination(recoResult);
    }

    // Catalogues "Mes Liens Débridés" et "Mon Historique"
    const isHistoryOrLinks =
        id === "my_ad_links" || id === "my_ad_links_series" || id === "my_ad_history" || id === "my_ad_history_series";
    if (isHistoryOrLinks) {
        const isHistory = id.includes("history");
        const wantSeries = id.endsWith("_series");
        const endpoint = isHistory ? "/v4/user/history" : "/v4/user/links";
        const res = await adGet(endpoint, apiKey).catch(err => {
            console.error(`[AllDebrid] Erreur ${endpoint}:`, err.response?.data?.error?.message || err.message);
            return null;
        });
        let links = [];
        if (res && res.data && res.data.data) {
            const d = res.data.data;
            if (Array.isArray(d)) {
                links = d;
            } else if (Array.isArray(d.links)) {
                links = d.links;
            } else if (Array.isArray(d.history)) {
                links = d.history;
            } else if (Array.isArray(d.downloads)) {
                links = d.downloads;
            }
        }

        const seenFilenames = new Set();
        const validLinks = links.filter(l => {
            if (!l || typeof l !== "object") return false;
            const fn = (l.filename || l.name || "").trim();
            if (!fn || fn.length < 2) return false;
            // Écarte les artefacts (zip/rar/srt/jpg…) et les contenus annexes (sample/bonus/trailer…)
            if (isExcludedArtifact(fn)) return false;
            if (isObfuscated(fn)) return false;
            const fnAlphanum = fn.replace(/[^a-z0-9]/gi, "").toLowerCase();
            if (fnAlphanum === "ipnotallowed" || fnAlphanum.includes("notallowed") || ERROR_PATTERNS_RE.test(fn))
                return false;
            const { title: clean } = extractCleanTitle(fn);
            if (!clean || clean.length < 2 || isObfuscated(clean)) return false;
            const cleanAlphanum = clean.replace(/[^a-z0-9]/gi, "").toLowerCase();
            if (
                cleanAlphanum === "ipnotallowed" ||
                cleanAlphanum.includes("notallowed") ||
                ERROR_PATTERNS_RE.test(clean)
            )
                return false;
            if (/^(404|403|500|502|503)$/.test(clean.trim())) return false;
            const lower = fn.toLowerCase();
            if (seenFilenames.has(lower)) return false;
            seenFilenames.add(lower);
            return true;
        });

        // Tri déterministe AVANT le plafond. Sans lui, le `.slice(0, 200)`
        // conservait les premiers éléments dans l'ordre arbitraire renvoyé par
        // l'API AllDebrid : la sélection pouvait varier d'un appel à l'autre et
        // rendre la pagination incohérente. Ce tri anticipe le tri des groupes
        // (C1), appliqué plus bas sur la même clé.
        validLinks.sort((a, b) =>
            String(a.filename || a.name || "")
                .toLowerCase()
                .localeCompare(String(b.filename || b.name || "").toLowerCase(), "fr", { numeric: true })
        );

        // Classification intelligente via TMDB multi-search avec cache (concurrence maîtrisée).
        // Plafonnée : le volume trié ensuite par C1 reste borné, sinon un compte
        // mature saturerait TMDB et la page mettrait plusieurs minutes à répondre.
        //
        // LIMITE CONNUE : au-delà de MAX_CLASSIFY éléments triés, les pages
        // suivantes sont vides (les items restants ne sont jamais classifiés).
        // Corriger ça demande une fenêtre de classement offsetée sur `skip` —
        // refactor dédié, non entrepris ici.
        if (validLinks.length > MAX_CLASSIFY_PER_REQUEST) {
            console.warn(
                `[Catalog] ${validLinks.length} liens à classer, seuls les ${MAX_CLASSIFY_PER_REQUEST} premiers seront traités (plafond anti-saturation TMDB).`
            );
        }
        const linksToClassify = validLinks.slice(0, MAX_CLASSIFY_PER_REQUEST);
        const classifyLimit = pLimit(8);
        const classified = await Promise.all(
            linksToClassify.map(l =>
                classifyLimit(async () => {
                    const fname = l.filename || l.name || "";
                    const classId = `link:${l.link || fname}`;
                    const c = await classifyContent(classId, fname, tmdbKey, cache);
                    return { l, c, fname };
                })
            )
        );

        const relevant = classified.filter(({ c }) => c && (wantSeries ? c.type === "series" : c.type === "movie"));

        if (wantSeries) {
            // Regroupement par série des épisodes de l'historique et des liens débridés
            const seriesGroups = new Map();
            for (const { l, c, fname } of relevant) {
                const effectiveFilename = fname || l.filename || l.name || "";
                if (isObfuscated(effectiveFilename)) continue;
                const { title: cleanName, altTitle } = extractCleanTitle(effectiveFilename);
                if (!cleanName || isObfuscated(cleanName)) continue;
                const groupKey = (c.name || cleanName || effectiveFilename).trim().toLowerCase();
                if (!seriesGroups.has(groupKey)) {
                    seriesGroups.set(groupKey, {
                        cleanName: c.name || cleanName || effectiveFilename,
                        altTitle: altTitle || null,
                        c,
                        firstFilename: effectiveFilename,
                        episodes: []
                    });
                }
                const grp = seriesGroups.get(groupKey);
                if (!Array.isArray(grp.filenames)) grp.filenames = [];
                if (!Array.isArray(grp.sizes)) grp.sizes = [];
                grp.filenames.push(effectiveFilename);
                grp.sizes.push(l.size || l.filesize || 0);
                const se = parseSeasonEpisode(effectiveFilename);
                const epSeason = se ? se.season : 1;
                const epEpisode = se && se.episode !== null && !isNaN(se.episode) ? se.episode : 1;
                if (!grp.episodes.some(e => e.season === epSeason && e.episode === epEpisode && e.link === l.link)) {
                    grp.episodes.push({
                        season: epSeason,
                        episode: epEpisode,
                        filename: effectiveFilename,
                        link: l.link,
                        fileLink: l.link
                    });
                }
            }

            // C4 (séries) : représentative la plus qualitative du groupe, utilisée pour
            // le badge et le filtrage par recherche. Sans cela, la série pouvait être
            // étiquetée d'après un 720p alors qu'un 1080p est disponible.
            for (const grp of seriesGroups.values()) {
                const best = pickBestReleaseFilename(grp.filenames, grp.sizes);
                if (best) {
                    grp.firstFilename = best;
                    delete grp.filenames;
                    delete grp.sizes;
                }
            }

            if (searchQuery) {
                for (const [key, grp] of Array.from(seriesGroups.entries())) {
                    const titleLower = (grp.cleanName || "").toLowerCase();
                    const altLower = (grp.altTitle || "").toLowerCase();
                    const fnameLower = (grp.firstFilename || "").toLowerCase();
                    const match =
                        titleLower.includes(searchQuery) ||
                        altLower.includes(searchQuery) ||
                        fnameLower.includes(searchQuery) ||
                        isConfidentTitleMatch(searchQuery, grp.cleanName) ||
                        (grp.altTitle && isConfidentTitleMatch(searchQuery, grp.altTitle));
                    if (!match) {
                        seriesGroups.delete(key);
                    }
                }
            }

            // C1 : trier AVANT de paginer. La Map est remplie dans l'ordre d'arrivée
            // des liens AllDebrid, qui n'est pas stable d'un appel à l'autre :
            // sans tri, `slice(skip, skip + PAGE_SIZE)` renvoyait des pages
            // différentes à chaque rafraîchissement, avec doublons et trous.
            const sortedSeriesGroups = Array.from(seriesGroups.values()).sort((a, b) =>
                (a.cleanName || "").localeCompare(b.cleanName || "", "fr", { sensitivity: "base", numeric: true })
            );
            const pageSeriesGroups = sortedSeriesGroups.slice(skip, skip + PAGE_SIZE);
            const seriesLimit = pLimit(6);
            const metasSeries = await Promise.all(
                pageSeriesGroups.map(grp =>
                    seriesLimit(async () => {
                        const resolved = await resolveCatalogMeta(grp.cleanName, "series", tmdbKey, null, grp.altTitle);
                        const imdbId =
                            resolved?.imdbId ||
                            (grp.c?.tmdbId ? await tmdbToImdbId(grp.c.tmdbId, "series", tmdbKey) : null);
                        const displayTitle = resolved?.name || grp.cleanName;

                        if (Array.isArray(grp.episodes)) {
                            grp.episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
                        } else {
                            grp.episodes = [];
                        }

                        if (!cache.series) cache.series = {};
                        if (imdbId) {
                            let sEntry = cache.series[imdbId];
                            if (!sEntry || typeof sEntry !== "object") {
                                sEntry = { groupTitle: displayTitle.toLowerCase(), episodes: [] };
                            }
                            if (!Array.isArray(sEntry.episodes)) sEntry.episodes = [];
                            sEntry.groupTitle = displayTitle.toLowerCase();
                            for (const ep of grp.episodes || []) {
                                if (
                                    !sEntry.episodes.some(
                                        e =>
                                            e.season === ep.season &&
                                            e.episode === ep.episode &&
                                            (e.link === ep.link || e.filename === ep.filename)
                                    )
                                ) {
                                    sEntry.episodes.push(ep);
                                }
                            }
                            sEntry.episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
                            cache.series[imdbId] = sEntry;
                            return {
                                id: imdbId,
                                type: "series",
                                name: displayTitle,
                                poster: resolved?.poster || generateFallbackPoster(displayTitle),
                                background: null,
                                description: `Historique Séries • ${sEntry.episodes.length} épisode(s) disponible(s)`
                            };
                        }

                        let sEntry = cache.series[displayTitle.toLowerCase()];
                        if (!sEntry || typeof sEntry !== "object") {
                            sEntry = { groupTitle: displayTitle.toLowerCase(), episodes: [] };
                        }
                        if (!Array.isArray(sEntry.episodes)) sEntry.episodes = [];
                        sEntry.groupTitle = displayTitle.toLowerCase();
                        for (const ep of grp.episodes || []) {
                            if (
                                !sEntry.episodes.some(
                                    e =>
                                        e.season === ep.season &&
                                        e.episode === ep.episode &&
                                        (e.link === ep.link || e.filename === ep.filename)
                                )
                            ) {
                                sEntry.episodes.push(ep);
                            }
                        }
                        sEntry.episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
                        cache.series[displayTitle.toLowerCase()] = sEntry;
                        return {
                            id: `ad_series:${encodeURIComponent(displayTitle)}`,
                            type: "series",
                            name: displayTitle,
                            poster: resolved?.poster || generateFallbackPoster(displayTitle),
                            background: null,
                            description: `Historique Séries • ${sEntry.episodes.length} épisode(s) disponible(s)`
                        };
                    })
                )
            );
            return { metas: metasSeries };
        }

        // Pour les films : regroupement par film distinct (cleanName + year)
        const movieGroups = new Map();
        for (const { l, c, fname } of relevant) {
            const effectiveFilename = fname || l.filename || l.name || "";
            const { title: cleanName, year, altTitle } = extractCleanTitle(effectiveFilename);
            const groupKey = `${(cleanName || effectiveFilename).trim().toLowerCase()}_${year || ""}`;
            if (!movieGroups.has(groupKey)) {
                movieGroups.set(groupKey, {
                    cleanName: cleanName || effectiveFilename,
                    altTitle: altTitle || null,
                    year,
                    firstFilename: effectiveFilename,
                    c,
                    links: []
                });
            }
            const grp = movieGroups.get(groupKey);
            if (!Array.isArray(grp.links)) grp.links = [];
            if (!Array.isArray(grp.filenames)) grp.filenames = [];
            if (!Array.isArray(grp.sizes)) grp.sizes = [];
            grp.links.push(l);
            grp.filenames.push(effectiveFilename);
            grp.sizes.push(l.size || l.filesize || 0);
        }

        // C4 : le nom affiché et le badge technique doivent provenir de la MEILLEURE
        // release du groupe, pas du premier fichier rencontré (ordre AllDebrid
        // arbitraire). Un groupe contenant 1080p puis 2160p affichait [1080p].
        for (const grp of movieGroups.values()) {
            const best = pickBestReleaseFilename(grp.filenames, grp.sizes);
            if (best) {
                grp.firstFilename = best;
                delete grp.filenames;
                delete grp.sizes;
            }
        }

        if (searchQuery) {
            for (const [key, grp] of Array.from(movieGroups.entries())) {
                const titleLower = (grp.cleanName || "").toLowerCase();
                const altLower = (grp.altTitle || "").toLowerCase();
                const fnameLower = (grp.firstFilename || "").toLowerCase();
                const match =
                    titleLower.includes(searchQuery) ||
                    altLower.includes(searchQuery) ||
                    fnameLower.includes(searchQuery) ||
                    isConfidentTitleMatch(searchQuery, grp.cleanName) ||
                    (grp.altTitle && isConfidentTitleMatch(searchQuery, grp.altTitle));
                if (!match) {
                    movieGroups.delete(key);
                }
            }
        }

        // C1 : trier AVANT de paginer (voir commentaire équivalent côté séries).
        // Clé de tri composite : titre alphabétique puis année décroissante, pour
        // que les reboot/films homonymes les plus récents passent en premier.
        const sortedMovieGroups = Array.from(movieGroups.values()).sort((a, b) => {
            const byTitle = (a.cleanName || "").localeCompare(b.cleanName || "", "fr", {
                sensitivity: "base",
                numeric: true
            });
            if (byTitle !== 0) return byTitle;
            return String(b.year || "").localeCompare(String(a.year || ""), "fr", { numeric: true });
        });
        const movieGroupList = sortedMovieGroups.slice(skip, skip + PAGE_SIZE);
        const movieLimit = pLimit(6);
        const metasMovies = await Promise.all(
            movieGroupList.map(grp =>
                movieLimit(async () => {
                    const resolved = await resolveCatalogMeta(grp.cleanName, "movie", tmdbKey, grp.year, grp.altTitle);
                    const imdbId =
                        resolved?.imdbId || (grp.c?.tmdbId ? await tmdbToImdbId(grp.c.tmdbId, "movie", tmdbKey) : null);
                    const displayTitle = resolved?.name || grp.cleanName;
                    const badge = extractTechBadge(grp.firstFilename);

                    if (imdbId && cache) {
                        if (!cache.movies) cache.movies = {};
                        let mList = cache.movies[imdbId];
                        if (!Array.isArray(mList)) {
                            mList = [];
                        }
                        for (const l of Array.isArray(grp.links) ? grp.links : []) {
                            if (!mList.some(e => e.link === l.link)) {
                                mList.push({
                                    link: l.link,
                                    filename: l.filename || l.name || grp.firstFilename,
                                    size: l.size || l.filesize || 0
                                });
                            }
                        }
                        cache.movies[imdbId] = mList;
                        return {
                            id: imdbId,
                            type: "movie",
                            name: displayTitle,
                            poster: resolved?.poster || generateFallbackPoster(displayTitle),
                            description: resolved?.description || "Film disponible dans votre compte AllDebrid."
                        };
                    }

                    const firstLink = String(
                        (Array.isArray(grp.links) && grp.links[0]?.link) || grp.firstFilename || ""
                    );
                    return {
                        id: `ad_link:${Buffer.from(firstLink).toString("base64url")}`,
                        type: "movie",
                        name: `${badge ? "[" + badge + "] " : ""}${displayTitle}`,
                        poster: resolved?.poster || generateFallbackPoster(displayTitle),
                        description: `${badge ? badge + "\n" : ""}${grp.firstFilename}`
                    };
                })
            )
        );

        return { metas: metasMovies };
    }

    // Catalogues Cloud ("Mes Films", "Mes Séries", "Animés")
    const isCloudMovies = id === "my_ad_movies" || id === "my_ad_magnets";
    const isCloudSeries = id === "my_ad_series" || id === "my_ad_magnets_series";
    const isAnimeSeries = id === "my_ad_animes";
    const isAnimeMovies = id === "my_ad_animes_movies";

    // 1. Récupération AllDebrid magnets
    let allMagnets = [];
    if (apiKey) {
        const statusRes = await adGet("/v4.1/magnet/status", apiKey).catch(err => {
            console.error("[AllDebrid] Erreur magnet/status:", err.response?.data?.error?.message || err.message);
            return null;
        });
        allMagnets = (statusRes && statusRes.data && statusRes.data.data && statusRes.data.data.magnets) || [];
    }

    // 2. Récupération Torbox Torrents si activé
    const debridProvider = config.debridProvider || "alldebrid";
    const hasTorbox = debridProvider === "torbox" || debridProvider === "both";
    const activeTbApiKey = config.torboxApiKey || process.env.TORBOX_API_KEY || "";
    let tbTorrents = [];
    if (hasTorbox && activeTbApiKey) {
        try {
            const { getTorboxTorrentList } = require("./torbox");
            tbTorrents = await getTorboxTorrentList(activeTbApiKey).catch(() => []);
        } catch (e) {}
    }

    const cloudItems = [];
    for (const m of allMagnets) {
        const fn = (m.filename || "").trim();
        // Écarte les artefacts (zip/rar/srt/jpg…) et les contenus annexes (sample/bonus/trailer…)
        if (!fn || fn.length < 2 || isExcludedArtifact(fn)) continue;
        if (isObfuscated(fn)) continue;
        const alphanum = fn.replace(/[^a-z0-9]/gi, "").toLowerCase();
        if (alphanum === "ipnotallowed" || alphanum.includes("notallowed") || ERROR_PATTERNS_RE.test(fn)) continue;
        // Le magnet doit être PRÊT (statusCode 4) : les états 0-3 (file d'attente, téléchargement,
        // compression, upload) rendent un flux illisible — l'annoncer comme instantané provoquait
        // des « Échec résolution » en boucle au clic.
        if (!alldebrid.isAllDebridMagnetReady(m)) continue;
        if (alldebrid.isAllDebridTargetDead(m.id)) continue;
        cloudItems.push({ id: `ad_${m.id}`, originalId: m.id, filename: fn, size: m.size || 0, provider: "alldebrid" });
    }
    for (const t of Array.isArray(tbTorrents) ? tbTorrents : []) {
        // Écarte les torrents non encore téléchargés : la lecture échouerait (HTTP 422 sur requestdl)
        if (!isTorboxTorrentReady(t)) continue;
        const fn = (t.name || "").trim();
        // Les torrents Torbox n'étaient filtrés que par isObfuscated : appliquer aussi
        // l'exclusion des artefacts (zip/rar/srt…) et des contenus annexes (sample/bonus…)
        if (!fn || fn.length < 2 || isExcludedArtifact(fn) || isObfuscated(fn)) continue;
        cloudItems.push({
            id: `tb_${t.id}`,
            originalId: t.id,
            filename: fn,
            size: t.size || 0,
            provider: "torbox",
            files: t.files || []
        });
    }

    // Même tri déterministe qu'historique/liens (même raison, voir plus haut).
    cloudItems.sort((a, b) =>
        String(a.filename || "")
            .toLowerCase()
            .localeCompare(String(b.filename || "").toLowerCase(), "fr", { numeric: true })
    );

    // Classification intelligente via TMDB multi-search avec cache (concurrence maîtrisée).
    // Même plafond que les catalogues Historique/Liens : au-delà de quelques centaines
    // de magnets, TMDB était saturé et la requête n'aboutissait jamais.
    const itemsToClassify = cloudItems.slice(0, MAX_CLASSIFY_PER_REQUEST);
    if (cloudItems.length > MAX_CLASSIFY_PER_REQUEST) {
        console.warn(
            `[Catalog] ${cloudItems.length} magnets à classer, seuls les ${MAX_CLASSIFY_PER_REQUEST} premiers seront traités (plafond anti-saturation TMDB).`
        );
    }
    const cloudClassifyLimit = pLimit(8);
    const classifiedCloud = await Promise.all(
        itemsToClassify.map(item =>
            cloudClassifyLimit(async () => {
                const c = await classifyContent(item.id, item.filename, tmdbKey, cache);
                return { item, c };
            })
        )
    );

    let matched = [];
    for (const { item, c } of classifiedCloud) {
        if (isAnimeSeries && c.type === "series" && c.isAnime) matched.push({ item, c, currentType: "series" });
        else if (isAnimeMovies && c.type === "movie" && c.isAnime) matched.push({ item, c, currentType: "movie" });
        else if (isCloudSeries && c.type === "series" && !c.isAnime) matched.push({ item, c, currentType: "series" });
        else if (isCloudMovies && c.type === "movie" && !c.isAnime) matched.push({ item, c, currentType: "movie" });
    }

    const wantSeriesCloud = isCloudSeries || isAnimeSeries;

    // 1. Traitement des Séries Cloud : regroupement par dossier série
    if (wantSeriesCloud) {
        // Pré-récupération des fichiers internes pour les packs de saison AllDebrid
        const adSeasonPackItems = matched.filter(({ item, c }) => {
            if (item.provider !== "alldebrid") return false;
            const se = parseSeasonEpisode(item.filename || "");
            return Boolean(
                se?.isSeasonPack ||
                (se && se.episode === null) ||
                isCompleteSeriesPack(item.filename || "") ||
                (!se && c?.type === "series")
            );
        });

        let adFilesMap = {};
        if (adSeasonPackItems.length > 0 && apiKey) {
            const packIds = adSeasonPackItems.map(({ item }) => item.originalId);
            try {
                adFilesMap = await getMagnetFiles(packIds, apiKey);
            } catch (e) {
                adFilesMap = {};
            }
        }

        const seriesGroups = new Map();
        for (const { item, c } of matched) {
            const { title: cleanName, altTitle } = extractCleanTitle(item.filename || "");
            const groupKey = (c.name || cleanName || item.filename).trim().toLowerCase();
            if (!seriesGroups.has(groupKey)) {
                seriesGroups.set(groupKey, {
                    cleanName: c.name || cleanName || item.filename,
                    altTitle: altTitle || null,
                    c,
                    episodes: []
                });
            }
            const grp = seriesGroups.get(groupKey);
            if (!Array.isArray(grp.episodes)) grp.episodes = [];

            if (item.provider === "torbox" && Array.isArray(item.files)) {
                // Ne conserver que les fichiers vidéo du pack (écarte .zip/.srt/sample/bonus…)
                const tbVideoFiles = item.files.filter(f => isRealVideoFile(f.name || f.filename || ""));
                for (const f of tbVideoFiles) {
                    const se = parseSeasonEpisode(f.name || f.filename || "");
                    const epSeason = se?.season || 1;
                    const epNum = se?.episode !== null && !isNaN(se?.episode) ? se.episode : 1;
                    if (!grp.episodes.some(e => e.season === epSeason && e.episode === epNum)) {
                        grp.episodes.push({
                            season: epSeason,
                            episode: epNum,
                            filename: f.name || f.filename,
                            tbRef: `${item.originalId}:${f.id}`
                        });
                    }
                }
            } else if (item.provider === "alldebrid" && adFilesMap && adFilesMap[item.originalId]) {
                const rawFiles = adFilesMap[item.originalId];
                const flat = flattenFiles(rawFiles).filter(f => isRealVideoFile(f.n || f.name || f.filename));
                const seParent = parseSeasonEpisode(item.filename || "");
                if (flat.length > 0) {
                    for (const f of flat) {
                        const fname = f.n || f.name || f.filename || "";
                        const fSe = parseSeasonEpisode(fname);
                        const epSeason = fSe && fSe.season ? fSe.season : seParent?.season || 1;
                        const epNum = fSe && fSe.episode !== null && !isNaN(fSe.episode) ? fSe.episode : 1;
                        if (
                            !grp.episodes.some(
                                e => e.season === epSeason && e.episode === epNum && e.filename === fname
                            )
                        ) {
                            grp.episodes.push({
                                season: epSeason,
                                episode: epNum,
                                magnetId: item.originalId,
                                filename: fname,
                                link: f.l || f.link || null,
                                fileLink: f.l || f.link || null
                            });
                        }
                    }
                } else {
                    const se = seParent;
                    const epSeason = se?.season || 1;
                    const epNum = se?.episode !== null && !isNaN(se?.episode) ? se.episode : 1;
                    if (!grp.episodes.some(e => e.season === epSeason && e.episode === epNum)) {
                        grp.episodes.push({
                            season: epSeason,
                            episode: epNum,
                            magnetId: item.originalId,
                            filename: item.filename
                        });
                    }
                }
            } else {
                const se = parseSeasonEpisode(item.filename || "");
                if (se) {
                    const epSeason = se.season || 1;
                    const epNum = se.episode !== null && !isNaN(se.episode) ? se.episode : 1;
                    if (!grp.episodes.some(e => e.season === epSeason && e.episode === epNum)) {
                        grp.episodes.push({
                            season: epSeason,
                            episode: epNum,
                            magnetId: item.originalId,
                            filename: item.filename
                        });
                    }
                } else {
                    grp.episodes.push({ season: 1, episode: 1, magnetId: item.originalId, filename: item.filename });
                }
            }
        }

        if (searchQuery) {
            for (const [key, grp] of Array.from(seriesGroups.entries())) {
                const titleLower = (grp.cleanName || "").toLowerCase();
                const altLower = (grp.altTitle || "").toLowerCase();
                const match =
                    titleLower.includes(searchQuery) ||
                    altLower.includes(searchQuery) ||
                    isConfidentTitleMatch(searchQuery, grp.cleanName) ||
                    (grp.altTitle && isConfidentTitleMatch(searchQuery, grp.altTitle));
                if (!match) {
                    seriesGroups.delete(key);
                }
            }
        }

        const pageSeriesGroups = Array.from(seriesGroups.values()).slice(skip, skip + PAGE_SIZE);
        const cloudSeriesLimit = pLimit(6);
        const seriesMetas = await Promise.all(
            pageSeriesGroups.map(grp =>
                cloudSeriesLimit(async () => {
                    const resolved = await resolveCatalogMeta(grp.cleanName, "series", tmdbKey, null, grp.altTitle);
                    const imdbId =
                        resolved?.imdbId ||
                        (grp.c?.tmdbId ? await tmdbToImdbId(grp.c.tmdbId, "series", tmdbKey) : null);
                    const displayTitle = resolved?.name || grp.cleanName;

                    if (Array.isArray(grp.episodes)) {
                        grp.episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
                    } else {
                        grp.episodes = [];
                    }

                    if (!cache.series) cache.series = {};
                    if (imdbId) {
                        cache.series[imdbId] = {
                            groupTitle: displayTitle.toLowerCase(),
                            episodes: grp.episodes || []
                        };
                        return {
                            id: imdbId,
                            type: "series",
                            name: displayTitle,
                            poster: resolved?.poster || generateFallbackPoster(displayTitle),
                            background: null,
                            description: `Dossier Série • ${(grp.episodes || []).length} épisode(s) disponible(s)`
                        };
                    }

                    cache.series[displayTitle.toLowerCase()] = {
                        groupTitle: displayTitle.toLowerCase(),
                        episodes: grp.episodes || []
                    };
                    return {
                        id: `ad_series:${encodeURIComponent(displayTitle)}`,
                        type: "series",
                        name: displayTitle,
                        poster: resolved?.poster || generateFallbackPoster(displayTitle),
                        background: null,
                        description: `Dossier Série • ${(grp.episodes || []).length} épisode(s) disponible(s)`
                    };
                })
            )
        );

        return { metas: seriesMetas };
    }

    // 2. Traitement des Films Cloud : regroupement préalable par œuvre unique (cleanName + year)
    const movieGroups = new Map();
    for (const { item, c } of matched) {
        const { title: cleanName, year, altTitle } = extractCleanTitle(item.filename || "");
        const groupKey = `${(c.name || cleanName || item.filename).trim().toLowerCase()}_${year || ""}`;
        if (!movieGroups.has(groupKey)) {
            movieGroups.set(groupKey, {
                cleanName: c.name || cleanName || item.filename,
                altTitle: altTitle || null,
                year,
                firstItem: item,
                c,
                items: []
            });
        }
        const mg = movieGroups.get(groupKey);
        if (!Array.isArray(mg.items)) mg.items = [];
        mg.items.push(item);
    }

    if (searchQuery) {
        for (const [key, grp] of Array.from(movieGroups.entries())) {
            const titleLower = (grp.cleanName || "").toLowerCase();
            const altLower = (grp.altTitle || "").toLowerCase();
            const fnameLower = (grp.firstItem?.filename || "").toLowerCase();
            const match =
                titleLower.includes(searchQuery) ||
                altLower.includes(searchQuery) ||
                fnameLower.includes(searchQuery) ||
                isConfidentTitleMatch(searchQuery, grp.cleanName) ||
                (grp.altTitle && isConfidentTitleMatch(searchQuery, grp.altTitle));
            if (!match) {
                movieGroups.delete(key);
            }
        }
    }

    const pageMovieGroups = Array.from(movieGroups.values()).slice(skip, skip + PAGE_SIZE);
    const cloudMovieLimit = pLimit(6);
    const movieMetas = await Promise.all(
        pageMovieGroups.map(grp =>
            cloudMovieLimit(async () => {
                const effectiveFilename = grp.firstItem.filename || "";
                const badge = extractTechBadge(effectiveFilename);
                const resolved = await resolveCatalogMeta(grp.cleanName, "movie", tmdbKey, grp.year, grp.altTitle);
                const imdbId =
                    resolved?.imdbId || (grp.c?.tmdbId ? await tmdbToImdbId(grp.c.tmdbId, "movie", tmdbKey) : null);
                const displayTitle = resolved?.name || grp.cleanName;

                if (imdbId) {
                    if (!cache.movies) cache.movies = {};
                    let mList = cache.movies[imdbId];
                    if (!Array.isArray(mList)) {
                        mList = [];
                    }
                    for (const it of grp.items) {
                        if (it.provider === "torbox") {
                            if (!mList.some(e => e.tbRef === it.originalId)) {
                                mList.push({ tbRef: it.originalId, filename: it.filename, size: it.size || 0 });
                            }
                        } else {
                            if (!mList.some(e => e.alldebridId === it.originalId)) {
                                mList.push({ alldebridId: it.originalId, filename: it.filename, size: it.size || 0 });
                            }
                        }
                    }
                    cache.movies[imdbId] = mList;
                    return {
                        id: imdbId,
                        type: "movie",
                        name: displayTitle,
                        poster: resolved?.poster || generateFallbackPoster(displayTitle),
                        description: resolved?.description || "Film disponible dans votre compte Cloud."
                    };
                }

                const fallbackId =
                    grp.firstItem.provider === "torbox"
                        ? `tb_cloud:${grp.firstItem.originalId}`
                        : `ad_cloud:${grp.firstItem.originalId}`;
                return {
                    id: fallbackId,
                    type: "movie",
                    name: `${badge ? "[" + badge + "] " : ""}${displayTitle}`,
                    poster: resolved?.poster || generateFallbackPoster(displayTitle),
                    description: `${badge ? badge + "\n" : ""}${effectiveFilename}`
                };
            })
        )
    );

    return { metas: movieMetas };
}

/**
 * Gestionnaire ultra-rapide des flux Stremio (< 5 ms) avec URLs de résolution Lazy
 */
async function handleStream(config, type, id, cache, baseUrl, userRef) {
    const rawDebridProvider = (config.debridProvider || "alldebrid").toLowerCase();
    const isBoth = rawDebridProvider === "both";
    const isTorbox = rawDebridProvider === "torbox";
    const hasAllDebrid = (rawDebridProvider === "alldebrid" || isBoth) && Boolean(config.apiKey);
    const hasTorbox =
        (rawDebridProvider === "torbox" || isBoth) && Boolean(config.torboxApiKey || (isTorbox && config.apiKey));
    const apiKey = config.apiKey;
    const activeTbApiKey = config.torboxApiKey || (isTorbox ? config.apiKey : null);
    const debridProvider = isTorbox ? "torbox" : "alldebrid";
    const debridName = isBoth ? "Dual (AD+TB)" : isTorbox ? "Torbox" : "AllDebrid";

    const tmdbKey = config.tmdbKey && config.tmdbKey !== "default" ? config.tmdbKey : TMDB_KEY_DEFAULT;
    const cacheEnabled = config.cacheMode !== "off";
    const langPrefArray = config.langPref
        ? Array.isArray(config.langPref)
            ? config.langPref
            : safeDecode(config.langPref).split(",").filter(Boolean)
        : ["multi_vff", "vff", "vfi", "multi", "vf", "vostfr"];

    const streams = [];

    // 1. Fichier issu de "Mes Liens" (ad_link:base64)
    if (id.startsWith("ad_link:")) {
        const originalLink = Buffer.from(id.replace("ad_link:", ""), "base64url").toString();
        const fname = originalLink.split("/").pop() || "Fichier";
        streams.push(
            formatAioStream({
                filename: fname,
                sizeBytes: 0,
                provider: "Mon Cloud",
                indexer: "AllDebrid Cloud",
                subtitle: "Résolution instantanée",
                isInstant: true,
                cacheType: "cloud",
                isCloud: true,
                debridProvider: "alldebrid",
                url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/${encodeURIComponent(originalLink)}`
            })
        );
        return { streams: sortByLangPref(streams, langPrefArray) };
    }

    // 2. Fichier issu d'un épisode cloud direct (ad_series:...)
    if (id.startsWith("ad_series:")) {
        streams.push(
            formatAioStream({
                filename: id,
                sizeBytes: 0,
                provider: "Mon Cloud",
                indexer: "AllDebrid Cloud",
                subtitle: "Résolution instantanée",
                isInstant: true,
                cacheType: "cloud",
                isCloud: true,
                debridProvider: "alldebrid",
                url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/${encodeURIComponent(id)}`
            })
        );
        return { streams: sortByLangPref(streams, langPrefArray) };
    }

    // 3. Fichier issu de ad_cloud:<magnetId> ou tb_cloud:<torrentId>:<fileId>
    if (id.startsWith("ad_cloud:") || id.startsWith("tb_cloud:")) {
        const isTb = id.startsWith("tb_cloud:");
        const cloudRef = id.replace(/^(ad|tb)_cloud:/, "");
        streams.push(
            formatAioStream({
                filename: `Cloud #${cloudRef}`,
                sizeBytes: 0,
                provider: "Mon Cloud",
                indexer: isTb ? "Torbox Cloud" : "AllDebrid Cloud",
                subtitle: "Résolution instantanée",
                isInstant: true,
                cacheType: "cloud",
                isCloud: true,
                debridProvider: isTb ? "torbox" : "alldebrid",
                url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/${encodeURIComponent(id)}`
            })
        );
        return { streams: sortByLangPref(streams, langPrefArray) };
    }

    // Résolution précoce des métadonnées pour les identifiants IMDb
    let searchTitle = null;
    let searchAltTitle = null;
    let searchYear = null;
    let seasonNum = undefined;
    let episodeNum = undefined;
    let effectiveImdbId = id;

    if (id.startsWith("tt")) {
        const baseTtId = id.split(":")[0];
        const metaInfo = await imdbIdToTitleAndYear(baseTtId, tmdbKey, type);
        searchTitle = metaInfo?.title || null;
        searchAltTitle = metaInfo?.altTitle || null;
        searchYear = metaInfo?.year || null;
        if (id.includes(":")) {
            const parts = id.split(":");
            seasonNum = parseInt(parts[1], 10);
            episodeNum = parseInt(parts[2], 10);
        }
    }

    // 4. Épisode de série avec identifiant IMDb ("tt...:s:e")
    if (id.startsWith("tt") && id.includes(":")) {
        const parts = id.split(":");
        const baseTtId = parts[0];
        const season = seasonNum;
        const episode = episodeNum;

        // Vérification directe dans cache.series (liens débridés, historique ou cloud)
        if (cache && cache.series && cache.series[baseTtId] && Array.isArray(cache.series[baseTtId].episodes)) {
            const epMatches = cache.series[baseTtId].episodes.filter(e => e.season === season && e.episode === episode);
            for (const ep of epMatches) {
                if (ep.link) {
                    streams.push(
                        formatAioStream({
                            filename: ep.filename || `S${season}E${episode}`,
                            sizeBytes: 0,
                            provider: "Mon Cloud",
                            indexer: "AllDebrid Cloud",
                            subtitle: "Épisode disponible dans votre Historique/Liens",
                            isInstant: true,
                            cacheType: "cloud",
                            isCloud: true,
                            debridProvider: "alldebrid",
                            url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/${encodeURIComponent(ep.link)}`
                        })
                    );
                } else if (ep.magnetId) {
                    streams.push(
                        formatAioStream({
                            filename: ep.filename || `S${season}E${episode}`,
                            sizeBytes: 0,
                            provider: "Mon Cloud",
                            indexer: "AllDebrid Cloud",
                            subtitle: "Épisode disponible dans votre compte AllDebrid",
                            isInstant: true,
                            cacheType: "cloud",
                            isCloud: true,
                            debridProvider: "alldebrid",
                            url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/${encodeURIComponent(ep.magnetId)}`
                        })
                    );
                } else if (ep.tbRef) {
                    streams.push(
                        formatAioStream({
                            filename: ep.filename || `S${season}E${episode}`,
                            sizeBytes: 0,
                            provider: "Mon Cloud",
                            indexer: "Torbox Cloud",
                            subtitle: "Épisode disponible dans votre compte Torbox",
                            isInstant: true,
                            cacheType: "cloud",
                            isCloud: true,
                            debridProvider: "torbox",
                            url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/tb_cloud:${ep.tbRef}`
                        })
                    );
                }
            }
        }

        let groupTitle = cache && cache.series && cache.series[baseTtId] ? cache.series[baseTtId].groupTitle : null;
        if (!groupTitle) {
            const title = searchTitle || (await imdbIdToTitle(baseTtId, tmdbKey));
            if (title) {
                groupTitle = title.toLowerCase();
                if (cache && cache.series) {
                    let sEntry = cache.series[baseTtId];
                    if (!sEntry || typeof sEntry !== "object") {
                        sEntry = { groupTitle, episodes: [] };
                    } else {
                        sEntry.groupTitle = groupTitle;
                        if (!Array.isArray(sEntry.episodes)) {
                            sEntry.episodes = [];
                        }
                    }
                    cache.series[baseTtId] = sEntry;
                }
            }
        }
        if (groupTitle) {
            if (hasTorbox && activeTbApiKey) {
                try {
                    const { getTorboxTorrentList } = require("./torbox");
                    const tbTorrents = await getTorboxTorrentList(activeTbApiKey).catch(() => []);
                    if (Array.isArray(tbTorrents)) {
                        for (const tor of tbTorrents) {
                            // Torrent non encore téléchargé : lecture impossible (HTTP 422 sur requestdl)
                            if (!isTorboxTorrentReady(tor)) continue;
                            if (
                                extractCleanTitle(tor.name || "")
                                    .title.toLowerCase()
                                    .includes(groupTitle.toLowerCase())
                            ) {
                                const files = tor.files || [];
                                const match = files.find(f => {
                                    const se = parseSeasonEpisode(f.name || f.filename || "");
                                    return se && se.season === season && se.episode === episode;
                                });
                                if (match) {
                                    streams.push(
                                        formatAioStream({
                                            filename: match.name || tor.name,
                                            sizeBytes: match.size || tor.size || 0,
                                            provider: "Mon Cloud",
                                            indexer: "Torbox Cloud",
                                            subtitle: "Épisode disponible dans votre compte Torbox",
                                            isInstant: true,
                                            cacheType: "cloud",
                                            isCloud: true,
                                            debridProvider: "torbox",
                                            url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/tb_cloud:${tor.id}:${match.id}`
                                        })
                                    );
                                }
                            }
                        }
                    }
                } catch (e) {}
            }
            if (hasAllDebrid && apiKey) {
                try {
                    const statusRes = await adGet("/v4.1/magnet/status", apiKey).catch(() => null);
                    const magnets =
                        (statusRes && statusRes.data && statusRes.data.data && statusRes.data.data.magnets) || [];
                    const matches = magnets.filter(m => {
                        // Magnet non prêt (téléchargement/erreur) ou déjà rejeté au clic : illisible
                        if (!alldebrid.isAllDebridMagnetReady(m) || alldebrid.isAllDebridTargetDead(m.id)) return false;
                        if (extractCleanTitle(m.filename || "").title.toLowerCase() !== groupTitle.toLowerCase())
                            return false;
                        const se = parseSeasonEpisode(m.filename || "");
                        return se && se.season === season && se.episode === episode;
                    });
                    for (const m of matches) {
                        streams.push(
                            formatAioStream({
                                filename: m.filename,
                                sizeBytes: m.size || 0,
                                provider: "Mon Cloud",
                                indexer: "AllDebrid Cloud",
                                subtitle: "Épisode disponible dans votre compte AllDebrid",
                                isInstant: true,
                                cacheType: "cloud",
                                isCloud: true,
                                debridProvider: "alldebrid",
                                url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/${m.id}`
                            })
                        );
                    }
                } catch (e) {}
            }
        }
    }

    // 5. Film avec identifiant IMDb ("tt...") : vérification cache SQLite ou bibliothèque Cloud
    if (id.startsWith("tt") && !id.includes(":")) {
        // Vérification directe dans cache.movies (liens débridés, historique ou cloud)
        if (cache && cache.movies && Array.isArray(cache.movies[id])) {
            for (const v of cache.movies[id]) {
                if (v.link) {
                    streams.push(
                        formatAioStream({
                            filename: v.filename || "Fichier Débridé",
                            sizeBytes: v.size || 0,
                            provider: "Mon Cloud",
                            indexer: "AllDebrid Cloud",
                            subtitle: "Lien direct disponible dans votre Historique/Liens",
                            isInstant: true,
                            cacheType: "cloud",
                            isCloud: true,
                            debridProvider: "alldebrid",
                            url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/${encodeURIComponent(v.link)}`
                        })
                    );
                } else if (v.alldebridId && !alldebrid.isAllDebridTargetDead(v.alldebridId)) {
                    streams.push(
                        formatAioStream({
                            filename: v.filename || "Film Cloud",
                            sizeBytes: v.size || 0,
                            provider: "Mon Cloud",
                            indexer: "AllDebrid Cloud",
                            subtitle: "Film disponible dans votre compte AllDebrid",
                            isInstant: true,
                            cacheType: "cloud",
                            isCloud: true,
                            debridProvider: "alldebrid",
                            url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/${encodeURIComponent(v.alldebridId)}`
                        })
                    );
                } else if (v.tbRef) {
                    streams.push(
                        formatAioStream({
                            filename: v.filename || "Film Cloud",
                            sizeBytes: v.size || 0,
                            provider: "Mon Cloud",
                            indexer: "Torbox Cloud",
                            subtitle: "Film disponible dans votre compte Torbox",
                            isInstant: true,
                            cacheType: "cloud",
                            isCloud: true,
                            debridProvider: "torbox",
                            url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/tb_cloud:${v.tbRef}`
                        })
                    );
                }
            }
        }

        if (hasAllDebrid) {
            const movieVersions = getMovieVersions(id);
            if (movieVersions && movieVersions.length > 0) {
                for (const v of movieVersions) {
                    // Cible déjà rejetée au clic (magnet non prêt/supprimé) : on cesse de la proposer
                    if (!v.alldebridId || alldebrid.isAllDebridTargetDead(v.alldebridId)) continue;
                    streams.push(
                        formatAioStream({
                            filename: v.filename,
                            sizeBytes: v.size || 0,
                            provider: "Mon Cloud",
                            indexer: "AllDebrid Cloud",
                            subtitle: "Film disponible dans votre compte AllDebrid",
                            isInstant: true,
                            cacheType: "cloud",
                            isCloud: true,
                            debridProvider: "alldebrid",
                            url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/${encodeURIComponent(v.alldebridId)}`
                        })
                    );
                }
            } else if (apiKey) {
                const title = searchTitle;
                if (title) {
                    try {
                        const statusRes = await adGet("/v4.1/magnet/status", apiKey).catch(() => null);
                        const magnets =
                            (statusRes && statusRes.data && statusRes.data.data && statusRes.data.data.magnets) || [];
                        const matches = magnets.filter(m => {
                            const c = extractCleanTitle(m.filename || "");
                            return (
                                isConfidentTitleMatch(title, c.title, searchYear, c.year) ||
                                (searchAltTitle && isConfidentTitleMatch(searchAltTitle, c.title, searchYear, c.year))
                            );
                        });
                        for (const m of matches) {
                            streams.push(
                                formatAioStream({
                                    filename: m.filename,
                                    sizeBytes: m.size || 0,
                                    provider: "Mon Cloud",
                                    indexer: "AllDebrid Cloud",
                                    subtitle: "Film disponible dans votre compte AllDebrid",
                                    isInstant: true,
                                    cacheType: "cloud",
                                    isCloud: true,
                                    debridProvider: "alldebrid",
                                    url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/${m.id}`
                                })
                            );
                        }
                        if (matches.length > 0 && cache.movies) {
                            cache.movies[id] = matches.map(m => ({
                                alldebridId: m.id,
                                filename: m.filename,
                                size: m.size || 0
                            }));
                        }
                    } catch (e) {}
                }
            }
        }
        if (hasTorbox && activeTbApiKey) {
            const title = searchTitle;
            if (title) {
                try {
                    const { getTorboxTorrentList } = require("./torbox");
                    const tbTorrents = await getTorboxTorrentList(activeTbApiKey).catch(() => []);
                    if (Array.isArray(tbTorrents)) {
                        const matches = tbTorrents.filter(t => {
                            // Torrent non encore téléchargé : lecture impossible (HTTP 422 sur requestdl)
                            if (!isTorboxTorrentReady(t)) return false;
                            const c = extractCleanTitle(t.name || "");
                            return (
                                isConfidentTitleMatch(title, c.title, searchYear, c.year) ||
                                (searchAltTitle && isConfidentTitleMatch(searchAltTitle, c.title, searchYear, c.year))
                            );
                        });
                        for (const m of matches) {
                            streams.push(
                                formatAioStream({
                                    filename: m.name,
                                    sizeBytes: m.size || 0,
                                    provider: "Mon Cloud",
                                    indexer: "Torbox Cloud",
                                    subtitle: "Film disponible dans votre compte Torbox",
                                    isInstant: true,
                                    cacheType: "cloud",
                                    isCloud: true,
                                    debridProvider: "torbox",
                                    url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/tb_hash_${m.hash}`
                                })
                            );
                        }
                    }
                } catch (e) {}
            }
        }
    }

    // 6. Torrents pré-vérifiés en cache local par le worker Prowlarr
    let torboxInstantMap = {};
    const cachedTorrents = getCachedTorrentsByImdb(id);
    const seenHashes = new Set();
    if (cachedTorrents && cachedTorrents.length > 0) {
        if (hasTorbox && activeTbApiKey) {
            try {
                const { checkInstantTorbox } = require("./torbox");
                const hashes = cachedTorrents.map(t => t.infoHash);
                torboxInstantMap = await checkInstantTorbox(hashes, activeTbApiKey);
            } catch (e) {}
        }

        for (const t of cachedTorrents) {
            const hLower = (t.infoHash || "").toLowerCase();
            if (!hLower || seenHashes.has(hLower)) continue;

            // Filtrage strict du titre et des suites/packs (ex: Toy Story 1 vs Toy Story 2/3/4 et packs)
            if (type === "movie" && searchTitle) {
                const tClean = extractCleanTitle(t.filename || t.title || "");
                const titleMatch =
                    isConfidentTitleMatch(searchTitle, tClean.title, searchYear, tClean.year) ||
                    (searchAltTitle && isConfidentTitleMatch(searchAltTitle, tClean.title, searchYear, tClean.year));
                if (!titleMatch) continue;
            }

            seenHashes.add(hLower);

            // Flux AllDebrid
            if (hasAllDebrid) {
                const isInstantAd = Boolean(t.isInstant);
                if (isInstantAd || config.allowDownload || (t.seeders && t.seeders > 0)) {
                    const subtitle = isInstantAd
                        ? "⚡ Pré-cache RSS • AllDebrid"
                        : t.seeders
                          ? `🔍 Prowlarr Sync (${t.seeders} seeders) • Vérif. AllDebrid au clic`
                          : "🔍 Prowlarr Sync • Vérif. AllDebrid au clic";
                    streams.push(
                        formatAioStream({
                            filename: t.filename || t.title,
                            sizeBytes: t.size || 0,
                            seeders: t.seeders || 0,
                            provider: "Cinécloud",
                            indexer: `Prowlarr | ${t.indexer || "Sync"}`,
                            cacheType: "precache",
                            subtitle,
                            isInstant: isInstantAd,
                            debridProvider: "alldebrid",
                            url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/hash_${t.infoHash}`
                        })
                    );
                }
            }

            // Flux Torbox
            if (hasTorbox) {
                const isInstantTb = Boolean(torboxInstantMap[hLower]);
                if (isInstantTb || config.allowDownload || (t.seeders && t.seeders > 0)) {
                    const subtitle = isInstantTb
                        ? "⚡ Instantané • Torbox"
                        : t.seeders
                          ? `⏳ Téléchargement (${t.seeders} seeders)`
                          : "⏳ Téléchargement Torbox";
                    streams.push(
                        formatAioStream({
                            filename: t.filename || t.title,
                            sizeBytes: t.size || 0,
                            seeders: t.seeders || 0,
                            provider: "Cinécloud",
                            indexer: `Prowlarr | ${t.indexer || "Sync"}`,
                            cacheType: "precache",
                            subtitle,
                            isInstant: isInstantTb,
                            debridProvider: "torbox",
                            url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/tb_hash_${t.infoHash}`
                        })
                    );
                }
            }
        }
    }

    // 7. Recherche à la demande Prowlarr et Lumio (mylumio.tv)
    const { recordSearchQuery } = require("./db");

    // La recherche à la demande utilise EXCLUSIVEMENT le Prowlarr de l'utilisateur.
    // L'instance du conteneur (.env) est réservée à la synchronisation RSS (qui alimente le cache
    // partagé pour tout le monde) et à son propriétaire, qui y accède avec sa propre clé.
    // Sans clé personnelle : aucune recherche à la demande, seuls les flux du cache RSS partagé.
    const hasOwnProwlarr = Boolean(
        config.prowlarrKey && config.prowlarrKey !== "off" && config.prowlarrKey.trim() !== ""
    );
    const prowlarrKey = hasOwnProwlarr ? config.prowlarrKey : "";
    const prowlarrUrl = config.prowlarrUrl || "";
    const prowlarrMode = config.prowlarrMode || (hasOwnProwlarr ? "shared" : "local");
    const isProwlarrConfigured = prowlarrMode !== "local" && hasOwnProwlarr;

    if (cacheEnabled) {
        if (id.startsWith("kitsu:")) {
            const kitsuMeta = await resolveKitsuMeta(id, type);
            if (kitsuMeta) {
                searchTitle = kitsuMeta.name;
                searchYear = kitsuMeta.year || null;
                const mappedSeason = kitsuMeta.season || 1;
                if (kitsuMeta.episode) {
                    seasonNum = mappedSeason;
                    episodeNum = kitsuMeta.episode;
                }
                if (kitsuMeta.imdbId) {
                    effectiveImdbId = kitsuMeta.episode
                        ? `${kitsuMeta.imdbId}:${mappedSeason}:${kitsuMeta.episode}`
                        : kitsuMeta.imdbId;
                    const cachedTorrentsKitsu = getCachedTorrentsByImdb(effectiveImdbId);
                    if (cachedTorrentsKitsu && cachedTorrentsKitsu.length > 0) {
                        for (const t of cachedTorrentsKitsu) {
                            const hLower = (t.infoHash || "").toLowerCase();
                            if (!hLower || seenHashes.has(hLower)) continue;
                            const isInstant = isTorbox ? Boolean(torboxInstantMap[hLower]) : Boolean(t.isInstant);
                            if (!isInstant && !config.allowDownload && (!t.seeders || t.seeders === 0)) continue;
                            seenHashes.add(hLower);
                            const subtitle = isInstant
                                ? `⚡ Pré-cache RSS • ${debridName}`
                                : !isTorbox
                                  ? t.seeders
                                      ? `🔍 Prowlarr Sync (${t.seeders} seeders) • Vérif. AllDebrid au clic`
                                      : "🔍 Prowlarr Sync • Vérif. AllDebrid au clic"
                                  : t.seeders
                                    ? `⏳ Téléchargement (${t.seeders} seeders)`
                                    : `⏳ Téléchargement ${debridName}`;
                            const resolveTarget = isTorbox ? `tb_hash_${t.infoHash}` : `hash_${t.infoHash}`;
                            streams.push(
                                formatAioStream({
                                    filename: t.filename || t.title,
                                    sizeBytes: t.size || 0,
                                    seeders: t.seeders || 0,
                                    provider: "Cinécloud",
                                    indexer: `Prowlarr | ${t.indexer || "Sync"}`,
                                    cacheType: "precache",
                                    subtitle,
                                    isInstant,
                                    debridProvider,
                                    url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/${resolveTarget}`
                                })
                            );
                        }
                    }
                }
            }
        }

        // Enregistrement des statistiques de recherche dans SQLite
        if (searchTitle) {
            recordSearchQuery(effectiveImdbId || id, searchTitle, type);
        }

        const prowlarrPromise =
            isProwlarrConfigured && searchTitle
                ? searchProwlarrOnDemand({
                      id: effectiveImdbId,
                      type,
                      cleanTitle: searchTitle,
                      altTitle: searchAltTitle,
                      year: searchYear,
                      season: seasonNum,
                      episode: episodeNum,
                      prowlarrUrl,
                      prowlarrKey,
                      prowlarrMode,
                      apiKey
                  }).catch(() => [])
                : Promise.resolve([]);

        // Source externe Lumio : interrogation uniquement à la demande pour ce titre
        const lumioTargetId = effectiveImdbId.startsWith("tt")
            ? effectiveImdbId
            : id.startsWith("tt")
              ? id
              : id.startsWith("kitsu:")
                ? id
                : null;
        // Cible Torrentio : même identifiant que Lumio (IMDb, éventuellement "tt…:s:e")
        const torrentioTargetId = lumioTargetId;
        const torrentioType = type === "movie" ? "movie" : "series";
        let lumioEndpoint = null;
        if (lumioTargetId && config.lumioUrl && typeof config.lumioUrl === "string" && config.lumioUrl.trim() !== "") {
            const rawLumio = config.lumioUrl
                .trim()
                .replace(/\/manifest\.json$/i, "")
                .replace(/\/+$/, "");
            lumioEndpoint = `${rawLumio}/stream/${type}/${lumioTargetId}.json`;
        }

        const isLumioPaused = Date.now() < lumioDownUntil;
        const lumioPromise =
            lumioEndpoint && !isLumioPaused
                ? axios
                      .get(lumioEndpoint, {
                          headers: {
                              "User-Agent": BROWSER_UA,
                              Accept: "application/json"
                          },
                          timeout: 2500
                      })
                      .catch(err => {
                          const { logger } = require("./logger");
                          const isDown =
                              err.response && [502, 503, 521, 522, 523, 524, 530].includes(err.response.status);
                          const isTimeout =
                              err.code === "ECONNABORTED" || (err.message && err.message.includes("timeout"));
                          if (isDown || isTimeout) {
                              lumioDownUntil = Date.now() + 3 * 60 * 1000; // Mise en pause de 3 minutes pour préserver la fluidité
                              logger.warn(
                                  "Lumio",
                                  `Service injoignable (${err.response?.status || err.code || "Timeout"}). Pause temporaire de 3 minutes activée.`
                              );
                          } else {
                              logger.warn("Lumio", `Échec requête stream (${lumioTargetId}) : ${err.message}`);
                          }
                          return null;
                      })
                : Promise.resolve(null);

        // Source externe Torrentio : on n'exploite QUE les infoHash. La clé debrid de l'addon sert à la
        // lecture (jamais transmise à Torrentio). Les filtres Taille/Seed/Langue/Résolutions sont déjà
        // encodés dans l'URL de manifest collée par l'utilisateur.
        let torrentioEndpoint = null;
        if (
            torrentioTargetId &&
            config.torrentioUrl &&
            typeof config.torrentioUrl === "string" &&
            config.torrentioUrl.trim() !== ""
        ) {
            const rawTorrentio = config.torrentioUrl
                .trim()
                .replace(/\/manifest\.json$/i, "")
                .replace(/\/+$/, "");
            torrentioEndpoint = `${rawTorrentio}/stream/${torrentioType}/${torrentioTargetId}.json`;
        }

        const isTorrentioPaused = Date.now() < torrentioDownUntil;
        // Repli proxy ↔ direct : Cloudflare bloque les IP datacenter (403). L'ordre des tentatives
        // est réglable depuis l'admin (« direct » essaie l'IP du serveur en premier).
        const torrentioPrefer = config.torrentioEgress || getSystemSettings().torrentioEgress || "auto";
        const torrentioPromise =
            torrentioEndpoint && !isTorrentioPaused
                ? alldebrid
                      .fetchWithWarpFallback(
                          torrentioEndpoint,
                          {
                              headers: {
                                  "User-Agent": BROWSER_UA,
                                  Accept: "application/json",
                                  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8"
                              },
                              timeout: 4000
                          },
                          undefined,
                          torrentioPrefer
                      )
                      .catch(err => {
                          const { logger } = require("./logger");
                          const detail = err.attemptsSummary ? ` [${err.attemptsSummary}]` : "";
                          const isDown =
                              err.response && [502, 503, 521, 522, 523, 524, 530].includes(err.response.status);
                          const isTimeout =
                              err.code === "ECONNABORTED" || (err.message && err.message.includes("timeout"));
                          if (isDown || isTimeout) {
                              torrentioDownUntil = Date.now() + 3 * 60 * 1000;
                              logger.warn(
                                  "Torrentio",
                                  `Service injoignable (${err.response?.status || err.code || "Timeout"})${detail}. Pause temporaire de 3 minutes activée.`
                              );
                          } else {
                              logger.warn(
                                  "Torrentio",
                                  `Échec requête stream (${torrentioTargetId}) : ${err.message}${detail}`
                              );
                          }
                          return null;
                      })
                : Promise.resolve(null);

        const [prowlarrTorrents, lumioRes, torrentioRes] = await Promise.all([
            prowlarrPromise,
            lumioPromise,
            torrentioPromise
        ]);

        // Normalisation des résultats Torrentio en torrents "type Prowlarr" — infoHash UNIQUEMENT
        // (l'`url` éventuelle de Torrentio est ignorée : la lecture passe par la clé de l'addon).
        const torrentioTorrents = [];
        const torrentioStreams =
            torrentioRes && torrentioRes.data && Array.isArray(torrentioRes.data.streams)
                ? torrentioRes.data.streams
                : [];
        for (const s of torrentioStreams) {
            if (!s || typeof s.infoHash !== "string") continue;
            const infoHash = s.infoHash.trim().toLowerCase();
            if (!/^[a-f0-9]{40}$/.test(infoHash)) continue;
            const titleStr = String(s.title || "");
            const filename = ((s.behaviorHints && s.behaviorHints.filename) || titleStr.split("\n")[0] || "").trim();
            // Ne garder que de vrais fichiers vidéo (écarte .zip/.srt/sample/bonus…)
            if (!filename || isExcludedArtifact(filename) || !isRealVideoFile(filename)) continue;
            const seedMatch = titleStr.match(/👤\s*(\d+)/);
            const idxMatch = titleStr.match(/⚙️\s*([^\n]+)/);
            torrentioTorrents.push({
                infoHash,
                filename,
                size: parseSizeFromString(titleStr) || 0,
                seeders: seedMatch ? parseInt(seedMatch[1], 10) : 0,
                indexer: idxMatch ? idxMatch[1].trim() : "",
                source: "torrentio"
            });
        }

        const externalTorrents = [
            ...(Array.isArray(prowlarrTorrents) ? prowlarrTorrents : []).map(t => ({ ...t, source: "prowlarr" })),
            ...torrentioTorrents
        ];

        if (externalTorrents.length > 0) {
            const prowlarrCacheType = prowlarrMode === "shared" ? "global" : "direct";
            // Vérification du cache instantané Torbox pour les torrents externes (Prowlarr + Torrentio)
            let torboxProwlarrInstantMap = {};
            if (hasTorbox && activeTbApiKey) {
                try {
                    const { checkInstantTorbox } = require("./torbox");
                    const hashes = externalTorrents.map(t => t.infoHash);
                    torboxProwlarrInstantMap = await checkInstantTorbox(hashes, activeTbApiKey);
                } catch (e) {}
            }

            // Pré-validation active du cache AllDebrid pour les torrents externes.
            // A : on sonde les 12 meilleurs candidats (tri seeders puis taille, sur
            // une copie pour ne pas perturber l'ordre d'émission). B : lecture seule
            // read-only (/v4/magnet/instant, sans upload ni slot) sur les ~40 premiers
            // pour marquer l'éclair au-delà du top sondé, sans polluer le compte.
            const rankedForProbe = [...externalTorrents].sort(
                (a, b) => Number(b.seeders) - Number(a.seeders) || Number(b.size) - Number(a.size)
            );
            let readOnlyInstantMap = {};
            if (hasAllDebrid && apiKey && config.preValidateCache !== false) {
                try {
                    const { checkInstantMagnets } = require("./alldebrid");
                    const roHashes = [];
                    for (const t of rankedForProbe) {
                        const h = (t.infoHash || "").toLowerCase();
                        if (h && !roHashes.includes(h)) roHashes.push(h);
                        if (roHashes.length >= 40) break;
                    }
                    if (roHashes.length > 0) {
                        const roMap = await checkInstantMagnets(roHashes, apiKey);
                        // Un retour vide prouve l'absence de réponse, pas l'absence
                        // du torrent : on ne fusionne que les réponses positives.
                        if (roMap && typeof roMap === "object") {
                            for (const [h, v] of Object.entries(roMap)) {
                                if (v) readOnlyInstantMap[String(h).toLowerCase()] = true;
                            }
                        }
                    }
                } catch (e) {}
            }
            let alldebridProwlarrInstantMap = {};
            if (hasAllDebrid && apiKey && config.preValidateCache !== false) {
                try {
                    const { preValidateMagnets } = require("./alldebrid");
                    alldebridProwlarrInstantMap = await preValidateMagnets(rankedForProbe, apiKey, {
                        maxProbes: 12,
                        imdbId: id
                    });
                } catch (e) {}
            }

            for (const t of externalTorrents) {
                const hLower = (t.infoHash || "").toLowerCase();
                if (!hLower || seenHashes.has(hLower)) continue;
                seenHashes.add(hLower);

                const isTorrentio = t.source === "torrentio";
                const indexerLabel = `${isTorrentio ? "Torrentio" : "Prowlarr"} | ${t.indexer || "Recherche"}`;

                // Flux AllDebrid
                if (hasAllDebrid) {
                    const isInstantAd = Boolean(
                        t.isInstant || readOnlyInstantMap[hLower] || alldebridProwlarrInstantMap[hLower]
                    );
                    const wasProbed =
                        hLower in readOnlyInstantMap || hLower in alldebridProwlarrInstantMap || Boolean(t.isInstant);

                    let subtitle;
                    let cacheType;
                    let statusTag;
                    if (isInstantAd) {
                        if (isTorrentio) {
                            subtitle = "⚡ Instantané Torrentio • AllDebrid";
                            cacheType = "torrentio";
                            statusTag = "[AD ⚡ Torrentio]";
                        } else {
                            subtitle =
                                prowlarrMode === "shared" ? "⚡ Cache Global (Mutualisé)" : "⚡ Instantané AllDebrid";
                            cacheType = "global";
                        }
                    } else if (wasProbed) {
                        // Pré-validé comme non présent en cache -> Téléchargement requis
                        subtitle = t.seeders
                            ? `⏳ Téléchargement (${t.seeders} seeders)`
                            : "⏳ Téléchargement AllDebrid";
                        cacheType = "download";
                    } else if (isTorrentio) {
                        subtitle = t.seeders
                            ? `🔍 Torrentio (${t.seeders} seeders) • Vérif. AllDebrid au clic`
                            : "🔍 Torrentio • Vérif. AllDebrid au clic";
                        cacheType = "torrentio";
                        statusTag = "[AD 🔍 Torrentio]";
                    } else {
                        // Non sondé (au-delà des ~40 hashes read-only) -> statut Prowlarr avec vérif au clic
                        subtitle = t.seeders
                            ? `🔍 Prowlarr (${t.seeders} seeders) • Vérif. AllDebrid au clic`
                            : "🔍 Prowlarr • Vérif. AllDebrid au clic";
                        cacheType = prowlarrCacheType;
                    }

                    streams.push(
                        formatAioStream({
                            filename: t.filename || t.title,
                            sizeBytes: t.size || 0,
                            seeders: t.seeders || 0,
                            provider: "Cinécloud",
                            indexer: indexerLabel,
                            cacheType,
                            subtitle,
                            statusTag,
                            isInstant: isInstantAd,
                            debridProvider: "alldebrid",
                            url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/hash_${t.infoHash}`
                        })
                    );
                }

                // Flux Torbox
                if (hasTorbox) {
                    const isInstantTb = Boolean(torboxProwlarrInstantMap[hLower]);
                    const subtitle = isInstantTb
                        ? isTorrentio
                            ? "⚡ Instantané Torrentio • Torbox"
                            : "⚡ Instantané • Torbox"
                        : t.seeders
                          ? `⏳ Téléchargement (${t.seeders} seeders)`
                          : isTorrentio
                            ? "⏳ Téléchargement Torrentio • Torbox"
                            : "⏳ Téléchargement Torbox";
                    streams.push(
                        formatAioStream({
                            filename: t.filename || t.title,
                            sizeBytes: t.size || 0,
                            seeders: t.seeders || 0,
                            provider: "Cinécloud",
                            indexer: indexerLabel,
                            cacheType: isTorrentio ? "torrentio" : prowlarrCacheType,
                            subtitle,
                            statusTag: isTorrentio
                                ? isInstantTb
                                    ? "[TB ⚡ Torrentio]"
                                    : "[TB 🔍 Torrentio]"
                                : undefined,
                            isInstant: isInstantTb,
                            debridProvider: "torbox",
                            url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/tb_hash_${t.infoHash}`
                        })
                    );
                }
            }
        }

        const lumioStreams =
            lumioRes && lumioRes.data && Array.isArray(lumioRes.data.streams) ? lumioRes.data.streams : [];
        if (lumioStreams.length > 0) {
            const seenLumioUrls = new Set();
            for (const s of lumioStreams) {
                if (!s || !s.url || typeof s.url !== "string" || !s.url.startsWith("http")) continue;
                if (s.name && (s.name.includes("🔴") || s.name.toLowerCase().includes("aucune source"))) continue;
                if (s.description && s.description.toLowerCase().includes("aucune source trouvée")) continue;
                if (seenLumioUrls.has(s.url)) continue;
                seenLumioUrls.add(s.url);

                const fname =
                    s.behaviorHints?.filename ||
                    (s.description || "")
                        .split("\n")
                        .find(l => /\b(1080p|720p|2160p|4k|bluray|web[\.\-]?dl|hevc|x264)\b/i.test(l)) ||
                    s.title ||
                    "Flux Lumio";

                const sizeBytes =
                    s.behaviorHints?.videoSize || parseSizeFromString(s.description || s.title || "") || 0;

                let lumioIndexer = "Lumio";
                if (s.description) {
                    const matchIdx = s.description.match(/🔎\s*([^\n\r]+)/);
                    if (matchIdx && matchIdx[1]) {
                        lumioIndexer = `Lumio | ${matchIdx[1].trim()}`;
                    }
                }

                const streamHasTb = Boolean(s.name && s.name.includes("TB"));
                const streamHasAd = Boolean(s.name && s.name.includes("AD"));
                const lumioProvider = streamHasTb ? "torbox" : streamHasAd ? "alldebrid" : debridProvider;
                const lumioDebridTag = lumioProvider === "torbox" ? "TB" : "AD";
                const lumioDebridName = lumioProvider === "torbox" ? "Torbox" : "AllDebrid";
                const lumioTag = `[${lumioDebridTag} ⚡ Lumio]`;

                streams.push(
                    formatAioStream({
                        filename: fname,
                        sizeBytes: sizeBytes,
                        provider: "Lumio",
                        indexer: lumioIndexer,
                        cacheType: "lumio",
                        statusTag: lumioTag,
                        subtitle: `⚡ Instantané Lumio • ${lumioDebridName}`,
                        isInstant: true,
                        debridProvider: lumioProvider,
                        url: s.url
                    })
                );
            }
        }
    }

    if (userRef) {
        asyncTouchUserActivity(userRef);
    }

    return {
        streams: filterAndSortStreams(streams, {
            resolutions: config.resolutions,
            langPref: langPrefArray,
            hideUnknownLanguages: Boolean(config.hideUnknownLanguages),
            maxSizeGb: config.maxSizeGb,
            sortBy: config.sortBy,
            maxStreams: config.maxStreams,
            prioritizeCloud: Boolean(config.prioritizeCloud)
        })
    };
}

module.exports = {
    handleManifest,
    handleMeta,
    handleCatalog,
    handleStream
};
