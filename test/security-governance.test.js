"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const axios = require("axios");

const { validateEnv, envSchema } = require("../lib/env");
const { secureFilePermissions } = require("../lib/crypto");
const {
    loginSchema,
    usersQuerySchema,
    userDeleteParamsSchema,
    logsQuerySchema,
    settingsSchema,
    cacheClearSchema,
    cleanupMagnetsSchema
} = require("../lib/admin-schemas");
const { sanitizeEmbedHtml, isSafeEmbedUrl, isSafeDiscordUrl, normalizeSiteSettings } = require("../lib/sanitize");

test("Task 1 - .env.example complet et validation au boot (fail-fast)", () => {
    // 1. Présence et complétude de .env.example
    const envExamplePath = path.join(__dirname, "..", ".env.example");
    assert.ok(fs.existsSync(envExamplePath), ".env.example doit exister à la racine");
    const content = fs.readFileSync(envExamplePath, "utf8");

    assert.ok(content.includes("PORT="), ".env.example doit documenter PORT");
    assert.ok(content.includes("NODE_ENV="), ".env.example doit documenter NODE_ENV");
    assert.ok(content.includes("ADMIN_PASSWORD="), ".env.example doit documenter ADMIN_PASSWORD");
    assert.ok(content.includes("APP_SECRET="), ".env.example doit documenter APP_SECRET");
    assert.ok(content.includes("WARP_PROXY="), ".env.example doit documenter WARP_PROXY");
    assert.ok(content.includes("PROWLARR_URL="), ".env.example doit documenter PROWLARR_URL");
    assert.ok(content.includes("PROWLARR_KEY="), ".env.example doit documenter PROWLARR_KEY");
    assert.ok(content.includes("ALLDEBRID_API_KEY="), ".env.example doit documenter ALLDEBRID_API_KEY");
    assert.ok(content.includes("TORBOX_API_KEY="), ".env.example doit documenter TORBOX_API_KEY");
    assert.ok(content.includes("TMDB_API_KEY="), ".env.example doit documenter TMDB_API_KEY");
    assert.ok(content.includes("CORS_ALLOWED_ORIGINS="), ".env.example doit documenter CORS_ALLOWED_ORIGINS");

    // 1bis. Workflow CI : actions compatibles Node 24 (évite « Node.js 20 is deprecated »)
    const workflowPath = path.join(__dirname, "..", ".github", "workflows", "docker-publish.yml");
    assert.ok(fs.existsSync(workflowPath), "Le workflow CI docker-publish.yml doit exister");
    const workflow = fs.readFileSync(workflowPath, "utf8");
    const deprecatedActions = [
        "actions/checkout@v4",
        "actions/setup-node@v4",
        "docker/setup-qemu-action@v3",
        "docker/setup-buildx-action@v3",
        "docker/login-action@v3",
        "docker/metadata-action@v5",
        "docker/build-push-action@v6"
    ];
    for (const deprecated of deprecatedActions) {
        assert.ok(!workflow.includes(deprecated), `Le workflow ne doit plus utiliser ${deprecated} (runtime Node 20)`);
    }
    const expectedActions = [
        "actions/checkout@v7",
        "actions/setup-node@v7",
        "docker/setup-qemu-action@v4",
        "docker/setup-buildx-action@v4",
        "docker/login-action@v4",
        "docker/metadata-action@v6",
        "docker/build-push-action@v7"
    ];
    for (const expected of expectedActions) {
        assert.ok(workflow.includes(expected), `Le workflow doit utiliser ${expected}`);
    }

    // 2. Validation au boot : cas valides via validateEnv et envSchema
    const validConfig = validateEnv({
        PORT: "3000",
        NODE_ENV: "production",
        WARP_PROXY: "http://warp:1080",
        PROWLARR_URL: "http://prowlarr:9696",
        APP_SECRET: "0123456789abcdef0123456789abcdef",
        ADMIN_PASSWORD: "monMotDePasseAdminSuperSecurise2026",
        CORS_ALLOWED_ORIGINS: "http://localhost:5173,https://admin.mondomaine.fr"
    });
    assert.ok(validConfig, "Une configuration valide doit être acceptée");
    assert.equal(envSchema.safeParse(validConfig).success, true);

    // 3. Fail-fast sur PORT invalide
    assert.throws(() => validateEnv({ PORT: "abc" }), /PORT doit être un entier valide/);
    assert.throws(() => validateEnv({ PORT: "70000" }), /PORT doit être un entier valide/);
    assert.throws(() => validateEnv({ PORT: "-5" }), /PORT doit être un entier valide/);

    // 4. Fail-fast sur URL Prowlarr invalide
    assert.throws(
        () => validateEnv({ PROWLARR_URL: "invalide-url-sans-protocole" }),
        /PROWLARR_URL doit être une URL HTTP ou HTTPS valide/
    );

    // 5. Fail-fast sur URL Proxy invalide
    assert.throws(() => validateEnv({ WARP_PROXY: "ftp://mauvais-proxy" }), /WARP_PROXY doit être une URL valide/);

    // 6. Fail-fast sur APP_SECRET trop court (< 16 caractères)
    assert.throws(() => validateEnv({ APP_SECRET: "tropcourt" }), /APP_SECRET doit comporter au minimum 16 caractères/);

    // 7. Fail-fast sur ADMIN_PASSWORD = admin123 en production (sans muter process.env)
    assert.throws(
        () => validateEnv({ NODE_ENV: "production", ADMIN_PASSWORD: "admin123" }),
        /ne doit pas utiliser le mot de passe par défaut 'admin123'/
    );

    // 8. Fail-fast sur ADMIN_PASSWORD trop court (< 8 caractères)
    assert.throws(
        () => validateEnv({ ADMIN_PASSWORD: "short" }),
        /ADMIN_PASSWORD doit comporter au moins 8 caractères/
    );

    // 9. Fail-fast sur CORS_ALLOWED_ORIGINS invalide
    assert.throws(
        () => validateEnv({ CORS_ALLOWED_ORIGINS: "ftp://invalid-origin; bad" }),
        /CORS_ALLOWED_ORIGINS doit contenir des origines/
    );
});

test("Task 2 - SECURITY.md et CONTRIBUTING.md (crédibilité & gouvernance)", () => {
    const secPath = path.join(__dirname, "..", "SECURITY.md");
    assert.ok(fs.existsSync(secPath), "SECURITY.md doit exister à la racine");
    const secContent = fs.readFileSync(secPath, "utf8");
    assert.ok(secContent.includes("Versions Supportées"), "SECURITY.md doit contenir la table des versions");
    assert.ok(secContent.includes("Signalement"), "SECURITY.md doit décrire le processus de signalement");
    assert.ok(secContent.includes("AES-256-GCM"), "SECURITY.md doit mentionner le chiffrement AES-256-GCM");
    assert.ok(secContent.includes("0600"), "SECURITY.md doit mentionner les permissions 0600");

    const contribPath = path.join(__dirname, "..", "CONTRIBUTING.md");
    assert.ok(fs.existsSync(contribPath), "CONTRIBUTING.md doit exister à la racine");
    const contribContent = fs.readFileSync(contribPath, "utf8");
    assert.ok(contribContent.includes("Prérequis"), "CONTRIBUTING.md doit lister les prérequis");
    assert.ok(contribContent.includes("Architecture"), "CONTRIBUTING.md doit décrire l'architecture");
    assert.ok(contribContent.includes("npm test"), "CONTRIBUTING.md doit documenter les tests");
    assert.ok(contribContent.includes("npm run lint"), "CONTRIBUTING.md doit documenter ESLint");
    assert.ok(contribContent.includes("Pull Request"), "CONTRIBUTING.md doit décrire le flux de PR");
});

test("Task 3 - ESLint et Prettier configurés pour Node 24", () => {
    const eslintConfigPath = path.join(__dirname, "..", "eslint.config.js");
    assert.ok(fs.existsSync(eslintConfigPath), "eslint.config.js doit exister à la racine");

    const prettierConfigPath = path.join(__dirname, "..", ".prettierrc");
    assert.ok(fs.existsSync(prettierConfigPath), ".prettierrc doit exister à la racine");

    const prettierIgnorePath = path.join(__dirname, "..", ".prettierignore");
    assert.ok(fs.existsSync(prettierIgnorePath), ".prettierignore doit exister à la racine");

    const pkgPath = path.join(__dirname, "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    assert.ok(pkg.scripts.lint, "package.json doit avoir le script lint");
    assert.ok(pkg.scripts.format, "package.json doit avoir le script format");
    assert.ok(pkg.scripts["format:check"], "package.json doit avoir le script format:check");
    assert.ok(pkg.devDependencies.eslint, "eslint doit être dans devDependencies");
    assert.ok(pkg.devDependencies.prettier, "prettier doit être dans devDependencies");
});

test("Task 4 - Permissions sécurisées 0600 sur .app_secret et .admin_password", () => {
    assert.equal(typeof secureFilePermissions, "function", "secureFilePermissions doit être une fonction exportée");

    // Test sur fichier temporaire
    const tmpFile = path.join(__dirname, "..", "data", ".test_secure_perm_" + Date.now());
    try {
        fs.writeFileSync(tmpFile, "secret_payload", { mode: 0o600, encoding: "utf8" });
        const res = secureFilePermissions(tmpFile);
        assert.equal(res, true, "secureFilePermissions doit retourner true sur un fichier existant");

        if (process.platform !== "win32") {
            const stats = fs.statSync(tmpFile);
            assert.equal(stats.mode & 0o777, 0o600, "Sur POSIX, le fichier doit être en mode 0600 strict");
        } else {
            // Test robuste Windows même si les variables USERNAME et USER sont absentes
            const origUsername = process.env.USERNAME;
            const origUser = process.env.USER;
            try {
                delete process.env.USERNAME;
                delete process.env.USER;
                const winRes = secureFilePermissions(tmpFile);
                assert.equal(winRes, true, "Doit réussir sur Windows via fallback os.userInfo()");
            } finally {
                if (origUsername) process.env.USERNAME = origUsername;
                if (origUser) process.env.USER = origUser;
            }
        }
    } finally {
        if (fs.existsSync(tmpFile)) {
            try {
                fs.unlinkSync(tmpFile);
            } catch (_) {}
        }
    }

    // Vérification des fichiers réels de secrets
    const adminPassFile = path.join(__dirname, "..", "data", ".admin_password");
    if (fs.existsSync(adminPassFile)) {
        assert.equal(secureFilePermissions(adminPassFile), true);
    }

    const appSecretFile = path.join(__dirname, "..", "data", ".app_secret");
    if (fs.existsSync(appSecretFile)) {
        assert.equal(secureFilePermissions(appSecretFile), true);
    }
});

test("Task 5 - Validation robuste des entrées sur les routes admin (/api/admin/*) via Zod", async () => {
    const app = require("../index");
    const server = app.listen(0);
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    try {
        // 1. Validation unitaire des schémas Zod
        assert.equal(loginSchema.safeParse({ password: "ok" }).success, true);
        assert.equal(loginSchema.safeParse({ password: 12345 }).success, false);
        assert.equal(loginSchema.safeParse({}).success, false);

        assert.equal(usersQuerySchema.safeParse({ sortBy: "alpha" }).success, true);
        assert.equal(usersQuerySchema.safeParse({ sortBy: "" }).success, true);
        assert.equal(usersQuerySchema.safeParse({ sortBy: "" }).data.sortBy, "newest");
        assert.equal(usersQuerySchema.safeParse({ sortBy: "invalide" }).success, false);

        assert.equal(userDeleteParamsSchema.safeParse({ uuid: "12345678-1234-1234-1234-123456789abc" }).success, true);
        assert.equal(userDeleteParamsSchema.safeParse({ uuid: "bad-uuid" }).success, false);

        assert.equal(logsQuerySchema.safeParse({ level: "ERROR", limit: 50 }).success, true);
        assert.equal(logsQuerySchema.safeParse({ level: "" }).success, true);
        assert.equal(logsQuerySchema.safeParse({ level: "info" }).data.level, "INFO");
        assert.equal(logsQuerySchema.safeParse({ level: "FATAL" }).success, false);
        assert.equal(logsQuerySchema.safeParse({ limit: 50000 }).success, false);

        assert.equal(settingsSchema.safeParse({ httpTimeoutMs: 5000 }).success, true);
        assert.equal(settingsSchema.safeParse({ httpTimeoutMs: 50 }).success, false);
        assert.equal(settingsSchema.safeParse({ unknownField: "hack" }).success, false);

        assert.equal(cacheClearSchema.safeParse({ target: "torrents" }).success, true);
        assert.equal(cacheClearSchema.safeParse({ target: "invalid_target" }).success, false);

        assert.equal(cleanupMagnetsSchema.safeParse({ apiKey: "valid_key" }).success, true);
        assert.equal(cleanupMagnetsSchema.safeParse({}).success, true);
        assert.equal(cleanupMagnetsSchema.safeParse(undefined).success, true);
        assert.equal(cleanupMagnetsSchema.safeParse({ apiKey: "" }).success, false);
        assert.equal(cleanupMagnetsSchema.safeParse({ apiKey: "a".repeat(300) }).success, false);

        // 2. Connexion admin valide pour obtenir le token
        const loginRes = await axios.post(`${base}/api/admin/login`, {
            password: process.env.ADMIN_PASSWORD
        });
        assert.equal(loginRes.status, 200);
        const adminToken = loginRes.data.token;
        const authHeaders = { "x-admin-token": adminToken };

        // 3. Test rejet 400 sur POST /api/admin/login avec type invalide
        try {
            await axios.post(`${base}/api/admin/login`, { password: 12345 });
            assert.fail("Doit lever une erreur 400 pour un type non-string");
        } catch (err) {
            assert.equal(err.response?.status, 400);
            assert.ok(err.response?.data?.error);
        }

        // 4. Test rejet 400 sur GET /api/admin/users avec query param invalide
        try {
            await axios.get(`${base}/api/admin/users?sortBy=hack_sort`, { headers: authHeaders });
            assert.fail("Doit lever une erreur 400 pour un sortBy invalide");
        } catch (err) {
            assert.equal(err.response?.status, 400);
        }

        // Test succès sur GET /api/admin/users avec query vide
        const usersEmptyRes = await axios.get(`${base}/api/admin/users?sortBy=`, { headers: authHeaders });
        assert.equal(usersEmptyRes.status, 200);

        // 5. Test rejet 400 sur DELETE /api/admin/users/:uuid avec format invalide
        try {
            await axios.delete(`${base}/api/admin/users/not-a-valid-uuid`, { headers: authHeaders });
            assert.fail("Doit lever une erreur 400 pour un UUID invalide");
        } catch (err) {
            assert.equal(err.response?.status, 400);
        }

        // 6. Test rejet 400 sur GET /api/admin/logs avec paramètres invalides
        try {
            await axios.get(`${base}/api/admin/logs?limit=-10`, { headers: authHeaders });
            assert.fail("Doit lever une erreur 400 pour une limite négative");
        } catch (err) {
            assert.equal(err.response?.status, 400);
        }

        // Test succès sur GET /api/admin/logs avec level en minuscule ou vide
        const logsRes = await axios.get(`${base}/api/admin/logs?level=info&limit=10`, { headers: authHeaders });
        assert.equal(logsRes.status, 200);

        // 7. Test rejet 400 sur POST /api/admin/settings avec timeout trop faible (< 1000ms)
        try {
            await axios.post(`${base}/api/admin/settings`, { httpTimeoutMs: 100 }, { headers: authHeaders });
            assert.fail("Doit lever une erreur 400 pour un httpTimeoutMs < 1000");
        } catch (err) {
            assert.equal(err.response?.status, 400);
        }

        // 8. Test rejet 400 sur POST /api/admin/settings avec champ inconnu
        try {
            await axios.post(`${base}/api/admin/settings`, { maliciousField: true }, { headers: authHeaders });
            assert.fail("Doit lever une erreur 400 pour un champ inconnu");
        } catch (err) {
            assert.equal(err.response?.status, 400);
        }

        // 8bis. Diagnostic : GET /api/admin/settings doit renvoyer un objet de réglages.
        // Si la base SQLite n'est pas initialisée, POST renverrait `false` → échec obscur plus bas.
        const settingsGetRes = await axios.get(`${base}/api/admin/settings`, { headers: authHeaders });
        assert.equal(settingsGetRes.status, 200);
        assert.equal(
            typeof settingsGetRes.data.httpTimeoutMs,
            "number",
            "GET /api/admin/settings doit renvoyer un objet de réglages (base SQLite initialisée)"
        );

        // 9. Test succès 200 sur POST /api/admin/settings avec données valides
        const settingsRes = await axios.post(
            `${base}/api/admin/settings`,
            { httpTimeoutMs: 11000, prowlarrTimeoutMs: 9500 },
            { headers: authHeaders }
        );
        assert.equal(settingsRes.status, 200);
        assert.equal(
            settingsRes.data.settings && settingsRes.data.settings.httpTimeoutMs,
            11000,
            "POST /api/admin/settings doit renvoyer les réglages mis à jour"
        );

        // 10. Test rejet 400 sur POST /api/admin/cache/clear avec cible invalide
        try {
            await axios.post(`${base}/api/admin/cache/clear`, { target: "corrupted_target" }, { headers: authHeaders });
            assert.fail("Doit lever une erreur 400 pour une cible de cache invalide");
        } catch (err) {
            assert.equal(err.response?.status, 400);
            assert.ok(err.response?.data?.error.includes("Cible de cache invalide"));
        }

        // 11. Test succès 200 sur POST /api/admin/cache/clear avec cible valide
        const clearRes = await axios.post(
            `${base}/api/admin/cache/clear`,
            { target: "searches" },
            { headers: authHeaders }
        );
        assert.equal(clearRes.status, 200);
        assert.equal(clearRes.data.success, true);

        // 12. Test rejet 400 sur POST /api/admin/cleanup-magnets avec clé vide
        try {
            await axios.post(`${base}/api/admin/cleanup-magnets`, { apiKey: "" }, { headers: authHeaders });
            assert.fail("Doit lever une erreur 400 pour une clé vide");
        } catch (err) {
            assert.equal(err.response?.status, 400);
        }

        // 13. Test succès sur POST /api/admin/cleanup-magnets avec corps vide (comme le bouton UI)
        const cleanupEmptyRes = await axios.post(`${base}/api/admin/cleanup-magnets`, {}, { headers: authHeaders });
        assert.equal(cleanupEmptyRes.status, 200);
    } finally {
        server.close();
    }
});

test("Assainissement - batterie XSS sur l'embed administrateur", () => {
    const payloads = [
        "<script>alert(1)</script>",
        '<script src="https://evil.tld/x.js"></script>',
        "<img src=x onerror=alert(1)>",
        '<a href="javascript:alert(1)">clic</a>',
        '<a href="&#106;avascript:alert(1)">clic</a>',
        '<a href="java&#9;script:alert(1)">clic</a>',
        '<a href="jav&#x0A;ascript:alert(1)">clic</a>',
        "<a href=&#106;avascript:alert(1)>clic</a>",
        '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">clic</a>',
        "<svg onload=alert(1)>",
        '<iframe src="https://evil.tld"></iframe>',
        '<object data="x"></object>',
        '<embed src="x">',
        '<form action="https://evil.tld"><input name="a"></form>',
        '<div style="background:url(javascript:alert(1))">x</div>',
        '<div onclick="alert(1)">x</div>',
        '<a href="https://ok.tld" onclick="alert(1)">x</a>',
        "<ScRiPt>alert(1)</ScRiPt>",
        "<img src=javascript:alert(1)>",
        '<b onmouseover="alert(1)">x</b>',
        '<a href="https://ok.tld" style="x:expression(alert(1))">x</a>',
        "<div><b>non ferme",
        '<p title="&quot;><script>alert(1)</script>">x</p>',
        '<link rel="stylesheet" href="https://evil.tld/x.css">',
        '<meta http-equiv="refresh" content="0;url=https://evil.tld">',
        '<base href="https://evil.tld/">'
    ];

    for (const payload of payloads) {
        const out = sanitizeEmbedHtml(payload);
        assert.ok(
            !/<(script|svg|iframe|object|embed|form|input|link|meta|base|style)\b/i.test(out),
            `Balise dangereuse conservée pour ${payload} → ${out}`
        );
        assert.ok(!/\son[a-z]+\s*=/i.test(out), `Gestionnaire d'événement conservé pour ${payload} → ${out}`);
        assert.ok(!/javascript\s*:/i.test(out), `Schéma javascript conservé pour ${payload} → ${out}`);
        assert.ok(!/style\s*=/i.test(out), `Attribut style conservé pour ${payload} → ${out}`);
    }

    // Cas particuliers : la balise est retirée mais le texte reste (échappé, inoffensif)
    assert.equal(sanitizeEmbedHtml("<script>alert(1)</script>"), "alert(1)");
    assert.equal(sanitizeEmbedHtml("<img src=javascript:alert(1)>"), '<img loading="lazy">');
    // Sortie équilibrée : balise laissée ouverte refermée
    assert.equal(sanitizeEmbedHtml("<div><b>texte"), "<div><b>texte</b></div>");
    // Commentaires et doctype jetés
    assert.equal(sanitizeEmbedHtml("a<!-- <script>x</script> -->b"), "ab");
    // Entrée non textuelle
    assert.equal(sanitizeEmbedHtml(null), "");
    assert.equal(sanitizeEmbedHtml(undefined), "");
    // Troncature
    assert.ok(sanitizeEmbedHtml("a".repeat(5000)).length <= 4000);
});

test("Assainissement - le contenu légitime est préservé", () => {
    const safe = sanitizeEmbedHtml(
        '<p>Bonjour <strong>monde</strong> <a href="https://exemple.tld" title="ok">lien</a><br>' +
            '<img src="https://exemple.tld/a.png" alt="image" width="120"><ul><li>un</li></ul></p>'
    );
    assert.ok(safe.includes("<strong>monde</strong>"), "strong conservé");
    assert.ok(safe.includes('href="https://exemple.tld"'), "lien https conservé");
    assert.ok(safe.includes('target="_blank"') && safe.includes('rel="noopener noreferrer nofollow"'), "lien durci");
    assert.ok(safe.includes('src="https://exemple.tld/a.png"'), "image https conservée");
    assert.ok(safe.includes('alt="image"') && safe.includes('loading="lazy"'), "attributs image conservés");
    assert.ok(safe.includes("<br>"), "br conservé");
    assert.ok(safe.includes("<ul><li>un</li></ul>"), "liste conservée");
    // Les balises interdites disparaissent mais le texte reste
    assert.equal(sanitizeEmbedHtml("<marquee>texte</marquee>"), "texte");
    // Le texte brut est échappé
    assert.equal(sanitizeEmbedHtml("1 < 2 & 3 > 2"), "1 &lt; 2 &amp; 3 &gt; 2");
});

test("Assainissement - validation des URL d'embed et du bouton Discord", () => {
    // Iframe : HTTPS uniquement
    assert.equal(isSafeEmbedUrl("https://www.youtube.com/embed/abc"), true);
    assert.equal(isSafeEmbedUrl("http://www.youtube.com/embed/abc"), false);
    assert.equal(isSafeEmbedUrl("javascript:alert(1)"), false);
    assert.equal(isSafeEmbedUrl("data:text/html,<script>1</script>"), false);
    assert.equal(isSafeEmbedUrl("file:///etc/passwd"), false);
    assert.equal(isSafeEmbedUrl(""), false);
    assert.equal(isSafeEmbedUrl("https://" + "a".repeat(600)), false);

    // Discord : HTTPS + hôte Discord uniquement
    assert.equal(isSafeDiscordUrl("https://discord.gg/abc"), true);
    assert.equal(isSafeDiscordUrl("https://discord.com/invite/abc"), true);
    assert.equal(isSafeDiscordUrl("https://discord.gg.evil.tld/abc"), false);
    assert.equal(isSafeDiscordUrl("https://evil.tld/discord.gg"), false);
    assert.equal(isSafeDiscordUrl("http://discord.gg/abc"), false);
    assert.equal(isSafeDiscordUrl("javascript:alert(1)"), false);
    assert.equal(isSafeDiscordUrl(""), false);
});

test("Assainissement - normalizeSiteSettings neutralise les valeurs invalides", () => {
    const normalized = normalizeSiteSettings({
        embedHtml: "<p>ok</p><script>alert(1)</script>",
        embedIframeUrl: "javascript:alert(1)",
        embedIframeHeight: 99999,
        discordUrl: "https://evil.tld/x",
        httpTimeoutMs: 12000
    });

    assert.equal(normalized.embedHtml, "<p>ok</p>alert(1)");
    assert.equal(normalized.embedIframeUrl, "", "iframe non HTTPS vidée");
    assert.equal(normalized.embedIframeHeight, 1200, "hauteur bornée");
    assert.equal(normalized.discordUrl, "", "hôte Discord invalide vidé");
    assert.equal(normalized.httpTimeoutMs, 12000, "les autres réglages sont intacts");

    const ok = normalizeSiteSettings({
        embedIframeUrl: "https://player.tld/embed",
        embedIframeHeight: 400,
        discordUrl: "https://discord.gg/abc"
    });
    assert.equal(ok.embedIframeUrl, "https://player.tld/embed");
    assert.equal(ok.embedIframeHeight, 400);
    assert.equal(ok.discordUrl, "https://discord.gg/abc");
});

test("Assainissement - le schéma des paramètres borne la personnalisation", () => {
    const valid = settingsSchema.safeParse({
        embedHtml: "<p>ok</p>",
        embedIframeUrl: "https://player.tld/embed",
        embedIframeHeight: 400,
        discordUrl: "https://discord.gg/abc",
        torrentioEgress: "direct"
    });
    assert.equal(valid.success, true, "Les champs de personnalisation doivent être acceptés");
    assert.equal(settingsSchema.safeParse({ torrentioEgress: "auto" }).success, true, "torrentioEgress=auto accepté");

    assert.equal(settingsSchema.safeParse({ embedHtml: "a".repeat(4001) }).success, false, "Embed trop long refusé");
    assert.equal(settingsSchema.safeParse({ embedIframeUrl: "https://x.tld/" + "a".repeat(500) }).success, false);
    assert.equal(settingsSchema.safeParse({ embedIframeHeight: 10 }).success, false, "Hauteur trop petite refusée");
    assert.equal(settingsSchema.safeParse({ embedIframeHeight: 5000 }).success, false, "Hauteur trop grande refusée");
    assert.equal(
        settingsSchema.safeParse({ torrentioEgress: "warp" }).success,
        false,
        "Valeur d'egress inconnue refusée"
    );
    assert.equal(settingsSchema.safeParse({ champInconnu: 1 }).success, false, "Schéma strict : champ inconnu refusé");
});
