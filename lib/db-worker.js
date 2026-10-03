"use strict";

const { parentPort } = require("node:worker_threads");
const path = require("node:path");
const fs = require("node:fs");

if (!parentPort) {
    throw new Error("db-worker must be run as a Worker Thread");
}

let db = null;
let stmtUpsertCachedTorrent = null;
let stmtDeleteCachedTorrent = null;
let stmtPurgeOldCachedTorrents = null;
let stmtUpsertSearchQuery = null;
let stmtTouchUser = null;

try {
    const { DatabaseSync } = require("node:sqlite");
    const dataDir = path.join(__dirname, "..", "data");
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    const sqliteFile = path.join(dataDir, "nuvio.db");

    db = new DatabaseSync(sqliteFile);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA synchronous = NORMAL;");
    db.exec("PRAGMA busy_timeout = 5000;");

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

    stmtDeleteCachedTorrent = db.prepare("DELETE FROM cached_torrents WHERE info_hash = ?");
    stmtPurgeOldCachedTorrents = db.prepare("DELETE FROM cached_torrents WHERE updated_at < (unixepoch() - ?)");

    stmtUpsertSearchQuery = db.prepare(`
        INSERT INTO search_queries (query_key, title, type, count, last_searched_at)
        VALUES (?, ?, ?, 1, unixepoch())
        ON CONFLICT(query_key) DO UPDATE SET
            count = count + 1,
            title = excluded.title,
            type = excluded.type,
            last_searched_at = unixepoch()
    `);

    stmtTouchUser = db.prepare("UPDATE users SET last_active_at = unixepoch() WHERE uuid = ?");

    parentPort.postMessage({ type: "READY" });
} catch (err) {
    parentPort.postMessage({ type: "INIT_ERROR", error: err.message });
}

parentPort.on("message", (msg) => {
    if (!msg || !msg.id) return;
    const { id, action, payload } = msg;

    if (!db) {
        parentPort.postMessage({ id, success: false, error: "Database worker non initialisé" });
        return;
    }

    try {
        switch (action) {
            case "UPSERT_CACHED_TORRENT": {
                if (payload && payload.infoHash) {
                    stmtUpsertCachedTorrent.run(
                        payload.infoHash.toLowerCase(),
                        payload.imdbId || null,
                        payload.title || "Unknown",
                        payload.filename || payload.title || "",
                        payload.size || 0,
                        payload.indexer || "External",
                        payload.seeders || 0,
                        payload.isInstant ? 1 : 0
                    );
                }
                parentPort.postMessage({ id, success: true });
                break;
            }

            case "DELETE_CACHED_TORRENT": {
                if (payload && payload.infoHash) {
                    stmtDeleteCachedTorrent.run(payload.infoHash.toLowerCase());
                }
                parentPort.postMessage({ id, success: true });
                break;
            }

            case "TOUCH_USER": {
                if (payload && payload.uuid) {
                    stmtTouchUser.run(payload.uuid);
                }
                parentPort.postMessage({ id, success: true });
                break;
            }

            case "RECORD_SEARCH_QUERY": {
                if (payload && payload.queryKey && payload.title) {
                    stmtUpsertSearchQuery.run(
                        String(payload.queryKey),
                        String(payload.title),
                        String(payload.type || "movie")
                    );
                }
                parentPort.postMessage({ id, success: true });
                break;
            }

            case "PURGE_OLD_CACHED_TORRENTS": {
                const ttl = (payload && payload.ttlSeconds) || (30 * 86400);
                const info = stmtPurgeOldCachedTorrents.run(ttl);
                const count = (info && info.changes !== undefined) ? info.changes : 0;
                parentPort.postMessage({ id, success: true, count });
                break;
            }

            case "OPTIMIZE_DATABASE": {
                db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
                db.exec("VACUUM;");
                parentPort.postMessage({ id, success: true });
                break;
            }

            case "CHECKPOINT": {
                db.exec("PRAGMA wal_checkpoint(PASSIVE);");
                parentPort.postMessage({ id, success: true });
                break;
            }

            default:
                parentPort.postMessage({ id, success: false, error: `Action inconnue: ${action}` });
        }
    } catch (err) {
        parentPort.postMessage({ id, success: false, error: err.message });
    }
});
