const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const app = express();
app.set("etag", false); // Désactive la génération d'ETag par Express (source de réponses 304 en cache observées)

// --- Cache local (fichier JSON sur disque, aucune base de données externe nécessaire) ---
// Mappe les vrais ids IMDb ("tt...") vers le contenu correspondant dans ton compte Alldebrid.
// Permet une intégration TMDB/Cinemeta/MDBList/autres addons native (posters, notes, casting,
// ET liens de tous tes autres addons installés) sans relancer une recherche TMDB à chaque clic.
const CACHE_DIR = path.join(__dirname, "data");
const CACHE_FILE = path.join(CACHE_DIR, "id-cache.json");

function loadCache() {
    try {
        const cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
        // Rétrocompatibilité : l'ancien format stockait un seul objet par film, on passe à un tableau
        // pour supporter plusieurs versions (langues) d'un même film.
        for (const key in cache.movies || {}) {
            if (!Array.isArray(cache.movies[key])) cache.movies[key] = [cache.movies[key]];
        }
        if (!cache.movies) cache.movies = {};
        if (!cache.series) cache.series = {};
        return cache;
    } catch (e) {
        return { movies: {}, series: {} };
    }
}

function saveCache(cache) {
    try {
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

// Détecte le tag de langue d'un nom de fichier. "vf" est cherché en dehors de "vff"/"vfq"
// pour ne pas les confondre (vff contient "vf" comme sous-chaîne).
function detectLangTag(filename) {
    const t = (filename || "").toLowerCase();
    const hasMulti = /\bmulti\b/.test(t);
    const hasVff = /\bvff\b/.test(t);
    const hasVfq = /\bvfq\b/.test(t);
    const hasVf = /\bvf\b/.test(t) && !hasVff && !hasVfq;
    const hasVostfr = /\bvostfr\b/.test(t);
    const hasFrench = /\b(french|truefrench)\b/.test(t);

    if (hasMulti && hasVff) return "multi_vff";
    if (hasMulti) return "multi";
    if (hasVff) return "vff";
    if (hasVfq) return "vfq";
    if (hasVf || hasFrench) return "vf";
    if (hasVostfr) return "vostfr";
    return "other";
}

// Trie un tableau de streams selon l'ordre de préférence de langue choisi par l'utilisateur
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
        .sort((a, b) => (a.r - b.r) || (a.i - b.i))
        .map(x => x.s);
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
    let name = filename
        .replace(/\.(mp4|mkv|avi|mov)$/i, "")
        .replace(/[\.\_]/g, " ")
        .trim();

    const cutMarkers = /\b(19\d{2}|20\d{2}|S\d{1,2}(E\d{1,3})?|SAISON\s?\d{1,2}|COMPLETE|MULTI|VOSTFR|VF2?|FRENCH|TRUEFRENCH|SUBFRENCH|2160p|1080p|720p|480p|4K|UHD|HDR|DV|WEB[\-\.]?DL|WEBRIP|BLURAY|BDRIP|HDTV|REMUX|x264|x265|h264|h265|HEVC|AAC|DTS|ATMOS)\b/i;
    const match = name.match(cutMarkers);
    let title = match ? name.slice(0, match.index) : name;

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
    return { name: filename, poster: "https://placehold.co/300x450", description: "Fichier Cloud Alldebrid", genreIds: [], genres: [], cast: [], imdbRating: null, tmdbId: null };
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
async function getRecommendations(magnets, historyFilenames, type, tmdbKey) {
    const genreCounts = {};
    const knownTmdbIds = new Set();
    const genreLabels = {};

    const sampleLibrary = magnets.slice(0, 8);
    const sampleHistory = historyFilenames.slice(0, 8);

    for (const filename of [...sampleLibrary.map(m => m.filename), ...sampleHistory]) {
        const tmdb = await getTmdbMetadata(filename, type, tmdbKey);
        if (tmdb.tmdbId) knownTmdbIds.add(tmdb.tmdbId);
        for (const g of tmdb.genreIds) genreCounts[g] = (genreCounts[g] || 0) + 1;
    }
    const topGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([g]) => g);
    if (topGenres.length === 0) return [];

    try {
        const tmdbType = (type === "movie") ? "movie" : "tv";
        // Récupère les noms de genres pour les afficher dans la description (traçabilité de la recommandation)
        const genreListUrl = `https://api.themoviedb.org/3/genre/${tmdbType}/list?api_key=${tmdbKey}&language=fr-FR`;
        const genreListRes = await axios.get(genreListUrl).catch(() => null);
        const genreNameById = {};
        ((genreListRes && genreListRes.data && genreListRes.data.genres) || []).forEach(g => { genreNameById[g.id] = g.name; });
        const topGenreNames = topGenres.map(g => genreNameById[g]).filter(Boolean).join(", ");

        const discoverUrl = `https://api.themoviedb.org/3/discover/${tmdbType}?api_key=${tmdbKey}&with_genres=${topGenres.join(",")}&sort_by=popularity.desc&language=fr-FR`;
        const discoverRes = await axios.get(discoverUrl);
        const results = (discoverRes.data && discoverRes.data.results || []).filter(r => !knownTmdbIds.has(r.id)).slice(0, 15);

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
            </div>
            <button onclick="generate()" style="padding:12px 20px; background:#e50914; color:white; border:none; border-radius:5px; width:100%; font-weight:bold; cursor:pointer;">Générer le lien Nuvio</button>
            <div id="box" style="display:none; margin-top:25px; padding:15px; background:#fff; border:1px dashed #007bff; border-radius:5px;">
                <p style="margin:0 0 10px 0; font-size:14px; color:#555;">Copie ce lien et colle-le dans Nuvio :</p>
                <p id="result" style="word-break:break-all; color:#007bff; font-weight:bold; margin:0; font-size:13px;"></p>
            </div>
        </div>
        <script>
            const LANG_OPTIONS = [
                { value: "multi_vff", label: "MULTI avec VFF" },
                { value: "multi", label: "MULTI" },
                { value: "vff", label: "VFF (Français France)" },
                { value: "vfq", label: "VFQ (Français Québec)" },
                { value: "vf", label: "VF / FRENCH" },
                { value: "vostfr", label: "VOSTFR" }
            ];
            const defaults = ["multi_vff", "multi", "vff", "vostfr"];
            ["lang1", "lang2", "lang3", "lang4"].forEach((id, i) => {
                const sel = document.getElementById(id);
                LANG_OPTIONS.forEach(opt => {
                    const o = document.createElement("option");
                    o.value = opt.value; o.textContent = (i + 1) + "er choix : " + opt.label;
                    sel.appendChild(o);
                });
                sel.value = defaults[i];
            });
            function generate() {
                const key = document.getElementById("key").value.trim();
                const tmdbKey = document.getElementById("tmdbKey").value.trim();
                const cacheOn = document.getElementById("cacheToggle").checked;
                const langPref = ["lang1","lang2","lang3","lang4"].map(id => document.getElementById(id).value).join(",");
                if(!key) return alert("Veuillez entrer une clé valide");
                const link = window.location.origin + "/" + key + "/" + (tmdbKey || "default") + "/" + (cacheOn ? "on" : "off") + "/" + encodeURIComponent(langPref) + "/manifest.json";
                document.getElementById("box").style.display = "block";
                document.getElementById("result").innerText = link;
            }
        </script>
    `);
});

// Le Manifeste officiel pour Nuvio
app.get("/:apiKey/:tmdbKey/:cacheMode/:langPref/manifest.json", (req, res) => {
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
        catalogs: [
            { type: "movie", id: "my_ad_movies", name: "Mes Films Alldebrid" },
            { type: "series", id: "my_ad_series", name: "Mes Séries Alldebrid" },
            { type: "series", id: "my_ad_animes", name: "Mes Animes Alldebrid" },
            { type: "movie", id: "my_ad_links", name: "Mes Liens Alldebrid" },
            { type: "movie", id: "my_ad_history", name: "Historique Alldebrid" },
            { type: "movie", id: "my_ad_reco_movies", name: "Recommandations Films" },
            { type: "series", id: "my_ad_reco_series", name: "Recommandations Séries" }
        ],
        idPrefixes: ["ad_cloud:", "ad_series:", "ad_link:", "tt"]
    });
});

// Le Gestionnaire de Métadonnées (page de détails). On répond nous-mêmes pour ad_cloud:/ad_series:
// (ids qu'aucun autre addon ne connaît) MAIS AUSSI pour les vrais ids tt: qu'on a résolus, afin de
// fournir des fiches en français via TMDB plutôt que de laisser Cinemeta répondre (souvent en anglais).
app.get("/:apiKey/:tmdbKey/:cacheMode/:langPref/meta/:type/:id.json", async (req, res) => {
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
                    id: id, type: "series", name: tmdb.name, poster: tmdb.poster, background: tmdb.poster,
                    description: tmdb.description, genres: tmdb.genres, cast: tmdb.cast, imdbRating: tmdb.imdbRating,
                    videos: videos
                }
            });
        }

        // --- Fichier depuis "Mes Liens" ou "Historique" : id ad_link: (lien Alldebrid encodé en base64) ---
        if (id.startsWith("ad_link:")) {
            const originalLink = Buffer.from(id.replace("ad_link:", ""), "base64url").toString();
            const infosRes = await adPost(`${AD_BASE}/link/infos`, apiKey, [["link", originalLink]]).catch(() => null);
            const info = infosRes && infosRes.data && infosRes.data.data && infosRes.data.data[0];
            if (!info || !info.filename) return res.json({ meta: null });

            const tmdb = await getTmdbMetadata(info.filename, "movie", tmdbKey, true);
            return res.json({
                meta: {
                    id: id, type: "movie", name: tmdb.name, poster: tmdb.poster, background: tmdb.poster,
                    description: tmdb.description, genres: tmdb.genres, cast: tmdb.cast, imdbRating: tmdb.imdbRating
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
                id: id, type: type, name: tmdb.name, poster: tmdb.poster, background: tmdb.poster,
                description: tmdb.description, genres: tmdb.genres, cast: tmdb.cast, imdbRating: tmdb.imdbRating
            }
        });
    } catch (err) {
        console.error("Erreur meta:", err.response ? JSON.stringify(err.response.data) : err.message);
        res.json({ meta: null });
    }
});

// Le Gestionnaire de Catalogues
app.get("/:apiKey/:tmdbKey/:cacheMode/:langPref/catalog/:type/:id.json", async (req, res) => {
    const { apiKey, id, type } = req.params;
    const tmdbKey = (req.params.tmdbKey && req.params.tmdbKey !== "default") ? req.params.tmdbKey : TMDB_KEY_DEFAULT;
    try {
        // Catalogues "Liens" (sauvegardés manuellement) et "Historique" (récemment lus) —
        // ne viennent pas de magnet/status mais de deux endpoints Alldebrid dédiés.
        if (id === "my_ad_links" || id === "my_ad_history") {
            const endpoint = id === "my_ad_links" ? "user/links" : "user/history";
            const linksRes = await axios.get(`${AD_BASE}/${endpoint}`, { headers: adHeaders(apiKey) }).catch((e) => {
                console.error(`Erreur ${endpoint}:`, e.response ? JSON.stringify(e.response.data) : e.message);
                return null;
            });
            const links = (linksRes && linksRes.data && linksRes.data.data && linksRes.data.data.links) || [];
            const itemsToProcess = links.filter(l => l.filename).slice(0, 300);

            const metas = await Promise.all(itemsToProcess.map(async (l) => {
                const tmdb = await getTmdbMetadata(l.filename, "movie", tmdbKey);
                return {
                    id: `ad_link:${Buffer.from(l.link).toString("base64url")}`,
                    type: "movie",
                    name: tmdb.name,
                    poster: tmdb.poster,
                    description: tmdb.description
                };
            }));
            return res.json({ metas: metas });
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
        if (id === "my_ad_reco_movies" || id === "my_ad_reco_series") {
            const wantSeries = (id === "my_ad_reco_series");
            const relevant = magnets.filter(item => {
                const title = (item.filename || "").toLowerCase();
                const isSeries = title.match(/s\d{1,2}e\d{1,3}/) || title.match(/\bs\d{1,2}\b/) || title.includes("season") || title.includes("saison") || item.statusCode === 3;
                return wantSeries ? isSeries : !isSeries;
            });
            const historyFilenames = await getAlldebridHistory(apiKey);
            const metas = await getRecommendations(relevant, historyFilenames, wantSeries ? "series" : "movie", tmdbKey);
            return res.json({ metas: metas });
        }

        // On filtre d'abord TOUS les torrents qui correspondent à ce catalogue (plus de limite à 15).
        const matched = [];
        for (const item of magnets) {
            const title = (item.filename || "").toLowerCase();
            const isAnime = title.includes("vostfr");
            const isSeries = title.match(/s\d{1,2}e\d{1,3}/) || title.match(/\bs\d{1,2}\b/) || title.includes("season") || title.includes("saison") || item.statusCode === 3;

            if (id === "my_ad_animes" && isAnime) matched.push({ item, currentType: "series" });
            else if (id === "my_ad_series" && isSeries && !isAnime) matched.push({ item, currentType: "series" });
            else if (id === "my_ad_movies" && !isSeries && !isAnime) matched.push({ item, currentType: "movie" });
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
            const cache = loadCache();
            let cacheChanged = false;

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

            if (cacheChanged) saveCache(cache);
        } else {
            // Plus de limite basse : en auto-hébergement il n'y a pas de timeout serveur imposé.
            // On garde un plafond haut par sécurité (rate-limit TMDB), ajustable si besoin.
            const itemsToProcess = matched.slice(0, 300);
            const cache = loadCache();
            let cacheChanged = false;

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

            if (cacheChanged) saveCache(cache);
        }
        res.json({ metas: metas });
    } catch (err) {
        console.error("Erreur catalog:", err.response ? JSON.stringify(err.response.data) : err.message);
        res.json({ metas: [] });
    }
});

async function unlockCloudMagnet(apiKey, magnetId, streams) {
    const filesRes = await adPost(`${AD_BASE}/magnet/files`, apiKey, [["id[]", magnetId]]).catch((e) => {
        console.error("Erreur magnet/files:", e.response ? JSON.stringify(e.response.data) : e.message);
        return null;
    });
    const magnetData = filesRes && filesRes.data && filesRes.data.data && filesRes.data.data.magnets && filesRes.data.data.magnets[0];
    if (!magnetData || !magnetData.files) return;

    const files = flattenFiles(magnetData.files);
    for (const file of files) {
        if (!file.l) continue;
        const unlockRes = await adPost(`${AD_BASE}/link/unlock`, apiKey, [["link", file.l]]).catch((e) => {
            console.error("Erreur unlock:", e.response ? JSON.stringify(e.response.data) : e.message);
            return null;
        });
        if (unlockRes && unlockRes.data && unlockRes.data.status === "success" && unlockRes.data.data && unlockRes.data.data.link) {
            streams.push({ name: "Mon Cloud ☁️", title: file.n, url: unlockRes.data.data.link });
        }
    }
}

// Le Gestionnaire de Streams
app.get("/:apiKey/:tmdbKey/:cacheMode/:langPref/stream/:type/:id.json", async (req, res) => {
    const { apiKey, type, id, cacheMode, langPref } = req.params;
    const cacheEnabled = cacheMode !== "off";
    const langPrefArray = langPref ? decodeURIComponent(langPref).split(",").filter(Boolean) : ["multi_vff", "multi", "vff", "vostfr"];
    let streams = [];
    try {
        let resolvedId = id;
        const cache = loadCache();

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
                const match = magnets.find(m => {
                    if (extractCleanTitle(m.filename || "").title.toLowerCase() !== groupTitle.toLowerCase()) return false;
                    const se = parseSeasonEpisode(m.filename || "");
                    return se && se.season === season && se.episode === episode;
                });
                resolvedId = match ? `ad_cloud:${match.id}` : null;
            }
        }
        // Id tt d'un film déjà résolu : peut avoir plusieurs versions (langues) en cache
        let movieVersionsHandled = false;
        if (id && id.startsWith("tt") && !id.includes(":") && cache.movies[id]) {
            for (const version of cache.movies[id]) {
                await unlockCloudMagnet(apiKey, version.alldebridId, streams);
            }
            movieVersionsHandled = true;
        }

        // Fichier depuis "Mes Liens" ou "Historique" : déverrouillage direct, pas de magnet/files nécessaire
        if (id && id.startsWith("ad_link:")) {
            const originalLink = Buffer.from(id.replace("ad_link:", ""), "base64url").toString();
            const unlockRes = await adPost(`${AD_BASE}/link/unlock`, apiKey, [["link", originalLink]]).catch((e) => {
                console.error("Erreur unlock (ad_link):", e.response ? JSON.stringify(e.response.data) : e.message);
                return null;
            });
            if (unlockRes && unlockRes.data && unlockRes.data.status === "success" && unlockRes.data.data && unlockRes.data.data.link) {
                streams.push({ name: "Mon Cloud ☁️", title: unlockRes.data.data.filename || "Fichier Alldebrid", url: unlockRes.data.data.link });
            }
            return res.json({ streams: streams });
        }

        if (id && id.startsWith("ad_series:")) {
            // Format attendu : ad_series:<titre encodé>:<saison>:<episode>
            const parts = id.replace("ad_series:", "").split(":");
            const episode = parseInt(parts.pop(), 10);
            const season = parseInt(parts.pop(), 10);
            const groupTitle = decodeURIComponent(parts.join(":"));

            const statusRes = await axios.get(`${AD_BASE_V41}/magnet/status`, { headers: adHeaders(apiKey) }).catch(() => null);
            const magnets = (statusRes && statusRes.data && statusRes.data.data && statusRes.data.data.magnets) || [];
            const match = magnets.find(m => {
                if (extractCleanTitle(m.filename || "").title.toLowerCase() !== groupTitle.toLowerCase()) return false;
                const se = parseSeasonEpisode(m.filename || "");
                return se && se.season === season && se.episode === episode;
            });
            resolvedId = match ? `ad_cloud:${match.id}` : null;
        }

        if (resolvedId && resolvedId.startsWith("ad_cloud:")) {
            // Fichier déjà présent dans le cloud Alldebrid : on récupère son arborescence de fichiers/liens
            const magnetId = resolvedId.replace("ad_cloud:", "");
            await unlockCloudMagnet(apiKey, magnetId, streams);
        } else if (!movieVersionsHandled && cacheEnabled) {
            // Recherche via Torrentio, puis on "upload" les magnets trouvés sur Alldebrid.
            // Si le magnet est déjà en cache côté Alldebrid (ready:true), le lien est instantané —
            // sinon Alldebrid commence à le télécharger sur ses serveurs (pas sur les tiens).
            // NB : chaque vérification ajoute le magnet à la liste de ton compte Alldebrid
            // (limite de 30 magnets actifs). C'est le fonctionnement standard des addons debrid.
            const torrentioUrl = `https://torrentio.strem.fun/stream/${type}/${id}.json`;
            const torrentioRes = await axios.get(torrentioUrl).catch((e) => {
                console.error("Erreur Torrentio:", e.message);
                return null;
            });

            if (torrentioRes && torrentioRes.data && torrentioRes.data.streams) {
                const hashes = [...new Set(torrentioRes.data.streams.map(s => s.infoHash).filter(Boolean))].slice(0, 10);

                if (hashes.length > 0) {
                    const uploadParams = hashes.map(h => `magnets[]=${encodeURIComponent(h)}`).join("&");
                    const uploadRes = await axios.get(`${AD_BASE}/magnet/upload?${uploadParams}`, { headers: adHeaders(apiKey) }).catch((e) => {
                        console.error("Erreur magnet/upload:", e.response ? JSON.stringify(e.response.data) : e.message);
                        return null;
                    });

                    const uploadedMagnets = uploadRes && uploadRes.data && uploadRes.data.data && uploadRes.data.data.magnets;
                    const readyIds = (uploadedMagnets || []).filter(m => m.ready && m.id).map(m => m.id);

                    for (const magId of readyIds) {
                        const filesRes = await adPost(`${AD_BASE}/magnet/files`, apiKey, [["id[]", magId]]).catch(() => null);
                        const magnetData = filesRes && filesRes.data && filesRes.data.data && filesRes.data.data.magnets && filesRes.data.data.magnets[0];
                        if (!magnetData || !magnetData.files) continue;

                        const files = flattenFiles(magnetData.files);
                        for (const file of files) {
                            if (!file.l) continue;
                            const unlockRes = await adPost(`${AD_BASE}/link/unlock`, apiKey, [["link", file.l]]).catch(() => null);
                            if (unlockRes && unlockRes.data && unlockRes.data.status === "success" && unlockRes.data.data && unlockRes.data.data.link) {
                                streams.push({
                                    name: "Cache Global ⚡",
                                    title: `${file.n}\n▶️ Lecture instantanée`,
                                    url: unlockRes.data.data.link
                                });
                            }
                        }
                    }
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
