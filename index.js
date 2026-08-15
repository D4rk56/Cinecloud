const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const app = express();
app.set("etag", false); // Désactive la génération d'ETag par Express (source de réponses 304 en cache observées)

// Charge manuellement .env (pm2 ne le fait pas tout seul, et pas de dépendance "dotenv" nécessaire pour ça)
(function loadEnvFile() {
    const envPath = path.join(__dirname, ".env");
    if (!fs.existsSync(envPath)) return;
    fs.readFileSync(envPath, "utf8").split("\n").forEach(line => {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (!match) return;
        const key = match[1];
        let value = (match[2] || "").trim().replace(/^["']|["']$/g, "");
        if (!(key in process.env)) process.env[key] = value;
    });
})();

// --- Cache local (fichier JSON sur disque, aucune base de données externe nécessaire) ---
// Mappe les vrais ids IMDb ("tt...") vers le contenu correspondant dans ton compte Alldebrid.
// Permet une intégration TMDB/Cinemeta/MDBList/autres addons native (posters, notes, casting,
// ET liens de tous tes autres addons installés) sans relancer une recherche TMDB à chaque clic.
const CACHE_DIR = path.join(__dirname, "data");
const CACHE_FILE = path.join(CACHE_DIR, "id-cache.json");

// Incrémenter à chaque fois que la logique de nettoyage de nom ou de classification change,
// pour forcer une réévaluation propre de tout ce qui a été mis en cache avec l'ancienne logique.
const CACHE_VERSION = 5;

function loadCache() {
    try {
        const cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
        if (cache.version !== CACHE_VERSION) {
            // Logique changée depuis : on repart d'un cache propre pour ce qui dépend du nettoyage
            // de nom / classification (sinon les anciennes erreurs restent figées indéfiniment).
            return { version: CACHE_VERSION, movies: {}, series: {}, classification: {} };
        }
        // Rétrocompatibilité : l'ancien format stockait un seul objet par film, on passe à un tableau
        // pour supporter plusieurs versions (langues) d'un même film.
        for (const key in cache.movies || {}) {
            if (!Array.isArray(cache.movies[key])) cache.movies[key] = [cache.movies[key]];
        }
        if (!cache.movies) cache.movies = {};
        if (!cache.series) cache.series = {};
        if (!cache.classification) cache.classification = {};
        return cache;
    } catch (e) {
        return { movies: {}, series: {}, classification: {} };
    }
}

function saveCache(cache) {
    try {
        cache.version = CACHE_VERSION;
        if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    } catch (e) {
        console.error("Erreur sauvegarde cache:", e.message);
    }
}
// --- Fin cache local ---

// Configuration des CORS obligatoires pour Nuvio
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "*");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    next();
});

// Clé TMDB par défaut, utilisée si l'utilisateur ne fournit pas la sienne sur la page d'accueil.
const TMDB_KEY_DEFAULT = "14cc580302bf1c4161bf96efb2165215";
const AD_BASE = "https://api.alldebrid.com/v4";
const AD_BASE_V41 = "https://api.alldebrid.com/v4.1";

// Petit helper pour appeler l'API Alldebrid avec le header d'authentification requis.
// On ajoute un User-Agent de navigateur car Cloudflare (utilisé par Alldebrid) bloque
// souvent le User-Agent par défaut d'axios ("axios/x.x.x") en le prenant pour un bot.
function adHeaders(apiKey) {
    return {
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/json"
    };
}

// Appel POST vers Alldebrid avec un corps en application/x-www-form-urlencoded,
// conforme aux exemples de la documentation officielle (plus fiable que le GET pour certains endpoints).
async function adPost(url, apiKey, formEntries) {
    const params = new URLSearchParams();
    for (const [key, value] of formEntries) params.append(key, value);
    return axios.post(url, params.toString(), {
        headers: { ...adHeaders(apiKey), "Content-Type": "application/x-www-form-urlencoded" }
    });
}
function flattenFiles(entries) {
    if (!Array.isArray(entries)) return [];
    return entries.flatMap(e => (e.e ? flattenFiles(e.e) : [e]));
}

// Ne garde que les vrais fichiers vidéo de contenu (exclut images, sous-titres, .nfo, et les "sample")
const VIDEO_EXT = /\.(mp4|mkv|avi|mov|wmv|ts|m4v|webm|flv)$/i;
function isRealVideoFile(filename) {
    if (!filename || !VIDEO_EXT.test(filename)) return false;
    if (/\b(sample|bonus|extra|featurette|making[\.\-]?of|trailer|deleted[\.\-]?scenes?)\b/i.test(filename)) return false;
    return true;
}

// Formatte une taille en octets en Go/Mo lisible
function formatSize(bytes) {
    if (!bytes || isNaN(bytes)) return "";
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(2)} Go`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(0)} Mo`;
}
// pour ne pas les confondre (vff contient "vf" comme sous-chaîne).
function detectLangTag(filename) {
    const t = (filename || "").toLowerCase();
    const hasMulti = /\bmulti\b/.test(t);
    const hasVff = /\bvff\b/.test(t);
    const hasVfi = /\bvfi\b/.test(t);
    const hasVfq = /\bvfq\b/.test(t);
    const hasVf = /\bvf\b/.test(t) && !hasVff && !hasVfi && !hasVfq;
    const hasVostfr = /\bvostfr\b/.test(t);
    const hasFrench = /\b(french|truefrench)\b/.test(t);

    // MULTI est considéré "haut de gamme" seulement s'il précise VFF ou VFI (piste française identifiée),
    // pas un simple "MULTI" générique dont on ne connaît pas le contenu exact des pistes.
    if (hasMulti && (hasVff || hasVfi)) return "multi_vff";
    if (hasMulti) return "multi";
    if (hasVff) return "vff";
    if (hasVfi) return "vfi";
    if (hasVfq) return "vfq";
    if (hasVf || hasFrench) return "vf";
    if (hasVostfr) return "vostfr";
    return "other";
}

// Extrait un badge lisible "2160p • HDR DV • MULTI VFF" à partir d'un nom de fichier,
// pour identifier un fichier même quand TMDB ne trouve pas de correspondance.
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

// Détermine si un titre est un film ou une série via TMDB /search/multi (bien plus fiable que
// deviner depuis le nom de fichier, qui rate des cas comme "Game of Thrones intégrale" ou
// un pack de saison sans numéro d'épisode). Repli sur l'heuristique de nom de fichier si TMDB
// ne trouve rien. Le résultat est mis en cache par id Alldebrid pour ne pas rappeler TMDB à chaque fois.
async function classifyContent(magnetId, filename, tmdbKey, cache) {
    if (cache.classification[magnetId]) return cache.classification[magnetId];

    const lower = filename.toLowerCase();
    // Signal fort et non ambigu dans le nom de fichier = à coup sûr un épisode de série. On ne laisse
    // pas TMDB nous contredire (il peut matcher un film dérivé plus populaire, ex: KonoSuba a un film).
    const hasStrongSeriesSignal = /s\d{1,2}e\d{1,3}/i.test(lower) || /\be\d{1,3}\b/i.test(lower) || /\bs\d{1,2}\b/i.test(lower) || lower.includes("season") || lower.includes("saison");

    let result = null;
    try {
        const { title: cleanName } = extractCleanTitle(filename);
        const url = `https://api.themoviedb.org/3/search/multi?api_key=${tmdbKey}&query=${encodeURIComponent(cleanName)}&language=fr-FR`;
        const res = await axios.get(url);
        const results = (res.data && res.data.results || []).filter(r => r.media_type === "movie" || r.media_type === "tv");
        const best = hasStrongSeriesSignal ? (results.find(r => r.media_type === "tv") || results[0]) : results[0];
        if (best) {
            const type = best.media_type === "tv" ? "series" : "movie";
            const isJapanese = best.original_language === "ja";
            const isAnimation = (best.genre_ids || []).includes(16);
            result = { type, isAnime: isJapanese && isAnimation };
        }
    } catch (e) {
        console.error("Erreur classification TMDB:", e.message);
    }

    if (!result) {
        result = { type: hasStrongSeriesSignal ? "series" : "movie", isAnime: false };
    } else if (hasStrongSeriesSignal && result.type === "movie") {
        // TMDB a renvoyé un film mais le nom de fichier indique clairement un épisode : le nom de
        // fichier est plus fiable ici qu'un mauvais matching TMDB.
        result.type = "series";
    }

    cache.classification[magnetId] = result;
    return result;
}


// (liste de tags séparés par virgule dans l'URL, ex: "multi_vff,multi,vff,vostfr").
// Les tags non reconnus ou non listés passent en dernier, dans leur ordre d'origine.
function sortByLangPref(streams, langPrefArray) {
    const rank = (title) => {
        const tag = detectLangTag(title);
        const idx = langPrefArray.indexOf(tag);
        return idx === -1 ? 999 : idx;
    };
    return streams
        .map((s, i) => ({ s, i, r: rank(s.title || "") }))
        // 1) langue préférée d'abord, 2) à langue égale, le plus gros fichier (meilleure qualité) d'abord
        .sort((a, b) => (a.r - b.r) || ((b.s._size || 0) - (a.s._size || 0)) || (a.i - b.i))
        .map(x => { const { _size, ...clean } = x.s; return clean; });
}

// Extrait le numéro de saison/épisode d'un nom de fichier (format S01E05, S1E5, etc.)
function parseSeasonEpisode(filename) {
    const match = filename.match(/S(\d{1,2})E(\d{1,3})/i);
    if (!match) return null;
    return { season: parseInt(match[1], 10), episode: parseInt(match[2], 10) };
}

// Nettoyage robuste : on coupe le nom au premier marqueur technique (année, qualité, codec...)
// plutôt que de retirer des mots un par un, ce qui laissait souvent des résidus polluant la recherche.
function extractCleanTitle(filename) {
    let raw = filename.replace(/\.(mp4|mkv|avi|mov)$/i, "");

    // Retire les préfixes de site/scène en début de nom : "[www.UIndex.org] - ", "[DEVIL-TORRENTS.PL] ",
    // "www.xtorrent.org - " etc. — fait AVANT de transformer les points en espaces, sinon les regex
    // ne peuvent plus matcher (bug précédent). Répété au cas où plusieurs tags se suivent.
    for (let i = 0; i < 3; i++) {
        const before = raw;
        raw = raw
            .replace(/^\s*\[[^\]]*\]\s*[-.\s]*/i, "")
            .replace(/^\s*(?:www\.)?[a-z0-9][a-z0-9\-]*\.(?:org|com|net|pl|info|to|cc|us|co)\b[-.\s]*/i, "");
        if (raw === before) break;
    }

    let name = raw.replace(/[\.\_]/g, " ").trim();

    const cutMarkers = /\b(19\d{2}|20\d{2}|S\d{1,2}(E\d{1,3})?|E\d{1,3}|SAISON\s?\d{1,2}|COMPLETE|INTEGRALE|INTÉGRALE|MULTI|VOSTFR|VF2?|FRENCH|TRUEFRENCH|SUBFRENCH|2160p|1080p|720p|480p|4K|UHD|HDR|DV|WEB[\-\.]?DL|WEBRIP|BLURAY|BDRIP|HDTV|REMUX|x264|x265|h264|h265|HEVC|AAC|DTS|ATMOS)\b/gi;
    // On ignore un marqueur qui serait en toute première position (ex: un titre qui COMMENCE par une
    // année comme "2001: A Space Odyssey") : le couper là donnerait un titre vide, donc on cherche
    // la première occurrence qui n'est PAS au tout début.
    let cutIndex = name.length;
    let m;
    while ((m = cutMarkers.exec(name)) !== null) {
        if (m.index > 0) { cutIndex = m.index; break; }
    }
    let title = name.slice(0, cutIndex);

    // Récupère une éventuelle année pour affiner la recherche TMDB
    const yearMatch = filename.match(/\b(19\d{2}|20\d{2})\b/);
    const year = yearMatch ? yearMatch[1] : null;

    title = title.replace(/[\-\[\]\(\)]/g, " ").replace(/\s+/g, " ").trim();
    return { title: title || name, year };
}

// Recherche TMDB robuste pour l'affichage en français
async function getTmdbMetadata(filename, type, tmdbKey, detailed = false) {
    try {
        const { title: cleanName, year } = extractCleanTitle(filename);
        const tmdbType = (type === "movie") ? "movie" : "tv";
        const yearParam = year ? `&${type === "movie" ? "year" : "first_air_date_year"}=${year}` : "";
        const url = `https://api.themoviedb.org/3/search/${tmdbType}?api_key=${tmdbKey}&query=${encodeURIComponent(cleanName)}${yearParam}&language=fr-FR`;
        let res = await axios.get(url);

        // Si la recherche avec année ne donne rien, on retente sans année (au cas où elle serait mal extraite)
        if ((!res.data || !res.data.results || res.data.results.length === 0) && year) {
            const urlNoYear = `https://api.themoviedb.org/3/search/${tmdbType}?api_key=${tmdbKey}&query=${encodeURIComponent(cleanName)}&language=fr-FR`;
            res = await axios.get(urlNoYear);
        }

        // Toujours rien ? Titres avec sous-titre parasite ("Chainsaw Man - II Film - La storia di Reze")
        // ou accents/ponctuation génèrent parfois une requête trop polluée — on retente avec juste les
        // 2-3 premiers mots, le vrai titre étant presque toujours au tout début.
        if ((!res.data || !res.data.results || res.data.results.length === 0)) {
            const shortened = cleanName.split(" ").slice(0, 3).join(" ");
            if (shortened && shortened !== cleanName) {
                const urlShort = `https://api.themoviedb.org/3/search/${tmdbType}?api_key=${tmdbKey}&query=${encodeURIComponent(shortened)}&language=fr-FR`;
                res = await axios.get(urlShort).catch(() => res);
            }
        }

        if (res.data && res.data.results && res.data.results.length > 0) {
            const first = res.data.results[0];

            // On récupère en plus le casting et les noms de genres (au lieu des seuls ids),
            // uniquement quand demandé explicitement (page de détails), pour ne pas doubler
            // le nombre d'appels TMDB sur les listes de catalogue.
            let cast = [];
            let genreNames = [];
            if (detailed) {
                try {
                    const detailUrl = `https://api.themoviedb.org/3/${tmdbType}/${first.id}?api_key=${tmdbKey}&language=fr-FR&append_to_response=credits`;
                    const detailRes = await axios.get(detailUrl);
                    if (detailRes.data) {
                        genreNames = (detailRes.data.genres || []).map(g => g.name);
                        cast = ((detailRes.data.credits && detailRes.data.credits.cast) || []).slice(0, 8).map(c => c.name);
                    }
                } catch (e) { /* pas bloquant si ça échoue, on garde le reste des métadonnées */ }
            }

            return {
                name: first.title || first.name || filename,
                poster: first.poster_path ? `https://image.tmdb.org/t/p/w500${first.poster_path}` : "https://placehold.co/300x450",
                // Fond d'écran large distinct du poster (portrait) — évite l'image étirée/mal cadrée
                // constatée quand le poster est réutilisé tel quel comme fond d'écran.
                backdrop: first.backdrop_path ? `https://image.tmdb.org/t/p/w1280${first.backdrop_path}` : (first.poster_path ? `https://image.tmdb.org/t/p/w500${first.poster_path}` : "https://placehold.co/300x450"),
                description: first.overview || "Disponible dans ton Cloud Alldebrid.",
                genreIds: first.genre_ids || [],
                genres: genreNames,
                cast: cast,
                imdbRating: first.vote_average ? first.vote_average.toFixed(1) : null,
                tmdbId: first.id
            };
        }
    } catch (e) {
        console.error("Erreur TMDB:", e.response ? `HTTP ${e.response.status} - ${JSON.stringify(e.response.data)}` : e.message);
    }
    return { name: filename, poster: "https://placehold.co/300x450", backdrop: "https://placehold.co/300x450", description: "Fichier Cloud Alldebrid", genreIds: [], genres: [], cast: [], imdbRating: null, tmdbId: null };
}

// Convertit un id TMDB en id IMDb ("tt...") pour que Cinemeta/AIOMetadata sachent résoudre les métadonnées
async function tmdbToImdbId(tmdbId, type, tmdbKey) {
    try {
        const tmdbType = (type === "movie") ? "movie" : "tv";
        const url = `https://api.themoviedb.org/3/${tmdbType}/${tmdbId}/external_ids?api_key=${tmdbKey}`;
        const res = await axios.get(url);
        return res.data && res.data.imdb_id ? res.data.imdb_id : null;
    } catch (e) {
        return null;
    }
}

// Inverse de tmdbToImdbId : retrouve le titre à partir d'un id IMDb (nécessaire car Prowlarr
// cherche par texte, contrairement à Torrentio qui accepte directement un id tt).
async function imdbIdToTitle(imdbId, tmdbKey) {
    try {
        const url = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${tmdbKey}&external_source=imdb_id`;
        const res = await axios.get(url);
        const hit = (res.data && (res.data.movie_results[0] || res.data.tv_results[0]));
        return hit ? (hit.title || hit.name) : null;
    } catch (e) {
        return null;
    }
}

// Configurable via variable d'environnement (ex: PROWLARR_URL=http://192.168.1.103:9696 dans .env
// ou avant "pm2 start") si localhost ne fonctionne pas depuis le processus Node (Docker, etc).
const PROWLARR_URL = process.env.PROWLARR_URL || "http://localhost:9696";

// Interroge Prowlarr (tous ses indexeurs configurés en une requête) et renvoie les infoHash trouvés,
// en complément de Torrentio. Renvoie [] silencieusement si Prowlarr est désactivé ou indisponible.
async function searchProwlarr(query, prowlarrKey) {
    if (!prowlarrKey || prowlarrKey === "off") return [];
    try {
        const url = `${PROWLARR_URL}/api/v1/search?query=${encodeURIComponent(query)}&apikey=${prowlarrKey}`;
        const res = await axios.get(url, { timeout: 8000 });
        const results = Array.isArray(res.data) ? res.data : [];
        const hashes = results.map(r => r.infoHash).filter(Boolean);
        console.log(`DEBUG Prowlarr: ${results.length} résultats, ${hashes.length} avec infoHash`);
        return hashes;
    } catch (e) {
        console.error("Erreur Prowlarr:", e.response ? JSON.stringify(e.response.data).slice(0, 300) : e.message);
        return [];
    }
}

// Historique des liens réellement déverrouillés/lus sur Alldebrid (endpoint en lecture seule, donc pas
// concerné par le blocage "NO_SERVER" qui empêche magnet/upload et link/unlock depuis un serveur).
async function getAlldebridHistory(apiKey) {
    try {
        const res = await axios.get(`${AD_BASE}/user/history`, { headers: adHeaders(apiKey) });
        const links = (res.data && res.data.data && res.data.data.links) || [];
        return links.map(l => l.filename).filter(Boolean);
    } catch (e) {
        console.error("Erreur user/history:", e.response ? JSON.stringify(e.response.data) : e.message);
        return [];
    }
}

// Construit un catalogue de recommandations à partir des genres les plus fréquents de la bibliothèque
// ET de l'historique de lecture réel (plus fiable qu'un simple fichier téléchargé mais jamais regardé).
// Exclut les titres déjà présents dans la bibliothèque pour éviter les doublons.
async function getRecommendations(magnets, historyFilenames, type, tmdbKey, wantAnime = false) {
    const genreCounts = {};
    const knownTmdbIds = new Set();

    const sampleLibrary = magnets.slice(0, 8);
    const sampleHistory = historyFilenames.slice(0, 8);

    for (const filename of [...sampleLibrary.map(m => m.filename), ...sampleHistory]) {
        const tmdb = await getTmdbMetadata(filename, type, tmdbKey);
        if (tmdb.tmdbId) knownTmdbIds.add(tmdb.tmdbId);
        for (const g of tmdb.genreIds) genreCounts[g] = (genreCounts[g] || 0) + 1;
    }
    // Pour les animes, on force le genre Animation (16) même si peu/pas d'échantillon existant,
    // et on restreint l'origine au Japon pour éviter les dessins animés occidentaux.
    let topGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([g]) => g);
    if (wantAnime && !topGenres.includes("16")) topGenres = ["16", ...topGenres].slice(0, 2);
    if (topGenres.length === 0) return [];

    try {
        const tmdbType = (type === "movie") ? "movie" : "tv";
        // Récupère les noms de genres pour les afficher dans la description (traçabilité de la recommandation)
        const genreListUrl = `https://api.themoviedb.org/3/genre/${tmdbType}/list?api_key=${tmdbKey}&language=fr-FR`;
        const genreListRes = await axios.get(genreListUrl).catch(() => null);
        const genreNameById = {};
        ((genreListRes && genreListRes.data && genreListRes.data.genres) || []).forEach(g => { genreNameById[g.id] = g.name; });
        const topGenreNames = topGenres.map(g => genreNameById[g]).filter(Boolean).join(", ");

        const originFilter = wantAnime ? "&with_origin_country=JP" : "";
        const discoverUrl = `https://api.themoviedb.org/3/discover/${tmdbType}?api_key=${tmdbKey}&with_genres=${topGenres.join(",")}${originFilter}&sort_by=popularity.desc&language=fr-FR`;
        const discoverRes = await axios.get(discoverUrl);
        const results = (discoverRes.data && discoverRes.data.results || [])
            .filter(r => !knownTmdbIds.has(r.id))
            // Si on ne veut pas d'animes ici, on exclut le genre Animation (déjà couvert par le catalogue dédié)
            .filter(r => wantAnime || !(r.genre_ids || []).includes(16))
            .slice(0, 30);

        const metas = [];
        for (const r of results) {
            const imdbId = await tmdbToImdbId(r.id, type, tmdbKey);
            if (!imdbId) continue;
            metas.push({
                id: imdbId,
                type: type,
                name: r.title || r.name,
                poster: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : "https://placehold.co/300x450",
                description: (topGenreNames ? `Basé sur tes genres favoris (${topGenreNames}). ` : "") + (r.overview || "")
            });
        }
        return metas;
    } catch (e) {
        console.error("Erreur recommandations:", e.message);
        return [];
    }
}

// Page d'accueil web
app.get("/", (req, res) => {
    res.send(`
        <div style="font-family:sans-serif; padding:30px; max-width:400px; margin:auto; text-align:center; background:#f4f4f9; border-radius:10px; margin-top:50px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <div style="font-size:48px; margin-bottom:5px;">☁️🎬</div>
            <h2 style="color:#e50914; margin:0 0 5px 0;">CinéCloud FR</h2>
            <p style="color:#888; font-size:13px; margin:0 0 20px 0;">Ta bibliothèque Alldebrid, organisée et en français</p>
            <p style="color:#333;">Entre ta clé API Alldebrid pour générer le lien de ton addon.</p>
            <input type="text" id="key" placeholder="Ta clé API Alldebrid" style="width:100%; padding:12px; margin-bottom:15px; border:1px solid #ccc; border-radius:5px; box-sizing:border-box;"><br>
            <input type="text" id="tmdbKey" placeholder="Ta clé API TMDB (optionnel)" style="width:100%; padding:12px; margin-bottom:5px; border:1px solid #ccc; border-radius:5px; box-sizing:border-box;"><br>
            <input type="text" id="prowlarrKey" placeholder="Clé API Prowlarr (optionnel, localhost:9696)" style="width:100%; padding:12px; margin-bottom:5px; border:1px solid #ccc; border-radius:5px; box-sizing:border-box;"><br>
            <p style="margin:12px 0 8px 0; font-size:13px; color:#333; text-align:left; font-weight:bold;">Catalogues à activer :</p>
            <div id="catalogList" style="display:flex; flex-direction:column; gap:4px; margin-bottom:15px; text-align:left; max-height:220px; overflow-y:auto; border:1px solid #eee; padding:8px; border-radius:5px;"></div>
            <p style="margin:0 0 15px 0; font-size:12px; color:#888; text-align:left;">Laisse vide pour utiliser la clé par défaut. Clé gratuite sur <a href="https://www.themoviedb.org/settings/api" target="_blank">themoviedb.org/settings/api</a>.</p>
            <label style="display:flex; align-items:center; gap:8px; margin-bottom:15px; font-size:13px; color:#333; text-align:left;">
                <input type="checkbox" id="cacheToggle" checked style="width:16px; height:16px;">
                Activer le Cache Global (torrents publics en cache Alldebrid — ajoute les magnets vérifiés à ton compte)
            </label>
            <p style="margin:0 0 8px 0; font-size:13px; color:#333; text-align:left; font-weight:bold;">Ordre de préférence des langues (liens classés en conséquence) :</p>
            <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:15px;">
                <select id="lang1" style="padding:8px; border-radius:5px; border:1px solid #ccc;"></select>
                <select id="lang2" style="padding:8px; border-radius:5px; border:1px solid #ccc;"></select>
                <select id="lang3" style="padding:8px; border-radius:5px; border:1px solid #ccc;"></select>
                <select id="lang4" style="padding:8px; border-radius:5px; border:1px solid #ccc;"></select>
                <select id="lang5" style="padding:8px; border-radius:5px; border:1px solid #ccc;"></select>
                <select id="lang6" style="padding:8px; border-radius:5px; border:1px solid #ccc;"></select>
            </div>
            <button onclick="generate()" style="padding:12px 20px; background:#e50914; color:white; border:none; border-radius:5px; width:100%; font-weight:bold; cursor:pointer;">Générer le lien Nuvio</button>
            <div id="box" style="display:none; margin-top:25px; padding:15px; background:#fff; border:1px dashed #007bff; border-radius:5px;">
                <p style="margin:0 0 10px 0; font-size:14px; color:#555;">Copie ce lien et colle-le dans Nuvio :</p>
                <p id="result" style="word-break:break-all; color:#007bff; font-weight:bold; margin:0; font-size:13px;"></p>
            </div>
        </div>
        <script>
            const LANG_OPTIONS = [
                { value: "multi_vff", label: "MULTI avec VFF/VFI" },
                { value: "vff", label: "VFF (Français France)" },
                { value: "vfi", label: "VFI (Français International)" },
                { value: "multi", label: "MULTI (français probable)" },
                { value: "vfq", label: "VFQ (Français Québec)" },
                { value: "vf", label: "VF / FRENCH" },
                { value: "vostfr", label: "VOSTFR" }
            ];
            const defaults = ["multi_vff", "vff", "vfi", "multi", "vf", "vostfr"];
            ["lang1", "lang2", "lang3", "lang4", "lang5", "lang6"].forEach((id, i) => {
                const sel = document.getElementById(id);
                LANG_OPTIONS.forEach(opt => {
                    const o = document.createElement("option");
                    o.value = opt.value; o.textContent = (i + 1) + "er choix : " + opt.label;
                    sel.appendChild(o);
                });
                sel.value = defaults[i];
            });
            const CATALOG_LIST = [
                { id: "my_ad_movies", label: "Mes Films Alldebrid" },
                { id: "my_ad_series", label: "Mes Séries Alldebrid" },
                { id: "my_ad_animes", label: "Mes Animes Alldebrid" },
                { id: "my_ad_animes_movies", label: "Mes Animes Films Alldebrid" },
                { id: "my_ad_links", label: "Mes Liens Alldebrid (Films)" },
                { id: "my_ad_links_series", label: "Mes Liens Alldebrid (Séries)" },
                { id: "my_ad_history", label: "Historique Alldebrid (Films)" },
                { id: "my_ad_history_series", label: "Historique Alldebrid (Séries)" },
                { id: "my_ad_reco_movies", label: "Recommandations Films" },
                { id: "my_ad_reco_series", label: "Recommandations Séries" },
                { id: "my_ad_reco_animes", label: "Recommandations Animes" },
                { id: "my_ad_reco_animes_movies", label: "Recommandations Animes Films" }
            ];
            const catalogListEl = document.getElementById("catalogList");
            CATALOG_LIST.forEach(cat => {
                const lbl = document.createElement("label");
                lbl.style.cssText = "display:flex; align-items:center; gap:6px; font-size:13px; color:#333;";
                lbl.innerHTML = '<input type="checkbox" class="catcheck" value="' + cat.id + '" checked style="width:14px;height:14px;"> ' + cat.label;
                catalogListEl.appendChild(lbl);
            });
            function generate() {
                const key = document.getElementById("key").value.trim();
                const tmdbKey = document.getElementById("tmdbKey").value.trim();
                const cacheOn = document.getElementById("cacheToggle").checked;
                const langPref = ["lang1","lang2","lang3","lang4","lang5","lang6"].map(id => document.getElementById(id).value).join(",");
                if(!key) return alert("Veuillez entrer une clé valide");
                const prowlarrKey = document.getElementById("prowlarrKey").value.trim();
                const checked = Array.from(document.querySelectorAll(".catcheck:checked")).map(c => c.value);
                const allChecked = checked.length === CATALOG_LIST.length;
                const enabledCatalogs = allChecked ? "all" : encodeURIComponent(checked.join(","));
                const link = window.location.origin + "/" + key + "/" + (tmdbKey || "default") + "/" + (cacheOn ? "on" : "off") + "/" + encodeURIComponent(langPref) + "/" + (prowlarrKey || "off") + "/" + enabledCatalogs + "/manifest.json";
                document.getElementById("box").style.display = "block";
                document.getElementById("result").innerText = link;
            }
        </script>
    `);
});

const ALL_CATALOGS = [
    { type: "movie", id: "my_ad_movies", name: "Mes Films Alldebrid" },
    { type: "series", id: "my_ad_series", name: "Mes Séries Alldebrid" },
    { type: "series", id: "my_ad_animes", name: "Mes Animes Alldebrid" },
    { type: "movie", id: "my_ad_animes_movies", name: "Mes Animes Films Alldebrid" },
    { type: "movie", id: "my_ad_links", name: "Mes Liens Alldebrid (Films)" },
    { type: "series", id: "my_ad_links_series", name: "Mes Liens Alldebrid (Séries)" },
    { type: "movie", id: "my_ad_history", name: "Historique Alldebrid (Films)" },
    { type: "series", id: "my_ad_history_series", name: "Historique Alldebrid (Séries)" },
    { type: "movie", id: "my_ad_reco_movies", name: "Recommandations Films" },
    { type: "series", id: "my_ad_reco_series", name: "Recommandations Séries" },
    { type: "series", id: "my_ad_reco_animes", name: "Recommandations Animes" },
    { type: "movie", id: "my_ad_reco_animes_movies", name: "Recommandations Animes Films" }
];

// Le Manifeste officiel pour Nuvio
app.get("/:apiKey/:tmdbKey/:cacheMode/:langPref/:prowlarrKey/:enabledCatalogs/manifest.json", (req, res) => {
    const enabled = req.params.enabledCatalogs && req.params.enabledCatalogs !== "all"
        ? decodeURIComponent(req.params.enabledCatalogs).split(",")
        : ALL_CATALOGS.map(c => c.id);
    res.json({
        id: "org.cinecloudfr.addon",
        version: "7.0.0",
        name: "CinéCloud FR",
        description: "Ta bibliothèque Alldebrid organisée en Films/Séries/Animes/Liens/Historique, avec fiches et recommandations en français.",
        logo: "https://placehold.co/256x256/e50914/white?text=%E2%98%81%EF%B8%8F%F0%9F%8E%AC",
        resources: [
            "catalog",
            { name: "meta", types: ["movie", "series"], idPrefixes: ["ad_cloud:", "ad_series:", "ad_link:", "tt"] },
            { name: "stream", types: ["movie", "series"], idPrefixes: ["ad_cloud:", "ad_series:", "ad_link:", "tt"] }
        ],
        types: ["movie", "series"],
        catalogs: ALL_CATALOGS.filter(c => enabled.includes(c.id)),
        idPrefixes: ["ad_cloud:", "ad_series:", "ad_link:", "tt"]
    });
});

// Le Gestionnaire de Métadonnées (page de détails). On répond nous-mêmes pour ad_cloud:/ad_series:
// (ids qu'aucun autre addon ne connaît) MAIS AUSSI pour les vrais ids tt: qu'on a résolus, afin de
// fournir des fiches en français via TMDB plutôt que de laisser Cinemeta répondre (souvent en anglais).
app.get("/:apiKey/:tmdbKey/:cacheMode/:langPref/:prowlarrKey/:enabledCatalogs/meta/:type/:id.json", async (req, res) => {
    const { apiKey, id, type } = req.params;
    const tmdbKey = (req.params.tmdbKey && req.params.tmdbKey !== "default") ? req.params.tmdbKey : TMDB_KEY_DEFAULT;
    try {
        // --- Série : soit via notre id maison (ad_series:), soit via un vrai id tt déjà résolu ---
        let groupTitle = null;
        if (id.startsWith("ad_series:")) {
            groupTitle = decodeURIComponent(id.replace("ad_series:", ""));
        } else if (id.startsWith("tt")) {
            const cache = loadCache();
            if (cache.series[id]) groupTitle = cache.series[id].groupTitle;
        }

        if (groupTitle) {
            const statusRes = await axios.get(`${AD_BASE_V41}/magnet/status`, { headers: adHeaders(apiKey) });
            const magnets = (statusRes.data && statusRes.data.data && statusRes.data.data.magnets) || [];
            const episodes = magnets.filter(m => extractCleanTitle(m.filename || "").title.toLowerCase() === groupTitle.toLowerCase());
            if (episodes.length === 0) return res.json({ meta: null });

            const tmdb = await getTmdbMetadata(episodes[0].filename, "series", tmdbKey, true);
            // Les ids d'épisodes suivent le même schéma que l'id de la série elle-même (ad_series: ou tt)
            const episodeIdPrefix = id.startsWith("tt") ? id : `ad_series:${encodeURIComponent(groupTitle)}`;
            const videos = episodes.map(ep => {
                const se = parseSeasonEpisode(ep.filename) || { season: 1, episode: 1 };
                return {
                    id: `${episodeIdPrefix}:${se.season}:${se.episode}`,
                    title: `S${se.season}E${se.episode}`,
                    season: se.season,
                    episode: se.episode,
                    released: new Date(2020, 0, 1).toISOString()
                };
            }).sort((a, b) => a.season - b.season || a.episode - b.episode);

            return res.json({
                meta: {
                    id: id, type: "series", name: tmdb.name, poster: tmdb.poster, background: tmdb.backdrop,
                    description: tmdb.description, genres: tmdb.genres, cast: tmdb.cast, imdbRating: tmdb.imdbRating,
                    videos: videos
                }
            });
        }

        // --- Fichier depuis "Mes Liens" ou "Historique" : id ad_link: (lien Alldebrid encodé en base64) ---
        if (id.startsWith("ad_link:")) {
            const originalLink = Buffer.from(id.replace("ad_link:", ""), "base64url").toString();

            // On retrouve le nom de fichier via user/links puis user/history (mêmes sources que le
            // catalogue, déjà confirmées fonctionnelles) plutôt que link/infos qui échouait.
            let filename = null;
            for (const endpoint of ["user/links", "user/history"]) {
                const linksRes = await axios.get(`${AD_BASE}/${endpoint}`, { headers: adHeaders(apiKey) }).catch(() => null);
                const links = (linksRes && linksRes.data && linksRes.data.data && linksRes.data.data.links) || [];
                const match = links.find(l => l.link === originalLink);
                if (match && match.filename) { filename = match.filename; break; }
            }
            if (!filename) return res.json({ meta: null });

            const tmdb = await getTmdbMetadata(filename, type, tmdbKey, true);
            const badge = extractTechBadge(filename);
            return res.json({
                meta: {
                    id: id, type: type, name: tmdb.name, poster: tmdb.poster, background: tmdb.backdrop,
                    description: `${badge ? badge + "\n" : ""}${filename}\n\n${tmdb.description || ""}`,
                    genres: tmdb.genres, cast: tmdb.cast, imdbRating: tmdb.imdbRating
                }
            });
        }

        // --- Film : soit via notre id maison (ad_cloud:), soit via un vrai id tt déjà résolu ---
        let filename = null;
        if (id.startsWith("ad_cloud:")) {
            const magnetId = id.replace("ad_cloud:", "");
            const statusRes = await axios.get(`${AD_BASE_V41}/magnet/status`, { headers: adHeaders(apiKey), params: { id: magnetId } });
            const magnetData = statusRes.data && statusRes.data.data && statusRes.data.data.magnets;
            const magnet = Array.isArray(magnetData) ? magnetData[0] : magnetData;
            filename = magnet && magnet.filename;
        } else if (id.startsWith("tt")) {
            const cache = loadCache();
            // On a déjà le nom de fichier en cache : pas besoin de rappeler Alldebrid, c'est instantané
            if (cache.movies[id] && cache.movies[id][0]) filename = cache.movies[id][0].filename;
        }
        if (!filename) return res.json({ meta: null });

        const tmdb = await getTmdbMetadata(filename, type, tmdbKey, true);
        res.json({
            meta: {
                id: id, type: type, name: tmdb.name, poster: tmdb.poster, background: tmdb.backdrop,
                description: tmdb.description, genres: tmdb.genres, cast: tmdb.cast, imdbRating: tmdb.imdbRating
            }
        });
    } catch (err) {
        console.error("Erreur meta:", err.response ? JSON.stringify(err.response.data) : err.message);
        res.json({ meta: null });
    }
});

// Le Gestionnaire de Catalogues
app.get("/:apiKey/:tmdbKey/:cacheMode/:langPref/:prowlarrKey/:enabledCatalogs/catalog/:type/:id.json", async (req, res) => {
    const { apiKey, id, type } = req.params;
    const tmdbKey = (req.params.tmdbKey && req.params.tmdbKey !== "default") ? req.params.tmdbKey : TMDB_KEY_DEFAULT;
    try {
        // Catalogues "Liens" (sauvegardés manuellement) et "Historique" (récemment lus) —
        // ne viennent pas de magnet/status mais de deux endpoints Alldebrid dédiés.
        if (id === "my_ad_links" || id === "my_ad_history" || id === "my_ad_links_series" || id === "my_ad_history_series") {
          try {
            const isHistory = id.includes("history");
            const wantSeries = id.endsWith("_series");
            const endpoint = isHistory ? "user/history" : "user/links";
            const linksRes = await axios.get(`${AD_BASE}/${endpoint}`, { headers: adHeaders(apiKey) });
            const links = (linksRes && linksRes.data && linksRes.data.data && linksRes.data.data.links) || [];

            const seenFilenames = new Set();
            const deduped = links.filter(l => {
                if (!isRealVideoFile(l.filename)) return false;
                const key = l.filename.toLowerCase();
                if (seenFilenames.has(key)) return false;
                seenFilenames.add(key);
                return true;
            }).slice(0, 300);

            const cache2 = loadCache();
            let cache2Changed = false;

            const classified = await Promise.all(deduped.map(async (l) => {
                const classId = `link:${l.link}`;
                const already = !!cache2.classification[classId];
                const c = await classifyContent(classId, l.filename, tmdbKey, cache2);
                if (!already) cache2Changed = true;
                return { l, c };
            }));

            const relevant = classified.filter(({ c }) => wantSeries ? c.type === "series" : c.type === "movie");

            if (wantSeries) {
                const metas = await Promise.all(relevant.map(async ({ l }) => {
                    const tmdb = await getTmdbMetadata(l.filename, "series", tmdbKey);
                    const badge = extractTechBadge(l.filename);
                    return {
                        id: `ad_link:${Buffer.from(l.link).toString("base64url")}`,
                        type: "series",
                        name: tmdb.tmdbId ? tmdb.name : `${badge ? "[" + badge + "] " : ""}${l.filename}`,
                        poster: tmdb.poster,
                        description: `${badge ? badge + "\n" : ""}${l.filename}\n\n${tmdb.description || ""}`
                    };
                }));
                if (cache2Changed) saveCache(cache2);
                return res.json({ metas: metas });
            }

            const metasRaw = await Promise.all(relevant.map(async ({ l }) => {
                const tmdb = await getTmdbMetadata(l.filename, "movie", tmdbKey);
                const badge = extractTechBadge(l.filename);
                if (tmdb.tmdbId) {
                    const imdbId = await tmdbToImdbId(tmdb.tmdbId, "movie", tmdbKey);
                    if (imdbId) {
                        if (!cache2.movies[imdbId]) cache2.movies[imdbId] = [];
                        if (!cache2.movies[imdbId].some(e => e.link === l.link)) {
                            cache2.movies[imdbId].push({ link: l.link, filename: l.filename });
                            cache2Changed = true;
                        }
                        return { id: imdbId, type: "movie", name: tmdb.name, poster: tmdb.poster, description: tmdb.description };
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
            const metas = metasRaw.filter(m => { if (seenIds.has(m.id)) return false; seenIds.add(m.id); return true; });
            if (cache2Changed) saveCache(cache2);
            return res.json({ metas: metas });
          } catch (err) {
            // Erreur affichée DIRECTEMENT comme tuile dans Nuvio plutôt que masquée en liste vide,
            // pour pouvoir diagnostiquer sans avoir besoin d'accéder aux logs serveur.
            console.error(`Erreur catalogue ${id}:`, err.message);
            return res.json({ metas: [{
                id: "ad_link:error", type: id.endsWith("_series") ? "series" : "movie",
                name: "⚠️ Erreur : " + err.message, poster: "https://placehold.co/300x450",
                description: String(err.stack || err).slice(0, 500)
            }] });
          }
        }

        // Nouvelle API : /v4.1/magnet/status + auth via header Authorization Bearer
        const url = `${AD_BASE_V41}/magnet/status`;
        const response = await axios.get(url, { headers: adHeaders(apiKey) });

        if (!response.data || response.data.status !== "success" || !response.data.data || !response.data.data.magnets) {
            console.error("Réponse inattendue magnet/status:", JSON.stringify(response.data));
            return res.json({ metas: [] });
        }

        const magnets = response.data.data.magnets;

        // Catalogues de recommandations : basés sur les genres dominants de la bibliothèque existante
        if (id === "my_ad_reco_movies" || id === "my_ad_reco_series" || id === "my_ad_reco_animes" || id === "my_ad_reco_animes_movies") {
            const wantAnime = (id === "my_ad_reco_animes" || id === "my_ad_reco_animes_movies");
            const wantSeries = (id === "my_ad_reco_series") || (id === "my_ad_reco_animes");
            const relevant = magnets.filter(item => {
                const title = (item.filename || "").toLowerCase();
                const isSeries = title.match(/s\d{1,2}e\d{1,3}/) || title.match(/\bs\d{1,2}\b/) || title.includes("season") || title.includes("saison") || item.statusCode === 3;
                return wantSeries ? isSeries : !isSeries;
            });
            const historyFilenames = await getAlldebridHistory(apiKey);
            const metas = await getRecommendations(relevant, historyFilenames, wantSeries ? "series" : "movie", tmdbKey, wantAnime);
            return res.json({ metas: metas });
        }

        // On filtre d'abord TOUS les torrents qui correspondent à ce catalogue (plus de limite à 15).
        // Classification fiable via TMDB (movie/tv) plutôt que deviner depuis le nom de fichier —
        // corrige les cas comme "Game of Thrones intégrale" ou un pack de saison sans SxxExx.
        const cache = loadCache();
        let cacheChanged = false;

        const classifications = await Promise.all(magnets.map(async (item) => {
            const alreadyCached = !!cache.classification[item.id];
            const contentType = await classifyContent(item.id, item.filename || "", tmdbKey, cache);
            return { item, contentType, isNew: !alreadyCached };
        }));
        if (classifications.some(c => c.isNew)) cacheChanged = true;

        const matched = [];
        for (const { item, contentType } of classifications) {
            if (id === "my_ad_animes" && contentType.type === "series" && contentType.isAnime) matched.push({ item, currentType: "series" });
            else if (id === "my_ad_animes_movies" && contentType.type === "movie" && contentType.isAnime) matched.push({ item, currentType: "movie" });
            else if (id === "my_ad_series" && contentType.type === "series" && !contentType.isAnime) matched.push({ item, currentType: "series" });
            else if (id === "my_ad_movies" && contentType.type === "movie" && !contentType.isAnime) matched.push({ item, currentType: "movie" });
        }

        let metas;
        if (id === "my_ad_series" || id === "my_ad_animes") {
            // Regroupement par titre de série : un seul item par série, les épisodes iront dans la fiche détails
            const groups = new Map();
            for (const { item } of matched) {
                const groupTitle = extractCleanTitle(item.filename).title.toLowerCase();
                if (!groups.has(groupTitle)) groups.set(groupTitle, []);
                groups.get(groupTitle).push(item);
            }
            const groupList = [...groups.entries()].slice(0, 300);

            metas = await Promise.all(groupList.map(async ([groupTitle, episodes]) => {
                const tmdb = await getTmdbMetadata(episodes[0].filename, "series", tmdbKey);

                // Même logique que pour les films : vrai id tt si trouvé, pour profiter de
                // l'intégration native (fiche épisodes complète fournie par Cinemeta, liens des
                // autres addons, etc.). On mémorise juste le titre de groupe pour retrouver
                // les épisodes correspondants au moment du clic.
                if (tmdb.tmdbId) {
                    const imdbId = await tmdbToImdbId(tmdb.tmdbId, "series", tmdbKey);
                    if (imdbId) {
                        cache.series[imdbId] = { groupTitle };
                        cacheChanged = true;
                        return { id: imdbId, type: type, name: tmdb.name, poster: tmdb.poster, description: tmdb.description };
                    }
                }

                return {
                    id: `ad_series:${encodeURIComponent(groupTitle)}`,
                    type: type,
                    name: tmdb.name,
                    poster: tmdb.poster,
                    description: tmdb.description
                };
            }));
        } else {
            // Plus de limite basse : en auto-hébergement il n'y a pas de timeout serveur imposé.
            // On garde un plafond haut par sécurité (rate-limit TMDB), ajustable si besoin.
            const itemsToProcess = matched.slice(0, 300);

            const metasRaw = await Promise.all(itemsToProcess.map(async ({ item, currentType }) => {
                const tmdb = await getTmdbMetadata(item.filename, currentType, tmdbKey);

                // Si TMDB a trouvé une correspondance fiable, on utilise le vrai id IMDb :
                // ça permet à TOUS tes autres addons (AIOMetadata, Cinemeta...) de proposer
                // leurs propres liens et informations sur cette même fiche, comme demandé.
                if (tmdb.tmdbId) {
                    const imdbId = await tmdbToImdbId(tmdb.tmdbId, currentType, tmdbKey);
                    if (imdbId) {
                        // Plusieurs fichiers (langues différentes) peuvent pointer vers le même film :
                        // on les garde TOUTES pour pouvoir proposer tous les liens, triés par langue au clic.
                        if (!cache.movies[imdbId]) cache.movies[imdbId] = [];
                        if (!cache.movies[imdbId].some(e => e.alldebridId === item.id)) {
                            cache.movies[imdbId].push({ alldebridId: item.id, filename: item.filename });
                            cacheChanged = true;
                        }
                        return { id: imdbId, type: type, name: tmdb.name, poster: tmdb.poster, description: tmdb.description };
                    }
                }

                // Repli si TMDB ne trouve rien : id maison comme avant
                return { id: `ad_cloud:${item.id}`, type: type, name: tmdb.name, poster: tmdb.poster, description: tmdb.description };
            }));

            // Dédoublonnage : plusieurs fichiers du même film ne doivent donner qu'UNE seule tuile au catalogue
            const seenIds = new Set();
            metas = metasRaw.filter(m => {
                if (seenIds.has(m.id)) return false;
                seenIds.add(m.id);
                return true;
            });
        }
        if (cacheChanged) saveCache(cache);
        res.json({ metas: metas });
    } catch (err) {
        console.error("Erreur catalog:", err.response ? JSON.stringify(err.response.data) : err.message);
        res.json({ metas: [] });
    }
});

// Titre de stream uniformisé partout : badge (langue/qualité/codec) en premier car c'est ce qui
// permet de choisir vite, puis le nom de fichier complet, puis la taille.
function buildStreamTitle(filename, sizeBytes, extra) {
    const badge = extractTechBadge(filename);
    const sizeLabel = formatSize(sizeBytes);
    const lines = [];
    if (badge) lines.push(badge);
    lines.push(filename);
    const footer = [sizeLabel ? "💾 " + sizeLabel : "", extra || ""].filter(Boolean).join(" • ");
    if (footer) lines.push(footer);
    return lines.join("\n");
}

async function unlockCloudMagnet(apiKey, magnetId, streams) {
    const filesRes = await adPost(`${AD_BASE}/magnet/files`, apiKey, [["id[]", magnetId]]).catch((e) => {
        console.error("Erreur magnet/files:", e.response ? JSON.stringify(e.response.data) : e.message);
        return null;
    });
    const magnetData = filesRes && filesRes.data && filesRes.data.data && filesRes.data.data.magnets && filesRes.data.data.magnets[0];
    if (!magnetData || !magnetData.files) return;

    const files = flattenFiles(magnetData.files).filter(f => f.l && isRealVideoFile(f.n));

    // Déverrouillage en parallèle (pas un par un) : essentiel pour rester rapide même avec plusieurs fichiers
    await Promise.all(files.map(async (file) => {
        const unlockRes = await adPost(`${AD_BASE}/link/unlock`, apiKey, [["link", file.l]]).catch((e) => {
            console.error("Erreur unlock:", e.response ? JSON.stringify(e.response.data) : e.message);
            return null;
        });
        if (unlockRes && unlockRes.data && unlockRes.data.status === "success" && unlockRes.data.data && unlockRes.data.data.link) {
            streams.push({
                name: "Mon Cloud ☁️",
                title: buildStreamTitle(file.n, file.s),
                url: unlockRes.data.data.link,
                _size: file.s || 0
            });
        }
    }));
}

// Déverrouille une "version" d'un film en cache : soit un magnet de la bibliothèque principale
// (alldebridId), soit un lien direct venant de "Mes Liens"/"Historique" (link).
async function unlockVersion(apiKey, version, streams) {
    if (version.alldebridId) {
        await unlockCloudMagnet(apiKey, version.alldebridId, streams);
        return;
    }
    if (version.link) {
        const unlockRes = await adPost(`${AD_BASE}/link/unlock`, apiKey, [["link", version.link]]).catch((e) => {
            console.error("Erreur unlock (version lien):", e.response ? JSON.stringify(e.response.data) : e.message);
            return null;
        });
        if (unlockRes && unlockRes.data && unlockRes.data.status === "success" && unlockRes.data.data && unlockRes.data.data.link) {
            streams.push({
                name: "Mon Cloud ☁️",
                title: buildStreamTitle(version.filename || "Fichier Alldebrid", 0),
                url: unlockRes.data.data.link,
                _size: 0
            });
        }
    }
}

// Le Gestionnaire de Streams
app.get("/:apiKey/:tmdbKey/:cacheMode/:langPref/:prowlarrKey/:enabledCatalogs/stream/:type/:id.json", async (req, res) => {
    const { apiKey, type, id, cacheMode, langPref, prowlarrKey } = req.params;
    const tmdbKeyForSearch = (req.params.tmdbKey && req.params.tmdbKey !== "default") ? req.params.tmdbKey : TMDB_KEY_DEFAULT;
    const cacheEnabled = cacheMode !== "off";
    const langPrefArray = langPref ? decodeURIComponent(langPref).split(",").filter(Boolean) : ["multi_vff", "vff", "vfi", "multi", "vf", "vostfr"];
    let streams = [];
    try {
        let resolvedId = id;
        const cache = loadCache();

        let episodeVersionsHandled = false;
        // Id tt d'un épisode de série déjà résolu (format standard Stremio "tt1234567:1:5")
        if (id && id.startsWith("tt") && id.includes(":")) {
            const parts = id.split(":");
            const ttId = parts[0];
            const season = parseInt(parts[1], 10);
            const episode = parseInt(parts[2], 10);

            if (cache.series[ttId]) {
                const groupTitle = cache.series[ttId].groupTitle;
                const statusRes = await axios.get(`${AD_BASE_V41}/magnet/status`, { headers: adHeaders(apiKey) }).catch(() => null);
                const magnets = (statusRes && statusRes.data && statusRes.data.data && statusRes.data.data.magnets) || [];
                // .filter() et pas .find() : plusieurs versions (langues) du même épisode peuvent exister
                const matches = magnets.filter(m => {
                    if (extractCleanTitle(m.filename || "").title.toLowerCase() !== groupTitle.toLowerCase()) return false;
                    const se = parseSeasonEpisode(m.filename || "");
                    return se && se.season === season && se.episode === episode;
                });
                await Promise.all(matches.map(m => unlockCloudMagnet(apiKey, m.id, streams)));
                episodeVersionsHandled = true;
            } else {
                // La série n'est pas (encore) résolue en cache — vérification live par titre avant de
                // chercher ailleurs (corrige "j'ai bien l'épisode sur mon compte mais rien ne s'affiche").
                const title = await imdbIdToTitle(ttId, tmdbKeyForSearch);
                if (title) {
                    const statusRes = await axios.get(`${AD_BASE_V41}/magnet/status`, { headers: adHeaders(apiKey) }).catch(() => null);
                    const magnets = (statusRes && statusRes.data && statusRes.data.data && statusRes.data.data.magnets) || [];
                    const cleanTitleLower = title.toLowerCase();
                    const matches = magnets.filter(m => {
                        if (extractCleanTitle(m.filename || "").title.toLowerCase() !== cleanTitleLower) return false;
                        const se = parseSeasonEpisode(m.filename || "");
                        return se && se.season === season && se.episode === episode;
                    });
                    if (matches.length > 0) {
                        await Promise.all(matches.map(m => unlockCloudMagnet(apiKey, m.id, streams)));
                        cache.series[ttId] = { groupTitle: cleanTitleLower };
                        saveCache(cache);
                        episodeVersionsHandled = true;
                    }
                }
            }
        }
        // Id tt d'un film déjà résolu : peut avoir plusieurs versions (langues) en cache
        let movieVersionsHandled = false;
        if (id && id.startsWith("tt") && !id.includes(":") && cache.movies[id]) {
            for (const version of cache.movies[id]) {
                await unlockVersion(apiKey, version, streams);
            }
            movieVersionsHandled = true;
        }
        // Le film n'est pas (encore) en cache tt-id — avant de chercher ailleurs, on vérifie en
        // direct si un fichier de la bibliothèque correspond déjà au titre (corrige "mes fichiers
        // ne sont pas mis en avant" pour ce qui n'avait pas pu être matché au moment du catalogue).
        else if (id && id.startsWith("tt") && !id.includes(":")) {
            const title = await imdbIdToTitle(id, tmdbKeyForSearch);
            if (title) {
                const statusRes = await axios.get(`${AD_BASE_V41}/magnet/status`, { headers: adHeaders(apiKey) }).catch(() => null);
                const magnets = (statusRes && statusRes.data && statusRes.data.data && statusRes.data.data.magnets) || [];
                const cleanTitleLower = title.toLowerCase();
                const matches = magnets.filter(m => extractCleanTitle(m.filename || "").title.toLowerCase() === cleanTitleLower);
                if (matches.length > 0) {
                    await Promise.all(matches.map(m => unlockCloudMagnet(apiKey, m.id, streams)));
                    cache.movies[id] = matches.map(m => ({ alldebridId: m.id, filename: m.filename }));
                    saveCache(cache);
                    movieVersionsHandled = true;
                }
            }
        }

        // Fichier depuis "Mes Liens" ou "Historique" : déverrouillage direct, pas de magnet/files nécessaire
        if (id && id.startsWith("ad_link:")) {
            const originalLink = Buffer.from(id.replace("ad_link:", ""), "base64url").toString();
            const unlockRes = await adPost(`${AD_BASE}/link/unlock`, apiKey, [["link", originalLink]]).catch((e) => {
                console.error("Erreur unlock (ad_link):", e.response ? JSON.stringify(e.response.data) : e.message);
                return null;
            });
            if (unlockRes && unlockRes.data && unlockRes.data.status === "success" && unlockRes.data.data && unlockRes.data.data.link) {
                const fname = unlockRes.data.data.filename || "Fichier Alldebrid";
                streams.push({
                    name: "Mon Cloud ☁️",
                    title: buildStreamTitle(fname, unlockRes.data.data.filesize || 0),
                    url: unlockRes.data.data.link,
                    _size: unlockRes.data.data.filesize || 0
                });
            }
            return res.json({ streams: sortByLangPref(streams, langPrefArray) });
        }

        if (id && id.startsWith("ad_series:")) {
            // Format attendu : ad_series:<titre encodé>:<saison>:<episode>
            const parts = id.replace("ad_series:", "").split(":");
            const episode = parseInt(parts.pop(), 10);
            const season = parseInt(parts.pop(), 10);
            const groupTitle = decodeURIComponent(parts.join(":"));

            const statusRes = await axios.get(`${AD_BASE_V41}/magnet/status`, { headers: adHeaders(apiKey) }).catch(() => null);
            const magnets = (statusRes && statusRes.data && statusRes.data.data && statusRes.data.data.magnets) || [];
            const matches = magnets.filter(m => {
                if (extractCleanTitle(m.filename || "").title.toLowerCase() !== groupTitle.toLowerCase()) return false;
                const se = parseSeasonEpisode(m.filename || "");
                return se && se.season === season && se.episode === episode;
            });
            await Promise.all(matches.map(m => unlockCloudMagnet(apiKey, m.id, streams)));
            episodeVersionsHandled = true;
        }

        if (resolvedId && resolvedId.startsWith("ad_cloud:")) {
            // Fichier déjà présent dans le cloud Alldebrid : on récupère son arborescence de fichiers/liens
            const magnetId = resolvedId.replace("ad_cloud:", "");
            await unlockCloudMagnet(apiKey, magnetId, streams);
        } else if (!movieVersionsHandled && !episodeVersionsHandled && cacheEnabled) {
            // Recherche via Torrentio, puis on "upload" les magnets trouvés sur Alldebrid.
            // Si le magnet est déjà en cache côté Alldebrid (ready:true), le lien est instantané —
            // sinon Alldebrid commence à le télécharger sur ses serveurs (pas sur les tiens).
            // NB : chaque vérification ajoute le magnet à la liste de ton compte Alldebrid
            // (limite de 30 magnets actifs). C'est le fonctionnement standard des addons debrid.
            const torrentioUrl = `https://torrentio.strem.fun/stream/${type}/${id}.json`;
            const [torrentioRes, prowlarrHashes] = await Promise.all([
                axios.get(torrentioUrl).catch((e) => {
                    console.error("Erreur Torrentio:", e.message);
                    return null;
                }),
                (async () => {
                    if (!prowlarrKey || prowlarrKey === "off") return [];
                    const baseTtId = id.split(":")[0];
                    const seParts = id.includes(":") ? id.split(":").slice(1) : null;
                    const title = await imdbIdToTitle(baseTtId, tmdbKeyForSearch);
                    if (!title) return [];
                    const query = seParts ? `${title} S${String(seParts[0]).padStart(2, "0")}E${String(seParts[1]).padStart(2, "0")}` : title;
                    return searchProwlarr(query, prowlarrKey);
                })()
            ]);

            const torrentioHashes = (torrentioRes && torrentioRes.data && torrentioRes.data.streams) ? torrentioRes.data.streams.map(s => s.infoHash).filter(Boolean) : [];
            const hashes = [...new Set([...torrentioHashes, ...prowlarrHashes])].slice(0, 5);
            {

                if (hashes.length > 0) {
                    const uploadParams = hashes.map(h => `magnets[]=${encodeURIComponent(h)}`).join("&");
                    const uploadRes = await axios.get(`${AD_BASE}/magnet/upload?${uploadParams}`, { headers: adHeaders(apiKey) }).catch((e) => {
                        console.error("Erreur magnet/upload:", e.response ? JSON.stringify(e.response.data) : e.message);
                        return null;
                    });

                    const uploadedMagnets = uploadRes && uploadRes.data && uploadRes.data.data && uploadRes.data.data.magnets;
                    const readyIds = (uploadedMagnets || []).filter(m => m.ready && m.id).map(m => m.id);
                    const allUploadedIds = (uploadedMagnets || []).filter(m => m.id).map(m => m.id);

                    // Tout en parallèle : c'est ce qui évite les recherches "trop longues" qui n'affichaient rien
                    await Promise.all(readyIds.map(async (magId) => {
                        const filesRes = await adPost(`${AD_BASE}/magnet/files`, apiKey, [["id[]", magId]]).catch(() => null);
                        const magnetData = filesRes && filesRes.data && filesRes.data.data && filesRes.data.data.magnets && filesRes.data.data.magnets[0];
                        if (!magnetData || !magnetData.files) return;

                        const files = flattenFiles(magnetData.files).filter(f => f.l && isRealVideoFile(f.n));
                        await Promise.all(files.map(async (file) => {
                            const unlockRes = await adPost(`${AD_BASE}/link/unlock`, apiKey, [["link", file.l]]).catch(() => null);
                            if (unlockRes && unlockRes.data && unlockRes.data.status === "success" && unlockRes.data.data && unlockRes.data.data.link) {
                                streams.push({
                                    name: "Cache Global ⚡",
                                    title: buildStreamTitle(file.n, file.s, "▶️ Lecture instantanée"),
                                    url: unlockRes.data.data.link,
                                    _size: file.s || 0
                                });
                            }
                        }));
                    }));

                    // Nettoyage : on retire les magnets ajoutés uniquement pour cette recherche, une fois
                    // les liens de lecture récupérés. EXPÉRIMENTAL : à vérifier que le lien reste jouable
                    // après suppression (pas garanti à 100% par Alldebrid).
                    Promise.all(allUploadedIds.map(magId =>
                        axios.get(`${AD_BASE}/magnet/delete?id=${magId}`, { headers: adHeaders(apiKey) }).catch((e) => {
                            console.error("Erreur magnet/delete:", e.response ? JSON.stringify(e.response.data) : e.message);
                        })
                    ));
                }
            }
        }
        res.json({ streams: sortByLangPref(streams, langPrefArray) });
    } catch (err) {
        console.error("Erreur stream:", err.response ? JSON.stringify(err.response.data) : err.message);
        res.json({ streams: [] });
    }
});

module.exports = app;

// Démarre un serveur HTTP classique quand le fichier est lancé directement (auto-hébergement local :
// "node index.js"). Sur Vercel, ce fichier est importé comme module et cette partie ne s'exécute pas —
// Vercel gère le serveur lui-même. C'est ce mode local qui permet à link/unlock de fonctionner, puisque
// la requête part alors de ta propre IP résidentielle et non d'un datacenter.
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Addon Alldebrid démarré sur http://localhost:${PORT}`);
        console.log(`Ouvre cette adresse dans ton navigateur pour générer ton lien Nuvio.`);
    });
}
