"use strict";

const express = require("express");
const crypto = require("node:crypto");
const axios = require("axios");
const rateLimit = require("express-rate-limit");

const {
    initConsoleInterceptors,
    getLogs,
    clearLogs,
    runWithUser
} = require("./lib/logger");

// Interception des logs console pour le terminal en direct du panneau d'administration
initConsoleInterceptors();

const {
    loadCache,
    createUser,
    getUserByUuid,
    updateUserConfig,
    updateUserPassword,
    deleteUser,
    purgeOldCachedTorrents,
    getUserStats,
    getAllUsersAdmin,
    adminDeleteUser,
    getSystemSettings,
    updateSystemSettings,
    clearCachedTorrents,
    clearMoviesCache,
    getTopSearches,
    clearSearchQueries
} = require("./lib/db");

const { hashPassword, verifyPassword, encryptConfig, decryptConfig } = require("./lib/crypto");
const { handleManifest, handleCatalog, handleMeta, handleStream } = require("./lib/stremio");
const { handleResolve } = require("./lib/resolver");
const { startProwlarrWorker, stopProwlarrWorker } = require("./lib/prowlarr-worker");
const { ALL_CATALOGS, checkTmdbKey } = require("./lib/helpers");
const { getWarpStatus, checkAllDebridKey } = require("./lib/alldebrid");
const { LOGO_SVG, BACKGROUND_SVG, renderConfigPage, renderAdminPage } = require("./lib/ui");

function getRequestProtocol(req) {
    const forwarded = req.headers["x-forwarded-proto"];
    if (forwarded) {
        return (Array.isArray(forwarded) ? forwarded[0] : forwarded.split(",")[0]).trim();
    }
    return req.protocol || "http";
}

// En-tête navigateur par défaut pour les requêtes directes (TMDB, Cinemeta, Lumio)
axios.defaults.headers.common["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const app = express();
const cache = loadCache();

// Indique à Express de faire confiance aux reverse proxies (Cloudflare Tunnel, Nginx, Caddy, Traefik)
app.set("trust proxy", true);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuration CORS pour compatibilité Stremio / Nuvio
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "*");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    next();
});

// Limitation de débit sur les routes sensibles (Protection Force Brute) avec validation proxy assouplie
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 30, // 30 requêtes par fenêtre
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false, trustProxy: false },
    message: { error: "Trop de tentatives d'authentification. Veuillez patienter 15 minutes." }
});

// Authentification Administrateur
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const activeAdminTokens = new Set();

function requireAdmin(req, res, next) {
    const token = req.headers["x-admin-token"];
    if (!token || !activeAdminTokens.has(token)) {
        return res.status(401).json({ error: "Session administrateur non autorisée ou expirée." });
    }
    next();
}

// Récupère la configuration d'un utilisateur par son UUID
function getUserConfig(uuid) {
    if (!uuid || uuid.length !== 36) return null;
    const user = getUserByUuid(uuid);
    if (!user || !user.configEncrypted) return null;
    try {
        return decryptConfig(user.configEncrypted);
    } catch (e) {
        console.error(`[App] Échec déchiffrement config ${uuid}:`, e.message);
        return null;
    }
}

// =============================================================================
// 1. ENDPOINTS D'AUTHENTIFICATION & GESTION MULTI-UTILISATEURS
// =============================================================================

// Inscription / Création d'un nouvel Addon sécurisé
app.post("/api/user/register", authLimiter, async (req, res) => {
    try {
        const {
            password,
            pseudo,
            tmdbKey,
            cacheMode,
            langPref,
            resolutions,
            hideUnknownLanguages,
            sortBy,
            maxSizeGb,
            maxStreams,
            prowlarrUrl,
            prowlarrKey,
            prowlarrMode,
            allowDownload,
            disableCatalogs,
            enabledCatalogs
        } = req.body;

        const debridProvider = (req.body.debridProvider === "torbox") ? "torbox" : "alldebrid";
        const apiKey = req.body.apiKey ? req.body.apiKey.trim() : "";
        const torboxApiKey = req.body.torboxApiKey ? req.body.torboxApiKey.trim() : (debridProvider === "torbox" ? apiKey : "");

        if (debridProvider === "torbox") {
            if (!torboxApiKey) {
                return res.status(400).json({ error: "La clé API Torbox est requise." });
            }
        } else {
            if (!apiKey) {
                return res.status(400).json({ error: "La clé API AllDebrid est requise." });
            }
        }

        if (!password || typeof password !== "string" || password.length < 4) {
            return res.status(400).json({ error: "Un mot de passe d'au moins 4 caractères est requis pour sécuriser vos réglages." });
        }

        const uuid = crypto.randomUUID();
        const passwordHash = hashPassword(password);
        const resolvedProwlarrMode = (prowlarrMode === "shared" || prowlarrMode === "private" || prowlarrMode === "local")
            ? prowlarrMode
            : ((prowlarrKey && prowlarrKey.trim() && prowlarrKey !== "off") ? "shared" : "local");

        const configData = {
            debridProvider,
            apiKey: apiKey || "",
            torboxApiKey: torboxApiKey || "",
            pseudo: (pseudo && pseudo.trim()) || "",
            tmdbKey: (tmdbKey && tmdbKey.trim()) || "default",
            cacheMode: cacheMode === "off" ? "off" : "on",
            langPref: langPref || "multi_vff,vff,vfi,multi,vf,vostfr",
            resolutions: resolutions || "4k,1080p,720p,480p",
            hideUnknownLanguages: Boolean(hideUnknownLanguages),
            sortBy: sortBy === "size" || sortBy === "size_asc" ? sortBy : "quality",
            maxSizeGb: (maxSizeGb !== undefined && maxSizeGb !== null && maxSizeGb !== "") ? Number(maxSizeGb) : 150,
            maxStreams: Number(maxStreams) || 0,
            prowlarrUrl: (prowlarrUrl && prowlarrUrl.trim()) || "http://prowlarr:9696",
            prowlarrKey: (prowlarrKey && prowlarrKey.trim()) || "off",
            prowlarrMode: resolvedProwlarrMode,
            allowDownload: Boolean(allowDownload),
            disableCatalogs: Boolean(disableCatalogs),
            lumioUrl: (req.body.lumioUrl && req.body.lumioUrl.trim()) || "",
            enabledCatalogs: Array.isArray(enabledCatalogs) ? enabledCatalogs : (enabledCatalogs ? enabledCatalogs.split(",") : ALL_CATALOGS.map(c => c.id))
        };

        const configEncrypted = encryptConfig(configData);
        createUser(uuid, passwordHash, configEncrypted, configData.pseudo, configData.prowlarrMode);

        const protocol = getRequestProtocol(req);
        const host = req.get("host");
        const manifestUrl = `${protocol}://${host}/${uuid}/manifest.json`;
        const stremioUrl = `stremio://${host}/${uuid}/manifest.json`;

        // Réveil / redémarrage du worker Prowlarr avec les nouveaux paramètres
        stopProwlarrWorker();
        startProwlarrWorker();

        return runWithUser({ uuid, pseudo: configData.pseudo || "Utilisateur" }, () => {
            console.log(`[User] Nouveau manifest créé avec succès : UUID ${uuid}${configData.pseudo ? ` (${configData.pseudo})` : ""} [Provider: ${configData.debridProvider}, Prowlarr: ${configData.prowlarrMode}]`);
            return res.json({
                success: true,
                uuid,
                manifestUrl,
                stremioUrl
            });
        });
    } catch (err) {
        console.error("[User] Erreur lors de l'enregistrement :", err.message);
        return res.status(500).json({ error: "Erreur serveur lors de la création du manifest." });
    }
});

// Connexion / Récupération des réglages existants
app.post("/api/user/login", authLimiter, (req, res) => {
    try {
        const { uuid, password } = req.body;
        if (!uuid || !password) {
            return res.status(400).json({ error: "UUID et mot de passe requis." });
        }

        const user = getUserByUuid(uuid.trim());
        if (!user || !verifyPassword(password, user.passwordHash)) {
            return res.status(401).json({ error: "UUID ou mot de passe incorrect." });
        }

        const config = decryptConfig(user.configEncrypted);
        const protocol = getRequestProtocol(req);
        const host = req.get("host");
        const manifestUrl = `${protocol}://${host}/${user.uuid}/manifest.json`;
        const stremioUrl = `stremio://${host}/${user.uuid}/manifest.json`;

        return res.json({
            success: true,
            uuid: user.uuid,
            manifestUrl,
            stremioUrl,
            config: {
                ...config,
                debridProvider: config.debridProvider || "alldebrid",
                torboxApiKey: config.torboxApiKey || "",
                torboxApiKeyPreview: config.torboxApiKey ? `${config.torboxApiKey.slice(0, 4)}...${config.torboxApiKey.slice(-4)}` : "",
                pseudo: user.pseudo || config.pseudo || "",
                prowlarrUrl: config.prowlarrUrl || "http://prowlarr:9696",
                prowlarrKey: config.prowlarrKey || "",
                prowlarrMode: user.prowlarrMode || config.prowlarrMode || "local",
                allowDownload: Boolean(config.allowDownload),
                disableCatalogs: Boolean(config.disableCatalogs),
                lumioUrl: config.lumioUrl || "",
                maxSizeGb: config.maxSizeGb !== undefined ? config.maxSizeGb : 150,
                apiKeyPreview: config.apiKey ? `${config.apiKey.slice(0, 4)}...${config.apiKey.slice(-4)}` : ""
            }
        });
    } catch (err) {
        return res.status(500).json({ error: "Erreur lors de la vérification des identifiants." });
    }
});

// Mise à jour de la configuration existante
app.post("/api/user/update", authLimiter, (req, res) => {
    try {
        const {
            uuid,
            password,
            pseudo,
            debridProvider,
            apiKey,
            torboxApiKey,
            newPassword,
            tmdbKey,
            cacheMode,
            langPref,
            resolutions,
            hideUnknownLanguages,
            sortBy,
            maxSizeGb,
            maxStreams,
            prowlarrUrl,
            prowlarrKey,
            prowlarrMode,
            allowDownload,
            disableCatalogs,
            enabledCatalogs
        } = req.body;

        if (!uuid || !password) {
            return res.status(400).json({ error: "UUID et mot de passe requis." });
        }

        const user = getUserByUuid(uuid.trim());
        if (!user || !verifyPassword(password, user.passwordHash)) {
            return res.status(401).json({ error: "UUID ou mot de passe incorrect." });
        }

        const currentConfig = decryptConfig(user.configEncrypted);
        const resolvedProwlarrMode = (prowlarrMode === "shared" || prowlarrMode === "private" || prowlarrMode === "local")
            ? prowlarrMode
            : (currentConfig.prowlarrMode || user.prowlarrMode || "local");

        const resolvedDebridProvider = debridProvider !== undefined
            ? (debridProvider === "torbox" ? "torbox" : "alldebrid")
            : (currentConfig.debridProvider || "alldebrid");

        const updatedConfig = {
            debridProvider: resolvedDebridProvider,
            apiKey: apiKey !== undefined ? (apiKey ? apiKey.trim() : "") : (currentConfig.apiKey || ""),
            torboxApiKey: torboxApiKey !== undefined ? (torboxApiKey ? torboxApiKey.trim() : "") : (currentConfig.torboxApiKey || ""),
            pseudo: pseudo !== undefined ? pseudo.trim() : (user.pseudo || currentConfig.pseudo || ""),
            tmdbKey: tmdbKey !== undefined ? tmdbKey.trim() : currentConfig.tmdbKey,
            cacheMode: cacheMode === "off" ? "off" : (cacheMode === "on" ? "on" : currentConfig.cacheMode || "on"),
            langPref: langPref !== undefined ? langPref : currentConfig.langPref,
            resolutions: resolutions !== undefined ? resolutions : (currentConfig.resolutions || "4k,1080p,720p,480p"),
            hideUnknownLanguages: hideUnknownLanguages !== undefined ? Boolean(hideUnknownLanguages) : Boolean(currentConfig.hideUnknownLanguages),
            sortBy: sortBy !== undefined ? sortBy : (currentConfig.sortBy || "quality"),
            maxSizeGb: maxSizeGb !== undefined ? (Number(maxSizeGb) || 0) : (currentConfig.maxSizeGb !== undefined ? currentConfig.maxSizeGb : 150),
            maxStreams: maxStreams !== undefined ? (Number(maxStreams) || 0) : (currentConfig.maxStreams || 0),
            prowlarrUrl: (prowlarrUrl && prowlarrUrl.trim()) || currentConfig.prowlarrUrl || "http://prowlarr:9696",
            prowlarrKey: prowlarrKey !== undefined ? prowlarrKey.trim() : currentConfig.prowlarrKey,
            prowlarrMode: resolvedProwlarrMode,
            allowDownload: allowDownload !== undefined ? Boolean(allowDownload) : Boolean(currentConfig.allowDownload),
            disableCatalogs: disableCatalogs !== undefined ? Boolean(disableCatalogs) : Boolean(currentConfig.disableCatalogs),
            lumioUrl: req.body.lumioUrl !== undefined ? (req.body.lumioUrl ? req.body.lumioUrl.trim() : "") : (currentConfig.lumioUrl || ""),
            enabledCatalogs: Array.isArray(enabledCatalogs) ? enabledCatalogs : (enabledCatalogs ? enabledCatalogs.split(",") : currentConfig.enabledCatalogs)
        };

        updateUserConfig(uuid.trim(), encryptConfig(updatedConfig), updatedConfig.pseudo, updatedConfig.prowlarrMode);

        if (newPassword && typeof newPassword === "string" && newPassword.length >= 4) {
            updateUserPassword(uuid.trim(), hashPassword(newPassword));
        }

        // Réveil / redémarrage du worker Prowlarr avec les paramètres mis à jour
        stopProwlarrWorker();
        startProwlarrWorker();

        return runWithUser({ uuid: user.uuid, pseudo: updatedConfig.pseudo || "Utilisateur" }, () => {
            console.log(`[User] Configuration mise à jour pour l'UUID ${uuid} [Provider: ${updatedConfig.debridProvider}, Prowlarr: ${updatedConfig.prowlarrMode}]`);
            return res.json({ success: true, message: "Réglages mis à jour avec succès !" });
        });
    } catch (err) {
        return res.status(500).json({ error: "Erreur lors de la mise à jour des réglages." });
    }
});

app.post("/api/check/prowlarr", async (req, res) => {
    const { prowlarrUrl, prowlarrKey } = req.body;
    const { checkProwlarrConnectivity } = require("./lib/prowlarr-worker");
    const result = await checkProwlarrConnectivity(prowlarrUrl, prowlarrKey);
    res.json(result);
});

// Suppression de configuration / Compte utilisateur
app.post("/api/user/delete", authLimiter, (req, res) => {
    try {
        const { uuid, password } = req.body;
        if (!uuid || !password) {
            return res.status(400).json({ error: "UUID et mot de passe requis." });
        }

        const user = getUserByUuid(uuid.trim());
        if (!user || !verifyPassword(password, user.passwordHash)) {
            return res.status(401).json({ error: "UUID ou mot de passe incorrect." });
        }

        deleteUser(uuid.trim());
        console.log(`[User] Compte et configuration supprimés pour l'UUID ${uuid}`);
        return res.json({ success: true, message: "Configuration supprimée avec succès." });
    } catch (err) {
        return res.status(500).json({ error: "Erreur lors de la suppression de la configuration." });
    }
});

// =============================================================================
// 2. ENDPOINTS PUBLICS DE STATUT & VÉRIFICATION
// =============================================================================

app.get("/api/status/warp", (req, res) => {
    res.json(getWarpStatus());
});

app.post("/api/check/alldebrid", async (req, res) => {
    const { apiKey } = req.body;
    const result = await checkAllDebridKey(apiKey);
    res.json(result);
});

app.post("/api/check/torbox", async (req, res) => {
    const { apiKey } = req.body;
    const { checkTorboxKey } = require("./lib/torbox");
    const result = await checkTorboxKey(apiKey);
    res.json(result);
});

app.post("/api/check/tmdb", async (req, res) => {
    const { tmdbKey } = req.body;
    const result = await checkTmdbKey(tmdbKey);
    res.json(result);
});

app.get("/api/stats", (req, res) => {
    res.json(getUserStats());
});

// =============================================================================
// 3. ENDPOINTS DU PANNEAU D'ADMINISTRATION
// =============================================================================

app.post("/api/admin/login", authLimiter, (req, res) => {
    const { password } = req.body;
    if (password && password === ADMIN_PASSWORD) {
        const token = crypto.randomBytes(24).toString("hex");
        activeAdminTokens.add(token);
        return res.json({ success: true, token });
    }
    return res.status(401).json({ error: "Mot de passe administrateur incorrect." });
});

app.get("/api/admin/stats", requireAdmin, (req, res) => {
    const stats = getUserStats();
    const warp = getWarpStatus();
    res.json({
        ...stats,
        topSearches: getTopSearches(15),
        warp,
        nodeVersion: process.version,
        memoryRssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
        uptimeSeconds: Math.round(process.uptime())
    });
});

app.get("/api/admin/users", requireAdmin, (req, res) => {
    const sortBy = req.query.sortBy || "newest";
    res.json(getAllUsersAdmin(sortBy));
});

app.delete("/api/admin/users/:uuid", requireAdmin, (req, res) => {
    adminDeleteUser(req.params.uuid);
    res.json({ success: true });
});

app.get("/api/admin/logs", requireAdmin, (req, res) => {
    const { level, limit, search } = req.query;
    res.json(getLogs({ level, limit, search }));
});

app.post("/api/admin/logs/clear", requireAdmin, (req, res) => {
    clearLogs();
    res.json({ success: true });
});

app.get("/api/admin/settings", requireAdmin, (req, res) => {
    res.json(getSystemSettings());
});

app.post("/api/admin/settings", requireAdmin, (req, res) => {
    const updated = updateSystemSettings(req.body);
    res.json({ success: true, settings: updated });
});

app.post("/api/admin/cache/clear", requireAdmin, (req, res) => {
    const { target } = req.body;
    let cleared = 0;
    if (target === "torrents" || target === "all") {
        cleared += clearCachedTorrents();
    }
    if (target === "movies" || target === "all") {
        cleared += clearMoviesCache();
    }
    if (target === "searches" || target === "all") {
        cleared += clearSearchQueries();
    }
    res.json({ success: true, cleared });
});

// =============================================================================
// 4. ENDPOINT DE RÉSOLUTION LAZY (VALIDATION & FAILOVER INSTANTANÉ)
// =============================================================================
app.get("/resolve/:userRef/:imdbId/:fileRef(*)", (req, res) => {
    const userRef = req.params.userRef;
    const user = (userRef && userRef.length === 36 && userRef.includes("-")) ? getUserByUuid(userRef) : null;
    const tag = user ? { uuid: user.uuid, pseudo: user.pseudo || "Utilisateur" } : { uuid: userRef, pseudo: "Client" };
    return runWithUser(tag, () => handleResolve(req, res));
});

// =============================================================================
// 5. ROUTES STREMIO SÉCURISÉES (FORMAT MODERNE /:uuid/*)
// =============================================================================

// Middleware pour contextualiser les logs Stremio avec l'identité de l'utilisateur
app.use("/:uuid", (req, res, next) => {
    const uuid = req.params.uuid;
    if (uuid && uuid.length === 36 && uuid.includes("-")) {
        const user = getUserByUuid(uuid);
        const tag = user ? { uuid: user.uuid, pseudo: user.pseudo || "Utilisateur" } : { uuid, pseudo: "Inconnu" };
        return runWithUser(tag, () => next());
    }
    next();
});

app.get("/:uuid/manifest.json", (req, res) => {
    const config = getUserConfig(req.params.uuid);
    if (!config) return res.status(404).json({ error: "Addon introuvable pour cet identifiant." });
    const protocol = getRequestProtocol(req);
    const baseUrl = `${protocol}://${req.get("host")}`;
    res.json(handleManifest(config, baseUrl, req.params.uuid));
});

app.get("/:uuid/catalog/:type/:id.json", async (req, res) => {
    const config = getUserConfig(req.params.uuid);
    if (!config) return res.status(404).json({ error: "Addon introuvable." });
    try {
        const result = await handleCatalog(config, req.params.type, req.params.id, cache);
        res.json(result);
    } catch (err) {
        console.error(`[Catalog] Erreur ${req.params.id}:`, err.message);
        res.json({ metas: [] });
    }
});

app.get("/:uuid/catalog/:type/:id/:extra.json", async (req, res) => {
    const config = getUserConfig(req.params.uuid);
    if (!config) return res.status(404).json({ error: "Addon introuvable." });
    try {
        const result = await handleCatalog(config, req.params.type, req.params.id, cache, req.params.extra);
        res.json(result);
    } catch (err) {
        res.json({ metas: [] });
    }
});

app.get("/:uuid/meta/:type/:id.json", async (req, res) => {
    const config = getUserConfig(req.params.uuid);
    if (!config) return res.status(404).json({ error: "Addon introuvable." });
    try {
        const result = await handleMeta(config, req.params.type, req.params.id, cache);
        res.json(result);
    } catch (err) {
        console.error(`[Meta] Erreur ${req.params.id}:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get("/:uuid/stream/:type/:id.json", async (req, res) => {
    const config = getUserConfig(req.params.uuid);
    if (!config) return res.status(404).json({ error: "Addon introuvable." });
    try {
        const protocol = getRequestProtocol(req);
        const baseUrl = `${protocol}://${req.get("host")}`;
        const result = await handleStream(config, req.params.type, req.params.id, cache, baseUrl, req.params.uuid);
        res.json(result);
    } catch (err) {
        console.error(`[Stream] Erreur ${req.params.id}:`, err.message);
        res.json({ streams: [] });
    }
});

// =============================================================================
// 6. RÉTRO-COMPATIBILITÉ POUR LES ANCIENNES URLS (6 PARAMÈTRES)
// =============================================================================

function parseLegacyConfig(params) {
    return {
        apiKey: params.apiKey,
        tmdbKey: params.tmdbKey,
        cacheMode: params.cacheMode,
        langPref: params.langPref,
        prowlarrUrl: process.env.PROWLARR_URL || "http://prowlarr:9696",
        prowlarrKey: params.prowlarrKey,
        enabledCatalogs: params.enabledCatalogs
    };
}

app.get("/:apiKey/:tmdbKey/:cacheMode/:langPref/:prowlarrKey/:enabledCatalogs/manifest.json", (req, res) => {
    const config = parseLegacyConfig(req.params);
    const protocol = getRequestProtocol(req);
    const baseUrl = `${protocol}://${req.get("host")}`;
    res.json(handleManifest(config, baseUrl));
});

app.get("/:apiKey/:tmdbKey/:cacheMode/:langPref/:prowlarrKey/:enabledCatalogs/catalog/:type/:id.json", async (req, res) => {
    const config = parseLegacyConfig(req.params);
    try {
        const result = await handleCatalog(config, req.params.type, req.params.id, cache);
        res.json(result);
    } catch (err) {
        console.error(`[Legacy Catalog] Erreur ${req.params.id}:`, err.message);
        res.json({ metas: [] });
    }
});

app.get("/:apiKey/:tmdbKey/:cacheMode/:langPref/:prowlarrKey/:enabledCatalogs/catalog/:type/:id/:extra.json", async (req, res) => {
    const config = parseLegacyConfig(req.params);
    try {
        const result = await handleCatalog(config, req.params.type, req.params.id, cache, req.params.extra);
        res.json(result);
    } catch (err) {
        res.json({ metas: [] });
    }
});

app.get("/:apiKey/:tmdbKey/:cacheMode/:langPref/:prowlarrKey/:enabledCatalogs/meta/:type/:id.json", async (req, res) => {
    const config = parseLegacyConfig(req.params);
    try {
        const result = await handleMeta(config, req.params.type, req.params.id, cache);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get("/:apiKey/:tmdbKey/:cacheMode/:langPref/:prowlarrKey/:enabledCatalogs/stream/:type/:id.json", async (req, res) => {
    const config = parseLegacyConfig(req.params);
    try {
        const protocol = getRequestProtocol(req);
        const baseUrl = `${protocol}://${req.get("host")}`;
        const legacyRef = "k_" + Buffer.from(config.apiKey).toString("base64url");
        const result = await handleStream(config, req.params.type, req.params.id, cache, baseUrl, legacyRef);
        res.json(result);
    } catch (err) {
        res.json({ streams: [] });
    }
});

// =============================================================================
// 7. INTERFACE WEB & STATIQUES (STREAM-FUSION & ADMIN)
// =============================================================================

app.get("/logo.png", (req, res) => {
    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(LOGO_SVG);
});

app.get("/background.png", (req, res) => {
    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(BACKGROUND_SVG);
});

app.get("/", (req, res) => {
    res.send(renderConfigPage("register"));
});

app.get("/configure", (req, res) => {
    res.send(renderConfigPage("configure"));
});

app.get("/:uuid/configure", (req, res) => {
    res.send(renderConfigPage("configure", req.params.uuid));
});

app.get("/:uuid", (req, res, next) => {
    if (req.params.uuid && req.params.uuid.length === 36 && req.params.uuid.includes("-")) {
        return res.send(renderConfigPage("configure", req.params.uuid));
    }
    next();
});

app.get("/:apiKey/:tmdbKey/:cacheMode/:langPref/:prowlarrKey/:enabledCatalogs/configure", (req, res) => {
    res.redirect("/configure");
});

app.get("/admin", (req, res) => {
    res.send(renderAdminPage());
});

// Démarrage du worker RSS Prowlarr
startProwlarrWorker();

// Purge périodique du cache de torrents (TTL 30 jours)
purgeOldCachedTorrents();
const purgeTimer = setInterval(() => {
    purgeOldCachedTorrents();
}, 24 * 60 * 60 * 1000);
if (purgeTimer && purgeTimer.unref) {
    purgeTimer.unref();
}

module.exports = app;

if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`[Server] Addon CinéCloud FR en écoute sur le port ${PORT}`);
        console.log(`[Server] Interface web accessible sur http://localhost:${PORT}`);
        console.log(`[Server] Panneau d'administration sur http://localhost:${PORT}/admin`);
    });
}
