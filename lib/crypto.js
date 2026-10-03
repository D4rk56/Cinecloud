"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DATA_DIR = path.join(__dirname, "..", "data");
const SECRET_FILE = path.join(DATA_DIR, ".app_secret");

/**
 * Vérifie et renforce les permissions d'un fichier sensible (0600 sur POSIX, restriction ACL sur Windows).
 * @param {string} filePath
 * @returns {boolean} true si les permissions ont été vérifiées/appliquées avec succès
 */
function secureFilePermissions(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return false;
    try {
        if (process.platform !== "win32") {
            // Mode POSIX (Linux, Docker, macOS) : chmod 0600 (lecture et écriture réservées au propriétaire)
            fs.chmodSync(filePath, 0o600);
            const stats = fs.statSync(filePath);
            const mode = stats.mode & 0o777;
            if (mode !== 0o600) {
                console.warn(
                    `[Security] Avertissement : Le mode de ${path.basename(filePath)} est 0${mode.toString(8)}, attendu 0600.`
                );
            }
        } else {
            // Mode Windows : chmod 0600 + verrouillage ACL utilisateur via icacls
            try {
                fs.chmodSync(filePath, 0o600);
            } catch (_) {}
            try {
                const os = require("node:os");
                let username = process.env.USERNAME || process.env.USER;
                if (!username) {
                    try {
                        username = os.userInfo().username;
                    } catch (_) {}
                }
                if (username) {
                    const { execFileSync } = require("node:child_process");
                    execFileSync("icacls", [filePath, "/inheritance:r", "/grant:r", `${username}:(R,W)`], {
                        stdio: "ignore",
                        windowsHide: true,
                        timeout: 3000
                    });
                }
            } catch (_) {}
        }
        return true;
    } catch (err) {
        console.warn(`[Security] Erreur lors du renforcement des permissions sur ${filePath}: ${err.message}`);
        return false;
    }
}

// Obtient la clé secrète de 32 octets (depuis la variable d'environnement ou fichier persistant)
function getSecretKey() {
    let secret = process.env.APP_SECRET;
    if (!secret || secret.trim() === "") {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
        }
        if (fs.existsSync(SECRET_FILE)) {
            secureFilePermissions(SECRET_FILE);
            secret = fs.readFileSync(SECRET_FILE, "utf8").trim();
        } else {
            secret = crypto.randomBytes(32).toString("hex");
            try {
                fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600, encoding: "utf8" });
                secureFilePermissions(SECRET_FILE);
            } catch (err) {
                console.warn(
                    "[Crypto] Impossible de sauvegarder .app_secret, utilisation d'une clé volatile:",
                    err.message
                );
            }
        }
    }
    return crypto.createHash("sha256").update(secret).digest();
}

const secretKey = getSecretKey();

/**
 * Hache un mot de passe en utilisant l'API native crypto.scrypt
 * @param {string} password
 * @returns {string} salt:hashHex
 */
function hashPassword(password) {
    if (!password || typeof password !== "string") {
        throw new Error("Mot de passe invalide pour le hachage.");
    }
    const salt = crypto.randomBytes(16).toString("hex");
    const derivedKey = crypto.scryptSync(password, salt, 64);
    return `${salt}:${derivedKey.toString("hex")}`;
}

/**
 * Vérifie un mot de passe contre son hash stocké en base
 * @param {string} password
 * @param {string} storedHash
 * @returns {boolean}
 */
function verifyPassword(password, storedHash) {
    if (!password || !storedHash || typeof storedHash !== "string") {
        return false;
    }
    const parts = storedHash.split(":");
    if (parts.length !== 2) return false;
    const [salt, keyHex] = parts;
    const keyBuf = Buffer.from(keyHex, "hex");
    const derivedKey = crypto.scryptSync(password, salt, keyBuf.length);
    if (derivedKey.length !== keyBuf.length) return false;
    return crypto.timingSafeEqual(derivedKey, keyBuf);
}

/**
 * Chiffre un objet JSON avec AES-256-GCM
 * @param {object} configObj
 * @returns {string} iv:authTag:ciphertext
 */
function encryptConfig(configObj) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", secretKey, iv);
    const jsonStr = JSON.stringify(configObj);
    let encrypted = cipher.update(jsonStr, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");
    return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Déchiffre une configuration chiffrée avec AES-256-GCM
 * @param {string} encryptedStr
 * @returns {object}
 */
function decryptConfig(encryptedStr) {
    if (!encryptedStr || typeof encryptedStr !== "string") {
        throw new Error("Donnée chiffrée manquante ou invalide.");
    }
    const parts = encryptedStr.split(":");
    if (parts.length !== 3) {
        throw new Error("Format de configuration chiffrée corrompu.");
    }
    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", secretKey, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return JSON.parse(decrypted);
}

module.exports = {
    hashPassword,
    verifyPassword,
    encryptConfig,
    decryptConfig,
    secureFilePermissions
};
