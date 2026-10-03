"use strict";

const { z } = require("zod");

// Schéma pour la connexion administrateur
const loginSchema = z.object({
    password: z.string({
        required_error: "Mot de passe administrateur requis.",
        invalid_type_error: "Le mot de passe doit être une chaîne de caractères."
    })
});

// Schéma pour la liste des utilisateurs
const usersQuerySchema = z.object({
    sortBy: z
        .enum(["newest", "oldest", "alpha", "last_active"], {
            message: "Option de tri invalide. Valeurs acceptées : newest, oldest, alpha, last_active."
        })
        .optional()
        .default("newest")
});

// Schéma pour la suppression d'un utilisateur par UUID
const userDeleteParamsSchema = z.object({
    uuid: z.string({ required_error: "UUID utilisateur requis." }).regex(/^[a-f0-9\-]{36}$/i, "Format UUID invalide.")
});

// Schéma pour la consultation des journaux d'activité (logs)
const logsQuerySchema = z.object({
    level: z
        .enum(["ALL", "INFO", "WARN", "ERROR"], {
            message: "Niveau de log invalide. Valeurs acceptées : ALL, INFO, WARN, ERROR."
        })
        .optional(),
    limit: z.coerce
        .number({ invalid_type_error: "La limite doit être un nombre." })
        .int("La limite doit être un entier.")
        .min(1, "La limite doit être d'au moins 1.")
        .max(1000, "La limite ne peut excéder 1000.")
        .optional()
        .default(150),
    search: z.string().max(200, "Le terme de recherche ne peut excéder 200 caractères.").optional()
});

// Schéma pour la mise à jour des paramètres système
const settingsSchema = z
    .object({
        httpTimeoutMs: z.coerce
            .number({ invalid_type_error: "httpTimeoutMs doit être un nombre." })
            .int()
            .min(1000, "Le timeout HTTP doit être d'au moins 1000 ms.")
            .max(60000, "Le timeout HTTP ne peut dépasser 60000 ms.")
            .optional(),
        prowlarrTimeoutMs: z.coerce
            .number({ invalid_type_error: "prowlarrTimeoutMs doit être un nombre." })
            .int()
            .min(1000, "Le timeout Prowlarr doit être d'au moins 1000 ms.")
            .max(60000, "Le timeout Prowlarr ne peut dépasser 60000 ms.")
            .optional(),
        cacheTtlDays: z.coerce
            .number({ invalid_type_error: "cacheTtlDays doit être un nombre." })
            .int()
            .min(1, "Le TTL du cache doit être d'au moins 1 jour.")
            .max(365, "Le TTL du cache ne peut dépasser 365 jours.")
            .optional(),
        rateLimitWindowMs: z.coerce.number().int().min(1000).optional(),
        rateLimitMax: z.coerce.number().int().min(1).optional()
    })
    .strict("Paramètres système non reconnus.");

// Schéma pour le vidage ciblé du cache
const cacheClearSchema = z.object({
    target: z.enum(["torrents", "movies", "searches", "all"], {
        message: "Cible de cache invalide. Valeurs acceptées : torrents, movies, searches, all."
    })
});

// Schéma pour la purge des magnets AllDebrid bloqués
const cleanupMagnetsSchema = z.object({
    apiKey: z.string().min(1, "La clé API ne peut être vide.").max(256, "La clé API est trop longue.").optional()
});

/**
 * Middleware Express appliquant la validation de schémas Zod sur req.body, req.query et/ou req.params.
 * Retourne un code HTTP 400 Bad Request avec message explicite en cas d'erreur.
 * @param {object} schemas
 * @param {z.ZodTypeAny} [schemas.body]
 * @param {z.ZodTypeAny} [schemas.query]
 * @param {z.ZodTypeAny} [schemas.params]
 */
function validateAdmin(schemas = {}) {
    return (req, res, next) => {
        if (schemas.body) {
            const parsed = schemas.body.safeParse(req.body);
            if (!parsed.success) {
                const issues = parsed.error.issues || [];
                const firstMsg = issues[0]?.message || "Données de requête invalides.";
                return res.status(400).json({
                    error: firstMsg,
                    details: issues.map(i => ({ field: i.path.join("."), message: i.message }))
                });
            }
            req.body = parsed.data;
        }

        if (schemas.query) {
            const parsed = schemas.query.safeParse(req.query);
            if (!parsed.success) {
                const issues = parsed.error.issues || [];
                const firstMsg = issues[0]?.message || "Paramètres de requête d'URL invalides.";
                return res.status(400).json({
                    error: firstMsg,
                    details: issues.map(i => ({ field: i.path.join("."), message: i.message }))
                });
            }
            req.query = parsed.data;
        }

        if (schemas.params) {
            const parsed = schemas.params.safeParse(req.params);
            if (!parsed.success) {
                const issues = parsed.error.issues || [];
                const firstMsg = issues[0]?.message || "Paramètres de route invalides.";
                return res.status(400).json({
                    error: firstMsg,
                    details: issues.map(i => ({ field: i.path.join("."), message: i.message }))
                });
            }
            req.params = parsed.data;
        }

        next();
    };
}

module.exports = {
    loginSchema,
    usersQuerySchema,
    userDeleteParamsSchema,
    logsQuerySchema,
    settingsSchema,
    cacheClearSchema,
    cleanupMagnetsSchema,
    validateAdmin
};
