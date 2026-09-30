"use strict";

const express = require("express");
const crypto = require("node:crypto");
const axios = require("axios");
const rateLimit = require("express-rate-limit");

const { loadCache, createUser, getUserByUuid, updateUserConfig, updateUserPassword, deleteUser, purgeOldCachedTorrents } = require("./lib/db");
const { hashPassword, verifyPassword, encryptConfig, decryptConfig } = require("./lib/crypto");
const { handleManifest, handleCatalog, handleMeta, handleStream } = require("./lib/stremio");
const { handleResolve } = require("./lib/resolver");
const { startProwlarrWorker, stopProwlarrWorker } = require("./lib/prowlarr-worker");
const { ALL_CATALOGS } = require("./lib/helpers");

function getRequestProtocol(req) {
    const forwarded = req.headers["x-forwarded-proto"];
    if (forwarded) {
        return (Array.isArray(forwarded) ? forwarded[0] : forwarded.split(",")[0]).trim();
    }
    return req.protocol || "http";
}

// En-tête navigateur par défaut pour les requêtes directes (TMDB, Cinemeta, Torrentio)
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
        const { apiKey, password, tmdbKey, cacheMode, langPref, prowlarrUrl, prowlarrKey, enabledCatalogs } = req.body;
        if (!apiKey || typeof apiKey !== "string" || apiKey.trim() === "") {
            return res.status(400).json({ error: "La clé API AllDebrid est requise." });
        }
        if (!password || typeof password !== "string" || password.length < 4) {
            return res.status(400).json({ error: "Un mot de passe d'au moins 4 caractères est requis pour sécuriser vos réglages." });
        }

        const uuid = crypto.randomUUID();
        const passwordHash = hashPassword(password);
        const configData = {
            apiKey: apiKey.trim(),
            tmdbKey: (tmdbKey && tmdbKey.trim()) || "default",
            cacheMode: cacheMode === "off" ? "off" : "on",
            langPref: langPref || "multi_vff,vff,vfi,multi,vf,vostfr",
            prowlarrUrl: (prowlarrUrl && prowlarrUrl.trim()) || "http://prowlarr:9696",
            prowlarrKey: (prowlarrKey && prowlarrKey.trim()) || "off",
            enabledCatalogs: Array.isArray(enabledCatalogs) ? enabledCatalogs : (enabledCatalogs ? enabledCatalogs.split(",") : ALL_CATALOGS.map(c => c.id))
        };

        const configEncrypted = encryptConfig(configData);
        createUser(uuid, passwordHash, configEncrypted);

        const protocol = getRequestProtocol(req);
        const host = req.get("host");
        const manifestUrl = `${protocol}://${host}/${uuid}/manifest.json`;
        const stremioUrl = `stremio://${host}/${uuid}/manifest.json`;

        // Réveil / redémarrage du worker Prowlarr avec les nouveaux paramètres
        stopProwlarrWorker();
        startProwlarrWorker();

        console.log(`[User] Nouvel addon créé avec succès : UUID ${uuid}`);
        return res.json({
            success: true,
            uuid,
            manifestUrl,
            stremioUrl
        });
    } catch (err) {
        console.error("[User] Erreur lors de l'enregistrement :", err.message);
        return res.status(500).json({ error: "Erreur serveur lors de la création de l'addon." });
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
                prowlarrUrl: config.prowlarrUrl || "http://prowlarr:9696",
                apiKeyPreview: config.apiKey ? `${config.apiKey.slice(0, 4)}...${config.apiKey.slice(-4)}` : ""
            }
        });
    } catch (err) {
        return res.status(500).json({ error: "Erreur lors de la vérification des identifiants." });
    }
});

// Mise à jour de la configuration existante (sans changer l'URL d'installation !)
app.post("/api/user/update", authLimiter, (req, res) => {
    try {
        const { uuid, password, apiKey, newPassword, tmdbKey, cacheMode, langPref, prowlarrUrl, prowlarrKey, enabledCatalogs } = req.body;
        if (!uuid || !password) {
            return res.status(400).json({ error: "UUID et mot de passe requis." });
        }

        const user = getUserByUuid(uuid.trim());
        if (!user || !verifyPassword(password, user.passwordHash)) {
            return res.status(401).json({ error: "UUID ou mot de passe incorrect." });
        }

        const currentConfig = decryptConfig(user.configEncrypted);
        const updatedConfig = {
            apiKey: (apiKey && apiKey.trim()) || currentConfig.apiKey,
            tmdbKey: tmdbKey !== undefined ? tmdbKey.trim() : currentConfig.tmdbKey,
            cacheMode: cacheMode === "off" ? "off" : "on",
            langPref: langPref || currentConfig.langPref,
            prowlarrUrl: (prowlarrUrl && prowlarrUrl.trim()) || currentConfig.prowlarrUrl || "http://prowlarr:9696",
            prowlarrKey: prowlarrKey !== undefined ? prowlarrKey.trim() : currentConfig.prowlarrKey,
            enabledCatalogs: Array.isArray(enabledCatalogs) ? enabledCatalogs : (enabledCatalogs ? enabledCatalogs.split(",") : currentConfig.enabledCatalogs)
        };

        updateUserConfig(uuid.trim(), encryptConfig(updatedConfig));

        if (newPassword && typeof newPassword === "string" && newPassword.length >= 4) {
            updateUserPassword(uuid.trim(), hashPassword(newPassword));
        }

        // Réveil / redémarrage du worker Prowlarr avec les paramètres mis à jour
        stopProwlarrWorker();
        startProwlarrWorker();

        console.log(`[User] Configuration mise à jour pour l'UUID ${uuid}`);
        return res.json({ success: true, message: "Réglages mis à jour avec succès !" });
    } catch (err) {
        return res.status(500).json({ error: "Erreur lors de la mise à jour des réglages." });
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

// =============================================================================
// 2. ENDPOINT DE RÉSOLUTION LAZY (VALIDATION & FAILOVER INSTANTANÉ)
// =============================================================================
app.get("/resolve/:userRef/:imdbId/:fileRef", handleResolve);

// =============================================================================
// 3. ROUTES STREMIO SÉCURISÉES (FORMAT MODERNE /:uuid/*)
// =============================================================================

app.get("/:uuid/manifest.json", (req, res) => {
    const config = getUserConfig(req.params.uuid);
    if (!config) return res.status(404).json({ error: "Addon introuvable pour cet identifiant." });
    res.json(handleManifest(config));
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
        const result = await handleCatalog(config, req.params.type, req.params.id, cache);
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
// 4. RÉTRO-COMPATIBILITÉ POUR LES ANCIENNES URLS (6 PARAMÈTRES)
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
    res.json(handleManifest(config));
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
        const result = await handleCatalog(config, req.params.type, req.params.id, cache);
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
// 5. INTERFACE WEB OPTIMISÉE • "CinéCloud FR" (/ et /configure)
// =============================================================================

function renderHtmlPage(initialTab = "register") {
    return `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CinéCloud FR • Addon AllDebrid Stremio & Nuvio</title>
    <style>
        :root {
            --bg: #090d16;
            --card-bg: rgba(22, 30, 49, 0.88);
            --border: #2a374e;
            --accent: #38bdf8;
            --accent-hover: #0284c7;
            --text: #f8fafc;
            --text-muted: #94a3b8;
            --success: #10b981;
            --danger: #ef4444;
            --danger-hover: #dc2626;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: radial-gradient(circle at 50% 0%, #172554 0%, var(--bg) 80%);
            color: var(--text);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px 16px;
        }
        .container {
            width: 100%;
            max-width: 620px;
            background: var(--card-bg);
            backdrop-filter: blur(20px);
            border: 1px solid var(--border);
            border-radius: 20px;
            padding: 36px 32px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
        }
        .brand-header {
            text-align: center;
            margin-bottom: 28px;
        }
        .logo-wrapper {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 72px;
            height: 72px;
            border-radius: 20px;
            background: linear-gradient(135deg, #0284c7 0%, #38bdf8 100%);
            box-shadow: 0 10px 25px rgba(56, 189, 248, 0.4);
            margin-bottom: 14px;
        }
        .logo-svg {
            width: 44px;
            height: 44px;
            fill: #ffffff;
        }
        .brand-title {
            font-size: 28px;
            font-weight: 800;
            letter-spacing: -0.5px;
            background: linear-gradient(to right, #ffffff, #93c5fd);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 4px;
        }
        .brand-subtitle {
            font-size: 14px;
            color: var(--text-muted);
        }
        .tabs {
            display: flex;
            gap: 10px;
            margin-bottom: 24px;
            background: #0f172a;
            padding: 5px;
            border-radius: 12px;
            border: 1px solid var(--border);
        }
        .tab-btn {
            flex: 1;
            padding: 11px;
            background: transparent;
            border: none;
            border-radius: 8px;
            color: var(--text-muted);
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
        }
        .tab-btn.active {
            background: #1e293b;
            color: var(--text);
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }
        .form-group {
            margin-bottom: 18px;
        }
        label {
            display: block;
            font-size: 13px;
            font-weight: 600;
            margin-bottom: 7px;
            color: #cbd5e1;
        }
        input[type="text"], input[type="password"], select.form-select {
            width: 100%;
            padding: 13px 15px;
            background: #090d16;
            border: 1px solid var(--border);
            border-radius: 10px;
            color: var(--text);
            font-size: 14px;
            outline: none;
            transition: border-color 0.2s, box-shadow 0.2s;
        }
        select.form-select option {
            background: #0f172a;
            color: var(--text);
        }
        input:focus {
            border-color: var(--accent);
            box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.15);
        }
        .hint {
            font-size: 12px;
            color: var(--text-muted);
            margin-top: 5px;
        }
        .checkbox-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            margin-top: 8px;
        }
        .checkbox-item {
            display: flex;
            align-items: center;
            gap: 9px;
            font-size: 13px;
            color: #e2e8f0;
            background: #0f172a;
            padding: 9px 12px;
            border-radius: 8px;
            border: 1px solid #1e293b;
            cursor: pointer;
            transition: border-color 0.2s;
        }
        .checkbox-item:hover {
            border-color: #3b82f6;
        }
        .btn {
            width: 100%;
            padding: 14px;
            background: var(--accent);
            color: #090d16;
            border: none;
            border-radius: 10px;
            font-size: 15px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.2s;
            margin-top: 8px;
        }
        .btn:hover {
            background: var(--accent-hover);
            color: #ffffff;
        }
        .btn-danger {
            background: rgba(239, 68, 68, 0.15);
            color: #fca5a5;
            border: 1px solid rgba(239, 68, 68, 0.4);
            margin-top: 14px;
        }
        .btn-danger:hover {
            background: var(--danger);
            color: #ffffff;
        }
        .install-card {
            background: linear-gradient(145deg, #101b33 0%, #0d1527 100%);
            border: 1px solid #2563eb;
            border-radius: 14px;
            padding: 20px;
            margin-bottom: 24px;
            box-shadow: 0 10px 30px rgba(37, 99, 235, 0.15);
        }
        .install-badge {
            display: inline-block;
            background: rgba(16, 185, 129, 0.2);
            color: #6ee7b7;
            font-size: 12px;
            font-weight: 700;
            padding: 4px 10px;
            border-radius: 6px;
            margin-bottom: 12px;
        }
        .url-box {
            font-family: monospace;
            font-size: 12px;
            background: #090d16;
            border: 1px solid var(--border);
            padding: 11px;
            border-radius: 8px;
            color: #7dd3fc;
            word-break: break-all;
            margin-bottom: 14px;
            user-select: all;
        }
        .action-row {
            display: flex;
            gap: 10px;
        }
        .btn-secondary {
            flex: 1;
            padding: 11px;
            background: #1e293b;
            color: #ffffff;
            border: 1px solid var(--border);
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            text-align: center;
            text-decoration: none;
            font-size: 13px;
            transition: all 0.2s;
        }
        .btn-secondary:hover {
            background: #334155;
        }
        .alert {
            display: none;
            padding: 13px 16px;
            border-radius: 10px;
            font-size: 13px;
            margin-bottom: 18px;
        }
        .alert-error {
            background: rgba(239, 68, 68, 0.2);
            border: 1px solid var(--danger);
            color: #fca5a5;
        }
        .alert-success {
            background: rgba(16, 185, 129, 0.2);
            border: 1px solid var(--success);
            color: #6ee7b7;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="brand-header">
            <div class="logo-wrapper">
                <svg class="logo-svg" viewBox="0 0 24 24">
                    <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM10 16.5v-7l6 3.5-6 3.5z"/>
                </svg>
            </div>
            <div class="brand-title">CinéCloud FR</div>
            <div class="brand-subtitle">Addon AllDebrid & Stremio / Nuvio Haute Performance</div>
        </div>

        <div class="tabs">
            <button class="tab-btn ${initialTab === "register" ? "active" : ""}" onclick="switchTab('register')">Nouveau Compte</button>
            <button class="tab-btn ${initialTab === "configure" ? "active" : ""}" onclick="switchTab('configure')">Gérer mes Réglages</button>
        </div>

        <div id="alertBox" class="alert"></div>

        <!-- TAB 1 : NOUVEAU COMPTE -->
        <div id="registerTab" style="display: ${initialTab === "register" ? "block" : "none"};">
            <div class="form-group">
                <label>Clé API AllDebrid *</label>
                <input type="password" id="regApiKey" placeholder="Ex: a1b2c3d4e5f6...">
                <div class="hint">Récupérez votre clé sur <a href="https://alldebrid.com/apikeys" target="_blank" style="color:var(--accent);">alldebrid.com/apikeys</a></div>
            </div>
            <div class="form-group">
                <label>Mot de passe *</label>
                <input type="password" id="regPassword" placeholder="Minimum 4 caractères pour sécuriser vos réglages">
            </div>
            <div class="form-group">
                <label>Clé TMDB (Optionnel)</label>
                <input type="text" id="regTmdbKey" placeholder="Laissez vide pour utiliser la clé par défaut">
            </div>
            <div class="form-group">
                <label>URL Prowlarr (Optionnel)</label>
                <input type="text" id="regProwlarrUrl" value="http://prowlarr:9696" placeholder="http://prowlarr:9696">
            </div>
            <div class="form-group">
                <label>Clé API Prowlarr (Optionnel)</label>
                <input type="text" id="regProwlarrKey" placeholder="Laissez vide si non utilisé">
            </div>
            <div class="form-group">
                <label>Mode de Cache Torrent</label>
                <select id="regCacheMode" class="form-select">
                    <option value="on" selected>Activé (Prowlarr, Torrentio & Cache local)</option>
                    <option value="off">Désactivé (Uniquement mes fichiers cloud)</option>
                </select>
                <div class="hint">Active le scraping et la disponibilité des torrents instantanés.</div>
            </div>
            <div class="form-group">
                <label>Priorité Linguistique (Ordre des flux)</label>
                <input type="text" id="regLangPref" value="multi_vff,vff,vfi,multi,vf,vostfr" placeholder="multi_vff,vff,vfi,multi,vf,vostfr">
                <div class="hint">Ordre de préférence séparé par des virgules (ex: multi_vff,vff,vfi,multi,vf,vostfr)</div>
            </div>
            <div class="form-group">
                <label>Catalogues à activer :</label>
                <div class="checkbox-grid">
                    ${ALL_CATALOGS.map(c => `
                        <label class="checkbox-item">
                            <input type="checkbox" class="regCatCheck" value="${c.id}" checked>
                            ${c.name}
                        </label>
                    `).join("")}
                </div>
            </div>
            <button class="btn" onclick="submitRegister()">Générer mon Addon Stremio</button>

            <div id="registerResult" style="display:none; margin-top:24px;">
                <div class="install-card">
                    <div class="install-badge">✅ Addon généré avec succès !</div>
                    <label style="color:#94a3b8; font-size:12px;">Identifiant Unique (UUID) :</label>
                    <div class="url-box" id="resUuid"></div>
                    <label style="color:#94a3b8; font-size:12px;">URL d'Installation Stremio :</label>
                    <div class="url-box" id="resManifest"></div>
                    <div class="action-row">
                        <a id="resStremioBtn" class="btn-secondary" style="background:#0284c7; border-color:#0284c7;" href="#">Installer dans Stremio</a>
                        <button class="btn-secondary" onclick="copyText('resManifest')">Copier l'URL</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- TAB 2 : GÉRER MES RÉGLAGES -->
        <div id="configureTab" style="display: ${initialTab === "configure" ? "block" : "none"};">
            <div id="loginStep">
                <div class="form-group">
                    <label>Votre UUID Addon *</label>
                    <input type="text" id="cfgUuid" placeholder="Ex: 12345678-1234-...">
                </div>
                <div class="form-group">
                    <label>Votre Mot de passe *</label>
                    <input type="password" id="cfgPassword" placeholder="Mot de passe choisi à la création">
                </div>
                <button class="btn" onclick="submitLogin()">Accéder à mes réglages</button>
            </div>

            <div id="editStep" style="display:none;">
                <!-- CARTE D'INSTALLATION RECHARGÉE -->
                <div class="install-card">
                    <div class="install-badge">⚡ Addon Actif & Connecté</div>
                    <label style="color:#94a3b8; font-size:12px;">URL d'Installation Stremio :</label>
                    <div class="url-box" id="cfgManifestDisplay"></div>
                    <div class="action-row">
                        <a id="cfgStremioBtn" class="btn-secondary" style="background:#0284c7; border-color:#0284c7;" href="#">Installer dans Stremio</a>
                        <button class="btn-secondary" onclick="copyText('cfgManifestDisplay')">Copier l'URL</button>
                    </div>
                </div>

                <div class="form-group">
                    <label>Clé API AllDebrid</label>
                    <input type="text" id="editApiKey" placeholder="Laissez vide pour conserver l'actuelle">
                </div>
                <div class="form-group">
                    <label>Nouveau mot de passe (Optionnel)</label>
                    <input type="password" id="editNewPassword" placeholder="Laissez vide pour ne pas changer">
                </div>
                <div class="form-group">
                    <label>Clé TMDB</label>
                    <input type="text" id="editTmdbKey">
                </div>
                <div class="form-group">
                    <label>URL Prowlarr</label>
                    <input type="text" id="editProwlarrUrl" placeholder="http://prowlarr:9696">
                </div>
                <div class="form-group">
                    <label>Clé API Prowlarr</label>
                    <input type="text" id="editProwlarrKey">
                </div>
                <div class="form-group">
                    <label>Mode de Cache Torrent</label>
                    <select id="editCacheMode" class="form-select">
                        <option value="on">Activé (Prowlarr, Torrentio & Cache local)</option>
                        <option value="off">Désactivé (Uniquement mes fichiers cloud)</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Priorité Linguistique</label>
                    <input type="text" id="editLangPref" placeholder="multi_vff,vff,vfi,multi,vf,vostfr">
                    <div class="hint">Ordre de préférence séparé par des virgules</div>
                </div>
                <div class="form-group">
                    <label>Catalogues actifs :</label>
                    <div class="checkbox-grid">
                        ${ALL_CATALOGS.map(c => `
                            <label class="checkbox-item">
                                <input type="checkbox" class="editCatCheck" value="${c.id}">
                                ${c.name}
                            </label>
                        `).join("")}
                    </div>
                </div>
                <button class="btn" onclick="submitUpdate()">Enregistrer les modifications</button>
                <button class="btn btn-danger" onclick="submitDelete()">Supprimer mon compte & Réinitialiser</button>
            </div>
        </div>
    </div>

    <script>
        function switchTab(tab) {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            if (tab === 'register') {
                document.querySelector('.tab-btn:first-child').classList.add('active');
                document.getElementById('registerTab').style.display = 'block';
                document.getElementById('configureTab').style.display = 'none';
            } else {
                document.querySelector('.tab-btn:last-child').classList.add('active');
                document.getElementById('registerTab').style.display = 'none';
                document.getElementById('configureTab').style.display = 'block';
            }
            hideAlert();
        }

        function showAlert(msg, isError) {
            const b = document.getElementById('alertBox');
            b.innerText = msg;
            b.className = 'alert ' + (isError ? 'alert-error' : 'alert-success');
            b.style.display = 'block';
        }

        function hideAlert() {
            document.getElementById('alertBox').style.display = 'none';
        }

        function copyText(elemId) {
            const text = document.getElementById(elemId).innerText;
            navigator.clipboard.writeText(text).then(() => alert("URL copiée dans le presse-papier !"));
        }

        let activeUuid = null;
        let activePass = null;

        async function submitRegister() {
            hideAlert();
            const apiKey = document.getElementById('regApiKey').value.trim();
            const password = document.getElementById('regPassword').value;
            const tmdbKey = document.getElementById('regTmdbKey').value.trim();
            const cacheMode = document.getElementById('regCacheMode').value;
            const langPref = document.getElementById('regLangPref').value.trim();
            const prowlarrUrl = document.getElementById('regProwlarrUrl').value.trim();
            const prowlarrKey = document.getElementById('regProwlarrKey').value.trim();
            const enabledCatalogs = Array.from(document.querySelectorAll('.regCatCheck:checked')).map(c => c.value);

            if (!apiKey || !password) {
                return showAlert("La clé API AllDebrid et le mot de passe sont obligatoires.", true);
            }

            try {
                const res = await fetch('/api/user/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ apiKey, password, tmdbKey, cacheMode, langPref, prowlarrUrl, prowlarrKey, enabledCatalogs })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Erreur de création");

                document.getElementById('resUuid').innerText = data.uuid;
                document.getElementById('resManifest').innerText = data.manifestUrl;
                document.getElementById('resStremioBtn').href = data.stremioUrl;
                document.getElementById('registerResult').style.display = 'block';
                showAlert("Addon CinéCloud FR généré avec succès ! Conservez votre UUID.", false);
            } catch (err) {
                showAlert(err.message, true);
            }
        }

        async function submitLogin() {
            hideAlert();
            const uuid = document.getElementById('cfgUuid').value.trim();
            const password = document.getElementById('cfgPassword').value;

            if (!uuid || !password) {
                return showAlert("Veuillez renseigner votre UUID et votre mot de passe.", true);
            }

            try {
                const res = await fetch('/api/user/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ uuid, password })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Erreur de connexion");

                activeUuid = uuid;
                activePass = password;

                // Affichage de la carte d'installation dans la vue de gestion
                document.getElementById('cfgManifestDisplay').innerText = data.manifestUrl;
                document.getElementById('cfgStremioBtn').href = data.stremioUrl;

                document.getElementById('editTmdbKey').value = data.config.tmdbKey || '';
                document.getElementById('editCacheMode').value = data.config.cacheMode || 'on';
                document.getElementById('editLangPref').value = data.config.langPref || 'multi_vff,vff,vfi,multi,vf,vostfr';
                document.getElementById('editProwlarrUrl').value = data.config.prowlarrUrl || 'http://prowlarr:9696';
                document.getElementById('editProwlarrKey').value = (data.config.prowlarrKey && data.config.prowlarrKey !== 'off') ? data.config.prowlarrKey : '';

                const cats = data.config.enabledCatalogs || [];
                document.querySelectorAll('.editCatCheck').forEach(cb => {
                    cb.checked = cats.includes(cb.value);
                });

                document.getElementById('loginStep').style.display = 'none';
                document.getElementById('editStep').style.display = 'block';
                showAlert("Connexion réussie. Vos réglages et liens d'installation sont disponibles ci-dessous.", false);
            } catch (err) {
                showAlert(err.message, true);
            }
        }

        async function submitUpdate() {
            hideAlert();
            const apiKey = document.getElementById('editApiKey').value.trim();
            const newPassword = document.getElementById('editNewPassword').value;
            const tmdbKey = document.getElementById('editTmdbKey').value.trim();
            const cacheMode = document.getElementById('editCacheMode').value;
            const langPref = document.getElementById('editLangPref').value.trim();
            const prowlarrUrl = document.getElementById('editProwlarrUrl').value.trim();
            const prowlarrKey = document.getElementById('editProwlarrKey').value.trim();
            const enabledCatalogs = Array.from(document.querySelectorAll('.editCatCheck:checked')).map(c => c.value);

            try {
                const res = await fetch('/api/user/update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        uuid: activeUuid,
                        password: activePass,
                        apiKey: apiKey || undefined,
                        newPassword: newPassword || undefined,
                        tmdbKey,
                        cacheMode,
                        langPref,
                        prowlarrUrl,
                        prowlarrKey,
                        enabledCatalogs
                    })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Erreur de mise à jour");

                if (newPassword) activePass = newPassword;
                showAlert("Modifications enregistrées avec succès !", false);
            } catch (err) {
                showAlert(err.message, true);
            }
        }

        async function submitDelete() {
            if (!confirm("⚠️ Êtes-vous sûr de vouloir supprimer définitivement votre compte et votre configuration ? Votre addon cessera de fonctionner.")) {
                return;
            }

            try {
                const res = await fetch('/api/user/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ uuid: activeUuid, password: activePass })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Erreur lors de la suppression");

                alert("Compte et configuration supprimés avec succès.");
                window.location.reload();
            } catch (err) {
                showAlert(err.message, true);
            }
        }
    </script>
</body>
</html>`;
}

app.get("/", (req, res) => {
    res.send(renderHtmlPage("register"));
});

app.get("/configure", (req, res) => {
    res.send(renderHtmlPage("configure"));
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
    });
}
