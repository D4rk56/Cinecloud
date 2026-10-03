"use strict";

const { z } = require("zod");

const envSchema = z
    .object({
        PORT: z
            .string()
            .optional()
            .refine(
                val => {
                    if (!val || val.trim() === "") return true;
                    const n = Number(val);
                    return Number.isInteger(n) && n >= 1 && n <= 65535;
                },
                { message: "PORT doit être un entier valide compris entre 1 et 65535." }
            ),
        NODE_ENV: z.string().optional(),
        ADMIN_PASSWORD: z
            .string()
            .optional()
            .refine(
                val => {
                    if (!val || val.trim() === "") return true;
                    return val.trim().length >= 8;
                },
                {
                    message: "ADMIN_PASSWORD doit comporter au moins 8 caractères."
                }
            ),
        APP_SECRET: z
            .string()
            .optional()
            .refine(
                val => {
                    if (!val || val.trim() === "") return true;
                    return val.trim().length >= 16;
                },
                { message: "APP_SECRET doit comporter au minimum 16 caractères pour garantir la sécurité AES-256." }
            ),
        WARP_PROXY: z
            .string()
            .optional()
            .refine(
                val => {
                    if (!val || val.trim() === "") return true;
                    try {
                        const u = new URL(val);
                        return ["http:", "https:", "socks:", "socks4:", "socks5:", "socks5h:"].includes(u.protocol);
                    } catch {
                        return false;
                    }
                },
                {
                    message: "WARP_PROXY doit être une URL valide (ex: http://warp:1080 ou socks5h://warp:1080)."
                }
            ),
        HTTP_PROXY: z
            .string()
            .optional()
            .refine(
                val => {
                    if (!val || val.trim() === "") return true;
                    try {
                        const u = new URL(val);
                        return ["http:", "https:", "socks:", "socks4:", "socks5:", "socks5h:"].includes(u.protocol);
                    } catch {
                        return false;
                    }
                },
                { message: "HTTP_PROXY doit être une URL valide." }
            ),
        HTTPS_PROXY: z
            .string()
            .optional()
            .refine(
                val => {
                    if (!val || val.trim() === "") return true;
                    try {
                        const u = new URL(val);
                        return ["http:", "https:", "socks:", "socks4:", "socks5:", "socks5h:"].includes(u.protocol);
                    } catch {
                        return false;
                    }
                },
                { message: "HTTPS_PROXY doit être une URL valide." }
            ),
        PROWLARR_URL: z
            .string()
            .optional()
            .refine(
                val => {
                    if (!val || val.trim() === "") return true;
                    try {
                        const u = new URL(val);
                        return ["http:", "https:"].includes(u.protocol);
                    } catch {
                        return false;
                    }
                },
                { message: "PROWLARR_URL doit être une URL HTTP ou HTTPS valide (ex: http://prowlarr:9696)." }
            ),
        PROWLARR_KEY: z.string().optional(),
        ALLDEBRID_API_KEY: z.string().optional(),
        TORBOX_API_KEY: z.string().optional(),
        TMDB_KEY: z.string().optional(),
        TMDB_API_KEY: z.string().optional(),
        CORS_ALLOWED_ORIGINS: z
            .string()
            .optional()
            .refine(
                val => {
                    if (!val || val.trim() === "") return true;
                    const origins = val
                        .split(",")
                        .map(s => s.trim())
                        .filter(Boolean);
                    return origins.every(o => {
                        try {
                            const testUrl = o.includes("://") ? o : `http://${o}`;
                            const u = new URL(testUrl);
                            return ["http:", "https:"].includes(u.protocol) && Boolean(u.hostname);
                        } catch {
                            return false;
                        }
                    });
                },
                {
                    message:
                        "CORS_ALLOWED_ORIGINS doit contenir des origines ou noms d'hôtes valides séparés par des virgules."
                }
            )
    })
    .superRefine((data, ctx) => {
        const effectiveNodeEnv = data.NODE_ENV || (typeof process !== "undefined" && process.env.NODE_ENV) || "";
        const isProduction = effectiveNodeEnv === "production" || effectiveNodeEnv === "";
        if (data.ADMIN_PASSWORD && data.ADMIN_PASSWORD.trim() === "admin123" && isProduction) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["ADMIN_PASSWORD"],
                message:
                    "ADMIN_PASSWORD doit comporter au moins 8 caractères et ne doit pas utiliser le mot de passe par défaut 'admin123' en production."
            });
        }
    });

/**
 * Valide les variables d'environnement au démarrage (Fail-Fast).
 * Lève une exception immédiate si une variable critique est invalide ou corrompue.
 * @param {object} [env=process.env]
 * @returns {object} Variables validées
 */
function validateEnv(env = process.env) {
    const result = envSchema.safeParse(env);
    if (!result.success) {
        const issues = result.error.issues || result.error.errors || [];
        const details = issues.map(i => ` - ${i.path.join(".") || "ENV"}: ${i.message}`).join("\n");
        const errMessage = `[Config] Erreur critique de configuration environnement au démarrage :\n${details}`;
        throw new Error(errMessage);
    }
    return result.data;
}

module.exports = {
    envSchema,
    validateEnv
};
