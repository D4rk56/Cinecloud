"use strict";

const axios = require("axios");

const TMDB_KEY_DEFAULT = process.env.TMDB_KEY || process.env.TMDB_API_KEY || "14cc580302bf1c4161bf96efb2165215";
const invalidTmdbKeys = new Set();
const VIDEO_EXT = /\.(mp4|mkv|avi|mov|wmv|ts|m4v|webm|flv)$/i;

const ALL_CATALOGS = [
    { id: "my_ad_links", name: "Mes Liens Débridés ☁️", type: "movie" },
    { id: "my_ad_links_series", name: "Mes Séries Débridées 📺", type: "series" },
    { id: "my_ad_history", name: "Mon Historique 🕒", type: "movie" },
    { id: "my_ad_history_series", name: "Mon Historique Séries 🕒", type: "series" },
    { id: "my_ad_magnets", name: "Mes Fichiers Cloud ☁️", type: "movie" },
    { id: "my_ad_magnets_series", name: "Mes Séries Cloud 📺", type: "series" },
    { id: "my_ad_animes", name: "Mes Animés (Séries) 🇯🇵", type: "series" },
    { id: "my_ad_animes_movies", name: "Mes Animés (Films) 🇯🇵", type: "movie" },
    { id: "my_ad_reco_movies", name: "Recommandations Films 🍿", type: "movie" },
    { id: "my_ad_reco_series", name: "Recommandations Séries 📺", type: "series" },
    { id: "my_ad_reco_animes", name: "Recommandations Animés (Séries) 🇯🇵", type: "series" },
    { id: "my_ad_reco_animes_movies", name: "Recommandations Animés (Films) 🎌", type: "movie" }
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

function detectResolutionTag(filename) {
    const raw = (filename || "").toLowerCase();
    if (/\b(2160p|4k|uhd)\b/i.test(raw)) return "4k";
    if (/\b1080p\b/i.test(raw)) return "1080p";
    if (/\b720p\b/i.test(raw)) return "720p";
    if (/\b(480p|576p)\b/i.test(raw)) return "480p";
    return "other";
}

function filterAndSortStreams(streams, options = {}) {
    if (!Array.isArray(streams) || streams.length === 0) return [];

    const {
        resolutions = ["4k", "1080p", "720p", "480p"],
        langPref = ["multi_vff", "vff", "vfi", "multi", "vf", "vostfr"],
        hideUnknownLanguages = false,
        maxSizeGb = 150,
        sortBy = "quality",
        maxStreams = 0,
        prioritizeCloud = false
    } = options;

    const allowedResolutions = Array.isArray(resolutions)
        ? resolutions.map(r => r.toLowerCase().trim())
        : (resolutions ? resolutions.split(",").map(r => r.toLowerCase().trim()) : ["4k", "1080p", "720p", "480p"]);

    const preferredLangs = Array.isArray(langPref)
        ? langPref.map(l => l.toLowerCase().trim())
        : (langPref ? langPref.split(",").map(l => l.toLowerCase().trim()) : ["multi_vff", "vff", "vfi", "multi", "vf", "vostfr"]);

    const maxSizeBytes = (maxSizeGb && !isNaN(maxSizeGb) && Number(maxSizeGb) > 0)
        ? Number(maxSizeGb) * 1024 * 1024 * 1024
        : 0;

    let filtered = streams.filter(s => {
        const raw = s._rawFilename || s.title || s.name || s.description || "";
        const res = (s._resolution && s._resolution.toLowerCase()) || detectResolutionTag(raw);
        const lang = (s._lang && s._lang.toLowerCase()) || detectLangTag(raw);

        // 1. Filtrage par résolutions autorisées
        if (allowedResolutions.length > 0) {
            if (res !== "other" && !allowedResolutions.includes(res)) {
                return false;
            }
        }

        // 2. Filtrage des langues inconnues
        if (hideUnknownLanguages) {
            if (lang === "other" || lang === "unknown") {
                return false;
            }
        }

        // 3. Filtrage par taille maximale
        const sizeBytes = s._size || s.size || (s.s && s.s.size) || parseSizeFromString(raw) || 0;
        if (maxSizeBytes > 0 && sizeBytes && sizeBytes > maxSizeBytes) {
            return false;
        }

        return true;
    });

    const getResRank = (s) => {
        const raw = s._rawFilename || s.title || s.name || s.description || "";
        const res = (s._resolution && s._resolution.toLowerCase()) || detectResolutionTag(raw);
        const idx = allowedResolutions.indexOf(res);
        return idx === -1 ? 999 : idx;
    };

    const getLangRank = (s) => {
        const raw = s._rawFilename || s.title || s.name || s.description || "";
        const tag = (s._lang && s._lang.toLowerCase()) || detectLangTag(raw);
        const idx = preferredLangs.indexOf(tag);
        return idx === -1 ? 999 : idx;
    };

    const isCloudStream = (s) => Boolean(s._isCloud || s._cacheType === "cloud" || (s.title && s.title.includes("☁️ Cloud personnel")));

    if (sortBy === "size") {
        filtered.sort((a, b) => {
            if (prioritizeCloud) {
                const aC = isCloudStream(a);
                const bC = isCloudStream(b);
                if (aC !== bC) return aC ? -1 : 1;
            }
            return ((b._size || b.s?._size || 0) - (a._size || a.s?._size || 0)) || (getLangRank(a) - getLangRank(b));
        });
    } else {
        filtered.sort((a, b) => {
            if (prioritizeCloud) {
                const aC = isCloudStream(a);
                const bC = isCloudStream(b);
                if (aC !== bC) return aC ? -1 : 1;
            }
            const rDiff = getResRank(a) - getResRank(b);
            if (rDiff !== 0) return rDiff;
            const lDiff = getLangRank(a) - getLangRank(b);
            if (lDiff !== 0) return lDiff;
            return ((b._size || b.s?._size || 0) - (a._size || a.s?._size || 0));
        });
    }

    if (maxStreams && !isNaN(maxStreams) && Number(maxStreams) > 0) {
        filtered = filtered.slice(0, Number(maxStreams));
    }

    return filtered;
}

function sortByLangPref(streams, langPrefArray) {
    return filterAndSortStreams(streams, { langPref: langPrefArray });
}

function parseSeasonEpisode(filename) {
    if (!filename || typeof filename !== "string") return null;
    const matchS = filename.match(/S(\d{1,2})[\.\-_\s]*E(\d{1,3})/i);
    if (matchS) {
        return { season: parseInt(matchS[1], 10), episode: parseInt(matchS[2], 10) };
    }
    const matchX = filename.match(/(?:^|[\.\-_\s\[\(])(\d{1,2})x(\d{1,3})(?:[\.\-_\s\]\)]|$)/i);
    if (matchX) {
        return { season: parseInt(matchX[1], 10), episode: parseInt(matchX[2], 10) };
    }
    return null;
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

    // Recherche de toutes les années valides (1900 à 2030)
    const yearRegex = /\b(19\d{2}|20[0-2]\d)\b/g;
    const yearMatches = [];
    let ym;
    while ((ym = yearRegex.exec(name)) !== null) {
        yearMatches.push({ year: ym[1], index: ym.index });
    }

    let detectedYear = null;
    let yearCutIndex = -1;

    if (yearMatches.length > 0) {
        if (yearMatches.length > 1 && yearMatches[0].index === 0) {
            // Premier match au tout début (ex: "1917 2019") : le second match est l'année de sortie
            detectedYear = yearMatches[1].year;
            yearCutIndex = yearMatches[1].index;
        } else if (yearMatches[0].index > 0) {
            // L'année n'est pas au tout début : c'est l'année de sortie
            detectedYear = yearMatches[0].year;
            yearCutIndex = yearMatches[0].index;
        }
    }

    const cutMarkers = /\b(S\d{1,2}(E\d{1,3})?|E\d{1,3}|SAISON\s?\d{1,2}|COMPLETE|INTEGRALE|INTÉGRALE|MULTI|VOSTFR|VF2?|FRENCH|TRUEFRENCH|SUBFRENCH|2160p|1080p|720p|480p|576p|4K|UHD|HDR|HDR10\+?|HDR10PLUS|DV|DOVI|VISION|WEB[\-\.]?DL|WEBRIP|BLURAY|BDRIP|BRRIP|HDTV|HDTVRIP|HDLIGHT|REMUX|x264|x265|h264|h265|HEVC|AV1|XVID|DIVX|AAC|DTS(?:[\-\.]?HD)?|ATMOS|TRUEHD|FLAC|OPUS|EAC3|AC3|DDP5\.?1|DD5\.?1|PROPER|REPACK|RERIP|EXTENDED|UNRATED|THEATRICAL|DIRECTORS[\.\s]?CUT|FINAL[\.\s]?CUT|SPECIAL[\.\s]?EDITION|COLLECTORS[\.\s]?EDITION|DC|IMAX|OPEN[\.\s]?MATTE|DUAL|AUDIO)\b/gi;

    let markerCutIndex = name.length;
    let m;
    while ((m = cutMarkers.exec(name)) !== null) {
        if (m.index > 0) {
            markerCutIndex = m.index;
            break;
        }
    }

    let cutIndex = name.length;
    if (yearCutIndex > 0 && markerCutIndex > 0) {
        cutIndex = Math.min(yearCutIndex, markerCutIndex);
    } else if (yearCutIndex > 0) {
        cutIndex = yearCutIndex;
    } else if (markerCutIndex > 0) {
        cutIndex = markerCutIndex;
    }

    let title = name.slice(0, cutIndex);
    title = title.replace(/[\-\[\]\(\)]/g, " ").replace(/\s+/g, " ").trim();
    return { title: title || name, year: detectedYear };
}

/**
 * Génère une affiche SVG data URI élégante aux couleurs de Cinécloud (aucun placeholder 300x450 externe)
 */
function generateFallbackPoster(title) {
    const clean = (title || "Cinécloud").replace(/[<>&"']/g, "").slice(0, 32);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 450" width="300" height="450"><defs><linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#090d16"/><stop offset="100%" stop-color="#1e293b"/></linearGradient></defs><rect width="300" height="450" fill="url(#bg)" rx="16"/><circle cx="150" cy="180" r="54" fill="#0284c7" opacity="0.18"/><path d="M169.35 170.04C168.67 166.59 165.64 164 162 164 159.11 164 156.6 165.64 155.35 168.04 152.34 168.36 150 170.91 150 174c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM158 177.5v-7l6 3.5-6 3.5z" fill="#38bdf8" transform="scale(1.7) translate(-65, -80)"/><text x="150" y="275" text-anchor="middle" fill="#f8fafc" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-size="15" font-weight="700">${clean}</text><text x="150" y="302" text-anchor="middle" fill="#38bdf8" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-size="12" font-weight="600">Cinécloud</text></svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/**
 * Extrait les marqueurs de suite (chiffres romains, arabes, "part 1/2", etc.)
 */
/**
 * Extrait les marqueurs de suite (chiffres romains, arabes, "part 1/2", etc.)
 */
function extractSequelTag(normalizedStr) {
    if (!normalizedStr) return null;
    const wordNumMap = {
        one: "1", un: "1", first: "1", premier: "1",
        two: "2", deux: "2", second: "2", deuxieme: "2",
        three: "3", trois: "3", third: "3", troisieme: "3",
        four: "4", quatre: "4", fourth: "4", quatrieme: "4",
        five: "5", cinq: "5", fifth: "5", cinquieme: "5"
    };
    const romanMap = { i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };

    const partMatch = normalizedStr.match(/\b(?:part(?:ie)?|vol(?:ume)?|chap(?:itre)?)\s*([a-z0-9]+)\b/i);
    if (partMatch) {
        const val = partMatch[1].toLowerCase();
        if (wordNumMap[val]) return wordNumMap[val];
        if (romanMap[val]) return romanMap[val];
        if (/^[1-9]\d*$/.test(val)) return val;
    }
    const standaloneMatch = normalizedStr.match(/\b(ii|iii|iv|vi|vii|viii|ix|x|[2-9])\b/i);
    if (standaloneMatch) {
        const val = standaloneMatch[1].toLowerCase();
        return romanMap[val] || val;
    }
    return null;
}

const PACK_PATTERNS = /\b(quadrilogie|quadrilogy|trilogie|trilogy|duologie|duology|tetralogie|tetralogy|integrale|intégra?le|complete|collection|pack|saga|anthology|boxset|1[\s\-_]4|1[\s\-_]3|1[\s\-_]2)\b/i;

/**
 * Vérifie si le résultat renvoyé par Cinemeta ou TMDB correspond fidèlement au titre recherché
 * Évite les hallucinations et les faux positifs aberrants (ex: "not allowed" -> "Men Not Allowed", "Gladiator" -> "Gladiator II", "Toy Story" -> "Toy Story 2")
 */
function isConfidentTitleMatch(query, candidateTitle, queryYear = null, candidateYear = null) {
    if (!query || typeof query !== "string") return false;
    if (!candidateTitle || typeof candidateTitle !== "string") return false;

    // Si candidateTitle contient des marqueurs techniques bruts (ex: 1080p, MULTI, BLURAY), nettoyer
    let candTitleClean = candidateTitle;
    let candYearClean = candidateYear;
    if (/\b(1080p|720p|2160p|4k|bluray|bdrip|web[\-\.]?dl|webrip|hdlight|multi|vostfr|truefrench)\b/i.test(candidateTitle)) {
        const cleaned = extractCleanTitle(candidateTitle);
        if (cleaned.title) {
            candTitleClean = cleaned.title;
            if (!candYearClean && cleaned.year) candYearClean = cleaned.year;
        }
    }

    const normalize = (s) => s.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const qNorm = normalize(query);
    const cNorm = normalize(candTitleClean);

    if (!qNorm || !cNorm) return false;

    // Rejeter immédiatement les messages d'erreur HTTP / hébergeur / débridage connus ou requêtes purement numériques
    const ERROR_PATTERNS = /^(404|403|500|502|503|ip\s*not\s*allowed|ipnotallowed|generic_ip_not_allowed|ip_not_allowed|not allowed|method not allowed|forbidden|unauthorized|bad gateway|internal server|not found|error|expired|failed|unknown|download limit reached|access denied|invalid link)$/i;
    const qRawClean = query.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (qRawClean === "ipnotallowed" || qRawClean.includes("notallowed") || ERROR_PATTERNS.test(qNorm) || ERROR_PATTERNS.test(query.trim()) || /^\d{1,3}$/.test(qNorm)) {
        return false;
    }

    // Détection stricte des packs et coffrets multi-films (ex: Toy Story vs Toy Story Quadrilogie)
    const qHasPack = PACK_PATTERNS.test(query) || PACK_PATTERNS.test(qNorm);
    const cHasPack = PACK_PATTERNS.test(candidateTitle) || PACK_PATTERNS.test(cNorm);
    if (qHasPack !== cHasPack) {
        return false;
    }

    // Si les deux années sont spécifiées, écart maximal toléré de 1 an
    const effectiveCandYear = candYearClean || candidateYear;
    if (queryYear && effectiveCandYear) {
        const qY = parseInt(queryYear, 10);
        const cY = parseInt(effectiveCandYear, 10);
        if (!isNaN(qY) && !isNaN(cY) && Math.abs(qY - cY) > 1) {
            return false;
        }
    }

    // Détection stricte des suites et chapitres (ex: Gladiator vs Gladiator II, Avatar vs Avatar 2, Toy Story vs Toy Story 2)
    const qSequel = extractSequelTag(qNorm);
    const cSequel = extractSequelTag(cNorm);
    if (qSequel !== cSequel) {
        return false;
    }

    if (qNorm === cNorm) return true;

    const STOP_WORDS = new Set(["the", "a", "an", "le", "la", "les", "un", "une", "de", "du", "des", "and", "et", "of", "in", "on", "at", "to", "for", "with"]);
    const qTokens = qNorm.split(" ").filter(t => t.length > 0 && !STOP_WORDS.has(t));
    const cTokens = cNorm.split(" ").filter(t => t.length > 0 && !STOP_WORDS.has(t));

    if (qTokens.length === 0 || cTokens.length === 0) return false;

    // Cohérence stricte des nombres présents dans les titres (en ignorant les résolutions et années de sortie)
    const TECH_NUMBERS = new Set(["480", "576", "720", "1080", "2160", "4320"]);
    const isYear = (n) => (queryYear && parseInt(n, 10) === parseInt(queryYear, 10)) || (effectiveCandYear && parseInt(n, 10) === parseInt(effectiveCandYear, 10));
    const qNumbers = qTokens.filter(t => /^\d+$/.test(t) && !TECH_NUMBERS.has(t) && !isYear(t));
    const cNumbers = cTokens.filter(t => /^\d+$/.test(t) && !TECH_NUMBERS.has(t) && !isYear(t));
    if (qNumbers.join(" ") !== cNumbers.join(" ")) {
        return false;
    }

    // Si un seul mot significatif dans l'un des deux titres
    if (qTokens.length === 1 || cTokens.length === 1) {
        return qTokens.length === 1 && cTokens.length === 1 && qTokens[0] === cTokens[0];
    }

    let matchCount = 0;
    for (const t of qTokens) {
        if (cTokens.includes(t)) {
            matchCount++;
        }
    }

    // Indice de Dice symétrique pour évaluer le recouvrement mutuel
    const diceSimilarity = (2 * matchCount) / (qTokens.length + cTokens.length);
    const firstWordMatch = qTokens[0] === cTokens[0] || cTokens.includes(qTokens[0]);
    return diceSimilarity >= 0.70 && firstWordMatch;
}

/**
 * Recherche de secours sur Cinemeta pour trouver l'affiche et l'IMDb ID
 */
async function searchCinemeta(cleanName, type = "movie", expectedYear = null) {
    try {
        if (!cleanName || cleanName.length < 2) return null;
        const cType = type === "series" ? "series" : "movie";
        const url = `https://v3-cinemeta.strem.io/catalog/${cType}/top/search=${encodeURIComponent(cleanName)}.json`;
        const res = await axios.get(url, { timeout: 4000 });
        const metas = (res.data && res.data.metas) || [];
        if (metas.length === 0) return null;

        const targetYear = expectedYear || extractCleanTitle(cleanName).year;

        let bestMeta = null;
        for (const m of metas) {
            if (!m || !m.name) continue;
            if (isConfidentTitleMatch(cleanName, m.name, targetYear, m.year)) {
                if (targetYear && m.year && Math.abs(parseInt(targetYear, 10) - parseInt(m.year, 10)) <= 1) {
                    bestMeta = m;
                    break;
                }
                if (!bestMeta) {
                    bestMeta = m;
                }
            }
        }

        if (!bestMeta) return null;

        return {
            name: bestMeta.name || cleanName,
            poster: bestMeta.poster || generateFallbackPoster(bestMeta.name || cleanName),
            backdrop: bestMeta.background || bestMeta.poster || null,
            description: bestMeta.description || "Disponible dans votre Cloud Cinécloud.",
            imdbId: bestMeta.imdb_id || bestMeta.id,
            year: bestMeta.year || null,
            tmdbId: null
        };
    } catch (e) {
        // Ignorer silencieusement
    }
    return null;
}

async function getTmdbMetadata(filename, type, tmdbKey, detailed = false) {
    try {
        const { title: cleanName, year } = extractCleanTitle(filename);
        if (!cleanName || cleanName.length < 2) {
            throw new Error("Nom de fichier trop court ou non significatif");
        }

        if (invalidTmdbKeys.has(tmdbKey)) {
            throw new Error("Clé TMDB invalide ou non autorisée");
        }

        const tmdbType = (type === "movie") ? "movie" : "tv";
        const yearParam = year ? `&${type === "movie" ? "year" : "first_air_date_year"}=${year}` : "";
        const url = `https://api.themoviedb.org/3/search/${tmdbType}?api_key=${tmdbKey}&query=${encodeURIComponent(cleanName)}${yearParam}&language=fr-FR`;
        let res = await axios.get(url, { timeout: 4000 });

        if ((!res.data || !res.data.results || res.data.results.length === 0) && year) {
            const urlNoYear = `https://api.themoviedb.org/3/search/${tmdbType}?api_key=${tmdbKey}&query=${encodeURIComponent(cleanName)}&language=fr-FR`;
            res = await axios.get(urlNoYear, { timeout: 6000 });
        }

        if ((!res.data || !res.data.results || res.data.results.length === 0)) {
            const shortened = cleanName.split(" ").slice(0, 3).join(" ");
            if (shortened && shortened !== cleanName && shortened.length >= 3) {
                const urlShort = `https://api.themoviedb.org/3/search/${tmdbType}?api_key=${tmdbKey}&query=${encodeURIComponent(shortened)}&language=fr-FR`;
                res = await axios.get(urlShort, { timeout: 6000 }).catch(() => res);
            }
        }

        if (res.data && Array.isArray(res.data.results) && res.data.results.length > 0) {
            const candidates = res.data.results.slice(0, 8);
            let bestCandidate = null;
            let bestName = "";

            for (const cand of candidates) {
                const cTitleFr = cand.title || cand.name || "";
                const cTitleOrig = cand.original_title || cand.original_name || "";
                const candYear = (cand.release_date || cand.first_air_date || "").slice(0, 4);

                const matchFr = isConfidentTitleMatch(cleanName, cTitleFr, year, candYear);
                const matchOrig = isConfidentTitleMatch(cleanName, cTitleOrig, year, candYear);

                if (matchFr || matchOrig) {
                    const resolvedName = cTitleFr || cTitleOrig;
                    // Si l'année correspond parfaitement, c'est le match idéal absolu
                    if (year && candYear && Math.abs(parseInt(year, 10) - parseInt(candYear, 10)) <= 1) {
                        bestCandidate = cand;
                        bestName = resolvedName;
                        break;
                    }
                    if (!bestCandidate) {
                        bestCandidate = cand;
                        bestName = resolvedName;
                    }
                }
            }

            if (bestCandidate) {
                let cast = [];
                let genreNames = [];
                if (detailed) {
                    try {
                        const detailUrl = `https://api.themoviedb.org/3/${tmdbType}/${bestCandidate.id}?api_key=${tmdbKey}&language=fr-FR&append_to_response=credits`;
                        const detailRes = await axios.get(detailUrl, { timeout: 6000 });
                        if (detailRes.data) {
                            genreNames = (detailRes.data.genres || []).map(g => g.name);
                            cast = ((detailRes.data.credits && detailRes.data.credits.cast) || []).slice(0, 8).map(c => c.name);
                        }
                    } catch (e) {}
                }

                return {
                    name: bestName,
                    poster: bestCandidate.poster_path ? `https://image.tmdb.org/t/p/w500${bestCandidate.poster_path}` : generateFallbackPoster(bestName),
                    backdrop: bestCandidate.backdrop_path ? `https://image.tmdb.org/t/p/w1280${bestCandidate.backdrop_path}` : (bestCandidate.poster_path ? `https://image.tmdb.org/t/p/w500${bestCandidate.poster_path}` : generateFallbackPoster(bestName)),
                    description: bestCandidate.overview || "Disponible dans votre Cloud Cinécloud.",
                    genreIds: bestCandidate.genre_ids || [],
                    genres: genreNames,
                    cast: cast,
                    imdbRating: bestCandidate.vote_average ? bestCandidate.vote_average.toFixed(1) : null,
                    tmdbId: bestCandidate.id
                };
            }
        }
    } catch (e) {
        if (e.response && (e.response.status === 401 || e.response.status === 403)) {
            invalidTmdbKeys.add(tmdbKey);
        }
        // En cas d'erreur TMDB, repli vers Cinemeta
    }

    // Repli de secours sur Cinemeta avec contrôle de conformité
    const { title: cleanName, year } = extractCleanTitle(filename);
    const cinemetaResult = await searchCinemeta(cleanName, type, year);
    if (cinemetaResult) {
        return cinemetaResult;
    }

    return {
        name: cleanName || filename,
        poster: generateFallbackPoster(cleanName || filename),
        backdrop: generateFallbackPoster(cleanName || filename),
        description: "Fichier disponible dans votre Cloud Cinécloud.",
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

function hasNonLatinCharacters(str) {
    if (!str || typeof str !== "string") return false;
    return /[^\u0000-\u024F\u1E00-\u1EFF\s\d\p{P}]/u.test(str);
}

function hasCjkCharacters(str) {
    return hasNonLatinCharacters(str);
}

async function imdbIdToTitleAndYear(imdbId, tmdbKey, type = null) {
    if (!imdbId) return { title: null, altTitle: null, year: null };
    const cleanId = String(imdbId).split(":")[0];
    const isSeries = type === "series" || type === "tv" || String(imdbId).includes(":");
    const hasCustomTmdbKey = tmdbKey && tmdbKey !== "default" && !invalidTmdbKeys.has(tmdbKey) && !tmdbKey.includes("14cc580302bf1c4161bf96efb2165215");

    if (hasCustomTmdbKey) {
        try {
            const url = `https://api.themoviedb.org/3/find/${cleanId}?api_key=${tmdbKey}&external_source=imdb_id&language=fr-FR`;
            const res = await axios.get(url, { timeout: 4000 });
            const movie = res.data && res.data.movie_results && res.data.movie_results[0];
            const tv = res.data && res.data.tv_results && res.data.tv_results[0];
            if (isSeries && tv) {
                const year = (tv.first_air_date || "").slice(0, 4) || null;
                const orig = tv.original_name;
                const trans = tv.name;
                let primary = null;
                let alt = null;
                if (orig && !hasNonLatinCharacters(orig)) {
                    primary = orig;
                    if (trans && trans !== orig && !hasNonLatinCharacters(trans)) alt = trans;
                } else if (trans && !hasNonLatinCharacters(trans)) {
                    primary = trans;
                    if (orig && orig !== trans) alt = orig;
                } else {
                    primary = trans || orig;
                }
                return { title: primary, altTitle: alt, year };
            }
            if (movie && !isSeries) {
                const year = (movie.release_date || "").slice(0, 4) || null;
                const orig = movie.original_title;
                const trans = movie.title;
                let primary = null;
                let alt = null;
                if (orig && !hasNonLatinCharacters(orig)) {
                    primary = orig;
                    if (trans && trans !== orig && !hasNonLatinCharacters(trans)) alt = trans;
                } else if (trans && !hasNonLatinCharacters(trans)) {
                    primary = trans;
                    if (orig && orig !== trans) alt = orig;
                } else {
                    primary = trans || orig;
                }
                return { title: primary, altTitle: alt, year };
            }
            if (tv) {
                const year = (tv.first_air_date || "").slice(0, 4) || null;
                const p = (!hasNonLatinCharacters(tv.name) ? tv.name : null) || tv.original_name;
                return { title: p, altTitle: (tv.original_name !== p) ? tv.original_name : null, year };
            }
            if (movie) {
                const year = (movie.release_date || "").slice(0, 4) || null;
                const p = (!hasNonLatinCharacters(movie.title) ? movie.title : null) || movie.original_title;
                return { title: p, altTitle: (movie.original_title !== p) ? movie.original_title : null, year };
            }
        } catch (e) {
            if (e.response && (e.response.status === 401 || e.response.status === 403)) {
                invalidTmdbKeys.add(tmdbKey);
            }
        }
    }
    const cinemetaTypes = isSeries ? ["series", "movie"] : ["movie", "series"];
    for (const cType of cinemetaTypes) {
        try {
            const cinemetaUrl = `https://v3-cinemeta.strem.io/meta/${cType}/${cleanId}.json`;
            const res = await axios.get(cinemetaUrl, { timeout: 4000 });
            if (res.data && res.data.meta && res.data.meta.name) {
                let primary = res.data.meta.name;
                let alt = null;
                // Si Cinemeta renvoie un titre en caractères non-latins, récupérer le slug translittéré latin
                if (hasNonLatinCharacters(primary) && res.data.meta.slug) {
                    const slugPart = res.data.meta.slug.replace(/^(movie|series)\//, "").replace(/-\d+$/, "");
                    const reconstructed = slugPart.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
                    if (reconstructed && !hasNonLatinCharacters(reconstructed)) {
                        alt = primary;
                        primary = reconstructed;
                    }
                }
                return { title: primary, altTitle: alt, year: res.data.meta.year || null };
            }
        } catch (e) {}
    }
    return { title: null, altTitle: null, year: null };
}

async function imdbIdToTitle(imdbId, tmdbKey, type = null) {
    const meta = await imdbIdToTitleAndYear(imdbId, tmdbKey, type);
    return meta ? meta.title : null;
}

const frenchTitleCache = new Map();

/**
 * Récupère le titre officiel en français (TMDB avec fallback Wikidata)
 * Utilisé pour afficher des titres francophones sous les posters dans les catalogues Stremio
 */
async function getFrenchTitle(imdbId, fallbackTitle = "", tmdbKey = null, type = null) {
    if (!imdbId) return fallbackTitle;
    const cleanId = String(imdbId).split(":")[0];
    if (frenchTitleCache.has(cleanId)) {
        return frenchTitleCache.get(cleanId);
    }

    // 1. Si une clé TMDB personnalisée est disponible
    const hasCustomTmdbKey = tmdbKey && tmdbKey !== "default" && !invalidTmdbKeys.has(tmdbKey) && !tmdbKey.includes("14cc580302bf1c4161bf96efb2165215");
    if (hasCustomTmdbKey) {
        try {
            const url = `https://api.themoviedb.org/3/find/${cleanId}?api_key=${tmdbKey}&external_source=imdb_id&language=fr-FR`;
            const res = await axios.get(url, { timeout: 3500 });
            const item = (res.data?.movie_results?.[0]) || (res.data?.tv_results?.[0]);
            const frTitle = item?.title || item?.name;
            if (frTitle && frTitle.trim()) {
                frenchTitleCache.set(cleanId, frTitle.trim());
                return frTitle.trim();
            }
        } catch (e) {}
    }

    // 2. Requête Wikidata SPARQL par IMDb ID (gratuit, sans clé API, ultra-rapide)
    try {
        const sparql = `SELECT ?itemLabel WHERE { ?item wdt:P345 "${cleanId}". SERVICE wikibase:label { bd:serviceParam wikibase:language "fr". } } LIMIT 1`;
        const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`;
        const res = await axios.get(url, {
            headers: { "User-Agent": "Cinecloud/1.0 (contact@cinecloud.fr)", "Accept": "application/json" },
            timeout: 3500
        });
        const label = res.data?.results?.bindings?.[0]?.itemLabel?.value;
        if (label && !/^Q\d+$/.test(label) && label.trim().length > 1) {
            frenchTitleCache.set(cleanId, label.trim());
            return label.trim();
        }
    } catch (e) {}

    frenchTitleCache.set(cleanId, fallbackTitle);
    return fallbackTitle;
}

const {
    getAnimeMappingByKitsu,
    getAnimeMappingByImdb,
    getAnimeMappingByImdbAndSeason,
    fetchKitsuDetails,
    buildAnimeSeasonOffsets
} = require("./animeMapping");
const {
    parseAnimeTitle,
    parseAnimeTitleFallback,
    normalizeAnimeTitle,
    isAnimeTitleMatch,
    resolveEpisodeNumbering
} = require("./animeParser");

const kitsuCache = new Map();

async function resolveKitsuMeta(kitsuId, type = "series") {
    if (!kitsuId) return null;
    const cleanKitsu = String(kitsuId).replace(/^kitsu:/, "");
    const baseId = cleanKitsu.split(":")[0];
    const episode = cleanKitsu.includes(":") ? parseInt(cleanKitsu.split(":")[1], 10) : null;

    if (kitsuCache.has(baseId)) {
        const cached = kitsuCache.get(baseId);
        return { ...cached, episode: episode || cached.episode };
    }

    // 1. Récupération instantanée O(1) du mapping Fribb (IMDb, saison, TMDB)
    const fribbMapping = getAnimeMappingByKitsu(baseId);
    let imdbId = fribbMapping?.imdbId || null;
    let season = fribbMapping?.season || 1;

    // 2. Récupération des métadonnées détaillées Kitsu (titre officiel, romaji, alias, épisodes)
    const kitsuDetails = await fetchKitsuDetails(baseId).catch(() => null);
    if (kitsuDetails) {
        const title = kitsuDetails.canonicalTitle || kitsuDetails.titleRomaji || kitsuDetails.titleEn || `Anime (${baseId})`;
        const item = {
            kitsuId: baseId,
            name: title,
            title,
            imdbId,
            season,
            year: kitsuDetails.year,
            episode,
            aliases: kitsuDetails.aliases || [title],
            episodeCount: kitsuDetails.episodeCount
        };
        kitsuCache.set(baseId, item);
        return item;
    }

    // 3. Repli vers le proxy Stremio Kitsu si l'API Kitsu officielle est indisponible
    try {
        const cType = (type === "movie") ? "movie" : "series";
        const url = `https://anime-kitsu.strem.fun/meta/${cType}/kitsu:${baseId}.json`;
        const res = await axios.get(url, { timeout: 2500 });
        if (res.data && res.data.meta) {
            const meta = res.data.meta;
            const title = meta.name || meta.canonicalTitle || `Kitsu ${baseId}`;
            const item = {
                kitsuId: baseId,
                name: title,
                title,
                imdbId: imdbId || meta.imdb_id || null,
                season,
                year: meta.year || null,
                episode,
                aliases: [title],
                episodeCount: null
            };
            kitsuCache.set(baseId, item);
            return item;
        }
    } catch (e) {}

    const fallbackTitle = `Anime (${baseId})`;
    const item = {
        kitsuId: baseId,
        name: fallbackTitle,
        title: fallbackTitle,
        imdbId,
        season,
        year: null,
        episode,
        aliases: [fallbackTitle],
        episodeCount: null
    };
    kitsuCache.set(baseId, item);
    return item;
}

async function checkTmdbKey(tmdbKey) {
    if (!tmdbKey || typeof tmdbKey !== "string" || tmdbKey.trim() === "" || tmdbKey === "default") {
        return { valid: false, error: "Clé TMDB invalide." };
    }
    const key = tmdbKey.trim();
    try {
        const res = await axios.get(`https://api.themoviedb.org/3/configuration?api_key=${key}`, { timeout: 5000 });
        if (res.data && res.data.images) {
            return { valid: true };
        }
        return { valid: false, error: "Clé TMDB invalide" };
    } catch (err) {
        return { valid: false, error: err.response?.data?.status_message || "Impossible de vérifier la clé TMDB" };
    }
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
    provider = "Cinécloud",
    indexer = "Mon Cloud",
    subtitle = null,
    url = null,
    isInstant = true,
    cacheType = null,
    statusTag = null,
    debridProvider = "AllDebrid",
    isCloud = false
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

    // 2. Langues & Flags
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

    // Résolution propre sans FR SUB ni FR Dub
    const resLine = (resBadge === "4K" || resBadge === "1080p") ? `${resBadge} ⭐` : resBadge;

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

    // Détection Fournisseur (Torbox vs AllDebrid)
    const isTorbox = (String(debridProvider).toLowerCase() === "torbox") ||
                     (String(provider).toLowerCase() === "torbox") ||
                     (Boolean(statusTag && statusTag.startsWith("[TB")));
    const debridTag = isTorbox ? "TB" : "AD";
    const debridName = isTorbox ? "Torbox" : "AllDebrid";

    // Badge gauche : ⚡ (instantané) ou ⏳ (téléchargement)
    const statusIcon = isInstant ? "⚡" : "⏳";
    let computedStatusTag = statusTag;
    if (!computedStatusTag) {
        if (!isInstant) {
            computedStatusTag = `[${debridTag} ⏳]`;
        } else if (cacheType === "precache") {
            computedStatusTag = `[${debridTag} ⚡ Pré-cache]`;
        } else if (cacheType === "global") {
            computedStatusTag = `[${debridTag} ⚡ Cache Global]`;
        } else if (cacheType === "direct") {
            computedStatusTag = `[${debridTag} ⚡ Direct]`;
        } else if (cacheType === "lumio") {
            computedStatusTag = `[${debridTag} ⚡ Lumio]`;
        } else if (cacheType === "cloud") {
            computedStatusTag = `[${debridTag} ⚡ Cloud]`;
        } else {
            computedStatusTag = `[${debridTag} ${statusIcon}]`;
        }
    }
    // Colonne gauche épurée : [AD ⚡] / [TB ⚡] (ou ⏳) suivi de la résolution
    const name = [computedStatusTag, resLine].filter(Boolean).join("\n");

    // Lignes de droite : provenance / source & statut de cache
    const isCloudSource = (!indexer || indexer === "Mon Cloud" || provider === "Mon Cloud" || cacheType === "cloud" || (indexer && indexer.toLowerCase().includes("cloud")));

    let sourceLine = null;
    if (isCloudSource) {
        sourceLine = "☁️ Cloud personnel";
    } else if (cacheType === "lumio" || provider === "Lumio" || (indexer && indexer.toLowerCase().includes("lumio"))) {
        if (indexer && indexer.includes("|")) {
            const sub = indexer.split("|")[1].trim();
            sourceLine = `🌐 Lumio (${sub})`;
        } else {
            sourceLine = "🌐 Lumio";
        }
    } else if (indexer) {
        if (indexer.startsWith("Prowlarr |")) {
            const sub = indexer.replace("Prowlarr |", "").trim();
            sourceLine = `🔍 Prowlarr (${sub})`;
        } else if (indexer.startsWith("🔍") || indexer.startsWith("🌐") || indexer.startsWith("☁️")) {
            sourceLine = indexer;
        } else {
            sourceLine = `🔍 ${indexer}`;
        }
    }

    let statusLine = null;
    if (subtitle) {
        if (isCloudSource && (subtitle === "Résolution instantanée" || subtitle.includes("disponible dans votre compte"))) {
            statusLine = "⚡ Cloud personnel";
        } else if (subtitle.startsWith("⚡ ") || subtitle.startsWith("⏳ ")) {
            statusLine = subtitle;
        } else {
            statusLine = `${statusIcon} ${subtitle}`;
        }
    } else if (!isInstant) {
        statusLine = `⏳ En téléchargement ${debridName}`;
    } else if (cacheType === "precache") {
        statusLine = `⚡ Pré-cache RSS • ${debridName}`;
    } else if (cacheType === "global") {
        statusLine = "⚡ Cache Global (Mutualisé)";
    } else if (cacheType === "direct") {
        statusLine = "⚡ Recherche Prowlarr Directe";
    } else if (cacheType === "lumio") {
        statusLine = `⚡ Instantané Lumio • ${debridName}`;
    } else if (cacheType === "cloud" || isCloudSource) {
        statusLine = "⚡ Cloud personnel";
    } else {
        statusLine = `⚡ Instantané ${debridName}`;
    }

    const titleLines = [
        `📁 ${displayTitle}`,
        videoLine,
        line3,
        line4,
        sourceLine,
        statusLine,
        raw ? `📄 ${raw}` : null
    ].filter(Boolean);

    return {
        name,
        title: titleLines.join("\n"),
        url,
        _size: sizeBytes,
        _rawFilename: raw,
        _isInstant: isInstant,
        _isCloud: Boolean(isCloudSource || cacheType === "cloud" || isCloud)
    };
}

function parseSizeFromString(str) {
    if (!str || typeof str !== "string") return 0;
    const match = str.match(/(\d+(?:[\.,]\d+)?)\s*(GB|GIb|MB|MIb|TB|TIb|KO|KB)\b/i);
    if (!match) return 0;
    const val = parseFloat(match[1].replace(",", "."));
    const unit = match[2].toUpperCase();
    if (unit.startsWith("T")) return Math.round(val * 1024 * 1024 * 1024 * 1024);
    if (unit.startsWith("G")) return Math.round(val * 1024 * 1024 * 1024);
    if (unit.startsWith("M")) return Math.round(val * 1024 * 1024);
    if (unit.startsWith("K")) return Math.round(val * 1024);
    return 0;
}

module.exports = {
    TMDB_KEY_DEFAULT,
    ALL_CATALOGS,
    flattenFiles,
    isRealVideoFile,
    formatSize,
    parseSizeFromString,
    detectLangTag,
    detectResolutionTag,
    filterAndSortStreams,
    resolveKitsuMeta,
    checkTmdbKey,
    hasCjkCharacters,
    hasNonLatinCharacters,
    extractTechBadge,
    classifyContent,
    sortByLangPref,
    parseSeasonEpisode,
    extractCleanTitle,
    getTmdbMetadata,
    tmdbToImdbId,
    imdbIdToTitle,
    imdbIdToTitleAndYear,
    getFrenchTitle,
    buildStreamTitle,
    formatAioStream,
    generateFallbackPoster,
    searchCinemeta,
    isConfidentTitleMatch,
    parseAnimeTitle,
    parseAnimeTitleFallback,
    normalizeAnimeTitle,
    isAnimeTitleMatch,
    resolveEpisodeNumbering,
    getAnimeMappingByKitsu,
    getAnimeMappingByImdb,
    getAnimeMappingByImdbAndSeason,
    fetchKitsuDetails,
    buildAnimeSeasonOffsets
};
