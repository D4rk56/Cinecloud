"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { makeLRU } = require("./helpers");
const { isForbiddenTargetUrl } = require("./net-guard");

const CACHE_DIR = path.join(__dirname, "..", "data");
const SQLITE_FILE = path.join(CACHE_DIR, "nuvio.db");
const CACHE_FILE = path.join(CACHE_DIR, "id-cache.json");

if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Cache L1 en mémoire pour les profils utilisateurs (ultra-rapide, zéro I/O disque sur requêtes Stremio)
const userCacheLRU = makeLRU(500, 15 * 60_000);

// Gestionnaire du Worker Thread SQLite pour les opérations d'écriture et de maintenance
let dbWorker = null;
let msgIdSeq = 0;
const pendingWorkerCallbacks = new Map();

function initDbWorker() {
    if (dbWorker || process.env.NODE_ENV === "test_no_worker") return;
    try {
        const workerPath = path.join(__dirname, "db-worker.js");
        if (!fs.existsSync(workerPath)) return;
        dbWorker = new Worker(workerPath);
        dbWorker.on("message", msg => {
            if (msg && msg.id && pendingWorkerCallbacks.has(msg.id)) {
                const { resolve, reject } = pendingWorkerCallbacks.get(msg.id);
                pendingWorkerCallbacks.delete(msg.id);
                if (msg.success) resolve(msg);
                else reject(new Error(msg.error || "DB Worker error"));
            }
        });
        dbWorker.on("error", err => {
            console.warn("[DB Worker] Erreur du thread worker :", err.message);
        });
        dbWorker.on("exit", code => {
            if (code !== 0) console.warn(`[DB Worker] Arrêt du thread worker avec code ${code}`);
            dbWorker = null;
        });
        if (dbWorker.unref) dbWorker.unref();
    } catch (e) {
        console.warn("[DB Worker] Impossible d'initialiser le worker thread :", e.message);
        dbWorker = null;
    }
}

function sendToDbWorker(action, payload) {
    if (!dbWorker) initDbWorker();
    if (!dbWorker) return Promise.resolve(null);
    const id = ++msgIdSeq;
    return new Promise(resolve => {
        pendingWorkerCallbacks.set(id, { resolve });
        dbWorker.postMessage({ id, action, payload });
        const t = setTimeout(() => {
            if (pendingWorkerCallbacks.has(id)) {
                pendingWorkerCallbacks.delete(id);
                resolve(null);
            }
        }, 5000);
        if (t && typeof t.unref === "function") t.unref();
    });
}

let db = null;
let useSqlite = false;

// Déclarations des déclarations préparées
let stmtCreateUser = null;
let stmtGetUser = null;
let stmtUpdateUserConfig = null;
let stmtUpdateUserPassword = null;
let stmtDeleteUser = null;

let stmtGetMovies = null;
let stmtInsertMovie = null;
let stmtDeleteMovies = null;
let stmtDeleteSingleMovie = null;
let stmtGetNextMovieCandidate = null;

let stmtGetSeries = null;
let stmtInsertSeries = null;

let stmtGetClassification = null;
let stmtInsertClassification = null;

let stmtUpsertCachedTorrent = null;
let stmtGetCachedTorrentsByImdb = null;
let stmtDeleteCachedTorrent = null;
let stmtPurgeOldCachedTorrents = null;

let stmtUpsertSearchQuery = null;
let stmtGetTopSearches = null;
let stmtClearSearchQueries = null;

let stmtTouchUser = null;
let stmtGetAllUsers = null;
let stmtGetAllUsersNewest = null;
let stmtGetAllUsersOldest = null;
let stmtGetAllUsersAlpha = null;
let stmtGetAllUsersLastActive = null;
let stmtGetStatsUsers = null;
let stmtGetStatsTorrents = null;
let stmtGetStatsMovies = null;
let stmtGetSetting = null;
let stmtSetSetting = null;
let stmtClearCachedTorrents = null;
let stmtClearMovies = null;
let stmtClearSeries = null;

try {
    const { DatabaseSync } = require("node:sqlite");
    db = new DatabaseSync(SQLITE_FILE);

    // Pragmas de haute performance et de résilience recommandés
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA synchronous = NORMAL;");
    db.exec("PRAGMA busy_timeout = 5000;");

    // Création des tables et des index
    db.exec(`
        -- 1. Table des utilisateurs multi-comptes
        CREATE TABLE IF NOT EXISTS users (
            uuid TEXT PRIMARY KEY,
            password_hash TEXT NOT NULL,
            config_encrypted TEXT NOT NULL,
            pseudo TEXT DEFAULT '',
            last_active_at INTEGER DEFAULT (unixepoch()),
            created_at INTEGER DEFAULT (unixepoch()),
            updated_at INTEGER DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_users_uuid ON users(uuid);

        -- Table des paramètres système et runtime (Admin)
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at INTEGER DEFAULT (unixepoch())
        );

        -- 2. Table des films et liens résolus
        CREATE TABLE IF NOT EXISTS movies (
            imdb_id TEXT NOT NULL,
            alldebrid_id TEXT NOT NULL,
            filename TEXT NOT NULL,
            size INTEGER DEFAULT 0,
            created_at INTEGER DEFAULT (unixepoch()),
            PRIMARY KEY (imdb_id, alldebrid_id)
        );
        CREATE INDEX IF NOT EXISTS idx_movies_imdb ON movies(imdb_id);

        -- 3. Table des séries (association titre / groupe et épisodes)
        CREATE TABLE IF NOT EXISTS series (
            imdb_id TEXT PRIMARY KEY,
            group_title TEXT NOT NULL,
            episodes TEXT DEFAULT '[]',
            created_at INTEGER DEFAULT (unixepoch())
        );

        -- 4. Table des classifications de type TMDB (film / série / anime)
        CREATE TABLE IF NOT EXISTS classifications (
            item_id TEXT PRIMARY KEY,
            content_type TEXT NOT NULL,
            is_anime INTEGER DEFAULT 0,
            created_at INTEGER DEFAULT (unixepoch())
        );

        -- 5. Table des torrents vérifiés / mis en cache par Prowlarr et sources externes
        CREATE TABLE IF NOT EXISTS cached_torrents (
            info_hash TEXT PRIMARY KEY,
            imdb_id TEXT,
            title TEXT NOT NULL,
            filename TEXT,
            size INTEGER DEFAULT 0,
            indexer TEXT,
            seeders INTEGER DEFAULT 0,
            is_instant INTEGER DEFAULT 1,
            created_at INTEGER DEFAULT (unixepoch()),
            updated_at INTEGER DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_cached_torrents_imdb ON cached_torrents(imdb_id);
        CREATE INDEX IF NOT EXISTS idx_cached_torrents_instant ON cached_torrents(is_instant);

        -- 6. Table des recherches et popularité
        CREATE TABLE IF NOT EXISTS search_queries (
            query_key TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            type TEXT DEFAULT 'movie',
            count INTEGER DEFAULT 1,
            last_searched_at INTEGER DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_search_queries_count ON search_queries(count DESC);
    `);

    // Migrations douces si la table users ou movies existait déjà sans ces colonnes
    try {
        db.exec("ALTER TABLE users ADD COLUMN pseudo TEXT DEFAULT '';");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE users ADD COLUMN last_active_at INTEGER DEFAULT (unixepoch());");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE users ADD COLUMN prowlarr_mode TEXT DEFAULT 'local';");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE movies ADD COLUMN size INTEGER DEFAULT 0;");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE series ADD COLUMN episodes TEXT DEFAULT '[]';");
    } catch (e) {}

    // Préparation des requêtes utilisateurs
    stmtCreateUser = db.prepare(
        "INSERT INTO users (uuid, password_hash, config_encrypted, pseudo, prowlarr_mode, last_active_at) VALUES (?, ?, ?, ?, ?, unixepoch())"
    );
    stmtGetUser = db.prepare(
        "SELECT uuid, password_hash AS passwordHash, config_encrypted AS configEncrypted, pseudo, prowlarr_mode AS prowlarrMode, created_at AS createdAt, updated_at AS updatedAt, last_active_at AS lastActiveAt FROM users WHERE uuid = ?"
    );
    stmtUpdateUserConfig = db.prepare(
        "UPDATE users SET config_encrypted = ?, pseudo = COALESCE(?, pseudo), prowlarr_mode = COALESCE(?, prowlarr_mode), updated_at = unixepoch() WHERE uuid = ?"
    );
    stmtUpdateUserPassword = db.prepare("UPDATE users SET password_hash = ?, updated_at = unixepoch() WHERE uuid = ?");
    stmtDeleteUser = db.prepare("DELETE FROM users WHERE uuid = ?");
    stmtTouchUser = db.prepare("UPDATE users SET last_active_at = unixepoch() WHERE uuid = ?");
    stmtGetAllUsers = db.prepare(
        "SELECT uuid, pseudo, prowlarr_mode AS prowlarrMode, created_at AS createdAt, updated_at AS updatedAt, last_active_at AS lastActiveAt FROM users ORDER BY created_at DESC"
    );
    stmtGetAllUsersNewest = stmtGetAllUsers;
    stmtGetAllUsersOldest = db.prepare(
        "SELECT uuid, pseudo, prowlarr_mode AS prowlarrMode, created_at AS createdAt, updated_at AS updatedAt, last_active_at AS lastActiveAt FROM users ORDER BY created_at ASC"
    );
    stmtGetAllUsersAlpha = db.prepare(
        "SELECT uuid, pseudo, prowlarr_mode AS prowlarrMode, created_at AS createdAt, updated_at AS updatedAt, last_active_at AS lastActiveAt FROM users ORDER BY LOWER(COALESCE(NULLIF(pseudo, ''), uuid)) ASC"
    );
    stmtGetAllUsersLastActive = db.prepare(
        "SELECT uuid, pseudo, prowlarr_mode AS prowlarrMode, created_at AS createdAt, updated_at AS updatedAt, last_active_at AS lastActiveAt FROM users ORDER BY last_active_at DESC"
    );
    stmtGetStatsUsers = db.prepare(
        "SELECT COUNT(*) AS total, SUM(CASE WHEN last_active_at > (unixepoch() - 86400) THEN 1 ELSE 0 END) AS active24h, SUM(CASE WHEN last_active_at > (unixepoch() - 600) THEN 1 ELSE 0 END) AS active10m, SUM(CASE WHEN prowlarr_mode = 'shared' THEN 1 ELSE 0 END) AS sharedProwlarr FROM users"
    );
    stmtGetStatsTorrents = db.prepare(
        "SELECT COUNT(*) AS total, SUM(CASE WHEN is_instant = 1 THEN 1 ELSE 0 END) AS instant FROM cached_torrents"
    );
    stmtGetStatsMovies = db.prepare("SELECT COUNT(*) AS total FROM movies");
    stmtGetSetting = db.prepare("SELECT value FROM settings WHERE key = ?");
    stmtSetSetting = db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, unixepoch())");
    stmtClearCachedTorrents = db.prepare("DELETE FROM cached_torrents");
    stmtClearMovies = db.prepare("DELETE FROM movies");
    stmtClearSeries = db.prepare("DELETE FROM series");

    // Requêtes films
    stmtGetMovies = db.prepare("SELECT alldebrid_id AS alldebridId, filename, size FROM movies WHERE imdb_id = ?");
    stmtInsertMovie = db.prepare(
        "INSERT OR REPLACE INTO movies (imdb_id, alldebrid_id, filename, size) VALUES (?, ?, ?, ?)"
    );
    stmtDeleteMovies = db.prepare("DELETE FROM movies WHERE imdb_id = ?");
    stmtDeleteSingleMovie = db.prepare("DELETE FROM movies WHERE imdb_id = ? AND alldebrid_id = ?");
    stmtGetNextMovieCandidate = db.prepare(
        "SELECT alldebrid_id AS alldebridId, filename, size FROM movies WHERE imdb_id = ? AND alldebrid_id != ? LIMIT 1"
    );

    // Requêtes séries
    stmtGetSeries = db.prepare("SELECT group_title AS groupTitle, episodes FROM series WHERE imdb_id = ?");
    stmtInsertSeries = db.prepare("INSERT OR REPLACE INTO series (imdb_id, group_title, episodes) VALUES (?, ?, ?)");

    // Requêtes classifications
    stmtGetClassification = db.prepare(
        "SELECT content_type AS type, is_anime AS isAnime FROM classifications WHERE item_id = ?"
    );
    stmtInsertClassification = db.prepare(
        "INSERT OR REPLACE INTO classifications (item_id, content_type, is_anime) VALUES (?, ?, ?)"
    );

    // Requêtes torrents en cache.
    // NOTE : `is_instant` est déterminé avec la clé AllDebrid du worker (ou d'un compte partagé),
    // puis agrégé avec MAX() au niveau du cache mutualisé. Un torrent "instantané" sur un compte
    // ne l'est pas forcément sur un autre : ce flag est un indice de disponibilité partagé, pas une
    // garantie par compte. Il n'est jamais dégradé avant la purge (TTL 30 jours).
    stmtUpsertCachedTorrent = db.prepare(`
        INSERT INTO cached_torrents (info_hash, imdb_id, title, filename, size, indexer, seeders, is_instant, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
        ON CONFLICT(info_hash) DO UPDATE SET
            imdb_id = COALESCE(excluded.imdb_id, cached_torrents.imdb_id),
            title = excluded.title,
            filename = excluded.filename,
            size = excluded.size,
            indexer = excluded.indexer,
            seeders = excluded.seeders,
            is_instant = MAX(cached_torrents.is_instant, excluded.is_instant),
            updated_at = unixepoch()
    `);
    stmtGetCachedTorrentsByImdb = db.prepare(
        "SELECT info_hash AS infoHash, imdb_id AS imdbId, title, filename, size, indexer, seeders, is_instant AS isInstant FROM cached_torrents WHERE imdb_id = ? AND (is_instant = 1 OR seeders > 0) ORDER BY is_instant DESC, seeders DESC LIMIT 10"
    );
    stmtDeleteCachedTorrent = db.prepare("DELETE FROM cached_torrents WHERE info_hash = ?");
    stmtPurgeOldCachedTorrents = db.prepare("DELETE FROM cached_torrents WHERE updated_at < (unixepoch() - ?)");

    // Requêtes statistiques de recherche
    stmtUpsertSearchQuery = db.prepare(`
        INSERT INTO search_queries (query_key, title, type, count, last_searched_at)
        VALUES (?, ?, ?, 1, unixepoch())
        ON CONFLICT(query_key) DO UPDATE SET
            count = count + 1,
            title = excluded.title,
            type = excluded.type,
            last_searched_at = unixepoch()
    `);
    stmtGetTopSearches = db.prepare(`
        SELECT query_key AS id, title, type, count, last_searched_at AS lastSearchedAt
        FROM search_queries
        ORDER BY count DESC, last_searched_at DESC
        LIMIT ?
    `);
    stmtClearSearchQueries = db.prepare("DELETE FROM search_queries");

    useSqlite = true;
    console.log(`[Database] SQLite active (${SQLITE_FILE}) en mode WAL avec busy_timeout=5000.`);

    // Migration transparente si un ancien fichier id-cache.json est détecté
    if (fs.existsSync(CACHE_FILE)) {
        try {
            const raw = fs.readFileSync(CACHE_FILE, "utf8");
            const oldCache = JSON.parse(raw);
            const countCheck = db.prepare("SELECT COUNT(*) AS count FROM movies").get();
            if (countCheck && countCheck.count === 0) {
                console.log("[Database] Migration de l'ancien id-cache.json vers SQLite en cours...");
                db.exec("BEGIN TRANSACTION;");
                for (const [imdbId, versions] of Object.entries(oldCache.movies || {})) {
                    const list = Array.isArray(versions) ? versions : [versions];
                    for (const v of list) {
                        const idVal = v ? v.alldebridId || v.link : null;
                        if (v && idVal && v.filename) {
                            stmtInsertMovie.run(imdbId, String(idVal), v.filename, v.size || 0);
                        }
                    }
                }
                for (const [imdbId, s] of Object.entries(oldCache.series || {})) {
                    if (s && s.groupTitle) {
                        stmtInsertSeries.run(imdbId, s.groupTitle, JSON.stringify(s.episodes || []));
                    }
                }
                for (const [itemId, c] of Object.entries(oldCache.classification || {})) {
                    if (c && c.type) {
                        stmtInsertClassification.run(itemId, c.type, c.isAnime ? 1 : 0);
                    }
                }
                db.exec("COMMIT;");
                console.log("[Database] Migration vers SQLite terminée avec succès !");
            }
            fs.renameSync(CACHE_FILE, CACHE_FILE + ".migrated");
        } catch (migErr) {
            console.error("[Database] Erreur lors de la migration du cache JSON vers SQLite:", migErr.message);
        }
    }
} catch (e) {
    console.error("[Database] Erreur critique initialisation SQLite:", e.message);
    useSqlite = false;
}

// Proxies SQLite transparents pour conserver 100% de compatibilité avec le code de catalog/meta
function createMoviesProxy() {
    function attachMoviesPush(arr, prop) {
        if (!Array.isArray(arr) || arr._hasPushHook) return;
        const originalPush = arr.push.bind(arr);
        arr.push = function (...items) {
            for (const item of items) {
                const idVal = item ? item.alldebridId || item.link : null;
                if (item && idVal && item.filename) {
                    if (useSqlite) {
                        try {
                            stmtInsertMovie.run(prop, String(idVal), item.filename, item.size || 0);
                        } catch (e) {}
                    }
                    if (!item.alldebridId) item.alldebridId = idVal;
                    if (!item.link) item.link = idVal;
                }
            }
            return originalPush(...items);
        };
        try {
            Object.defineProperty(arr, "_hasPushHook", { value: true, configurable: true, writable: true });
        } catch (e) {}
    }

    return new Proxy(
        Object.create(null),
        {
            get(target, prop) {
                if (typeof prop !== "string" || prop === "then") return target[prop];
                if (target[prop] && Array.isArray(target[prop])) {
                    attachMoviesPush(target[prop], prop);
                    return target[prop];
                }
                if (!useSqlite) return target[prop];
                let rows = null;
                try {
                    rows = stmtGetMovies.all(prop);
                } catch (e) {}
                if (rows && rows.length > 0) {
                    const arr = rows.map(r => ({
                        alldebridId: r.alldebridId,
                        link: r.alldebridId,
                        filename: r.filename,
                        size: r.size || 0
                    }));
                    attachMoviesPush(arr, prop);
                    target[prop] = arr;
                    return arr;
                }
                return target[prop];
            },
            set(target, prop, value) {
                if (typeof prop !== "string") return true;
                if (useSqlite) {
                    try {
                        stmtDeleteMovies.run(prop);
                    } catch (e) {}
                }
                const rawList = Array.isArray(value) ? value : [];
                const arr = rawList.map(item => {
                    const idVal = item ? item.alldebridId || item.link : null;
                    return {
                        alldebridId: (item && item.alldebridId) || idVal,
                        link: (item && item.link) || idVal,
                        filename: item ? item.filename : "",
                        size: (item && item.size) || 0
                    };
                });
                attachMoviesPush(arr, prop);
                target[prop] = arr;
                if (useSqlite) {
                    for (const item of rawList) {
                        const idVal = item ? item.alldebridId || item.link : null;
                        if (item && idVal && item.filename) {
                            try {
                                stmtInsertMovie.run(prop, String(idVal), item.filename, item.size || 0);
                            } catch (e) {}
                        }
                    }
                }
                return true;
            }
        }
    );
}

function createSeriesProxy() {
    function attachSeriesPush(entry, prop) {
        if (!entry) return;
        if (!Array.isArray(entry.episodes)) entry.episodes = [];
        if (entry.episodes._hasPushHook) return;
        const originalPush = entry.episodes.push.bind(entry.episodes);
        entry.episodes.push = function (...items) {
            const res = originalPush(...items);
            if (useSqlite && entry.groupTitle) {
                try {
                    stmtInsertSeries.run(prop, entry.groupTitle, JSON.stringify(entry.episodes));
                } catch (e) {}
            }
            return res;
        };
        try {
            Object.defineProperty(entry.episodes, "_hasPushHook", { value: true, configurable: true, writable: true });
        } catch (e) {}
    }

    return new Proxy(
        Object.create(null),
        {
            get(target, prop) {
                if (typeof prop !== "string" || prop === "then") return target[prop];
                if (target[prop]) {
                    if (!Array.isArray(target[prop].episodes)) target[prop].episodes = [];
                    attachSeriesPush(target[prop], prop);
                    return target[prop];
                }
                if (!useSqlite) return target[prop];
                let row = null;
                try {
                    row = stmtGetSeries.get(prop);
                } catch (e) {}
                if (!row) return target[prop];
                let episodes = [];
                if (row.episodes) {
                    try {
                        episodes = JSON.parse(row.episodes);
                        if (!Array.isArray(episodes)) episodes = [];
                    } catch (e) {
                        episodes = [];
                    }
                }
                const entry = {
                    groupTitle: row.groupTitle || "",
                    episodes: episodes
                };
                attachSeriesPush(entry, prop);
                target[prop] = entry;
                return entry;
            },
            set(target, prop, value) {
                if (typeof prop !== "string") return true;
                const episodes = value && Array.isArray(value.episodes) ? value.episodes : [];
                const entry = {
                    groupTitle: (value && value.groupTitle) || "",
                    episodes: episodes
                };
                attachSeriesPush(entry, prop);
                target[prop] = entry;
                if (useSqlite && entry.groupTitle) {
                    try {
                        stmtInsertSeries.run(prop, entry.groupTitle, JSON.stringify(entry.episodes));
                    } catch (e) {}
                }
                return true;
            }
        }
    );
}

const sqliteClassificationsProxy = new Proxy(
    Object.create(null),
    {
        get(target, prop) {
            if (typeof prop !== "string" || prop === "then") return target[prop];
            if (target[prop]) return target[prop];
            if (!useSqlite) return target[prop];
            let row = null;
            try {
                row = stmtGetClassification.get(prop);
            } catch (e) {}
            if (!row) return undefined;
            const entry = { type: row.type, isAnime: Boolean(row.isAnime) };
            target[prop] = entry;
            return entry;
        },
        set(target, prop, value) {
            if (typeof prop !== "string") return true;
            target[prop] = value;
            if (useSqlite && value && value.type) {
                try {
                    stmtInsertClassification.run(prop, value.type, value.isAnime ? 1 : 0);
                } catch (e) {}
            }
            return true;
        }
    }
);

function loadCache() {
    return {
        movies: createMoviesProxy(),
        series: createSeriesProxy(),
        classification: sqliteClassificationsProxy
    };
}

function saveCache() {
    // Opérations atomiques immédiates en SQLite
}

// Opérations Utilisateurs
function createUser(uuid, passwordHash, configEncrypted, pseudo = "", prowlarrMode = "local") {
    if (!useSqlite) throw new Error("Base de données SQLite non disponible.");
    const cleanUuid = String(uuid).trim();
    userCacheLRU.delete(cleanUuid);
    stmtCreateUser.run(cleanUuid, passwordHash, configEncrypted, pseudo || "", prowlarrMode || "local");
    return { uuid: cleanUuid, pseudo, prowlarrMode };
}

function getUserByUuid(uuid) {
    if (!useSqlite || !uuid) return null;
    const cleanUuid = String(uuid).trim();
    if (userCacheLRU.has(cleanUuid)) {
        return userCacheLRU.get(cleanUuid);
    }
    const user = stmtGetUser.get(cleanUuid) || null;
    if (user) {
        userCacheLRU.set(cleanUuid, user);
    }
    return user;
}

function updateUserConfig(uuid, configEncrypted, pseudo = null, prowlarrMode = null) {
    if (!useSqlite) throw new Error("Base de données SQLite non disponible.");
    const cleanUuid = String(uuid).trim();
    userCacheLRU.delete(cleanUuid);
    stmtUpdateUserConfig.run(configEncrypted, pseudo, prowlarrMode, cleanUuid);
    return true;
}

function updateUserPassword(uuid, passwordHash) {
    if (!useSqlite) throw new Error("Base de données SQLite non disponible.");
    const cleanUuid = String(uuid).trim();
    userCacheLRU.delete(cleanUuid);
    stmtUpdateUserPassword.run(passwordHash, cleanUuid);
    return true;
}

function deleteUser(uuid) {
    if (!useSqlite) throw new Error("Base de données SQLite non disponible.");
    const cleanUuid = String(uuid).trim();
    userCacheLRU.delete(cleanUuid);
    stmtDeleteUser.run(cleanUuid);
    return true;
}

function touchUserActivity(uuid) {
    if (!useSqlite || !uuid || !stmtTouchUser) return;
    try {
        stmtTouchUser.run(uuid);
    } catch (e) {}
}

function unixepochNow() {
    return Math.floor(Date.now() / 1000);
}

function getUserStats() {
    if (!useSqlite) {
        return {
            totalUsers: 0,
            active24h: 0,
            active10m: 0,
            totalCachedTorrents: 0,
            instantTorrents: 0,
            totalMovies: 0,
            sharedProwlarrCount: 0
        };
    }
    const u = stmtGetStatsUsers.get() || { total: 0, active24h: 0, active10m: 0, sharedProwlarr: 0 };
    const t = stmtGetStatsTorrents.get() || { total: 0, instant: 0 };
    const m = stmtGetStatsMovies.get() || { total: 0 };

    return {
        totalUsers: u.total || 0,
        active24h: u.active24h || 0,
        active10m: u.active10m || 0,
        sharedProwlarrCount: u.sharedProwlarr || 0,
        totalCachedTorrents: t.total || 0,
        instantTorrents: t.instant || 0,
        totalMovies: m.total || 0
    };
}

function getSharedProwlarrInstances() {
    const instances = [];
    const seenUrls = new Set();
    if (process.env.PROWLARR_KEY && process.env.PROWLARR_KEY.trim() && process.env.PROWLARR_KEY !== "off") {
        const u = (process.env.PROWLARR_URL || "http://prowlarr:9696").trim().replace(/\/+$/, "");
        seenUrls.add(u);
        instances.push({
            uuid: "system",
            pseudo: "Serveur",
            url: u,
            key: process.env.PROWLARR_KEY.trim()
        });
    }
    if (!useSqlite) return instances;
    try {
        const { decryptConfig } = require("./crypto");
        const rows =
            db.prepare("SELECT uuid, config_encrypted, pseudo FROM users WHERE prowlarr_mode = 'shared'").all() || [];
        for (const r of rows) {
            try {
                const cfg = decryptConfig(r.config_encrypted);
                if (cfg && cfg.prowlarrKey && cfg.prowlarrKey !== "off" && cfg.prowlarrKey.trim()) {
                    const u = (cfg.prowlarrUrl || "http://prowlarr:9696").trim().replace(/\/+$/, "");
                    // Garde SSRF : ignorer les instances pointant vers une cible interdite
                    // (link-local / métadonnées). Les services auto-hébergés privés sont autorisés.
                    if (isForbiddenTargetUrl(u)) continue;
                    if (!seenUrls.has(u)) {
                        seenUrls.add(u);
                        instances.push({
                            uuid: r.uuid,
                            pseudo: r.pseudo || "Membre",
                            url: u,
                            key: cfg.prowlarrKey.trim()
                        });
                    }
                }
            } catch (e) {}
        }
        return instances;
    } catch (e) {
        return instances;
    }
}

function getAllUsersAdmin(sortBy = "newest") {
    if (!useSqlite) return [];
    switch (sortBy) {
        case "alpha":
            return stmtGetAllUsersAlpha ? stmtGetAllUsersAlpha.all() || [] : [];
        case "oldest":
            return stmtGetAllUsersOldest ? stmtGetAllUsersOldest.all() || [] : [];
        case "last_active":
            return stmtGetAllUsersLastActive ? stmtGetAllUsersLastActive.all() || [] : [];
        case "newest":
        default:
            return stmtGetAllUsersNewest ? stmtGetAllUsersNewest.all() || [] : [];
    }
}

function recordSearchQuery(queryKey, title, type = "movie") {
    if (!useSqlite || !stmtUpsertSearchQuery || !queryKey || !title) return;
    try {
        stmtUpsertSearchQuery.run(String(queryKey), String(title), String(type || "movie"));
    } catch (e) {
        console.error("[Database] Erreur enregistrement recherche:", e.message);
    }
}

function getTopSearches(limit = 15) {
    if (!useSqlite || !stmtGetTopSearches) return [];
    try {
        const lim = Math.max(1, Math.min(parseInt(limit, 10) || 15, 100));
        return stmtGetTopSearches.all(lim) || [];
    } catch (e) {
        return [];
    }
}

function clearSearchQueries() {
    if (!useSqlite || !stmtClearSearchQueries) return 0;
    try {
        const info = stmtClearSearchQueries.run();
        return info && info.changes !== undefined ? info.changes : 0;
    } catch (e) {
        return 0;
    }
}

function adminDeleteUser(uuid) {
    return deleteUser(uuid);
}

function getSystemSettings() {
    const defaults = {
        httpTimeoutMs: 10000,
        prowlarrTimeoutMs: 8000,
        cacheTtlDays: 30
    };
    if (!useSqlite || !stmtGetSetting) return defaults;
    try {
        const row = stmtGetSetting.get("system_config");
        if (row && row.value) {
            return { ...defaults, ...JSON.parse(row.value) };
        }
    } catch (e) {}
    return defaults;
}

function updateSystemSettings(newSettings = {}) {
    if (!useSqlite || !stmtSetSetting) return false;
    const current = getSystemSettings();
    const merged = { ...current, ...newSettings };
    stmtSetSetting.run("system_config", JSON.stringify(merged));
    return merged;
}

function clearCachedTorrents() {
    if (!useSqlite || !stmtClearCachedTorrents) return 0;
    const info = stmtClearCachedTorrents.run();
    return info && info.changes !== undefined ? info.changes : 0;
}

function clearMoviesCache() {
    if (!useSqlite) return 0;
    let changes = 0;
    if (stmtClearMovies) {
        const inf1 = stmtClearMovies.run();
        changes += inf1 && inf1.changes !== undefined ? inf1.changes : 0;
    }
    if (stmtClearSeries) {
        const inf2 = stmtClearSeries.run();
        changes += inf2 && inf2.changes !== undefined ? inf2.changes : 0;
    }
    return changes;
}

// Opérations Flux et Résolution Lazy
function getMovieVersions(imdbId) {
    if (!useSqlite || !imdbId) return [];
    return stmtGetMovies.all(imdbId) || [];
}

function deleteMovieVersion(imdbId, alldebridId) {
    if (!useSqlite) return;
    stmtDeleteSingleMovie.run(imdbId, String(alldebridId));
}

function getNextMovieCandidate(imdbId, currentAlldebridId) {
    if (!useSqlite || !imdbId) return null;
    return stmtGetNextMovieCandidate.get(imdbId, String(currentAlldebridId)) || null;
}

// Opérations Torrents en Cache (Prowlarr & Sources Externes)
function upsertCachedTorrent(item) {
    if (!useSqlite || !item || !item.infoHash) return;
    stmtUpsertCachedTorrent.run(
        item.infoHash.toLowerCase(),
        item.imdbId || null,
        item.title || "Unknown",
        item.filename || item.title || "",
        item.size || 0,
        item.indexer || "External",
        item.seeders || 0,
        item.isInstant ? 1 : 0
    );
}

function getCachedTorrentsByImdb(imdbId) {
    if (!useSqlite || !imdbId) return [];
    return stmtGetCachedTorrentsByImdb.all(imdbId) || [];
}

function deleteCachedTorrent(infoHash) {
    if (!useSqlite || !infoHash) return;
    stmtDeleteCachedTorrent.run(infoHash.toLowerCase());
}

function purgeOldCachedTorrents(ttlSeconds = 30 * 86400) {
    if (!useSqlite || !stmtPurgeOldCachedTorrents) return 0;
    try {
        const info = stmtPurgeOldCachedTorrents.run(ttlSeconds);
        const count = info && info.changes !== undefined ? info.changes : 0;
        if (count > 0) {
            console.log(
                `[Database] Purge automatique effectuée : ${count} anciens torrents supprimés du cache (TTL ${Math.round(ttlSeconds / 86400)} jours).`
            );
        }
        return count;
    } catch (e) {
        console.error("[Database] Erreur purge cached_torrents:", e.message);
        return 0;
    }
}

function optimizeDatabase() {
    if (!useSqlite || !db) return { success: false, error: "Base de données SQLite non disponible." };
    try {
        db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
        db.exec("VACUUM;");
        return { success: true };
    } catch (e) {
        console.error("[Database] Erreur lors de l'optimisation SQLite:", e.message);
        return { success: false, error: e.message };
    }
}

function checkpointDatabase() {
    if (!useSqlite || !db) return;
    try {
        db.exec("PRAGMA wal_checkpoint(PASSIVE);");
    } catch (e) {}
}

// Opérations asynchrones déportées dans le Worker Thread (Zéro blocage de l'event loop Express)
async function asyncUpsertCachedTorrent(item) {
    if (!item || !item.infoHash) return;
    try {
        const res = await sendToDbWorker("UPSERT_CACHED_TORRENT", item);
        if (res && res.success) return;
    } catch (e) {}
    try {
        upsertCachedTorrent(item);
    } catch (e) {
        console.warn("[DB] Échec upsertCachedTorrent (fallback synchrone) :", e.message);
    }
}

async function asyncTouchUserActivity(uuid) {
    if (!uuid) return;
    try {
        const res = await sendToDbWorker("TOUCH_USER", { uuid });
        if (res && res.success) return;
    } catch (e) {}
    touchUserActivity(uuid);
}

async function asyncRecordSearchQuery(queryKey, title, type = "movie") {
    if (!queryKey || !title) return;
    try {
        const res = await sendToDbWorker("RECORD_SEARCH_QUERY", { queryKey, title, type });
        if (res && res.success) return;
    } catch (e) {}
    recordSearchQuery(queryKey, title, type);
}

async function asyncPurgeOldCachedTorrents(ttlSeconds = 30 * 86400) {
    try {
        const res = await sendToDbWorker("PURGE_OLD_CACHED_TORRENTS", { ttlSeconds });
        if (res && res.success) return res.count || 0;
    } catch (e) {}
    return purgeOldCachedTorrents(ttlSeconds);
}

async function asyncOptimizeDatabase() {
    try {
        const res = await sendToDbWorker("OPTIMIZE_DATABASE");
        if (res && res.success) return { success: true };
    } catch (e) {}
    return optimizeDatabase();
}

module.exports = {
    db,
    SQLITE_FILE,
    useSqlite,
    userCacheLRU,
    loadCache,
    saveCache,
    createUser,
    getUserByUuid,
    updateUserConfig,
    updateUserPassword,
    deleteUser,
    touchUserActivity,
    asyncTouchUserActivity,
    getUserStats,
    getAllUsersAdmin,
    adminDeleteUser,
    getSystemSettings,
    updateSystemSettings,
    clearCachedTorrents,
    clearMoviesCache,
    getMovieVersions,
    deleteMovieVersion,
    getNextMovieCandidate,
    upsertCachedTorrent,
    asyncUpsertCachedTorrent,
    getCachedTorrentsByImdb,
    deleteCachedTorrent,
    purgeOldCachedTorrents,
    asyncPurgeOldCachedTorrents,
    optimizeDatabase,
    asyncOptimizeDatabase,
    checkpointDatabase,
    getSharedProwlarrInstances,
    recordSearchQuery,
    asyncRecordSearchQuery,
    getTopSearches,
    clearSearchQueries
};
