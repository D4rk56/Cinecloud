const express = require("express");
const axios = require("axios");
const app = express();
app.set("etag", false); // Désactive la génération d'ETag par Express (source des réponses 304 observées)

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

// Construit un catalogue de recommandations à partir des genres les plus fréquents de la bibliothèque
async function getRecommendations(magnets, type, tmdbKey) {
    const genreCounts = {};
    const sample = magnets.slice(0, 10);
    for (const item of sample) {
        const tmdb = await getTmdbMetadata(item.filename, type, tmdbKey);
        for (const g of tmdb.genreIds) genreCounts[g] = (genreCounts[g] || 0) + 1;
    }
    const topGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([g]) => g);
    if (topGenres.length === 0) return [];

    try {
        const tmdbType = (type === "movie") ? "movie" : "tv";
        const discoverUrl = `https://api.themoviedb.org/3/discover/${tmdbType}?api_key=${tmdbKey}&with_genres=${topGenres.join(",")}&sort_by=popularity.desc&language=fr-FR`;
        const discoverRes = await axios.get(discoverUrl);
        const results = (discoverRes.data && discoverRes.data.results || []).slice(0, 15);

        const metas = [];
        for (const r of results) {
            const imdbId = await tmdbToImdbId(r.id, type, tmdbKey);
            if (!imdbId) continue;
            metas.push({
                id: imdbId,
                type: type,
                name: r.title || r.name,
                poster: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : "https://placehold.co/300x450",
                description: r.overview || ""
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
            <h2 style="color:#e50914;">Mon Cloud Alldebrid Organisé</h2>
            <p style="color:#333;">Entre ta clé API Alldebrid pour générer le lien de ton addon.</p>
            <input type="text" id="key" placeholder="Ta clé API Alldebrid" style="width:100%; padding:12px; margin-bottom:15px; border:1px solid #ccc; border-radius:5px; box-sizing:border-box;"><br>
            <input type="text" id="tmdbKey" placeholder="Ta clé API TMDB (optionnel)" style="width:100%; padding:12px; margin-bottom:5px; border:1px solid #ccc; border-radius:5px; box-sizing:border-box;"><br>
            <p style="margin:0 0 15px 0; font-size:12px; color:#888; text-align:left;">Laisse vide pour utiliser la clé par défaut. Clé gratuite sur <a href="https://www.themoviedb.org/settings/api" target="_blank">themoviedb.org/settings/api</a>.</p>
            <label style="display:flex; align-items:center; gap:8px; margin-bottom:15px; font-size:13px; color:#333; text-align:left;">
                <input type="checkbox" id="cacheToggle" checked style="width:16px; height:16px;">
                Activer le Cache Global (torrents publics en cache Alldebrid — ajoute les magnets vérifiés à ton compte)
            </label>
            <button onclick="generate()" style="padding:12px 20px; background:#e50914; color:white; border:none; border-radius:5px; width:100%; font-weight:bold; cursor:pointer;">Générer le lien Nuvio</button>
            <div id="box" style="display:none; margin-top:25px; padding:15px; background:#fff; border:1px dashed #007bff; border-radius:5px;">
                <p style="margin:0 0 10px 0; font-size:14px; color:#555;">Copie ce lien et colle-le dans Nuvio :</p>
                <p id="result" style="word-break:break-all; color:#007bff; font-weight:bold; margin:0; font-size:13px;"></p>
            </div>
        </div>
        <script>
            function generate() {
                const key = document.getElementById("key").value.trim();
                const tmdbKey = document.getElementById("tmdbKey").value.trim();
                const cacheOn = document.getElementById("cacheToggle").checked;
                if(!key) return alert("Veuillez entrer une clé valide");
                const link = window.location.origin + "/" + key + "/" + (tmdbKey || "default") + "/" + (cacheOn ? "on" : "off") + "/manifest.json";
                document.getElementById("box").style.display = "block";
                document.getElementById("result").innerText = link;
            }
        </script>
    `);
});

// Le Manifeste officiel pour Nuvio
app.get("/:apiKey/:tmdbKey/:cacheMode/manifest.json", (req, res) => {
    res.json({
        id: "org.nuviofork.alldebrid.addon",
        version: "6.8.0",
        name: "Cloud Alldebrid Organisé",
        description: "Affiche tes torrents Alldebrid triés en Films, Séries et Animes avec synopsis FR, plus des recommandations.",
        resources: [
            "catalog",
            { name: "meta", types: ["movie", "series"], idPrefixes: ["ad_cloud:", "ad_series:"] },
            { name: "stream", types: ["movie", "series"], idPrefixes: ["ad_cloud:", "ad_series:", "tt"] }
        ],
        types: ["movie", "series"],
        catalogs: [
            { type: "movie", id: "my_ad_movies", name: "Mes Films Alldebrid" },
            { type: "series", id: "my_ad_series", name: "Mes Séries Alldebrid" },
            { type: "series", id: "my_ad_animes", name: "Mes Animes Alldebrid" },
            { type: "movie", id: "my_ad_reco_movies", name: "Recommandations Films" },
            { type: "series", id: "my_ad_reco_series", name: "Recommandations Séries" }
        ],
        idPrefixes: ["ad_cloud:", "ad_series:", "tt"]
    });
});

// Le Gestionnaire de Métadonnées (page de détails) — nécessaire pour nos propres ids ad_cloud:,
// que ni AIOMetadata ni Cinemeta ne peuvent résoudre puisqu'ils ne les connaissent pas.
app.get("/:apiKey/:tmdbKey/:cacheMode/meta/:type/:id.json", async (req, res) => {
    const { apiKey, id, type } = req.params;
    const tmdbKey = (req.params.tmdbKey && req.params.tmdbKey !== "default") ? req.params.tmdbKey : TMDB_KEY_DEFAULT;
    try {
        if (id.startsWith("ad_series:")) {
            // Fiche d'une série : on reconstruit la liste d'épisodes à partir du compte Alldebrid actuel
            const groupTitle = decodeURIComponent(id.replace("ad_series:", ""));
            const statusRes = await axios.get(`${AD_BASE_V41}/magnet/status`, { headers: adHeaders(apiKey) });
            const magnets = (statusRes.data && statusRes.data.data && statusRes.data.data.magnets) || [];

            const episodes = magnets.filter(m => extractCleanTitle(m.filename || "").title.toLowerCase() === groupTitle.toLowerCase());
            if (episodes.length === 0) return res.json({ meta: null });

            const tmdb = await getTmdbMetadata(episodes[0].filename, "series", tmdbKey, true);
            const videos = episodes.map(ep => {
                const se = parseSeasonEpisode(ep.filename) || { season: 1, episode: 1 };
                return {
                    id: `ad_series:${encodeURIComponent(groupTitle)}:${se.season}:${se.episode}`,
                    title: `S${se.season}E${se.episode}`,
                    season: se.season,
                    episode: se.episode,
                    released: new Date(2020, 0, 1).toISOString()
                };
            }).sort((a, b) => a.season - b.season || a.episode - b.episode);

            return res.json({
                meta: {
                    id: id,
                    type: "series",
                    name: tmdb.name,
                    poster: tmdb.poster,
                    background: tmdb.poster,
                    description: tmdb.description,
                    genres: tmdb.genres,
                    cast: tmdb.cast,
                    imdbRating: tmdb.imdbRating,
                    videos: videos
                }
            });
        }

        if (!id.startsWith("ad_cloud:")) return res.json({ meta: null });
        const magnetId = id.replace("ad_cloud:", "");
        const statusRes = await axios.get(`${AD_BASE_V41}/magnet/status`, {
            headers: adHeaders(apiKey),
            params: { id: magnetId }
        });
        const magnetData = statusRes.data && statusRes.data.data && statusRes.data.data.magnets;
        const magnet = Array.isArray(magnetData) ? magnetData[0] : magnetData;
        if (!magnet || !magnet.filename) return res.json({ meta: null });

        const tmdb = await getTmdbMetadata(magnet.filename, type, tmdbKey, true);
        res.json({
            meta: {
                id: id,
                type: type,
                name: tmdb.name,
                poster: tmdb.poster,
                background: tmdb.poster,
                description: tmdb.description,
                genres: tmdb.genres,
                cast: tmdb.cast,
                imdbRating: tmdb.imdbRating
            }
        });
    } catch (err) {
        console.error("Erreur meta:", err.response ? JSON.stringify(err.response.data) : err.message);
        res.json({ meta: null });
    }
});

// Le Gestionnaire de Catalogues
app.get("/:apiKey/:tmdbKey/:cacheMode/catalog/:type/:id.json", async (req, res) => {
    const { apiKey, id, type } = req.params;
    const tmdbKey = (req.params.tmdbKey && req.params.tmdbKey !== "default") ? req.params.tmdbKey : TMDB_KEY_DEFAULT;
    try {
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
            const metas = await getRecommendations(relevant, wantSeries ? "series" : "movie", tmdbKey);
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
            const groupList = [...groups.entries()].slice(0, 60);
            metas = await Promise.all(groupList.map(async ([groupTitle, episodes]) => {
                const tmdb = await getTmdbMetadata(episodes[0].filename, "series", tmdbKey);
                return {
                    id: `ad_series:${encodeURIComponent(groupTitle)}`,
                    type: type,
                    name: tmdb.name,
                    poster: tmdb.poster,
                    description: tmdb.description
                };
            }));
        } else {
            // Cap raisonnable pour éviter un timeout Vercel (fonctions gratuites limitées en durée) et le rate-limit TMDB
            const itemsToProcess = matched.slice(0, 60);
            metas = await Promise.all(itemsToProcess.map(async ({ item, currentType }) => {
                const tmdb = await getTmdbMetadata(item.filename, currentType, tmdbKey);
                return {
                    id: `ad_cloud:${item.id}`,
                    type: type,
                    name: tmdb.name,
                    poster: tmdb.poster,
                    description: tmdb.description
                };
            }));
        }
        res.json({ metas: metas });
    } catch (err) {
        console.error("Erreur catalog:", err.response ? JSON.stringify(err.response.data) : err.message);
        res.json({ metas: [] });
    }
});

// Le Gestionnaire de Streams
app.get("/:apiKey/:tmdbKey/:cacheMode/stream/:type/:id.json", async (req, res) => {
    const { apiKey, type, id, cacheMode } = req.params;
    const cacheEnabled = cacheMode !== "off";
    let streams = [];
    try {
        let resolvedId = id;

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
            const filesRes = await adPost(`${AD_BASE}/magnet/files`, apiKey, [["id[]", magnetId]]).catch((e) => {
                console.error("Erreur magnet/files:", e.response ? JSON.stringify(e.response.data) : e.message);
                return null;
            });

            // LOG DIAGNOSTIC TEMPORAIRE — à retirer une fois le format de réponse confirmé
            console.log("DEBUG magnet/files:", filesRes ? JSON.stringify(filesRes.data).slice(0, 1500) : "pas de réponse");

            const magnetData = filesRes && filesRes.data && filesRes.data.data && filesRes.data.data.magnets && filesRes.data.data.magnets[0];

            if (magnetData && magnetData.files) {
                const files = flattenFiles(magnetData.files);
                for (const file of files) {
                    if (!file.l) continue;
                    const unlockRes = await adPost(`${AD_BASE}/link/unlock`, apiKey, [["link", file.l]]).catch((e) => {
                        console.error("Erreur unlock:", e.response ? JSON.stringify(e.response.data) : e.message);
                        return null;
                    });
                    // LOG DIAGNOSTIC TEMPORAIRE — dernière étape encore non vérifiée
                    console.log("DEBUG link/unlock:", unlockRes ? JSON.stringify(unlockRes.data).slice(0, 1000) : "pas de réponse");
                    if (unlockRes && unlockRes.data && unlockRes.data.status === "success" && unlockRes.data.data && unlockRes.data.data.link) {
                        streams.push({ name: "Mon Cloud ☁️", title: file.n, url: unlockRes.data.data.link });
                    }
                }
            }
        } else if (cacheEnabled) {
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

            // LOG DIAGNOSTIC TEMPORAIRE
            console.log("DEBUG Torrentio streams trouvés:", torrentioRes && torrentioRes.data && torrentioRes.data.streams ? torrentioRes.data.streams.length : "0 ou erreur");

            if (torrentioRes && torrentioRes.data && torrentioRes.data.streams) {
                const hashes = [...new Set(torrentioRes.data.streams.map(s => s.infoHash).filter(Boolean))].slice(0, 10);

                if (hashes.length > 0) {
                    const uploadRes = await adPost(`${AD_BASE}/magnet/upload`, apiKey, hashes.map(h => ["magnets[]", h])).catch((e) => {
                        console.error("Erreur magnet/upload:", e.response ? JSON.stringify(e.response.data) : e.message);
                        return null;
                    });

                    // LOG DIAGNOSTIC TEMPORAIRE
                    console.log("DEBUG magnet/upload:", uploadRes ? JSON.stringify(uploadRes.data).slice(0, 1500) : "pas de réponse");

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
        res.json({ streams: streams });
    } catch (err) {
        console.error("Erreur stream:", err.response ? JSON.stringify(err.response.data) : err.message);
        res.json({ streams: [] });
    }
});

module.exports = app;
