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

        // 9. Test succès 200 sur POST /api/admin/settings avec données valides
        const settingsRes = await axios.post(
            `${base}/api/admin/settings`,
            { httpTimeoutMs: 11000, prowlarrTimeoutMs: 9500 },
            { headers: authHeaders }
        );
        assert.equal(settingsRes.status, 200);
        assert.equal(settingsRes.data.settings.httpTimeoutMs, 11000);

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
