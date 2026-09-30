"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CACHE_DIR = path.join(__dirname, "..", "data");
const SQLITE_FILE = path.join(CACHE_DIR, "nuvio.db");
const CACHE_FILE = path.join(CACHE_DIR, "id-cache.json");

if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
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
            created_at INTEGER DEFAULT (unixepoch()),
            updated_at INTEGER DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_users_uuid ON users(uuid);

        -- 2. Table des films et liens résolus
        CREATE TABLE IF NOT EXISTS movies (
            imdb_id TEXT NOT NULL,
            alldebrid_id TEXT NOT NULL,
            filename TEXT NOT NULL,
            created_at INTEGER DEFAULT (unixepoch()),
            PRIMARY KEY (imdb_id, alldebrid_id)
        );
        CREATE INDEX IF NOT EXISTS idx_movies_imdb ON movies(imdb_id);

        -- 3. Table des séries (association titre / groupe)
        CREATE TABLE IF NOT EXISTS series (
            imdb_id TEXT PRIMARY KEY,
            group_title TEXT NOT NULL,
            created_at INTEGER DEFAULT (unixepoch())
        );

        -- 4. Table des classifications de type TMDB (film / série / anime)
        CREATE TABLE IF NOT EXISTS classifications (
            item_id TEXT PRIMARY KEY,
            content_type TEXT NOT NULL,
            is_anime INTEGER DEFAULT 0,
            created_at INTEGER DEFAULT (unixepoch())
        );

        -- 5. Table des torrents vérifiés / mis en cache par Prowlarr et Torrentio
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
    `);

    // Préparation des requêtes utilisateurs
    stmtCreateUser = db.prepare("INSERT INTO users (uuid, password_hash, config_encrypted) VALUES (?, ?, ?)");
    stmtGetUser = db.prepare("SELECT uuid, password_hash AS passwordHash, config_encrypted AS configEncrypted, created_at AS createdAt, updated_at AS updatedAt FROM users WHERE uuid = ?");
    stmtUpdateUserConfig = db.prepare("UPDATE users SET config_encrypted = ?, updated_at = unixepoch() WHERE uuid = ?");
    stmtUpdateUserPassword = db.prepare("UPDATE users SET password_hash = ?, updated_at = unixepoch() WHERE uuid = ?");
    stmtDeleteUser = db.prepare("DELETE FROM users WHERE uuid = ?");

    // Requêtes films
    stmtGetMovies = db.prepare("SELECT alldebrid_id AS alldebridId, filename FROM movies WHERE imdb_id = ?");
    stmtInsertMovie = db.prepare("INSERT OR REPLACE INTO movies (imdb_id, alldebrid_id, filename) VALUES (?, ?, ?)");
    stmtDeleteMovies = db.prepare("DELETE FROM movies WHERE imdb_id = ?");
    stmtDeleteSingleMovie = db.prepare("DELETE FROM movies WHERE imdb_id = ? AND alldebrid_id = ?");
    stmtGetNextMovieCandidate = db.prepare("SELECT alldebrid_id AS alldebridId, filename FROM movies WHERE imdb_id = ? AND alldebrid_id != ? LIMIT 1");

    // Requêtes séries
    stmtGetSeries = db.prepare("SELECT group_title AS groupTitle FROM series WHERE imdb_id = ?");
    stmtInsertSeries = db.prepare("INSERT OR REPLACE INTO series (imdb_id, group_title) VALUES (?, ?)");

    // Requêtes classifications
    stmtGetClassification = db.prepare("SELECT content_type AS type, is_anime AS isAnime FROM classifications WHERE item_id = ?");
    stmtInsertClassification = db.prepare("INSERT OR REPLACE INTO classifications (item_id, content_type, is_anime) VALUES (?, ?, ?)");

    // Requêtes torrents en cache
    stmtUpsertCachedTorrent = db.prepare(`
        INSERT OR REPLACE INTO cached_torrents (info_hash, imdb_id, title, filename, size, indexer, seeders, is_instant, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    `);
    stmtGetCachedTorrentsByImdb = db.prepare("SELECT info_hash AS infoHash, imdb_id AS imdbId, title, filename, size, indexer, seeders, is_instant AS isInstant FROM cached_torrents WHERE imdb_id = ? AND is_instant = 1 ORDER BY seeders DESC LIMIT 10");
    stmtDeleteCachedTorrent = db.prepare("DELETE FROM cached_torrents WHERE info_hash = ?");
    stmtPurgeOldCachedTorrents = db.prepare("DELETE FROM cached_torrents WHERE updated_at < (unixepoch() - ?)");

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
                        const idVal = v ? (v.alldebridId || v.link) : null;
                        if (v && idVal && v.filename) {
                            stmtInsertMovie.run(imdbId, String(idVal), v.filename);
                        }
                    }
                }
                for (const [imdbId, s] of Object.entries(oldCache.series || {})) {
                    if (s && s.groupTitle) {
                        stmtInsertSeries.run(imdbId, s.groupTitle);
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
    return new Proxy({}, {
        get(target, prop) {
            if (typeof prop !== "string" || prop === "then") return target[prop];
            if (target[prop] && Array.isArray(target[prop])) {
                return target[prop];
            }
            if (!useSqlite) return target[prop];
            const rows = stmtGetMovies.all(prop);
            if (rows && rows.length > 0) {
                const arr = rows.map(r => ({
                    alldebridId: r.alldebridId,
                    link: r.alldebridId,
                    filename: r.filename
                }));
                arr.push = function(...items) {
                    for (const item of items) {
                        const idVal = item ? (item.alldebridId || item.link) : null;
                        if (item && idVal && item.filename) {
                            stmtInsertMovie.run(prop, String(idVal), item.filename);
                            if (!item.alldebridId) item.alldebridId = idVal;
                            if (!item.link) item.link = idVal;
                        }
                    }
                    return Array.prototype.push.apply(this, items);
                };
                target[prop] = arr;
                return arr;
            }
            return target[prop];
        },
        set(target, prop, value) {
            if (typeof prop !== "string") return true;
            if (useSqlite) stmtDeleteMovies.run(prop);
            const rawList = Array.isArray(value) ? value : [];
            const arr = rawList.map(item => {
                const idVal = item ? (item.alldebridId || item.link) : null;
                return {
                    alldebridId: (item && item.alldebridId) || idVal,
                    link: (item && item.link) || idVal,
                    filename: item ? item.filename : ""
                };
            });
            arr.push = function(...items) {
                for (const item of items) {
                    const idVal = item ? (item.alldebridId || item.link) : null;
                    if (item && idVal && item.filename) {
                        if (useSqlite) stmtInsertMovie.run(prop, String(idVal), item.filename);
                        if (!item.alldebridId) item.alldebridId = idVal;
                        if (!item.link) item.link = idVal;
                    }
                }
                return Array.prototype.push.apply(this, items);
            };
            target[prop] = arr;
            if (useSqlite) {
                for (const item of rawList) {
                    const idVal = item ? (item.alldebridId || item.link) : null;
                    if (item && idVal && item.filename) {
                        stmtInsertMovie.run(prop, String(idVal), item.filename);
                    }
                }
            }
            return true;
        }
    });
}

const sqliteSeriesProxy = new Proxy({}, {
    get(target, prop) {
        if (typeof prop !== "string" || prop === "then") return target[prop];
        if (!useSqlite) return target[prop];
        const row = stmtGetSeries.get(prop);
        if (!row) return undefined;
        return { groupTitle: row.groupTitle };
    },
    set(target, prop, value) {
        if (typeof prop !== "string") return true;
        target[prop] = value;
        if (useSqlite && value && value.groupTitle) {
            stmtInsertSeries.run(prop, value.groupTitle);
        }
        return true;
    }
});

const sqliteClassificationsProxy = new Proxy({}, {
    get(target, prop) {
        if (typeof prop !== "string" || prop === "then") return target[prop];
        if (!useSqlite) return target[prop];
        const row = stmtGetClassification.get(prop);
        if (!row) return undefined;
        return { type: row.type, isAnime: Boolean(row.isAnime) };
    },
    set(target, prop, value) {
        if (typeof prop !== "string") return true;
        target[prop] = value;
        if (useSqlite && value && value.type) {
            stmtInsertClassification.run(prop, value.type, value.isAnime ? 1 : 0);
        }
        return true;
    }
});

function loadCache() {
    return {
        movies: createMoviesProxy(),
        series: sqliteSeriesProxy,
        classification: sqliteClassificationsProxy
    };
}

function saveCache() {
    // Opérations atomiques immédiates en SQLite
}

// Opérations Utilisateurs
function createUser(uuid, passwordHash, configEncrypted) {
    if (!useSqlite) throw new Error("Base de données SQLite non disponible.");
    stmtCreateUser.run(uuid, passwordHash, configEncrypted);
    return { uuid };
}

function getUserByUuid(uuid) {
    if (!useSqlite || !uuid) return null;
    return stmtGetUser.get(uuid) || null;
}

function updateUserConfig(uuid, configEncrypted) {
    if (!useSqlite) throw new Error("Base de données SQLite non disponible.");
    stmtUpdateUserConfig.run(configEncrypted, uuid);
    return true;
}

function updateUserPassword(uuid, passwordHash) {
    if (!useSqlite) throw new Error("Base de données SQLite non disponible.");
    stmtUpdateUserPassword.run(passwordHash, uuid);
    return true;
}

function deleteUser(uuid) {
    if (!useSqlite) throw new Error("Base de données SQLite non disponible.");
    stmtDeleteUser.run(uuid);
    return true;
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

// Opérations Torrents en Cache (Prowlarr & Torrentio)
function upsertCachedTorrent(item) {
    if (!useSqlite || !item || !item.infoHash) return;
    stmtUpsertCachedTorrent.run(
        item.infoHash.toLowerCase(),
        item.imdbId || null,
        item.title || "Unknown",
        item.filename || item.title || "",
        item.size || 0,
        item.indexer || "Torrentio",
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
        const count = (info && info.changes !== undefined) ? info.changes : 0;
        if (count > 0) {
            console.log(`[Database] Purge automatique effectuée : ${count} anciens torrents supprimés du cache (TTL ${Math.round(ttlSeconds / 86400)} jours).`);
        }
        return count;
    } catch (e) {
        console.error("[Database] Erreur purge cached_torrents:", e.message);
        return 0;
    }
}

module.exports = {
    db,
    useSqlite,
    loadCache,
    saveCache,
    createUser,
    getUserByUuid,
    updateUserConfig,
    updateUserPassword,
    deleteUser,
    getMovieVersions,
    deleteMovieVersion,
    getNextMovieCandidate,
    upsertCachedTorrent,
    getCachedTorrentsByImdb,
    deleteCachedTorrent,
    purgeOldCachedTorrents
};
