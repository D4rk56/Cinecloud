"use strict";

const axios = require("axios");
const { adGet, adPost, adHeaders } = require("./alldebrid");
const { getCachedTorrentsByImdb, getMovieVersions } = require("./db");
const {
    TMDB_KEY_DEFAULT,
    ALL_CATALOGS,
    flattenFiles,
    isRealVideoFile,
    extractTechBadge,
    classifyContent,
    sortByLangPref,
    parseSeasonEpisode,
    extractCleanTitle,
    getTmdbMetadata,
    tmdbToImdbId,
    imdbIdToTitle,
    buildStreamTitle
} = require("./helpers");

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function handleManifest(config) {
    const enabled = (config.enabledCatalogs && config.enabledCatalogs !== "all")
        ? (Array.isArray(config.enabledCatalogs) ? config.enabledCatalogs : decodeURIComponent(config.enabledCatalogs).split(","))
        : ALL_CATALOGS.map(c => c.id);

    return {
        id: "org.nuvio.alldebrid",
        version: "2.1.0",
        name: "Alldebrid",
        description: "Accédez à l'ensemble de votre bibliothèque Alldebrid et débridez vos flux avec persistance SQLite et proxy WARP isolé.",
        types: ["movie", "series"],
        resources: [
            "catalog",
            "meta",
            {
                name: "stream",
                types: ["movie", "series"],
                idPrefixes: ["tt", "ad_cloud:", "ad_link:", "ad_series:"]
            }
        ],
        catalogs: ALL_CATALOGS
            .filter(c => enabled.includes(c.id))
            .map(c => ({
                id: c.id,
                type: c.type,
                name: c.name,
                extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
            }))
    };
}

async function handleMeta(config, type, id, cache) {
    const { apiKey } = config;
    const tmdbKey = (config.tmdbKey && config.tmdbKey !== "default") ? config.tmdbKey : TMDB_KEY_DEFAULT;

    // Fichier issu de "Mes Liens" ou "Historique"
    if (id.startsWith("ad_link:")) {
        const originalLink = Buffer.from(id.replace("ad_link:", ""), "base64url").toString();
        const fname = originalLink.split("/").pop() || "Fichier";
        const tmdb = await getTmdbMetadata(fname, "movie", tmdbKey, true);
        return {
            meta: {
                id,
                type: "movie",
                name: tmdb.name,
                poster: tmdb.poster,
                background: tmdb.backdrop,
                description: `${fname}\n\n${tmdb.description || ""}`,
                genres: tmdb.genres,
                cast: tmdb.cast,
                imdbRating: tmdb.imdbRating
            }
        };
    }

    // Épisode de série depuis le cloud
    if (id.startsWith("ad_series:")) {
        const parts = id.replace("ad_series:", "").split(":");
        const episode = parseInt(parts.pop(), 10);
        const season = parseInt(parts.pop(), 10);
        const groupTitle = decodeURIComponent(parts.join(":"));
        const tmdb = await getTmdbMetadata(groupTitle, "series", tmdbKey, true);
        return {
            meta: {
                id,
                type: "series",
                name: `${tmdb.name} S${season}E${episode}`,
                poster: tmdb.poster,
                background: tmdb.backdrop,
                description: `Saison ${season} Épisode ${episode}\n\n${tmdb.description || ""}`,
                genres: tmdb.genres,
                cast: tmdb.cast,
                imdbRating: tmdb.imdbRating
            }
        };
    }

    // Fiche pour un fichier cloud ou id IMDb résolu
    let filename = "";
    if (id.startsWith("ad_cloud:")) {
        const magnetId = id.replace("ad_cloud:", "");
        const statusRes = await adGet("/v4.1/magnet/status", apiKey, { id: magnetId }).catch(() => null);
        const magnetData = statusRes && statusRes.data && statusRes.data.data && statusRes.data.data.magnets;
        if (magnetData) filename = magnetData.filename;
    } else {
        const versions = getMovieVersions(id);
        if (versions && versions[0]) filename = versions[0].filename;
    }

    if (id.startsWith("tt")) {
        const title = await imdbIdToTitle(id, tmdbKey);
        if (title) {
            const tmdb = await getTmdbMetadata(title, type, tmdbKey, true);
            return {
                meta: {
                    id,
                    type,
                    name: tmdb.name,
                    poster: tmdb.poster,
                    background: tmdb.backdrop,
                    description: tmdb.description,
                    genres: tmdb.genres,
                    cast: tmdb.cast,
                    imdbRating: tmdb.imdbRating
                }
            };
        }
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

async function handleCatalog(config, type, id, cache) {
    const { apiKey } = config;
    const tmdbKey = (config.tmdbKey && config.tmdbKey !== "default") ? config.tmdbKey : TMDB_KEY_DEFAULT;

    // Catalogues "Mes Liens Débridés" et "Mon Historique"
    if (id === "my_ad_links" || id === "my_ad_links_series" || id === "my_ad_history" || id === "my_ad_history_series") {
        const isHistory = id.startsWith("my_ad_history");
        const endpoint = isHistory ? "/v4/user/history" : "/v4/user/links";
        const res = await adGet(endpoint, apiKey);
        const links = (res.data && res.data.data && res.data.data.links) || [];

        const isSeries = id.endsWith("_series");
        const filtered = links.filter(l => {
            const hasEpisode = parseSeasonEpisode(l.filename || "");
            return isSeries ? Boolean(hasEpisode) : !hasEpisode;
        });

        const metasRaw = await Promise.all(filtered.map(async (l) => {
            const tmdb = await getTmdbMetadata(l.filename, isSeries ? "series" : "movie", tmdbKey);
            const badge = extractTechBadge(l.filename);

            if (isSeries) {
                const se = parseSeasonEpisode(l.filename);
                if (se) {
                    return {
                        id: `ad_series:${encodeURIComponent(tmdb.name)}:${se.season}:${se.episode}`,
                        type: "series",
                        name: `${tmdb.name} S${se.season}E${se.episode}`,
                        poster: tmdb.poster,
                        description: `${badge ? badge + "\n" : ""}${l.filename}\n\n${tmdb.description || ""}`
                    };
                }
            }

            if (tmdb.tmdbId) {
                const imdbId = await tmdbToImdbId(tmdb.tmdbId, "movie", tmdbKey);
                if (imdbId) {
                    if (!cache.movies[imdbId]) cache.movies[imdbId] = [];
                    if (!cache.movies[imdbId].some(e => e.link === l.link)) {
                        cache.movies[imdbId].push({ link: l.link, filename: l.filename });
                    }
                    return {
                        id: imdbId,
                        type: "movie",
                        name: tmdb.name,
                        poster: tmdb.poster,
                        description: tmdb.description
                    };
                }
            }

            return {
                id: `ad_link:${Buffer.from(l.link).toString("base64url")}`,
                type: "movie",
                name: `${badge ? "[" + badge + "] " : ""}${l.filename}`,
                poster: tmdb.poster,
                description: `${badge ? badge + "\n" : ""}${l.filename}\n\n${tmdb.description || ""}`
            };
        }));

        const seenIds = new Set();
        const metas = metasRaw.filter(m => {
            if (seenIds.has(m.id)) return false;
            seenIds.add(m.id);
            return true;
        });
        return { metas };
    }

    // Catalogues "Mes Fichiers Cloud" et "Animés"
    const statusRes = await adGet("/v4.1/magnet/status", apiKey);
    const magnets = (statusRes.data && statusRes.data.data && statusRes.data.data.magnets) || [];

    const isAnimeCatalog = (id === "my_ad_animes" || id === "my_ad_animes_movies");
    let matched = [];

    if (isAnimeCatalog) {
        const classifications = await Promise.all(magnets.map(async (item) => {
            const contentType = await classifyContent(item.id, item.filename || "", tmdbKey, cache);
            return { item, contentType };
        }));

        for (const { item, contentType } of classifications) {
            if (id === "my_ad_animes" && contentType.type === "series" && contentType.isAnime) {
                matched.push({ item, currentType: "series" });
            } else if (id === "my_ad_animes_movies" && contentType.type === "movie" && contentType.isAnime) {
                matched.push({ item, currentType: "movie" });
            }
        }
    } else {
        const isSeries = (id === "my_ad_magnets_series");
        const currentType = isSeries ? "series" : "movie";
        const filtered = magnets.filter(m => {
            const hasEpisode = parseSeasonEpisode(m.filename || "");
            return isSeries ? Boolean(hasEpisode) : !hasEpisode;
        });
        matched = filtered.map(item => ({ item, currentType }));
    }

    const metasRaw = await Promise.all(matched.map(async ({ item, currentType }) => {
        const badge = extractTechBadge(item.filename || "");
        const isSeries = currentType === "series";

        if (isSeries) {
            const se = parseSeasonEpisode(item.filename || "");
            const { title: cleanName } = extractCleanTitle(item.filename || "");
            const tmdb = await getTmdbMetadata(cleanName, "series", tmdbKey);

            if (se) {
                return {
                    id: `ad_series:${encodeURIComponent(tmdb.name)}:${se.season}:${se.episode}`,
                    type: "series",
                    name: `${tmdb.name} S${se.season}E${se.episode}`,
                    poster: tmdb.poster,
                    description: `${badge ? badge + "\n" : ""}${item.filename}\n\n${tmdb.description || ""}`
                };
            }

            if (tmdb.tmdbId) {
                const imdbId = await tmdbToImdbId(tmdb.tmdbId, "series", tmdbKey);
                if (imdbId) {
                    cache.series[imdbId] = { groupTitle: cleanName.toLowerCase() };
                    return {
                        id: imdbId,
                        type: "series",
                        name: tmdb.name,
                        poster: tmdb.poster,
                        description: tmdb.description
                    };
                }
            }
        } else {
            const tmdb = await getTmdbMetadata(item.filename || "", "movie", tmdbKey);
            if (tmdb.tmdbId) {
                const imdbId = await tmdbToImdbId(tmdb.tmdbId, "movie", tmdbKey);
                if (imdbId) {
                    if (!cache.movies[imdbId]) cache.movies[imdbId] = [];
                    if (!cache.movies[imdbId].some(e => e.alldebridId === item.id)) {
                        cache.movies[imdbId].push({ alldebridId: item.id, filename: item.filename });
                    }
                    return {
                        id: imdbId,
                        type: "movie",
                        name: tmdb.name,
                        poster: tmdb.poster,
                        description: tmdb.description
                    };
                }
            }
        }

        const fallbackTmdb = await getTmdbMetadata(item.filename || "", currentType, tmdbKey);
        return {
            id: `ad_cloud:${item.id}`,
            type: currentType,
            name: `${badge ? "[" + badge + "] " : ""}${fallbackTmdb.name}`,
            poster: fallbackTmdb.poster,
            description: `${badge ? badge + "\n" : ""}${item.filename}\n\n${fallbackTmdb.description || ""}`
        };
    }));

    const seenIds = new Set();
    const metas = metasRaw.filter(m => {
        if (seenIds.has(m.id)) return false;
        seenIds.add(m.id);
        return true;
    });
    return { metas };
}

/**
 * Gestionnaire ultra-rapide des flux Stremio (< 5 ms) avec URLs de résolution Lazy
 */
async function handleStream(config, type, id, cache, baseUrl, userRef) {
    const { apiKey } = config;
    const tmdbKey = (config.tmdbKey && config.tmdbKey !== "default") ? config.tmdbKey : TMDB_KEY_DEFAULT;
    const cacheEnabled = config.cacheMode !== "off";
    const langPrefArray = config.langPref
        ? (Array.isArray(config.langPref) ? config.langPref : decodeURIComponent(config.langPref).split(",").filter(Boolean))
        : ["multi_vff", "vff", "vfi", "multi", "vf", "vostfr"];

    const streams = [];

    // 1. Fichier issu de "Mes Liens" (ad_link:base64)
    if (id.startsWith("ad_link:")) {
        const originalLink = Buffer.from(id.replace("ad_link:", ""), "base64url").toString();
        const fname = originalLink.split("/").pop() || "Fichier";
        streams.push({
            name: "Mon Cloud ☁️",
            title: buildStreamTitle(fname, 0, "⚡ Résolution instantanée"),
            url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/${encodeURIComponent(originalLink)}`
        });
        return { streams: sortByLangPref(streams, langPrefArray) };
    }

    // 2. Fichier issu d'un épisode cloud direct (ad_series:...)
    if (id.startsWith("ad_series:")) {
        streams.push({
            name: "Mon Cloud ☁️",
            title: buildStreamTitle(id, 0, "⚡ Résolution instantanée"),
            url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/${encodeURIComponent(id)}`
        });
        return { streams: sortByLangPref(streams, langPrefArray) };
    }

    // 3. Fichier issu de ad_cloud:<magnetId>
    if (id.startsWith("ad_cloud:")) {
        const magnetId = id.replace("ad_cloud:", "");
        streams.push({
            name: "Mon Cloud ☁️",
            title: buildStreamTitle(`Magnet Cloud #${magnetId}`, 0, "⚡ Résolution instantanée"),
            url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/${magnetId}`
        });
        return { streams: sortByLangPref(streams, langPrefArray) };
    }

    // 4. Épisode de série avec identifiant IMDb ("tt...:s:e")
    if (id.startsWith("tt") && id.includes(":")) {
        const parts = id.split(":");
        const baseTtId = parts[0];
        const season = parseInt(parts[1], 10);
        const episode = parseInt(parts[2], 10);
        let groupTitle = (cache.series && cache.series[baseTtId]) ? cache.series[baseTtId].groupTitle : null;
        if (!groupTitle) {
            const title = await imdbIdToTitle(baseTtId, tmdbKey);
            if (title) {
                groupTitle = title.toLowerCase();
                if (cache.series) cache.series[baseTtId] = { groupTitle };
            }
        }
        if (groupTitle) {
            try {
                const statusRes = await adGet("/v4.1/magnet/status", apiKey).catch(() => null);
                const magnets = (statusRes && statusRes.data && statusRes.data.data && statusRes.data.data.magnets) || [];
                const matches = magnets.filter(m => {
                    if (extractCleanTitle(m.filename || "").title.toLowerCase() !== groupTitle.toLowerCase()) return false;
                    const se = parseSeasonEpisode(m.filename || "");
                    return se && se.season === season && se.episode === episode;
                });
                for (const m of matches) {
                    streams.push({
                        name: "Mon Cloud ☁️",
                        title: buildStreamTitle(m.filename, 0, "⚡ Épisode disponible dans votre compte"),
                        url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/${m.id}`,
                        _size: 0
                    });
                }
            } catch (e) {}
        }
    }

    // 5. Film avec identifiant IMDb ("tt...") : vérification cache SQLite ou bibliothèque AllDebrid
    if (id.startsWith("tt") && !id.includes(":")) {
        const movieVersions = getMovieVersions(id);
        if (movieVersions && movieVersions.length > 0) {
            for (const v of movieVersions) {
                streams.push({
                    name: "Mon Cloud ☁️",
                    title: buildStreamTitle(v.filename, 0, "⚡ Disponible dans votre compte"),
                    url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/${encodeURIComponent(v.alldebridId)}`,
                    _size: 0
                });
            }
        } else {
            // Pas encore en cache : vérification dans les magnets de l'utilisateur
            const title = await imdbIdToTitle(id, tmdbKey);
            if (title) {
                try {
                    const statusRes = await adGet("/v4.1/magnet/status", apiKey).catch(() => null);
                    const magnets = (statusRes && statusRes.data && statusRes.data.data && statusRes.data.data.magnets) || [];
                    const cleanTitleLower = title.toLowerCase();
                    const matches = magnets.filter(m => extractCleanTitle(m.filename || "").title.toLowerCase() === cleanTitleLower);
                    for (const m of matches) {
                        streams.push({
                            name: "Mon Cloud ☁️",
                            title: buildStreamTitle(m.filename, 0, "⚡ Film disponible dans votre compte"),
                            url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/${m.id}`,
                            _size: 0
                        });
                    }
                    if (matches.length > 0 && cache.movies) {
                        cache.movies[id] = matches.map(m => ({ alldebridId: m.id, filename: m.filename }));
                    }
                } catch (e) {}
            }
        }
    }

    // 5. Torrents pré-vérifiés en cache local par le worker Prowlarr
    const cachedTorrents = getCachedTorrentsByImdb(id);
    if (cachedTorrents && cachedTorrents.length > 0) {
        for (const t of cachedTorrents) {
            streams.push({
                name: `Prowlarr ⚡ [${t.indexer}]`,
                title: buildStreamTitle(t.filename || t.title, t.size, "▶️ Pré-caché AllDebrid"),
                url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/hash_${t.infoHash}`,
                _size: t.size || 0
            });
        }
    }

    // 6. Si aucun flux local ou pour compléter l'offre : fallback Torrentio en accès DIRECT (sans proxy)
    if (cacheEnabled && streams.length < 5) {
        try {
            const torrentioUrl = `https://torrentio.strem.fun/stream/${type}/${id}.json`;
            const torrentioRes = await axios.get(torrentioUrl, {
                headers: {
                    "User-Agent": BROWSER_UA,
                    "Accept": "application/json"
                },
                timeout: 4000
            }).catch(() => null);

            const torrentioStreams = (torrentioRes && torrentioRes.data && torrentioRes.data.streams) || [];
            const topHashes = torrentioStreams.filter(s => s.infoHash).slice(0, 4);

            for (const s of topHashes) {
                streams.push({
                    name: "Torrentio ⚡",
                    title: buildStreamTitle(s.title || "Flux Torrentio", 0, "▶️ Instantané"),
                    url: `${baseUrl}/resolve/${userRef}/${encodeURIComponent(id)}/hash_${s.infoHash}`,
                    _size: 0
                });
            }
        } catch (e) {
            // Repli silencieux sans bloquer la réponse Stremio
        }
    }

    return { streams: sortByLangPref(streams, langPrefArray) };
}

module.exports = {
    handleManifest,
    handleMeta,
    handleCatalog,
    handleStream
};
