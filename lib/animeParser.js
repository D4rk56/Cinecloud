"use strict";

/**
 * @file animeParser.js
 * @description Module de parsing et de normalisation de titres d'animes pour Stremio.
 * Utilise @iktakahiro/anitomy-js (anitomy-js) avec isolation try/catch contre les crashs natifs C++,
 * et bascule sur un parser regex robuste de secours en cas d'erreur ou d'échec.
 */

let anitomy = null;
try {
    anitomy = require("anitomy-js");
} catch (err) {
    console.warn("[AnimeParser] Avertissement : anitomy-js non disponible, bascule sur le parser regex de secours.", err.message);
}

const stringSimilarity = require("string-similarity");

/**
 * Expression régulière pour la validation des noms de fichiers (sanitization anti-DoS / injection)
 */
const MAX_FILENAME_LENGTH = 500;

/**
 * @typedef {Object} ParsedAnime
 * @property {boolean} success - Indique si le parsing a réussi
 * @property {string} raw - Nom de fichier ou titre brut en entrée
 * @property {string} title - Titre nettoyé de l'anime (ex: "Jujutsu Kaisen 2nd Season")
 * @property {string} baseTitle - Titre de base sans suffixe de saison/partie (ex: "Jujutsu Kaisen")
 * @property {string|null} releaseGroup - Groupe de release (ex: "SubsPlease", "Erai-raws")
 * @property {number} season - Numéro de saison détecté (défaut: 1)
 * @property {number|null} episode - Numéro de l'épisode (ex: 5 ou 139)
 * @property {number|null} episodeEnd - Numéro de fin si batch/intervalle (ex: 12 pour 01-12)
 * @property {string|null} episodeRaw - Chaîne brute de l'épisode (ex: "05", "139")
 * @property {string|null} resolution - Résolution vidéo (ex: "1080p", "720p", "2160p")
 * @property {string|null} videoTerm - Codec ou terme vidéo (ex: "HEVC", "x264", "x265")
 * @property {string|null} audioTerm - Terme audio (ex: "AAC", "FLAC", "Opus")
 * @property {string|null} fileExtension - Extension du fichier (ex: "mkv", "mp4")
 * @property {boolean} isBatch - Indique s'il s'agit d'un pack de plusieurs épisodes
 * @property {boolean} isMovie - Indique s'il s'agit d'un film ou format spécial
 * @property {"anitomy"|"fallback"} parser - Nom du parser ayant produit le résultat
 */

/**
 * Nettoie et sécurise une chaîne de caractères en entrée avant tout traitement.
 * @param {string} input - Chaîne à assainir
 * @returns {string} Chaîne nettoyée et tronquée si nécessaire
 */
function sanitizeInput(input) {
    if (typeof input !== "string") return "";
    // Tronquer les chaînes anormalement longues (prévention ReDoS / DoS mémoire)
    let s = input.slice(0, MAX_FILENAME_LENGTH);
    // Supprimer les caractères de contrôle non imprimables
    s = s.replace(/[\x00-\x1F\x7F-\x9F]/g, " ");
    return s.trim();
}

/**
 * Détecte les faux positifs de saison directement intégrés au nom de l'anime
 * (ex: "2nd Season", "Season 2", "The Final Season Part 2", "Cour 2").
 * @param {string} title - Titre à analyser
 * @returns {{ detectedSeason: number|null, baseTitle: string }}
 */
function extractSeasonModifiers(title) {
    if (!title || typeof title !== "string") {
        return { detectedSeason: null, baseTitle: "" };
    }

    let detectedSeason = null;
    let base = title;

    // Patterns de saisons ordinales ou cardinales dans le titre
    const seasonPatterns = [
        // "2nd Season", "3rd Season", "4th Season", etc.
        { regex: /\b(\d{1,2})(?:st|nd|rd|th|ère|eme)?\s+Season\b/i, handler: m => parseInt(m[1], 10) },
        // "Season 2", "Saison 2"
        { regex: /\b(?:Season|Saison)\s+(\d{1,2})\b/i, handler: m => parseInt(m[1], 10) },
        // "Final Season Part 2" -> Saison 4 / Saison finale partie 2
        { regex: /\bFinal\s+Season\s+Part\s+(\d{1,2})\b/i, handler: () => 4 },
        // "Final Season"
        { regex: /\bFinal\s+Season\b/i, handler: () => 4 },
        // "Part 2", "Partie 2"
        { regex: /\b(?:Part|Partie)\s+(\d{1,2})\b/i, handler: m => parseInt(m[1], 10) },
        // "Cour 2"
        { regex: /\bCour\s+(\d{1,2})\b/i, handler: m => parseInt(m[1], 10) },
        // "S2", "S02" isolé
        { regex: /\bS(\d{1,2})\b/i, handler: m => parseInt(m[1], 10) }
    ];

    for (const pat of seasonPatterns) {
        const match = base.match(pat.regex);
        if (match) {
            if (detectedSeason === null) {
                detectedSeason = pat.handler(match);
            }
            // Retirer le motif pour extraire le titre de base
            base = base.replace(pat.regex, " ").replace(/\s{2,}/g, " ").trim();
        }
    }

    // Nettoyer les tirets orphelins en fin de titre
    base = base.replace(/[\s\-_:–—]+$/, "").trim();

    return {
        detectedSeason,
        baseTitle: base || title
    };
}

/**
 * Parser de secours purement JavaScript basé sur des expressions régulières sécurisées.
 * Utilisé si Anitomy plante, n'est pas compilé ou échoue sur un nom de fichier malformé.
 * @param {string} raw - Nom de fichier brut
 * @returns {ParsedAnime} Résultat normalisé
 */
function parseAnimeTitleFallback(raw) {
    const clean = sanitizeInput(raw);
    if (!clean) {
        return {
            success: false,
            raw: "",
            title: "",
            baseTitle: "",
            releaseGroup: null,
            season: 1,
            episode: null,
            episodeEnd: null,
            episodeRaw: null,
            resolution: null,
            videoTerm: null,
            audioTerm: null,
            fileExtension: null,
            isBatch: false,
            isMovie: false,
            parser: "fallback"
        };
    }

    let working = clean;

    // 1. Extension de fichier
    let fileExtension = null;
    const extMatch = working.match(/\.([a-z0-9]{2,4})$/i);
    if (extMatch) {
        fileExtension = extMatch[1].toLowerCase();
        working = working.slice(0, extMatch.index).trim();
    }

    // 2. Groupe de release (ex: [SubsPlease] ou [Erai-raws] en début ou fin)
    let releaseGroup = null;
    const leadGroupMatch = working.match(/^\[([^\]]+)\]/);
    if (leadGroupMatch) {
        releaseGroup = leadGroupMatch[1].trim();
        working = working.slice(leadGroupMatch[0].length).trim();
    } else {
        const trailGroupMatch = working.match(/-([A-Za-z0-9_-]+)$/);
        if (trailGroupMatch) {
            releaseGroup = trailGroupMatch[1].trim();
            working = working.slice(0, trailGroupMatch.index).trim();
        }
    }

    // 3. Résolution
    let resolution = null;
    const resMatch = working.match(/\b(2160p|1080p|720p|480p|4k|uhd)\b/i);
    if (resMatch) {
        resolution = resMatch[1].toLowerCase();
        working = working.replace(resMatch[0], " ");
    }

    // 4. Codec / Termes vidéo & audio
    let videoTerm = null;
    const vidMatch = working.match(/\b(hevc|x265|h265|x264|h264|av1|10bit|10-bit)\b/i);
    if (vidMatch) {
        videoTerm = vidMatch[1].toUpperCase();
        working = working.replace(vidMatch[0], " ");
    }

    let audioTerm = null;
    const audMatch = working.match(/\b(flac|aac|opus|dts|ac3|mp3)\b/i);
    if (audMatch) {
        audioTerm = audMatch[1].toUpperCase();
        working = working.replace(audMatch[0], " ");
    }

    // 5. Saison & Épisode
    let season = 1;
    let episode = null;
    let episodeEnd = null;
    let episodeRaw = null;
    let isBatch = false;

    // Détection d'un intervalle d'épisodes (batch ex: 01-12 ou 01~24)
    const batchMatch = working.match(/\b(\d{1,3})\s*(?:-|~)\s*(\d{1,3})\b/);
    if (batchMatch && parseInt(batchMatch[1], 10) < parseInt(batchMatch[2], 10)) {
        episode = parseInt(batchMatch[1], 10);
        episodeEnd = parseInt(batchMatch[2], 10);
        episodeRaw = `${batchMatch[1]}-${batchMatch[2]}`;
        isBatch = true;
        working = working.replace(batchMatch[0], " ");
    }

    // SxxExx standard (ex: S02E05)
    if (!episode) {
        const sxxExxMatch = working.match(/\bS(\d{1,2})\s*[\. -]?\s*E(\d{1,4})\b/i);
        if (sxxExxMatch) {
            season = parseInt(sxxExxMatch[1], 10);
            episode = parseInt(sxxExxMatch[2], 10);
            episodeRaw = sxxExxMatch[2];
            working = working.replace(sxxExxMatch[0], " ");
        }
    }

    // Séparateur tiret épisode standard pour animés (ex: " - 05" ou " - 139")
    if (!episode) {
        const dashEpMatch = working.match(/(?:^|\s)-\s*(\d{1,4})(?:v\d)?(?:\s|$)/);
        if (dashEpMatch) {
            episode = parseInt(dashEpMatch[1], 10);
            episodeRaw = dashEpMatch[1];
            working = working.replace(dashEpMatch[0], " ");
        }
    }

    // Mot-clé "Episode 05" ou "Ep 05"
    if (!episode) {
        const epWordMatch = working.match(/\b(?:Ep(?:isode)?|Ép(?:isode)?)\s*[\.#-]?\s*(\d{1,4})\b/i);
        if (epWordMatch) {
            episode = parseInt(epWordMatch[1], 10);
            episodeRaw = epWordMatch[1];
            working = working.replace(epWordMatch[0], " ");
        }
    }

    // Détection de film / OVA
    const isMovie = /\b(movie|film|gekijouban|ova|oad|special)\b/i.test(clean);

    // Nettoyer les balises restantes entre crochets ou parenthèses
    working = working.replace(/\[[^\]]*\]/g, " ").replace(/\([^\)]*\)/g, " ");
    // Remplacer les points et underscores par des espaces
    working = working.replace(/[\._]+/g, " ");
    // Nettoyer les espaces multiples
    let title = working.replace(/\s{2,}/g, " ").trim();

    // Détection des faux positifs de saison dans le titre
    const { detectedSeason, baseTitle } = extractSeasonModifiers(title);
    if (detectedSeason && season === 1) {
        season = detectedSeason;
    }

    return {
        success: Boolean(title || episode !== null),
        raw: clean,
        title: title || clean,
        baseTitle: baseTitle || title || clean,
        releaseGroup,
        season,
        episode,
        episodeEnd,
        episodeRaw,
        resolution,
        videoTerm,
        audioTerm,
        fileExtension,
        isBatch,
        isMovie,
        parser: "fallback"
    };
}

/**
 * Parse un nom de release ou de fichier torrent anime en extrayant proprement
 * le titre, le groupe de release, la saison et le numéro d'épisode.
 * Utilise Anitomy (anitomy-js) avec bloc try/catch sécurisé, et bascule sur le parser fallback en cas d'erreur.
 *
 * @param {string} filename - Nom brut de la release ou du fichier torrent
 * @returns {ParsedAnime} Métadonnées extraites et normalisées
 *
 * @example
 * const res = parseAnimeTitle("[SubsPlease] Boku no Hero Academia - 139 (1080p) [ABCD1234].mkv");
 * console.log(res.title); // "Boku no Hero Academia"
 * console.log(res.episode); // 139
 * console.log(res.releaseGroup); // "SubsPlease"
 */
function parseAnimeTitle(filename) {
    const cleanInput = sanitizeInput(filename);
    if (!cleanInput) {
        return parseAnimeTitleFallback("");
    }

    // Tentative avec Anitomy
    if (anitomy && typeof anitomy.parseSync === "function") {
        try {
            const rawParsed = anitomy.parseSync(cleanInput);
            if (rawParsed && typeof rawParsed === "object" && (rawParsed.anime_title || rawParsed.episode_number)) {
                const title = (rawParsed.anime_title || "").trim();
                const releaseGroup = rawParsed.release_group || null;

                // Parsing saison
                let season = 1;
                if (rawParsed.anime_season) {
                    const parsedSeason = parseInt(rawParsed.anime_season, 10);
                    if (!isNaN(parsedSeason) && parsedSeason > 0) {
                        season = parsedSeason;
                    }
                }

                // Détection des faux positifs de saison dans le titre de l'anime
                const { detectedSeason, baseTitle } = extractSeasonModifiers(title);
                if (detectedSeason && season === 1) {
                    season = detectedSeason;
                }

                // Parsing épisode
                let episode = null;
                let episodeEnd = null;
                let episodeRaw = null;
                let isBatch = false;

                if (Array.isArray(rawParsed.episode_number)) {
                    const arr = rawParsed.episode_number.map(x => parseInt(String(x).trim(), 10)).filter(x => !isNaN(x));
                    if (arr.length > 0) {
                        episode = arr[0];
                        if (arr.length > 1) {
                            episodeEnd = arr[arr.length - 1];
                            isBatch = true;
                        }
                        episodeRaw = rawParsed.episode_number.join("-");
                    }
                } else if (rawParsed.episode_number) {
                    episodeRaw = String(rawParsed.episode_number).trim();
                    // Gestion des plages d'épisodes (ex: "01-12")
                    if (episodeRaw.includes("-") || episodeRaw.includes("~") || episodeRaw.includes(",")) {
                        const parts = episodeRaw.split(/[-~,]/).map(p => parseInt(p.trim(), 10));
                        if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[parts.length - 1])) {
                            episode = parts[0];
                            episodeEnd = parts[parts.length - 1];
                            isBatch = true;
                        }
                    } else {
                        const epInt = parseInt(episodeRaw, 10);
                        if (!isNaN(epInt)) {
                            episode = epInt;
                        }
                    }
                }

                const resolution = rawParsed.video_resolution || null;
                const videoTerm = rawParsed.video_term || null;
                const audioTerm = rawParsed.audio_term || null;
                const fileExtension = rawParsed.file_extension || null;
                const isMovie = (rawParsed.anime_type && /movie|film/i.test(rawParsed.anime_type)) ||
                                /\b(movie|film|gekijouban)\b/i.test(cleanInput);

                return {
                    success: true,
                    raw: cleanInput,
                    title: title || cleanInput,
                    baseTitle: baseTitle || title || cleanInput,
                    releaseGroup,
                    season,
                    episode,
                    episodeEnd,
                    episodeRaw,
                    resolution,
                    videoTerm,
                    audioTerm,
                    fileExtension,
                    isBatch,
                    isMovie: Boolean(isMovie),
                    parser: "anitomy"
                };
            }
        } catch (anitomyErr) {
            console.warn(`[AnimeParser] Erreur Anitomy sur "${cleanInput.slice(0, 60)}" :`, anitomyErr.message);
            // Poursuite sécurisée vers le parser de secours
        }
    }

    // Bascule transparente vers le parser de secours
    return parseAnimeTitleFallback(cleanInput);
}

/**
 * Normalise un titre d'anime pour le matching textuel et fuzzy :
 * - Suppression des métadonnées entre crochets/parenthèses (TV, 1080p, année)
 * - Conversion des caractères pleine chasse japonais (Fullwidth to Halfwidth ASCII)
 * - Normalisation Unicode NFKD et suppression des accents/diacritiques
 * - Normalisation des voyelles longues romaji (ō -> ou/o, ū -> uu/u)
 * - Suppression des caractères spéciaux et ponctuation
 * - Passage en minuscules et espaces uniques
 *
 * @param {string} title - Titre à normaliser
 * @returns {string} Titre normalisé
 */
function normalizeAnimeTitle(title) {
    if (!title || typeof title !== "string") return "";

    let s = title.trim();

    // 1. Conversion Fullwidth -> Halfwidth (ex: caractères japonais Ａ-Ｚ vers A-Z, １-９ vers 1-9)
    s = s.replace(/[\uff01-\uff5e]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
    s = s.replace(/\u3000/g, " ");

    // 2. Normalisation des macrons japonais romaji (ex: Shingeki no Kyōjin -> Shingeki no Kyojin / Kyō -> Kyou)
    s = s.replace(/[ōŌ]/g, "o")
         .replace(/[ūŪ]/g, "u")
         .replace(/[āĀ]/g, "a")
         .replace(/[ēĒ]/g, "e")
         .replace(/[īĪ]/g, "i");

    // 3. Normalisation Unicode NFKD et suppression des diacritiques
    s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

    // 4. Suppression des balises de métadonnées communes [1080p], (TV), (2023), etc.
    s = s.replace(/\[[^\]]*\]/g, " ");
    s = s.replace(/\((?:19|20)\d{2}\)/g, " "); // années (2021)
    s = s.replace(/\((?:tv|bd|web|ova|oad|movie|film)\)/gi, " ");

    // 5. Suppression de la ponctuation et des caractères spéciaux (conserve les caractères alphanumériques et CJK)
    s = s.replace(/['’`´]/g, ""); // apostrophes collées (ex: Attack's -> Attacks)
    s = s.replace(/[^\p{L}\p{N}\s]/gu, " ");

    // 6. Minuscules et espaces
    s = s.toLowerCase().replace(/\s{2,}/g, " ").trim();

    return s;
}

/**
 * Compare un titre candidat brut avec un titre officiel de référence et sa liste d'alias/synonymes.
 * Utilise string-similarity avec seuil ajustable (par défaut 0.82) après normalisation stricte.
 *
 * @param {string} candidateTitle - Titre candidat (ex: extrait d'un torrent)
 * @param {string} referenceTitle - Titre officiel de l'anime (ex: Kitsu, Cinemeta, TMDB)
 * @param {string[]} [aliases=[]] - Liste de synonymes / titres alternatifs (ex: romaji, anglais, abréviations)
 * @param {number} [threshold=0.82] - Seuil de similarité (0 à 1, default: 0.82)
 * @returns {{ isMatch: boolean, similarity: number, matchedAlias: string|null, threshold: number }}
 *
 * @example
 * const res = isAnimeTitleMatch("Shingeki no Kyojin", "Attack on Titan", ["Shingeki no Kyojin", "AoT"]);
 * console.log(res.isMatch); // true
 */
function isAnimeTitleMatch(candidateTitle, referenceTitle, aliases = [], threshold = 0.82) {
    const normCandidate = normalizeAnimeTitle(candidateTitle);
    const normRef = normalizeAnimeTitle(referenceTitle);

    if (!normCandidate || (!normRef && (!Array.isArray(aliases) || aliases.length === 0))) {
        return { isMatch: false, similarity: 0, matchedAlias: null, threshold };
    }

    // 1. Correspondance exacte directe avec le titre de référence
    if (normCandidate === normRef) {
        return { isMatch: true, similarity: 1.0, matchedAlias: referenceTitle, threshold };
    }

    // 2. Correspondance exacte avec l'un des alias
    const safeAliases = Array.isArray(aliases) ? aliases.filter(a => typeof a === "string" && a.trim()) : [];
    for (const alias of safeAliases) {
        const normAlias = normalizeAnimeTitle(alias);
        if (normAlias && normCandidate === normAlias) {
            return { isMatch: true, similarity: 1.0, matchedAlias: alias, threshold };
        }
    }

    // 3. Calcul de similarité floue (string-similarity)
    let bestSimilarity = 0;
    let bestAlias = null;

    if (normRef) {
        try {
            bestSimilarity = stringSimilarity.compareTwoStrings(normCandidate, normRef);
            bestAlias = referenceTitle;
        } catch (e) {
            bestSimilarity = 0;
        }
    }

    for (const alias of safeAliases) {
        const normAlias = normalizeAnimeTitle(alias);
        if (!normAlias) continue;
        try {
            const sim = stringSimilarity.compareTwoStrings(normCandidate, normAlias);
            if (sim > bestSimilarity) {
                bestSimilarity = sim;
                bestAlias = alias;
            }
        } catch (e) {}
    }

    // 4. Tolérance pour les titres composés ou sous-titres (ex: "Jujutsu Kaisen: Shibuya Incident" contient "Jujutsu Kaisen")
    if (bestSimilarity < threshold) {
        const targets = [normRef, ...safeAliases.map(normalizeAnimeTitle)].filter(Boolean);
        for (const target of targets) {
            if (normCandidate.startsWith(target) || target.startsWith(normCandidate)) {
                const lenRatio = Math.min(normCandidate.length, target.length) / Math.max(normCandidate.length, target.length);
                if (lenRatio >= 0.65) {
                    const boostSim = Math.max(bestSimilarity, 0.85);
                    return { isMatch: true, similarity: boostSim, matchedAlias: bestAlias, threshold };
                }
            }
        }
    }

    return {
        isMatch: bestSimilarity >= threshold,
        similarity: parseFloat(bestSimilarity.toFixed(4)),
        matchedAlias: bestSimilarity >= threshold ? bestAlias : null,
        threshold
    };
}

/**
 * Gère la conversion et la correspondance entre numérotation absolue et saison/épisode.
 * Permet de mapper un épisode absolu (ex: Ep 30) vers son format saison (ex: S02E05) et vice-versa,
 * à l'aide d'une table d'offset ou de comptes d'épisodes par saison.
 *
 * @param {ParsedAnime|{ season?: number, episode: number }} parsed - Données d'épisode parsées
 * @param {Object.<number, number>|{ seasonOffsets?: Object.<number, number> }|number} [seasonOffsetMap={}] -
 *        Carte du nombre d'épisodes par saison { 1: 25, 2: 12, ... } ou décalage fixe.
 * @returns {{ season: number, episode: number, absoluteEpisode: number, isAbsolute: boolean }}
 *
 * @example
 * // Conversion S02E05 avec S1 = 25 épisodes -> Épisode absolu 30
 * const res = resolveEpisodeNumbering({ season: 2, episode: 5 }, { 1: 25, 2: 12 });
 * console.log(res.absoluteEpisode); // 30
 *
 * // Conversion Épisode absolu 30 avec S1 = 25 épisodes -> S02E05
 * const res2 = resolveEpisodeNumbering({ episode: 30 }, { 1: 25, 2: 12 });
 * console.log(res2.season); // 2
 * console.log(res2.episode); // 5
 */
function resolveEpisodeNumbering(parsed, seasonOffsetMap = {}) {
    if (!parsed || parsed.episode === null || parsed.episode === undefined || isNaN(parsed.episode)) {
        return {
            season: parsed?.season || 1,
            episode: null,
            absoluteEpisode: null,
            isAbsolute: false
        };
    }

    const inputSeason = (parsed.season !== undefined && parsed.season !== null && !isNaN(parsed.season))
        ? parseInt(parsed.season, 10)
        : null;
    const inputEpisode = parseInt(parsed.episode, 10);

    // Cas 1: Décalage fixe (numérique direct)
    if (typeof seasonOffsetMap === "number") {
        const offset = seasonOffsetMap;
        if (inputSeason && inputSeason > 1) {
            return {
                season: inputSeason,
                episode: inputEpisode,
                absoluteEpisode: offset + inputEpisode,
                isAbsolute: false
            };
        }
        return {
            season: 1,
            episode: inputEpisode > offset ? (inputEpisode - offset) : inputEpisode,
            absoluteEpisode: inputEpisode,
            isAbsolute: true
        };
    }

    // Extraction de la carte des saisons { [saison]: nombreDEpisodes }
    let countsBySeason = {};
    if (seasonOffsetMap && typeof seasonOffsetMap === "object") {
        if (seasonOffsetMap.seasonOffsets && typeof seasonOffsetMap.seasonOffsets === "object") {
            countsBySeason = seasonOffsetMap.seasonOffsets;
        } else {
            countsBySeason = seasonOffsetMap;
        }
    }

    const availableSeasons = Object.keys(countsBySeason)
        .map(s => parseInt(s, 10))
        .filter(s => !isNaN(s) && s > 0)
        .sort((a, b) => a - b);

    // Si aucune information de décalage disponible
    if (availableSeasons.length === 0) {
        return {
            season: inputSeason || 1,
            episode: inputEpisode,
            absoluteEpisode: inputEpisode,
            isAbsolute: (inputSeason === null || inputSeason === 1) && inputEpisode > 26
        };
    }

    // Cas A : L'entrée a une saison explicite > 1 (ex: S02E05) -> Calculer l'épisode absolu
    if (inputSeason && inputSeason > 1) {
        let cumulativeOffset = 0;
        for (const s of availableSeasons) {
            if (s < inputSeason) {
                cumulativeOffset += (countsBySeason[s] || 0);
            }
        }
        return {
            season: inputSeason,
            episode: inputEpisode,
            absoluteEpisode: cumulativeOffset + inputEpisode,
            isAbsolute: false
        };
    }

    // Cas B : L'entrée a un numéro d'épisode potentiellement absolu (ex: Ep 30 sans saison ou saison 1)
    // On vérifie si l'épisode dépasse le total de la saison 1
    const s1Count = countsBySeason[1] || 0;
    if (s1Count > 0 && inputEpisode > s1Count) {
        let remaining = inputEpisode;
        let determinedSeason = 1;

        for (const s of availableSeasons) {
            const count = countsBySeason[s] || 0;
            if (remaining > count) {
                remaining -= count;
                determinedSeason = s + 1;
            } else {
                determinedSeason = s;
                break;
            }
        }

        return {
            season: determinedSeason,
            episode: remaining,
            absoluteEpisode: inputEpisode,
            isAbsolute: true
        };
    }

    // Épisode standard dans la première saison
    return {
        season: 1,
        episode: inputEpisode,
        absoluteEpisode: inputEpisode,
        isAbsolute: false
    };
}

module.exports = {
    parseAnimeTitle,
    parseAnimeTitleFallback,
    normalizeAnimeTitle,
    isAnimeTitleMatch,
    resolveEpisodeNumbering,
    sanitizeInput,
    extractSeasonModifiers
};
