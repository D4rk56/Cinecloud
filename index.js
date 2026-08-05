const express = require("express");
const axios = require("axios");
const app = express();

// 1. Autorisations CORS complètes pour Nuvio
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "*");
    next();
});

const TMDB_KEY = "14cc580302bf1c4161bf96efb2165215";
const AGENT = "NuvioAlldebridFork"; // Résout le blocage de sécurité d'Alldebrid

async function getTmdbMetadata(filename, type) {
    try {
        let cleanName = filename.replace(/\.(mp4|mkv|avi|mov)$/i, "").replace(/[\.\_]/g, " ").replace(/(bluray|1080p|720p|4k|x264|h264|x265|hevc|vostfr|multi|french|truefrench)/gi, "").trim();
        const tmdbType = (type === "movie") ? "movie" : "tv";
        const res = await axios.get(`https://themoviedb.org{tmdbType}?api_key=${TMDB_KEY}&query=${encodeURIComponent(cleanName)}&language=fr-FR`);
        if (res.data.results && res.data.results.length > 0) {
            const first = res.data.results[0];
            return { 
                name: first.title || first.name, 
                poster: `https://tmdb.org{first.poster_path}`, 
                description: first.overview || "Fichier disponible sur ton Cloud Alldebrid."
            };
        }
    } catch (e) {}
    return { name: filename, poster: "https://placehold.co", description: "Fichier Cloud Alldebrid" };
}

// Interface de configuration
app.get("/", (req, res) => {
    res.send(`
        <div style="font-family:sans-serif; padding:30px; max-width:400px; margin:auto; text-align:center; background:#f4f4f9; border-radius:10px; margin-top:50px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <h2 style="color:#e50914;">Configuration Alldebrid - Nuvio</h2>
            <p style="color:#333;">Entre ta clé API Alldebrid pour configurer l'addon.</p>
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

// Manifeste corrigé pour Nuvio
app.get("/:apiKey/manifest.json", (req, res) => {
    res.json({ 
        id: "org.nuviofork.alldebrid.addon", 
        version: "4.0.0", 
        name: "Cloud Alldebrid Organisé", 
        description: "Affiche tes torrents Alldebrid triés en Films, Séries et Animes (Infos FR via TMDB).", 
        resources: ["catalog", "stream"], 
        types: ["movie", "series"], 
        catalogs: [
            { type: "movie", id: "my_ad_movies", name: "Mes Films Alldebrid" }, 
            { type: "series", id: "my_ad_series", name: "Mes Séries Alldebrid" }, 
            { type: "series", id: "my_ad_animes", name: "Mes Animes Alldebrid" }
        ], 
        idPrefixes: ["tt", "ad_"] 
    });
});

// Gestionnaire des Catalogues Perso
app.get("/:apiKey/catalog/:type/:id.json", async (req, res) => {
    const { apiKey, id } = req.params;
    try {
        const response = await axios.get(`https://alldebrid.com{apiKey}&agent=${AGENT}`);
        const magnets = response.data.data.magnets || [];
        let metas = [];
        
        // Limite à 20 torrents pour éviter le timeout Serverless
        const itemsToProcess = magnets.slice(0, 20);

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
                    id: `ad_${item.id}`, // Format d'ID nettoyé
                    type: currentType, 
                    name: tmdb.name, 
                    poster: tmdb.poster, 
                    description: tmdb.description 
                });
            }
        }
        res.json({ metas: metas });
    } catch (err) { res.json({ metas: [] }); }
});

// Gestionnaire de Flux (Streaming complet Cache Global + Cloud)
app.get("/:apiKey/stream/:type/:id.json", async (req, res) => {
    const { apiKey, type, id } = req.params;
    let streams = [];
    try {
        // CAS A : Lecture depuis tes Catalogues Cloud Perso (ID commence par ad_)
        if (id.startsWith("ad_")) {
            const magnetId = id.replace("ad_", "");
            const response = await axios.get(`https://alldebrid.com{apiKey}&agent=${AGENT}&id=${magnetId}`);
            const magnetData = response.data.data.magnets;
            if (magnetData && magnetData.files) {
                for (const file of magnetData.files) {
                    if (file.link) {
                        const unlockRes = await axios.get(`https://alldebrid.com{apiKey}&agent=${AGENT}&link=${encodeURIComponent(file.link)}`);
                        if (unlockRes.data.data && unlockRes.data.data.link) {
                            streams.push({ name: "☁️ Mon Cloud", title: file.name, url: unlockRes.data.data.link });
                        }
                    }
                }
            }
            return res.json({ streams: streams });
        }

        // CAS B : Recherche Globale (Clic depuis les menus TMDB/Trakt natifs de Nuvio)
        const torrentioRes = await axios.get(`https://strem.fun{type}/${id}.json`).catch(() => null);
        if (torrentioRes && torrentioRes.data && torrentioRes.data.streams) {
            const torrentsFound = torrentioRes.data.streams.map(s => s.infoHash).filter(Boolean);
            if (torrentsFound.length > 0) {
                const cacheCheck = await axios.post(`https://alldebrid.com{apiKey}&agent=${AGENT}`, { magnets: torrentsFound.slice(0, 15) });
                if (cacheCheck.data.data && cacheCheck.data.data.magnets) {
                    cacheCheck.data.data.magnets.forEach(mag => {
                        if (mag.instant) {
                            streams.push({ 
                                name: "⚡ Cache Global", 
                                title: `${mag.filename}\nPrêt à lire immédiatement`, 
                                url: `https://alldebrid.com{apiKey}&agent=${AGENT}&link=${encodeURIComponent(mag.link)}` 
                            });
                        }
                    });
                }
            }
        }
        res.json({ streams: streams });
    } catch (err) { res.json({ streams: [] }); }
});

module.exports = app;
