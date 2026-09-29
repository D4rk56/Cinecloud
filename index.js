"use strict";

const express = require("express");
const crypto = require("node:crypto");
const axios = require("axios");
const rateLimit = require("express-rate-limit");

const { loadCache, createUser, getUserByUuid, updateUserConfig, updateUserPassword } = require("./lib/db");
const { hashPassword, verifyPassword, encryptConfig, decryptConfig } = require("./lib/crypto");
const { handleManifest, handleCatalog, handleMeta, handleStream } = require("./lib/stremio");
const { handleResolve } = require("./lib/resolver");
const { startProwlarrWorker } = require("./lib/prowlarr-worker");
const { ALL_CATALOGS } = require("./lib/helpers");

// En-tête navigateur par défaut pour les requêtes directes (TMDB, Cinemeta, Torrentio)
axios.defaults.headers.common["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const app = express();
const cache = loadCache();

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

// Limitation de débit sur les routes sensibles (Protection Force Brute)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 30, // 30 requêtes par fenêtre
    standardHeaders: true,
    legacyHeaders: false,
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
        const { apiKey, password, tmdbKey, cacheMode, langPref, prowlarrKey, enabledCatalogs } = req.body;
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
            prowlarrKey: (prowlarrKey && prowlarrKey.trim()) || "off",
            enabledCatalogs: Array.isArray(enabledCatalogs) ? enabledCatalogs : (enabledCatalogs ? enabledCatalogs.split(",") : ALL_CATALOGS.map(c => c.id))
        };

        const configEncrypted = encryptConfig(configData);
        createUser(uuid, passwordHash, configEncrypted);

        const protocol = req.headers["x-forwarded-proto"] || req.protocol;
        const host = req.get("host");
        const manifestUrl = `${protocol}://${host}/${uuid}/manifest.json`;
        const stremioUrl = `stremio://${host}/${uuid}/manifest.json`;

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
        return res.json({
            success: true,
            config: {
                ...config,
                // Masquage partiel de la clé pour sécurité
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
        const { uuid, password, apiKey, newPassword, tmdbKey, cacheMode, langPref, prowlarrKey, enabledCatalogs } = req.body;
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
            prowlarrKey: prowlarrKey !== undefined ? prowlarrKey.trim() : currentConfig.prowlarrKey,
            enabledCatalogs: Array.isArray(enabledCatalogs) ? enabledCatalogs : (enabledCatalogs ? enabledCatalogs.split(",") : currentConfig.enabledCatalogs)
        };

        updateUserConfig(uuid.trim(), encryptConfig(updatedConfig));

        if (newPassword && typeof newPassword === "string" && newPassword.length >= 4) {
            updateUserPassword(uuid.trim(), hashPassword(newPassword));
        }

        console.log(`[User] Configuration mise à jour pour l'UUID ${uuid}`);
        return res.json({ success: true, message: "Réglages mis à jour avec succès !" });
    } catch (err) {
        return res.status(500).json({ error: "Erreur lors de la mise à jour des réglages." });
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

// Support optionnel pagination / filtres Stremio
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
        const protocol = req.headers["x-forwarded-proto"] || req.protocol;
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
        const protocol = req.headers["x-forwarded-proto"] || req.protocol;
        const baseUrl = `${protocol}://${req.get("host")}`;
        const legacyRef = "k_" + Buffer.from(config.apiKey).toString("base64url");
        const result = await handleStream(config, req.params.type, req.params.id, cache, baseUrl, legacyRef);
        res.json(result);
    } catch (err) {
        res.json({ streams: [] });
    }
});

// =============================================================================
// 5. INTERFACE WEB MODERNE (/ et /configure)
// =============================================================================

function renderHtmlPage(initialTab = "register") {
    return `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Nuvio Alldebrid • Addon Auto-hébergé</title>
    <style>
        :root {
            --bg: #0f172a;
            --card-bg: rgba(30, 41, 59, 0.85);
            --border: #334155;
            --accent: #38bdf8;
            --accent-hover: #0284c7;
            --text: #f8fafc;
            --text-muted: #94a3b8;
            --success: #10b981;
            --error: #ef4444;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: radial-gradient(circle at 50% 0%, #1e293b 0%, var(--bg) 80%);
            color: var(--text);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px 16px;
        }
        .container {
            width: 100%;
            max-width: 580px;
            background: var(--card-bg);
            backdrop-filter: blur(16px);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 32px 28px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.5);
        }
        .header { text-align: center; margin-bottom: 24px; }
        .header h1 { font-size: 24px; font-weight: 700; margin-bottom: 6px; letter-spacing: -0.5px; }
        .header p { font-size: 14px; color: var(--text-muted); }
        .tabs { display: flex; gap: 8px; margin-bottom: 24px; border-bottom: 1px solid var(--border); padding-bottom: 12px; }
        .tab-btn {
            flex: 1; padding: 10px; background: transparent; border: 1px solid transparent; border-radius: 8px;
            color: var(--text-muted); font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s;
        }
        .tab-btn.active { background: #334155; color: var(--text); border-color: #475569; }
        .form-group { margin-bottom: 16px; }
        label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: #cbd5e1; }
        input[type="text"], input[type="password"] {
            width: 100%; padding: 12px 14px; background: #0f172a; border: 1px solid var(--border);
            border-radius: 8px; color: var(--text); font-size: 14px; outline: none; transition: border-color 0.2s;
        }
        input:focus { border-color: var(--accent); }
        .hint { font-size: 12px; color: var(--text-muted); margin-top: 4px; }
        .checkbox-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
        .checkbox-item { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #e2e8f0; }
        .btn {
            width: 100%; padding: 13px; background: var(--accent); color: #0f172a; border: none; border-radius: 8px;
            font-size: 15px; font-weight: 700; cursor: pointer; transition: background 0.2s; margin-top: 12px;
        }
        .btn:hover { background: var(--accent-hover); }
        .result-box {
            display: none; margin-top: 20px; padding: 16px; background: #090d16; border: 1px solid #1e293b;
            border-radius: 10px; word-break: break-all;
        }
        .result-title { font-size: 13px; font-weight: 700; color: var(--accent); margin-bottom: 8px; }
        .result-value { font-family: monospace; font-size: 12px; background: #131b2e; padding: 10px; border-radius: 6px; margin-bottom: 12px; user-select: all; }
        .action-row { display: flex; gap: 8px; }
        .btn-secondary { flex: 1; padding: 10px; background: #334155; color: #fff; border: none; border-radius: 6px; font-weight: 600; cursor: pointer; text-align: center; text-decoration: none; font-size: 13px; }
        .btn-secondary:hover { background: #475569; }
        .alert { display: none; padding: 12px; border-radius: 8px; font-size: 13px; margin-bottom: 16px; }
        .alert-error { background: rgba(239, 68, 68, 0.2); border: 1px solid var(--error); color: #fca5a5; }
        .alert-success { background: rgba(16, 185, 129, 0.2); border: 1px solid var(--success); color: #6ee7b7; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>☁️ Nuvio Alldebrid</h1>
            <p>Addon Stremio & Nuvio auto-hébergé avec isolation WARP et SQLite</p>
        </div>

        <div class="tabs">
            <button class="tab-btn ${initialTab === "register" ? "active" : ""}" onclick="switchTab('register')">Nouveau Compte</button>
            <button class="tab-btn ${initialTab === "configure" ? "active" : ""}" onclick="switchTab('configure')">Gérer mes Réglages</button>
        </div>

        <div id="alertBox" class="alert"></div>

        <!-- FORMULAIRE INSCRIPTION -->
        <div id="registerTab" style="display: ${initialTab === "register" ? "block" : "none"};">
            <div class="form-group">
                <label>Clé API AllDebrid *</label>
                <input type="password" id="regApiKey" placeholder="Ex: a1b2c3d4e5f6...">
                <div class="hint">Disponible sur <a href="https://alldebrid.com/apikeys" target="_blank" style="color:var(--accent);">alldebrid.com/apikeys</a></div>
            </div>
            <div class="form-group">
                <label>Mot de passe *</label>
                <input type="password" id="regPassword" placeholder="Pour gérer vos réglages plus tard">
            </div>
            <div class="form-group">
                <label>Clé TMDB (Optionnel)</label>
                <input type="text" id="regTmdbKey" placeholder="Laisse vide pour utiliser la clé par défaut">
            </div>
            <div class="form-group">
                <label>Clé API Prowlarr (Optionnel)</label>
                <input type="text" id="regProwlarrKey" placeholder="Laisse vide ou 'off' si non utilisé">
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

            <div id="registerResult" class="result-box">
                <div class="result-title">🎉 Votre Addon est prêt !</div>
                <p style="font-size:12px; color:var(--text-muted); margin-bottom:8px;">
                    Conservez votre <strong>UUID</strong> et votre mot de passe pour modifier vos paramètres sans changer d'URL.
                </p>
                <label>Identifiant Unique (UUID) :</label>
                <div class="result-value" id="resUuid"></div>
                <label>URL du Manifeste :</label>
                <div class="result-value" id="resManifest"></div>
                <div class="action-row">
                    <a id="resStremioBtn" class="btn-secondary" style="background:#0284c7;" href="#">Installer dans Stremio</a>
                    <button class="btn-secondary" onclick="copyManifest()">Copier l'URL</button>
                </div>
            </div>
        </div>

        <!-- FORMULAIRE CONFIGURATION -->
        <div id="configureTab" style="display: ${initialTab === "configure" ? "block" : "none"};">
            <div id="loginStep">
                <div class="form-group">
                    <label>Votre UUID Addon *</label>
                    <input type="text" id="cfgUuid" placeholder="Ex: 12345678-1234-...">
                </div>
                <div class="form-group">
                    <label>Votre Mot de passe *</label>
                    <input type="password" id="cfgPassword" placeholder="Mot de passe défini à la création">
                </div>
                <button class="btn" onclick="submitLogin()">Accéder à mes réglages</button>
            </div>

            <div id="editStep" style="display:none;">
                <div class="form-group">
                    <label>Clé API AllDebrid</label>
                    <input type="text" id="editApiKey" placeholder="Laissez vide pour conserver l'actuelle">
                </div>
                <div class="form-group">
                    <label>Nouveau mot de passe (Optionnel)</label>
                    <input type="password" id="editNewPassword" placeholder="Laissez vide pour ne pas le modifier">
                </div>
                <div class="form-group">
                    <label>Clé TMDB</label>
                    <input type="text" id="editTmdbKey">
                </div>
                <div class="form-group">
                    <label>Clé Prowlarr</label>
                    <input type="text" id="editProwlarrKey">
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

        async function submitRegister() {
            hideAlert();
            const apiKey = document.getElementById('regApiKey').value.trim();
            const password = document.getElementById('regPassword').value;
            const tmdbKey = document.getElementById('regTmdbKey').value.trim();
            const prowlarrKey = document.getElementById('regProwlarrKey').value.trim();
            const enabledCatalogs = Array.from(document.querySelectorAll('.regCatCheck:checked')).map(c => c.value);

            if (!apiKey || !password) {
                return showAlert("La clé API AllDebrid et le mot de passe sont obligatoires.", true);
            }

            try {
                const res = await fetch('/api/user/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ apiKey, password, tmdbKey, prowlarrKey, enabledCatalogs })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Erreur de création");

                document.getElementById('resUuid').innerText = data.uuid;
                document.getElementById('resManifest').innerText = data.manifestUrl;
                document.getElementById('resStremioBtn').href = data.stremioUrl;
                document.getElementById('registerResult').style.display = 'block';
                showAlert("Addon généré avec succès ! Installez-le dans Stremio ci-dessous.", false);
            } catch (err) {
                showAlert(err.message, true);
            }
        }

        function copyManifest() {
            const url = document.getElementById('resManifest').innerText;
            navigator.clipboard.writeText(url).then(() => alert("URL du manifeste copiée dans le presse-papier !"));
        }

        let currentActiveUuid = null;
        let currentActivePass = null;

        async function submitLogin() {
            hideAlert();
            const uuid = document.getElementById('cfgUuid').value.trim();
            const password = document.getElementById('cfgPassword').value;

            if (!uuid || !password) {
                return showAlert("Veuillez renseigner votre UUID et mot de passe.", true);
            }

            try {
                const res = await fetch('/api/user/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ uuid, password })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Erreur de connexion");

                currentActiveUuid = uuid;
                currentActivePass = password;

                document.getElementById('editTmdbKey').value = data.config.tmdbKey || '';
                document.getElementById('editProwlarrKey').value = data.config.prowlarrKey || '';
                const cats = data.config.enabledCatalogs || [];
                document.querySelectorAll('.editCatCheck').forEach(cb => {
                    cb.checked = cats.includes(cb.value);
                });

                document.getElementById('loginStep').style.display = 'none';
                document.getElementById('editStep').style.display = 'block';
                showAlert("Identifiants validés. Vous pouvez modifier vos réglages.", false);
            } catch (err) {
                showAlert(err.message, true);
            }
        }

        async function submitUpdate() {
            hideAlert();
            const apiKey = document.getElementById('editApiKey').value.trim();
            const newPassword = document.getElementById('editNewPassword').value;
            const tmdbKey = document.getElementById('editTmdbKey').value.trim();
            const prowlarrKey = document.getElementById('editProwlarrKey').value.trim();
            const enabledCatalogs = Array.from(document.querySelectorAll('.editCatCheck:checked')).map(c => c.value);

            try {
                const res = await fetch('/api/user/update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        uuid: currentActiveUuid,
                        password: currentActivePass,
                        apiKey: apiKey || undefined,
                        newPassword: newPassword || undefined,
                        tmdbKey,
                        prowlarrKey,
                        enabledCatalogs
                    })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Erreur de mise à jour");

                if (newPassword) currentActivePass = newPassword;
                showAlert("Vos modifications ont été enregistrées avec succès !", false);
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

module.exports = app;

if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`[Server] Addon Nuvio-Alldebrid en écoute sur le port ${PORT}`);
        console.log(`[Server] Interface web accessible sur http://localhost:${PORT}`);
    });
}
