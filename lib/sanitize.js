"use strict";

/**
 * Assainissement du contenu personnalisé fourni par l'administrateur (embed de la page publique).
 *
 * Principe de sécurité : la chaîne d'origine n'est JAMAIS réémise telle quelle. Le contenu est
 * tokenisé, validé contre une liste blanche close, puis RECONSTRUIT — tout texte est échappé et
 * seules les balises/attributs autorisés sont réémis. Les contournements classiques (entités
 * numériques/nommées, tabulations et sauts de ligne dans le schéma, casse mixte, attributs sans
 * guillemets, balises non fermées) sont neutralisés par construction.
 */

// Balises acceptées (liste close). Tout le reste est retiré (le texte interne est conservé, échappé).
const ALLOWED_TAGS = new Set([
    "p",
    "div",
    "span",
    "br",
    "hr",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "s",
    "small",
    "ul",
    "ol",
    "li",
    "blockquote",
    "code",
    "pre",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "figure",
    "figcaption",
    "table",
    "thead",
    "tbody",
    "tr",
    "td",
    "th",
    "a",
    "img"
]);

const VOID_TAGS = new Set(["br", "hr", "img"]);

// Attributs autorisés PAR balise. Ni style, ni class, ni id, ni on*, ni srcset, ni formaction…
const ALLOWED_ATTRS = {
    a: new Set(["href", "title"]),
    img: new Set(["src", "alt", "title", "width", "height", "loading"])
};

const URL_ATTRS = { a: "href", img: "src" };

const DISCORD_HOSTS = new Set(["discord.gg", "discord.com", "www.discord.com"]);

// Références de caractères couramment utilisées pour obfusquer un schéma d'URL.
const NAMED_ENTITIES = {
    "&colon;": ":",
    "&tab;": "\t",
    "&newline;": "\n",
    "&sol;": "/",
    "&num;": "#",
    "&period;": ".",
    "&commat;": "@",
    "&percnt;": "%",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&apos;": "'"
};

const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
const ATTR_RE = /([a-zA-Z_:][a-zA-Z0-9:_.-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;

/**
 * Échappe une valeur destinée à être insérée dans du HTML.
 */
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * Décode les références de caractères (numériques et nommées) avant toute validation d'URL,
 * afin qu'un schéma obfusqué (`&#106;avascript:`, `java&#9;script:`) soit détecté.
 */
function decodeEntities(value) {
    return String(value)
        .replace(/&#x([0-9a-f]+);?/gi, (m, hex) => {
            const code = parseInt(hex, 16);
            return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
        })
        .replace(/&#(\d+);?/g, (m, dec) => {
            const code = parseInt(dec, 10);
            return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
        })
        .replace(/&[a-zA-Z]+;/g, m => {
            const decoded = NAMED_ENTITIES[m.toLowerCase()];
            return decoded !== undefined ? decoded : "";
        });
}

/**
 * Normalise une URL pour analyse : entités décodées + suppression des caractères de contrôle
 * et espaces (les navigateurs les ignorent dans le schéma).
 */
function normalizeUrlForCheck(raw) {
    return decodeEntities(raw).replace(/[\u0000-\u0020\u007f]/g, "");
}

/** Lien autorisé : http(s), mailto, ancre ou chemin relatif. */
function isSafeLinkHref(raw) {
    const value = normalizeUrlForCheck(raw);
    if (!value) return false;
    if (value.startsWith("#") || value.startsWith("/")) return true;
    return /^https?:\/\//i.test(value) || /^mailto:[^\s]+$/i.test(value);
}

/** Source d'image autorisée : http(s) ou chemin relatif (pas de `data:`, pas de `javascript:`). */
function isSafeImageSrc(raw) {
    const value = normalizeUrlForCheck(raw);
    if (!value) return false;
    if (value.startsWith("/")) return true;
    return /^https?:\/\//i.test(value);
}

/**
 * Réémet uniquement les attributs autorisés pour la balise, avec valeurs échappées.
 */
function sanitizeAttributes(tagName, rawAttrs) {
    const allowed = ALLOWED_ATTRS[tagName];
    if (!allowed) return "";

    const urlAttr = URL_ATTRS[tagName];
    const out = [];
    const seen = new Set();
    let match;

    ATTR_RE.lastIndex = 0;
    while ((match = ATTR_RE.exec(rawAttrs)) !== null) {
        const name = match[1].toLowerCase();
        const rawValue = match[2] !== undefined ? match[2] : match[3] !== undefined ? match[3] : match[4];

        if (!allowed.has(name) || seen.has(name)) continue;

        // Attribut sans valeur : seul `loading` a un sens ici.
        if (rawValue === undefined) {
            if (name === "loading") {
                seen.add(name);
                out.push('loading="lazy"');
            }
            continue;
        }

        if (name === urlAttr) {
            const ok = tagName === "a" ? isSafeLinkHref(rawValue) : isSafeImageSrc(rawValue);
            if (!ok) continue;
        }

        if (name === "width" || name === "height") {
            if (!/^\d{1,4}$/.test(String(rawValue).trim())) continue;
        }

        seen.add(name);
        out.push(`${name}="${escapeHtml(decodeEntities(rawValue).replace(/[\u0000-\u001f\u007f]/g, ""))}"`);
    }

    if (tagName === "img" && !seen.has("loading")) out.push('loading="lazy"');

    // Les liens externes s'ouvrent dans un nouvel onglet sans transmettre le référent.
    if (tagName === "a") out.push('target="_blank"', 'rel="noopener noreferrer nofollow"');

    return out.length > 0 ? " " + out.join(" ") : "";
}

/**
 * Assainit un fragment HTML fourni par l'administrateur.
 *
 * @param {string} input
 * @param {{maxLength?: number}} [options]
 * @returns {string} HTML sûr (balises équilibrées, aucun script ni gestionnaire d'événement)
 */
function sanitizeEmbedHtml(input, options = {}) {
    const maxLength = Number.isFinite(options.maxLength) ? Number(options.maxLength) : 4000;
    if (input === undefined || input === null) return "";

    let source = String(input)
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<![^>]*>/g, "")
        .replace(/<\?[\s\S]*?\?>/g, "");

    if (source.length > maxLength) source = source.slice(0, maxLength);

    const openStack = [];
    let out = "";
    let lastIndex = 0;
    let match;

    TAG_RE.lastIndex = 0;
    while ((match = TAG_RE.exec(source)) !== null) {
        // Tout ce qui précède la balise est du texte : échappé, jamais interprété.
        if (match.index > lastIndex) out += escapeHtml(source.slice(lastIndex, match.index));
        lastIndex = TAG_RE.lastIndex;

        const rawTag = match[0];
        const tagName = match[1].toLowerCase();
        const rawAttrs = match[2] || "";
        const selfClosing = match[3] === "/";
        const isClosing = rawTag.startsWith("</");

        if (!ALLOWED_TAGS.has(tagName)) continue;

        if (isClosing) {
            const index = openStack.lastIndexOf(tagName);
            if (index !== -1) {
                for (let i = openStack.length - 1; i >= index; i--) out += `</${openStack[i]}>`;
                openStack.length = index;
            }
            continue;
        }

        out += `<${tagName}${sanitizeAttributes(tagName, rawAttrs)}>`;
        if (!VOID_TAGS.has(tagName) && !selfClosing) openStack.push(tagName);
    }

    if (lastIndex < source.length) out += escapeHtml(source.slice(lastIndex));

    // Sortie équilibrée : aucune balise laissée ouverte (pas de détournement de mise en page).
    for (let i = openStack.length - 1; i >= 0; i--) out += `</${openStack[i]}>`;

    return out;
}

/**
 * URL d'iframe d'embed : HTTPS uniquement (bloque javascript:, data:, http:).
 */
function isSafeEmbedUrl(raw) {
    if (!raw || typeof raw !== "string") return false;
    const value = raw.trim();
    if (!value || value.length > 500) return false;
    let parsed;
    try {
        parsed = new URL(value);
    } catch (e) {
        return false;
    }
    return parsed.protocol === "https:";
}

/**
 * URL du bouton Discord : HTTPS et hôte Discord uniquement (le champ ne peut pas servir de
 * redirection vers un site tiers depuis la page publique).
 */
function isSafeDiscordUrl(raw) {
    if (!raw || typeof raw !== "string") return false;
    const value = raw.trim();
    if (!value || value.length > 200) return false;
    let parsed;
    try {
        parsed = new URL(value);
    } catch (e) {
        return false;
    }
    return parsed.protocol === "https:" && DISCORD_HOSTS.has(parsed.hostname.toLowerCase());
}

/**
 * Normalise les champs de personnalisation reçus par l'API admin avant persistance.
 * Une valeur invalide devient une chaîne vide (jamais une erreur 500).
 */
function normalizeSiteSettings(body = {}) {
    const out = { ...body };

    if (out.embedHtml !== undefined) {
        out.embedHtml = sanitizeEmbedHtml(out.embedHtml);
    }
    if (out.embedIframeUrl !== undefined) {
        out.embedIframeUrl = isSafeEmbedUrl(out.embedIframeUrl) ? String(out.embedIframeUrl).trim() : "";
    }
    if (out.discordUrl !== undefined) {
        out.discordUrl = isSafeDiscordUrl(out.discordUrl) ? String(out.discordUrl).trim() : "";
    }
    if (out.embedIframeHeight !== undefined) {
        const height = parseInt(out.embedIframeHeight, 10);
        out.embedIframeHeight = Number.isFinite(height) ? Math.min(Math.max(height, 80), 1200) : 320;
    }

    return out;
}

module.exports = {
    escapeHtml,
    sanitizeEmbedHtml,
    isSafeEmbedUrl,
    isSafeDiscordUrl,
    normalizeSiteSettings,
    ALLOWED_TAGS,
    DISCORD_HOSTS
};
