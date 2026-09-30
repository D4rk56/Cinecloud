"use strict";

const axios = require("axios");

const TMDB_KEY_DEFAULT = "14cc580302bf1c4161bf96efb2165215";
const VIDEO_EXT = /\.(mp4|mkv|avi|mov|wmv|ts|m4v|webm|flv)$/i;

const ALL_CATALOGS = [
    { id: "my_ad_links", name: "Mes Liens Débridés ☁️", type: "movie" },
    { id: "my_ad_links_series", name: "Mes Séries Débridées 📺", type: "series" },
    { id: "my_ad_history", name: "Mon Historique 🕒", type: "movie" },
    { id: "my_ad_history_series", name: "Mon Historique Séries 🕒", type: "series" },
    { id: "my_ad_magnets", name: "Mes Fichiers Cloud ☁️", type: "movie" },
    { id: "my_ad_magnets_series", name: "Mes Séries Cloud 📺", type: "series" },
    { id: "my_ad_animes", name: "Mes Animés (Séries) 🇯🇵", type: "series" },
    { id: "my_ad_animes_movies", name: "Mes Animés (Films) 🇯🇵", type: "movie" }
];

function flattenFiles(entries) {
    if (!Array.isArray(entries)) return [];
    return entries.flatMap(e => (e.e ? flattenFiles(e.e) : [e]));
}

function isRealVideoFile(filename) {
    if (!filename || !VIDEO_EXT.test(filename)) return false;
    if (/\b(sample|bonus|extra|featurette|making[\.\-]?of|trailer|deleted[\.\-]?scenes?)\b/i.test(filename)) return false;
    return true;
}

function formatSize(bytes) {
    if (!bytes || isNaN(bytes)) return "";
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(0)} MB`;
}

function detectLangTag(filename) {
    const t = (filename || "").toLowerCase();
    const hasMulti = /\bmulti\b/.test(t);
    const hasVff = /\bvff\b/.test(t);
    const hasVfi = /\bvfi\b/.test(t);
    const hasVfq = /\bvfq\b/.test(t);
    const hasVf = /\bvf\b/.test(t) && !hasVff && !hasVfi && !hasVfq;
    const hasVostfr = /\bvostfr\b/.test(t);
    const hasFrench = /\b(french|truefrench)\b/.test(t);

    if (hasMulti && (hasVff || hasVfi)) return "multi_vff";
    if (hasMulti) return "multi";
    if (hasVff) return "vff";
    if (hasVfi) return "vfi";
    if (hasVfq) return "vfq";
    if (hasVf || hasFrench) return "vf";
    if (hasVostfr) return "vostfr";
    return "other";
}

function extractTechBadge(filename) {
    const t = (filename || "");
    const parts = [];
    const resMatch = t.match(/\b(2160p|4K|1080p|720p|480p)\b/i);
    if (resMatch) parts.push(resMatch[1].toUpperCase());

    const sourceMatch = t.match(/\b(REMUX|WEB-?DL|WEBRIP|BLURAY|BDRIP|HDTV)\b/i);
    if (sourceMatch) parts.push(sourceMatch[1].toUpperCase().replace(/^WEBDL$/, "WEB-DL"));

    const hdrTags = [];
    if (/\bDV\b/i.test(t)) hdrTags.push("DV");
    if (/\bHDR10\+?\b/i.test(t)) hdrTags.push("HDR10");
    else if (/\bHDR\b/i.test(t)) hdrTags.push("HDR");
    if (hdrTags.length) parts.push(hdrTags.join(" "));

    const codecMatch = t.match(/\b(x265|h265|hevc|x264|h264|av1)\b/i);
    if (codecMatch) {
        const c = codecMatch[1].toLowerCase();
        parts.push((c === "x265" || c === "h265" || c === "hevc") ? "HEVC" : (c === "av1" ? "AV1" : "x264"));
    }

    const audioTags = [];
    if (/\bATMOS\b/i.test(t)) audioTags.push("Atmos");
    if (/\bDTS-?HD\b/i.test(t)) audioTags.push("DTS-HD");
    else if (/\bDTS\b/i.test(t)) audioTags.push("DTS");
    if (/\bTRUEHD\b/i.test(t)) audioTags.push("TrueHD");
    if (/\bEAC3\b/i.test(t)) audioTags.push("EAC3");
    else if (/\bAC3\b/i.test(t)) audioTags.push("AC3");
    if (audioTags.length) parts.push(audioTags.join(" "));

    const langTag = detectLangTag(t);
    const langFlags = {
        multi_vff: "🇫🇷 MULTI (VFF/VFI)", multi: "🇫🇷 MULTI", vff: "🇫🇷 VFF", vfi: "🇫🇷 VFI",
        vfq: "🇫🇷 VFQ", vf: "🇫🇷 VF", vostfr: "💬 VOSTFR", other: "🌐 VO"
    };
    if (langFlags[langTag]) parts.push(langFlags[langTag]);

    return parts.join(" • ");
}

async function classifyContent(magnetId, filename, tmdbKey, cache) {
    if (cache.classification && cache.classification[magnetId]) {
        return cache.classification[magnetId];
    }

    const lower = filename.toLowerCase();
    const hasStrongSeriesSignal = /s\d{1,2}e\d{1,3}/i.test(lower) || /\be\d{1,3}\b/i.test(lower) || /\bs\d{1,2}\b/i.test(lower) || lower.includes("season") || lower.includes("saison");

    let result = null;
    try {
        const { title: cleanName } = extractCleanTitle(filename);
        const url = `https://api.themoviedb.org/3/search/multi?api_key=${tmdbKey}&query=${encodeURIComponent(cleanName)}&language=fr-FR`;
        const res = await axios.get(url, { timeout: 6000 });
        const results = (res.data && res.data.results || []).filter(r => r.media_type === "movie" || r.media_type === "tv");
        const best = hasStrongSeriesSignal ? (results.find(r => r.media_type === "tv") || results[0]) : results[0];
        if (best) {
            const type = best.media_type === "tv" ? "series" : "movie";
            const isJapanese = best.original_language === "ja";
            const isAnimation = (best.genre_ids || []).includes(16);
            result = { type, isAnime: isJapanese && isAnimation };
        }
    } catch (e) {
        // En cas d'erreur TMDB, heuristique locale
    }

    if (!result) {
        result = { type: hasStrongSeriesSignal ? "series" : "movie", isAnime: false };
    } else if (hasStrongSeriesSignal && result.type === "movie") {
        result.type = "series";
    }

    if (cache.classification) {
        cache.classification[magnetId] = result;
    }
    return result;
}

function sortByLangPref(streams, langPrefArray) {
    const rank = (stream) => {
        const target = stream._rawFilename || stream.title || "";
        const tag = detectLangTag(target);
        const idx = langPrefArray.indexOf(tag);
        return idx === -1 ? 999 : idx;
    };
    return streams
        .map((s, i) => ({ s, i, r: rank(s) }))
        .sort((a, b) => (a.r - b.r) || ((b.s._size || 0) - (a.s._size || 0)) || (a.i - b.i))
        .map(x => {
            const { _size, _rawFilename, ...clean } = x.s;
            return clean;
        });
}

function parseSeasonEpisode(filename) {
    const match = filename.match(/S(\d{1,2})E(\d{1,3})/i);
    if (!match) return null;
    return { season: parseInt(match[1], 10), episode: parseInt(match[2], 10) };
}

function extractCleanTitle(filename) {
    if (!filename) return { title: "", year: null };
    let raw = filename.replace(/\.(mp4|mkv|avi|mov|wmv|flv|webm)$/i, "");
    
    // Nettoie en boucle les balises de début, trackers, domaines, tirets, etc.
    let prev;
    do {
        prev = raw;
        // 1. Crochets ou parenthèses au début : [tag], (tag), {tag}
        raw = raw.replace(/^\s*(\[[^\]]*\]|\([^\)]*\)|\{[^\}]*\})\s*/g, "");
        // 2. Domaines web ou trackers : Sharewood.tv, Torrent9.re, Yggtorrent.qa, etc.
        raw = raw.replace(/^\s*(?:www\.)?[a-z0-9_\-]+\.(?:org|com|net|pl|info|to|cc|us|co|tv|xyz|re|ws|pm|si|is|qa|cx|wf)\b[-.\s_]*/i, "");
        // 3. Qualité ou release tags au tout début
        raw = raw.replace(/^\s*(?:2160p|4k|1080p|720p|480p|hevc|h265|x265|h264|x264|multi|vff|vfi|vf|vostfr|french|truefrench)[-.\s_]+/i, "");
        // 4. Tirets, underscores, espaces de début résiduels
        raw = raw.replace(/^[\s\-_:–—.]+/, "");
    } while (raw !== prev);

    let name = raw.replace(/[\.\_]/g, " ").trim();

    const cutMarkers = /\b(19\d{2}|20\d{2}|S\d{1,2}(E\d{1,3})?|E\d{1,3}|SAISON\s?\d{1,2}|COMPLETE|INTEGRALE|INTÉGRALE|MULTI|VOSTFR|VF2?|FRENCH|TRUEFRENCH|SUBFRENCH|2160p|1080p|720p|480p|4K|UHD|HDR|DV|WEB[\-\.]?DL|WEBRIP|BLURAY|BDRIP|HDTV|REMUX|x264|x265|h264|h265|HEVC|AAC|DTS|ATMOS)\b/gi;
    let cutIndex = name.length;
    let m;
    while ((m = cutMarkers.exec(name)) !== null) {
        if (m.index > 0) { cutIndex = m.index; break; }
    }
    let title = name.slice(0, cutIndex);
    const yearMatch = filename.match(/\b(19\d{2}|20\d{2})\b/);
    const year = yearMatch ? yearMatch[1] : null;

    title = title.replace(/[\-\[\]\(\)]/g, " ").replace(/\s+/g, " ").trim();
    return { title: title || name, year };
}

/**
 * Génère une affiche SVG data URI élégante aux couleurs de CinéCloud (aucun placeholder 300x450 externe)
 */
function generateFallbackPoster(title) {
    const clean = (title || "CinéCloud FR").replace(/[<>&"']/g, "").slice(0, 32);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 450" width="300" height="450"><defs><linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#090d16"/><stop offset="100%" stop-color="#1e293b"/></linearGradient></defs><rect width="300" height="450" fill="url(#bg)" rx="16"/><circle cx="150" cy="180" r="54" fill="#0284c7" opacity="0.18"/><path d="M169.35 170.04C168.67 166.59 165.64 164 162 164 159.11 164 156.6 165.64 155.35 168.04 152.34 168.36 150 170.91 150 174c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM158 177.5v-7l6 3.5-6 3.5z" fill="#38bdf8" transform="scale(1.7) translate(-65, -80)"/><text x="150" y="275" text-anchor="middle" fill="#f8fafc" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-size="15" font-weight="700">${clean}</text><text x="150" y="302" text-anchor="middle" fill="#38bdf8" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-size="12" font-weight="600">CinéCloud FR</text></svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/**
 * Recherche de secours sur Cinemeta pour trouver l'affiche et l'IMDb ID
 */
async function searchCinemeta(cleanName, type = "movie") {
    try {
        const cType = type === "series" ? "series" : "movie";
        const url = `https://v3-cinemeta.strem.io/catalog/${cType}/top/search=${encodeURIComponent(cleanName)}.json`;
        const res = await axios.get(url, { timeout: 4000 });
        const metas = res.data && res.data.metas;
        if (metas && metas.length > 0) {
            const first = metas[0];
            return {
                name: first.name || cleanName,
                poster: first.poster || generateFallbackPoster(first.name || cleanName),
                backdrop: first.background || first.poster || null,
                description: first.description || "Disponible dans votre Cloud CinéCloud.",
                imdbId: first.imdb_id || first.id,
                year: first.year || null,
                tmdbId: null
            };
        }
    } catch (e) {
        // Ignorer silencieusement
    }
    return null;
}

async function getTmdbMetadata(filename, type, tmdbKey, detailed = false) {
    try {
        const { title: cleanName, year } = extractCleanTitle(filename);
        const tmdbType = (type === "movie") ? "movie" : "tv";
        const yearParam = year ? `&${type === "movie" ? "year" : "first_air_date_year"}=${year}` : "";
        const url = `https://api.themoviedb.org/3/search/${tmdbType}?api_key=${tmdbKey}&query=${encodeURIComponent(cleanName)}${yearParam}&language=fr-FR`;
        let res = await axios.get(url, { timeout: 6000 });

        if ((!res.data || !res.data.results || res.data.results.length === 0) && year) {
            const urlNoYear = `https://api.themoviedb.org/3/search/${tmdbType}?api_key=${tmdbKey}&query=${encodeURIComponent(cleanName)}&language=fr-FR`;
            res = await axios.get(urlNoYear, { timeout: 6000 });
        }

        if ((!res.data || !res.data.results || res.data.results.length === 0)) {
            const shortened = cleanName.split(" ").slice(0, 3).join(" ");
            if (shortened && shortened !== cleanName) {
                const urlShort = `https://api.themoviedb.org/3/search/${tmdbType}?api_key=${tmdbKey}&query=${encodeURIComponent(shortened)}&language=fr-FR`;
                res = await axios.get(urlShort, { timeout: 6000 }).catch(() => res);
            }
        }

        if (res.data && res.data.results && res.data.results.length > 0) {
            const first = res.data.results[0];
            let cast = [];
            let genreNames = [];
            if (detailed) {
                try {
                    const detailUrl = `https://api.themoviedb.org/3/${tmdbType}/${first.id}?api_key=${tmdbKey}&language=fr-FR&append_to_response=credits`;
                    const detailRes = await axios.get(detailUrl, { timeout: 6000 });
                    if (detailRes.data) {
                        genreNames = (detailRes.data.genres || []).map(g => g.name);
                        cast = ((detailRes.data.credits && detailRes.data.credits.cast) || []).slice(0, 8).map(c => c.name);
                    }
                } catch (e) {}
            }

            return {
                name: first.title || first.name || filename,
                poster: first.poster_path ? `https://image.tmdb.org/t/p/w500${first.poster_path}` : generateFallbackPoster(first.title || first.name || cleanName),
                backdrop: first.backdrop_path ? `https://image.tmdb.org/t/p/w1280${first.backdrop_path}` : (first.poster_path ? `https://image.tmdb.org/t/p/w500${first.poster_path}` : generateFallbackPoster(first.title || first.name || cleanName)),
                description: first.overview || "Disponible dans ton Cloud Alldebrid.",
                genreIds: first.genre_ids || [],
                genres: genreNames,
                cast: cast,
                imdbRating: first.vote_average ? first.vote_average.toFixed(1) : null,
                tmdbId: first.id
            };
        }
    } catch (e) {
        // En cas d'erreur TMDB, repli vers Cinemeta
    }

    // Repli de secours sur Cinemeta
    const { title: cleanName } = extractCleanTitle(filename);
    const cinemetaResult = await searchCinemeta(cleanName, type);
    if (cinemetaResult) {
        return cinemetaResult;
    }

    return {
        name: cleanName || filename,
        poster: generateFallbackPoster(cleanName || filename),
        backdrop: generateFallbackPoster(cleanName || filename),
        description: "Fichier disponible dans votre Cloud CinéCloud.",
        genreIds: [],
        genres: [],
        cast: [],
        imdbRating: null,
        tmdbId: null
    };
}

async function tmdbToImdbId(tmdbId, type, tmdbKey) {
    try {
        const tmdbType = (type === "movie") ? "movie" : "tv";
        const url = `https://api.themoviedb.org/3/${tmdbType}/${tmdbId}/external_ids?api_key=${tmdbKey}`;
        const res = await axios.get(url, { timeout: 6000 });
        return res.data && res.data.imdb_id ? res.data.imdb_id : null;
    } catch (e) {
        return null;
    }
}

async function imdbIdToTitle(imdbId, tmdbKey) {
    try {
        const url = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${tmdbKey}&external_source=imdb_id&language=fr-FR`;
        const res = await axios.get(url, { timeout: 6000 });
        const movie = res.data && res.data.movie_results && res.data.movie_results[0];
        const tv = res.data && res.data.tv_results && res.data.tv_results[0];
        if (movie) return movie.original_title || movie.title;
        if (tv) return tv.original_name || tv.name;
    } catch (e) {
        // repli cinemeta
    }
    try {
        const cinemetaUrl = `https://v3-cinemeta.strem.io/meta/movie/${imdbId}.json`;
        const res = await axios.get(cinemetaUrl, { timeout: 6000 });
        if (res.data && res.data.meta && res.data.meta.name) return res.data.meta.name;
    } catch (e) {
        //
    }
    return null;
}

function buildStreamTitle(filename, sizeBytes, subtitle) {
    const lines = [];
    lines.push(filename || "Fichier");
    const tech = extractTechBadge(filename);
    const sizeStr = sizeBytes ? formatSize(sizeBytes) : "";
    const metaParts = [tech, sizeStr].filter(Boolean);
    if (metaParts.length) lines.push(metaParts.join(" • "));
    if (subtitle) lines.push(subtitle);
    return lines.join("\n");
}

/**
 * Générateur de flux dans le style AIOStreams (Colonnes Stremio structurées)
 */
function formatAioStream({
    filename,
    sizeBytes = 0,
    provider = "CinéCloud",
    indexer = "Mon Cloud",
    subtitle = null,
    url = null
}) {
    const raw = filename || "";

    // 1. Résolution & Badge
    let resBadge = "1080p";
    if (/\b(2160p|4k|uhd)\b/i.test(raw)) {
        resBadge = "4K";
    } else if (/\b1080p\b/i.test(raw)) {
        resBadge = "1080p";
    } else if (/\b720p\b/i.test(raw)) {
        resBadge = "720p";
    } else if (/\b(480p|576p)\b/i.test(raw)) {
        resBadge = "480p";
    }

    // 2. Langues & Détection FR Dub
    const hasVff = /\b(vff|truefrench)\b/i.test(raw);
    const hasVfi = /\b(vfi|vfq|quebec)\b/i.test(raw);
    const hasVf = /\b(vf|french)\b/i.test(raw) || hasVff || hasVfi;
    const hasMulti = /\bmulti\b/i.test(raw);
    const hasDual = /\bdual[\.\- ]?audio\b/i.test(raw);
    const hasJap = /\b(jap|japanese)\b/i.test(raw) || /\b(anime)\b/i.test(raw);
    const hasEng = /\b(eng|english|vo)\b/i.test(raw);
    const hasVostfr = /\bvostfr\b/i.test(raw);

    const langFlags = [];
    if (hasVf) langFlags.push("🇫🇷");
    if (hasMulti) langFlags.push("🌐");
    if (hasDual && !hasMulti) langFlags.push("Dual Audio");
    if (hasJap) langFlags.push("🇯🇵");
    if (hasEng && !hasVf) langFlags.push("🇬🇧");

    const isFrDub = hasVf || hasMulti;
    let resLine = "";
    if (isFrDub) {
        resLine = `${resBadge} (FR Dub)`;
    } else {
        resLine = (resBadge === "4K" || resBadge === "1080p") ? `${resBadge} ⭐` : resBadge;
    }

    // 3. Qualité & Source vidéo
    let quality = "";
    if (/\b(bdremux|bluray[\.\- ]?remux|remux)\b/i.test(raw)) quality = "BluRay REMUX";
    else if (/\b(bluray|bdrip|brrip)\b/i.test(raw)) quality = "BluRay";
    else if (/\b(web[\.\-]?dl)\b/i.test(raw)) quality = "WEB-DL";
    else if (/\b(webrip)\b/i.test(raw)) quality = "WEBRip";
    else if (/\b(hdtv)\b/i.test(raw)) quality = "HDTV";
    else if (/\b(dvdrip|dvd)\b/i.test(raw)) quality = "DVD";

    // 4. Codec vidéo
    let codec = "";
    if (/\b(hevc|x265|h265)\b/i.test(raw)) codec = "HEVC";
    else if (/\b(avc|x264|h264)\b/i.test(raw)) codec = "AVC";
    else if (/\bav1\b/i.test(raw)) codec = "AV1";
    else if (/\b(xvid|divx)\b/i.test(raw)) codec = "XviD";

    // 5. Visual / HDR / 10bit
    const visuals = [];
    if (/\b(10[\.\-]?bit|hi10p)\b/i.test(raw)) visuals.push("10bit");
    if (/\b(dv|dovi|dolby[\.\- ]?vision)\b/i.test(raw)) visuals.push("DV");
    if (/\bhdr10\+\b/i.test(raw)) visuals.push("HDR10+");
    else if (/\bhdr10\b/i.test(raw)) visuals.push("HDR10");
    else if (/\bhdr\b/i.test(raw)) visuals.push("HDR");

    const videoParts = [quality, codec, ...visuals].filter(Boolean);
    const videoLine = videoParts.length ? ("🎬 " + videoParts.join(" • ")) : "";

    // 6. Taille & Audio
    let sizeStr = "";
    if (sizeBytes && !isNaN(sizeBytes) && sizeBytes > 0) {
        const gb = sizeBytes / (1024 * 1024 * 1024);
        if (gb >= 1) sizeStr = `${gb.toFixed(1)} GB`;
        else sizeStr = `${(sizeBytes / (1024 * 1024)).toFixed(0)} MB`;
    }

    let audioCodec = "";
    if (/\btruehd[\.\- ]?atmos\b/i.test(raw)) audioCodec = "TrueHD Atmos";
    else if (/\batmos\b/i.test(raw)) audioCodec = "Atmos";
    else if (/\btruehd\b/i.test(raw)) audioCodec = "TrueHD";
    else if (/\bdts[\.\- ]?hd(?:[\.\- ]?ma)?\b/i.test(raw)) audioCodec = "DTS-HD MA";
    else if (/\bdts\b/i.test(raw)) audioCodec = "DTS";
    else if (/\bflac\b/i.test(raw)) audioCodec = "FLAC";
    else if (/\b(e[\.\-]?ac[\.\-]?3|ddp|dd\+)\b/i.test(raw)) audioCodec = "E-AC3";
    else if (/\b(ac[\.\-]?3|dd5\.?1)\b/i.test(raw)) audioCodec = "AC3";
    else if (/\baac\b/i.test(raw)) audioCodec = "AAC";
    else if (/\bopus\b/i.test(raw)) audioCodec = "OPUS";

    let channels = "";
    if (/\b7[\.\_ ]?1\b/.test(raw)) channels = "7.1";
    else if (/\b5[\.\_ ]?1\b/.test(raw)) channels = "5.1";
    else if (/\b2[\.\_ ]?0\b/.test(raw)) channels = "2.0";

    const audioPart = [audioCodec, channels].filter(Boolean).join(" ");
    const line3Parts = [];
    if (sizeStr) line3Parts.push(`📦 ${sizeStr}`);
    if (audioPart) line3Parts.push(`🔊 ${audioPart}`);
    const line3 = line3Parts.join(" • ");

    // 7. Group & Langs
    let group = "";
    const groupMatch = raw.match(/-([A-Za-z0-9_]+)(?:\.[a-z0-9]+)?$/i);
    if (groupMatch && groupMatch[1].length < 20 && !/^(mkv|mp4|avi|1080p|720p|hevc|x264|web|bluray)$/i.test(groupMatch[1])) {
        group = groupMatch[1];
    }
    const line4Parts = [];
    if (langFlags.length) line4Parts.push(langFlags.join(" / "));
    if (hasVostfr && !hasVf) line4Parts.push("💬 VOSTFR");
    if (group) line4Parts.push(`🏷️ ${group}`);
    const line4 = line4Parts.join(" • ");

    // 8. Titre épuré (Ligne 1)
    const { title: cleanTitle, year } = extractCleanTitle(raw);
    let displayTitle = cleanTitle || raw;
    if (year && !displayTitle.includes(year)) {
        displayTitle += ` (${year})`;
    }
    if (displayTitle.length > 55) {
        displayTitle = displayTitle.slice(0, 52) + "...";
    }

    // Badge gauche
    const name = ["[AD ⚡]", provider, resLine].filter(Boolean).join("\n");

    // Lignes de droite
    const titleLines = [
        `📁 ${displayTitle}`,
        videoLine,
        line3,
        line4,
        subtitle ? `⚡ ${subtitle}` : null,
        `🔍 ${indexer}`
    ].filter(Boolean);

    return {
        name,
        title: titleLines.join("\n"),
        url,
        _size: sizeBytes,
        _rawFilename: raw
    };
}

module.exports = {
    TMDB_KEY_DEFAULT,
    ALL_CATALOGS,
    flattenFiles,
    isRealVideoFile,
    formatSize,
    detectLangTag,
    extractTechBadge,
    classifyContent,
    sortByLangPref,
    parseSeasonEpisode,
    extractCleanTitle,
    getTmdbMetadata,
    tmdbToImdbId,
    imdbIdToTitle,
    buildStreamTitle,
    formatAioStream,
    generateFallbackPoster,
    searchCinemeta
};
