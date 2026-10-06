"use strict";

const axios = require("axios");

// Clé TMDB publique de repli (non secrète). Les utilisateurs peuvent fournir leur propre
// clé via TMDB_KEY / TMDB_API_KEY (environnement) ou `tmdbKey` (configuration utilisateur).
const TMDB_PUBLIC_KEY = "14cc580302bf1c4161bf96efb2165215";
const TMDB_KEY_DEFAULT = process.env.TMDB_KEY || process.env.TMDB_API_KEY || TMDB_PUBLIC_KEY;
const invalidTmdbKeys = new Set();

// Identifiant IMDb valide (ex: tt1234567)
const IMDB_ID_RE = /^tt\d{6,}$/;

function isImdbId(id) {
    return typeof id === "string" && IMDB_ID_RE.test(id);
}

// Vraie clé TMDB personnalisée : non "default", non clé publique, non connue-invalide
function isCustomTmdbKey(tmdbKey) {
    return Boolean(
        tmdbKey &&
        typeof tmdbKey === "string" &&
        tmdbKey !== "default" &&
        tmdbKey !== TMDB_PUBLIC_KEY &&
        !tmdbKey.includes(TMDB_PUBLIC_KEY) &&
        !invalidTmdbKeys.has(tmdbKey)
    );
}
const VIDEO_EXT = /\.(mp4|mkv|avi|mov|wmv|ts|m4v|webm|flv)$/i;

// ─── Constantes module-level pour éviter les recompilations à chaque appel ───

// detectLangTag — regex compilées une seule fois
const RE_MULTI = /\bmulti\b/i;
const RE_VFF = /\bvff\b/i;
const RE_VFI = /\bvfi\b/i;
const RE_VFQ = /\bvfq\b/i;
const RE_VF = /\bvf\b/i;
const RE_VOSTFR = /\bvostfr\b/i;
const RE_FRENCH = /\b(french|truefrench)\b/i;

// cleanUrlAndDomainPrefix — constantes construites une seule fois
const _TRACKER_KW = [
    "zone-telechargement",
    "zt-za",
    "wawacity",
    "cpasbien",
    "yggtorrent",
    "share-wood",
    "sharewood",
    "tirexo",
    "darkiworld",
    "torrent9",
    "gktorrent",
    "oxtorrent",
    "extreme-down",
    "french-stream",
    "cinemay",
    "cstream"
];
const _TRACKER_PATTERN = _TRACKER_KW.map(k => k.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")).join("|");
const _TLD_LIST =
    "lat|moe|site|sh|plus|fi|net|fr|com|org|io|cc|to|tv|xyz|re|ws|pm|si|qa|cx|wf|info|me|co|top|club|pro|biz|eu|de|uk|ru|online|vip|work|pl|nl|app|dev|art|live|stream|zone|download|cloud|link|click|space|pw|icu|buzz|today|film|movie|torrent";
const _DISTINCT_TLD =
    "lat|moe|site|sh|plus|fi|net|fr|com|org|io|cc|xyz|re|ws|pm|si|qa|cx|wf|info|co|top|club|biz|eu|de|uk|ru|online|vip|icu|buzz|pw";
const _DOMAIN_IN_TAG_RE = new RegExp(`(?:https?:\\/\\/|www\\.)|(?:\\.(?:${_TLD_LIST})\\b)|${_TRACKER_PATTERN}`, "i");
const _EXPLICIT_DOMAIN_RE = /^(?:https?:\/\/|www\.)[a-z0-9\-]+(?:\.[a-z0-9\-]+)*\.[a-z]{2,12}[\s_.:–—\/-]+/i;
const _TRACKER_PREFIX_RE = new RegExp(`^(?:${_TRACKER_PATTERN})(?:\\.(?:${_TLD_LIST}))?[\\s_.:–—\\/-]+`, "i");
const _NON_DOT_DOMAIN_RE = new RegExp(`^[a-z0-9\\-]+(?:\\.[a-z0-9\\-]+)*\\.(?:${_TLD_LIST})[\\s_–—:\\/-]+`, "i");
const _DOT_DOMAIN_RE = new RegExp(`^[a-z0-9\\-]+(?:\\.[a-z0-9\\-]+)*\\.(?:${_DISTINCT_TLD})\\.+`, "i");
const _LEADING_SEP_RE = /^[\s_.:–—\/-]+/;

// Regex partagées avec stremio.js (exportées)
// Extensions qui ne sont JAMAIS le film/l'épisode lui-même (archives, sous-titres, images, audio…)
const NON_VIDEO_EXT_RE =
    /\.(zip|zipx|rar|r\d{2}|7z|tar|gz|tgz|bz2|xz|iso|img|mdf|nrg|exe|msi|apk|bat|cmd|sh|ps1|jar|dmg|pkg|deb|rpm|srt|sub|vtt|ass|ssa|idx|sup|smi|sbf|nfo|sfv|md5|sha1|sha256|url|lnk|torrent|cue|log|txt|ini|db|pdf|epub|mobi|docx?|xlsx?|pptx?|jpe?g|png|gif|bmp|webp|tiff?|heic|mp3|flac|wav|aac|m4a|ogg|wma|opus|ac3|dts|part|tmp|crdownload|partial)$/i;

// Motifs de NOM désignant un contenu annexe (sample, bonus, trailer…) : à exclure même si l'extension est vidéo
const SAMPLE_BONUS_RE =
    /\b(sample|samples|bonus|extras?|featurettes?|making[.\-_ ]?of|behind[.\-_ ]?the[.\-_ ]?scenes|trailers?|teasers?|promos?|previews?|deleted[.\-_ ]?scenes?|interviews?|screenshots?)\b/i;

// Motifs signalant un dossier/pack de série complète (à étendre en épisodes)
const COMPLETE_PACK_RE =
    /\b(complet|complete|integrale|intégrale|coffret|boxset|box[.\-_ ]?set|saga|antholog(?:y|ie)|collection|batch|pack|full[.\-_ ]?series|toutes?[.\-_ ]?les[.\-_ ]?saisons?)\b|\bS\d{1,2}[.\-_ ]?[-–][.\-_ ]?S?\d{1,2}\b/i;

const ERROR_PATTERNS_RE =
    /(?:ip\s*not\s*allowed|ipnotallowed|generic_ip_not_allowed|ip_not_allowed|not allowed|method not allowed|forbidden|unauthorized|bad gateway|internal server|not found|error|expired|failed|unknown|download limit reached|access denied|invalid link)/i;

/**
 * Détecte les noms de fichiers obfusqués, tokens de téléchargement aléatoires (Base64/Hex/UUID),
 * ou chaînes sans contenu textuel exploitable.
 */
function isObfuscated(filename) {
    if (!filename || typeof filename !== "string") return true;
    const s = String(filename)
        .replace(/\.(mp4|mkv|avi|mov|wmv|flv|webm)$/i, "")
        .trim();
    if (!s || s.length < 2) return true;
    // 1. Hexadécimal pur de 16 à 64 caractères ou UUID
    if (/^[a-f0-9]{16,64}$/i.test(s)) return true;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return true;
    // 2. Tokens Base64 / Base64URL d'au moins 20 caractères sans espaces naturels
    if (/^[A-Za-z0-9_-]{20,80}={0,2}$/.test(s) && !/[ ._]/.test(s.slice(4, -4))) return true;
    // 3. Chaîne principalement hexadécimale (>80%)
    const hexOnly = s.replace(/[^a-f0-9]/gi, "");
    if (hexOnly.length >= 16 && hexOnly.length / s.replace(/\s+/g, "").length > 0.8) return true;
    // 4. Chaîne aléatoire sans voyelles (ratio de voyelles anormalement bas < 12% sur plus de 15 lettres)
    const letters = s.replace(/[^a-zA-Z]/g, "");
    if (s.length >= 20 && letters.length >= 15 && !s.includes(" ")) {
        const vowels = letters.replace(/[^aeiouyAEIOUY]/g, "").length;
        if (vowels / letters.length < 0.12) return true;
    }
    return false;
}

/**
 * Cache LRU simple avec TTL
 */
function makeLRU(maxSize = 2000, ttlMs = 3600_000) {
    const map = new Map();
    return {
        has(k) {
            const e = map.get(k);
            if (!e) return false;
            if (Date.now() - e.t > ttlMs) {
                map.delete(k);
                return false;
            }
            return true;
        },
        get(k) {
            const e = map.get(k);
            if (!e) return undefined;
            if (Date.now() - e.t > ttlMs) {
                map.delete(k);
                return undefined;
            }
            // LRU : déplacer en fin
            map.delete(k);
            map.set(k, e);
            return e.v;
        },
        set(k, v) {
            if (map.has(k)) map.delete(k);
            else if (map.size >= maxSize) map.delete(map.keys().next().value); // evict oldest
            map.set(k, { v, t: Date.now() });
        },
        delete(k) {
            return map.delete(k);
        },
        clear() {
            map.clear();
        }
    };
}

const ALL_CATALOGS = [
    { id: "my_ad_links", name: "Mes Liens Débridés ☁️", type: "movie" },
    { id: "my_ad_links_series", name: "Mes Séries Débridées 📺", type: "series" },
    { id: "my_ad_history", name: "Mon Historique 🕒", type: "movie" },
    { id: "my_ad_history_series", name: "Mon Historique Séries 🕒", type: "series" },
    { id: "my_ad_magnets", name: "Mes Films Cloud ☁️", type: "movie" },
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
    if (!filename || typeof filename !== "string") return false;
    // Retire un éventuel querystring / fragment (liens CDN signés) avant de tester l'extension
    const clean = filename.split("?")[0].split("#")[0];
    if (!VIDEO_EXT.test(clean)) return false;
    if (SAMPLE_BONUS_RE.test(clean)) return false;
    return true;
}

/**
 * Indique si un nom désigne un artefact non vidéo (archive, sous-titre, image, audio…)
 * ou un contenu annexe (sample, bonus, trailer…) : à exclure des catalogues.
 */
function isExcludedArtifact(name) {
    if (!name || typeof name !== "string") return true;
    return NON_VIDEO_EXT_RE.test(name) || SAMPLE_BONUS_RE.test(name);
}

/**
 * Indique si un nom de dossier/torrent correspond à un pack de série complète
 * (« COMPLETE », « INTEGRALE », « COFFRET », « BATCH », « S01-S03 »…).
 */
function isCompleteSeriesPack(name) {
    if (!name || typeof name !== "string") return false;
    return COMPLETE_PACK_RE.test(name);
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
    const hasMulti = RE_MULTI.test(t);
    const hasVff = RE_VFF.test(t);
    const hasVfi = RE_VFI.test(t);
    const hasVfq = RE_VFQ.test(t);
    const hasVf = RE_VF.test(t) && !hasVff && !hasVfi && !hasVfq;
    const hasVostfr = RE_VOSTFR.test(t);
    const hasFrench = RE_FRENCH.test(t);

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
    const t = filename || "";
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
        parts.push(c === "x265" || c === "h265" || c === "hevc" ? "HEVC" : c === "av1" ? "AV1" : "x264");
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
        multi_vff: "🇫🇷 MULTI (VFF/VFI)",
        multi: "🇫🇷 MULTI",
        vff: "🇫🇷 VFF",
        vfi: "🇫🇷 VFI",
        vfq: "🇫🇷 VFQ",
        vf: "🇫🇷 VF",
        vostfr: "💬 VOSTFR",
        other: "🌐 VO"
    };
    if (langFlags[langTag]) parts.push(langFlags[langTag]);

    return parts.join(" • ");
}

/**
 * Nettoie universellement les préfixes d'URLs, domaines de sites (tous TLDs) et trackers warez
 * Préserve les titres légitimes contenant des points/tirets (Mr. Robot, S.W.A.T., Wall-E) et groupes fansub ([SR-71])
 */
function cleanUrlAndDomainPrefix(filename) {
    if (!filename || typeof filename !== "string") return "";
    let str = filename.trim();

    // 1. Extraction du vrai nom de fichier si c'est une URL https?://...
    if (/^https?:\/\//i.test(str)) {
        try {
            const parsed = new URL(str);
            const fromQuery =
                parsed.searchParams.get("file") ||
                parsed.searchParams.get("filename") ||
                parsed.searchParams.get("title");
            if (fromQuery) {
                str = decodeURIComponent(fromQuery).trim();
            } else {
                const parts = parsed.pathname.split("/").filter(Boolean);
                if (parts.length > 0) {
                    str = decodeURIComponent(parts[parts.length - 1]).trim();
                }
            }
        } catch (e) {}
    }

    // 2. Suppression récursive des balises contenant un nom de domaine ou un nom de tracker
    let tagReplaced = true;
    while (tagReplaced) {
        tagReplaced = false;
        str = str.replace(/([\[\(][^\]\)]*?[\]\)])/gi, match => {
            if (_DOMAIN_IN_TAG_RE.test(match)) {
                tagReplaced = true;
                return " ";
            }
            return match;
        });
    }

    // 3. Boucle de nettoyage des préfixes de domaine / tracker et séparateurs résiduels
    let prev;
    do {
        prev = str;
        str = str.replace(_EXPLICIT_DOMAIN_RE, "");
        str = str.replace(_TRACKER_PREFIX_RE, "");
        str = str.replace(_NON_DOT_DOMAIN_RE, "");
        str = str.replace(_DOT_DOMAIN_RE, "");
        str = str.replace(_LEADING_SEP_RE, "");
    } while (str !== prev && str.length > 0);

    return str;
}

// Version de la logique de classification : incrémenter pour invalider les anciens résultats en cache
const CLASSIFY_CACHE_VERSION = "v2";

async function classifyContent(magnetId, filename, tmdbKey, cache = null) {
    const cacheKey = `${CLASSIFY_CACHE_VERSION}:${magnetId}`;
    if (cache && cache.classification && cache.classification[cacheKey]) {
        return cache.classification[cacheKey];
    }

    filename = cleanUrlAndDomainPrefix(filename);
    const lower = (filename || "").toLowerCase();
    const seParsed = parseSeasonEpisode(filename);
    // Extraction du titre propre une seule fois pour réutilisation
    const _cleanTitleResult = extractCleanTitle(filename);
    const _cleanName = _cleanTitleResult.title;
    const _cleanYear = _cleanTitleResult.year;

    // ─── Détection série : exclusion des années dans les tirets (ex. "Supergirl - 2024") ───
    const dashMatch = (filename || "").match(/(?:^|\s)-\s*(\d{1,4})(?:v\d+)?(?:\s|\[|\(|$|\.)/);
    const dashIsYear = Boolean(dashMatch) && /^(19\d{2}|20[0-2]\d)$/.test(dashMatch[1]);
    const hasDashEpisode = Boolean(dashMatch) && !dashIsYear;

    const hasStrongSeriesSignal = Boolean(
        seParsed !== null ||
        /(?:^|[\. \-_\(\[])S\d{1,2}(?:[\. \-_\)\]]|$)/i.test(filename) ||
        /\b(?:season|saison)\s*\d{1,2}\b/i.test(filename) ||
        /\b\d{1,2}(?:st|nd|rd|th|ème|eme)?\s*season\b/i.test(filename) ||
        /(?:^|[\. \-_\(\[])E\d{1,4}(?:[\. \-_\)\]]|$)/i.test(filename) ||
        /\b(?:episode|épisode|ep)\s*\d{1,4}\b/i.test(filename) ||
        /\b\d{1,2}x\d{1,4}\b/i.test(filename) ||
        hasDashEpisode
    );

    let result = null;
    try {
        if (_cleanName && _cleanName.length >= 2) {
            const effectiveTmdbKey = tmdbKey && tmdbKey !== "default" ? tmdbKey : TMDB_KEY_DEFAULT;
            const url = `https://api.themoviedb.org/3/search/multi?api_key=${effectiveTmdbKey}&query=${encodeURIComponent(_cleanName)}&language=fr-FR`;
            const res = await axios.get(url, { timeout: 4000 });
            const rawResults = ((res.data && res.data.results) || []).filter(
                r => r.media_type === "movie" || r.media_type === "tv"
            );

            // ─── Priorisation stricte : on cherche d'abord dans le bon type ───
            const wantedType = hasStrongSeriesSignal ? "tv" : "movie";
            const sameType = rawResults.filter(r => r.media_type === wantedType);
            const otherType = rawResults.filter(r => r.media_type !== wantedType);
            const orderedResults = [...sameType, ...otherType];

            // ─── Filtrage par année si l'année du fichier est connue ───
            const yearNum = _cleanYear ? parseInt(_cleanYear, 10) : null;
            const yearMatch = yearNum
                ? orderedResults.find(r => {
                      const rYear = parseInt((r.release_date || r.first_air_date || "").slice(0, 4), 10);
                      if (isNaN(rYear)) return false;
                      return Math.abs(rYear - yearNum) <= 1;
                  })
                : null;

            const best = (hasStrongSeriesSignal ? sameType[0] : null) || yearMatch || sameType[0] || rawResults[0];

            if (best) {
                const isJapanese = best.original_language === "ja";
                const isAnimation = (best.genre_ids || []).includes(16);
                result = {
                    type: hasStrongSeriesSignal ? "series" : best.media_type === "tv" ? "series" : "movie",
                    isAnime: isJapanese && isAnimation,
                    tmdbId: best.id,
                    name: best.title || best.name || _cleanName,
                    year: (best.release_date || best.first_air_date || "").slice(0, 4) || null
                };
            }
        }
    } catch (e) {
        // En cas d'erreur TMDB, heuristique locale
    }

    if (!result) {
        const isAnimeHeuristic =
            /^\[[^\]]+\]/.test(filename || "") ||
            /\b(vostfr|fansub|anime|sub)\b/i.test(lower) ||
            hasCjkCharacters(filename || "");
        result = {
            type: hasStrongSeriesSignal ? "series" : "movie",
            isAnime: Boolean(isAnimeHeuristic),
            tmdbId: null,
            name: _cleanName,
            year: _cleanYear
        };
    }

    if (cache) {
        if (!cache.classification) cache.classification = {};
        cache.classification[cacheKey] = result;
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

// Pondération par résolution pour sélectionner la meilleure release d'un groupe.
const RESOLUTION_RANK = { "4k": 4, "1080p": 3, "720p": 2, "480p": 1, other: 0 };

/**
 * Choisit la meilleure release parmi les fichiers d'un même contenu.
 *
 * Les catalogues « Mon historique » et « Mon cloud » regroupent plusieurs
 * fichiers d'un même film/série sous une seule fiche. Le nom affiché et le badge
 * technique ([4K WEB-DL]…) étaient calculés depuis le PREMIER fichier rencontré,
 * ce qui pouvait afficher une 1080p alors qu'un 2160p était disponible.
 *
 * Critères, par ordre de priorité :
 *   1. résolution (4k > 1080p > 720p > 480p)
 *   2. source (BluRay/Remux > WEB-DL > WEBRip > DVD/HDTV)
 *   3. taille en octets si elle est connue (le plus lourd gagne)
 *
 * @param {string[]} filenames Candidats du groupe
 * @param {number[]} [sizes] Tailles alignées sur `filenames` (optionnel)
 * @returns {string|null} Le meilleur nom de fichier
 */
function pickBestReleaseFilename(filenames, sizes = null) {
    if (!Array.isArray(filenames) || filenames.length === 0) return null;
    const candidates = filenames.map(f => (typeof f === "string" ? f.trim() : "")).filter(Boolean);
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    const SOURCE_RANK = [
        { re: /\b(remux|bluray|blu-ray|bdrip|brrip)\b/i, rank: 4 },
        { re: /\b(web-?dl|webdl|web-?rip|webrip|amzn|nf|disney)\b/i, rank: 3 },
        { re: /\b(hdtv|pdtv|dsr)\b/i, rank: 2 },
        { re: /\b(dvd|svcd|vhs)\b/i, rank: 1 }
    ];

    const sizeAt = i => {
        if (!Array.isArray(sizes)) return 0;
        const raw = sizes[i];
        const n = typeof raw === "number" ? raw : parseSizeFromString(String(raw || ""));
        return Number.isFinite(n) && n > 0 ? n : 0;
    };

    let bestIndex = 0;
    let bestScore = null;
    for (let i = 0; i < candidates.length; i++) {
        const resRank = RESOLUTION_RANK[detectResolutionTag(candidates[i])] ?? 0;
        const srcRank = SOURCE_RANK.find(s => s.re.test(candidates[i]))?.rank ?? 0;
        const score = [resRank, srcRank, sizeAt(i)];
        if (
            !bestScore ||
            score[0] > bestScore[0] ||
            (score[0] === bestScore[0] && score[1] > bestScore[1]) ||
            (score[0] === bestScore[0] && score[1] === bestScore[1] && score[2] > bestScore[2])
        ) {
            bestScore = score;
            bestIndex = i;
        }
    }
    return candidates[bestIndex];
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
        : resolutions
          ? resolutions.split(",").map(r => r.toLowerCase().trim())
          : ["4k", "1080p", "720p", "480p"];

    const preferredLangs = Array.isArray(langPref)
        ? langPref.map(l => l.toLowerCase().trim())
        : langPref
          ? langPref.split(",").map(l => l.toLowerCase().trim())
          : ["multi_vff", "vff", "vfi", "multi", "vf", "vostfr"];

    const maxSizeBytes =
        maxSizeGb && !isNaN(maxSizeGb) && Number(maxSizeGb) > 0 ? Number(maxSizeGb) * 1024 * 1024 * 1024 : 0;

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

    const getResRank = s => {
        const raw = s._rawFilename || s.title || s.name || s.description || "";
        const res = (s._resolution && s._resolution.toLowerCase()) || detectResolutionTag(raw);
        const idx = allowedResolutions.indexOf(res);
        return idx === -1 ? 999 : idx;
    };

    const getLangRank = s => {
        const raw = s._rawFilename || s.title || s.name || s.description || "";
        const tag = (s._lang && s._lang.toLowerCase()) || detectLangTag(raw);
        const idx = preferredLangs.indexOf(tag);
        return idx === -1 ? 999 : idx;
    };

    const isCloudStream = s =>
        Boolean(
            s._isCloud ||
            s._cacheType === "cloud" ||
            (s.title && (s.title.includes("☁️ Mon Cloud") || s.title.includes("☁️ Cloud personnel")))
        );
    const isInstantStream = s => Boolean(s._isInstant || (s.name && s.name.includes("⚡")));

    filtered.sort((a, b) => {
        if (prioritizeCloud) {
            const aC = isCloudStream(a);
            const bC = isCloudStream(b);
            if (aC !== bC) return aC ? -1 : 1;
        }

        // Priorité absolue aux flux garantis en cache (⚡ Instantané / Cache Global / Lumio / Torbox)
        const aInst = isInstantStream(a);
        const bInst = isInstantStream(b);
        if (aInst !== bInst) return aInst ? -1 : 1;

        if (sortBy === "size") {
            const sizeDiff = (b._size || b.s?._size || 0) - (a._size || a.s?._size || 0);
            if (sizeDiff !== 0) return sizeDiff;
            return getLangRank(a) - getLangRank(b);
        } else {
            const rDiff = getResRank(a) - getResRank(b);
            if (rDiff !== 0) return rDiff;
            const lDiff = getLangRank(a) - getLangRank(b);
            if (lDiff !== 0) return lDiff;
            // Pour les flux Prowlarr non confirmés en cache, privilégier le nombre de seeders (plus de chances d'être en cache)
            const aSeed = Number(a._seeders) || 0;
            const bSeed = Number(b._seeders) || 0;
            if (aSeed !== bSeed) return bSeed - aSeed;
            return (b._size || b.s?._size || 0) - (a._size || a.s?._size || 0);
        }
    });

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
    const cleanFn = cleanUrlAndDomainPrefix(filename).trim();

    // 1. SxxExx standard (ex: S01E05, S1E5, S01.E05, S01_E05, S01 - E05, S01E1080) ou avec parenthèses (S01E05)
    const matchS = cleanFn.match(/(?:^|[\. \-_\(\[])S(\d{1,2})[\.\-_\s]*E(\d{1,4})(?:[\. \-_\)\]]|$)/i);
    if (matchS) {
        return { season: parseInt(matchS[1], 10), episode: parseInt(matchS[2], 10) };
    }

    // 2. 1x05 standard (ex: 1x05, 01x05)
    const matchX = cleanFn.match(/(?:^|[\.\-_\s\[\(])(\d{1,2})x(\d{1,4})(?:[\.\-_\s\]\)]|$)/i);
    if (matchX) {
        return { season: parseInt(matchX[1], 10), episode: parseInt(matchX[2], 10) };
    }

    // 3. Mention de Saison et Épisode en toutes lettres (ex: "Saison 2 Episode 5", "Season 1 Ep 04")
    const matchWords = cleanFn.match(
        /\b(?:Season|Saison)\s*(\d{1,2})[\.\-_\s]*(?:Episode|Ep|Épisode|Ép)\s*(\d{1,4})\b/i
    );
    if (matchWords) {
        return { season: parseInt(matchWords[1], 10), episode: parseInt(matchWords[2], 10) };
    }

    // 4. Épisode explicite avec préfixe E ou Ep (ex: "E1080", "EP1080", "Episode 05", "(E1080)", "(Ep.05)")
    // Ne doit pas matcher les résolutions vidéo comme 1080p
    const matchEpPref = cleanFn.match(
        /(?:^|[\. \-_\(\[])(?:E|EP|Episode|Épisode|Ep|Ép)[\.\s#-]?(\d{1,4})(?!p\b)(?:[\. \-_\)\]]|$)/i
    );
    if (matchEpPref) {
        const epNum = parseInt(matchEpPref[1], 10);
        const sMatch =
            cleanFn.match(/\b(?:Season|Saison)\s*(\d{1,2})\b/i) ||
            cleanFn.match(/\b(\d{1,2})(?:st|nd|rd|th|ème|eme)?\s*Season\b/i);
        const season = sMatch ? parseInt(sMatch[1], 10) : 1;
        return { season, episode: epNum };
    }

    // 5. Tiret animé ou format standalone (ex: " - 05", " - 139v2", " - 05 [1080p]")
    const matchDash = cleanFn.match(/(?:^|\s)-\s*(\d{1,4})(?:v\d+)?(?:\s|\[|\(|$|\.)/);
    if (matchDash) {
        const epNum = parseInt(matchDash[1], 10);
        const sMatch =
            cleanFn.match(/\b(?:Season|Saison)\s*(\d{1,2})\b/i) ||
            cleanFn.match(/\b(\d{1,2})(?:st|nd|rd|th|ème|eme)?\s*Season\b/i);
        const season = sMatch ? parseInt(sMatch[1], 10) : 1;
        return { season, episode: epNum };
    }

    // 6. Si c'est un format animé complexe avec groupe entre crochets, vérifier via parseAnimeTitle
    if (/^\[[^\]]+\]/.test(cleanFn) || /\b(vostfr|fansub|anime)\b/i.test(cleanFn) || /[\u3040-\u30ff]/u.test(cleanFn)) {
        try {
            const { parseAnimeTitle } = require("./animeParser");
            const parsed = parseAnimeTitle(cleanFn);
            if (parsed && parsed.episode !== null && !isNaN(parsed.episode)) {
                return { season: parsed.season || 1, episode: parsed.episode };
            }
        } catch (e) {}
    }

    // 7. Mention isolée de saison complète sans épisode (ex: "Season 1", "S01", "Saison 2") -> { season, episode: null }
    const matchOnlySeason = cleanFn.match(
        /(?:^|[\. \-_\(\[])(?:S(\d{1,2})|(?:Season|Saison)\s*(\d{1,2})|(\d{1,2})(?:st|nd|rd|th|ème|eme)?\s*Season)(?:[\. \-_\)\]]|$)/i
    );
    if (matchOnlySeason) {
        const sNum = parseInt(matchOnlySeason[1] || matchOnlySeason[2] || matchOnlySeason[3], 10);
        return { season: sNum, episode: null, isSeasonPack: true };
    }

    return null;
}

function extractCleanTitle(filename) {
    if (!filename) return { title: "", year: null, altTitle: null };
    let raw = cleanUrlAndDomainPrefix(filename).replace(/\.(mp4|mkv|avi|mov|wmv|flv|webm)$/i, "");

    // 1. Détection de l'année au tout début avant nettoyage (ex: (2024) Titre ou [2024] Titre)
    let detectedYear = null;
    const leadYearMatch = raw.match(/^\s*[\(\[]\s*(19\d{2}|20[0-2]\d)\s*[\)\]]/);
    if (leadYearMatch) {
        detectedYear = leadYearMatch[1];
    }

    // 2. Nettoie en boucle les balises de début, trackers, domaines, tirets, etc.
    let prev;
    do {
        prev = raw;
        raw = raw.replace(/^\s*(\[[^\]]*\]|\([^\)]*\)|\{[^\}]*\})\s*/g, "");
        raw = raw.replace(
            /^\s*(?:www\.)?[a-z0-9_\-]+\.(?:org|com|net|pl|info|to|cc|us|co|tv|xyz|re|ws|pm|si|is|qa|cx|wf)\b[-.\s_]*/i,
            ""
        );
        raw = raw.replace(
            /^\s*(?:2160p|4k|1080p|720p|480p|hevc|h265|x265|h264|x264|multi|vff|vfi|vf|vostfr|french|truefrench)[-.\s_]+/i,
            ""
        );
        raw = raw.replace(/^[\s\-_:–—.]+/, "");
    } while (raw !== prev);

    // 3. Suppression des parenthèses techniques résiduelles n'importe où
    const PAREN_TECH_REGEX =
        /\s*\(\s*(?:2160p|4k|1080p|720p|480p|576p|uhd|fhd|hd|multi|vff|vfi|vfq|vf2?|vostfr|french|truefrench|subfrench|eng(?:lish)?[\.\s-]?sub|vo|bluray|bdrip|brrip|web[\.\-]?dl|webrip|hdtv|hdtvrip|hdlight|remux|x264|x265|h264|h265|hevc|av1|xvid|aac|ac3|dts(?:[\.\-]?hd)?|atmos|truehd|flac|opus|eac3|ddp5\.?1|dd5\.?1|tv|anime|ova|oad|special|batch|complete|integrale|intégra?le|uncensored|censored|raw|10bit|10-bit)\s*\)/gi;
    raw = raw.replace(PAREN_TECH_REGEX, " ");

    let name = raw.replace(/[\.\_]/g, " ").trim();

    // 4. Détection d'un titre alternatif ou année entre parenthèses (ex: Monstres & Cie (Monsters, Inc.))
    let altTitle = null;
    let yearCutIndex = -1;
    const parenAltMatch = name.match(/\(([a-zA-Z0-9\s,'’\-&]+)\)/);
    if (parenAltMatch) {
        const candidateAlt = parenAltMatch[1].trim();
        const isYear = /^(19\d{2}|20[0-2]\d)$/.test(candidateAlt);
        const isTechOrEpisode =
            /^(?:e\d+|ep\d+|s\d+|s\d+e\d+|\d{1,4}|1080p|720p|4k|multi|vostfr|french|vf|vff|vfi|vfq|vo|sub|tv|anime|ova|batch|complete)$/i.test(
                candidateAlt
            );
        const isPartOrChapter = /^(part|partie|volume|vol|chapitre|chapter)\b/i.test(candidateAlt);

        if (isYear && !detectedYear) {
            detectedYear = candidateAlt;
            yearCutIndex = parenAltMatch.index;
        } else if (isTechOrEpisode) {
            // Nettoyage sans retenir comme titre alternatif
            name = name.replace(parenAltMatch[0], " ").trim();
        } else if (!isYear && !isPartOrChapter && candidateAlt.length >= 2) {
            altTitle = candidateAlt;
            name = name.replace(parenAltMatch[0], " ").trim();
        }
    }

    // 5. Recherche des années valides si pas déjà trouvée
    if (!detectedYear) {
        const yearRegex = /\b(19\d{2}|20[0-2]\d)\b/g;
        const yearMatches = [];
        let ym;
        while ((ym = yearRegex.exec(name)) !== null) {
            yearMatches.push({ year: ym[1], index: ym.index });
        }
        if (yearMatches.length > 0) {
            if (yearMatches.length > 1 && yearMatches[0].index === 0) {
                detectedYear = yearMatches[1].year;
                yearCutIndex = yearMatches[1].index;
            } else if (yearMatches[0].index > 0) {
                detectedYear = yearMatches[0].year;
                yearCutIndex = yearMatches[0].index;
            } else if (yearMatches[0].index === 0) {
                detectedYear = yearMatches[0].year;
                name = name.slice(4).trim();
            }
        }
    }

    // Si l'année était précédée d'une parenthèse ouvrante ou tiret, reculer l'index de coupure
    if (yearCutIndex > 0) {
        let preIdx = yearCutIndex - 1;
        while (preIdx >= 0 && /[\s\(\[\-_]/.test(name[preIdx])) {
            preIdx--;
        }
        yearCutIndex = preIdx + 1;
    }

    // 6. Marqueurs de coupure (techniques, formats, saisons, épisodes)
    const cutMarkers =
        /\b(S\d{1,2}(?:E\d{1,4})?|E\d{1,4}|EP\d{1,4}|SAISON\s?\d{1,2}|SEASON\s?\d{1,2}|\d{1,2}(?:st|nd|rd|th)?\s*SEASON|COMPLETE|INTEGRALE|INTÉGRALE|MULTI|VOSTFR|VFF|VFI|VFQ|VF2?|FRENCH|TRUEFRENCH|SUBFRENCH|2160p|1080p|720p|480p|576p|4K|UHD|HDR|HDR10\+?|HDR10PLUS|DV|DOVI|VISION|WEB[\-\.]?DL|WEBRIP|BLURAY|BDRIP|BRRIP|HDTV|HDTVRIP|HDLIGHT|REMUX|x264|x265|h264|h265|HEVC|AV1|XVID|DIVX|AAC|DTS(?:[\-\.]?HD)?|ATMOS|TRUEHD|FLAC|OPUS|EAC3|AC3|DDP5\.?1|DD5\.?1|PROPER|REPACK|RERIP|EXTENDED|UNRATED|THEATRICAL|DIRECTORS[\.\s]?CUT|FINAL[\.\s]?CUT|SPECIAL[\.\s]?EDITION|COLLECTORS[\.\s]?EDITION|DC|IMAX|OPEN[\.\s]?MATTE|DUAL|AUDIO)\b/gi;

    let markerCutIndex = name.length;
    let m;
    while ((m = cutMarkers.exec(name)) !== null) {
        if (m.index > 0) {
            let pre = m.index - 1;
            while (pre >= 0 && /[\s\(\[\-_]/.test(name[pre])) pre--;
            markerCutIndex = pre + 1;
            break;
        }
    }

    // Coupure spéciale pour tiret épisode animé standalone (ex: " - 05")
    const dashEp = name.match(/(?:^|\s)-\s*(\d{1,4})(?:v\d+)?(?:\s|\[|\(|$)/);
    let dashEpCutIndex = name.length;
    if (dashEp && dashEp.index > 0) {
        dashEpCutIndex = dashEp.index;
    }

    let cutIndex = name.length;
    const candidates = [yearCutIndex, markerCutIndex, dashEpCutIndex].filter(c => c > 0);
    if (candidates.length > 0) {
        cutIndex = Math.min(...candidates);
    }

    const rawCut = name.slice(0, cutIndex).trim();
    let title = rawCut
        .replace(/[\[\]\(\)]/g, " ")
        .replace(/[\s\-_:–—.]+$/, "")
        .replace(/\s+/g, " ")
        .trim();

    // 7. Détection des franchises avec sous-titre (ex: "Special Ops: Lioness", "Shangri-La Frontier - Kusoge Hunter...")
    // et découpage de la clause principale
    const clauseMatch = rawCut.match(/^(.+?)\s*(?::\s+|\s+-\s+|\s+[–—]\s+)\s*(.+)$/);
    if (clauseMatch) {
        const part1 = clauseMatch[1]
            .replace(/[\[\]\(\)]/g, " ")
            .replace(/[\s\-_:–—.]+$/, "")
            .replace(/\s+/g, " ")
            .trim();
        const part2 = clauseMatch[2]
            .replace(/[\[\]\(\)]/g, " ")
            .replace(/[\s\-_:–—.]+$/, "")
            .replace(/\s+/g, " ")
            .trim();
        const isPrefixFranchise = /^(?:special\s+ops|op[eé]rations?\s+sp[eé]ciales?|marvel|star\s+wars|dc)\b/i.test(
            part1
        );
        if (isPrefixFranchise && part2.length >= 2) {
            altTitle = part2;
        } else if (part1.length >= 3 && !altTitle) {
            // Pour les animes ou titres avec long sous-titre (ex: Shangri-La Frontier - ...)
            altTitle = title;
            title = part1;
        }
    } else {
        const prefixFranchiseMatch = title.match(/^(?:special\s+ops|op[eé]rations?\s+sp[eé]ciales?)\s+(.+)$/i);
        if (prefixFranchiseMatch && !altTitle) {
            altTitle = prefixFranchiseMatch[1].trim();
        }
    }

    // Normalisation spéciale des pluriels français / cognats (ex: Lionnes -> Lioness)
    if (title && title.toLowerCase() === "lionnes") {
        if (!altTitle) altTitle = "Lioness";
    }

    return { title: title || name, year: detectedYear, altTitle };
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
        one: "1",
        un: "1",
        first: "1",
        premier: "1",
        two: "2",
        deux: "2",
        second: "2",
        deuxieme: "2",
        three: "3",
        trois: "3",
        third: "3",
        troisieme: "3",
        four: "4",
        quatre: "4",
        fourth: "4",
        quatrieme: "4",
        five: "5",
        cinq: "5",
        fifth: "5",
        cinquieme: "5"
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

const PACK_PATTERNS =
    /\b(quadrilogie|quadrilogy|trilogie|trilogy|duologie|duology|tetralogie|tetralogy|integrale|intégra?le|complete|collection|pack|saga|anthology|boxset|1[\s\-_]4|1[\s\-_]3|1[\s\-_]2)\b/i;

/**
 * Vérifie si le résultat renvoyé par Cinemeta ou TMDB correspond fidèlement au titre recherché
 * Évite les hallucinations et les faux positifs aberrants (ex: "not allowed" -> "Men Not Allowed", "Gladiator" -> "Gladiator II", "Toy Story" -> "Toy Story 2")
 */
function isConfidentTitleMatch(query, candidateTitle, queryYear = null, candidateYear = null) {
    if (!query || typeof query !== "string") return false;
    if (!candidateTitle || typeof candidateTitle !== "string") return false;

    // Nettoyage de la requête si elle contient des tags techniques ou parenthèses
    let qClean = query;
    let effectiveQueryYear = queryYear;
    if (
        /\b(1080p|720p|2160p|4k|bluray|bdrip|web[\-\.]?dl|webrip|hdlight|multi|vostfr|truefrench)\b/i.test(query) ||
        /\([^\)]*\)/.test(query)
    ) {
        const cleanedQ = extractCleanTitle(query);
        if (cleanedQ.title) {
            qClean = cleanedQ.title;
            if (!effectiveQueryYear && cleanedQ.year) effectiveQueryYear = cleanedQ.year;
        }
    }

    // Si candidateTitle contient des marqueurs techniques bruts (ex: 1080p, MULTI, BLURAY), nettoyer
    let candTitleClean = candidateTitle;
    let candYearClean = candidateYear;
    if (
        /\b(1080p|720p|2160p|4k|bluray|bdrip|web[\-\.]?dl|webrip|hdlight|multi|vostfr|truefrench)\b/i.test(
            candidateTitle
        ) ||
        /\([^\)]*\)/.test(candidateTitle)
    ) {
        const cleaned = extractCleanTitle(candidateTitle);
        if (cleaned.title) {
            candTitleClean = cleaned.title;
            if (!candYearClean && cleaned.year) candYearClean = cleaned.year;
        }
    }

    const normalize = s =>
        s
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9\s]/g, " ")
            .replace(/\s+/g, " ")
            .trim();

    const qNorm = normalize(qClean);
    const cNorm = normalize(candTitleClean);

    if (!qNorm || !cNorm) return false;

    // Rejeter immédiatement les messages d'erreur HTTP / hébergeur / débridage connus ou requêtes purement numériques
    const ERROR_PATTERNS =
        /^(404|403|500|502|503|ip\s*not\s*allowed|ipnotallowed|generic_ip_not_allowed|ip_not_allowed|not allowed|method not allowed|forbidden|unauthorized|bad gateway|internal server|not found|error|expired|failed|unknown|download limit reached|access denied|invalid link)$/i;
    const qRawClean = query.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (
        qRawClean === "ipnotallowed" ||
        qRawClean.includes("notallowed") ||
        ERROR_PATTERNS.test(qNorm) ||
        ERROR_PATTERNS.test(query.trim()) ||
        /^\d{1,3}$/.test(qNorm)
    ) {
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
    if (effectiveQueryYear && effectiveCandYear) {
        const qY = parseInt(effectiveQueryYear, 10);
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

    // Équivalences spéciales cognats et pluriels (ex: Lionnes <-> Lioness, Operations Speciales <-> Special Ops)
    const normalizeCognate = s =>
        s
            .replace(/\blionnes\b/g, "lioness")
            .replace(/\bop[eé]rations?\b/g, "ops")
            .replace(/\bsp[eé]ciales?\b/g, "special");
    const qNormCog = normalizeCognate(qNorm);
    const cNormCog = normalizeCognate(cNorm);
    if (qNormCog === cNormCog) return true;

    // Abréviations portemanteau anime bien connues
    if (
        (qNorm.includes("kono subarashii sekai") && cNorm.includes("konosuba")) ||
        (cNorm.includes("kono subarashii sekai") && qNorm.includes("konosuba"))
    ) {
        return true;
    }

    const STOP_WORDS = new Set([
        "the",
        "a",
        "an",
        "le",
        "la",
        "les",
        "un",
        "une",
        "de",
        "du",
        "des",
        "and",
        "et",
        "of",
        "in",
        "on",
        "at",
        "to",
        "for",
        "with"
    ]);
    const qTokens = qNormCog.split(" ").filter(t => t.length > 0 && !STOP_WORDS.has(t));
    const cTokens = cNormCog.split(" ").filter(t => t.length > 0 && !STOP_WORDS.has(t));

    if (qTokens.length === 0 || cTokens.length === 0) return false;

    // Si tous les tokens concordent exactement (même ensemble de mots, ex: ordre français vs anglais)
    if (qTokens.length === cTokens.length && qTokens.every(t => cTokens.includes(t))) {
        return true;
    }

    // Cohérence stricte des nombres présents dans les titres (en ignorant les résolutions et années de sortie)
    const TECH_NUMBERS = new Set(["480", "576", "720", "1080", "2160", "4320"]);
    const isYear = n =>
        (effectiveQueryYear && parseInt(n, 10) === parseInt(effectiveQueryYear, 10)) ||
        (effectiveCandYear && parseInt(n, 10) === parseInt(effectiveCandYear, 10)) ||
        /^(19\d{2}|20[0-2]\d)$/.test(n);
    const qNumbers = qTokens.filter(t => /^\d+$/.test(t) && !TECH_NUMBERS.has(t) && !isYear(t));
    const cNumbers = cTokens.filter(t => /^\d+$/.test(t) && !TECH_NUMBERS.has(t) && !isYear(t));
    if (qNumbers.join(" ") !== cNumbers.join(" ")) {
        return false;
    }

    // 1. Si les deux titres n'ont qu'un seul mot significatif
    if (qTokens.length === 1 && cTokens.length === 1) {
        return qTokens[0] === cTokens[0];
    }

    // 2. Si le candidat a un seul mot significatif (ex: query: "Special Ops Lioness", candidate: "Lioness")
    if (cTokens.length === 1) {
        const cSingle = cTokens[0];
        const GENERIC_PREFIX_WORDS = new Set([
            "special",
            "ops",
            "operation",
            "operations",
            "marvel",
            "disney",
            "star",
            "wars",
            "series",
            "movie",
            "show"
        ]);
        if (qTokens.includes(cSingle) && !GENERIC_PREFIX_WORDS.has(cSingle) && cSingle.length >= 4) {
            return true;
        }
        return false;
    }

    // 3. Si la requête a un seul mot significatif (ex: query: "Lioness", candidate: "Special Ops Lioness")
    if (qTokens.length === 1) {
        const qSingle = qTokens[0];
        const GENERIC_PREFIX_WORDS = new Set([
            "special",
            "ops",
            "operation",
            "operations",
            "marvel",
            "disney",
            "star",
            "wars",
            "series",
            "movie",
            "show"
        ]);
        if (cTokens.includes(qSingle) && !GENERIC_PREFIX_WORDS.has(qSingle) && qSingle.length >= 4) {
            const extraInCand = cTokens.filter(t => t !== qSingle);
            const SUBTITLE_EXT_WORDS = new Set([
                "film",
                "movie",
                "execution",
                "endgame",
                "revelation",
                "revolution",
                "origins",
                "requiem",
                "awakening",
                "resurrection",
                "homecoming",
                "ragnarok",
                "chronicles",
                "gaiden",
                "special",
                "ova",
                "oad",
                "spinoff"
            ]);
            if (extraInCand.every(t => GENERIC_PREFIX_WORDS.has(t))) {
                return true;
            }
            if (!extraInCand.some(t => SUBTITLE_EXT_WORDS.has(t))) {
                return true;
            }
        }
        return false;
    }

    // 4. Empêcher les faux positifs de préfixes génériques :
    // Si le candidat ne contient QUE des mots de préfixe générique (ex: candidate: "Special OPS")
    // et abandonne le mot distinctif de la requête (ex: "Lioness" dans "Special Ops Lioness")
    const missingInCand = qTokens.filter(t => !cTokens.includes(t));
    const GENERIC_WORDS = new Set(["special", "ops", "operation", "operations", "marvel", "disney", "star", "wars"]);
    if (cTokens.every(t => GENERIC_WORDS.has(t)) && missingInCand.some(t => !GENERIC_WORDS.has(t) && t.length >= 4)) {
        return false;
    }

    // 5. Correspondance par préfixe pour titres à rallonge / animes avec sous-titres
    // (ex: query: "Shangri La Frontier Kusoge Hunter..." vs candidate: "Shangri-La Frontier")
    // (ex: query: "Mushoku Tensei Isekai Ittara Honki Dasu" vs candidate: "Mushoku Tensei")
    if (cTokens.length >= 2 && cTokens.length < qTokens.length) {
        const isPrefixMatch = cTokens.every((t, i) => qTokens[i] === t);
        if (isPrefixMatch) {
            return true;
        }
    }

    // 6. Empêcher formellement un titre principal de franchise sans sous-titre de matcher un film/spin-off portant une extension
    // (ex: "Jujutsu Kaisen" vs "Jujutsu Kaisen: Execution", "Avengers" vs "Avengers: Endgame", "Jujutsu Kaisen : Le Film")
    const extraTokensInCand = cTokens.filter(t => !qTokens.includes(t));
    if (extraTokensInCand.length > 0) {
        const candHasColonOrDash = /[:–—]|(\s+-\s+)/.test(candidateTitle);
        const queryHasColonOrDash = /[:–—]|(\s+-\s+)/.test(query);
        if (candHasColonOrDash && !queryHasColonOrDash) {
            return false;
        }
        const SUBTITLE_EXT_WORDS = new Set([
            "film",
            "movie",
            "execution",
            "endgame",
            "revelation",
            "revolution",
            "origins",
            "requiem",
            "awakening",
            "resurrection",
            "homecoming",
            "ragnarok",
            "chronicles",
            "gaiden",
            "special",
            "ova",
            "oad",
            "spinoff"
        ]);
        if (extraTokensInCand.some(t => SUBTITLE_EXT_WORDS.has(t))) {
            return false;
        }
        if (qTokens.every(t => cTokens.includes(t)) && extraTokensInCand.length >= 1) {
            return false;
        }
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
    return diceSimilarity >= 0.7 && firstWordMatch;
}

/**
 * Recherche de secours sur Cinemeta pour trouver l'affiche et l'IMDb ID
 */
const cinemetaCache = makeLRU(1000, 1_800_000); // 30 min TTL

async function searchCinemeta(cleanName, type = "movie", expectedYear = null, altTitle = null) {
    try {
        if (!cleanName || cleanName.length < 2) return null;
        const cType = type === "series" ? "series" : "movie";
        const targetYear = expectedYear || extractCleanTitle(cleanName).year;

        // Cache LRU pour éviter les requêtes réseau répétées
        const ck = `${cType}__${cleanName}__${expectedYear || ""}`;
        if (cinemetaCache.has(ck)) return cinemetaCache.get(ck);

        const queries = [cleanName];
        if (altTitle && altTitle.trim() && altTitle.trim().toLowerCase() !== cleanName.trim().toLowerCase()) {
            queries.push(altTitle.trim());
        }

        for (const q of queries) {
            const url = `https://v3-cinemeta.strem.io/catalog/${cType}/top/search=${encodeURIComponent(q)}.json`;
            const res = await axios.get(url, { timeout: 4000 }).catch(() => null);
            const metas = (res && res.data && res.data.metas) || [];
            if (metas.length === 0) continue;

            let bestMeta = null;
            for (const m of metas) {
                if (!m || !m.name) continue;
                if (
                    isConfidentTitleMatch(q, m.name, targetYear, m.year) ||
                    isConfidentTitleMatch(cleanName, m.name, targetYear, m.year)
                ) {
                    if (targetYear && m.year && Math.abs(parseInt(targetYear, 10) - parseInt(m.year, 10)) <= 1) {
                        bestMeta = m;
                        break;
                    }
                    if (!bestMeta) {
                        bestMeta = m;
                    }
                }
            }

            if (bestMeta) {
                const found = {
                    name: bestMeta.name || q,
                    poster: bestMeta.poster || generateFallbackPoster(bestMeta.name || q),
                    backdrop: bestMeta.background || bestMeta.poster || null,
                    description: bestMeta.description || "Disponible dans votre Cloud Cinécloud.",
                    imdbId: bestMeta.imdb_id || bestMeta.id,
                    year: bestMeta.year || null,
                    tmdbId: null
                };
                cinemetaCache.set(ck, found);
                return found;
            }
        }

        // Passerelle de résolution Anime via Kitsu et anime-lists si aucun résultat direct
        const isAnimeHeuristic =
            /\b(anime|vostfr|fansub|manga|oav|ova)\b/i.test(cleanName) ||
            /\b(no|ni|o|wa|ga|ka|ken|tensei|isekai|shukufuku|datta|motomeru)\b/i.test(cleanName) ||
            (altTitle && /\b(anime|vostfr|fansub)\b/i.test(altTitle));

        if (isAnimeHeuristic) {
            try {
                const { getAnimeMappingByKitsu, loadAnimeMapping } = require("./animeMapping");
                await loadAnimeMapping();
                const kitsuQuery = cleanName;
                const kitsuRes = await axios
                    .get(
                        `https://kitsu.io/api/edge/anime?filter[text]=${encodeURIComponent(kitsuQuery)}&page[limit]=1`,
                        {
                            headers: { Accept: "application/vnd.api+json" },
                            timeout: 2500
                        }
                    )
                    .catch(() => null);
                const kItem = kitsuRes?.data?.data?.[0];
                if (kItem && kItem.id) {
                    const kitsuId = parseInt(kItem.id, 10);
                    const mapping = getAnimeMappingByKitsu(kitsuId);
                    if (mapping && mapping.imdbId) {
                        const cinMetaRes = await axios
                            .get(`https://v3-cinemeta.strem.io/meta/${cType}/${mapping.imdbId}.json`, { timeout: 3000 })
                            .catch(() => null);
                        const cm = cinMetaRes?.data?.meta;
                        if (cm) {
                            const found = {
                                name: cm.name || kItem.attributes?.canonicalTitle || cleanName,
                                poster: cm.poster || generateFallbackPoster(cleanName),
                                backdrop: cm.background || cm.poster || null,
                                description: cm.description || "Disponible dans votre Cloud Cinécloud.",
                                imdbId: mapping.imdbId,
                                year: cm.year || null,
                                tmdbId: mapping.tmdbId || null
                            };
                            cinemetaCache.set(ck, found);
                            return found;
                        }
                    }
                }
            } catch (e) {}
        }
    } catch (e) {
        // Ignorer silencieusement
    }
    cinemetaCache.set(`${type === "series" ? "series" : "movie"}__${cleanName}__${expectedYear || ""}`, null);
    return null;
}

async function getTmdbMetadata(filename, type, tmdbKey, detailed = false) {
    let cleanName = "";
    let year = null;
    let altTitle = null;
    try {
        const extracted = extractCleanTitle(filename);
        cleanName = extracted.title;
        year = extracted.year;
        altTitle = extracted.altTitle;

        if (!cleanName || cleanName.length < 2) {
            throw new Error("Nom de fichier trop court ou non significatif");
        }

        if (invalidTmdbKeys.has(tmdbKey)) {
            throw new Error("Clé TMDB invalide ou non autorisée");
        }

        const tmdbType = type === "movie" ? "movie" : "tv";
        const queriesToTry = [cleanName];
        if (altTitle && altTitle.trim() && altTitle.trim().toLowerCase() !== cleanName.trim().toLowerCase()) {
            queriesToTry.push(altTitle.trim());
        }

        let bestCandidate = null;
        let bestName = "";

        for (const currentQuery of queriesToTry) {
            const yearParam = year ? `&${type === "movie" ? "year" : "first_air_date_year"}=${year}` : "";
            const url = `https://api.themoviedb.org/3/search/${tmdbType}?api_key=${tmdbKey}&query=${encodeURIComponent(currentQuery)}${yearParam}&language=fr-FR`;
            let res = await axios.get(url, { timeout: 4000 }).catch(() => null);

            if ((!res || !res.data || !res.data.results || res.data.results.length === 0) && year) {
                const urlNoYear = `https://api.themoviedb.org/3/search/${tmdbType}?api_key=${tmdbKey}&query=${encodeURIComponent(currentQuery)}&language=fr-FR`;
                res = await axios.get(urlNoYear, { timeout: 6000 }).catch(() => null);
            }

            if (!res || !res.data || !res.data.results || res.data.results.length === 0) {
                const shortened = currentQuery.split(" ").slice(0, 3).join(" ");
                if (shortened && shortened !== currentQuery && shortened.length >= 3) {
                    const urlShort = `https://api.themoviedb.org/3/search/${tmdbType}?api_key=${tmdbKey}&query=${encodeURIComponent(shortened)}&language=fr-FR`;
                    res = await axios.get(urlShort, { timeout: 6000 }).catch(() => res);
                }
            }

            if (res && res.data && Array.isArray(res.data.results) && res.data.results.length > 0) {
                const candidates = res.data.results.slice(0, 8);
                for (const cand of candidates) {
                    const cTitleFr = cand.title || cand.name || "";
                    const cTitleOrig = cand.original_title || cand.original_name || "";
                    const candYear = (cand.release_date || cand.first_air_date || "").slice(0, 4);

                    const matchFr =
                        isConfidentTitleMatch(currentQuery, cTitleFr, year, candYear) ||
                        isConfidentTitleMatch(cleanName, cTitleFr, year, candYear);
                    const matchOrig =
                        isConfidentTitleMatch(currentQuery, cTitleOrig, year, candYear) ||
                        isConfidentTitleMatch(cleanName, cTitleOrig, year, candYear);

                    if (matchFr || matchOrig) {
                        const resolvedName = cTitleFr || cTitleOrig;
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
            }

            if (bestCandidate) break;
        }

        if (bestCandidate) {
            let cast = [];
            let genreNames = [];
            if (detailed) {
                try {
                    const detailUrl = `https://api.themoviedb.org/3/${tmdbType}/${encodeURIComponent(bestCandidate.id)}?api_key=${tmdbKey}&language=fr-FR&append_to_response=credits`;
                    const detailRes = await axios.get(detailUrl, { timeout: 6000 });
                    if (detailRes.data) {
                        genreNames = (detailRes.data.genres || []).map(g => g.name);
                        cast = ((detailRes.data.credits && detailRes.data.credits.cast) || [])
                            .slice(0, 8)
                            .map(c => c.name);
                    }
                } catch (e) {}
            }

            return {
                name: bestName,
                poster: bestCandidate.poster_path
                    ? `https://image.tmdb.org/t/p/w500${bestCandidate.poster_path}`
                    : generateFallbackPoster(bestName),
                backdrop: bestCandidate.backdrop_path
                    ? `https://image.tmdb.org/t/p/w1280${bestCandidate.backdrop_path}`
                    : bestCandidate.poster_path
                      ? `https://image.tmdb.org/t/p/w500${bestCandidate.poster_path}`
                      : generateFallbackPoster(bestName),
                description: bestCandidate.overview || "Disponible dans votre Cloud Cinécloud.",
                genreIds: bestCandidate.genre_ids || [],
                genres: genreNames,
                cast: cast,
                imdbRating: bestCandidate.vote_average ? bestCandidate.vote_average.toFixed(1) : null,
                tmdbId: bestCandidate.id
            };
        }
    } catch (e) {
        if (e.response && (e.response.status === 401 || e.response.status === 403)) {
            invalidTmdbKeys.add(tmdbKey);
        }
        // En cas d'erreur TMDB, repli vers Cinemeta
    }

    // Repli de secours sur Cinemeta avec contrôle de conformité
    const cinemetaResult = await searchCinemeta(cleanName, type, year, altTitle);
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

const tmdbToImdbCache = makeLRU(2000, 3_600_000);
const imdbToTitleCache = makeLRU(2000, 3_600_000);

async function tmdbToImdbId(tmdbId, type, tmdbKey) {
    if (!tmdbId) return null;
    const tmdbType = type === "movie" ? "movie" : "tv";
    const cacheKey = `${tmdbType}_${tmdbId}`;
    if (tmdbToImdbCache.has(cacheKey)) {
        return tmdbToImdbCache.get(cacheKey);
    }
    try {
        const effectiveTmdbKey = tmdbKey && tmdbKey !== "default" ? tmdbKey : TMDB_KEY_DEFAULT;
        const url = `https://api.themoviedb.org/3/${tmdbType}/${encodeURIComponent(tmdbId)}/external_ids?api_key=${effectiveTmdbKey}`;
        const res = await axios.get(url, { timeout: 4000 });
        const imdbId = res.data && res.data.imdb_id ? res.data.imdb_id : null;
        if (imdbId) {
            tmdbToImdbCache.set(cacheKey, imdbId);
        }
        return imdbId;
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
    const cacheKey = `${cleanId}_${isSeries ? "series" : "movie"}`;
    if (imdbToTitleCache.has(cacheKey)) {
        return imdbToTitleCache.get(cacheKey);
    }

    let result = null;
    const hasCustomTmdbKey = isCustomTmdbKey(tmdbKey);

    if (hasCustomTmdbKey) {
        try {
            const url = `https://api.themoviedb.org/3/find/${encodeURIComponent(cleanId)}?api_key=${tmdbKey}&external_source=imdb_id&language=fr-FR`;
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
                result = { title: primary, altTitle: alt, year };
            } else if (movie && !isSeries) {
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
                result = { title: primary, altTitle: alt, year };
            } else if (tv) {
                const year = (tv.first_air_date || "").slice(0, 4) || null;
                const p = (!hasNonLatinCharacters(tv.name) ? tv.name : null) || tv.original_name;
                result = { title: p, altTitle: tv.original_name !== p ? tv.original_name : null, year };
            } else if (movie) {
                const year = (movie.release_date || "").slice(0, 4) || null;
                const p = (!hasNonLatinCharacters(movie.title) ? movie.title : null) || movie.original_title;
                result = { title: p, altTitle: movie.original_title !== p ? movie.original_title : null, year };
            }
        } catch (e) {
            if (e.response && (e.response.status === 401 || e.response.status === 403)) {
                invalidTmdbKeys.add(tmdbKey);
            }
        }
    }

    if (!result) {
        const cinemetaTypes = isSeries ? ["series", "movie"] : ["movie", "series"];
        for (const cType of cinemetaTypes) {
            try {
                const cinemetaUrl = `https://v3-cinemeta.strem.io/meta/${cType}/${encodeURIComponent(cleanId)}.json`;
                const res = await axios.get(cinemetaUrl, { timeout: 4000 });
                if (res.data && res.data.meta && res.data.meta.name) {
                    let primary = res.data.meta.name;
                    let alt = null;
                    if (hasNonLatinCharacters(primary) && res.data.meta.slug) {
                        const slugPart = res.data.meta.slug.replace(/^(movie|series)\//, "").replace(/-\d+$/, "");
                        const reconstructed = slugPart
                            .split("-")
                            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                            .join(" ");
                        if (reconstructed && !hasNonLatinCharacters(reconstructed)) {
                            alt = primary;
                            primary = reconstructed;
                        }
                    }
                    result = { title: primary, altTitle: alt, year: res.data.meta.year || null };
                    break;
                }
            } catch (e) {}
        }
    }

    const finalResult = result || { title: null, altTitle: null, year: null };
    if (finalResult.title) {
        imdbToTitleCache.set(cacheKey, finalResult);
    }
    return finalResult;
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
    const hasCustomTmdbKey = isCustomTmdbKey(tmdbKey);
    if (hasCustomTmdbKey) {
        try {
            const url = `https://api.themoviedb.org/3/find/${encodeURIComponent(cleanId)}?api_key=${tmdbKey}&external_source=imdb_id&language=fr-FR`;
            const res = await axios.get(url, { timeout: 3500 });
            const item = res.data?.movie_results?.[0] || res.data?.tv_results?.[0];
            const frTitle = item?.title || item?.name;
            if (frTitle && frTitle.trim() && !hasNonLatinCharacters(frTitle.trim())) {
                frenchTitleCache.set(cleanId, frTitle.trim());
                return frTitle.trim();
            }
        } catch (e) {}
    }

    // 2. Requête Wikidata SPARQL par IMDb ID (gratuit, sans clé API, ultra-rapide)
    //    — uniquement si cleanId est un IMDb ID valide (prévention injection SPARQL)
    if (isImdbId(cleanId)) {
        try {
            const sparql = `SELECT ?itemLabel WHERE { ?item wdt:P345 "${cleanId}". SERVICE wikibase:label { bd:serviceParam wikibase:language "fr". } } LIMIT 1`;
            const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`;
            const res = await axios.get(url, {
                headers: { "User-Agent": "Cinecloud/1.0 (contact@cinecloud.fr)", Accept: "application/json" },
                timeout: 3500
            });
            const label = res.data?.results?.bindings?.[0]?.itemLabel?.value;
            if (label && !/^Q\d+$/.test(label) && label.trim().length > 1 && !hasNonLatinCharacters(label.trim())) {
                frenchTitleCache.set(cleanId, label.trim());
                return label.trim();
            }
        } catch (e) {}
    }

    const safeFallback = fallbackTitle && !hasNonLatinCharacters(fallbackTitle) ? fallbackTitle : "";
    frenchTitleCache.set(cleanId, safeFallback);
    return safeFallback;
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
        const title =
            kitsuDetails.canonicalTitle || kitsuDetails.titleRomaji || kitsuDetails.titleEn || `Anime (${baseId})`;
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
        const cType = type === "movie" ? "movie" : "series";
        const url = `https://anime-kitsu.strem.fun/meta/${cType}/kitsu:${encodeURIComponent(baseId)}.json`;
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
    seeders = 0,
    provider = "Cinécloud",
    indexer = null,
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
    if (hasVf || hasMulti) langFlags.push("🇫🇷");
    if (hasMulti) langFlags.push("🌐");
    if (hasDual && !hasMulti) langFlags.push("Dual Audio");
    if (hasJap) langFlags.push("🇯🇵");
    if (hasEng && !hasVf && !hasMulti) langFlags.push("🇬🇧");

    // Résolution propre sans FR SUB ni FR Dub
    const resLine = resBadge === "4K" || resBadge === "1080p" ? `${resBadge} ⭐` : resBadge;

    // 3. Qualité & Source vidéo
    let quality = "";
    if (/\b(bdremux|bluray[\.\- ]?remux|remux)\b/i.test(raw)) quality = "BluRay REMUX";
    else if (/\b(bluray|bdrip|brrip)\b/i.test(raw)) quality = "BluRay";
    else if (/\b(web[\.\-]?dl)\b/i.test(raw)) quality = "WEB-DL";
    else if (/\b(webrip)\b/i.test(raw)) quality = "WEBRip";
    else if (/\b(web)\b/i.test(raw)) quality = "WEB-DL";
    else if (/\b(hdlight)\b/i.test(raw)) quality = "HDLight";
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
    const videoLine = videoParts.length ? "🎬 " + videoParts.join(" • ") : "";

    // 6. Taille & Audio
    let sizeStr = "";
    const effectiveSizeBytes =
        sizeBytes && !isNaN(sizeBytes) && Number(sizeBytes) > 0 ? Number(sizeBytes) : parseSizeFromString(raw);
    if (effectiveSizeBytes > 0) {
        const gb = effectiveSizeBytes / (1024 * 1024 * 1024);
        if (gb >= 1) sizeStr = `${gb.toFixed(1)} GB`;
        else sizeStr = `${(effectiveSizeBytes / (1024 * 1024)).toFixed(0)} MB`;
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
    if (
        groupMatch &&
        groupMatch[1].length < 20 &&
        !/^(mkv|mp4|avi|1080p|720p|hevc|x264|web|bluray)$/i.test(groupMatch[1])
    ) {
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
    const isTorbox =
        String(debridProvider).toLowerCase() === "torbox" ||
        String(provider).toLowerCase() === "torbox" ||
        Boolean(statusTag && statusTag.startsWith("[TB"));
    const debridTag = isTorbox ? "TB" : "AD";
    const debridName = isTorbox ? "Torbox" : "AllDebrid";

    // Détection si flux Cloud
    const isCloudSource = Boolean(
        cacheType === "cloud" ||
        isCloud ||
        indexer === "Mon Cloud" ||
        provider === "Mon Cloud" ||
        (indexer && indexer.toLowerCase().includes("cloud"))
    );

    // Détection si flux de téléchargement explicite (ex: pré-validé comme non en cache)
    const isExplicitDownload = Boolean(
        !isInstant && (cacheType === "download" || (subtitle && subtitle.startsWith("⏳ ")))
    );

    // Détection Prowlarr en direct / pré-cache non confirmé
    const isProwlarrDirect = Boolean(
        !isInstant &&
        !isTorbox &&
        !isExplicitDownload &&
        (cacheType === "direct" ||
            cacheType === "global" ||
            cacheType === "precache" ||
            (indexer && (indexer.includes("Prowlarr") || indexer.startsWith("🔍"))))
    );

    // Badge gauche : ⚡ (instantané), 🔍 (recherche Prowlarr non confirmée) ou ⏳ (téléchargement)
    const statusIcon = isInstant ? "⚡" : isProwlarrDirect ? "🔍" : "⏳";
    let computedStatusTag = statusTag;
    if (!computedStatusTag) {
        if (isProwlarrDirect) {
            computedStatusTag = `[${debridTag} 🔍]`;
        } else if (!isInstant) {
            computedStatusTag = `[${debridTag} ⏳]`;
        } else if (cacheType === "precache") {
            computedStatusTag = `[${debridTag} ⚡ Pré-cache]`;
        } else if (cacheType === "global") {
            computedStatusTag = `[${debridTag} ⚡ Cache Global]`;
        } else if (cacheType === "direct") {
            computedStatusTag = `[${debridTag} ⚡ Direct]`;
        } else if (cacheType === "lumio") {
            computedStatusTag = `[${debridTag} ⚡ Lumio]`;
        } else if (cacheType === "cloud" || isCloudSource) {
            computedStatusTag = `[${debridTag} ⚡ Cloud]`;
        } else {
            computedStatusTag = `[${debridTag} ${statusIcon}]`;
        }
    }
    // Colonne gauche épurée : [AD ⚡ Cloud] / [TB ⚡ Cloud] suivi de la résolution
    const name = [computedStatusTag, resLine].filter(Boolean).join("\n");

    // Lignes de droite : provenance / source & statut de cache
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
    } else if (cacheType === "torrentio" || provider === "Torrentio" || (indexer && indexer.startsWith("Torrentio"))) {
        const sub = indexer && indexer.includes("|") ? indexer.split("|")[1].trim() : "";
        sourceLine = sub ? `🚀 Torrentio (${sub})` : "🚀 Torrentio";
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
    if (
        isCloudSource &&
        isInstant &&
        (!subtitle || subtitle === "Résolution instantanée" || subtitle.includes("disponible dans votre compte"))
    ) {
        statusLine = "⚡ Lecture immédiate";
    } else if (subtitle) {
        if (subtitle.startsWith("⚡ ") || subtitle.startsWith("⏳ ") || subtitle.startsWith("🔍 ")) {
            statusLine = subtitle;
        } else {
            statusLine = `${statusIcon} ${subtitle}`;
        }
    } else if (isProwlarrDirect) {
        statusLine = seeders
            ? `🔍 Recherche Prowlarr (${seeders} seeders) • Vérif. cache au clic`
            : "🔍 Recherche Prowlarr • Vérif. cache au clic";
    } else if (!isInstant) {
        statusLine = `⏳ En téléchargement ${debridName}`;
    } else if (isCloudSource) {
        statusLine = "⚡ Lecture immédiate";
    } else if (cacheType === "precache") {
        statusLine = `⚡ Pré-cache RSS • ${debridName}`;
    } else if (cacheType === "global") {
        statusLine = "⚡ Cache Global (Mutualisé)";
    } else if (cacheType === "direct") {
        statusLine = "⚡ Recherche Prowlarr Directe";
    } else if (cacheType === "lumio") {
        statusLine = `⚡ Instantané Lumio • ${debridName}`;
    } else if (cacheType === "torrentio") {
        statusLine = `⚡ Instantané Torrentio • ${debridName}`;
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
        _size: effectiveSizeBytes,
        _rawFilename: raw,
        _isInstant: isInstant,
        _seeders: Number(seeders) || 0,
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
    isCustomTmdbKey,
    isImdbId,
    ALL_CATALOGS,
    flattenFiles,
    isRealVideoFile,
    isExcludedArtifact,
    isCompleteSeriesPack,
    formatSize,
    parseSizeFromString,
    detectLangTag,
    detectResolutionTag,
    pickBestReleaseFilename,
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
    buildAnimeSeasonOffsets,
    cleanUrlAndDomainPrefix,
    NON_VIDEO_EXT_RE,
    SAMPLE_BONUS_RE,
    COMPLETE_PACK_RE,
    ERROR_PATTERNS_RE,
    makeLRU,
    isObfuscated
};
