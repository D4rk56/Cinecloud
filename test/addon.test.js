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

test("Stremio - handleManifest returns valid manifest with CinéCloud FR branding", () => {
    const manifest = handleManifest({ enabledCatalogs: "my_ad_magnets,my_ad_links" });
    assert.equal(manifest.name, "CinéCloud FR");
    assert.equal(manifest.id, "org.nuvio.alldebrid");
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



