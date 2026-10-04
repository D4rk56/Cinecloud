"use strict";

const { validateEnv } = require("./lib/env");
validateEnv();

const express = require("express");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const axios = require("axios");
const rateLimit = require("express-rate-limit");
const { secureFilePermissions } = require("./lib/crypto");

const DATA_DIR = path.join(__dirname, "data");
const ADMIN_PASS_FILE = path.join(DATA_DIR, ".admin_password");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ID_LENGTH = 2000;

function isReasonableId(id) {
    return typeof id === "string" && id.length > 0 && id.length <= MAX_ID_LENGTH && !/[\u0000-\u001f]/.test(id);
}

// Gestion sécurisée du mot de passe Administrateur (Suppression définitive de admin123)
function resolveAdminPassword() {
    const envPass = process.env.ADMIN_PASSWORD;
    if (envPass && typeof envPass === "string" && envPass.trim() !== "" && envPass !== "admin123") {
        if (fs.existsSync(ADMIN_PASS_FILE)) {
            secureFilePermissions(ADMIN_PASS_FILE);
        }
        return envPass.trim();
    }

    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    }

    if (fs.existsSync(ADMIN_PASS_FILE)) {
        try {
            secureFilePermissions(ADMIN_PASS_FILE);
            const saved = fs.readFileSync(ADMIN_PASS_FILE, "utf8").trim();
            if (saved && saved.length >= 8 && saved !== "admin123") {
                process.env.ADMIN_PASSWORD = saved;
                return saved;
            }
        } catch (e) {}
    }

    const generated = crypto.randomBytes(16).toString("hex");
    try {
        fs.writeFileSync(ADMIN_PASS_FILE, generated, { mode: 0o600, encoding: "utf8" });
        secureFilePermissions(ADMIN_PASS_FILE);
    } catch (e) {}
    process.env.ADMIN_PASSWORD = generated;
    console.log(`[Security] 🔐 Mot de passe administrateur sécurisé généré : ${generated}`);
    console.log(
        `[Security] 💾 Sauvegardé dans data/.admin_password (définissez ADMIN_PASSWORD dans vos variables d'environnement pour personnaliser).`
    );
    return generated;
}

const { initConsoleInterceptors, getLogs, clearLogs, runWithUser } = require("./lib/logger");

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
const {
    loginSchema,
    usersQuerySchema,
    userDeleteParamsSchema,
    logsQuerySchema,
    settingsSchema,
    cacheClearSchema,
    cleanupMagnetsSchema,
    validateAdmin
} = require("./lib/admin-schemas");
const { handleManifest, handleCatalog, handleMeta, handleStream } = require("./lib/stremio");
const { handleResolve } = require("./lib/resolver");
const { startProwlarrWorker, stopProwlarrWorker } = require("./lib/prowlarr-worker");
const { ALL_CATALOGS, checkTmdbKey } = require("./lib/helpers");
const alldebrid = require("./lib/alldebrid");
const { getWarpStatus, checkAllDebridKey } = alldebrid;
const { LOGO_SVG, BACKGROUND_SVG, renderConfigPage, renderAdminPage } = require("./lib/ui");
const { loadAnimeMapping } = require("./lib/animeMapping");
const { assertSafeSelfHostedUrl, isForbiddenTargetUrl } = require("./lib/net-guard");

// Initialisation et indexation mémoire de la table communautaire Fribb anime-lists au boot
loadAnimeMapping().catch(err => console.warn("[Server] AnimeMapping non disponible :", err.message));

function getRequestProtocol(req) {
    const forwarded = req.headers["x-forwarded-proto"];
    if (forwarded) {
        return (Array.isArray(forwarded) ? forwarded[0] : forwarded.split(",")[0]).trim();
    }
    return req.protocol || "http";
}

// En-tête navigateur par défaut pour les requêtes directes (TMDB, Cinemeta, Lumio)
const BROWSER_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
axios.defaults.headers.common["User-Agent"] = BROWSER_UA;

const app = express();
const cache = loadCache();

// Fait confiance aux reverse proxies uniquement si explicitement configuré (TRUST_PROXY).
// Par défaut false : req.ip = adresse socket réelle (non falsifiable via X-Forwarded-For).
// Derrière Cloudflare Tunnel / Nginx, définir TRUST_PROXY=1.
function resolveTrustProxy() {
    const raw = (process.env.TRUST_PROXY || "").trim().toLowerCase();
    if (raw === "" || raw === "false") return false;
    if (raw === "true") return true;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : false;
}
app.set("trust proxy", resolveTrustProxy());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuration CORS stricte et contextualisée
app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

    const pathUrl = req.path || "";

    // 1. Routes Stremio publiques & assets : CORS ouvert pour compatibilité Web Stremio et lecteurs externes
    const isStremioRoute =
        pathUrl.includes("/manifest.json") ||
        pathUrl.includes("/catalog/") ||
        pathUrl.includes("/meta/") ||
        pathUrl.includes("/stream/") ||
        pathUrl === "/logo.png" ||
        pathUrl === "/background.png";

    if (isStremioRoute) {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Headers", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        if (req.method === "OPTIONS") return res.sendStatus(204);
        return next();
    }

    // 2. Routes API & Administration : vérification stricte de l'origine
    if (pathUrl.startsWith("/api/")) {
        const origin = req.headers.origin;

        // Requêtes directes sans en-tête Origin (navigation navigateur même domaine, curl, outils CLI)
        if (!origin) {
            return next();
        }

        try {
            const parsedOrigin = new URL(origin);
            const reqHost = req.get("host"); // ex: localhost:3000 ou domaine.fr
            const originHost = parsedOrigin.host; // ex: localhost:3000

            const isSameHost = originHost.toLowerCase() === (reqHost || "").toLowerCase();
            const isLocal = ["localhost", "127.0.0.1", "::1"].includes(parsedOrigin.hostname.toLowerCase());
            const customAllowed = (process.env.CORS_ALLOWED_ORIGINS || "")
                .split(",")
                .map(o => o.trim().toLowerCase())
                .filter(Boolean);
            const isCustomAllowed =
                customAllowed.includes(origin.toLowerCase()) || customAllowed.includes(originHost.toLowerCase());

            if (isSameHost || isLocal || isCustomAllowed) {
                res.setHeader("Access-Control-Allow-Origin", origin);
                res.setHeader("Access-Control-Allow-Credentials", "true");
                res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Token, Accept");
                res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
                if (req.method === "OPTIONS") return res.sendStatus(204);
                return next();
            }
        } catch (e) {}

        // Origine tierce non autorisée : blocage strict
        if (req.method === "OPTIONS") {
            return res.status(403).json({ error: "CORS Forbidden: Origine non autorisée pour l'API." });
        }
        return res.status(403).json({ error: "CORS Forbidden: Origine non autorisée pour l'API." });
    }

    // 3. Autres routes (ex: /configure, /, /resolve/...)
    const origin = req.headers.origin;
    if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Headers", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
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

// Limitation de débit sur les sondes et vérifications d'APIs (Protection SSRF et abus de clés)
const apiCheckLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 requêtes par minute
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false, trustProxy: false },
    message: { error: "Trop de requêtes de vérification d'API. Veuillez patienter une minute." }
});

// Limitation de débit sur les actions de maintenance et sync admin
const adminActionLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 requêtes par minute
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false, trustProxy: false },
    message: { error: "Trop d'actions administratives rapprochées. Veuillez patienter une minute." }
});

// Limitation de débit sur le résolveur lazy pour prévenir le scraping de flux
const resolveLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60, // 60 requêtes par minute
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false, trustProxy: false },
    message: { error: "Trop de résolutions de flux. Veuillez patienter une minute." }
});

// Authentification Administrateur
const ADMIN_PASSWORD = resolveAdminPassword();
const ADMIN_TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 heures, expiration glissante
const activeAdminTokens = new Map(); // token -> expiresAt (timestamp ms)

function requireAdmin(req, res, next) {
    const token = req.headers["x-admin-token"];
    if (!token) {
        return res.status(401).json({ error: "Session administrateur non autorisée ou expirée." });
    }
    const expiresAt = activeAdminTokens.get(token);
    if (!expiresAt) {
        return res.status(401).json({ error: "Session administrateur non autorisée ou expirée." });
    }
    if (Date.now() > expiresAt) {
        activeAdminTokens.delete(token);
        return res.status(401).json({ error: "Session administrateur non autorisée ou expirée." });
    }
    // Renouvellement glissant de l'expiration à chaque requête autorisée
    activeAdminTokens.set(token, Date.now() + ADMIN_TOKEN_TTL_MS);
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

        const debridProvider =
            req.body.debridProvider === "torbox" ? "torbox" : req.body.debridProvider === "both" ? "both" : "alldebrid";
        const apiKey = req.body.apiKey ? req.body.apiKey.trim() : "";
        const torboxApiKey = req.body.torboxApiKey
            ? req.body.torboxApiKey.trim()
            : debridProvider === "torbox"
              ? apiKey
              : "";

        if (debridProvider === "both") {
            if (!apiKey && !torboxApiKey) {
                return res
                    .status(400)
                    .json({ error: "Au moins une clé API (AllDebrid ou Torbox) est requise pour le mode combiné." });
            }
        } else if (debridProvider === "torbox") {
            if (!torboxApiKey) {
                return res.status(400).json({ error: "La clé API Torbox est requise." });
            }
        } else {
            if (!apiKey) {
                return res.status(400).json({ error: "La clé API AllDebrid est requise." });
            }
        }

        if (!password || typeof password !== "string" || password.length < 4) {
            return res
                .status(400)
                .json({ error: "Un mot de passe d'au moins 4 caractères est requis pour sécuriser vos réglages." });
        }

        const uuid = crypto.randomUUID();
        const passwordHash = hashPassword(password);
        const resolvedProwlarrMode =
            prowlarrMode === "shared" || prowlarrMode === "private" || prowlarrMode === "local"
                ? prowlarrMode
                : prowlarrKey && prowlarrKey.trim() && prowlarrKey !== "off"
                  ? "shared"
                  : "local";

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
            maxSizeGb: maxSizeGb !== undefined && maxSizeGb !== null && maxSizeGb !== "" ? Number(maxSizeGb) : 150,
            maxStreams: Number(maxStreams) || 0,
            prioritizeCloud: req.body.prioritizeCloud !== undefined ? Boolean(req.body.prioritizeCloud) : true,
            prowlarrUrl: (prowlarrUrl && prowlarrUrl.trim()) || "http://prowlarr:9696",
            prowlarrKey: (prowlarrKey && prowlarrKey.trim()) || "off",
            prowlarrMode: resolvedProwlarrMode,
            allowDownload: Boolean(allowDownload),
            preValidateCache: req.body.preValidateCache !== undefined ? Boolean(req.body.preValidateCache) : true,
            disableCatalogs: Boolean(disableCatalogs),
            lumioUrl: (req.body.lumioUrl && req.body.lumioUrl.trim()) || "",
            torrentioUrl: (req.body.torrentioUrl && req.body.torrentioUrl.trim()) || "",
            enabledCatalogs: Array.isArray(enabledCatalogs)
                ? enabledCatalogs
                : enabledCatalogs
                  ? enabledCatalogs.split(",")
                  : ALL_CATALOGS.map(c => c.id)
        };

        // Garde SSRF de second ordre : autorise les services auto-hébergés (prowlarr:9696,
        // host.docker.internal, LAN) mais refuse les cibles dangereuses (link-local/métadonnées).
        if (configData.prowlarrKey && configData.prowlarrKey.trim() && configData.prowlarrKey !== "off") {
            if (isForbiddenTargetUrl(configData.prowlarrUrl)) {
                return res
                    .status(400)
                    .json({ error: "L'URL Prowlarr pointe vers une cible interdite (link-local / métadonnées)." });
            }
        }

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
            console.log(
                `[User] Nouveau manifest créé avec succès : UUID ${uuid}${configData.pseudo ? ` (${configData.pseudo})` : ""} [Provider: ${configData.debridProvider}, Prowlarr: ${configData.prowlarrMode}]`
            );
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
                debridProvider: config.debridProvider || "alldebrid",
                apiKeyPreview: config.apiKey ? `${config.apiKey.slice(0, 4)}...${config.apiKey.slice(-4)}` : "",
                torboxApiKeyPreview: config.torboxApiKey
                    ? `${config.torboxApiKey.slice(0, 4)}...${config.torboxApiKey.slice(-4)}`
                    : "",
                pseudo: user.pseudo || config.pseudo || "",
                tmdbKey: config.tmdbKey || "default",
                cacheMode: config.cacheMode || "on",
                langPref: config.langPref || "multi_vff,vff,vfi,multi,vf,vostfr",
                resolutions: config.resolutions || "4k,1080p,720p,480p",
                hideUnknownLanguages: Boolean(config.hideUnknownLanguages),
                sortBy: config.sortBy || "quality",
                maxSizeGb: config.maxSizeGb !== undefined ? config.maxSizeGb : 150,
                maxStreams: config.maxStreams || 0,
                prioritizeCloud:
                    config.prioritizeCloud !== undefined ? Boolean(config.prioritizeCloud) : true,
                prowlarrUrl: config.prowlarrUrl || "http://prowlarr:9696",
                prowlarrKey: config.prowlarrKey || "",
                prowlarrMode: user.prowlarrMode || config.prowlarrMode || "local",
                allowDownload: Boolean(config.allowDownload),
                preValidateCache: config.preValidateCache !== false,
                disableCatalogs: Boolean(config.disableCatalogs),
                lumioUrl: config.lumioUrl || "",
                torrentioUrl: config.torrentioUrl || "",
                enabledCatalogs: config.enabledCatalogs
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
        const resolvedProwlarrMode =
            prowlarrMode === "shared" || prowlarrMode === "private" || prowlarrMode === "local"
                ? prowlarrMode
                : currentConfig.prowlarrMode || user.prowlarrMode || "local";

        const resolvedDebridProvider =
            debridProvider !== undefined
                ? debridProvider === "torbox"
                    ? "torbox"
                    : debridProvider === "both"
                      ? "both"
                      : "alldebrid"
                : currentConfig.debridProvider || "alldebrid";

        const updatedConfig = {
            debridProvider: resolvedDebridProvider,
            apiKey: apiKey && typeof apiKey === "string" && apiKey.trim() ? apiKey.trim() : currentConfig.apiKey || "",
            torboxApiKey:
                torboxApiKey && typeof torboxApiKey === "string" && torboxApiKey.trim()
                    ? torboxApiKey.trim()
                    : currentConfig.torboxApiKey || "",
            pseudo: pseudo !== undefined ? pseudo.trim() : user.pseudo || currentConfig.pseudo || "",
            tmdbKey: tmdbKey !== undefined ? tmdbKey.trim() : currentConfig.tmdbKey,
            cacheMode: cacheMode === "off" ? "off" : cacheMode === "on" ? "on" : currentConfig.cacheMode || "on",
            langPref: langPref !== undefined ? langPref : currentConfig.langPref,
            resolutions: resolutions !== undefined ? resolutions : currentConfig.resolutions || "4k,1080p,720p,480p",
            hideUnknownLanguages:
                hideUnknownLanguages !== undefined
                    ? Boolean(hideUnknownLanguages)
                    : Boolean(currentConfig.hideUnknownLanguages),
            sortBy: sortBy !== undefined ? sortBy : currentConfig.sortBy || "quality",
            maxSizeGb:
                maxSizeGb !== undefined
                    ? Number(maxSizeGb) || 0
                    : currentConfig.maxSizeGb !== undefined
                      ? currentConfig.maxSizeGb
                      : 150,
            maxStreams: maxStreams !== undefined ? Number(maxStreams) || 0 : currentConfig.maxStreams || 0,
            prioritizeCloud:
                req.body.prioritizeCloud !== undefined
                    ? Boolean(req.body.prioritizeCloud)
                    : currentConfig.prioritizeCloud !== undefined
                      ? Boolean(currentConfig.prioritizeCloud)
                      : true,
            prowlarrUrl: (prowlarrUrl && prowlarrUrl.trim()) || currentConfig.prowlarrUrl || "http://prowlarr:9696",
            prowlarrKey:
                prowlarrKey && typeof prowlarrKey === "string" && prowlarrKey.trim()
                    ? prowlarrKey.trim()
                    : currentConfig.prowlarrKey || "off",
            prowlarrMode: resolvedProwlarrMode,
            allowDownload: allowDownload !== undefined ? Boolean(allowDownload) : Boolean(currentConfig.allowDownload),
            preValidateCache:
                req.body.preValidateCache !== undefined
                    ? Boolean(req.body.preValidateCache)
                    : currentConfig.preValidateCache !== false,
            disableCatalogs:
                disableCatalogs !== undefined ? Boolean(disableCatalogs) : Boolean(currentConfig.disableCatalogs),
            lumioUrl:
                req.body.lumioUrl !== undefined
                    ? req.body.lumioUrl
                        ? req.body.lumioUrl.trim()
                        : ""
                    : currentConfig.lumioUrl || "",
            torrentioUrl:
                req.body.torrentioUrl !== undefined
                    ? req.body.torrentioUrl
                        ? req.body.torrentioUrl.trim()
                        : ""
                    : currentConfig.torrentioUrl || "",
            enabledCatalogs: Array.isArray(enabledCatalogs)
                ? enabledCatalogs
                : enabledCatalogs
                  ? enabledCatalogs.split(",")
                  : currentConfig.enabledCatalogs
        };

        // Garde SSRF de second ordre : autorise les services auto-hébergés (prowlarr:9696,
        // host.docker.internal, LAN) mais refuse les cibles dangereuses (link-local/métadonnées).
        if (updatedConfig.prowlarrKey && updatedConfig.prowlarrKey.trim() && updatedConfig.prowlarrKey !== "off") {
            if (isForbiddenTargetUrl(updatedConfig.prowlarrUrl)) {
                return res
                    .status(400)
                    .json({ error: "L'URL Prowlarr pointe vers une cible interdite (link-local / métadonnées)." });
            }
        }

        updateUserConfig(uuid.trim(), encryptConfig(updatedConfig), updatedConfig.pseudo, updatedConfig.prowlarrMode);

        if (newPassword && typeof newPassword === "string" && newPassword.length >= 4) {
            updateUserPassword(uuid.trim(), hashPassword(newPassword));
        }

        // Réveil / redémarrage du worker Prowlarr avec les paramètres mis à jour
        stopProwlarrWorker();
        startProwlarrWorker();

        return runWithUser({ uuid: user.uuid, pseudo: updatedConfig.pseudo || "Utilisateur" }, () => {
            console.log(
                `[User] Configuration mise à jour pour l'UUID ${uuid} [Provider: ${updatedConfig.debridProvider}, Prowlarr: ${updatedConfig.prowlarrMode}]`
            );
            return res.json({ success: true, message: "Réglages mis à jour avec succès !" });
        });
    } catch (err) {
        return res.status(500).json({ error: "Erreur lors de la mise à jour des réglages." });
    }
});

app.post("/api/check/prowlarr", apiCheckLimiter, async (req, res) => {
    const { prowlarrUrl, prowlarrKey } = req.body;
    const { checkProwlarrConnectivity } = require("./lib/prowlarr-worker");
    const result = await checkProwlarrConnectivity(prowlarrUrl, prowlarrKey);
    res.json(result);
});

app.post("/api/check/lumio", apiCheckLimiter, async (req, res) => {
    const { lumioUrl } = req.body;
    if (!lumioUrl || typeof lumioUrl !== "string" || !lumioUrl.trim()) {
        return res.json({ success: false, valid: false, error: "Veuillez saisir l'URL de votre manifest Lumio" });
    }

    let raw = lumioUrl.trim();
    if (!raw.endsWith("/manifest.json")) {
        raw = raw.replace(/\/+$/, "") + "/manifest.json";
    }

    // Garde SSRF : autorise les services auto-hébergés mais refuse les cibles dangereuses
    // (link-local / métadonnées cloud, non spécifiée, multicast, réservée).
    const ssrfCheck = await assertSafeSelfHostedUrl(raw);
    if (!ssrfCheck.ok) {
        return res.json({ success: false, valid: false, error: `URL Lumio refusée (sécurité) : ${ssrfCheck.error}` });
    }

    try {
        const resp = await axios.get(raw, {
            headers: {
                "User-Agent": BROWSER_UA,
                Accept: "application/json"
            },
            timeout: 5000
        });

        if (resp.status === 200 && resp.data && resp.data.id) {
            return res.json({
                success: true,
                valid: true,
                name: resp.data.name || "Lumio",
                version: resp.data.version || "1.0",
                description: resp.data.description || ""
            });
        }
        return res.json({
            success: false,
            valid: false,
            error: "Réponse reçue mais le format de manifest Stremio est invalide"
        });
    } catch (err) {
        const respDataStr = err.response?.data
            ? typeof err.response.data === "string"
                ? err.response.data
                : JSON.stringify(err.response.data)
            : "";
        if (
            err.response &&
            (err.response.status === 530 ||
                respDataStr.includes("1033") ||
                respDataStr.includes("Cloudflare Tunnel error"))
        ) {
            return res.json({
                success: false,
                valid: false,
                isCloudflare1033: true,
                error: "mylumio.tv est actuellement hors-ligne (Erreur Cloudflare 1033 : Tunnel déconnecté côté Lumio). Laissez ce champ vide ou réessayez plus tard."
            });
        }
        if (err.response && err.response.status === 404) {
            return res.json({
                success: false,
                valid: false,
                error: "Manifest introuvable (HTTP 404). Vérifiez l'URL de votre compte mylumio.tv."
            });
        }
        return res.json({
            success: false,
            valid: false,
            error: err.response
                ? `Erreur HTTP ${err.response.status} de Lumio`
                : err.message || "Impossible de joindre Lumio"
        });
    }
});

// Sondage du manifest Torrentio. L'addon n'exploite QUE les infoHash de Torrentio : la clé debrid
// de l'utilisateur reste dans l'addon et n'est jamais transmise à Torrentio.
app.post("/api/check/torrentio", apiCheckLimiter, async (req, res) => {
    const { torrentioUrl } = req.body;
    if (!torrentioUrl || typeof torrentioUrl !== "string" || !torrentioUrl.trim()) {
        return res.json({
            success: false,
            valid: false,
            error: "Veuillez saisir l'URL de votre manifest Torrentio"
        });
    }

    let raw = torrentioUrl.trim();
    if (!raw.endsWith("/manifest.json")) {
        raw = raw.replace(/\/+$/, "") + "/manifest.json";
    }

    // Garde SSRF : autorise les services auto-hébergés mais refuse les cibles dangereuses
    const ssrfCheck = await assertSafeSelfHostedUrl(raw);
    if (!ssrfCheck.ok) {
        return res.json({
            success: false,
            valid: false,
            error: `URL Torrentio refusée (sécurité) : ${ssrfCheck.error}`
        });
    }

    try {
        const resp = await axios.get(raw, {
            headers: {
                "User-Agent": BROWSER_UA,
                Accept: "application/json"
            },
            timeout: 5000
        });

        const resources = resp.data && Array.isArray(resp.data.resources) ? resp.data.resources : [];
        const hasStreamResource = resources.some(r => r && r.name === "stream");
        if (resp.status === 200 && resp.data && resp.data.id && (resources.length === 0 || hasStreamResource)) {
            return res.json({
                success: true,
                valid: true,
                name: resp.data.name || "Torrentio",
                version: resp.data.version || "1.0",
                description: resp.data.description || ""
            });
        }
        return res.json({
            success: false,
            valid: false,
            error: "Réponse reçue mais le manifest Stremio est invalide (id ou ressource 'stream' manquante)"
        });
    } catch (err) {
        if (err.response && err.response.status === 404) {
            return res.json({
                success: false,
                valid: false,
                error: "Manifest introuvable (HTTP 404). Vérifiez l'URL de votre manifest Torrentio."
            });
        }
        return res.json({
            success: false,
            valid: false,
            error: err.response
                ? `Erreur HTTP ${err.response.status} de Torrentio`
                : err.message || "Impossible de joindre Torrentio"
        });
    }
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

// Nettoyage des magnets AllDebrid bloqués pour un utilisateur
app.post("/api/user/cleanup-magnets", authLimiter, async (req, res) => {
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
        const apiKey = config?.apiKey;
        if (!apiKey) {
            return res.status(400).json({ error: "Aucune clé AllDebrid configurée pour cet utilisateur." });
        }

        const result = await alldebrid.cleanupPendingMagnets(apiKey);
        return res.json(result);
    } catch (err) {
        console.error("[User] Erreur cleanup-magnets :", err.message);
        return res.status(500).json({ error: "Erreur lors du nettoyage des magnets AllDebrid." });
    }
});

// =============================================================================
// 2. ENDPOINTS PUBLICS DE STATUT & VÉRIFICATION
// =============================================================================

app.get("/api/status/warp", (req, res) => {
    res.json(getWarpStatus());
});

app.post("/api/check/alldebrid", apiCheckLimiter, async (req, res) => {
    const { apiKey } = req.body;
    const result = await checkAllDebridKey(apiKey);
    res.json(result);
});

app.post("/api/check/torbox", apiCheckLimiter, async (req, res) => {
    const { apiKey } = req.body;
    const { checkTorboxKey } = require("./lib/torbox");
    const result = await checkTorboxKey(apiKey);
    res.json(result);
});

app.post("/api/check/tmdb", apiCheckLimiter, async (req, res) => {
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

app.post("/api/admin/login", authLimiter, validateAdmin({ body: loginSchema }), (req, res) => {
    const { password } = req.body;
    let isValid = false;
    if (typeof password === "string" && typeof ADMIN_PASSWORD === "string") {
        const passBuf = Buffer.from(password);
        const adminBuf = Buffer.from(ADMIN_PASSWORD);
        if (passBuf.length === adminBuf.length) {
            isValid = crypto.timingSafeEqual(passBuf, adminBuf);
        }
    }
    if (isValid) {
        const token = crypto.randomBytes(24).toString("hex");
        activeAdminTokens.set(token, Date.now() + ADMIN_TOKEN_TTL_MS);
        return res.json({ success: true, token });
    }
    return res.status(401).json({ error: "Mot de passe administrateur incorrect." });
});

app.post("/api/admin/logout", requireAdmin, (req, res) => {
    const token = req.headers["x-admin-token"];
    if (token) activeAdminTokens.delete(token);
    res.json({ success: true });
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

app.get("/api/admin/users", requireAdmin, validateAdmin({ query: usersQuerySchema }), (req, res) => {
    const sortBy = req.query.sortBy || "newest";
    res.json(getAllUsersAdmin(sortBy));
});

app.delete("/api/admin/users/:uuid", requireAdmin, validateAdmin({ params: userDeleteParamsSchema }), (req, res) => {
    const uuid = req.params.uuid;
    adminDeleteUser(uuid);
    res.json({ success: true });
});

app.get("/api/admin/logs", requireAdmin, validateAdmin({ query: logsQuerySchema }), (req, res) => {
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

app.post("/api/admin/settings", requireAdmin, validateAdmin({ body: settingsSchema }), (req, res) => {
    const updated = updateSystemSettings(req.body);
    res.json({ success: true, settings: updated });
});

app.post(
    "/api/admin/cache/clear",
    requireAdmin,
    adminActionLimiter,
    validateAdmin({ body: cacheClearSchema }),
    (req, res) => {
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
    }
);

// Sonde / Test de santé en direct des APIs AllDebrid et Torbox
app.get("/api/admin/health/debrid", requireAdmin, adminActionLimiter, async (req, res) => {
    const results = {
        timestamp: new Date().toISOString(),
        alldebrid: { status: "unknown", latencyMs: 0, error: null },
        torbox: { status: "unknown", latencyMs: 0, error: null }
    };

    // 1 & 2. Sondes concurrentes AllDebrid & Torbox
    const probeAd = (async () => {
        const adStart = Date.now();
        try {
            const adRes = await axios.get("https://api.alldebrid.com/v4/user", {
                timeout: 7000,
                headers: { "User-Agent": "CineCloud-FR-HealthProbe/1.0" },
                validateStatus: () => true
            });
            results.alldebrid.latencyMs = Date.now() - adStart;
            results.alldebrid.status = [200, 401, 403].includes(adRes.status) ? "online" : "degraded";
            results.alldebrid.httpCode = adRes.status;
        } catch (err) {
            results.alldebrid.latencyMs = Date.now() - adStart;
            results.alldebrid.status = "offline";
            results.alldebrid.error = err.message;
        }
    })();

    const probeTb = (async () => {
        const tbStart = Date.now();
        try {
            const tbRes = await axios.get("https://api.torbox.app/v1/api/user/me", {
                timeout: 7000,
                headers: { "User-Agent": "CineCloud-FR-HealthProbe/1.0" },
                validateStatus: () => true
            });
            results.torbox.latencyMs = Date.now() - tbStart;
            results.torbox.status = [200, 401, 403].includes(tbRes.status) ? "online" : "degraded";
            results.torbox.httpCode = tbRes.status;
        } catch (err) {
            results.torbox.latencyMs = Date.now() - tbStart;
            results.torbox.status = "offline";
            results.torbox.error = err.message;
        }
    })();

    await Promise.all([probeAd, probeTb]);

    res.json(results);
});

// Téléchargement sécurisé du backup SQLite
app.get("/api/admin/backup", requireAdmin, adminActionLimiter, (req, res) => {
    const { SQLITE_FILE, checkpointDatabase } = require("./lib/db");
    if (!SQLITE_FILE || !fs.existsSync(SQLITE_FILE)) {
        return res.status(404).json({ error: "Fichier de base de données SQLite introuvable." });
    }
    checkpointDatabase();
    const dateStr = new Date().toISOString().slice(0, 10);
    res.download(SQLITE_FILE, `cinecloud-backup-${dateStr}.db`, err => {
        if (err && !res.headersSent) {
            res.status(500).json({ error: "Erreur lors du téléchargement du backup." });
        }
    });
});

// Purge des torrents expirés (+30 jours) déportée dans le worker thread
app.post("/api/admin/maintenance/purge-expired", requireAdmin, adminActionLimiter, async (req, res) => {
    const { asyncPurgeOldCachedTorrents } = require("./lib/db");
    const purged = await asyncPurgeOldCachedTorrents(30 * 86400);
    res.json({ success: true, purged, message: `${purged} torrents expirés (+30j) supprimés du cache.` });
});

// Optimisation SQLite (WAL checkpoint & VACUUM) déportée dans le worker thread
app.post("/api/admin/maintenance/vacuum", requireAdmin, adminActionLimiter, async (req, res) => {
    const { asyncOptimizeDatabase } = require("./lib/db");
    const result = await asyncOptimizeDatabase();
    if (result && result.success) {
        res.json({ success: true, message: "Base de données SQLite optimisée avec succès (WAL checkpoint & VACUUM)." });
    } else {
        res.status(500).json({ error: (result && result.error) || "Erreur lors de l'optimisation SQLite." });
    }
});

// Déclenchement forcé immédiat du cycle RSS Prowlarr crowdsourcing
app.post(
    ["/api/admin/prowlarr/sync", "/api/admin/maintenance/sync-prowlarr"],
    requireAdmin,
    adminActionLimiter,
    async (req, res) => {
        const { forceSyncProwlarrCrowdsourcing } = require("./lib/prowlarr-worker");
        const result = await forceSyncProwlarrCrowdsourcing();
        res.json(result);
    }
);

// Purge globale des magnets AllDebrid bloqués
app.post(
    "/api/admin/cleanup-magnets",
    requireAdmin,
    adminActionLimiter,
    validateAdmin({ body: cleanupMagnetsSchema }),
    async (req, res) => {
        try {
            const { apiKey } = req.body || {};
            if (apiKey) {
                const result = await alldebrid.cleanupPendingMagnets(apiKey);
                return res.json(result);
            }

            let totalPurged = 0;
            const cleanedKeys = new Set();
            const defaultKey = process.env.ALLDEBRID_API_KEY;
            if (defaultKey) {
                cleanedKeys.add(defaultKey);
                const rDef = await alldebrid.cleanupPendingMagnets(defaultKey);
                totalPurged += rDef.deletedCount || 0;
            }

            const users = getAllUsersAdmin();
            for (const u of users) {
                const user = getUserByUuid(u.uuid);
                if (user && user.configEncrypted) {
                    try {
                        const cfg = decryptConfig(user.configEncrypted);
                        if (cfg && cfg.apiKey && !cleanedKeys.has(cfg.apiKey)) {
                            cleanedKeys.add(cfg.apiKey);
                            const r = await alldebrid.cleanupPendingMagnets(cfg.apiKey);
                            totalPurged += r.deletedCount || 0;
                        }
                    } catch (e) {}
                }
            }
            return res.json({
                success: true,
                deletedCount: totalPurged,
                message: `${totalPurged} magnet(s) bloqué(s) AllDebrid supprimé(s) au total.`
            });
        } catch (err) {
            console.error("[Admin] Erreur cleanup-magnets :", err.message);
            return res.status(500).json({ error: "Erreur lors de la purge admin des magnets AllDebrid." });
        }
    }
);

// =============================================================================
// 4. ENDPOINT DE RÉSOLUTION LAZY (VALIDATION & FAILOVER INSTANTANÉ)
// =============================================================================
app.get("/resolve/:userRef/:imdbId/:fileRef(*)", resolveLimiter, (req, res) => {
    const userRef = req.params.userRef;
    const user = userRef && userRef.length === 36 && userRef.includes("-") ? getUserByUuid(userRef) : null;
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
    if (!isReasonableId(req.params.id)) return res.status(400).json({ error: "Identifiant invalide." });
    try {
        const extra = req.query && Object.keys(req.query).length > 0 ? req.query : null;
        const result = await handleCatalog(config, req.params.type, req.params.id, cache, extra);
        res.json(result);
    } catch (err) {
        console.error(`[Catalog] Erreur ${req.params.id}:`, err.stack || err.message);
        res.json({ metas: [] });
    }
});

app.get("/:uuid/catalog/:type/:id/:extra.json", async (req, res) => {
    const config = getUserConfig(req.params.uuid);
    if (!config) return res.status(404).json({ error: "Addon introuvable." });
    if (!isReasonableId(req.params.id)) return res.status(400).json({ error: "Identifiant invalide." });
    try {
        const extraParam = req.params.extra;
        const extraObj = req.query && Object.keys(req.query).length > 0 ? { extraParam, ...req.query } : extraParam;
        const result = await handleCatalog(config, req.params.type, req.params.id, cache, extraObj);
        res.json(result);
    } catch (err) {
        console.error(`[Catalog] Erreur ${req.params.id} (${req.params.extra}):`, err.stack || err.message);
        res.json({ metas: [] });
    }
});

app.get("/:uuid/meta/:type/:id.json", async (req, res) => {
    const config = getUserConfig(req.params.uuid);
    if (!config) return res.status(404).json({ error: "Addon introuvable." });
    if (!isReasonableId(req.params.id)) return res.status(400).json({ error: "Identifiant invalide." });
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
    if (!isReasonableId(req.params.id)) return res.status(400).json({ error: "Identifiant invalide." });
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
// 6. RÉTRO-COMPATIBILITÉ POUR LES ANCIENNES URLS (6 PARAMÈTRES) — SUPPRIMÉE
//    Les anciennes URL embarquaient la clé API AllDebrid en clair dans le chemin
//    et dans les URLs de flux (k_base64url). Elles ont été retirées pour des
//    raisons de sécurité. Les utilisateurs doivent recréer un manifest UUID via `/`.
// =============================================================================

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
    const uuid = UUID_RE.test(req.params.uuid) ? req.params.uuid : "";
    res.send(renderConfigPage("configure", uuid));
});

app.get("/:uuid", (req, res, next) => {
    if (UUID_RE.test(req.params.uuid)) {
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

// Purge périodique du cache de torrents (TTL 30 jours) déportée dans le worker
const { asyncPurgeOldCachedTorrents } = require("./lib/db");
asyncPurgeOldCachedTorrents();
const purgeTimer = setInterval(
    () => {
        asyncPurgeOldCachedTorrents();
    },
    24 * 60 * 60 * 1000
);
if (purgeTimer && purgeTimer.unref) {
    purgeTimer.unref();
}

app.resolveAdminPassword = resolveAdminPassword;
module.exports = app;

if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`[Server] Addon Cinécloud en écoute sur le port ${PORT}`);
        console.log(`[Server] Interface web accessible sur http://localhost:${PORT}`);
        console.log(`[Server] Panneau d'administration sur http://localhost:${PORT}/admin`);
    });
}
