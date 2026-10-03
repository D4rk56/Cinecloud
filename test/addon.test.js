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

const { hashPassword, verifyPassword, encryptConfig, decryptConfig } = require("../lib/crypto");

const { pickBestVideoFile } = require("../lib/resolver");

const { handleManifest, handleCatalog } = require("../lib/stremio");

const {
    upsertCachedTorrent,
    getCachedTorrentsByImdb,
    deleteCachedTorrent,
    purgeOldCachedTorrents,
    createUser,
    getSharedProwlarrInstances
} = require("../lib/db");

const { isLocalOrPrivateUrl } = require("../lib/prowlarr-worker");

const { logger, runWithUser } = require("../lib/logger");

const { filterAndSortStreams } = require("../lib/helpers");

const vm = require("node:vm");
const { renderConfigPage, renderAdminPage } = require("../lib/ui");

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

    const res4 = extractCleanTitle("Blade.Runner.2049.2017.MULTi.1080p.BluRay.x264.mkv");
    assert.equal(res4.title, "Blade Runner 2049");
    assert.equal(res4.year, "2017");

    const res5 = extractCleanTitle("1917.2019.FRENCH.1080p.BluRay.mkv");
    assert.equal(res5.title, "1917");
    assert.equal(res5.year, "2019");

    const res6 = extractCleanTitle("Inception.EXTENDED.REPACK.1080p.BluRay.mkv");
    assert.equal(res6.title, "Inception");

    const res7 = extractCleanTitle("Dune.Part.Two.2024.2160p.UHD.HDR.mkv");
    assert.equal(res7.title, "Dune Part Two");
    assert.equal(res7.year, "2024");
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
    assert.equal(
        matchCloud.n,
        "Breaking.Bad.S02E05.720p.mkv",
        "Doit sélectionner l'épisode 5 et non le plus gros fichier"
    );

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

test("Stremio - handleManifest returns valid manifest with Cinécloud branding, logo and configure button", () => {
    const manifest = handleManifest(
        { enabledCatalogs: "my_ad_magnets,my_ad_links" },
        "https://cinecloud.fr",
        "test-uuid"
    );
    assert.equal(manifest.name, "Cinécloud");
    assert.equal(manifest.id, "org.nuvio.alldebrid");
    assert.equal(manifest.version, "2.4.0");
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
    assert.ok(
        !afterDelete.some(t => t.infoHash.toLowerCase() === testHash.toLowerCase()),
        "Le torrent doit être supprimé"
    );

    const purged = purgeOldCachedTorrents(30 * 86400);
    assert.ok(typeof purged === "number", "La purge doit retourner un nombre");
});

test("Helpers - imdbIdToTitle handles series and movies with Cinemeta fallback", async () => {
    const { imdbIdToTitle } = require("../lib/helpers");
    const axios = require("axios");
    const originalGet = axios.get;

    // Mock du réseau Cinemeta : le CI n'a pas d'accès externe fiable (sinon timeout 4s → échec).
    axios.get = async url => {
        const u = typeof url === "string" ? url : "";
        if (u.includes("/meta/series/tt0903747.json")) {
            return { data: { meta: { name: "Breaking Bad", year: "2008" } } };
        }
        if (u.includes("/meta/movie/tt1375666.json")) {
            return { data: { meta: { name: "Inception", year: "2010" } } };
        }
        return { data: {} };
    };

    try {
        // Breaking Bad (série)
        const seriesTitle = await imdbIdToTitle("tt0903747", null, "series");
        assert.ok(seriesTitle, "Doit trouver un titre pour la série");
        assert.match(seriesTitle, /Breaking Bad/i, "Doit être Breaking Bad et non le film Mirror");

        // Inception (film)
        const movieTitle = await imdbIdToTitle("tt1375666", null, "movie");
        assert.ok(movieTitle, "Doit trouver un titre pour le film");
        assert.match(movieTitle, /Inception/i, "Doit être Inception");
    } finally {
        axios.get = originalGet;
    }
});

test("Prowlarr Worker - resolveReleaseImdbId prioritizes series for TV releases", async () => {
    const { resolveReleaseImdbId, imdbResolutionCache } = require("../lib/prowlarr-worker");
    const axios = require("axios");
    const originalGet = axios.get;

    // Mock du réseau Cinemeta (pas d'appel externe en test : sinon timeout 4s → null en CI).
    axios.get = async url => {
        const u = typeof url === "string" ? url : "";
        if (u.includes("cinemeta.strem.io/catalog/series") && /breaking/i.test(decodeURIComponent(u))) {
            return {
                data: {
                    metas: [{ id: "tt0903747", imdb_id: "tt0903747", name: "Breaking Bad", year: "2008" }]
                }
            };
        }
        return { data: { metas: [] } };
    };

    try {
        // Purger un éventuel résultat négatif mis en cache par un test précédent
        imdbResolutionCache.clear();

        // Release avec motif de série S01E01
        const imdbSeries = await resolveReleaseImdbId("Breaking Bad S01E01 1080p", true);
        assert.equal(
            imdbSeries,
            "tt0903747",
            "Doit associer la série Breaking Bad tt0903747 et non le film El Camino tt9243946"
        );
    } finally {
        axios.get = originalGet;
    }
});

test("Helpers - isConfidentTitleMatch rejects error strings and unrelated titles", () => {
    const { isConfidentTitleMatch } = require("../lib/helpers");

    // Faux positifs critiques identifiés chez l'utilisateur
    assert.equal(
        isConfidentTitleMatch("not allowed", "Men Not Allowed"),
        false,
        "Doit rejeter 'not allowed' mappé vers Men Not Allowed"
    );
    assert.equal(isConfidentTitleMatch("method not allowed", "Men Not Allowed"), false);
    assert.equal(isConfidentTitleMatch("404", "404 Not Found"), false);
    assert.equal(isConfidentTitleMatch("archive", "Rare Exports"), false);
    assert.equal(isConfidentTitleMatch("ipnotallowed", "Ip Not Allowed"), false, "Doit rejeter 'ipnotallowed'");
    assert.equal(isConfidentTitleMatch("ip not allowed", "Ip Not Allowed"), false, "Doit rejeter 'ip not allowed'");
    assert.equal(
        isConfidentTitleMatch("generic_ip_not_allowed", "Some Title"),
        false,
        "Doit rejeter 'generic_ip_not_allowed'"
    );

    // Titres légitimes avec ponctuation ou variantes
    assert.equal(isConfidentTitleMatch("Avengers Endgame", "Avengers: Endgame"), true);
    assert.equal(isConfidentTitleMatch("The Amateur", "The Amateur"), true);
    assert.equal(isConfidentTitleMatch("Inception", "Inception", "2010", "2010"), true);

    // Rejet en cas d'écart d'année excessif
    assert.equal(isConfidentTitleMatch("Gladiator II", "Gladiator", "2024", "2000"), false);

    // Rejet strict des suites et chiffres romains même sans années fournies
    assert.equal(
        isConfidentTitleMatch("Gladiator", "Gladiator II"),
        false,
        "Gladiator ne doit pas matcher Gladiator II"
    );
    assert.equal(
        isConfidentTitleMatch("Gladiator II", "Gladiator"),
        false,
        "Gladiator II ne doit pas matcher Gladiator"
    );
    assert.equal(isConfidentTitleMatch("Avatar", "Avatar 2"), false, "Avatar ne doit pas matcher Avatar 2");
    assert.equal(isConfidentTitleMatch("Dune", "Dune: Part Two"), false, "Dune ne doit pas matcher Dune Part Two");
    assert.equal(
        isConfidentTitleMatch("Dune Part Two", "Dune: Part Two"),
        true,
        "Dune Part Two doit matcher Dune: Part Two"
    );
    assert.equal(
        isConfidentTitleMatch("Blade Runner", "Blade Runner 2049"),
        false,
        "Blade Runner ne doit pas matcher Blade Runner 2049"
    );
    assert.equal(
        isConfidentTitleMatch("Spider Man", "Spider Man No Way Home"),
        false,
        "Spider Man ne doit pas matcher Spider Man No Way Home"
    );
});

test("Helpers - filterAndSortStreams prioritizes cloud streams when prioritizeCloud is true", () => {
    const { filterAndSortStreams } = require("../lib/helpers");

    const streams = [
        {
            title: "Release 4K Prowlarr",
            _size: 20 * 1024 * 1024 * 1024,
            _resolution: "4k",
            _lang: "vff",
            _isCloud: false
        },
        {
            title: "Release 1080p Cloud",
            _size: 4 * 1024 * 1024 * 1024,
            _resolution: "1080p",
            _lang: "vff",
            _isCloud: true
        },
        {
            title: "Release 720p Lumio",
            _size: 2 * 1024 * 1024 * 1024,
            _resolution: "720p",
            _lang: "vff",
            _isCloud: false
        }
    ];

    // Sans priorisation cloud : 4K passe en premier
    const defaultSorted = filterAndSortStreams(streams, { prioritizeCloud: false });
    assert.equal(defaultSorted[0].title, "Release 4K Prowlarr");

    // Avec priorisation cloud : le fichier Cloud passe en tout premier
    const cloudSorted = filterAndSortStreams(streams, { prioritizeCloud: true });
    assert.equal(cloudSorted[0].title, "Release 1080p Cloud");
    assert.equal(cloudSorted[1].title, "Release 4K Prowlarr");

    // Avec priorisation cloud et tri par taille : Cloud reste en premier
    const sizeCloudSorted = filterAndSortStreams(streams, { prioritizeCloud: true, sortBy: "size" });
    assert.equal(sizeCloudSorted[0].title, "Release 1080p Cloud");
    assert.equal(sizeCloudSorted[1].title, "Release 4K Prowlarr");
});

test("Helpers - searchCinemeta finds accurate candidate with expectedYear", async () => {
    const { searchCinemeta } = require("../lib/helpers");
    const res = await searchCinemeta("Gladiator II", "movie", "2024");
    if (res) {
        assert.ok(res.name.toLowerCase().includes("gladiator"), "Doit trouver le film Gladiator");
        assert.ok(res.imdbId, "Doit avoir un identifiant IMDb valide");
    }
});

test("Catalogs - Recommendations catalogs are present in ALL_CATALOGS and manifest", () => {
    const { ALL_CATALOGS } = require("../lib/helpers");
    const recoIds = ["my_ad_reco_movies", "my_ad_reco_series", "my_ad_reco_animes", "my_ad_reco_animes_movies"];
    for (const rid of recoIds) {
        assert.ok(
            ALL_CATALOGS.some(c => c.id === rid),
            `Catalogue ${rid} doit être défini dans ALL_CATALOGS`
        );
    }

    const manifestAll = handleManifest({ enabledCatalogs: "all" });
    for (const rid of recoIds) {
        assert.ok(
            manifestAll.catalogs.some(c => c.id === rid),
            `Catalogue ${rid} doit être actif dans le manifeste`
        );
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

    const res = await handleCatalog(
        { apiKey: "test_key", tmdbKey: TMDB_KEY_DEFAULT },
        "movie",
        "my_ad_reco_movies",
        {}
    );
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
        status: code => {
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
        assert.equal(
            redirectUrl,
            "https://mock.debrid.it/dl/testfile.mkv",
            "Doit rediriger vers l'URL de téléchargement"
        );
    } finally {
        alldebrid.alldebridApi.post = originalPost;
        deleteUser(testUuid);
    }
});

test("Prowlarr On-Demand - searchProwlarrOnDemand handles queries and returns formatted results", async () => {
    const { searchProwlarrOnDemand } = require("../lib/prowlarr-worker");
    const axios = require("axios");
    const originalGet = axios.get;

    axios.get = async url => {
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
        assert.equal(
            paginatedRes.metas[0].id,
            fullRes.metas[5].id,
            "Le premier élément après skip=5 doit correspondre au 6ème élément global"
        );
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
            altTitle: "Attack on Titan",
            season: 1,
            episode: 1,
            prowlarrUrl: "http://prowlarr:9696",
            prowlarrKey: "mock_prowlarr_key",
            apiKey: null
        });

        assert.ok(interceptedUrl, "L'URL Prowlarr doit avoir été appelée");
        assert.ok(
            !interceptedUrl.includes("%3A") && !interceptedUrl.includes("%27"),
            "La recherche ne doit pas contenir de deux-points ou d'apostrophes encodés"
        );
        assert.ok(
            interceptedHeaders && interceptedHeaders["X-Api-Key"] === "mock_prowlarr_key",
            "Doit inclure l'en-tête X-Api-Key"
        );
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
        assert.equal(
            result.metas.length,
            2,
            "Doit regrouper les 4 épisodes en exactement 2 dossiers séries (Breaking Bad et Better Call Saul)"
        );
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

    assert.ok(
        routes.some(r => r.path === "/logo.png"),
        "Route /logo.png doit être définie"
    );
    assert.ok(
        routes.some(r => r.path === "/background.png"),
        "Route /background.png doit être définie"
    );
    assert.ok(
        routes.some(r => r.path === "/:uuid/configure"),
        "Route /:uuid/configure doit être définie"
    );
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
    assert.ok(
        formatted.title.includes("📄 Gladiator.II.2024.FRENCH.1080p.WEB.H264.mkv"),
        "Doit afficher le nom du fichier"
    );
    assert.ok(!formatted.title.includes("Mon Cloud"), "Ne doit plus afficher 'Mon Cloud'");
});

test("Helpers - filterAndSortStreams filters by resolution, language and limits", () => {
    const { filterAndSortStreams } = require("../lib/helpers");
    const sampleStreams = [
        {
            name: "Cinécloud\n1080p",
            description: "Gladiator II\n1080p • x264\n💾 4.00 GB • 250 👤\n🇫🇷 MULTI\n⚡ Prowlarr",
            _size: 4 * 1024 * 1024 * 1024,
            _resolution: "1080p",
            _seeders: 250,
            _lang: "multi"
        },
        {
            name: "Cinécloud\n4k",
            description: "Gladiator II\n4k • HEVC\n💾 18.00 GB • 100 👤\n🇫🇷 VFF\n⚡ Prowlarr",
            _size: 18 * 1024 * 1024 * 1024,
            _resolution: "4k",
            _seeders: 100,
            _lang: "vff"
        },
        {
            name: "Cinécloud\n720p",
            description: "Gladiator II\n720p • x264\n💾 2.00 GB • 50 👤\n🌐 Inconnu\n⚡ Prowlarr",
            _size: 2 * 1024 * 1024 * 1024,
            _resolution: "720p",
            _seeders: 50,
            _lang: "unknown"
        },
        {
            name: "Cinécloud\n480p",
            description: "Gladiator II\n480p • XviD\n💾 0.80 GB • 10 👤\n🇫🇷 VF\n⚡ Prowlarr",
            _size: 800 * 1024 * 1024,
            _resolution: "480p",
            _seeders: 10,
            _lang: "vf"
        }
    ];

    // 1. Filtrage exclusion résolution (ex: exclure 480p)
    const filteredRes = filterAndSortStreams(sampleStreams, { resolutions: "4k,1080p,720p" });
    assert.equal(
        filteredRes.some(s => s._resolution === "480p"),
        false,
        "480p doit être exclu"
    );

    // 2. Réordonnancement : 1080p en premier
    const reordered = filterAndSortStreams(sampleStreams, { resolutions: "1080p,4k,720p,480p" });
    assert.equal(reordered[0]._resolution, "1080p", "1080p doit être en première position");

    // 3. Masquer les langues inconnues
    const noUnknown = filterAndSortStreams(sampleStreams, { hideUnknownLanguages: true });
    assert.equal(
        noUnknown.some(s => s._lang === "unknown"),
        false,
        "Les langues inconnues doivent être filtrées"
    );

    // 4. Tri par taille décroissante
    const bySizeDesc = filterAndSortStreams(sampleStreams, { sortBy: "size" });
    assert.equal(bySizeDesc[0]._resolution, "4k", "Le plus gros fichier (18 Go) doit être en premier");

    // 5. Limite de taille max (ex: max 10 Go -> exclut le 4k de 18 Go)
    const limitedSize = filterAndSortStreams(sampleStreams, { maxSizeGb: 10 });
    assert.equal(
        limitedSize.some(s => s._size > 10 * 1024 * 1024 * 1024),
        false,
        "Les fichiers > 10 Go doivent être exclus"
    );

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
        const resLogin = await axios.post(`${base}/api/admin/login`, {
            password: process.env.ADMIN_PASSWORD || "admin123"
        });
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
        assert.ok(resManifest.data.description.includes("haute performance"), "Description officielle présente");
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
    const hasShared = sharedInstances.some(
        inst => inst.url === "https://prowlarr.shared.net" && inst.key === "key-shared"
    );
    const hasPrivate = sharedInstances.some(inst => inst.url === "https://prowlarr.private.net");
    const hasLocal = sharedInstances.some(inst => inst.userUuid === localUuid);

    assert.ok(hasShared, "L'instance en mode 'shared' doit être incluse dans le crowdsourcing");
    assert.ok(!hasPrivate, "L'instance en mode 'private' NE doit PAS être partagée pour le RSS");
    assert.ok(!hasLocal, "L'instance en mode 'local' n'a pas de serveur Prowlarr");
});

test("Catalogs - disableCatalogs hides catalogs from manifest and catalog route", async () => {
    // 1. Manifest sans catalogue quand disableCatalogs est actif
    const manifestDisabled = handleManifest({ disableCatalogs: true, pseudo: "NoCatalogs" });
    assert.equal(
        manifestDisabled.catalogs.length,
        0,
        "Les catalogues doivent être complètement vides dans le manifest"
    );
    assert.ok(
        !manifestDisabled.resources.includes("catalog"),
        "La ressource catalog ne doit pas être présente si désactivée"
    );

    // 2. Manifest normal quand disableCatalogs est inactif ou par défaut (config vide)
    const manifestEnabled = handleManifest({ disableCatalogs: false, pseudo: "WithCatalogs" });
    assert.ok(
        manifestEnabled.catalogs.length > 0,
        "Les catalogues doivent être présents quand disableCatalogs est false"
    );

    const manifestDefault = handleManifest({});
    assert.ok(
        manifestDefault.catalogs.length > 0,
        "Les catalogues doivent être activés par défaut avec une config vide"
    );
    assert.ok(manifestDefault.resources.includes("catalog"), "La ressource catalog doit être déclarée par défaut");
    assert.ok(manifestDefault.resources.includes("meta"), "La ressource meta doit être déclarée par défaut");

    // 3. Appel de handleCatalog avec disableCatalogs actif
    const catalogResult = await handleCatalog({ disableCatalogs: true }, "movie", "my_ad_magnets");
    assert.deepEqual(catalogResult, { metas: [] }, "Doit retourner une liste de métadonnées vide");

    // 4. Vérification du rendu HTML dans la page de configuration
    const html = renderConfigPage("register");
    assert.ok(
        !html.includes('id="disableCatalogs" checked'),
        "L'option disableCatalogs ne doit pas être cochée par défaut dans l'interface"
    );
    assert.ok(
        html.includes('id="catalogsList">'),
        "Le conteneur catalogsList ne doit pas être masqué par style='display: none;'"
    );
    assert.ok(
        !html.includes("🚫 Désactiver tous les catalogues personnels (Recommandé)"),
        "La mention '(Recommandé)' doit être retirée"
    );
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

    // 3. Stats de l'index : uniquement « Inscrits » et « Actifs (24h) » (la stat « En cache » a été retirée)
    assert.ok(configHtml.includes('id="statRegistered"'), "La stat « Inscrits » doit être présente");
    assert.ok(configHtml.includes('id="statActive"'), "La stat « Actifs (24h) » doit être présente");
    assert.ok(configHtml.includes("Inscrits"), "Le libellé « Inscrits » doit être présent");
    assert.ok(configHtml.includes("Actifs (24h)"), "Le libellé « Actifs (24h) » doit être présent");
    assert.ok(!configHtml.includes('id="statCached"'), "La stat « En cache » doit avoir été retirée");
    assert.ok(!configHtml.includes("En cache"), "Le libellé « En cache » doit avoir été retiré");
});

test("Helpers - formatAioStream handles isInstant with ⚡, 🔍 and ⏳ badges", () => {
    const { formatAioStream } = require("../lib/helpers");

    // Flux instantané (isInstant: true)
    const instantStream = formatAioStream({
        filename: "Gladiator.II.2024.FRENCH.1080p.WEB.H264.mkv",
        sizeBytes: 4500000000,
        provider: "Cinécloud",
        indexer: "Prowlarr",
        isInstant: true,
        url: "http://example.com/stream"
    });
    assert.ok(instantStream.name.includes("[AD ⚡]"), "Doit inclure le badge [AD ⚡]");
    assert.ok(!instantStream.name.includes("[AD ⏳]"), "Ne doit pas inclure [AD ⏳]");
    assert.ok(instantStream.title.includes("⚡ Instantané AllDebrid"), "Doit inclure le statut instantané");

    // Flux Prowlarr non confirmé en cache (isInstant: false, indexer: Prowlarr) -> Badge [AD 🔍]
    const prowlarrStream = formatAioStream({
        filename: "Gladiator.II.2024.FRENCH.1080p.WEB.H264.mkv",
        sizeBytes: 4500000000,
        provider: "Cinécloud",
        indexer: "Prowlarr",
        seeders: 42,
        isInstant: false,
        url: "http://example.com/stream"
    });
    assert.ok(prowlarrStream.name.includes("[AD 🔍]"), "Prowlarr non confirmé doit porter le badge [AD 🔍]");
    assert.ok(!prowlarrStream.name.includes("[AD ⏳]"), "Ne doit pas inclure [AD ⏳]");
    assert.ok(!prowlarrStream.name.includes("[AD ⚡]"), "Ne doit pas inclure [AD ⚡]");
    assert.ok(prowlarrStream.title.includes("42 seeders"), "Doit afficher le nombre de seeders");
    assert.ok(prowlarrStream.title.includes("Vérif. cache au clic"), "Doit indiquer la vérification au clic");

    // Flux en cours de téléchargement standard sans Prowlarr -> Badge [AD ⏳]
    const downloadStream = formatAioStream({
        filename: "Gladiator.II.2024.FRENCH.1080p.WEB.H264.mkv",
        sizeBytes: 4500000000,
        provider: "Cinécloud",
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
    const netGuard = require("../lib/net-guard");

    // 1. Validation des paramètres requis
    const emptyRes = await checkProwlarrConnectivity("", "");
    assert.equal(emptyRes.success, false);
    assert.equal(emptyRes.valid, false);

    // 1b. Garde SSRF : les services auto-hébergés (prowlarr:9696, loopback, LAN) sont autorisés,
    //     seules les cibles dangereuses (link-local / métadonnées cloud) sont refusées.
    const metadataRes = await checkProwlarrConnectivity("http://169.254.169.254", "test_key");
    assert.equal(metadataRes.success, false);
    assert.ok(metadataRes.error.includes("refusée"), "Doit bloquer l'adresse de métadonnées cloud (SSRF)");

    assert.equal(
        (await netGuard.assertSafeSelfHostedUrl("http://127.0.0.1:9696")).ok,
        true,
        "Le loopback doit rester autorisé (Prowlarr local / host.docker.internal)"
    );
    assert.equal(
        (await netGuard.assertSafeSelfHostedUrl("http://prowlarr:9696")).ok,
        true,
        "Un nom d'hôte interne (prowlarr) doit rester autorisé"
    );
    assert.equal(
        (await netGuard.assertSafeSelfHostedUrl("http://169.254.169.254")).ok,
        false,
        "Les métadonnées cloud doivent être refusées"
    );

    // Régression : le Prowlarr interne par défaut (prowlarr:9696) ne doit PAS être refusé par la garde.
    const internalHostRes = await checkProwlarrConnectivity("http://prowlarr:9696", "test_key");
    assert.equal(internalHostRes.success, false);
    assert.ok(
        !internalHostRes.error.includes("refusée"),
        "Un Prowlarr interne (prowlarr:9696) ne doit pas être bloqué par la garde SSRF"
    );

    // 2. Diagnostic d'hôte introuvable
    const notFoundRes = await checkProwlarrConnectivity("http://prowlarr-inexistant-test:9696", "test_key");
    assert.equal(notFoundRes.success, false);
    assert.ok(
        notFoundRes.error.includes("Hôte 'prowlarr-inexistant-test' introuvable"),
        "Doit diagnostiquer l'hôte introuvable"
    );
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

    // Neutralise la garde SSRF pour tester la logique de diagnostic contre le serveur mock local.
    // La garde SSRF elle-même (loopback autorisé, métadonnées refusées) est vérifiée en 1b.
    const originalGuard = netGuard.assertSafeSelfHostedUrl;
    netGuard.assertSafeSelfHostedUrl = async () => ({ ok: true });

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

        // Test 3d : Détection d'URL Lumio saisie dans Prowlarr
        const lumioCheck = await checkProwlarrConnectivity("https://mylumio.tv/manifest.json", "some_key");
        assert.equal(lumioCheck.success, false);
        assert.ok(
            lumioCheck.error.includes("Lumio et Prowlarr sont deux services distincts"),
            "Doit détecter la confusion d'URL Lumio"
        );

        // Test 3e : Simulation d'erreur Cloudflare 1033 (HTTP 530)
        mode = "cf1033";
        server.removeAllListeners("request");
        server.on("request", (req, res) => {
            res.writeHead(530, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error_code: 1033, title: "Error 1033: Cloudflare Tunnel error" }));
        });
        const cfRes = await checkProwlarrConnectivity(baseUrl, "some_key");
        assert.equal(cfRes.success, false);
        assert.ok(cfRes.error.includes("Cloudflare 1033"), "Doit diagnostiquer l'erreur Cloudflare 1033");
    } finally {
        server.close();
        netGuard.assertSafeSelfHostedUrl = originalGuard;
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

test("Helpers - formatAioStream supports precache, global and lumio badges", () => {
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

    const lumio = formatAioStream({
        filename: "Inception.2010.1080p.mkv",
        cacheType: "lumio",
        isInstant: true
    });
    assert.ok(lumio.name.includes("[AD ⚡ Lumio]"), "Badge Lumio");
    assert.ok(lumio.title.includes("⚡ Instantané Lumio • AllDebrid"));
});

test("Torbox - checkTorboxKey, checkInstantTorbox and stream permalinks", async () => {
    const { checkTorboxKey, getTorboxStreamUrl, torboxApi } = require("../lib/torbox");
    const origGet = torboxApi.get;

    // 1. Validation de clé invalide sans appel réseau
    const emptyKeyRes = await checkTorboxKey("");
    assert.equal(emptyKeyRes.valid, false);

    try {
        // 2. Résolution du lien CDN côté serveur : la clé ne doit JAMAIS apparaître dans l'URL/query
        let capturedUrl = null;
        let capturedConfig = null;
        torboxApi.get = async function (url, config) {
            capturedUrl = url;
            capturedConfig = config;
            return { status: 200, data: { success: true, data: "https://storage.torbox.app/cdn/video.mp4" } };
        };

        const streamUrl = await getTorboxStreamUrl(1234, 5, "my_test_torbox_key");
        assert.equal(streamUrl, "https://storage.torbox.app/cdn/video.mp4");
        assert.ok(capturedUrl && capturedUrl.includes("/torrents/requestdl"), "Doit appeler requestdl");
        assert.ok(!capturedUrl.includes("token="), "La clé ne doit pas apparaître dans l'URL");
        assert.ok(
            !capturedConfig || !capturedConfig.params || !("token" in capturedConfig.params),
            "La clé ne doit pas être passée en query string"
        );
        assert.equal(capturedConfig.headers.Authorization, "Bearer my_test_torbox_key");
    } finally {
        torboxApi.get = origGet;
    }
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

    const lumio = formatAioStream({
        filename: "Inception.2010.1080p.mkv",
        cacheType: "lumio",
        isInstant: true,
        debridProvider: "torbox"
    });
    assert.ok(lumio.name.includes("[TB ⚡ Lumio]"), "Badge Torbox Lumio");
    assert.ok(lumio.title.includes("⚡ Instantané Lumio • Torbox"));
});

test("Torbox - checkInstantTorbox parses object and list mock responses", async () => {
    const { checkInstantTorbox, torboxApi } = require("../lib/torbox");
    const origGet = torboxApi.get;

    try {
        const hash1 = "1111111111111111111111111111111111111111";
        const hash2 = "2222222222222222222222222222222222222222";

        // Mock format object
        torboxApi.get = async function (url, config) {
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
        torboxApi.get = async function (url, config) {
            if (url && url.includes("/torrents/checkcached")) {
                return {
                    status: 200,
                    data: {
                        success: true,
                        data: [{ hash: hash1, name: "Film 1" }]
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
    const { torboxApi } = require("../lib/torbox");
    const origGet = torboxApi.get;

    const direct = await unlockTorboxFileTarget("key123", "https://storage.torbox.app/cdn/video.mp4");
    assert.equal(direct, "https://storage.torbox.app/cdn/video.mp4");

    try {
        let capturedConfig = null;
        torboxApi.get = async function (url, config) {
            capturedConfig = config;
            return { status: 200, data: { success: true, data: "https://storage.torbox.app/cdn/resolved.mp4" } };
        };

        const cloudRef = await unlockTorboxFileTarget("key123", "tb_cloud:456:78");
        assert.equal(cloudRef, "https://storage.torbox.app/cdn/resolved.mp4");
        assert.ok(
            !capturedConfig || !capturedConfig.params || !("token" in capturedConfig.params),
            "La clé Torbox ne doit pas être passée en query string"
        );
        assert.equal(capturedConfig.headers.Authorization, "Bearer key123");
    } finally {
        torboxApi.get = origGet;
    }
});

test("Lumio - handleStream queries Lumio on-demand and filters out error cards", async () => {
    const { handleStream } = require("../lib/stremio");
    const axios = require("axios");
    const originalGet = axios.get;

    try {
        let interceptedEndpoint = null;
        axios.get = async function (url, config) {
            if (url && url.includes("/stream/movie/tt1234567.json")) {
                interceptedEndpoint = url;
                return {
                    status: 200,
                    data: {
                        streams: [
                            // 1. Carte d'erreur / sans URL à ignorer
                            {
                                name: "🔴 Lumio",
                                description: "Aucune source trouvée pour ce titre",
                                externalUrl: "https://mylumio.tv/configure"
                            },
                            // 2. Flux valide AllDebrid
                            {
                                name: "[AD⚡️] Lumio",
                                description:
                                    "1080p • BluRay • 💾 15,2 Go • 🔎 C411 | DMM\n🎧 HEVC • AC3 5.1\n🗂️ Test.Film.2024.1080p.mkv",
                                url: "https://mylumio.tv/play/valid123",
                                behaviorHints: {
                                    filename: "Test.Film.2024.1080p.mkv",
                                    videoSize: 15200000000
                                }
                            },
                            // 3. Flux Torbox
                            {
                                name: "[TB⚡️] Lumio",
                                description: "4K • WEB-DL • 💾 25 Go • 🔎 Tr4ker\n🗂️ Test.Film.2024.4K.mkv",
                                url: "https://mylumio.tv/play/valid456",
                                behaviorHints: {
                                    filename: "Test.Film.2024.4K.mkv",
                                    videoSize: 25000000000
                                }
                            }
                        ]
                    }
                };
            }
            return originalGet.apply(this, arguments);
        };

        const config = {
            apiKey: "dummy_ad_key",
            debridProvider: "alldebrid",
            lumioUrl: "https://mylumio.tv/test_token/manifest.json",
            prowlarrKey: "off"
        };

        const result = await handleStream(
            config,
            "movie",
            "tt1234567",
            { movies: {}, series: {} },
            "http://localhost:3000",
            "test-user"
        );

        assert.ok(
            interceptedEndpoint &&
                interceptedEndpoint.includes("https://mylumio.tv/test_token/stream/movie/tt1234567.json"),
            "Endpoint Lumio doit être appelé à la demande"
        );
        assert.ok(result && Array.isArray(result.streams), "Doit renvoyer un tableau de flux");

        // Vérifier que la carte d'erreur '🔴 Lumio' a été éliminée
        const hasErrorCard = result.streams.some(s => s.name && s.name.includes("🔴"));
        assert.equal(hasErrorCard, false, "Les cartes d'erreur Lumio ne doivent pas être incluses");

        // Vérifier les badges des flux retournés
        const adStream = result.streams.find(s => s.url === "https://mylumio.tv/play/valid123");
        assert.ok(adStream, "Le flux AllDebrid doit être présent");
        assert.ok(adStream.name.includes("[AD ⚡ Lumio]"), "Badge [AD ⚡ Lumio]");
        assert.ok(adStream.title.includes("⚡ Instantané Lumio • AllDebrid"));

        const tbStream = result.streams.find(s => s.url === "https://mylumio.tv/play/valid456");
        assert.ok(tbStream, "Le flux Torbox doit être présent");
        assert.ok(tbStream.name.includes("[TB ⚡ Lumio]"), "Badge [TB ⚡ Lumio]");
        assert.ok(tbStream.title.includes("⚡ Instantané Lumio • Torbox"));
    } finally {
        axios.get = originalGet;
    }
});

test("Helpers - formatAioStream source and status lines structure", () => {
    const { formatAioStream } = require("../lib/helpers");

    // 1. Source Prowlarr
    const prowlarrStream = formatAioStream({
        filename: "Dune.Part.Two.2024.1080p.mkv",
        indexer: "Prowlarr | YggTorrent",
        isInstant: true,
        debridProvider: "alldebrid"
    });
    assert.ok(prowlarrStream.name.startsWith("[AD ⚡]"), "Colonne de gauche épurée avec badge");
    assert.ok(prowlarrStream.name.includes("1080p"), "Colonne de gauche inclut la résolution");
    assert.ok(!prowlarrStream.name.includes("Cinécloud"), "Ne doit plus inclure de nom de provider superflu à gauche");
    assert.ok(prowlarrStream.title.includes("🔍 Prowlarr (YggTorrent)"), "Ligne de source Prowlarr");
    assert.ok(prowlarrStream.title.includes("⚡ Instantané AllDebrid"), "Ligne de statut instantané AD");

    // 2. Source Lumio avec sous-source
    const lumioStream = formatAioStream({
        filename: "Dune.Part.Two.2024.2160p.mkv",
        cacheType: "lumio",
        indexer: "Lumio | Sharewood",
        isInstant: true,
        debridProvider: "torbox"
    });
    assert.ok(lumioStream.name.startsWith("[TB ⚡ Lumio]"), "Badge Torbox Lumio");
    assert.ok(lumioStream.title.includes("🌐 Lumio (Sharewood)"), "Ligne de source Lumio détaillée");
    assert.ok(lumioStream.title.includes("⚡ Instantané Lumio • Torbox"), "Ligne de statut Lumio Torbox");

    // 3. Source Mon Cloud personnel
    const cloudStream = formatAioStream({
        filename: "MonFilm.2024.1080p.mkv",
        indexer: "Mon Cloud",
        isInstant: true,
        debridProvider: "alldebrid"
    });
    assert.ok(cloudStream.name.startsWith("[AD ⚡ Cloud]"), "Badge gauche Cloud");
    assert.ok(cloudStream.title.includes("☁️ Cloud personnel"), "Ligne de source Cloud personnel");
    assert.ok(cloudStream.title.includes("⚡ Lecture immédiate"), "Ligne de statut Lecture immédiate");
    assert.ok(
        !cloudStream.title.includes("Cloud personnel\n⚡ Cloud personnel"),
        "Ne doit pas doubler Cloud personnel"
    );

    // 4. Flux en cours de téléchargement (non instantané)
    const dlAdStream = formatAioStream({
        filename: "Gladiator.2000.1080p.mkv",
        isInstant: false,
        debridProvider: "alldebrid"
    });
    assert.ok(dlAdStream.name.includes("[AD ⏳]"));
    assert.ok(dlAdStream.title.includes("⏳ En téléchargement AllDebrid"));

    const dlTbStream = formatAioStream({
        filename: "Gladiator.2000.1080p.mkv",
        isInstant: false,
        debridProvider: "torbox"
    });
    assert.ok(dlTbStream.name.includes("[TB ⏳]"));
    assert.ok(dlTbStream.title.includes("⏳ En téléchargement Torbox"));
});

test("UI - Stepper naming, hidden login error, TMDB guidance, and Lumio links", () => {
    const { renderConfigPage, renderAdminPage } = require("../lib/ui");

    const htmlConfig = renderConfigPage("register");
    // #cfgLoginError doit avoir style="display: none;"
    assert.ok(htmlConfig.includes('id="cfgLoginError"'), "Doit contenir le conteneur d'erreur login");
    assert.ok(htmlConfig.includes("display: none"), "L'erreur de login doit être masquée par défaut");

    // Stepper étape 4 doit s'appeler "Qualité & Cache"
    assert.ok(htmlConfig.includes("Qualité & Cache"), "L'étape 4 du stepper doit être nommée 'Qualité & Cache'");

    // TMDB indication optionnelle et lien Cinemeta
    assert.ok(htmlConfig.includes("Cinemeta"), "Doit mentionner Cinemeta comme fallback");
    assert.ok(
        htmlConfig.includes("Optionnelle") || htmlConfig.includes("optionnel"),
        "Doit indiquer que TMDB est optionnel"
    );

    // Lien cliquable vers https://mylumio.tv
    assert.ok(htmlConfig.includes('href="https://mylumio.tv"'), "Doit inclure un lien cliquable vers mylumio.tv");

    // Prowlarr libellé externe ou interne
    assert.ok(
        htmlConfig.includes("Optionnel - Instance externe ou interne"),
        "Doit afficher le libellé Prowlarr explicite"
    );

    // Admin UI
    const htmlAdmin = renderAdminPage();
    assert.ok(htmlAdmin.includes("escapeHtml"), "L'interface Admin doit définir la fonction escapeHtml");
    assert.ok(htmlAdmin.includes("/api/admin/health/debrid"), "L'interface Admin doit avoir la sonde de santé");
    assert.ok(htmlAdmin.includes("/api/admin/backup"), "L'interface Admin doit inclure le téléchargement de backup");
    assert.ok(htmlAdmin.includes("/api/admin/maintenance/vacuum"), "L'interface Admin doit inclure le vacuum");
    assert.ok(
        htmlAdmin.includes("/api/admin/maintenance/purge-expired"),
        "L'interface Admin doit inclure la purge expirée"
    );
    assert.ok(htmlAdmin.includes("/api/admin/logout"), "L'interface Admin doit supporter la déconnexion");
});

test("User API - Update retains existing API keys when inputs are left empty", async () => {
    const app = require("../index");
    const axios = require("axios");

    const server = app.listen(0);
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    try {
        // 1. Enregistrement d'un utilisateur avec clés valides
        const regRes = await axios.post(`${base}/api/user/register`, {
            password: "updatePassword123",
            pseudo: "TestKeyRetention",
            apiKey: "original_alldebrid_key_abc123",
            torboxApiKey: "original_torbox_key_xyz789",
            prowlarrKey: "original_prowlarr_key_456"
        });
        assert.equal(regRes.status, 200);
        const uuid = regRes.data.uuid;

        // 2. Mise à jour avec champs de clé vides (comme envoyé par le formulaire quand l'utilisateur ne les modifie pas)
        const updateRes = await axios.post(`${base}/api/user/update`, {
            uuid,
            password: "updatePassword123",
            pseudo: "TestKeyRetentionUpdated",
            apiKey: "",
            torboxApiKey: "",
            prowlarrKey: "",
            resolutions: "1080p"
        });
        assert.equal(updateRes.status, 200);
        assert.equal(updateRes.data.success, true);

        // 3. Vérification de la persistance des clés enregistrées (sans fuite des clés debrideur)
        const loginRes = await axios.post(`${base}/api/user/login`, {
            uuid,
            password: "updatePassword123"
        });
        assert.equal(loginRes.status, 200);
        // Les clés debrideur complètes ne doivent PAS être renvoyées au client
        assert.equal(loginRes.data.config.apiKey, undefined, "apiKey complet ne doit pas fuiter");
        assert.equal(loginRes.data.config.torboxApiKey, undefined, "torboxApiKey complet ne doit pas fuiter");
        // Seules les previews masquées sont renvoyées
        assert.equal(loginRes.data.config.apiKeyPreview, "orig...c123");
        assert.equal(loginRes.data.config.torboxApiKeyPreview, "orig...z789");
        assert.equal(
            loginRes.data.config.prowlarrKey,
            "original_prowlarr_key_456",
            "La clé Prowlarr ne doit pas être écrasée par une chaîne vide"
        );
        assert.equal(loginRes.data.config.resolutions, "1080p", "Les réglages modifiés doivent bien être mis à jour");

        // 4. Nettoyage
        await axios.post(`${base}/api/user/delete`, {
            uuid,
            password: "updatePassword123"
        });
    } finally {
        server.close();
    }
});

test("Admin API - Security, Maintenance, Backup, and Health Probe endpoints", async () => {
    const app = require("../index");
    const axios = require("axios");

    const server = app.listen(0);
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    try {
        const correctPassword = process.env.ADMIN_PASSWORD || "admin123";

        // 1. Rejet mot de passe vide ou incorrect
        try {
            await axios.post(`${base}/api/admin/login`, { password: "" });
            assert.fail("Doit rejeter un mot de passe vide");
        } catch (err) {
            assert.equal(err.response?.status, 401);
        }

        try {
            await axios.post(`${base}/api/admin/login`, { password: "mauvaise_longueur_trop_long" });
            assert.fail("Doit rejeter un mauvais mot de passe");
        } catch (err) {
            assert.equal(err.response?.status, 401);
        }

        // 2. Connexion réussie et génération de token
        const loginRes = await axios.post(`${base}/api/admin/login`, { password: correctPassword });
        assert.equal(loginRes.status, 200);
        assert.ok(loginRes.data.token, "Un token d'administration doit être retourné");
        const token = loginRes.data.token;

        // 3. Maintenance - Purge expired
        // 3a. Sans token -> 401
        try {
            await axios.post(`${base}/api/admin/maintenance/purge-expired`);
            assert.fail("Doit rejeter sans token");
        } catch (err) {
            assert.equal(err.response?.status, 401);
        }
        // 3b. Avec token -> 200
        const purgeRes = await axios.post(
            `${base}/api/admin/maintenance/purge-expired`,
            {},
            {
                headers: { "x-admin-token": token }
            }
        );
        assert.equal(purgeRes.status, 200);
        assert.equal(purgeRes.data.success, true);
        assert.ok(typeof purgeRes.data.purged === "number");

        // 4. Maintenance - Vacuum / optimize
        const vacuumRes = await axios.post(
            `${base}/api/admin/maintenance/vacuum`,
            {},
            {
                headers: { "x-admin-token": token }
            }
        );
        assert.equal(vacuumRes.status, 200);
        assert.equal(vacuumRes.data.success, true);

        // 5. Maintenance - Prowlarr sync
        const syncRes = await axios.post(
            `${base}/api/admin/prowlarr/sync`,
            {},
            {
                headers: { "x-admin-token": token }
            }
        );
        assert.equal(syncRes.status, 200);
        assert.equal(typeof syncRes.data.success, "boolean");

        // 6. Sonde santé Debrid (/api/admin/health/debrid)
        const healthRes = await axios.get(`${base}/api/admin/health/debrid`, {
            headers: { "x-admin-token": token }
        });
        assert.equal(healthRes.status, 200);
        assert.ok(healthRes.data.alldebrid);
        assert.ok(healthRes.data.torbox);
        assert.ok(["online", "degraded", "offline"].includes(healthRes.data.alldebrid.status));
        assert.ok(["online", "degraded", "offline"].includes(healthRes.data.torbox.status));

        // 7. Backup SQLite (/api/admin/backup)
        const backupRes = await axios.get(`${base}/api/admin/backup`, {
            headers: { "x-admin-token": token },
            responseType: "arraybuffer"
        });
        assert.equal(backupRes.status, 200);
        const backupBuffer = Buffer.from(backupRes.data);
        assert.ok(backupBuffer.length > 0, "Le fichier de backup ne doit pas être vide");
        const headerStr = backupBuffer.subarray(0, 16).toString("utf8");
        assert.ok(headerStr.startsWith("SQLite format 3"), "Le backup doit être une base SQLite valide");

        // 8. Validation format UUID sur suppression utilisateur
        try {
            await axios.delete(`${base}/api/admin/users/bad-uuid-format`, {
                headers: { "x-admin-token": token }
            });
            assert.fail("Doit rejeter un format UUID invalide avec 400");
        } catch (err) {
            assert.equal(err.response?.status, 400);
        }

        // 9. Révocation de token via logout
        const logoutRes = await axios.post(
            `${base}/api/admin/logout`,
            {},
            {
                headers: { "x-admin-token": token }
            }
        );
        assert.equal(logoutRes.status, 200);
        assert.equal(logoutRes.data.success, true);

        // Vérification que le token révoqué ne permet plus d'accéder aux routes admin
        try {
            await axios.get(`${base}/api/admin/stats`, {
                headers: { "x-admin-token": token }
            });
            assert.fail("Le token révoqué doit être refusé avec 401");
        } catch (err) {
            assert.equal(err.response?.status, 401);
        }
    } finally {
        server.close();
    }
});

// =============================================================================
// TESTS MODULES ANIME : PARSING, MAPPING, NORMALISATION & MATCHING
// =============================================================================

const {
    parseAnimeTitle,
    parseAnimeTitleFallback,
    normalizeAnimeTitle,
    isAnimeTitleMatch,
    resolveEpisodeNumbering
} = require("../lib/animeParser");

const {
    loadAnimeMapping,
    getAnimeMappingByKitsu,
    getAnimeMappingByImdb,
    getAnimeMappingByImdbAndSeason,
    getAnimeMappingByTvdb,
    getAnimeMappingByTmdb,
    sanitizeImdbId,
    sanitizeKitsuId,
    LruCache,
    fetchKitsuDetails
} = require("../lib/animeMapping");

const { resolveKitsuMeta } = require("../lib/helpers");

test("AnimeParser - Extraction de métadonnées et parsing avec Anitomy et fallback", () => {
    // 1. Release classique avec numéro d'épisode absolu à trois chiffres
    const res1 = parseAnimeTitle("[SubsPlease] Boku no Hero Academia - 139 (1080p) [ABCD1234].mkv");
    assert.equal(res1.success, true);
    assert.equal(res1.title, "Boku no Hero Academia");
    assert.equal(res1.episode, 139);
    assert.equal(res1.releaseGroup, "SubsPlease");
    assert.equal(res1.resolution, "1080p");
    assert.equal(res1.fileExtension, "mkv");

    // 2. Release avec codec HEVC et groupe Erai-raws
    const res2 = parseAnimeTitle("[Erai-raws] Jujutsu Kaisen - 01 [1080p][HEVC].mkv");
    assert.equal(res2.success, true);
    assert.equal(res2.title, "Jujutsu Kaisen");
    assert.equal(res2.episode, 1);
    assert.equal(res2.releaseGroup, "Erai-raws");
    assert.equal(res2.resolution, "1080p");

    // 3. Release batch (plage d'épisodes)
    const res3 = parseAnimeTitle("[SubsPlease] Spy x Family - 01-12 [1080p].mkv");
    assert.equal(res3.success, true);
    assert.equal(res3.isBatch, true);
    assert.equal(res3.episode, 1);
    assert.equal(res3.episodeEnd, 12);

    // 4. Test du parser fallback sur format standard SxxExx
    const resFallback = parseAnimeTitleFallback("[EMBER] Shingeki no Kyojin S02E05 [1080p].mkv");
    assert.equal(resFallback.success, true);
    assert.equal(resFallback.season, 2);
    assert.equal(resFallback.episode, 5);
    assert.equal(resFallback.releaseGroup, "EMBER");

    // 5. Résilience face aux entrées nulles ou malformées (anti-crash)
    const resNull = parseAnimeTitle(null);
    assert.equal(resNull.success, false);
    assert.equal(resNull.episode, null);

    const resEmpty = parseAnimeTitle("");
    assert.equal(resEmpty.success, false);
});

test("AnimeParser - Détection des saisons intégrées au titre (faux positifs de saison)", () => {
    // 1. "2nd Season" dans le nom de l'anime
    const res1 = parseAnimeTitle("[Erai-raws] Jujutsu Kaisen 2nd Season - 05 [1080p][HEVC].mkv");
    assert.equal(res1.season, 2);
    assert.equal(res1.episode, 5);
    assert.equal(res1.baseTitle, "Jujutsu Kaisen");

    // 2. "The Final Season Part 2"
    const res2 = parseAnimeTitle("[EMBER] Shingeki no Kyojin The Final Season Part 2 - 01 [1080p].mkv");
    assert.equal(res2.season, 4);
    assert.equal(res2.episode, 1);
    assert.ok(res2.baseTitle.includes("Shingeki no Kyojin"));

    // 3. "Season 3"
    const res3 = parseAnimeTitle("[SubsPlease] Mob Psycho 100 Season 3 - 08 (1080p).mkv");
    assert.equal(res3.season, 3);
    assert.equal(res3.episode, 8);
    assert.equal(res3.baseTitle, "Mob Psycho 100");
});

test("AnimeParser - Normalisation des titres et gestion du Romaji / plein chasse", () => {
    // Plein chasse (Fullwidth ASCII japonais)
    const norm1 = normalizeAnimeTitle("Ｓｈｉｎｇｅｋｉ no Kyojin");
    assert.equal(norm1, "shingeki no kyojin");

    // Diacritiques et macrons romaji (ō -> o, ū -> u)
    const norm2 = normalizeAnimeTitle("Shingeki no Kyōjin: The Final Season");
    assert.equal(norm2, "shingeki no kyojin the final season");

    // Suppression ponctuation, crochets et parenthèses métadonnées
    const norm3 = normalizeAnimeTitle("[SubsPlease] Boku no Hero Academia (TV) (2024) [1080p]!");
    assert.equal(norm3, "boku no hero academia");
});

test("AnimeParser - Fuzzy matching de titres avec string-similarity et alias", () => {
    // 1. Match exact via alias officiel
    const match1 = isAnimeTitleMatch("Shingeki no Kyojin", "Attack on Titan", ["Shingeki no Kyojin", "AoT"]);
    assert.equal(match1.isMatch, true);
    assert.equal(match1.similarity, 1.0);

    // 2. Fuzzy match avec titre légèrement altéré
    const match2 = isAnimeTitleMatch(
        "Kimetsu no Yaiba Swordsmith Village Arc",
        "Kimetsu no Yaiba: Katanakaji no Sato-hen",
        ["Demon Slayer: Kimetsu no Yaiba Swordsmith Village Arc"],
        0.82
    );
    assert.equal(match2.isMatch, true);
    assert.ok(match2.similarity >= 0.82);

    // 3. Rejet d'un anime complètement différent
    const matchMismatch = isAnimeTitleMatch("Naruto Shippuden", "Attack on Titan", ["Shingeki no Kyojin"], 0.82);
    assert.equal(matchMismatch.isMatch, false);
});

test("AnimeParser - Résolution de la numérotation absolue vs saison/épisode", () => {
    // AOT : Saison 1 (25 épisodes), Saison 2 (12 épisodes)
    const seasonCounts = { 1: 25, 2: 12, 3: 22 };

    // S02E05 -> Épisode absolu 30
    const absRes = resolveEpisodeNumbering({ season: 2, episode: 5 }, seasonCounts);
    assert.equal(absRes.absoluteEpisode, 30);
    assert.equal(absRes.season, 2);
    assert.equal(absRes.episode, 5);

    // Épisode absolu 30 sans saison -> Saison 2, Épisode 5
    const relRes = resolveEpisodeNumbering({ episode: 30 }, seasonCounts);
    assert.equal(relRes.season, 2);
    assert.equal(relRes.episode, 5);
    assert.equal(relRes.absoluteEpisode, 30);
    assert.equal(relRes.isAbsolute, true);

    // S01E10 -> Épisode absolu 10
    const s1Res = resolveEpisodeNumbering({ season: 1, episode: 10 }, seasonCounts);
    assert.equal(s1Res.absoluteEpisode, 10);
    assert.equal(s1Res.season, 1);
    assert.equal(s1Res.episode, 10);
});

test("AnimeMapping - Indexation en mémoire O(1) de la table Fribb et mapping kitsu/imdb/tvdb/tmdb", async () => {
    const loadRes = await loadAnimeMapping();
    assert.equal(loadRes.isLoaded, true);
    assert.ok(loadRes.count > 0, "Doit avoir indexé les animés");

    // 1. Lookup instantané par Kitsu ID
    const aotS1 = getAnimeMappingByKitsu(7442);
    assert.ok(aotS1, "Doit trouver Attack on Titan S1 par kitsu_id 7442");
    assert.equal(aotS1.imdbId, "tt2560140");
    assert.equal(aotS1.season, 1);
    assert.equal(aotS1.tvdbId, 267440);
    assert.equal(aotS1.tmdbId, 1429);

    const aotS2 = getAnimeMappingByKitsu("kitsu:8671:1");
    assert.ok(aotS2, "Doit trouver Attack on Titan S2 par kitsu_id 8671");
    assert.equal(aotS2.imdbId, "tt2560140");
    assert.equal(aotS2.season, 2);

    // 2. Lookup instantané par IMDb ID
    const aotImdbList = getAnimeMappingByImdb("tt2560140");
    assert.ok(Array.isArray(aotImdbList));
    assert.ok(aotImdbList.length >= 4, "AOT doit avoir plusieurs saisons");

    // 3. Lookup par IMDb ID et saison spécifique
    const s2ByImdb = getAnimeMappingByImdbAndSeason("tt2560140", 2);
    assert.ok(s2ByImdb);
    assert.equal(s2ByImdb.kitsuId, 8671);
    assert.equal(s2ByImdb.season, 2);

    // 4. Lookup par TVDB ID
    const byTvdb = getAnimeMappingByTvdb(267440);
    assert.ok(byTvdb.length > 0);

    // 5. Lookup par TMDB ID
    const byTmdb = getAnimeMappingByTmdb(1429, "tv");
    assert.ok(byTmdb.length > 0);
});

test("AnimeMapping - Sanitization stricte des identifiants (protection injection & DoS)", () => {
    // Valid IMDb IDs
    assert.equal(sanitizeImdbId("tt2560140"), "tt2560140");
    assert.equal(sanitizeImdbId("tt2560140:1:5"), "tt2560140");

    // Injections SQL et chaînes malveillantes
    assert.equal(sanitizeImdbId("tt12345' OR '1'='1"), null);
    assert.equal(sanitizeImdbId("DROP TABLE users;"), null);
    assert.equal(sanitizeImdbId("<script>alert(1)</script>"), null);
    assert.equal(sanitizeImdbId(""), null);
    assert.equal(sanitizeImdbId(null), null);

    // Valid Kitsu IDs
    assert.equal(sanitizeKitsuId(7442), 7442);
    assert.equal(sanitizeKitsuId("7442"), 7442);
    assert.equal(sanitizeKitsuId("kitsu:7442:25"), 7442);

    // Injections Kitsu
    assert.equal(sanitizeKitsuId("../../etc/passwd"), null);
    assert.equal(sanitizeKitsuId("abc"), null);
    assert.equal(sanitizeKitsuId(-5), null);
});

test("AnimeMapping - Cache LRU et gestion d'éviction", () => {
    const lru = new LruCache(3, 1000);
    lru.set("a", 1);
    lru.set("b", 2);
    lru.set("c", 3);
    assert.equal(lru.get("a"), 1);
    assert.equal(lru.get("b"), 2);
    assert.equal(lru.get("c"), 3);

    // Ajout d'un 4ème élément : 'a' a été accédé récemment, le plus ancien est 'b'
    lru.get("a"); // a rafraîchi
    lru.set("d", 4); // éviction du plus ancien (b)
    assert.equal(lru.get("b"), null);
    assert.equal(lru.get("a"), 1);
    assert.equal(lru.get("d"), 4);
});

test("Helpers - resolveKitsuMeta utilise le mapping Fribb et retourne la saison exacte", async () => {
    // Test avec Kitsu 8671 (AOT Saison 2, Épisode 3)
    const meta = await resolveKitsuMeta("kitsu:8671:3");
    assert.ok(meta);
    assert.equal(meta.imdbId, "tt2560140");
    assert.equal(meta.season, 2);
    assert.equal(meta.episode, 3);
    assert.ok(meta.name.includes("Attack on Titan") || meta.name.includes("Shingeki no Kyojin"));
    assert.ok(Array.isArray(meta.aliases));
});

test("Helpers - hasNonLatinCharacters detects Arabic, Cyrillic, CJK and preserves Latin/French", () => {
    const { hasNonLatinCharacters } = require("../lib/helpers");
    assert.ok(hasNonLatinCharacters("المهايطية"), "Arabe doit être détecté");
    assert.ok(hasNonLatinCharacters("Брат"), "Cyrillique doit être détecté");
    assert.ok(hasNonLatinCharacters("鬼滅の刃"), "CJK doit être détecté");
    assert.ok(hasNonLatinCharacters("שָׁלוֹם"), "Hébreu doit être détecté");
    assert.equal(
        hasNonLatinCharacters("Le Fabuleux Destin d'Amélie Poulain"),
        false,
        "Français avec accents reste latin"
    );
    assert.equal(hasNonLatinCharacters("Inception"), false, "Anglais reste latin");
    assert.equal(hasNonLatinCharacters("No Exit"), false, "Titre latin");
});

test("Helpers - isConfidentTitleMatch excludes Toy Story sequels and packs", () => {
    const { isConfidentTitleMatch } = require("../lib/helpers");

    // Toy Story 1 ne doit PAS matcher Toy Story 2, 3, 4
    assert.equal(isConfidentTitleMatch("Toy Story", "Toy Story 2", 1995, 1999), false);
    assert.equal(isConfidentTitleMatch("Toy Story", "Toy Story 3", 1995, 2010), false);
    assert.equal(isConfidentTitleMatch("Toy Story", "Toy Story 4", 1995, 2019), false);

    // Toy Story 1 ne doit PAS matcher les coffrets / packs / intégrales
    assert.equal(isConfidentTitleMatch("Toy Story", "Toy Story Quadrilogie", 1995, null), false);
    assert.equal(isConfidentTitleMatch("Toy Story", "Toy Story Integrale 1080p", 1995, null), false);
    assert.equal(isConfidentTitleMatch("Toy Story", "Toy Story Collection Pack", 1995, null), false);

    // En revanche Toy Story 1 doit matcher un fichier du film Toy Story 1
    assert.ok(isConfidentTitleMatch("Toy Story", "Toy Story", 1995, 1995));
    assert.ok(isConfidentTitleMatch("Toy Story", "Toy Story 1995 MULTi 1080p BluRay", 1995, 1995));
});

test("Helpers - isConfidentTitleMatch prevents Exit matching Sans issue / No Exit", () => {
    const { isConfidentTitleMatch } = require("../lib/helpers");

    // "Exit" (film coréen 2019) ne doit pas matcher "Sans issue" / "No Exit" (2022)
    assert.equal(isConfidentTitleMatch("Exit", "Sans issue", 2019, 2022), false);
    assert.equal(isConfidentTitleMatch("Exit", "No Exit", 2019, 2022), false);
    assert.equal(isConfidentTitleMatch("Exit", "Sans issue", null, null), false);

    // Mais "Exit" doit matcher son propre release
    assert.ok(isConfidentTitleMatch("Exit", "Exit", 2019, 2019));
    assert.ok(isConfidentTitleMatch("Exit", "Exit 2019 MULTi 1080p", 2019, 2019));
});

test("Catalogs - Infinite scroll pagination groups items and returns 50 per page", async () => {
    const { handleCatalog } = require("../lib/stremio");

    // Simuler un appel handleCatalog avec skip=0 et skip=50
    const config = { apiKey: "test_key", disableCatalogs: false };
    const cache = {};

    // Test sur catalogue my_ad_links ou recommendation
    const page1 = await handleCatalog(config, "movie", "my_ad_reco_movies", cache, "skip=0");
    assert.ok(page1);
    assert.ok(Array.isArray(page1.metas));
    assert.ok(page1.metas.length <= 50, "Maximum 50 éléments par page");

    const page2 = await handleCatalog(config, "movie", "my_ad_reco_movies", cache, "skip=50");
    assert.ok(page2);
    assert.ok(Array.isArray(page2.metas));
});

test("Helpers - getFrenchTitle resolves French title and caches in memory", async () => {
    const { getFrenchTitle } = require("../lib/helpers");

    // 1. tt2096673 -> "Vice-Versa" (Inside Out) ou fallback si Wikidata indisponible
    const frTitle = await getFrenchTitle("tt2096673", "Inside Out");
    assert.ok(frTitle, "Doit renvoyer un titre");
    assert.ok(
        frTitle === "Vice-Versa" || frTitle === "Inside Out",
        `Doit retourner Vice-Versa ou Inside Out (reçu: ${frTitle})`
    );

    // 2. Vérification du cache mémoire immédiat
    const cached = await getFrenchTitle("tt2096673", "Inside Out Fallback");
    assert.equal(cached, frTitle);

    // 3. Fallback si ID inconnu ou null
    const fallback = await getFrenchTitle(null, "Mon Titre Secours");
    assert.equal(fallback, "Mon Titre Secours");
});

test("Debrid Provider Both - handleStream produces both AllDebrid and Torbox streams", async () => {
    const { handleStream } = require("../lib/stremio");
    const { upsertCachedTorrent, deleteCachedTorrent } = require("../lib/db");

    const testHash = "11223344556677889900aabbccddeeff11223344";
    const testImdb = "tt9988776";

    upsertCachedTorrent({
        infoHash: testHash,
        imdbId: testImdb,
        title: "Test Movie 2024 1080p MULTI",
        filename: "Test.Movie.2024.1080p.mkv",
        size: 5000000000,
        indexer: "TestTracker",
        seeders: 25,
        isInstant: 1
    });

    const { torboxApi } = require("../lib/torbox");
    const originalTorboxGet = torboxApi.get;
    torboxApi.get = async url => {
        if (url && url.includes("/torrents/checkcached")) {
            return {
                data: {
                    success: true,
                    data: {
                        [testHash.toLowerCase()]: { name: "Test.Movie.2024.1080p.mkv", size: 5000000000 }
                    }
                }
            };
        }
        return originalTorboxGet(url);
    };

    try {
        const config = {
            apiKey: "ad_test_key_12345",
            torboxApiKey: "tb_test_key_67890",
            debridProvider: "both",
            prowlarrKey: "off"
        };

        const result = await handleStream(
            config,
            "movie",
            testImdb,
            { movies: {}, series: {} },
            "http://localhost:3000",
            "test-user-both"
        );
        assert.ok(result && Array.isArray(result.streams));

        // En mode "both", doit contenir un flux AllDebrid ET un flux Torbox pour le même torrent précaché
        const adStream = result.streams.find(s => s.name && s.name.includes("[AD"));
        const tbStream = result.streams.find(s => s.name && s.name.includes("[TB"));

        assert.ok(adStream, "Doit contenir un flux AllDebrid [AD ⚡]");
        assert.ok(tbStream, "Doit contenir un flux Torbox [TB ⚡]");
        assert.ok(adStream.url.includes(`hash_${testHash}`));
        assert.ok(tbStream.url.includes(`tb_hash_${testHash}`));
    } finally {
        torboxApi.get = originalTorboxGet;
        deleteCachedTorrent(testHash);
    }
});

test("Debrid Provider Both - handleResolve routes tb_ target to Torbox and hash_ to AllDebrid", async () => {
    const { handleResolve } = require("../lib/resolver");
    const { createUser, deleteUser } = require("../lib/db");
    const { encryptConfig } = require("../lib/crypto");

    const testUuid = "11112222-3333-4444-5555-666677778888";
    const config = {
        apiKey: "ad_mock_key_resolve",
        torboxApiKey: "tb_mock_key_resolve",
        debridProvider: "both"
    };

    createUser(testUuid, "dummyHash", encryptConfig(config), "UserBothTest", "local");

    try {
        let statusCode = null;

        // 1. Requête pour une cible Torbox (tb_hash_...)
        const reqTb = {
            params: {
                userRef: testUuid,
                imdbId: "tt1234567",
                fileRef: "tb_hash_abcdef1234567890abcdef1234567890abcdef12"
            }
        };
        const resTb = {
            status(code) {
                statusCode = code;
                return this;
            },
            json() {
                return this;
            },
            send() {
                return this;
            },
            redirect(code) {
                statusCode = code;
            }
        };

        await handleResolve(reqTb, resTb);
        assert.ok(statusCode === 404 || statusCode === 302 || statusCode === 502);

        // 2. Requête pour une cible AllDebrid (hash_...)
        const reqAd = {
            params: {
                userRef: testUuid,
                imdbId: "tt1234567",
                fileRef: "hash_abcdef1234567890abcdef1234567890abcdef12"
            }
        };
        const resAd = {
            status(code) {
                statusCode = code;
                return this;
            },
            json() {
                return this;
            },
            send() {
                return this;
            },
            redirect(code) {
                statusCode = code;
            }
        };

        await handleResolve(reqAd, resAd);
        assert.ok(statusCode === 404 || statusCode === 302 || statusCode === 502);
    } finally {
        deleteUser(testUuid);
    }
});

test("User API - Register and update accepts debridProvider 'both'", async () => {
    const { createServer } = require("http");
    const axios = require("axios");

    const app = require("../index");
    const server = createServer(app);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    let createdUuid = null;
    try {
        const username = `BothUser_${Date.now()}`;
        const regRes = await axios.post(`${base}/api/user/register`, {
            username: username,
            password: "SecurePassword123!",
            debridProvider: "both",
            apiKey: "mock_ad_key_12345",
            torboxApiKey: "mock_tb_key_67890"
        });

        assert.equal(regRes.status, 200);
        assert.equal(regRes.data.success, true);
        assert.ok(regRes.data.uuid);
        createdUuid = regRes.data.uuid;

        // Mise à jour de l'utilisateur
        const updateRes = await axios.post(`${base}/api/user/update`, {
            uuid: createdUuid,
            password: "SecurePassword123!",
            debridProvider: "both",
            apiKey: "mock_ad_key_updated",
            torboxApiKey: "mock_tb_key_updated"
        });

        assert.equal(updateRes.status, 200);
        assert.equal(updateRes.data.success, true);
    } finally {
        if (createdUuid) {
            const { deleteUser } = require("../lib/db");
            deleteUser(createdUuid);
        }
        server.close();
    }
});

test("Helpers & Cloud - formatAioStream handles Exit 8 WEB release with proper quality, MULTi flag, and no duplicates", () => {
    const { formatAioStream } = require("../lib/helpers");

    const formatted = formatAioStream({
        filename: "Exit.8.2025.MULTi.1080p.WEB.x264-SORTIEHUIT.mkv",
        sizeBytes: 2500000000,
        provider: "Mon Cloud",
        indexer: "AllDebrid Cloud",
        isInstant: true,
        cacheType: "cloud",
        debridProvider: "alldebrid"
    });

    // 1. Badge gauche
    assert.ok(formatted.name.includes("[AD ⚡ Cloud]"), "Badge [AD ⚡ Cloud] attendu");
    assert.ok(formatted.name.includes("1080p ⭐"), "Résolution 1080p ⭐ attendue");

    // 2. Qualité WEB-DL et Codec AVC
    assert.ok(formatted.title.includes("🎬 WEB-DL • AVC"), "Doit détecter WEB-DL et AVC");

    // 3. Taille et Audio
    assert.ok(formatted.title.includes("📦 2.3 GB"), "Doit afficher la taille du fichier");

    // 4. Langues et Release Group
    assert.ok(formatted.title.includes("🇫🇷 / 🌐"), "Doit afficher 🇫🇷 / 🌐 pour MULTi");
    assert.ok(formatted.title.includes("🏷️ SORTIEHUIT"), "Doit détecter le groupe SORTIEHUIT");

    // 5. Source et Statut sans doublon
    assert.ok(formatted.title.includes("☁️ Cloud personnel"), "Ligne de provenance Cloud personnel");
    assert.ok(formatted.title.includes("⚡ Lecture immédiate"), "Ligne de statut Lecture immédiate");
    assert.equal(
        formatted.title.includes("Cloud personnel\n⚡ Cloud personnel"),
        false,
        "Aucun doublon 'Cloud personnel'"
    );

    // 6. Test avec Torbox
    const formattedTb = formatAioStream({
        filename: "Exit.8.2025.MULTi.1080p.WEB.x264-SORTIEHUIT.mkv",
        provider: "Mon Cloud",
        indexer: "Torbox Cloud",
        isInstant: true,
        debridProvider: "torbox"
    });
    assert.ok(formattedTb.name.includes("[TB ⚡ Cloud]"), "Badge [TB ⚡ Cloud] attendu pour Torbox");
    assert.ok(formattedTb.title.includes("☁️ Cloud personnel"), "Source Cloud personnel");
    assert.ok(formattedTb.title.includes("⚡ Lecture immédiate"), "Statut Torbox");
});

test("Helpers & Catalogs - extractCleanTitle and parseSeasonEpisode handle parentheses, technical tags, and animes", () => {
    const { extractCleanTitle, parseSeasonEpisode, isConfidentTitleMatch } = require("../lib/helpers");

    // 1. Parenthèses techniques et tags éliminés proprement
    const t1 = extractCleanTitle("DanDaDan (TV) - 01 (1080p).mkv");
    assert.equal(t1.title, "DanDaDan");
    const se1 = parseSeasonEpisode("DanDaDan (TV) - 01 (1080p).mkv");
    assert.deepEqual(se1, { season: 1, episode: 1 });

    // 2. Année placée entre parenthèses au tout début
    const t2 = extractCleanTitle("(2024) Dune Part Two.mkv");
    assert.equal(t2.title, "Dune Part Two");
    assert.equal(t2.year, "2024");
    assert.equal(parseSeasonEpisode("(2024) Dune Part Two.mkv"), null);

    // 3. Titre bilingue ou alternatif entre parenthèses
    const t3 = extractCleanTitle("Monstres & Cie (Monsters, Inc.) (2001).mkv");
    assert.equal(t3.title, "Monstres & Cie");
    assert.equal(t3.year, "2001");
    assert.equal(t3.altTitle, "Monsters, Inc");

    // 4. Animé avec épisode absolu à 4 chiffres (One Piece)
    const t4 = extractCleanTitle("One Piece E1080 VOSTFR 1080p WEB-DL x264.mkv");
    assert.equal(t4.title, "One Piece");
    const se4 = parseSeasonEpisode("One Piece E1080 VOSTFR 1080p WEB-DL x264.mkv");
    assert.deepEqual(se4, { season: 1, episode: 1080 });

    // 5. Animé fansub standard avec tiret épisode et parenthèses
    const t5 = extractCleanTitle("[SubsPlease] Sousou no Frieren (2023) - 05 (1080p) [ABCD].mkv");
    assert.equal(t5.title, "Sousou no Frieren");
    assert.equal(t5.year, "2023");
    const se5 = parseSeasonEpisode("[SubsPlease] Sousou no Frieren (2023) - 05 (1080p) [ABCD].mkv");
    assert.deepEqual(se5, { season: 1, episode: 5 });

    // 6. Pack de saison complète
    const se6 = parseSeasonEpisode("Arcane (Season 1) [1080p].mkv");
    assert.equal(se6?.season, 1);
    assert.equal(se6?.isSeasonPack, true);

    // 7. isConfidentTitleMatch avec titre et année entre parenthèses
    assert.ok(isConfidentTitleMatch("Avatar (2009)", "Avatar", "2009", "2009"));
    assert.ok(isConfidentTitleMatch("Sousou no Frieren", "Sousou no Frieren"));
    assert.ok(isConfidentTitleMatch("Movie Title (VFF) 1080p", "Movie Title"));
});

test("Catalogs - handleCatalog accurately routes anime episodes to series and movies to movie catalog", async () => {
    const { handleCatalog } = require("../lib/stremio");

    const mockCache = { series: {}, movies: {} };
    const mockConfig = {
        apiKey: "mock_ad_key",
        tmdbKey: "default",
        enabledCatalogs: "all"
    };

    // Test avec liens mixtes : un film et des épisodes d'animés
    const mockLinks = [
        { filename: "Avatar (2009) 1080p.mkv", link: "https://alldebrid.com/dl/avatar" },
        { filename: "[SubsPlease] Sousou no Frieren - 05 (1080p).mkv", link: "https://alldebrid.com/dl/frieren05" },
        { filename: "[SubsPlease] Sousou no Frieren - 06 (1080p).mkv", link: "https://alldebrid.com/dl/frieren06" }
    ];

    const alldebrid = require("../lib/alldebrid");
    const originalAdGet = alldebrid.adGet;
    alldebrid.adGet = async endpoint => {
        if (endpoint === "/v4/user/history" || endpoint === "/v4/user/links") {
            return {
                data: {
                    status: "success",
                    data: { links: mockLinks }
                }
            };
        }
        return originalAdGet(endpoint);
    };

    const axios = require("axios");
    const originalGet = axios.get;
    try {
        axios.get = async (url, opts) => {
            if (url && typeof url === "string" && url.includes("cinemeta.strem.io/catalog/series")) {
                return {
                    data: {
                        metas: [{ id: "tt29277873", name: "Sousou no Frieren", poster: "https://poster.jpg" }]
                    }
                };
            }
            if (url && typeof url === "string" && url.includes("cinemeta.strem.io/catalog/movie")) {
                return {
                    data: {
                        metas: [{ id: "tt0499549", name: "Avatar", year: "2009", poster: "https://avatar.jpg" }]
                    }
                };
            }
            return originalGet(url, opts);
        };

        // Simulation du bug où cache.series contenait groupTitle mais pas le tableau episodes
        mockCache.series["tt2907768"] = { groupTitle: "frieren" };

        // 1. Appel du catalogue Séries
        const seriesCat = await handleCatalog(mockConfig, "series", "my_ad_history_series", mockCache);
        assert.ok(Array.isArray(seriesCat.metas));
        // Seul Frieren doit être présent dans les séries, Avatar ne doit PAS y être
        assert.ok(seriesCat.metas.some(m => m.name.toLowerCase().includes("frieren")));
        assert.ok(!seriesCat.metas.some(m => m.name.toLowerCase().includes("avatar")));

        // 2. Appel du catalogue Films
        const movieCat = await handleCatalog(mockConfig, "movie", "my_ad_history", mockCache);
        assert.ok(Array.isArray(movieCat.metas));
        // Seul Avatar doit être présent dans les films, Frieren ne doit PAS y être
        assert.ok(movieCat.metas.some(m => m.name.toLowerCase().includes("avatar")));
        assert.ok(!movieCat.metas.some(m => m.name.toLowerCase().includes("frieren")));
    } finally {
        alldebrid.adGet = originalAdGet;
        axios.get = originalGet;
    }
});

test("TMDB <-> IMDb Bridge - in-memory LRU caching eliminates redundant HTTP calls", async () => {
    const { tmdbToImdbId, imdbIdToTitleAndYear } = require("../lib/helpers");
    const axios = require("axios");
    const originalGet = axios.get;

    let httpCallCount = 0;
    try {
        axios.get = async (url, opts) => {
            httpCallCount++;
            if (url.includes("/external_ids")) {
                return { data: { imdb_id: "tt8888888" } };
            }
            if (url.includes("/find/")) {
                return {
                    data: {
                        tv_results: [
                            { name: "Fresh Test Show", original_name: "Fresh Test Show", first_air_date: "2024-01-01" }
                        ],
                        movie_results: []
                    }
                };
            }
            return originalGet(url, opts);
        };

        // 1. Premier appel TMDB -> IMDb (hit réseau)
        const id1 = await tmdbToImdbId(999999, "series", "fresh_mock_key");
        assert.equal(id1, "tt8888888");
        assert.equal(httpCallCount, 1);

        // 2. Second appel identique (doit venir du cache 0 ms, aucun hit réseau)
        const id2 = await tmdbToImdbId(999999, "series", "fresh_mock_key");
        assert.equal(id2, "tt8888888");
        assert.equal(httpCallCount, 1, "Le 2e appel tmdbToImdbId doit provenir du cache LRU");

        // 3. Premier appel IMDb -> Titre (hit réseau)
        const meta1 = await imdbIdToTitleAndYear("tt8888888", "fresh_mock_key", "series");
        assert.equal(meta1.title, "Fresh Test Show");
        assert.equal(httpCallCount, 2);

        // 4. Second appel identique (doit venir du cache 0 ms)
        const meta2 = await imdbIdToTitleAndYear("tt8888888", "fresh_mock_key", "series");
        assert.equal(meta2.title, "Fresh Test Show");
        assert.equal(httpCallCount, 2, "Le 2e appel imdbIdToTitleAndYear doit provenir du cache LRU");
    } finally {
        axios.get = originalGet;
    }
});

test("Catalogs - Infinite scroll pagination by exactly 50 items and alias support", async () => {
    const { handleCatalog } = require("../lib/stremio");

    const mockCache = { series: {}, movies: {}, classification: {} };
    const mockConfig = {
        apiKey: "mock_ad_key",
        tmdbKey: "default",
        enabledCatalogs: "all"
    };

    // 120 éléments dans le cloud magnets
    const mockMagnets = [];
    for (let i = 1; i <= 120; i++) {
        mockMagnets.push({
            id: `mag_${i}`,
            filename: `Film_${String(i).padStart(3, "0")}.2024.1080p.mkv`,
            size: 1000000000,
            statusCode: 4
        });
    }

    const alldebrid = require("../lib/alldebrid");
    const originalAdGet = alldebrid.adGet;
    alldebrid.adGet = async endpoint => {
        if (endpoint.includes("/magnet/status")) {
            return {
                data: {
                    status: "success",
                    data: { magnets: mockMagnets }
                }
            };
        }
        return originalAdGet(endpoint);
    };

    try {
        // Page 0 (skip=0) sur my_ad_magnets : exactement 50 éléments
        const p0 = await handleCatalog(mockConfig, "movie", "my_ad_magnets", mockCache, "skip=0");
        assert.equal(p0.metas.length, 50, "Page 0 doit contenir 50 films");
        assert.ok(p0.metas[0].name.includes("Film 001"));

        // Page 1 (skip=50) sur l'alias original my_ad_movies : exactement 50 éléments
        const p1 = await handleCatalog(mockConfig, "movie", "my_ad_movies", mockCache, "skip=50");
        assert.equal(p1.metas.length, 50, "Page 1 doit contenir 50 films via l'alias my_ad_movies");
        assert.ok(p1.metas[0].name.includes("Film 051"));

        // Page 2 (skip=100) via query object { skip: "100" } : 20 éléments restants
        const p2 = await handleCatalog(mockConfig, "movie", "my_ad_magnets", mockCache, { skip: "100" });
        assert.equal(p2.metas.length, 20, "Page 2 doit contenir les 20 films restants");
        assert.ok(p2.metas[0].name.includes("Film 101"));

        // Page 3 (skip=150) : 0 élément (fin du catalogue)
        const p3 = await handleCatalog(mockConfig, "movie", "my_ad_magnets", mockCache, "skip=150");
        assert.equal(p3.metas.length, 0, "Page 3 au-delà de 120 doit retourner 0 élément");
    } finally {
        alldebrid.adGet = originalAdGet;
    }
});

test("Playback - History and Links direct unlock for series and movies", async () => {
    const { handleMeta, handleStream } = require("../lib/stremio");

    const mockCache = { series: {}, movies: {} };
    const mockConfig = {
        apiKey: "mock_ad_key",
        tmdbKey: "default"
    };

    // 1. handleMeta pour un épisode d'historique (ad_link:...) de type series
    const directLink = "https://alldebrid.com/dl/dandadan.s01e05.vostfr.1080p.mkv";
    const adLinkId = `ad_link:${Buffer.from(directLink).toString("base64url")}`;

    const meta = await handleMeta(mockConfig, "series", adLinkId, mockCache);
    assert.ok(meta.meta);
    assert.equal(meta.meta.type, "series");
    assert.ok(Array.isArray(meta.meta.videos), "Les séries de liens doivent inclure la vidéo pour le bouton lecture");
    assert.equal(meta.meta.videos[0].episode, 5);

    // 2. handleStream pour ce lien direct ad_link:...
    const streams = await handleStream(mockConfig, "series", adLinkId, mockCache, "http://localhost:3000", "test-user");
    assert.ok(Array.isArray(streams.streams));
    assert.ok(streams.streams.length > 0);
    assert.ok(streams.streams[0].url.includes("resolve"), "Le lien de résolution doit être généré pour ad_link");

    // 3. handleStream pour un film tt... mémorisé dans cache.movies avec link direct
    mockCache.movies["tt9999999"] = [
        { link: "https://alldebrid.com/dl/movie_direct.mkv", filename: "Movie Direct 1080p.mkv" }
    ];
    const movieStreams = await handleStream(
        mockConfig,
        "movie",
        "tt9999999",
        mockCache,
        "http://localhost:3000",
        "test-user"
    );
    assert.ok(movieStreams.streams.some(s => s.title.includes("Movie Direct")));
});

test("AllDebrid - checkInstantMagnets is read-only and never uploads magnets to user account", async () => {
    const { checkInstantMagnets } = require("../lib/alldebrid");
    const alldebrid = require("../lib/alldebrid");

    let uploadCalled = false;
    let instantCalled = false;
    const originalPost = alldebrid.adPost;
    const originalGet = alldebrid.adGet;

    alldebrid.adPost = async (endpoint, apiKey, data) => {
        if (endpoint.includes("upload")) {
            uploadCalled = true;
        }
        return { data: { status: "error" } };
    };

    alldebrid.adGet = async (endpoint, apiKey, params) => {
        if (endpoint === "/v4/magnet/instant") {
            instantCalled = true;
            return {
                data: {
                    status: "success",
                    data: {
                        magnets: [{ hash: "1122334455667788990011223344556677889900", instant: true }]
                    }
                }
            };
        }
        return { data: { status: "error" } };
    };

    try {
        const res = await checkInstantMagnets(["1122334455667788990011223344556677889900"], "test_ad_key");
        assert.equal(
            uploadCalled,
            false,
            "checkInstantMagnets ne doit JAMAIS appeler upload (ce qui polluerait le compte)"
        );
        assert.equal(
            instantCalled,
            true,
            "checkInstantMagnets doit interroger l'endpoint en lecture seule /v4/magnet/instant"
        );
        assert.equal(res["1122334455667788990011223344556677889900"], true);
    } finally {
        alldebrid.adPost = originalPost;
        alldebrid.adGet = originalGet;
    }
});

test("Catalogs - my_ad_history_series with real SQLite loadCache never throws undefined push and persists episodes", async () => {
    const { handleCatalog } = require("../lib/stremio");
    const { loadCache } = require("../lib/db");
    const alldebrid = require("../lib/alldebrid");
    const axios = require("axios");

    const realCache = loadCache();
    const mockConfig = {
        apiKey: "test_ad_key",
        tmdbKey: "test_tmdb_key",
        debridProvider: "alldebrid"
    };

    const originalAdGet = alldebrid.adGet;
    const originalAxiosGet = axios.get;

    alldebrid.adGet = async endpoint => {
        if (endpoint === "/v4/user/history") {
            return {
                data: {
                    status: "success",
                    data: {
                        links: [
                            { filename: "Breaking.Bad.S05E14.Ozymandias.1080p.mkv", link: "https://ad.link/bb14" },
                            { filename: "Breaking.Bad.S05E15.Granite.State.1080p.mkv", link: "https://ad.link/bb15" },
                            { filename: "Sousou.no.Frieren.S01E01.1080p.mkv", link: "https://ad.link/frieren1" },
                            { filename: "Weird.Series.Without.Link.S01E02.mkv" } // link is undefined
                        ]
                    }
                }
            };
        }
        return { data: { status: "error" } };
    };

    axios.get = async (url, opts) => {
        const u = typeof url === "string" ? url : "";
        if (u.includes("cinemeta.strem.io/catalog/series")) {
            // Comparaison insensible à la casse (le titre nettoyé peut varier)
            if (/breaking/i.test(decodeURIComponent(u))) {
                return {
                    data: {
                        metas: [{ id: "tt0903747", imdb_id: "tt0903747", name: "Breaking Bad", poster: "https://poster-bb.jpg" }]
                    }
                };
            }
            return {
                data: {
                    metas: [{ id: "tt29277873", imdb_id: "tt29277873", name: "Sousou no Frieren", poster: "https://poster.jpg" }]
                }
            };
        }
        return { data: { results: [] } };
    };

    try {
        // 1. Premier chargement : découvrir l'identifiant réellement attribué à la série
        const res = await handleCatalog(mockConfig, "series", "my_ad_history_series", realCache);
        assert.ok(Array.isArray(res.metas), "metas should be an array");
        assert.ok(res.metas.length >= 2, "metas should contain episodes");

        const bbMeta = res.metas.find(m => /breaking bad/i.test(m.name || ""));
        assert.ok(bbMeta, "Breaking Bad doit figurer dans les métas du catalogue");
        const bbId = bbMeta.id;

        // 2. Entrée pré-existante SANS tableau episodes (chemin "undefined push")
        realCache.series[bbId] = { groupTitle: "breaking bad" };
        await handleCatalog(mockConfig, "series", "my_ad_history_series", realCache);

        const bbEntry = realCache.series[bbId];
        assert.ok(bbEntry, "Breaking Bad entry should exist");
        assert.ok(Array.isArray(bbEntry.episodes), "episodes should be an array");
        assert.equal(bbEntry.episodes.length, 2, "Breaking Bad should have 2 episodes in cache");

        // 3. Fetch again to verify idempotency (no duplicate episodes)
        const res2 = await handleCatalog(mockConfig, "series", "my_ad_history_series", realCache);
        assert.ok(Array.isArray(res2.metas));
        assert.equal(
            realCache.series[bbId].episodes.length,
            2,
            "Episodes must not be duplicated on repeated catalog load"
        );

        // 4. Verify persistence across fresh cache proxy reload from SQLite
        const freshCache = loadCache();
        const reloadedBb = freshCache.series[bbId];
        assert.ok(reloadedBb, "Entry should reload from SQLite");
        assert.ok(Array.isArray(reloadedBb.episodes), "Reloaded episodes should be an array");
        assert.equal(reloadedBb.episodes.length, 2, "Reloaded episodes count should match");
    } finally {
        alldebrid.adGet = originalAdGet;
        axios.get = originalAxiosGet;
    }
});

test("Catalogs - my_ad_history_series supports official data.history structure and raw array", async () => {
    const { handleCatalog } = require("../lib/stremio");
    const { loadCache } = require("../lib/db");
    const alldebrid = require("../lib/alldebrid");
    const axios = require("axios");

    const realCache = loadCache();
    const mockConfig = {
        apiKey: "test_ad_key",
        tmdbKey: "test_tmdb_key",
        debridProvider: "alldebrid"
    };

    const originalAdGet = alldebrid.adGet;
    const originalAxiosGet = axios.get;

    let historyPayloadType = "history"; // "history" or "array"

    alldebrid.adGet = async endpoint => {
        if (endpoint === "/v4/user/history") {
            if (historyPayloadType === "history") {
                return {
                    data: {
                        status: "success",
                        data: {
                            history: [
                                {
                                    name: "Severance.S01E01.Good.News.About.Hell.1080p.mkv",
                                    link: "https://ad.link/sev1"
                                },
                                { name: "Severance.S01E02.Half.Loop.1080p.mkv", link: "https://ad.link/sev2" },
                                {
                                    name: "MwQjLhkCEY5CYdjw-RJcfBmOulb3i7H7ZurPDy20eGo",
                                    link: "https://ad.link/bad_token"
                                }, // Token obfusqué
                                null, // Corrupt entry
                                { filesize: 12345 } // Entry with no filename/name
                            ]
                        }
                    }
                };
            } else {
                return {
                    data: {
                        status: "success",
                        data: [{ filename: "Severance.S01E03.In.Perpetuity.1080p.mkv", link: "https://ad.link/sev3" }]
                    }
                };
            }
        }
        return { data: { status: "error" } };
    };

    axios.get = async (url, opts) => {
        if (url && typeof url === "string" && url.includes("cinemeta.strem.io/catalog/series")) {
            return {
                data: {
                    metas: [{ id: "tt11280740", name: "Severance", poster: "https://poster-sev.jpg" }]
                }
            };
        }
        return { data: { results: [] } };
    };

    try {
        // 1. Test with data.history payload (must group episodes into 1 series card and ignore obfuscated token)
        historyPayloadType = "history";
        const res1 = await handleCatalog(mockConfig, "series", "my_ad_history_series", realCache);
        assert.ok(Array.isArray(res1.metas));
        assert.equal(res1.metas.length, 1, "Should group all Severance episodes into 1 series card");
        assert.ok(res1.metas[0].name.includes("Severance"));
        assert.equal(res1.metas[0].id, "tt11280740");
        assert.ok(!res1.metas.some(m => m.name.includes("MwQj")), "Must discard obfuscated token");

        // 2. Test with raw array payload
        historyPayloadType = "array";
        const res2 = await handleCatalog(mockConfig, "series", "my_ad_history_series", realCache);
        assert.ok(Array.isArray(res2.metas));
        assert.equal(res2.metas.length, 1, "Should group Severance into 1 series card from raw array data");

        // 3. Verify SQLite stored episodes safely
        const sevEntry = realCache.series["tt11280740"];
        assert.ok(sevEntry);
        assert.ok(Array.isArray(sevEntry.episodes));
        assert.equal(sevEntry.episodes.length, 3, "Total 3 episodes stored in cache for Severance");
    } finally {
        alldebrid.adGet = originalAdGet;
        axios.get = originalAxiosGet;
    }
});

test("Helpers - cleanUrlAndDomainPrefix universally cleans domains, trackers and URLs", () => {
    const { cleanUrlAndDomainPrefix } = require("../lib/helpers");

    // 1. URL extraction
    assert.equal(
        cleanUrlAndDomainPrefix("https://tracker.lat/files/Jujutsu.Kaisen.S01E01.mkv"),
        "Jujutsu.Kaisen.S01E01.mkv"
    );
    assert.equal(cleanUrlAndDomainPrefix("http://download.moe/dl?file=Wall-E.2008.1080p.mkv"), "Wall-E.2008.1080p.mkv");

    // 2. Bracket tracker/domain removal
    assert.equal(
        cleanUrlAndDomainPrefix("[ www.Torrent9.site ] Jujutsu.Kaisen.S01E01.mkv"),
        "Jujutsu.Kaisen.S01E01.mkv"
    );
    assert.equal(cleanUrlAndDomainPrefix("[GkTorrent.com] Mr. Robot S01E01.mkv"), "Mr. Robot S01E01.mkv");
    assert.equal(
        cleanUrlAndDomainPrefix("(zone-telechargement.com) S.W.A.T.2017.S01E01.mkv"),
        "S.W.A.T.2017.S01E01.mkv"
    );

    // 3. Domain prefixes with modern TLDs (.lat, .moe, .site, .sh, .plus, .fi, etc.)
    assert.equal(cleanUrlAndDomainPrefix("wawacity.moe - Jujutsu Kaisen S01"), "Jujutsu Kaisen S01");
    assert.equal(cleanUrlAndDomainPrefix("cpasbien.plus_Mr. Robot S01E01.mkv"), "Mr. Robot S01E01.mkv");
    assert.equal(cleanUrlAndDomainPrefix("extreme-down.lat.Wall-E.2008.mkv"), "Wall-E.2008.mkv");
    assert.equal(cleanUrlAndDomainPrefix("yggtorrent.fi: S.W.A.T.2017.mkv"), "S.W.A.T.2017.mkv");
    assert.equal(cleanUrlAndDomainPrefix("zone-telechargement.sh - Inception.2010.mkv"), "Inception.2010.mkv");

    // 4. Warez names without TLD
    assert.equal(cleanUrlAndDomainPrefix("zone-telechargement_Wall-E.2008.mkv"), "Wall-E.2008.mkv");
    assert.equal(cleanUrlAndDomainPrefix("wawacity-Mr. Robot S01E01.mkv"), "Mr. Robot S01E01.mkv");
    assert.equal(cleanUrlAndDomainPrefix("cpasbien.S.W.A.T.2017.mkv"), "S.W.A.T.2017.mkv");

    // 5. Preserves legitimate titles & non-tracker tags
    assert.equal(cleanUrlAndDomainPrefix("Mr. Robot"), "Mr. Robot");
    assert.equal(cleanUrlAndDomainPrefix("S.W.A.T."), "S.W.A.T.");
    assert.equal(cleanUrlAndDomainPrefix("Wall-E"), "Wall-E");
    assert.equal(cleanUrlAndDomainPrefix("[SR-71] Jujutsu Kaisen S01"), "[SR-71] Jujutsu Kaisen S01");

    // 6. Dot-separated titles containing common English words must NOT be truncated as domains
    assert.equal(cleanUrlAndDomainPrefix("This.Is.Us.S01E01.mkv"), "This.Is.Us.S01E01.mkv");
    assert.equal(cleanUrlAndDomainPrefix("Made.In.Abyss.S01E01.mkv"), "Made.In.Abyss.S01E01.mkv");
    assert.equal(cleanUrlAndDomainPrefix("Lost.In.Space.1998.mkv"), "Lost.In.Space.1998.mkv");
    assert.equal(cleanUrlAndDomainPrefix("Emily.In.Paris.S01E01.mkv"), "Emily.In.Paris.S01E01.mkv");
    assert.equal(cleanUrlAndDomainPrefix("Back.To.The.Future.1985.mkv"), "Back.To.The.Future.1985.mkv");
    assert.equal(cleanUrlAndDomainPrefix("Life.Is.Beautiful.1997.mkv"), "Life.Is.Beautiful.1997.mkv");
    assert.equal(cleanUrlAndDomainPrefix("Who.Is.America.S01E01.mkv"), "Who.Is.America.S01E01.mkv");

    // 7. Dot-separated tracker domains are cleaned properly
    assert.equal(cleanUrlAndDomainPrefix("torrent9.site.Inception.2010.mkv"), "Inception.2010.mkv");
    assert.equal(cleanUrlAndDomainPrefix("cpasbien.si.Inception.2010.mkv"), "Inception.2010.mkv");
});

test("Helpers - isObfuscated reliably identifies base64 tokens, hex hashes and preserves real titles", () => {
    const { isObfuscated } = require("../lib/helpers");

    // Tokens obfusqués / aléatoires (doivent être identifiés comme obfusqués)
    assert.equal(isObfuscated("MwQjLhkCEY5CYdjw-RJcfBmOulb3i7H7ZurPDy20eGo"), true);
    assert.equal(isObfuscated("a1b2c3d4e5f67890abcdef1234567890"), true); // Hex 32
    assert.equal(isObfuscated("12345678-1234-1234-1234-1234567890ab"), true); // UUID
    assert.equal(isObfuscated("4a8f9b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a.mkv"), true); // Hex avec extension
    assert.equal(isObfuscated("dGhpc2lzYXRva2Vud2l0aG91dHdvcmRzMTIzNDU2Nzg="), true); // Base64
    assert.equal(isObfuscated(""), true);
    assert.equal(isObfuscated(null), true);

    // Titres légitimes (ne doivent PAS être considérés comme obfusqués)
    assert.equal(isObfuscated("Severance.S01E01.1080p.mkv"), false);
    assert.equal(isObfuscated("Mr. Robot"), false);
    assert.equal(isObfuscated("S.W.A.T.2017.mkv"), false);
    assert.equal(isObfuscated("Breaking Bad S05E14 Ozymandias"), false);
    assert.equal(isObfuscated("[SR-71] Jujutsu Kaisen S01"), false);
    assert.equal(isObfuscated("Inception (2010) MULTi 1080p.mkv"), false);
    assert.equal(isObfuscated("This.Is.Us.S01E01.mkv"), false);
});

test("Helpers - isConfidentTitleMatch rejects movie extensions and spin-offs for bare franchise queries", () => {
    const { isConfidentTitleMatch } = require("../lib/helpers");

    // Rejets formels de sous-titres / extensions pour un titre bare
    assert.equal(isConfidentTitleMatch("Jujutsu Kaisen", "Jujutsu Kaisen: Execution"), false);
    assert.equal(isConfidentTitleMatch("Jujutsu Kaisen", "Jujutsu Kaisen : Le Film"), false);
    assert.equal(isConfidentTitleMatch("Jujutsu Kaisen", "Jujutsu Kaisen: Endgame"), false);
    assert.equal(isConfidentTitleMatch("Jujutsu Kaisen", "Jujutsu Kaisen Movie"), false);
    assert.equal(isConfidentTitleMatch("Avengers", "Avengers: Endgame"), false);

    // Matchs valides quand les deux correspondent
    assert.equal(isConfidentTitleMatch("Jujutsu Kaisen", "Jujutsu Kaisen"), true);
    assert.equal(isConfidentTitleMatch("Jujutsu Kaisen", "[SR-71] Jujutsu Kaisen 1080p"), true);
    assert.equal(isConfidentTitleMatch("Avengers Endgame", "Avengers: Endgame"), true);
    assert.equal(isConfidentTitleMatch("Dune Part Two", "Dune: Part Two"), true);
});

test("Helpers - classifyContent strictly forces type=series when season or episode markers are present", async () => {
    const { classifyContent } = require("../lib/helpers");

    // Anime avec S01 et tag [SR-71]
    const c1 = await classifyContent("mag_1", "[SR-71] Jujutsu Kaisen S01 1080p", "default");
    assert.equal(c1.type, "series");

    // Fichier avec Season 2
    const c2 = await classifyContent("mag_2", "Some Show Season 2 720p", "default");
    assert.equal(c2.type, "series");

    // Fichier avec E05
    const c3 = await classifyContent("mag_3", "Anime.Name.E05.1080p.mkv", "default");
    assert.equal(c3.type, "series");

    // Fichier avec 1x08
    const c4 = await classifyContent("mag_4", "Drama.1x08.HDTV.mkv", "default");
    assert.equal(c4.type, "series");
});

test("AllDebrid - deleteMagnet and cleanupPendingMagnets delete blocked magnets", async () => {
    const alldebrid = require("../lib/alldebrid");
    const originalPost = alldebrid.adPost;
    const originalGet = alldebrid.adGet;

    const deletedIds = [];
    alldebrid.adPost = async (endpoint, apiKey, data) => {
        if (endpoint === "/v4/magnet/delete") {
            deletedIds.push(data.id);
            return { data: { status: "success" } };
        }
        return { data: { status: "error" } };
    };

    alldebrid.adGet = async (endpoint, apiKey, params) => {
        if (endpoint === "/v4.1/magnet/status") {
            return {
                data: {
                    status: "success",
                    data: {
                        magnets: [
                            { id: 101, ready: true, statusCode: 4, filename: "Ready.Movie.mkv" },
                            { id: 102, ready: false, statusCode: 1, filename: "Stuck.Movie.mkv" },
                            { id: 103, ready: false, statusCode: 0, filename: "Processing.Series.mkv" },
                            { id: 104, ready: false, statusCode: 4, filename: "StatusCode4.mkv" },
                            { id: 105, ready: false, statusCode: "4", filename: "StatusCodeString4.mkv" }
                        ]
                    }
                }
            };
        }
        if (endpoint === "/v4/magnet/delete") {
            deletedIds.push(params.id);
            return { data: { status: "success" } };
        }
        return { data: { status: "error" } };
    };

    try {
        // 1. Test direct deleteMagnet
        const ok = await alldebrid.deleteMagnet(999, "dummy_key");
        assert.equal(ok, true);
        assert.ok(deletedIds.includes(999));

        // 2. Test cleanupPendingMagnets
        const res = await alldebrid.cleanupPendingMagnets("dummy_key");
        assert.equal(res.success, true);
        assert.equal(res.deletedCount, 2);
        assert.equal(res.totalPending, 2);
        assert.ok(deletedIds.includes(102));
        assert.ok(deletedIds.includes(103));
        assert.ok(!deletedIds.includes(101));
        assert.ok(!deletedIds.includes(104));
        assert.ok(!deletedIds.includes(105), "statusCode '4' as string must not be deleted");
    } finally {
        alldebrid.adPost = originalPost;
        alldebrid.adGet = originalGet;
    }
});

test("Catalogs & AllDebrid - Season pack expands internal video files individually and epSuffix avoids Enull", async () => {
    const { handleCatalog } = require("../lib/stremio");
    const alldebrid = require("../lib/alldebrid");
    const originalAdGet = alldebrid.adGet;
    const originalGetMagnetFiles = alldebrid.getMagnetFiles;

    const mockConfig = { apiKey: "fake_ad_key", tmdbKey: "default", debridProvider: "alldebrid" };
    const fakeCache = { series: {}, classification: {} };

    alldebrid.adGet = async endpoint => {
        if (endpoint === "/v4.1/magnet/status") {
            return {
                data: {
                    status: "success",
                    data: {
                        magnets: [
                            {
                                id: 555,
                                filename: "[SR-71] Jujutsu Kaisen S01 MULTi 1080p",
                                ready: true,
                                statusCode: 4,
                                size: 15000000000
                            }
                        ]
                    }
                }
            };
        }
        return { data: { status: "success", data: {} } };
    };

    alldebrid.getMagnetFiles = async ids => {
        return {
            555: [
                { n: "Jujutsu.Kaisen.S01E01.1080p.mkv", s: 1000000000, l: "https://ad.com/dl/e01" },
                { n: "Jujutsu.Kaisen.S01E02.1080p.mkv", s: 1000000000, l: "https://ad.com/dl/e02" },
                { n: "Jujutsu.Kaisen.S01E03.1080p.mkv", s: 1000000000, l: "https://ad.com/dl/e03" },
                { n: "readme.txt", s: 100 }
            ]
        };
    };

    try {
        const catRes = await handleCatalog(mockConfig, "series", "my_ad_animes", fakeCache);
        assert.ok(catRes && Array.isArray(catRes.metas));
        assert.equal(catRes.metas.length, 1);
        assert.ok(catRes.metas[0].name.includes("Jujutsu Kaisen"));

        // Verify episodes expanded in cache
        const sKeys = Object.keys(fakeCache.series);
        assert.ok(sKeys.length > 0);
        const sEntry = fakeCache.series[sKeys[0]];
        assert.ok(sEntry && Array.isArray(sEntry.episodes));
        assert.equal(sEntry.episodes.length, 3, "All 3 video episodes must be deployed individually");
        assert.equal(sEntry.episodes[0].episode, 1);
        assert.equal(sEntry.episodes[1].episode, 2);
        assert.equal(sEntry.episodes[2].episode, 3);
    } finally {
        alldebrid.adGet = originalAdGet;
        alldebrid.getMagnetFiles = originalGetMagnetFiles;
    }
});

test("API Routes - POST /api/user/cleanup-magnets and POST /api/admin/cleanup-magnets", async () => {
    const app = require("../index");
    const alldebrid = require("../lib/alldebrid");
    const axios = require("axios");
    const originalCleanup = alldebrid.cleanupPendingMagnets;

    let cleanupCalledWithKey = null;
    alldebrid.cleanupPendingMagnets = async key => {
        cleanupCalledWithKey = key;
        return { success: true, deletedCount: 3, message: "3 magnets purgés" };
    };

    const server = app.listen(0);
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    let testUuid = null;
    const testPassword = "testPassword123";

    try {
        const regRes = await axios.post(`${base}/api/user/register`, {
            password: testPassword,
            pseudo: "CleanupUser",
            apiKey: "test_ad_key_1234"
        });
        assert.equal(regRes.status, 200);
        testUuid = regRes.data.uuid;

        // 1. User cleanup - invalid auth
        try {
            await axios.post(`${base}/api/user/cleanup-magnets`, { uuid: testUuid, password: "wrong" });
            assert.fail("Must fail on wrong password");
        } catch (e) {
            assert.equal(e.response.status, 401);
        }

        // 2. User cleanup - valid auth
        const userRes = await axios.post(`${base}/api/user/cleanup-magnets`, {
            uuid: testUuid,
            password: testPassword
        });
        assert.equal(userRes.status, 200);
        assert.equal(userRes.data.success, true);
        assert.equal(userRes.data.deletedCount, 3);
        assert.equal(cleanupCalledWithKey, "test_ad_key_1234");

        // 3. Admin cleanup - without token
        try {
            await axios.post(`${base}/api/admin/cleanup-magnets`, {});
            assert.fail("Must fail without admin token");
        } catch (e) {
            assert.equal(e.response.status, 401);
        }

        // 4. Admin login & cleanup
        const loginRes = await axios.post(`${base}/api/admin/login`, {
            password: process.env.ADMIN_PASSWORD || "admin123"
        });
        const adminToken = loginRes.data.token;
        const adminRes = await axios.post(
            `${base}/api/admin/cleanup-magnets`,
            { apiKey: "admin_override_key" },
            {
                headers: { "x-admin-token": adminToken }
            }
        );
        assert.equal(adminRes.status, 200);
        assert.equal(adminRes.data.success, true);
        assert.equal(cleanupCalledWithKey, "admin_override_key");
    } finally {
        if (testUuid) {
            try {
                await axios.post(`${base}/api/user/delete`, { uuid: testUuid, password: testPassword });
            } catch (_) {}
        }
        server.close();
        alldebrid.cleanupPendingMagnets = originalCleanup;
    }
});

test("Prowlarr Categories - Expanded categories cover Cardigann/Torznab standard for Movies, TV, Anime, and RSS sync", async () => {
    const {
        PROWLARR_CATEGORIES,
        formatCategoryParams,
        searchProwlarrOnDemand,
        syncProwlarrReleases
    } = require("../lib/prowlarr-worker");
    const axios = require("axios");

    // 1. Structure des catégories conformes au standard Cardigann / Torznab
    assert.ok(PROWLARR_CATEGORIES.MOVIES.includes(2000), "Doit inclure Movies 2000");
    assert.ok(PROWLARR_CATEGORIES.MOVIES.includes(2010), "Doit inclure Movies/Foreign 2010");
    assert.ok(PROWLARR_CATEGORIES.MOVIES.includes(2040), "Doit inclure Movies/HD 2040");
    assert.ok(PROWLARR_CATEGORIES.MOVIES.includes(2045), "Doit inclure Movies/UHD 2045");
    assert.ok(PROWLARR_CATEGORIES.MOVIES.includes(2080), "Doit inclure Movies/WEB-DL 2080");

    assert.ok(PROWLARR_CATEGORIES.TV.includes(5000), "Doit inclure TV 5000");
    assert.ok(PROWLARR_CATEGORIES.TV.includes(5010), "Doit inclure TV/WEB-DL 5010");
    assert.ok(PROWLARR_CATEGORIES.TV.includes(5020), "Doit inclure TV/Foreign 5020");
    assert.ok(PROWLARR_CATEGORIES.TV.includes(5040), "Doit inclure TV/HD 5040");
    assert.ok(PROWLARR_CATEGORIES.TV.includes(5045), "Doit inclure TV/UHD 5045");
    assert.ok(PROWLARR_CATEGORIES.TV.includes(5070), "Doit inclure TV/Anime 5070");
    assert.ok(PROWLARR_CATEGORIES.TV.includes(5080), "Doit inclure TV/Documentary 5080");

    assert.ok(PROWLARR_CATEGORIES.ANIME.includes(5070), "Anime doit inclure 5070");
    assert.ok(PROWLARR_CATEGORIES.ANIME.includes(100000), "Anime doit inclure 100000 Custom");

    assert.ok(
        PROWLARR_CATEGORIES.ALL_VIDEO.length >= 20,
        "Toutes les catégories vidéo doivent couvrir au moins 20 IDs"
    );

    // 2. Formatage des paramètres URL
    const formatted = formatCategoryParams([2000, 2040, 5070]);
    assert.equal(formatted, "categories=2000&categories=2040&categories=5070");

    // 3. Test des appels on-demand pour Film vs Série vs Anime
    const originalGet = axios.get;
    let lastUrl = null;
    axios.get = async url => {
        lastUrl = url;
        return { data: [] };
    };

    try {
        // 3a. Recherche Film : doit contenir 2000, 2040, 2045 (4K), 5070 (Anime)
        await searchProwlarrOnDemand({
            id: "tt1375666",
            type: "movie",
            cleanTitle: "Inception",
            prowlarrUrl: "http://mock-prowlarr:9696",
            prowlarrKey: "mock_key"
        });
        assert.ok(lastUrl.includes("categories=2000"), "Film doit interroger 2000");
        assert.ok(lastUrl.includes("categories=2045"), "Film doit interroger 2045 (4K UHD)");
        assert.ok(lastUrl.includes("categories=5070"), "Film doit interroger 5070 (pour les films d'animation)");

        // 3b. Recherche Série : doit contenir 5000, 5040, 5045 (4K), 5070 (Anime)
        await searchProwlarrOnDemand({
            id: "tt11280740:1:1",
            type: "series",
            cleanTitle: "Severance",
            season: 1,
            episode: 1,
            prowlarrUrl: "http://mock-prowlarr:9696",
            prowlarrKey: "mock_key"
        });
        assert.ok(lastUrl.includes("categories=5000"), "Série doit interroger 5000");
        assert.ok(lastUrl.includes("categories=5045"), "Série doit interroger 5045 (4K UHD)");
        assert.ok(lastUrl.includes("categories=5070"), "Série doit interroger 5070 (Anime)");

        // 3c. Recherche Anime : doit cibler les catégories d'anime (5070, 100000)
        await searchProwlarrOnDemand({
            id: "kitsu:43806",
            type: "series",
            cleanTitle: "Jujutsu Kaisen",
            season: 1,
            episode: 1,
            prowlarrUrl: "http://mock-prowlarr:9696",
            prowlarrKey: "mock_key"
        });
        assert.ok(lastUrl.includes("categories=5070"), "Anime doit interroger 5070");
        assert.ok(lastUrl.includes("categories=100000"), "Anime doit interroger 100000 Custom");

        // 3d. Synchronisation RSS Prowlarr : doit interroger ALL_VIDEO
        await syncProwlarrReleases("http://mock-prowlarr:9696", "mock_key");
        assert.ok(lastUrl.includes("categories=2045"), "Sync RSS doit couvrir les films 4K (2045)");
        assert.ok(lastUrl.includes("categories=5045"), "Sync RSS doit couvrir les séries 4K (5045)");
        assert.ok(lastUrl.includes("categories=5070"), "Sync RSS doit couvrir les animes (5070)");
        assert.ok(lastUrl.includes("categories=5080"), "Sync RSS doit couvrir les documentaires (5080)");
    } finally {
        axios.get = originalGet;
    }
});

test("Lioness, Long Titles, Anime Romaji, and Prowlarr Hash Extraction", async () => {
    const { isConfidentTitleMatch, extractCleanTitle, hasNonLatinCharacters } = require("../lib/helpers");
    const { extractReleaseHash, base32ToHex } = require("../lib/prowlarr-worker");
    const { handleCatalog } = require("../lib/stremio");

    // 1. Lioness vs Indian Special OPS mapping
    assert.strictEqual(
        isConfidentTitleMatch("Special Ops Lioness", "Lioness"),
        true,
        "Special Ops Lioness doit matcher Lioness"
    );
    assert.strictEqual(
        isConfidentTitleMatch("Special Ops Lioness", "Special OPS"),
        false,
        "Special Ops Lioness ne doit JAMAIS matcher Special OPS seul"
    );
    assert.strictEqual(
        isConfidentTitleMatch("Lionnes", "Special Ops Lioness"),
        true,
        "Recherche 'Lionnes' doit matcher 'Special Ops Lioness'"
    );
    assert.strictEqual(isConfidentTitleMatch("Lionnes", "Lioness"), true, "Recherche 'Lionnes' doit matcher 'Lioness'");
    assert.strictEqual(
        isConfidentTitleMatch("Lionnes", "Operations Speciales"),
        false,
        "Recherche 'Lionnes' ne doit pas matcher 'Operations Speciales' seul"
    );
    assert.strictEqual(
        isConfidentTitleMatch("Special Ops Lioness", "Opérations Spéciales : Lioness"),
        true,
        "Titre US doit matcher titre FR"
    );

    // 2. Nettoyage et extraction de titre pour Special Ops Lioness
    const cleanLioness = extractCleanTitle("Special.Ops.Lioness.S01E01.MULTI.1080p.WEB-DL.mkv");
    assert.strictEqual(cleanLioness.title, "Special Ops Lioness");
    assert.strictEqual(cleanLioness.altTitle, "Lioness");

    const cleanOpSpec = extractCleanTitle("Operations.Speciales.Lioness.S02E03.VF.mkv");
    assert.strictEqual(cleanOpSpec.title, "Operations Speciales Lioness");
    assert.strictEqual(cleanOpSpec.altTitle, "Lioness");

    // 3. Titres à rallonge et anime
    const cleanShangri = extractCleanTitle("Shangri-La Frontier - Kusoge Hunter, Kamige ni Idoman to su S01E01.mkv");
    assert.strictEqual(cleanShangri.title, "Shangri-La Frontier");
    assert.ok(
        isConfidentTitleMatch("Shangri La Frontier Kusoge Hunter Kamige ni Idoman to su", "Shangri-La Frontier"),
        "Titre à rallonge doit matcher le titre officiel"
    );

    // 4. Détection des caractères non-latins (Devanagari, Hindi, Cyrillique, etc.)
    assert.strictEqual(
        hasNonLatinCharacters("स्पेशल ऑप्स"),
        true,
        "Devanagari hindi doit être détecté comme non-latin"
    );
    assert.strictEqual(
        hasNonLatinCharacters("Opérations Spéciales : Lioness"),
        false,
        "Français avec accents est du latin pur"
    );
    assert.strictEqual(hasNonLatinCharacters("Special Ops: Lioness"), false, "Anglais est du latin pur");

    // 5. Extraction universelle de hash Prowlarr
    // 5a. Hex 40 direct
    const relHex = { infoHash: "d3b07384d113edec49eaa6238ad5ff0012345678" };
    assert.strictEqual(extractReleaseHash(relHex), "d3b07384d113edec49eaa6238ad5ff0012345678");

    // 5b. Base32 (32 caractères)
    const b32 = "2OQWGBWRCPW6YSVKUYRYVVX7AAMPXFNE";
    const converted = base32ToHex(b32);
    assert.strictEqual(converted.length, 40);
    const relB32 = { infoHash: b32 };
    assert.strictEqual(extractReleaseHash(relB32), converted);

    // 5c. infoHash null mais présent dans magnetUrl (fréquent sur trackers FR)
    const relMagnet = {
        infoHash: null,
        magnetUrl: "magnet:?xt=urn:btih:d3b07384d113edec49eaa6238ad5ff0012345678&dn=Lioness"
    };
    assert.strictEqual(extractReleaseHash(relMagnet), "d3b07384d113edec49eaa6238ad5ff0012345678");

    // 5d. infoHash null mais présent dans downloadUrl
    const relDown = { infoHash: null, downloadUrl: "magnet:?xt=urn:btih:d3b07384d113edec49eaa6238ad5ff0012345678" };
    assert.strictEqual(extractReleaseHash(relDown), "d3b07384d113edec49eaa6238ad5ff0012345678");

    // 6. extra.search dans handleCatalog
    const mockCache = {
        series: {
            lioness: { groupTitle: "lioness", episodes: [{ season: 1, episode: 1, filename: "Lioness.S01E01.mkv" }] },
            severance: {
                groupTitle: "severance",
                episodes: [{ season: 1, episode: 1, filename: "Severance.S01E01.mkv" }]
            }
        }
    };
    const catalogFiltered = await handleCatalog(
        { apiKey: "mock" },
        "series",
        "my_ad_history_series",
        mockCache,
        "search=Lionnes"
    );
    assert.ok(catalogFiltered && Array.isArray(catalogFiltered.metas));
});

test("Docker compose volume consistency, Prowlarr on-demand stream display, and Season Pack retention", async () => {
    const fs = require("fs");
    const path = require("path");

    // 1. Vérification de la cohérence des noms de volumes dans docker-compose.yml et docker-compose.reverse-proxy.yml
    const composePath = path.join(__dirname, "..", "docker-compose.yml");
    const composeContent = fs.readFileSync(composePath, "utf8");
    assert.ok(
        composeContent.includes("cinecloud-data:\n    name: cinecloud-data"),
        "docker-compose.yml doit avoir name: cinecloud-data"
    );
    assert.ok(
        composeContent.includes("cinecloud-warp:\n    name: cinecloud-warp"),
        "docker-compose.yml doit avoir name: cinecloud-warp"
    );
    assert.ok(
        !composeContent.includes("name: nuvio-alldebrid-data"),
        "Ne doit plus contenir l'ancien nom nuvio-alldebrid-data"
    );

    const composeProxyPath = path.join(__dirname, "..", "docker-compose.reverse-proxy.yml");
    const composeProxyContent = fs.readFileSync(composeProxyPath, "utf8");
    assert.ok(
        composeProxyContent.includes("cinecloud-data:\n    name: cinecloud-data"),
        "docker-compose.reverse-proxy.yml doit avoir name: cinecloud-data"
    );
    assert.ok(
        composeProxyContent.includes("cinecloud-warp:\n    name: cinecloud-warp"),
        "docker-compose.reverse-proxy.yml doit avoir name: cinecloud-warp"
    );

    // 2. Vérification que les packs de saison (isSeasonPack / episode: null) sont bien conservés dans parseSeasonEpisode
    const { parseSeasonEpisode } = require("../lib/helpers");
    const seasonPack = parseSeasonEpisode("Lioness.S01.COMPLETE.FRENCH.1080p.WEB-DL");
    assert.ok(seasonPack, "Doit parser le pack de saison");
    assert.strictEqual(seasonPack.season, 1);
    assert.strictEqual(seasonPack.episode, null);
    assert.strictEqual(seasonPack.isSeasonPack, true);

    // 3. Vérification que handleStream affiche les torrents Prowlarr même si allowDownload=false
    const { handleStream } = require("../lib/stremio");
    const axios = require("axios");
    const originalGet = axios.get;

    axios.get = async url => {
        if (url && typeof url === "string" && url.includes("/api/v1/search")) {
            return {
                data: [
                    {
                        title: "Special.Ops.Lioness.S01E01.FRENCH.1080p.WEB.H264-FW",
                        infoHash: "aabbccddeeff00112233445566778899aabbccdd",
                        size: 2500000000,
                        indexer: "YggTorrent",
                        seeders: 15
                    },
                    {
                        title: "Special.Ops.Lioness.S01.COMPLETE.FRENCH.1080p.WEB.H264-FW",
                        infoHash: "1122334455667788990011223344556677889900",
                        size: 20000000000,
                        indexer: "Sharewood",
                        seeders: 22
                    }
                ]
            };
        }
        if (url && typeof url === "string" && url.includes("cinemeta.strem.io/meta/series")) {
            return {
                data: {
                    meta: {
                        id: "tt14755822",
                        name: "Special Ops: Lioness",
                        year: 2023
                    }
                }
            };
        }
        return { data: { streams: [] } };
    };

    try {
        const streamRes = await handleStream(
            {
                apiKey: "mock_ad_key",
                prowlarrUrl: "http://mock-prowlarr:9696",
                prowlarrKey: "mock_key",
                prowlarrMode: "direct",
                allowDownload: false // L'utilisateur n'a PAS coché allowDownload (valeur par défaut)
            },
            "series",
            "tt14755822:1:1",
            {},
            "http://localhost:3000",
            "mock-user"
        );

        assert.ok(streamRes && Array.isArray(streamRes.streams), "handleStream doit retourner un tableau de flux");
        // Les deux flux Prowlarr (épisode individuel + pack de saison) doivent être présents dans la liste !
        const prowlarrStreams = streamRes.streams.filter(s => s.name.includes("[AD") && s.title.includes("Prowlarr"));
        assert.ok(
            prowlarrStreams.length >= 1,
            `Les torrents Prowlarr doivent s'afficher dans Stremio même si allowDownload=false (obtenu: ${prowlarrStreams.length})`
        );
        assert.ok(
            prowlarrStreams.some(s => s.title.includes("YggTorrent")),
            "Doit contenir la release YggTorrent"
        );
    } finally {
        axios.get = originalGet;
    }
});

test("Stream Prioritization - Instant streams are placed at top, and Prowlarr streams display [AD 🔍] and sort by seeders", () => {
    const { formatAioStream, filterAndSortStreams } = require("../lib/helpers");

    const instantStream = formatAioStream({
        filename: "Special.Ops.Lioness.S01E01.1080p.WEB.H264-FW.mkv",
        sizeBytes: 2500000000,
        provider: "Cinécloud",
        indexer: "Prowlarr | YggTorrent",
        isInstant: true,
        cacheType: "global",
        debridProvider: "alldebrid"
    });

    const unconfirmedHighSeeders = formatAioStream({
        filename: "Special.Ops.Lioness.S01E01.FRENCH.1080p.WEB.H264-FW.mkv",
        sizeBytes: 2400000000,
        seeders: 55,
        provider: "Cinécloud",
        indexer: "Prowlarr | Sharewood",
        isInstant: false,
        cacheType: "direct",
        debridProvider: "alldebrid"
    });

    const unconfirmedLowSeeders = formatAioStream({
        filename: "Special.Ops.Lioness.S01E01.FRENCH.1080p.WEB.H264-LOW.mkv",
        sizeBytes: 2300000000,
        seeders: 3,
        provider: "Cinécloud",
        indexer: "Prowlarr | Torrent9",
        isInstant: false,
        cacheType: "direct",
        debridProvider: "alldebrid"
    });

    // Vérification des badges
    assert.ok(
        instantStream.name.includes("[AD ⚡ Cache Global]"),
        "Le flux instantané doit porter le badge [AD ⚡ Cache Global]"
    );
    assert.ok(
        unconfirmedHighSeeders.name.includes("[AD 🔍]"),
        "Le flux Prowlarr non confirmé doit porter le badge [AD 🔍]"
    );
    assert.ok(
        unconfirmedHighSeeders.title.includes("55 seeders"),
        "Le sous-titre doit mentionner le nombre de seeders"
    );
    assert.ok(
        unconfirmedHighSeeders.title.includes("Vérif. cache au clic"),
        "Le sous-titre doit indiquer la vérification au clic"
    );

    // Tri des flux : flux instantané en premier, puis tri par seeders pour les flux Prowlarr directs
    const sorted = filterAndSortStreams([unconfirmedLowSeeders, unconfirmedHighSeeders, instantStream]);

    assert.equal(sorted.length, 3);
    assert.ok(sorted[0].name.includes("⚡"), "Le premier flux doit être le flux instantané ⚡");
    assert.equal(sorted[1]._seeders, 55, "Le deuxième flux doit être celui avec le plus de seeders (55)");
    assert.equal(sorted[2]._seeders, 3, "Le troisième flux doit être celui avec le moins de seeders (3)");
});

test("AllDebrid - preValidateMagnets uploads batch, marks ready in cache, and immediately deletes unready", async () => {
    const alldebrid = require("../lib/alldebrid");
    const { preValidateMagnets, instantCacheLRU } = alldebrid;

    // Reset LRU
    if (instantCacheLRU && instantCacheLRU.clear) instantCacheLRU.clear();

    const originalPost = alldebrid.adPost;
    const originalDelete = alldebrid.deleteMagnet;

    let uploadPayload = null;
    const deletedIds = [];

    alldebrid.adPost = async (endpoint, apiKey, data) => {
        if (endpoint === "/v4/magnet/upload") {
            uploadPayload = data;
            return {
                data: {
                    status: "success",
                    data: {
                        magnets: [
                            {
                                id: 501,
                                hash: "aaaa111122223333444455556666777788889999",
                                ready: true,
                                name: "Cached Movie 1080p",
                                size: 2500000000
                            },
                            {
                                id: 502,
                                hash: "bbbb111122223333444455556666777788889999",
                                ready: false,
                                name: "Uncached Movie 1080p",
                                size: 3000000000
                            }
                        ]
                    }
                }
            };
        }
        return { data: { status: "error" } };
    };

    alldebrid.deleteMagnet = async (id, apiKey) => {
        deletedIds.push(id);
        return true;
    };

    try {
        const torrents = [
            {
                infoHash: "aaaa111122223333444455556666777788889999",
                title: "Cached Movie 1080p",
                size: 2500000000,
                seeders: 50
            },
            {
                infoHash: "bbbb111122223333444455556666777788889999",
                title: "Uncached Movie 1080p",
                size: 3000000000,
                seeders: 10
            }
        ];

        const map = await preValidateMagnets(torrents, "mock_ad_key", { maxProbes: 5, imdbId: "tt1234567" });

        assert.ok(uploadPayload, "Doit appeler /v4/magnet/upload");
        assert.equal(uploadPayload.magnets.length, 2, "Doit envoyer 2 magnets");
        assert.equal(map["aaaa111122223333444455556666777788889999"], true, "Hash 1 doit être ready (true)");
        assert.equal(map["bbbb111122223333444455556666777788889999"], false, "Hash 2 doit être non prêt (false)");
        assert.ok(deletedIds.includes(502), "Le magnet non en cache 502 doit être immédiatement supprimé");
        assert.ok(!deletedIds.includes(501), "Le magnet prêt 501 ne doit pas être supprimé");

        // Deuxième appel : doit être servi directement depuis le cache LRU sans refaire d'upload
        uploadPayload = null;
        const cachedMap = await preValidateMagnets(torrents, "mock_ad_key", { maxProbes: 5 });
        assert.equal(uploadPayload, null, "Ne doit pas refaire de requête HTTP pour les hashes déjà en cache LRU");
        assert.equal(cachedMap["aaaa111122223333444455556666777788889999"], true);
        assert.equal(cachedMap["bbbb111122223333444455556666777788889999"], false);
    } finally {
        alldebrid.adPost = originalPost;
        alldebrid.deleteMagnet = originalDelete;
    }
});

test("Stremio Streams - handleStream with active AllDebrid pre-validation displays [AD ⚡] for cached and [AD ⏳] for uncached", async () => {
    const { handleStream } = require("../lib/stremio");
    const alldebrid = require("../lib/alldebrid");
    const axios = require("axios");

    const originalPost = alldebrid.adPost;
    const originalDelete = alldebrid.deleteMagnet;
    const originalGet = axios.get;

    const { deleteCachedTorrent } = require("../lib/db");
    deleteCachedTorrent("cccc111122223333444455556666777788889999");
    deleteCachedTorrent("dddd111122223333444455556666777788889999");

    // Reset LRU
    if (alldebrid.instantCacheLRU && alldebrid.instantCacheLRU.clear) alldebrid.instantCacheLRU.clear();

    alldebrid.adPost = async (endpoint, apiKey, data) => {
        if (endpoint === "/v4/magnet/upload") {
            return {
                data: {
                    status: "success",
                    data: {
                        magnets: [
                            {
                                id: 601,
                                hash: "cccc111122223333444455556666777788889999",
                                ready: true
                            },
                            {
                                id: 602,
                                hash: "dddd111122223333444455556666777788889999",
                                ready: false
                            }
                        ]
                    }
                }
            };
        }
        return { data: { status: "error" } };
    };
    alldebrid.deleteMagnet = async () => true;

    axios.get = async url => {
        if (url && typeof url === "string" && url.includes("/api/v1/search")) {
            return {
                data: [
                    {
                        title: "Test.Movie.2024.1080p.WEB-READY",
                        infoHash: "cccc111122223333444455556666777788889999",
                        size: 2500000000,
                        indexer: "YggTorrent",
                        seeders: 45
                    },
                    {
                        title: "Test.Movie.2024.1080p.WEB-UNREADY",
                        infoHash: "dddd111122223333444455556666777788889999",
                        size: 2400000000,
                        indexer: "Sharewood",
                        seeders: 12
                    }
                ]
            };
        }
        if (url && typeof url === "string" && url.includes("cinemeta.strem.io/meta/movie")) {
            return {
                data: {
                    meta: {
                        id: "tt8888888",
                        name: "Test Movie",
                        year: 2024
                    }
                }
            };
        }
        return { data: { streams: [] } };
    };

    try {
        const res = await handleStream(
            {
                apiKey: "mock_ad_key",
                prowlarrUrl: "http://mock-prowlarr:9696",
                prowlarrKey: "mock_key",
                prowlarrMode: "direct",
                preValidateCache: true,
                allowDownload: false
            },
            "movie",
            "tt8888888",
            {},
            "http://localhost:3000",
            "mock-user"
        );

        assert.ok(res && Array.isArray(res.streams));
        const readyStream = res.streams.find(s => s.url.includes("cccc111122223333444455556666777788889999"));
        const unreadyStream = res.streams.find(s => s.url.includes("dddd111122223333444455556666777788889999"));

        assert.ok(readyStream, "Le flux ready doit être présent");
        assert.ok(readyStream.name.includes("⚡"), "Le flux ready doit porter l'éclair ⚡");
        assert.ok(
            readyStream.title.includes("Instantané") || readyStream.title.includes("Pré-cache"),
            "Le statut ready doit être instantané"
        );

        assert.ok(unreadyStream, "Le flux unready doit être présent");
        assert.ok(unreadyStream.name.includes("⏳"), "Le flux unready doit porter le sablier ⏳");
        assert.ok(
            unreadyStream.title.includes("Téléchargement (12 seeders)"),
            "Le statut unready doit indiquer Téléchargement avec seeders"
        );
    } finally {
        deleteCachedTorrent("cccc111122223333444455556666777788889999");
        deleteCachedTorrent("dddd111122223333444455556666777788889999");
        alldebrid.adPost = originalPost;
        alldebrid.deleteMagnet = originalDelete;
        axios.get = originalGet;
    }
});

test("Security - Admin Password generator avoids default and persists", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const app = require("../index");

    assert.ok(typeof app.resolveAdminPassword === "function", "resolveAdminPassword doit être exposé");
    const password = app.resolveAdminPassword();
    assert.ok(password && password.length >= 16, "Le mot de passe généré doit comporter au moins 16 caractères");
    assert.notEqual(password, "admin123", "Le mot de passe ne doit jamais être admin123");

    const passFile = path.join(__dirname, "..", "data", ".admin_password");
    if (fs.existsSync(passFile)) {
        const saved = fs.readFileSync(passFile, "utf8").trim();
        assert.equal(saved, password, "Le mot de passe sauvegardé dans .admin_password doit correspondre");
    }
});

test("Database - userCacheLRU L1 cache hit, invalidation, and Worker thread offload", async () => {
    const {
        createUser,
        getUserByUuid,
        updateUserConfig,
        deleteUser,
        userCacheLRU,
        asyncUpsertCachedTorrent,
        getCachedTorrentsByImdb,
        deleteCachedTorrent,
        asyncTouchUserActivity,
        asyncPurgeOldCachedTorrents,
        asyncOptimizeDatabase
    } = require("../lib/db");

    const testUuid = "99998888-7777-6666-5555-444433332222";
    try {
        // 1. Invalidation préalable
        userCacheLRU.delete(testUuid);
        assert.equal(userCacheLRU.has(testUuid), false);

        // 2. Création utilisateur
        createUser(testUuid, "dummyhash", "dummyconfig", "LRUTester", "local");
        assert.equal(userCacheLRU.has(testUuid), false, "L1 cache doit être invalidé à la création");

        // 3. Premier accès : peuplement du cache L1
        const u1 = getUserByUuid(testUuid);
        assert.ok(u1);
        assert.equal(u1.pseudo, "LRUTester");
        assert.equal(userCacheLRU.has(testUuid), true, "L1 cache doit contenir l'utilisateur après premier get");

        // 4. Deuxième accès : hit L1 ultra rapide sans accès DB
        const u2 = getUserByUuid(testUuid);
        assert.equal(u2.uuid, testUuid);

        // 5. Mise à jour config : invalidation L1
        updateUserConfig(testUuid, "newconfig", "LRUTesterUpdated", "shared");
        assert.equal(userCacheLRU.has(testUuid), false, "L1 cache doit être invalidé après update");

        const u3 = getUserByUuid(testUuid);
        assert.equal(u3.pseudo, "LRUTesterUpdated");
        assert.equal(userCacheLRU.has(testUuid), true);

        // 6. Test async DB Worker
        const testHash = "worker112233445566778899aabbccddeeff0011";
        await asyncUpsertCachedTorrent({
            infoHash: testHash,
            imdbId: "tt9999000",
            title: "Worker Test Movie 1080p",
            filename: "Worker.Test.Movie.1080p.mkv",
            size: 2147483648,
            indexer: "WorkerIndexer",
            seeders: 25,
            isInstant: 1
        });

        // Laisser 50ms pour que le worker thread synchronise
        await new Promise(r => setTimeout(r, 50));
        const cached = getCachedTorrentsByImdb("tt9999000");
        assert.ok(cached.some(c => (c.infoHash || c.info_hash) === testHash));
        deleteCachedTorrent(testHash);

        // 7. Test asyncTouchUserActivity, asyncPurgeOldCachedTorrents, asyncOptimizeDatabase
        await asyncTouchUserActivity(testUuid);
        const purgedCount = await asyncPurgeOldCachedTorrents(365 * 86400);
        assert.ok(typeof purgedCount === "number");
        const optResult = await asyncOptimizeDatabase();
        assert.ok(optResult && optResult.success);
    } finally {
        deleteUser(testUuid);
        userCacheLRU.delete(testUuid);
    }
});

test("Security - Strict CORS blocks unauthorized third-party origins on /api and permits Stremio routes", async () => {
    const app = require("../index");
    const axios = require("axios");

    const server = app.listen(0);
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    try {
        // 1. Stremio manifest : CORS ouvert (*)
        const resManifest = await axios.get(`${base}/test-uuid-00000000/manifest.json`, {
            headers: { Origin: "https://web.stremio.com" },
            validateStatus: () => true
        });
        assert.equal(resManifest.headers["access-control-allow-origin"], "*");

        // 2. Asset public : CORS ouvert (*)
        const resLogo = await axios.get(`${base}/logo.png`, {
            headers: { Origin: "https://some-app.com" },
            validateStatus: () => true
        });
        assert.equal(resLogo.headers["access-control-allow-origin"], "*");

        // 3. /api/* avec origine tierce non autorisée : HTTP 403 Forbidden
        const resEvilApi = await axios.get(`${base}/api/stats`, {
            headers: { Origin: "https://malicious-website.attacker.com" },
            validateStatus: () => true
        });
        assert.equal(resEvilApi.status, 403, "Une origine tierce sur /api/* doit être bloquée avec 403");
        assert.ok(resEvilApi.data.error.includes("CORS Forbidden"));

        // 4. /api/* OPTIONS preflight avec origine tierce non autorisée : HTTP 403
        const resEvilPreflight = await axios.options(`${base}/api/admin/login`, {
            headers: { Origin: "https://malicious-website.attacker.com" },
            validateStatus: () => true
        });
        assert.equal(resEvilPreflight.status, 403);

        // 5. /api/* avec localhost : autorisé
        const resLocalhostApi = await axios.get(`${base}/api/stats`, {
            headers: { Origin: `http://localhost:${port}` },
            validateStatus: () => true
        });
        assert.equal(resLocalhostApi.status, 200);
        assert.equal(resLocalhostApi.headers["access-control-allow-origin"], `http://localhost:${port}`);

        // 6. /api/* sans en-tête Origin (navigation directe, CLI, curl) : autorisé
        const resNoOrigin = await axios.get(`${base}/api/stats`, {
            validateStatus: () => true
        });
        assert.equal(resNoOrigin.status, 200);
    } finally {
        server.close();
    }
});

test("Security - Rate Limiting on /api/check endpoints (apiCheckLimiter)", async () => {
    const app = require("../index");
    const axios = require("axios");

    const server = app.listen(0);
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    try {
        // Envoi de requêtes rapides sur /api/check/alldebrid
        let rateLimited = false;
        for (let i = 0; i < 35; i++) {
            const res = await axios.post(
                `${base}/api/check/alldebrid`,
                { apiKey: "" },
                {
                    validateStatus: () => true
                }
            );
            if (res.status === 429) {
                rateLimited = true;
                assert.ok(res.data.error.includes("Trop de requêtes"));
                break;
            }
        }
        assert.ok(rateLimited, "apiCheckLimiter doit déclencher un HTTP 429 au-delà de 30 req/min");
    } finally {
        server.close();
    }
});
