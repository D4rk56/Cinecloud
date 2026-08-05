const express = require("express");
const axios = require("axios");
const app = express();

// Autorisations CORS indispensables pour Nuvio et Lumio
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "*");
    res.setHeader("Cache-Control", "max-age=3600, public");
    next();
});

const TMDB_KEY = "14cc580302bf1c4161bf96efb2165215";
const AGENT = "StremioAlldebridAddon";

// Fonction TMDB corrigée et testée
async function getTmdbMetadata(filename, type) {
    try {
        let cleanName = filename.replace(/\.(mp4|mkv|avi|mov)$/i, "").replace(/[\.\_]/g, " ").replace(/(bluray|1080p|720p|4k|x264|h264|x265|hevc|vostfr|multi|french|truefrench)/gi, "").trim();
        const tmdbType = (type === "movie") ? "movie" : "tv";
        const res = await axios.get(`https://themoviedb.org{tmdbType}?api_key=${TMDB_KEY}&query=${encodeURIComponent(cleanName)}&language=fr-FR`);
        
        if (res.data && res.data.results && res.data.results.length > 0) {
            const first = res.data.results[0]; // Correction de l'index 0 validée
            return { 
                name: first.title || first.name || filename, 
                poster: first.poster_path ? `https://tmdb.org{first.poster_path}` : "https://placehold.co", 
                description: first.overview || "Fichier disponible dans ton Cloud Alldebrid."
            };
        }
    } catch (e) {
        console.error("Erreur TMDB:", e.message);
    }
    return { name: filename, poster: "https://placehold.co", description: "Fichier Cloud Alldebrid" };
}

// Page d'accueil web
app.get("/", (req, res) => {
    res.send(`
        <div style="font-family:sans-serif; padding:30px; max-width:400px; margin:auto; text-align:center; background:#f4f4f9; border-radius:10px; margin-top:50px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <h2 style="color:#e50914;">Mon Cloud Alldebrid Organisé</h2>
            <p style="color:#333;">Entre ta clé API Alldebrid pour générer le lien de ton addon.</p>
            <input type="text" id="key" placeholder="Ta clé API Alldebrid" style="width:100%; padding:12px; margin-bottom:15px; border:1px solid #ccc; border-radius:5px; box-sizing:border-box;"><br>
            <button onclick="generate()" style="padding:12px 20px; background:#e50914; color:white; border:none; border-radius:5px; width:100%; font-weight:bold; cursor:pointer;">Générer le lien</button>
            <div id="box" style="display:none; margin-top:25px; padding:15px; background:#fff; border:1px dashed #007bff; border-radius:5px;">
                <p style="margin:0 0 10px 0; font-size:14px; color:#555;">Copie ce lien et ajoute-le dans ton application :</p>
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

// Manifeste corrigé
app.get("/:apiKey/manifest.json", (req, res) => {
    res.json({ 
        id: "org.alldebrid.stremio.addon", 
        version: "6.4.0", 
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

// Catalogue trié corrigé
app.get("/:apiKey/catalog/:type/:id.json", async (req, res) => {
    const { apiKey, id, type } = req.params;
    try {
        const response = await axios.get(`https://alldebrid.com{apiKey}&agent=${AGENT}`);
        const magnets = response.data.data.magnets || [];
        let metas = [];
        
        const itemsToProcess = magnets.slice(0, 15);

        for (const item of itemsToProcess) {
            const title = item.filename.toLowerCase();
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
    } catch (err) { res.json({ metas: [] }); }
});

// Streaming de liens corrigé
app.get("/:apiKey/stream/:type/:id.json", async (req, res) => {
    const { apiKey, type, id } = req.params;
    let streams = [];
    try {
        if (id && id.startsWith("ad_cloud:")) {
            const magnetId = id.replace("ad_cloud:", "");
            const response = await axios.get(`https://alldebrid.com{apiKey}&agent=${AGENT}&id=${magnetId}`);
            if (response.data && response.data.data && response.data.data.magnets) {
                const magnetData = response.data.data.magnets;
                if (magnetData.files) {
                    for (const file of magnetData.files) {
                        if (file.link) {
                            const unlockRes = await axios.get(`https://alldebrid.com{apiKey}&agent=${AGENT}&link=${encodeURIComponent(file.link)}`);
                            if (unlockRes.data && unlockRes.data.data && unlockRes.data.data.link) {
                                streams.push({ name: "Mon Cloud ☁️", title: file.name, url: unlockRes.data.data.link });
                            }
                        }
                    }
                }
            }
        } else {
            const torrentioRes = await axios.get(`https://strem.fun{type}/${id}.json`).catch(() => null);
            if (torrentioRes && torrentioRes.data && torrentioRes.data.streams) {
                const torrentsFound = torrentioRes.data.streams.map(s => s.infoHash).filter(Boolean);
                if (torrentsFound.length > 0) {
                    const cacheCheck = await axios.post(`https://alldebrid.com{apiKey}&agent=${AGENT}`, { magnets: torrentsFound.slice(0, 15) });
                    if (cacheCheck.data && cacheCheck.data.data && cacheCheck.data.data.magnets) {
                        cacheCheck.data.data.magnets.forEach(mag => {
                            if (mag.instant && mag.link) {
                                streams.push({ 
                                    name: "Cache Global ⚡", 
                                    title: `${mag.filename}\n▶️ Lecture instantanée`, 
                                    url: `https://alldebrid.com{apiKey}&agent=${AGENT}&link=${encodeURIComponent(mag.link)}` 
                                });
                            }
                        });
                    }
                }
            }
        }
        res.json({ streams: streams });
    } catch (err) { res.json({ streams: [] }); }
});

module.exports = app;
