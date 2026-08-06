const express = require("express");
const axios = require("axios");
const app = express();

// Configuration des CORS obligatoires pour Nuvio
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "*");
    next();
});

const TMDB_KEY = "14cc580302bf1c4161bf96efb2165215";
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

// Aplatit l'arborescence de fichiers renvoyée par Alldebrid (n=nom, s=taille, l=lien, e=sous-dossier)
function flattenFiles(entries) {
    if (!Array.isArray(entries)) return [];
    return entries.flatMap(e => (e.e ? flattenFiles(e.e) : [e]));
}

// Recherche TMDB robuste pour l'affichage en français
async function getTmdbMetadata(filename, type) {
    try {
        let cleanName = filename
            .replace(/\.(mp4|mkv|avi|mov)$/i, "")
            .replace(/[\.\_]/g, " ")
            .replace(/(bluray|1080p|720p|4k|x264|h264|x265|hevc|vostfr|multi|french|truefrench)/gi, "")
            .trim();

        const tmdbType = (type === "movie") ? "movie" : "tv";
        const url = `https://api.themoviedb.org/3/search/${tmdbType}?api_key=${TMDB_KEY}&query=${encodeURIComponent(cleanName)}&language=fr-FR`;
        const res = await axios.get(url);

        if (res.data && res.data.results && res.data.results.length > 0) {
            const first = res.data.results[0];
            return {
                name: first.title || first.name || filename,
                poster: first.poster_path ? `https://image.tmdb.org/t/p/w500${first.poster_path}` : "https://placehold.co/300x450",
                description: first.overview || "Disponible dans ton Cloud Alldebrid."
            };
        }
    } catch (e) {
        console.error("Erreur TMDB:", e.message);
    }
    return { name: filename, poster: "https://placehold.co/300x450", description: "Fichier Cloud Alldebrid" };
}

// Page d'accueil web
app.get("/", (req, res) => {
    res.send(`
        <div style="font-family:sans-serif; padding:30px; max-width:400px; margin:auto; text-align:center; background:#f4f4f9; border-radius:10px; margin-top:50px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <h2 style="color:#e50914;">Mon Cloud Alldebrid Organisé</h2>
            <p style="color:#333;">Entre ta clé API Alldebrid pour générer le lien de ton addon.</p>
            <input type="text" id="key" placeholder="Ta clé API Alldebrid" style="width:100%; padding:12px; margin-bottom:15px; border:1px solid #ccc; border-radius:5px; box-sizing:border-box;"><br>
            <button onclick="generate()" style="padding:12px 20px; background:#e50914; color:white; border:none; border-radius:5px; width:100%; font-weight:bold; cursor:pointer;">Générer le lien Nuvio</button>
            <div id="box" style="display:none; margin-top:25px; padding:15px; background:#fff; border:1px dashed #007bff; border-radius:5px;">
                <p style="margin:0 0 10px 0; font-size:14px; color:#555;">Copie ce lien et colle-le dans Nuvio :</p>
                <p id="result" style="word-break:break-all; color:#007bff; font-weight:bold; margin:0; font-size:13px;"></p>
            </div>
        </div>
        <script>
            function generate() {
                const key = document.getElementById("key").value.trim();
                if(!key) return alert("Veuillez entrer une clé valide");
                const link = window.location.origin + "/" + key + "/manifest.json";
                document.getElementById("box").style.display = "block";
                document.getElementById("result").innerText = link;
            }
        </script>
    `);
});

// Le Manifeste officiel pour Nuvio
app.get("/:apiKey/manifest.json", (req, res) => {
    res.json({
        id: "org.nuviofork.alldebrid.addon",
        version: "6.6.3",
        name: "Cloud Alldebrid Organisé",
        description: "Affiche tes torrents Alldebrid triés en Films, Séries et Animes avec synopsis FR.",
        resources: ["catalog", "stream"],
        types: ["movie", "series"],
        catalogs: [
            { type: "movie", id: "my_ad_movies", name: "Mes Films Alldebrid" },
            { type: "series", id: "my_ad_series", name: "Mes Séries Alldebrid" },
            { type: "series", id: "my_ad_animes", name: "Mes Animes Alldebrid" }
        ],
        idPrefixes: ["ad_cloud:", "tt"]
    });
});

// Le Gestionnaire de Catalogues
app.get("/:apiKey/catalog/:type/:id.json", async (req, res) => {
    const { apiKey, id, type } = req.params;
    try {
        // Nouvelle API : /v4.1/magnet/status + auth via header Authorization Bearer
        const url = `${AD_BASE_V41}/magnet/status`;
        const response = await axios.get(url, { headers: adHeaders(apiKey) });

        if (!response.data || response.data.status !== "success" || !response.data.data || !response.data.data.magnets) {
            console.error("Réponse inattendue magnet/status:", JSON.stringify(response.data));
            return res.json({ metas: [] });
        }

        const magnets = response.data.data.magnets;
        let metas = [];
        const itemsToProcess = magnets.slice(0, 15);

        for (const item of itemsToProcess) {
            const title = (item.filename || "").toLowerCase();
            const isAnime = title.includes("vostfr") || (title.includes("[") && title.includes("]"));
            const isSeries = title.match(/s\d+e\d+/) || title.includes("season") || item.statusCode === 3;

            let match = false;
            let currentType = "movie";

            if (id === "my_ad_animes" && isAnime) { match = true; currentType = "series"; }
            else if (id === "my_ad_series" && isSeries && !isAnime) { match = true; currentType = "series"; }
            else if (id === "my_ad_movies" && !isSeries && !isAnime) { match = true; currentType = "movie"; }

            if (match) {
                const tmdb = await getTmdbMetadata(item.filename, currentType);
                metas.push({
                    id: `ad_cloud:${item.id}`,
                    type: type,
                    name: tmdb.name,
                    poster: tmdb.poster,
                    description: tmdb.description
                });
            }
        }
        res.json({ metas: metas });
    } catch (err) {
        console.error("Erreur catalog:", err.response ? JSON.stringify(err.response.data) : err.message);
        res.json({ metas: [] });
    }
});

// Le Gestionnaire de Streams
app.get("/:apiKey/stream/:type/:id.json", async (req, res) => {
    const { apiKey, type, id } = req.params;
    let streams = [];
    try {
        if (id && id.startsWith("ad_cloud:")) {
            // Fichier déjà présent dans le cloud Alldebrid : on récupère son arborescence de fichiers/liens
            const magnetId = id.replace("ad_cloud:", "");
            const filesUrl = `${AD_BASE}/magnet/files?id[]=${magnetId}`;
            const filesRes = await axios.get(filesUrl, { headers: adHeaders(apiKey) });

            const magnetData = filesRes.data && filesRes.data.data && filesRes.data.data.magnets && filesRes.data.data.magnets[0];

            if (magnetData && magnetData.files) {
                const files = flattenFiles(magnetData.files);
                for (const file of files) {
                    if (!file.l) continue;
                    const unlockUrl = `${AD_BASE}/link/unlock?link=${encodeURIComponent(file.l)}`;
                    const unlockRes = await axios.get(unlockUrl, { headers: adHeaders(apiKey) }).catch((e) => {
                        console.error("Erreur unlock:", e.response ? JSON.stringify(e.response.data) : e.message);
                        return null;
                    });
                    if (unlockRes && unlockRes.data && unlockRes.data.status === "success" && unlockRes.data.data && unlockRes.data.data.link) {
                        streams.push({ name: "Mon Cloud ☁️", title: file.n, url: unlockRes.data.data.link });
                    }
                }
            }
        } else {
            // Recherche via Torrentio puis vérification du cache Alldebrid.
            // NB: ce chemin dépend de /magnet/instant qui n'est plus documenté officiellement par
            // Alldebrid (peut-être retiré) — à tester séparément si tu veux cette fonctionnalité.
            const torrentioUrl = `https://torrentio.strem.fun/stream/${type}/${id}.json`;
            const torrentioRes = await axios.get(torrentioUrl).catch(() => null);

            if (torrentioRes && torrentioRes.data && torrentioRes.data.streams) {
                const hashes = torrentioRes.data.streams.map(s => s.infoHash).filter(Boolean).slice(0, 15);

                if (hashes.length > 0) {
                    const params = hashes.map(h => `magnets[]=${h}`).join("&");
                    const instantUrl = `${AD_BASE}/magnet/instant?${params}`;
                    const cacheCheck = await axios.get(instantUrl, { headers: adHeaders(apiKey) }).catch((e) => {
                        console.error("Erreur magnet/instant:", e.response ? JSON.stringify(e.response.data) : e.message);
                        return null;
                    });

                    if (cacheCheck && cacheCheck.data && cacheCheck.data.data && cacheCheck.data.data.magnets) {
                        for (const mag of cacheCheck.data.data.magnets) {
                            if (!mag.instant || !mag.files) continue;
                            const files = flattenFiles(mag.files);
                            for (const file of files) {
                                if (!file.l) continue;
                                const unlockUrl = `${AD_BASE}/link/unlock?link=${encodeURIComponent(file.l)}`;
                                const unlockRes = await axios.get(unlockUrl, { headers: adHeaders(apiKey) }).catch(() => null);
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
        }
        res.json({ streams: streams });
    } catch (err) {
        console.error("Erreur stream:", err.response ? JSON.stringify(err.response.data) : err.message);
        res.json({ streams: [] });
    }
});

module.exports = app;
