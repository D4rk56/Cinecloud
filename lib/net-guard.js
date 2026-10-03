"use strict";

/**
 * Garde-fou réseau contre le SSRF (Server-Side Request Forgery).
 * Bloque les hôtes privés, loopback, link-local, métadonnées cloud et
 * adresses réservées, y compris les formes IP entières/hexadécimales et
 * les résolutions DNS qui pointent vers des adresses privées (anti DNS-rebinding).
 */

const net = require("node:net");
const dns = require("node:dns").promises;

function ipv4ToInt(ip) {
    const parts = ip.split(".").map(n => parseInt(n, 10));
    if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function isPrivateIpv4(ip) {
    const intVal = ipv4ToInt(ip);
    if (intVal === null) return true; // malformed => reject
    // [start, end] (inclus) des plages non publiques
    const ranges = [
        [0x00000000, 0x00ffffff], // 0.0.0.0/8 (this network)
        [0x0a000000, 0x0affffff], // 10.0.0.0/8
        [0x64400000, 0x647fffff], // 100.64.0.0/10 (CGNAT)
        [0x7f000000, 0x7fffffff], // 127.0.0.0/8 (loopback)
        [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 (link-local, incl. metadata cloud)
        [0xac100000, 0xac1fffff], // 172.16.0.0/12
        [0xc0000000, 0xc00000ff], // 192.0.0.0/24 (IETF)
        [0xc0000200, 0xc00002ff], // 192.0.2.0/24 (TEST-NET-1)
        [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16
        [0xc6120000, 0xc613ffff], // 198.18.0.0/15 (benchmarking)
        [0xc6336400, 0xc63364ff], // 198.51.100.0/24 (TEST-NET-2)
        [0xcb007100, 0xcb0071ff], // 203.0.113.0/24 (TEST-NET-3)
        [0xe0000000, 0xefffffff], // 224.0.0.0/4 (multicast)
        [0xf0000000, 0xffffffff] // 240.0.0.0/4 (reserved)
    ];
    return ranges.some(([lo, hi]) => intVal >= lo && intVal <= hi);
}

function expandIpv6(addr) {
    let a = addr.toLowerCase().replace(/^\[|\]$/g, "");
    // Queue IPv4-mappée (ex: ::ffff:192.168.0.1)
    let v4 = null;
    const v4Match = a.match(/^(.*):(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (v4Match) {
        a = v4Match[1];
        v4 = v4Match[2];
    }
    const halves = a.split("::");
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(":") : [];
    const tail = halves[1] ? halves[1].split(":") : [];
    let groups;
    if (halves.length === 2) {
        const missing = 8 - head.length - tail.length - (v4 ? 1 : 0);
        if (missing < 0) return null;
        groups = head.concat(new Array(missing).fill("0"), tail);
    } else {
        groups = head;
    }
    if (v4) {
        const intVal = ipv4ToInt(v4);
        if (intVal === null) return null;
        groups = groups.concat([
            ((intVal >>> 16) & 0xffff).toString(16),
            (intVal & 0xffff).toString(16)
        ]);
    }
    return groups.map(g => parseInt(g || "0", 16));
}

function ipv6ToBigInt(addr) {
    const groups = expandIpv6(addr);
    if (!groups || groups.length !== 8) return null;
    let big = 0n;
    for (const g of groups) {
        if (!Number.isInteger(g) || g < 0 || g > 0xffff) return null;
        big = (big << 16n) | BigInt(g);
    }
    return big;
}

function isPrivateIpv6(ip) {
    const big = ipv6ToBigInt(ip);
    if (big === null) return true; // malformed => reject
    const fc00 = 0xfc000000000000000000000000000000n; // fc00::/7
    const fe80 = 0xfe800000000000000000000000000000n; // fe80::/10
    // :: (unspecified) et ::1 (loopback)
    if (big === 0n) return true;
    if (big === 1n) return true;
    if ((big & 0xfe000000000000000000000000000000n) === fc00) return true; // fc00::/7 → fc00-fdff
    if ((big & 0xffc00000000000000000000000000000n) === fe80) return true; // fe80::/10 → fe80-febf
    return false;
}

/**
 * Détermine si une adresse IP (IPv4 ou IPv6) est privée/loopback/link-local/réservée.
 * @param {string} ip
 * @returns {boolean} true si l'adresse ne doit pas être contactée par le serveur.
 */
function isPrivateIp(ip) {
    if (!ip || typeof ip !== "string") return true;
    const version = net.isIP(ip);
    if (version === 4) return isPrivateIpv4(ip);
    if (version === 6) return isPrivateIpv6(ip);
    return true; // non reconnu => rejeter par sécurité
}

/**
 * Coerce les formes d'IP "natives" non canoniques (entier décimal, hexadécimal)
 * vers une adresse IPv4 en notation pointée, sinon retourne null.
 * Ex: "2130706433" → "127.0.0.1", "0x7f000001" → "127.0.0.1".
 * @param {string} hostname
 * @returns {string|null}
 */
function coerceNumericHost(hostname) {
    if (/^\d+$/.test(hostname)) {
        const n = Number(hostname);
        if (Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff) {
            const intVal = n >>> 0;
            return [(intVal >>> 24) & 0xff, (intVal >>> 16) & 0xff, (intVal >>> 8) & 0xff, intVal & 0xff].join(".");
        }
    }
    if (/^0x[0-9a-f]+$/i.test(hostname)) {
        const n = Number.parseInt(hostname.slice(2), 16);
        if (Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff) {
            const intVal = n >>> 0;
            return [(intVal >>> 24) & 0xff, (intVal >>> 16) & 0xff, (intVal >>> 8) & 0xff, intVal & 0xff].join(".");
        }
    }
    return null;
}

/**
 * Vérifie un hostname (sans résolution DNS) : loopback, nom local ou IP privée.
 * @param {string} hostname
 * @returns {boolean} true si l'hôte est privé/interdit.
 */
function isPrivateHost(hostname) {
    if (!hostname || typeof hostname !== "string") return true;
    let h = hostname.toLowerCase().trim().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (!h) return true;

    if (h === "localhost" || h.endsWith(".localhost")) return true;

    // Formes non canoniques (entier décimal / hexadécimal)
    const coerced = coerceNumericHost(h);
    if (coerced) return isPrivateIpv4(coerced);

    // IP littérale → classer ; nom d'hôte → indéterminable sans DNS (laissé à assertSafePublicUrl)
    if (net.isIP(h) !== 0) return isPrivateIp(h);
    return false;
}

/**
 * Vérifie (synchronement, sans DNS) si une URL pointe vers un hôte privé/loopback/link-local.
 * Les noms d'hôtes non-IP (ex: "prowlarr", "host.docker.internal") sont autorisés.
 * @param {string} urlStr
 * @returns {boolean} true si l'URL est interdite (privée ou malformée).
 */
function isPrivateUrl(urlStr) {
    if (!urlStr || typeof urlStr !== "string") return true;
    let s = urlStr.trim();
    if (!s) return true;
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) s = `http://${s}`;
    try {
        return isPrivateHost(new URL(s).hostname);
    } catch (e) {
        return true;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cibles interdites pour un service auto-hébergé (Prowlarr interne, Lumio, etc.)
//
// Un service auto-hébergé vit précisément sur une adresse privée (prowlarr:9696,
// host.docker.internal, 192.168.x.x, 127.0.0.1). Interdire TOUTES les adresses
// privées casserait ce cas d'usage légitime.
// On bloque donc uniquement les cibles jamais valides pour un tel service :
//   - link-local / métadonnées cloud (169.254.0.0/16, dont 169.254.169.254)
//   - adresses non spécifiées (0.0.0.0/8), multicast, réservées, documentation
//   - équivalents IPv6 (::, fe80::/10, ff00::/8)
// ─────────────────────────────────────────────────────────────────────────────

function isForbiddenTargetIpv4(ip) {
    const intVal = ipv4ToInt(ip);
    if (intVal === null) return true;
    const ranges = [
        [0x00000000, 0x00ffffff], // 0.0.0.0/8 (non spécifiée)
        [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 (link-local / métadonnées cloud)
        [0xc0000000, 0xc00000ff], // 192.0.0.0/24 (IETF)
        [0xc0000200, 0xc00002ff], // 192.0.2.0/24 (TEST-NET-1)
        [0xc6120000, 0xc613ffff], // 198.18.0.0/15 (benchmarking)
        [0xc6336400, 0xc63364ff], // 198.51.100.0/24 (TEST-NET-2)
        [0xcb007100, 0xcb0071ff], // 203.0.113.0/24 (TEST-NET-3)
        [0xe0000000, 0xefffffff], // 224.0.0.0/4 (multicast)
        [0xf0000000, 0xffffffff] // 240.0.0.0/4 (réservé)
    ];
    return ranges.some(([lo, hi]) => intVal >= lo && intVal <= hi);
}

function isForbiddenTargetIpv6(ip) {
    const big = ipv6ToBigInt(ip);
    if (big === null) return true;
    if (big === 0n) return true; // :: (non spécifiée)
    const fe80 = 0xfe800000000000000000000000000000n; // fe80::/10 (link-local)
    if ((big & 0xffc00000000000000000000000000000n) === fe80) return true;
    const ff00 = 0xff000000000000000000000000000000n; // ff00::/8 (multicast)
    if ((big & 0xff000000000000000000000000000000n) === ff00) return true;
    return false;
}

/**
 * Indique si une adresse IP est une cible interdite pour un service auto-hébergé.
 * Les adresses privées (RFC1918), loopback et ULA sont AUTORISÉES.
 */
function isForbiddenTargetIp(ip) {
    if (!ip || typeof ip !== "string") return true;
    const version = net.isIP(ip);
    if (version === 4) return isForbiddenTargetIpv4(ip);
    if (version === 6) return isForbiddenTargetIpv6(ip);
    return true;
}

function isForbiddenTargetHost(hostname) {
    if (!hostname || typeof hostname !== "string") return true;
    const h = hostname.toLowerCase().trim().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (!h) return true;
    const coerced = coerceNumericHost(h);
    if (coerced) return isForbiddenTargetIpv4(coerced);
    if (net.isIP(h) !== 0) return isForbiddenTargetIp(h);
    return false; // nom d'hôte → vérifié par résolution DNS dans assertSafeSelfHostedUrl
}

/**
 * Version synchrone (sans DNS) : true si l'URL est une cible interdite.
 * Les noms d'hôtes non-IP sont considérés comme autorisés à ce stade.
 */
function isForbiddenTargetUrl(urlStr) {
    if (!urlStr || typeof urlStr !== "string") return true;
    let s = urlStr.trim();
    if (!s) return true;
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) s = `http://${s}`;
    try {
        return isForbiddenTargetHost(new URL(s).hostname);
    } catch (e) {
        return true;
    }
}

/**
 * Valide une URL destinée à un service auto-hébergé : autorise les adresses
 * privées/loopback (Prowlarr interne, host.docker.internal, LAN, localhost) mais
 * bloque les cibles dangereuses (link-local/métadonnées, non spécifiée, multicast,
 * réservée), y compris via résolution DNS (anti DNS-rebinding).
 * @param {string} urlStr
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function assertSafeSelfHostedUrl(urlStr) {
    if (!urlStr || typeof urlStr !== "string") {
        return { ok: false, error: "URL requise." };
    }
    let parsed;
    try {
        parsed = new URL(urlStr.trim());
    } catch (e) {
        return { ok: false, error: "URL invalide." };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false, error: "Protocole non autorisé (http/https uniquement)." };
    }

    const hostname = parsed.hostname;
    if (isForbiddenTargetHost(hostname)) {
        return { ok: false, error: "Hôte non autorisé (link-local / métadonnées / réservé)." };
    }

    try {
        const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
        if (Array.isArray(addresses)) {
            for (const entry of addresses) {
                if (entry && isForbiddenTargetIp(entry.address)) {
                    return {
                        ok: false,
                        error: "L'hôte résout vers une adresse interdite (link-local / métadonnées / réservé)."
                    };
                }
            }
        }
    } catch (e) {
        // DNS indisponible / hôte introuvable → laisser la requête échouer naturellement.
    }

    return { ok: true };
}

/**
 * Valide qu'une URL pointe vers un hôte public sûr, en résolvant le DNS pour
 * contrer le DNS rebinding. Bloque les protocoles non HTTP(S).
 * @param {string} urlStr
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function assertSafePublicUrl(urlStr) {
    if (!urlStr || typeof urlStr !== "string") {
        return { ok: false, error: "URL requise." };
    }
    let parsed;
    try {
        parsed = new URL(urlStr.trim());
    } catch (e) {
        return { ok: false, error: "URL invalide." };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false, error: "Protocole non autorisé (http/https uniquement)." };
    }

    const hostname = parsed.hostname;
    if (isPrivateHost(hostname)) {
        return { ok: false, error: "Hôte privé ou réservé non autorisé." };
    }

    // Résolution DNS : rejeter si une adresse résolue est privée (anti DNS-rebinding).
    // Si la résolution échoue (hôte introuvable), on laisse la requête échouer naturellement
    // (aucun risque SSRF : la connexion ne pourra pas être établie).
    try {
        const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
        if (Array.isArray(addresses)) {
            for (const entry of addresses) {
                if (entry && isPrivateIp(entry.address)) {
                    return { ok: false, error: "L'hôte résout vers une adresse privée non autorisée." };
                }
            }
        }
    } catch (e) {
        // DNS indisponible / hôte introuvable → autoriser, la requête échouera d'elle-même.
    }

    return { ok: true };
}

module.exports = {
    isPrivateIp,
    isPrivateIpv4,
    isPrivateIpv6,
    isPrivateHost,
    isPrivateUrl,
    coerceNumericHost,
    isForbiddenTargetIp,
    isForbiddenTargetHost,
    isForbiddenTargetUrl,
    assertSafeSelfHostedUrl,
    assertSafePublicUrl
};
