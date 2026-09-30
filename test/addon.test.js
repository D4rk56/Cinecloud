"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    parseSeasonEpisode,
    parseSizeFromString,
    extractCleanTitle,
    extractTechBadge,
    generateFallbackPoster
} = require("../lib/helpers");

const {
    hashPassword,
    verifyPassword,
    encryptConfig,
    decryptConfig
} = require("../lib/crypto");

const {
    pickBestVideoFile
} = require("../lib/resolver");

const {
    handleManifest
} = require("../lib/stremio");

const {
    upsertCachedTorrent,
    getCachedTorrentsByImdb,
    deleteCachedTorrent,
    purgeOldCachedTorrents
} = require("../lib/db");

test("Helpers - parseSeasonEpisode handles various delimiters", () => {
    assert.deepEqual(parseSeasonEpisode("Breaking.Bad.S01E05.mkv"), { season: 1, episode: 5 });
    assert.deepEqual(parseSeasonEpisode("Breaking.Bad.S01.E05.mkv"), { season: 1, episode: 5 });
    assert.deepEqual(parseSeasonEpisode("Breaking.Bad.S01 - E05.mkv"), { season: 1, episode: 5 });
    assert.deepEqual(parseSeasonEpisode("Breaking.Bad.S01_E05.mkv"), { season: 1, episode: 5 });
    assert.deepEqual(parseSeasonEpisode("Show.Name.1x08.HDTV.mkv"), { season: 1, episode: 8 });
    assert.equal(parseSeasonEpisode("Gladiator.II.2024.1080p.mkv"), null);
});

test("Helpers - parseSizeFromString extracts bytes correctly", () => {
    const gb = parseSizeFromString("💾 54.33 GB");
    assert.ok(gb > 50 * 1024 * 1024 * 1024 && gb < 60 * 1024 * 1024 * 1024);

    const mb = parseSizeFromString("📦 750 MB");
    assert.equal(mb, 750 * 1024 * 1024);

    assert.equal(parseSizeFromString("Pas de taille"), 0);
    assert.equal(parseSizeFromString(null), 0);
});

test("Helpers - extractCleanTitle cleans trackers, brackets and quality prefixes", () => {
    const res1 = extractCleanTitle("[Sharewood.tv] Gladiator.II.2024.1080p.mkv");
    assert.equal(res1.title, "Gladiator II");
    assert.equal(res1.year, "2024");

    const res2 = extractCleanTitle("[1080P • HEVC • 🇫🇷 MULTI] Sharewood.tv Gladiator II 2024.mkv");
    assert.equal(res2.title, "Gladiator II");

    const res3 = extractCleanTitle("Sharewood.tv-Inception.2010.FRENCH.1080p.mkv");
    assert.equal(res3.title, "Inception");
    assert.equal(res3.year, "2010");
});

test("Resolver - pickBestVideoFile handles ad_series format without NaN", () => {
    const files = [
        { n: "Breaking.Bad.S02E01.720p.mkv", s: 500000000, l: "http://link1" },
        { n: "Breaking.Bad.S02E05.720p.mkv", s: 550000000, l: "http://link2" },
        { n: "Breaking.Bad.S02E10.720p.mkv", s: 900000000, l: "http://link3" } // Plus volumineux
    ];

    // Format cloud séries : ad_series:<nom>:<saison>:<episode>
    const matchCloud = pickBestVideoFile(files, "ad_series:Breaking%20Bad:2:5");
    assert.ok(matchCloud, "Doit trouver le fichier");
    assert.equal(matchCloud.n, "Breaking.Bad.S02E05.720p.mkv", "Doit sélectionner l'épisode 5 et non le plus gros fichier");

    // Format IMDb standard : tt...:<saison>:<episode>
    const matchImdb = pickBestVideoFile(files, "tt0903747:2:5");
    assert.ok(matchImdb);
    assert.equal(matchImdb.n, "Breaking.Bad.S02E05.720p.mkv");

    // Format sans épisode spécifié : retombe sur le plus gros
    const matchLargest = pickBestVideoFile(files, "tt0903747");
    assert.equal(matchLargest.n, "Breaking.Bad.S02E10.720p.mkv");
});

test("Crypto - Password hashing and AES-256-GCM encryption", () => {
    const pwd = "monMotDePasseSecret123";
    const hashed = hashPassword(pwd);
    assert.ok(hashed.includes(":"), "Le hash scrypt doit contenir le sel et la clé");
    assert.ok(verifyPassword(pwd, hashed), "La vérification du mot de passe doit réussir");
    assert.ok(!verifyPassword("mauvaisMotDePasse", hashed), "Un mauvais mot de passe doit être rejeté");

    const config = {
        apiKey: "testApiKey12345",
        tmdbKey: "tmdbKeyTest",
        cacheMode: "on",
        langPref: "multi_vff,vff,vf"
    };

    const encrypted = encryptConfig(config);
    assert.ok(encrypted.includes(":"), "La configuration chiffrée doit contenir IV:AuthTag:Ciphertext");

    const decrypted = decryptConfig(encrypted);
    assert.deepEqual(decrypted, config, "La configuration déchiffrée doit être strictement identique");
});

test("Stremio - handleManifest returns valid manifest with CinéCloud FR branding, logo and configure button", () => {
    const manifest = handleManifest({ enabledCatalogs: "my_ad_magnets,my_ad_links" }, "https://cinecloud.fr", "test-uuid");
    assert.equal(manifest.name, "CinéCloud FR");
    assert.equal(manifest.id, "org.nuvio.alldebrid");
    assert.equal(manifest.version, "2.2.0");
    assert.equal(manifest.logo, "https://cinecloud.fr/logo.png");
    assert.equal(manifest.background, "https://cinecloud.fr/background.png");
    assert.deepEqual(manifest.behaviorHints, { configurable: true, configurationRequired: false });
    assert.equal(manifest.catalogs.length, 2);
    assert.equal(manifest.catalogs[0].id, "my_ad_links");
    assert.equal(manifest.catalogs[1].id, "my_ad_magnets");
});

test("Database - Cached torrents upsert, retrieval and purge", () => {
    const testHash = "abcdef1234567890abcdef1234567890abcdef12";
    const imdbId = "tt1375666"; // Inception

    upsertCachedTorrent({
        infoHash: testHash,
        imdbId: imdbId,
        title: "Inception 2010 1080p MULTI",
        filename: "Inception.2010.1080p.mkv",
        size: 8000000000,
        indexer: "TestIndexer",
        seeders: 50,
        isInstant: 1
    });

    const cached = getCachedTorrentsByImdb(imdbId);
    assert.ok(cached.length > 0, "Doit retourner les torrents mis en cache");
    const found = cached.find(t => t.infoHash.toLowerCase() === testHash.toLowerCase());
    assert.ok(found, "Le torrent inséré doit être présent");
    assert.equal(found.seeders, 50);

    deleteCachedTorrent(testHash);
    const afterDelete = getCachedTorrentsByImdb(imdbId);
    assert.ok(!afterDelete.some(t => t.infoHash.toLowerCase() === testHash.toLowerCase()), "Le torrent doit être supprimé");

    const purged = purgeOldCachedTorrents(30 * 86400);
    assert.ok(typeof purged === "number", "La purge doit retourner un nombre");
});

test("Helpers - imdbIdToTitle handles series and movies with Cinemeta fallback", async () => {
    const { imdbIdToTitle } = require("../lib/helpers");
    
    // Breaking Bad (série)
    const seriesTitle = await imdbIdToTitle("tt0903747", null, "series");
    assert.ok(seriesTitle, "Doit trouver un titre pour la série");
    assert.match(seriesTitle, /Breaking Bad/i, "Doit être Breaking Bad et non le film Mirror");

    // Inception (film)
    const movieTitle = await imdbIdToTitle("tt1375666", null, "movie");
    assert.ok(movieTitle, "Doit trouver un titre pour le film");
    assert.match(movieTitle, /Inception/i, "Doit être Inception");
});

test("Prowlarr Worker - resolveReleaseImdbId prioritizes series for TV releases", async () => {
    const { resolveReleaseImdbId } = require("../lib/prowlarr-worker");
    
    // Release avec motif de série S01E01
    const imdbSeries = await resolveReleaseImdbId("Breaking Bad S01E01 1080p", true);
    assert.equal(imdbSeries, "tt0903747", "Doit associer la série Breaking Bad tt0903747 et non le film El Camino tt9243946");
});

test("Helpers - isConfidentTitleMatch rejects error strings and unrelated titles", () => {
    const { isConfidentTitleMatch } = require("../lib/helpers");

    // Faux positifs critiques identifiés chez l'utilisateur
    assert.equal(isConfidentTitleMatch("not allowed", "Men Not Allowed"), false, "Doit rejeter 'not allowed' mappé vers Men Not Allowed");
    assert.equal(isConfidentTitleMatch("method not allowed", "Men Not Allowed"), false);
    assert.equal(isConfidentTitleMatch("404", "404 Not Found"), false);
    assert.equal(isConfidentTitleMatch("archive", "Rare Exports"), false);
    assert.equal(isConfidentTitleMatch("ipnotallowed", "Ip Not Allowed"), false, "Doit rejeter 'ipnotallowed'");
    assert.equal(isConfidentTitleMatch("ip not allowed", "Ip Not Allowed"), false, "Doit rejeter 'ip not allowed'");
    assert.equal(isConfidentTitleMatch("generic_ip_not_allowed", "Some Title"), false, "Doit rejeter 'generic_ip_not_allowed'");

    // Titres légitimes avec ponctuation ou variantes
    assert.equal(isConfidentTitleMatch("Avengers Endgame", "Avengers: Endgame"), true);
    assert.equal(isConfidentTitleMatch("The Amateur", "The Amateur"), true);
    assert.equal(isConfidentTitleMatch("Inception", "Inception", "2010", "2010"), true);

    // Rejet en cas d'écart d'année excessif
    assert.equal(isConfidentTitleMatch("Gladiator II", "Gladiator", "2024", "2000"), false);
});

test("Catalogs - Recommendations catalogs are present in ALL_CATALOGS and manifest", () => {
    const { ALL_CATALOGS } = require("../lib/helpers");
    const recoIds = ["my_ad_reco_movies", "my_ad_reco_series", "my_ad_reco_animes", "my_ad_reco_animes_movies"];
    for (const rid of recoIds) {
        assert.ok(ALL_CATALOGS.some(c => c.id === rid), `Catalogue ${rid} doit être défini dans ALL_CATALOGS`);
    }

    const manifestAll = handleManifest({ enabledCatalogs: "all" });
    for (const rid of recoIds) {
        assert.ok(manifestAll.catalogs.some(c => c.id === rid), `Catalogue ${rid} doit être actif dans le manifeste`);
    }
});

test("Database - getCachedTorrentsByImdb includes torrents with seeders even if not pre-cached", () => {
    const testHash = "9876543210abcdef9876543210abcdef98765432";
    const imdbId = "tt0111161"; // Shawshank Redemption

    upsertCachedTorrent({
        infoHash: testHash,
        imdbId: imdbId,
        title: "Shawshank Redemption French 1080p",
        filename: "Shawshank.Redemption.mkv",
        size: 5000000000,
        indexer: "Prowlarr",
        seeders: 42,
        isInstant: 0 // Non instantané au moment du scan RSS
    });

    const results = getCachedTorrentsByImdb(imdbId);
    assert.ok(results.length > 0, "Doit renvoyer les torrents actifs avec seeders");
    const found = results.find(t => t.infoHash === testHash.toLowerCase());
    assert.ok(found, "Le torrent avec seeders doit être sélectionné par la requête");
    assert.equal(found.seeders, 42);

    deleteCachedTorrent(testHash);
});

test("Catalogs - handleCatalog generates recommendations with valid metadata", async () => {
    const { handleCatalog } = require("../lib/stremio");
    const { TMDB_KEY_DEFAULT } = require("../lib/helpers");

    const res = await handleCatalog({ apiKey: "test_key", tmdbKey: TMDB_KEY_DEFAULT }, "movie", "my_ad_reco_movies", {});
    assert.ok(res && Array.isArray(res.metas), "Doit retourner une liste de métas");
    assert.ok(res.metas.length > 0, "Doit contenir des recommandations même sans historique");
    assert.ok(res.metas[0].id.startsWith("tt"), "Chaque recommandation doit avoir un identifiant IMDb valide");
    assert.ok(res.metas[0].name, "Chaque recommandation doit avoir un titre");
});

test("Catalogs - Anime recommendations return animation titles from Cinemeta fallback", async () => {
    const { handleCatalog } = require("../lib/stremio");
    const resAnime = await handleCatalog({ apiKey: "test_key" }, "series", "my_ad_reco_animes", {});
    assert.ok(resAnime && Array.isArray(resAnime.metas), "Doit retourner une liste de métas");
    assert.ok(resAnime.metas.length > 0, "Doit retourner des animes");
    assert.ok(resAnime.metas[0].id.startsWith("tt"), "Doit avoir un identifiant IMDb valide");
});

test("Resolver - handleResolve redirects 302 directly to downloadUrl without dropping valid links", async () => {
    const { handleResolve } = require("../lib/resolver");
    const { createUser, deleteUser } = require("../lib/db");
    const { hashPassword, encryptConfig } = require("../lib/crypto");

    const testUuid = "11111111-2222-3333-4444-555555555555";
    const testApiKey = "dummy_api_key_for_test";
    const passwordHash = hashPassword("secret123");
    const configEncrypted = encryptConfig({ apiKey: testApiKey });
    createUser(testUuid, passwordHash, configEncrypted);

    // Mock Express req & res
    let redirectCode = null;
    let redirectUrl = null;
    let statusCode = null;

    const req = {
        params: {
            userRef: testUuid,
            imdbId: "tt1234567",
            fileRef: encodeURIComponent("https://mock.debrid.it/dl/testfile.mkv")
        }
    };

    // Override alldebridApi.post temporarily for this test
    const alldebrid = require("../lib/alldebrid");
    const originalPost = alldebrid.alldebridApi.post;
    alldebrid.alldebridApi.post = async () => ({
        data: {
            status: "success",
            data: {
                link: "https://mock.debrid.it/dl/testfile.mkv",
                filename: "testfile.mkv",
                filesize: 1000000000
            }
        }
    });

    const res = {
        redirect: (code, url) => {
            redirectCode = code;
            redirectUrl = url;
        },
        status: (code) => {
            statusCode = code;
            return {
                json: () => {},
                send: () => {}
            };
        }
    };

    try {
        await handleResolve(req, res);
        assert.equal(redirectCode, 302, "Doit faire une redirection 302 vers le CDN");
        assert.equal(redirectUrl, "https://mock.debrid.it/dl/testfile.mkv", "Doit rediriger vers l'URL de téléchargement");
    } finally {
        alldebrid.alldebridApi.post = originalPost;
        deleteUser(testUuid);
    }
});

test("Prowlarr On-Demand - searchProwlarrOnDemand handles queries and returns formatted results", async () => {
    const { searchProwlarrOnDemand } = require("../lib/prowlarr-worker");
    const axios = require("axios");
    const originalGet = axios.get;

    axios.get = async (url) => {
        if (url.includes("api/v1/search")) {
            return {
                data: [
                    {
                        title: "Dune.Part.Two.2024.FRENCH.1080p.WEB.H264",
                        fileName: "Dune.Part.Two.2024.FRENCH.1080p.WEB.H264.mkv",
                        infoHash: "1234567890abcdef1234567890abcdef12345678",
                        size: 4500000000,
                        indexer: "Sharewood",
                        seeders: 50
                    }
                ]
            };
        }
        return originalGet(url);
    };

    try {
        const results = await searchProwlarrOnDemand({
            id: "tt15239678",
            type: "movie",
            cleanTitle: "Dune Part Two",
            prowlarrUrl: "http://mock-prowlarr:9696",
            prowlarrKey: "mock_key",
            apiKey: null
        });

        assert.equal(results.length, 1);
        assert.equal(results[0].indexer, "Sharewood");
        assert.equal(results[0].seeders, 50);
        assert.equal(results[0].infoHash, "1234567890abcdef1234567890abcdef12345678");

        deleteCachedTorrent("1234567890abcdef1234567890abcdef12345678");
    } finally {
        axios.get = originalGet;
    }
});

test("AllDebrid - Proxy configuration routes through ProxyAgent getProxyForUrl", async () => {
    const { ProxyAgent } = require("proxy-agent");
    const testProxy = "http://127.0.0.1:1080";
    const agent = new ProxyAgent({ getProxyForUrl: () => testProxy });
    const targetUrl = "https://api.alldebrid.com/v4/user";
    const resolvedProxy = await agent.getProxyForUrl(targetUrl);
    assert.equal(resolvedProxy, testProxy, "ProxyAgent doit résoudre l'URL du proxy WARP");
});

test("Meta - handleMeta directly retrieves Cinemeta metadata for IMDb tt IDs when TMDB key is default", async () => {
    const { handleMeta } = require("../lib/stremio");
    const metaRes = await handleMeta({ apiKey: "dummy_key", tmdbKey: "default" }, "movie", "tt1375666", {});
    assert.ok(metaRes && metaRes.meta, "Doit renvoyer un objet meta");
    assert.match(metaRes.meta.name, /Inception/i, "Le titre doit être Inception");
    assert.ok(metaRes.meta.poster, "Doit avoir un poster valide");
    assert.ok(metaRes.meta.description, "Doit avoir une description");
});

test("Catalogs - handleCatalog correctly applies skip pagination on recommendation catalogs", async () => {
    const { handleCatalog } = require("../lib/stremio");
    const fullRes = await handleCatalog({ apiKey: "test_key" }, "movie", "my_ad_reco_movies", {}, null);
    assert.ok(fullRes && Array.isArray(fullRes.metas), "Doit retourner une liste de métas");

    const paginatedRes = await handleCatalog({ apiKey: "test_key" }, "movie", "my_ad_reco_movies", {}, "skip=5");
    assert.ok(paginatedRes && Array.isArray(paginatedRes.metas), "Doit retourner une liste paginée");
    assert.equal(paginatedRes.metas.length, Math.max(0, fullRes.metas.length - 5));
    if (fullRes.metas.length > 5) {
        assert.equal(paginatedRes.metas[0].id, fullRes.metas[5].id, "Le premier élément après skip=5 doit correspondre au 6ème élément global");
    }
});

test("Prowlarr On-Demand - query sanitization cleans punctuation like colons and apostrophes", async () => {
    const { searchProwlarrOnDemand } = require("../lib/prowlarr-worker");
    const axios = require("axios");
    const originalGet = axios.get;

    let interceptedUrl = null;
    let interceptedHeaders = null;
    axios.get = async (url, config) => {
        if (url.includes("api/v1/search")) {
            interceptedUrl = url;
            interceptedHeaders = config?.headers;
            return {
                data: [
                    {
                        title: "Attack.on.Titan.S01E01.FRENCH.1080p",
                        fileName: "Attack.on.Titan.S01E01.FRENCH.1080p.mkv",
                        infoHash: "aabbccddeeff00112233445566778899aabbccdd",
                        size: 1500000000,
                        indexer: "Ygg",
                        seeders: 15
                    }
                ]
            };
        }
        return originalGet(url, config);
    };

    try {
        const results = await searchProwlarrOnDemand({
            id: "tt2560140:1:1",
            type: "series",
            cleanTitle: "L'Attaque des Titans: Le Début",
            season: 1,
            episode: 1,
            prowlarrUrl: "http://prowlarr:9696",
            prowlarrKey: "mock_prowlarr_key",
            apiKey: null
        });

        assert.ok(interceptedUrl, "L'URL Prowlarr doit avoir été appelée");
        assert.ok(!interceptedUrl.includes("%3A") && !interceptedUrl.includes("%27"), "La recherche ne doit pas contenir de deux-points ou d'apostrophes encodés");
        assert.ok(interceptedHeaders && interceptedHeaders["X-Api-Key"] === "mock_prowlarr_key", "Doit inclure l'en-tête X-Api-Key");
        assert.equal(results.length, 1);
        assert.equal(results[0].indexer, "Ygg");

        deleteCachedTorrent("aabbccddeeff00112233445566778899aabbccdd");
    } finally {
        axios.get = originalGet;
    }
});

test("Resolver - unlockFileTarget accepts direct CDN links without erroring on unlockLink failure", async () => {
    const { unlockFileTarget } = require("../lib/resolver");
    const directCdnUrl = "https://mock.debrid.it/dl/myvideo.mkv?token=123";
    const res = await unlockFileTarget("dummy_api_key", directCdnUrl, "tt1234567");
    assert.equal(res, directCdnUrl, "Doit renvoyer directement le lien CDN si c'est un flux direct valide");
});

test("AllDebrid - isWarpActive and disableWarpWithFallback protect against ENOTFOUND", () => {
    const { isWarpActive, disableWarpWithFallback } = require("../lib/alldebrid");
    assert.equal(typeof isWarpActive(), "boolean");
    disableWarpWithFallback("ENOTFOUND warp test");
    assert.equal(isWarpActive(), false, "Warp doit être désactivé après échec");
});

test("Catalogs - handleCatalog groups series into folder cards instead of individual episodes", async () => {
    const { handleCatalog } = require("../lib/stremio");
    const alldebrid = require("../lib/alldebrid");
    const originalAdGet = alldebrid.adGet;

    alldebrid.adGet = async (endpoint, apiKey, params) => {
        if (endpoint === "/v4.1/magnet/status") {
            return {
                data: {
                    status: "success",
                    data: {
                        magnets: [
                            { id: 101, filename: "Breaking.Bad.S01E01.720p.mkv", size: 1000000000 },
                            { id: 102, filename: "Breaking.Bad.S01E02.720p.mkv", size: 1000000000 },
                            { id: 103, filename: "Breaking.Bad.S01E03.720p.mkv", size: 1000000000 },
                            { id: 201, filename: "Better.Call.Saul.S01E01.720p.mkv", size: 1000000000 }
                        ]
                    }
                }
            };
        }
        return originalAdGet(endpoint, apiKey, params);
    };

    try {
        const testCache = { series: {}, movies: {} };
        const result = await handleCatalog({ apiKey: "test" }, "series", "my_ad_magnets_series", testCache);
        assert.ok(result && Array.isArray(result.metas), "Doit retourner une liste de métas");
        assert.equal(result.metas.length, 2, "Doit regrouper les 4 épisodes en exactement 2 dossiers séries (Breaking Bad et Better Call Saul)");
        const bbCard = result.metas.find(m => m.name.toLowerCase().includes("breaking bad"));
        assert.ok(bbCard, "Le dossier Breaking Bad doit être présent");
        assert.match(bbCard.description, /Dossier Série • 3 épisode\(s\) disponible\(s\)/);
        assert.equal(bbCard.type, "series");
    } finally {
        alldebrid.adGet = originalAdGet;
    }
});

test("Meta - handleMeta returns videos array for series folder (ad_series:)", async () => {
    const { handleMeta } = require("../lib/stremio");
    const testCache = {
        series: {
            "breaking bad": {
                groupTitle: "breaking bad",
                episodes: [
                    { season: 1, episode: 1, filename: "Breaking.Bad.S01E01.mkv" },
                    { season: 1, episode: 2, filename: "Breaking.Bad.S01E02.mkv" }
                ]
            }
        }
    };

    const res = await handleMeta({ apiKey: "test" }, "series", "ad_series:Breaking%20Bad", testCache);
    assert.ok(res && res.meta, "Doit retourner une fiche meta");
    assert.equal(res.meta.type, "series");
    assert.ok(Array.isArray(res.meta.videos), "Doit contenir le tableau videos pour Stremio");
    assert.equal(res.meta.videos.length, 2);
    assert.equal(res.meta.videos[0].season, 1);
    assert.equal(res.meta.videos[0].episode, 1);
    assert.equal(res.meta.videos[1].season, 1);
    assert.equal(res.meta.videos[1].episode, 2);
    assert.equal(res.meta.videos[0].id, "ad_series:Breaking%20Bad:1:1");
});

test("Server - Logo, Background and Configure routes are defined", () => {
    const app = require("../index");
    const routes = [];
    app._router.stack.forEach(middleware => {
        if (middleware.route) {
            routes.push({ path: middleware.route.path, methods: Object.keys(middleware.route.methods) });
        }
    });

    assert.ok(routes.some(r => r.path === "/logo.png"), "Route /logo.png doit être définie");
    assert.ok(routes.some(r => r.path === "/background.png"), "Route /background.png doit être définie");
    assert.ok(routes.some(r => r.path === "/:uuid/configure"), "Route /:uuid/configure doit être définie");
});





