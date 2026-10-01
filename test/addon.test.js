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
    handleManifest,
    handleCatalog
} = require("../lib/stremio");

const {
    upsertCachedTorrent,
    getCachedTorrentsByImdb,
    deleteCachedTorrent,
    purgeOldCachedTorrents,
    createUser,
    getSharedProwlarrInstances
} = require("../lib/db");

const {
    isLocalOrPrivateUrl
} = require("../lib/prowlarr-worker");

const {
    logger,
    runWithUser
} = require("../lib/logger");

const {
    filterAndSortStreams
} = require("../lib/helpers");

const vm = require("node:vm");
const {
    renderConfigPage,
    renderAdminPage
} = require("../lib/ui");

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
    assert.equal(manifest.version, "2.3.0");
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

test("AllDebrid - createProxyAgent handles socks5, socks5h, http and scheme normalization", () => {
    const { createProxyAgent } = require("../lib/alldebrid");
    const { SocksProxyAgent } = require("socks-proxy-agent");
    const { ProxyAgent } = require("proxy-agent");

    const s5 = createProxyAgent("socks5://127.0.0.1:1080");
    assert.ok(s5 instanceof SocksProxyAgent, "socks5:// doit instancier SocksProxyAgent");

    const s5h = createProxyAgent("socks5h://warp:1080");
    assert.ok(s5h instanceof SocksProxyAgent, "socks5h:// doit instancier SocksProxyAgent");

    const http = createProxyAgent("http://warp:1080");
    assert.ok(http instanceof ProxyAgent, "http:// doit instancier ProxyAgent");

    const norm = createProxyAgent("warp:1080");
    assert.ok(norm instanceof ProxyAgent, "warp:1080 doit être normalisé en http:// et instancier ProxyAgent");

    assert.equal(createProxyAgent(null), null);
    assert.equal(createProxyAgent(""), null);
});

test("AllDebrid - SOCKS and network handshake failures activate direct failover", async () => {
    const alldebrid = require("../lib/alldebrid");
    const { disableWarpWithFallback, isWarpActive } = alldebrid;

    // Simulation d'une erreur de handshake SOCKS
    disableWarpWithFallback("SOCKS5 socket closed unexpectedly");
    assert.equal(isWarpActive(), false, "Warp doit être désactivé en cas de défaillance SOCKS");
});

test("Helpers - hasCjkCharacters detects Japanese and Chinese characters", () => {
    const { hasCjkCharacters } = require("../lib/helpers");
    assert.equal(hasCjkCharacters("すずめの戸締まり"), true, "Kanji/Kana japonais doit être détecté");
    assert.equal(hasCjkCharacters("鬼滅の刃"), true, "Kanji doit être détecté");
    assert.equal(hasCjkCharacters("Suzume"), false, "Titre romanisé ne doit pas être CJK");
    assert.equal(hasCjkCharacters("Dune: Deuxième Partie (2024)"), false, "Titre français standard");
});

test("Helpers - formatAioStream removes FR SUB badge and displays filename in right column", () => {
    const { formatAioStream } = require("../lib/helpers");
    const formatted = formatAioStream({
        filename: "Gladiator.II.2024.FRENCH.1080p.WEB.H264.mkv",
        sizeBytes: 4500000000,
        indexer: "Mon Cloud",
        url: "http://example.com/stream"
    });

    assert.ok(formatted && formatted.name, "Le flux doit être généré");
    // Vérification que (FR SUB) ou (FR Dub) n'apparaît plus dans la ligne de badge
    assert.ok(!formatted.name.includes("(FR SUB)"), "Ne doit pas contenir (FR SUB)");
    assert.ok(!formatted.name.includes("(FR Dub)"), "Ne doit pas contenir (FR Dub)");
    // Vérification que le nom de fichier est présent dans la colonne de droite au lieu de 'Mon cloud'
    assert.ok(formatted.title.includes("📄 Gladiator.II.2024.FRENCH.1080p.WEB.H264.mkv"), "Doit afficher le nom du fichier");
    assert.ok(!formatted.title.includes("Mon Cloud"), "Ne doit plus afficher 'Mon Cloud'");
});

test("Helpers - filterAndSortStreams filters by resolution, language and limits", () => {
    const { filterAndSortStreams } = require("../lib/helpers");
    const sampleStreams = [
        {
            name: "CinéCloud FR\n1080p",
            description: "Gladiator II\n1080p • x264\n💾 4.00 GB • 250 👤\n🇫🇷 MULTI\n⚡ Prowlarr",
            _size: 4 * 1024 * 1024 * 1024,
            _resolution: "1080p",
            _seeders: 250,
            _lang: "multi"
        },
        {
            name: "CinéCloud FR\n4k",
            description: "Gladiator II\n4k • HEVC\n💾 18.00 GB • 100 👤\n🇫🇷 VFF\n⚡ Prowlarr",
            _size: 18 * 1024 * 1024 * 1024,
            _resolution: "4k",
            _seeders: 100,
            _lang: "vff"
        },
        {
            name: "CinéCloud FR\n720p",
            description: "Gladiator II\n720p • x264\n💾 2.00 GB • 50 👤\n🌐 Inconnu\n⚡ Prowlarr",
            _size: 2 * 1024 * 1024 * 1024,
            _resolution: "720p",
            _seeders: 50,
            _lang: "unknown"
        },
        {
            name: "CinéCloud FR\n480p",
            description: "Gladiator II\n480p • XviD\n💾 0.80 GB • 10 👤\n🇫🇷 VF\n⚡ Prowlarr",
            _size: 800 * 1024 * 1024,
            _resolution: "480p",
            _seeders: 10,
            _lang: "vf"
        }
    ];

    // 1. Filtrage exclusion résolution (ex: exclure 480p)
    const filteredRes = filterAndSortStreams(sampleStreams, { resolutions: "4k,1080p,720p" });
    assert.equal(filteredRes.some(s => s._resolution === "480p"), false, "480p doit être exclu");

    // 2. Réordonnancement : 1080p en premier
    const reordered = filterAndSortStreams(sampleStreams, { resolutions: "1080p,4k,720p,480p" });
    assert.equal(reordered[0]._resolution, "1080p", "1080p doit être en première position");

    // 3. Masquer les langues inconnues
    const noUnknown = filterAndSortStreams(sampleStreams, { hideUnknownLanguages: true });
    assert.equal(noUnknown.some(s => s._lang === "unknown"), false, "Les langues inconnues doivent être filtrées");

    // 4. Tri par taille décroissante
    const bySizeDesc = filterAndSortStreams(sampleStreams, { sortBy: "size" });
    assert.equal(bySizeDesc[0]._resolution, "4k", "Le plus gros fichier (18 Go) doit être en premier");

    // 5. Limite de taille max (ex: max 10 Go -> exclut le 4k de 18 Go)
    const limitedSize = filterAndSortStreams(sampleStreams, { maxSizeGb: 10 });
    assert.equal(limitedSize.some(s => s._size > 10 * 1024 * 1024 * 1024), false, "Les fichiers > 10 Go doivent être exclus");

    // 6. Limite de nombre de flux (ex: max 2 flux)
    const limitedCount = filterAndSortStreams(sampleStreams, { maxStreams: 2 });
    assert.equal(limitedCount.length, 2, "Doit limiter à 2 flux");
});

test("Helpers - resolveKitsuMeta resolves kitsu anime IDs to title and meta", async () => {
    const { resolveKitsuMeta } = require("../lib/helpers");
    const meta = await resolveKitsuMeta("12345", "series");
    assert.ok(meta, "Doit renvoyer un objet de métadonnées");
    assert.ok(typeof meta.title === "string", "Le titre doit être une chaîne de caractères");
});

test("Logger - In-memory circular log buffer and console interceptor", () => {
    const { addLog, getLogs, clearLogs } = require("../lib/logger");
    clearLogs();

    addLog("INFO", "TestMod", "Message d'information test");
    addLog("WARN", "TestMod", "Avertissement test");
    addLog("ERROR", "ProxyMod", "Erreur réseau simulée");

    const all = getLogs();
    assert.equal(all.length, 3, "Doit contenir 3 logs");

    const errors = getLogs({ level: "ERROR" });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].module, "ProxyMod");

    const searched = getLogs({ search: "réseau" });
    assert.equal(searched.length, 1);

    clearLogs();
    assert.equal(getLogs().length, 0, "Doit être vidé après clearLogs");
});

test("Admin & DB - System settings and stats functions", () => {
    const { getSystemSettings, updateSystemSettings, getUserStats } = require("../lib/db");
    const initial = getSystemSettings();
    assert.ok(initial.httpTimeoutMs >= 5000, "Le timeout HTTP doit avoir une valeur par défaut raisonnable");

    const updated = updateSystemSettings({ httpTimeoutMs: 12000, prowlarrTimeoutMs: 9000 });
    assert.equal(updated.httpTimeoutMs, 12000);
    assert.equal(updated.prowlarrTimeoutMs, 9000);

    const stats = getUserStats();
    assert.ok(typeof stats.totalUsers === "number", "Stats totalUsers doit être un nombre");
    assert.ok(typeof stats.totalCachedTorrents === "number", "Stats totalCachedTorrents doit être un nombre");
});

test("Server - Public status and Admin API endpoints", async () => {
    const app = require("../index");
    const request = require("node:http");

    // Démarrage d'un serveur de test éphémère
    const server = app.listen(0);
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    try {
        const axios = require("axios");

        // 1. GET /api/status/warp
        const resWarp = await axios.get(`${base}/api/status/warp`);
        assert.equal(resWarp.status, 200);
        assert.ok("active" in resWarp.data);
        assert.ok("mode" in resWarp.data);

        // 2. GET /api/stats
        const resStats = await axios.get(`${base}/api/stats`);
        assert.equal(resStats.status, 200);
        assert.ok("totalUsers" in resStats.data);

        // 3. POST /api/check/alldebrid avec clé vide -> valide: false
        const resAdCheck = await axios.post(`${base}/api/check/alldebrid`, { apiKey: "" });
        assert.equal(resAdCheck.status, 200);
        assert.equal(resAdCheck.data.valid, false);

        // 4. POST /api/admin/login échec
        try {
            await axios.post(`${base}/api/admin/login`, { password: "mauvais_password" });
            assert.fail("Doit lever une erreur 401");
        } catch (err) {
            assert.equal(err.response?.status, 401);
        }

        // 5. POST /api/admin/login succès
        const resLogin = await axios.post(`${base}/api/admin/login`, { password: process.env.ADMIN_PASSWORD || "admin123" });
        assert.equal(resLogin.status, 200);
        assert.ok(resLogin.data.success);
        assert.ok(resLogin.data.token);
        const adminToken = resLogin.data.token;

        // 6. GET /api/admin/stats avec token
        const resAdminStats = await axios.get(`${base}/api/admin/stats`, {
            headers: { "x-admin-token": adminToken }
        });
        assert.equal(resAdminStats.status, 200);
        assert.ok(resAdminStats.data.uptimeSeconds >= 0);

        // 7. GET /api/admin/logs avec token
        const resAdminLogs = await axios.get(`${base}/api/admin/logs`, {
            headers: { "x-admin-token": adminToken }
        });
        assert.equal(resAdminLogs.status, 200);
        assert.ok(Array.isArray(resAdminLogs.data));

        // 8. GET /admin interface HTML
        const resAdminHtml = await axios.get(`${base}/admin`);
        assert.equal(resAdminHtml.status, 200);
        assert.ok(resAdminHtml.data.includes("Panneau d'Administration"));

        // 9. Enregistrement utilisateur avec pseudo et nouvelles options
        const uniquePseudo = "Testeur_" + Date.now();
        const resReg = await axios.post(`${base}/api/user/register`, {
            apiKey: "dummy_alldebrid_api_key_test",
            password: "monSuperMotDePasse123",
            pseudo: uniquePseudo,
            resolutions: "1080p,4k",
            hideUnknownLanguages: true,
            sortBy: "size"
        });
        assert.equal(resReg.status, 200);
        assert.ok(resReg.data.uuid);
        const userUuid = resReg.data.uuid;

        // Vérification du manifest avec le pseudo dans le nom
        const resManifest = await axios.get(`${base}/${userUuid}/manifest.json`);
        assert.equal(resManifest.status, 200);
        assert.ok(resManifest.data.name.includes(uniquePseudo), "Le nom de l'addon doit inclure le pseudo");
        assert.ok(resManifest.data.description.includes("AllDebrid haute performance"), "Description officielle présente");

    } finally {
        server.close();
    }
});

test("Crowdsourcing & Prowlarr Modes - getSharedProwlarrInstances & URL validation", () => {
    // 1. Validation des URLs locales vs distantes
    assert.equal(isLocalOrPrivateUrl("http://localhost:9696"), true);
    assert.equal(isLocalOrPrivateUrl("http://127.0.0.1:9696"), true);
    assert.equal(isLocalOrPrivateUrl("http://192.168.1.100:9696"), true);
    assert.equal(isLocalOrPrivateUrl("http://10.0.0.12:9696"), true);
    assert.equal(isLocalOrPrivateUrl("https://prowlarr.mydomain.com"), false);
    assert.equal(isLocalOrPrivateUrl("invalid-url"), true);

    // 2. Création d'utilisateurs avec différents modes Prowlarr
    const sharedUuid = "user-shared-" + Date.now();
    const encShared = encryptConfig({ prowlarrUrl: "https://prowlarr.shared.net", prowlarrKey: "key-shared" });
    createUser(sharedUuid, "hash", encShared, "SharedUser", "shared");

    const privateUuid = "user-private-" + Date.now();
    const encPrivate = encryptConfig({ prowlarrUrl: "https://prowlarr.private.net", prowlarrKey: "key-private" });
    createUser(privateUuid, "hash", encPrivate, "PrivateUser", "private");

    const localUuid = "user-local-" + Date.now();
    const encLocal = encryptConfig({ prowlarrUrl: "", prowlarrKey: "" });
    createUser(localUuid, "hash", encLocal, "LocalUser", "local");

    const sharedInstances = getSharedProwlarrInstances();
    const hasShared = sharedInstances.some(inst => inst.url === "https://prowlarr.shared.net" && inst.key === "key-shared");
    const hasPrivate = sharedInstances.some(inst => inst.url === "https://prowlarr.private.net");
    const hasLocal = sharedInstances.some(inst => inst.userUuid === localUuid);

    assert.ok(hasShared, "L'instance en mode 'shared' doit être incluse dans le crowdsourcing");
    assert.ok(!hasPrivate, "L'instance en mode 'private' NE doit PAS être partagée pour le RSS");
    assert.ok(!hasLocal, "L'instance en mode 'local' n'a pas de serveur Prowlarr");
});

test("Catalogs - disableCatalogs hides catalogs from manifest and catalog route", async () => {
    // 1. Manifest sans catalogue quand disableCatalogs est actif
    const manifestDisabled = handleManifest({ disableCatalogs: true, pseudo: "NoCatalogs" });
    assert.equal(manifestDisabled.catalogs.length, 0, "Les catalogues doivent être complètement vides dans le manifest");

    // 2. Manifest normal quand disableCatalogs est inactif
    const manifestEnabled = handleManifest({ disableCatalogs: false, pseudo: "WithCatalogs" });
    assert.ok(manifestEnabled.catalogs.length > 0, "Les catalogues doivent être présents par défaut");

    // 3. Appel de handleCatalog avec disableCatalogs actif
    const catalogResult = await handleCatalog({ disableCatalogs: true }, "movie", "my_ad_magnets");
    assert.deepEqual(catalogResult, { metas: [] }, "Doit retourner une liste de métadonnées vide");
});

test("Stream Filtering - default 150GB limit and sorting", () => {
    const stream120Gb = {
        title: "Dune.Part.Two.2024.2160p.UHD.Remux.mkv\n💾 120.0 GB\n⚙️ Video",
        url: "http://stream1",
        behaviorHints: { filename: "Dune.Part.Two.2024.2160p.UHD.Remux.mkv" }
    };
    const stream180Gb = {
        title: "Dune.Part.Two.2024.2160p.UHD.Huge.mkv\n💾 180.0 GB\n⚙️ Video",
        url: "http://stream2",
        behaviorHints: { filename: "Dune.Part.Two.2024.2160p.UHD.Huge.mkv" }
    };

    // Par défaut, la limite est 150 Go
    const defaultFiltered = filterAndSortStreams([stream120Gb, stream180Gb], {});
    assert.equal(defaultFiltered.length, 1, "Le flux de 180 Go doit être filtré avec la limite par défaut de 150 Go");
    assert.ok(defaultFiltered[0].title.includes("120.0 GB"));

    // Avec une limite personnalisée à 200 Go
    const customFiltered = filterAndSortStreams([stream120Gb, stream180Gb], { maxSizeGb: 200 });
    assert.equal(customFiltered.length, 2, "Les deux flux doivent passer avec une limite de 200 Go");
});

test("Logger - AsyncLocalStorage tags log lines with user", () => {
    const testUser = "Alex_Tester_" + Date.now();
    runWithUser(testUser, () => {
        logger.info("Message balisé avec le contexte utilisateur");
    });

    const logs = logger.getLogs({ limit: 10 });
    const targetLog = logs.find(l => l.message === "Message balisé avec le contexte utilisateur");
    assert.ok(targetLog, "Le log doit être présent dans le buffer");
    assert.equal(targetLog.user, testUser, "Le tag user doit correspondre au contexte AsyncLocalStorage");
});

test("UI - Client script in renderConfigPage and renderAdminPage compiles without syntax error", () => {
    // 1. Validation de renderConfigPage
    const configHtml = renderConfigPage();
    const configScript = configHtml.substring(configHtml.indexOf("<script>") + 8, configHtml.lastIndexOf("</script>"));
    assert.doesNotThrow(() => {
        new vm.Script(configScript);
    }, "Le script client de renderConfigPage doit compiler sans aucune erreur de syntaxe");

    // 2. Validation de renderAdminPage
    const adminHtml = renderAdminPage();
    const adminScript = adminHtml.substring(adminHtml.indexOf("<script>") + 8, adminHtml.lastIndexOf("</script>"));
    assert.doesNotThrow(() => {
        new vm.Script(adminScript);
    }, "Le script client de renderAdminPage doit compiler sans aucune erreur de syntaxe");
});

test("Helpers - formatAioStream handles isInstant with ⚡ and ⏳ badges", () => {
    const { formatAioStream } = require("../lib/helpers");

    // Flux instantané (isInstant: true)
    const instantStream = formatAioStream({
        filename: "Gladiator.II.2024.FRENCH.1080p.WEB.H264.mkv",
        sizeBytes: 4500000000,
        provider: "CinéCloud",
        indexer: "Prowlarr",
        isInstant: true,
        url: "http://example.com/stream"
    });
    assert.ok(instantStream.name.includes("[AD ⚡]"), "Doit inclure le badge [AD ⚡]");
    assert.ok(!instantStream.name.includes("[AD ⏳]"), "Ne doit pas inclure [AD ⏳]");
    assert.ok(instantStream.title.includes("⚡ Instantané AllDebrid"), "Doit inclure le statut instantané");

    // Flux en cours de téléchargement (isInstant: false)
    const downloadStream = formatAioStream({
        filename: "Gladiator.II.2024.FRENCH.1080p.WEB.H264.mkv",
        sizeBytes: 4500000000,
        provider: "CinéCloud",
        indexer: "Prowlarr",
        subtitle: "Téléchargement (42 seeders)",
        isInstant: false,
        url: "http://example.com/stream"
    });
    assert.ok(downloadStream.name.includes("[AD ⏳]"), "Doit inclure le badge [AD ⏳]");
    assert.ok(!downloadStream.name.includes("[AD ⚡]"), "Ne doit pas inclure [AD ⚡]");
    assert.ok(downloadStream.title.includes("⏳ Téléchargement (42 seeders)"), "Doit préfixer avec ⏳");
});

test("Prowlarr - checkProwlarrConnectivity URL normalization, fallback and diagnosis", async () => {
    const http = require("http");
    const { checkProwlarrConnectivity } = require("../lib/prowlarr-worker");

    // 1. Validation des paramètres requis
    const emptyRes = await checkProwlarrConnectivity("", "");
    assert.equal(emptyRes.success, false);
    assert.equal(emptyRes.valid, false);

    // 2. Diagnostic d'hôte introuvable
    const notFoundRes = await checkProwlarrConnectivity("http://prowlarr-inexistant-test:9696", "test_key");
    assert.equal(notFoundRes.success, false);
    assert.ok(notFoundRes.error.includes("Hôte 'prowlarr-inexistant-test' introuvable"), "Doit diagnostiquer l'hôte introuvable");
    assert.ok(notFoundRes.error.includes("host.docker.internal"), "Doit suggérer host.docker.internal");

    // 3. Mock HTTP server pour simuler Prowlarr
    let mode = "root"; // "root" ou "subpath"
    const server = http.createServer((req, res) => {
        const apiKey = req.headers["x-api-key"] || new URL(req.url, "http://localhost").searchParams.get("apikey");
        if (apiKey !== "valid_key") {
            res.writeHead(401, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "Unauthorized" }));
        }

        if (mode === "root" && req.url.startsWith("/api/v1/system/status")) {
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ version: "1.25.0", appName: "Prowlarr", instanceName: "Prowlarr" }));
        }

        if (mode === "subpath" && req.url.startsWith("/prowlarr/api/v1/system/status")) {
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ version: "1.25.0", appName: "Prowlarr", instanceName: "Prowlarr" }));
        }

        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not Found" }));
    });

    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
        // Test 3a : Instance standard à la racine
        mode = "root";
        const rootRes = await checkProwlarrConnectivity(baseUrl, "valid_key");
        assert.equal(rootRes.success, true);
        assert.equal(rootRes.valid, true);
        assert.equal(rootRes.version, "1.25.0");

        // Test 3b : Instance sous sous-chemin /prowlarr alors que l'utilisateur a saisi l'URL racine
        mode = "subpath";
        const subpathRes = await checkProwlarrConnectivity(baseUrl, "valid_key");
        assert.equal(subpathRes.success, true);
        assert.equal(subpathRes.valid, true);
        assert.equal(subpathRes.suggestedUrl, `${baseUrl}/prowlarr`, "Doit suggérer l'URL corrigée avec /prowlarr");

        // Test 3c : Clé invalide (HTTP 401)
        const unauthRes = await checkProwlarrConnectivity(baseUrl, "wrong_key");
        assert.equal(unauthRes.success, false);
        assert.ok(unauthRes.error.includes("401"), "Doit diagnostiquer l'erreur 401");
    } finally {
        server.close();
    }
});

test("Logger - formats user objects cleanly without [object Object]", () => {
    const { addLog, getLogs, runWithUser } = require("../lib/logger");
    const testUserObj = { uuid: "98765432-abcd-1234-ef00-567890abcdef", pseudo: "SuperUser" };

    runWithUser(testUserObj, () => {
        addLog("INFO", "TestMod", "Message from user");
    });

    const logs = getLogs({ limit: 10, search: "Message from user" });
    assert.ok(logs.length > 0, "Doit enregistrer le log");
    const lastLog = logs[logs.length - 1];
    assert.ok(!lastLog.user.includes("[object Object]"), "Ne doit JAMAIS contenir [object Object]");
    assert.ok(lastLog.user.includes("SuperUser"), "Doit contenir le pseudo SuperUser");
    assert.ok(lastLog.user.includes("98765432"), "Doit contenir l'UUID tronqué");
});

test("Database - records and retrieves top search rankings", () => {
    const { recordSearchQuery, getTopSearches, clearSearchQueries } = require("../lib/db");
    clearSearchQueries();

    recordSearchQuery("tt15239678", "Dune: Part Two", "movie");
    recordSearchQuery("tt15239678", "Dune: Part Two", "movie");
    recordSearchQuery("tt15239678", "Dune: Part Two", "movie");

    recordSearchQuery("tt0903747", "Breaking Bad", "series");
    recordSearchQuery("tt0903747", "Breaking Bad", "series");

    recordSearchQuery("kitsu:1234", "Attack on Titan", "anime");

    const top = getTopSearches(5);
    assert.ok(top.length >= 3, "Doit contenir au moins 3 recherches");
    assert.equal(top[0].id, "tt15239678", "Le plus recherché doit être en premier");
    assert.equal(top[0].title, "Dune: Part Two");
    assert.equal(top[0].count, 3);
    assert.equal(top[1].id, "tt0903747");
    assert.equal(top[1].count, 2);
    assert.equal(top[2].id, "kitsu:1234");
    assert.equal(top[2].count, 1);
});

test("Database - getAllUsersAdmin sorting works across newest, oldest, alpha and last_active", () => {
    const { createUser, deleteUser, getAllUsersAdmin } = require("../lib/db");
    const u1 = "11111111-0000-0000-0000-000000000001";
    const u2 = "22222222-0000-0000-0000-000000000002";

    try {
        createUser(u1, "hash1", "enc1", "Zorro", "local");
        createUser(u2, "hash2", "enc2", "Alain", "shared");

        const byAlpha = getAllUsersAdmin("alpha");
        assert.ok(byAlpha.length >= 2);
        const alainIdx = byAlpha.findIndex(u => u.pseudo === "Alain");
        const zorroIdx = byAlpha.findIndex(u => u.pseudo === "Zorro");
        assert.ok(alainIdx !== -1 && zorroIdx !== -1);
        assert.ok(alainIdx < zorroIdx, "Alain doit précéder Zorro en ordre alphabétique");

        const byNewest = getAllUsersAdmin("newest");
        assert.ok(byNewest.length >= 2);
    } finally {
        deleteUser(u1);
        deleteUser(u2);
    }
});

test("Helpers - formatAioStream supports precache, global and torrentio badges", () => {
    const { formatAioStream } = require("../lib/helpers");

    const precache = formatAioStream({
        filename: "Dune.Part.Two.2024.1080p.mkv",
        cacheType: "precache",
        isInstant: true
    });
    assert.ok(precache.name.includes("[AD ⚡ Pré-cache]"), "Badge pré-cache");
    assert.ok(precache.title.includes("⚡ Pré-cache RSS • AllDebrid"));

    const globalCache = formatAioStream({
        filename: "Breaking.Bad.S01E01.1080p.mkv",
        cacheType: "global",
        isInstant: true
    });
    assert.ok(globalCache.name.includes("[AD ⚡ Cache Global]"), "Badge cache global");
    assert.ok(globalCache.title.includes("⚡ Cache Global (Mutualisé)"));

    const direct = formatAioStream({
        filename: "Solo.Leveling.S01E01.1080p.mkv",
        cacheType: "direct",
        isInstant: true
    });
    assert.ok(direct.name.includes("[AD ⚡ Direct]"), "Badge direct");
    assert.ok(direct.title.includes("⚡ Recherche Prowlarr Directe"));

    const torrentio = formatAioStream({
        filename: "Inception.2010.1080p.mkv",
        cacheType: "torrentio",
        isInstant: true
    });
    assert.ok(torrentio.name.includes("[AD ⚡ Torrentio]"), "Badge Torrentio");
    assert.ok(torrentio.title.includes("⚡ Instantané Torrentio • AllDebrid"));
});

test("Torbox - checkTorboxKey, checkInstantTorbox and stream permalinks", async () => {
    const {
        checkTorboxKey,
        getTorboxStreamUrl,
        TORBOX_API_BASE
    } = require("../lib/torbox");

    // 1. Validation de clé invalide sans appel réseau
    const emptyKeyRes = await checkTorboxKey("");
    assert.equal(emptyKeyRes.valid, false);

    // 2. Génération de permalink CDN redirect=true
    const streamUrl = await getTorboxStreamUrl(1234, 5, "my_test_torbox_key", true);
    assert.equal(streamUrl, `${TORBOX_API_BASE}/torrents/requestdl?token=my_test_torbox_key&torrent_id=1234&file_id=5&redirect=true`);
});

test("Torbox - Helpers formatAioStream formats streams with [TB] badges and Torbox labels", () => {
    const { formatAioStream } = require("../lib/helpers");

    const precache = formatAioStream({
        filename: "Dune.Part.Two.2024.1080p.mkv",
        cacheType: "precache",
        isInstant: true,
        debridProvider: "torbox"
    });
    assert.ok(precache.name.includes("[TB ⚡ Pré-cache]"), "Badge Torbox pré-cache");
    assert.ok(precache.title.includes("⚡ Pré-cache RSS • Torbox"));

    const globalCache = formatAioStream({
        filename: "Breaking.Bad.S01E01.1080p.mkv",
        cacheType: "global",
        isInstant: true,
        debridProvider: "torbox"
    });
    assert.ok(globalCache.name.includes("[TB ⚡ Cache Global]"), "Badge Torbox cache global");

    const downloading = formatAioStream({
        filename: "Gladiator.II.2024.1080p.mkv",
        isInstant: false,
        debridProvider: "torbox"
    });
    assert.ok(downloading.name.includes("[TB ⏳]"), "Badge Torbox téléchargement");
    assert.ok(downloading.title.includes("⏳ En téléchargement Torbox"));

    const torrentio = formatAioStream({
        filename: "Inception.2010.1080p.mkv",
        cacheType: "torrentio",
        isInstant: true,
        debridProvider: "torbox"
    });
    assert.ok(torrentio.name.includes("[TB ⚡ Torrentio]"), "Badge Torbox Torrentio");
    assert.ok(torrentio.title.includes("⚡ Instantané Torrentio • Torbox"));
});

test("Torbox - checkInstantTorbox parses object and list mock responses", async () => {
    const { checkInstantTorbox, torboxApi } = require("../lib/torbox");
    const origGet = torboxApi.get;

    try {
        const hash1 = "1111111111111111111111111111111111111111";
        const hash2 = "2222222222222222222222222222222222222222";

        // Mock format object
        torboxApi.get = async function(url, config) {
            if (url && url.includes("/torrents/checkcached")) {
                return {
                    status: 200,
                    data: {
                        success: true,
                        data: {
                            [hash1]: { name: "Film 1", size: 1000 },
                            [hash2]: null
                        }
                    }
                };
            }
            return origGet.apply(this, arguments);
        };

        const resultObj = await checkInstantTorbox([hash1, hash2], "mock_token");
        assert.equal(resultObj[hash1], true);
        assert.equal(resultObj[hash2], undefined);

        // Mock format list
        torboxApi.get = async function(url, config) {
            if (url && url.includes("/torrents/checkcached")) {
                return {
                    status: 200,
                    data: {
                        success: true,
                        data: [
                            { hash: hash1, name: "Film 1" }
                        ]
                    }
                };
            }
            return origGet.apply(this, arguments);
        };

        const resultList = await checkInstantTorbox([hash1, hash2], "mock_token");
        assert.equal(resultList[hash1], true);
        assert.equal(resultList[hash2], undefined);
    } finally {
        torboxApi.get = origGet;
    }
});

test("Torbox - unlockTorboxFileTarget resolves tb_cloud and handles direct URLs", async () => {
    const { unlockTorboxFileTarget } = require("../lib/resolver");

    const direct = await unlockTorboxFileTarget("key123", "https://storage.torbox.app/cdn/video.mp4");
    assert.equal(direct, "https://storage.torbox.app/cdn/video.mp4");

    const cloudRef = await unlockTorboxFileTarget("key123", "tb_cloud:456:78");
    assert.ok(cloudRef && cloudRef.includes("torrent_id=456") && cloudRef.includes("file_id=78") && cloudRef.includes("token=key123"));
});




