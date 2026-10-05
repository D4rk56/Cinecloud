"use strict";

const { z } = require("zod");

// Schéma pour la connexion administrateur
const loginSchema = z.object({
    password: z.string({
        required_error: "Mot de passe administrateur requis.",
        invalid_type_error: "Le mot de passe doit être une chaîne de caractères."
    })
});

// Schéma pour la liste des utilisateurs (tolère les chaînes vides et normalise la casse)
const usersQuerySchema = z.object({
    sortBy: z.preprocess(
        v => (typeof v === "string" && v.trim() ? v.trim().toLowerCase() : undefined),
        z
            .enum(["newest", "oldest", "alpha", "last_active"], {
                message: "Option de tri invalide. Valeurs acceptées : newest, oldest, alpha, last_active."
            })
            .default("newest")
    )
});

// Schéma pour la suppression d'un utilisateur par UUID
const userDeleteParamsSchema = z.object({
    uuid: z
        .string({ required_error: "UUID utilisateur requis." })
        .trim()
        .regex(/^[a-f0-9-]{36}$/i, "Format UUID invalide.")
});

// Schéma pour la consultation des journaux d'activité (logs)
const logsQuerySchema = z.object({
    level: z.preprocess(
        v => (typeof v === "string" && v.trim() ? v.trim().toUpperCase() : undefined),
        z
            .enum(["ALL", "INFO", "WARN", "ERROR"], {
                message: "Niveau de log invalide. Valeurs acceptées : ALL, INFO, WARN, ERROR."
            })
            .optional()
            .default("ALL")
    ),
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
        // Personnalisation de la page publique (contenu assaini par lib/sanitize.js)
        embedHtml: z
            .string()
            .max(4000, "Le contenu de l'embed ne peut excéder 4000 caractères.")
            .optional(),
        embedIframeUrl: z.string().max(500, "L'URL d'iframe ne peut excéder 500 caractères.").optional(),
        embedIframeHeight: z.coerce
            .number({ invalid_type_error: "embedIframeHeight doit être un nombre." })
            .int()
            .min(80, "La hauteur de l'iframe doit être d'au moins 80 px.")
            .max(1200, "La hauteur de l'iframe ne peut dépasser 1200 px.")
            .optional(),
        discordUrl: z.string().max(200, "L'URL Discord ne peut excéder 200 caractères.").optional(),
        // Ordre des tentatives réseau Torrentio
        torrentioEgress: z.enum(["auto", "direct"], {
            invalid_type_error: "torrentioEgress doit valoir 'auto' ou 'direct'."
        }).optional()
    })
    .strict("Paramètres système non reconnus.");

// Schéma pour le vidage ciblé du cache
const cacheClearSchema = z.object({
    target: z.enum(["torrents", "movies", "searches", "all"], {
        message: "Cible de cache invalide. Valeurs acceptées : torrents, movies, searches, all."
    })
});

// Schéma pour la purge des magnets AllDebrid bloqués (tolère un corps vide ou omis)
const cleanupMagnetsSchema = z.preprocess(
    v => v || {},
    z.object({
        apiKey: z
            .string()
            .trim()
            .min(1, "La clé API ne peut être vide.")
            .max(256, "La clé API est trop longue.")
            .optional()
    })
);

// =============================================================================
// SCHÉMAS DES ROUTES UTILISATEURS (/api/user/*)
// =============================================================================
// Ces routes exigent un UUID + mot de passe et portent les clés debrid. Elles
// étaient jusqu'ici les seules routes d'écriture à ne valider que manuellement,
// ce qui laissait passer des corps arbitraires (types, longueurs, URL). Les
// schémas ci-dessous bornent et typent les entrées avant d'atteindre les
// handlers ; la logique métier (hachage, chiffrement, modes de débrid) reste
// inchangée dans index.js.

const UUID_FIELD = z
    .string({ required_error: "UUID utilisateur requis." })
    .trim()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Format UUID invalide.");

const PASSWORD_FIELD = z
    .string({ required_error: "Mot de passe requis." })
    .min(4, "Un mot de passe d'au moins 4 caractères est requis.")
    .max(200, "Le mot de passe ne peut excéder 200 caractères.");

const API_KEY_FIELD = z.string().trim().max(256, "La clé API est trop longue.").optional().default("");

// Champ URL tolérant : absent, null ou vide → `fallback`. `.optional()` est
// placé AVANT `.transform()` : à l'inverse, le transform rend la clé obligatoire
// et les clients qui n'envoient pas le champ se verraient rejeter en HTTP 400.
const URL_FIELD = (label, fallback) =>
    z
        .union([z.string(), z.null(), z.undefined()])
        .optional()
        .transform(v => (typeof v === "string" && v.trim() ? v.trim() : fallback))
        .refine(
            val => {
                if (!val) return true;
                try {
                    const u = new URL(val);
                    return u.protocol === "http:" || u.protocol === "https:";
                } catch {
                    return false;
                }
            },
            { message: `${label} doit être une URL HTTP ou HTTPS valide.` }
        );

// Champ texte court borné, absent/null → chaîne vide (mêmes règles que URL_FIELD).
const SHORT_TEXT_FIELD = (max) =>
    z
        .union([z.string(), z.null(), z.undefined()])
        .optional()
        .transform(v => (typeof v === "string" ? v.trim().slice(0, max) : ""));

const DEBRID_PROVIDER = z.enum(["alldebrid", "torbox", "both"], {
    invalid_type_error: "debridProvider doit valoir 'alldebrid', 'torbox' ou 'both'."
});

const PROWLARR_MODE = z.enum(["local", "shared", "private"], {
    invalid_type_error: "prowlarrMode doit valoir 'local', 'shared' ou 'private'."
});

/**
 * Champs de configuration partagés par /api/user/register et /api/user/update.
 * Tous sont optionnels : le handler conserve sa logique de fusion avec la
 * config existante (un champ absent ne doit jamais écraser une valeur stockée).
 */
const userConfigFields = {
    pseudo: z.string().trim().max(64, "Le pseudo ne peut excéder 64 caractères.").optional(),
    debridProvider: DEBRID_PROVIDER.optional(),
    apiKey: API_KEY_FIELD,
    torboxApiKey: API_KEY_FIELD,
    tmdbKey: z.string().trim().max(100).optional(),
    cacheMode: z.enum(["on", "off"]).optional(),
    langPref: z.string().trim().max(200).optional(),
    resolutions: z.string().trim().max(200).optional(),
    hideUnknownLanguages: z.boolean().optional(),
    sortBy: z.enum(["quality", "size", "size_asc"]).optional(),
    maxSizeGb: z.coerce.number().min(0).max(10000, "La taille maximale ne peut excéder 10000 Go.").optional(),
    maxStreams: z.coerce.number().int().min(0).max(500, "Le nombre de flux ne peut excéder 500.").optional(),
    prioritizeCloud: z.boolean().optional(),
    prowlarrUrl: URL_FIELD("prowlarrUrl", ""),
    // Aucune valeur de repli ici : une chaîne vide signifie « champ non modifié »
    // et le handler (index.js) doit pouvoir la distinguer d'une clé absente pour
    // préserver celle déjà enregistrée. Seule l'absence de la clé laisse le champ
    // `undefined`, et le handler retombe alors sur la config existante.
    prowlarrKey: z
        .union([z.string(), z.null(), z.undefined()])
        .optional()
        .transform(v => (typeof v === "string" ? v.trim() : v))
        .refine(val => val === undefined || val === null || val.length <= 256, {
            message: "La clé Prowlarr est trop longue."
        }),
    prowlarrMode: PROWLARR_MODE.optional(),
    allowDownload: z.boolean().optional(),
    preValidateCache: z.boolean().optional(),
    disableCatalogs: z.boolean().optional(),
    lumioUrl: SHORT_TEXT_FIELD(500),
    torrentioUrl: SHORT_TEXT_FIELD(500),
    enabledCatalogs: z
        .union([z.array(z.string().trim().max(64)), z.string().trim().max(2000), z.null(), z.undefined()])
        .optional()
        .transform(v => {
            if (Array.isArray(v)) return v.filter(Boolean);
            if (typeof v === "string" && v.trim()) return v.split(",").map(s => s.trim()).filter(Boolean);
            return undefined;
        })
};

// Création d'un manifest : UUID absent (généré par le serveur).
const userRegisterSchema = z.object({
    password: PASSWORD_FIELD,
    ...userConfigFields
});

// Connexion : seuls l'UUID et le mot de passe sont acceptés.
const userLoginSchema = z.object({
    uuid: UUID_FIELD,
    password: z.string().min(1, "Mot de passe requis.").max(200, "Le mot de passe ne peut excéder 200 caractères.")
});

// Mise à jour : UUID + mot de passe courant requis, nouveau mot de passe optionnel.
const userUpdateSchema = z.object({
    uuid: UUID_FIELD,
    password: PASSWORD_FIELD,
    newPassword: z
        .string()
        .min(4, "Le nouveau mot de passe doit comporter au moins 4 caractères.")
        .max(200, "Le mot de passe ne peut excéder 200 caractères.")
        .optional(),
    ...userConfigFields
});

// Suppression de compte : authentification par UUID + mot de passe.
const userDeleteSchema = z.object({
    uuid: UUID_FIELD,
    password: z.string().min(1, "Mot de passe requis.").max(200, "Le mot de passe ne peut excéder 200 caractères.")
});

// Purge des magnets AllDebrid : mêmes identifiants, aucun autre champ.
const userCleanupMagnetsSchema = z.object({
    uuid: UUID_FIELD,
    password: z.string().min(1, "Mot de passe requis.").max(200, "Le mot de passe ne peut excéder 200 caractères.")
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
    userRegisterSchema,
    userLoginSchema,
    userUpdateSchema,
    userDeleteSchema,
    userCleanupMagnetsSchema,
    validateAdmin
};
