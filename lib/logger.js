"use strict";

/**
 * Module de journalisation en mémoire pour le tableau de bord Administrateur CinéCloud FR.
 * Conserve un tampon circulaire de 500 logs avec horodatage, niveau, module et identification utilisateur.
 */

const { AsyncLocalStorage } = require("node:async_hooks");

const MAX_LOGS = 600;
const logBuffer = [];
let nextLogId = 1;
const requestContext = new AsyncLocalStorage();

function runWithUser(userIdentifier, fn) {
    return requestContext.run({ user: userIdentifier || "" }, fn);
}

function getCurrentUser() {
    const store = requestContext.getStore();
    return (store && store.user) || "";
}

function formatUserIdentifier(user) {
    if (!user) return "";
    if (typeof user === "string") return user;
    if (typeof user === "object") {
        const pseudo = (user.pseudo && typeof user.pseudo === "string") ? user.pseudo.trim() : "";
        const shortUuid = (user.uuid && typeof user.uuid === "string") ? user.uuid.slice(0, 8) : "";
        if (pseudo && shortUuid) return `${pseudo} (${shortUuid})`;
        if (pseudo) return pseudo;
        if (shortUuid) return shortUuid;
        return JSON.stringify(user);
    }
    return String(user);
}

function addLog(level, moduleName, message, user = null) {
    const activeUser = user !== null ? user : getCurrentUser();
    const entry = {
        id: nextLogId++,
        timestamp: new Date().toISOString(),
        level: level.toUpperCase(),
        module: moduleName || "System",
        user: formatUserIdentifier(activeUser),
        message: typeof message === "string" ? message : JSON.stringify(message)
    };

    logBuffer.push(entry);
    if (logBuffer.length > MAX_LOGS) {
        logBuffer.shift();
    }
    return entry;
}

// Wrapper optionnel pour intercepter console.log / console.warn / console.error automatiquement
const originalConsoleLog = console.log;
const originalConsoleInfo = console.info;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

function parseConsolePrefix(args) {
    if (!args || args.length === 0) return { module: "App", msg: "" };
    const first = String(args[0]);
    const moduleMatch = first.match(/^\[(.*?)\]\s*(.*)$/);
    if (moduleMatch) {
        const mod = moduleMatch[1];
        const rest = [moduleMatch[2], ...args.slice(1)].filter(Boolean).join(" ");
        return { module: mod, msg: rest };
    }
    return { module: "App", msg: args.map(a => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ") };
}

function initConsoleInterceptors() {
    console.log = function (...args) {
        originalConsoleLog.apply(console, args);
        const { module, msg } = parseConsolePrefix(args);
        addLog("INFO", module, msg);
    };

    console.info = function (...args) {
        originalConsoleInfo.apply(console, args);
        const { module, msg } = parseConsolePrefix(args);
        addLog("INFO", module, msg);
    };

    console.warn = function (...args) {
        originalConsoleWarn.apply(console, args);
        const { module, msg } = parseConsolePrefix(args);
        addLog("WARN", module, msg);
    };

    console.error = function (...args) {
        originalConsoleError.apply(console, args);
        const { module, msg } = parseConsolePrefix(args);
        addLog("ERROR", module, msg);
    };
}

function getLogs({ level = "ALL", limit = 150, search = "", sinceId = 0, user = "" } = {}) {
    let filtered = logBuffer;

    if (sinceId && !isNaN(sinceId) && sinceId > 0) {
        filtered = filtered.filter(l => l.id > sinceId);
    }

    if (level && level !== "ALL") {
        const lvl = level.toUpperCase();
        filtered = filtered.filter(l => l.level === lvl);
    }

    if (user && user.trim() !== "") {
        const u = user.toLowerCase();
        filtered = filtered.filter(l => l.user && l.user.toLowerCase().includes(u));
    }

    if (search && search.trim() !== "") {
        const q = search.toLowerCase();
        filtered = filtered.filter(l =>
            l.message.toLowerCase().includes(q) ||
            l.module.toLowerCase().includes(q) ||
            (l.user && l.user.toLowerCase().includes(q))
        );
    }

    const lim = Math.min(Math.max(parseInt(limit, 10) || 150, 1), 600);
    return filtered.slice(-lim);
}

function clearLogs() {
    logBuffer.length = 0;
    return true;
}

const logger = {
    info: (mod, msg) => (msg !== undefined ? addLog("INFO", mod, msg) : addLog("INFO", "App", mod)),
    warn: (mod, msg) => (msg !== undefined ? addLog("WARN", mod, msg) : addLog("WARN", "App", mod)),
    error: (mod, msg) => (msg !== undefined ? addLog("ERROR", mod, msg) : addLog("ERROR", "App", mod)),
    debug: (mod, msg) => (msg !== undefined ? addLog("DEBUG", mod, msg) : addLog("DEBUG", "App", mod)),
    getLogs,
    clearLogs,
    addLog
};

module.exports = {
    logger,
    addLog,
    getLogs,
    clearLogs,
    initConsoleInterceptors,
    runWithUser,
    getCurrentUser
};
