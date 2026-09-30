"use strict";

/**
 * Module de journalisation en mémoire pour le tableau de bord Administrateur CinéCloud FR.
 * Conserve un tampon circulaire de 500 logs avec horodatage, niveau et module.
 */

const MAX_LOGS = 500;
const logBuffer = [];
let nextLogId = 1;

function addLog(level, moduleName, message) {
    const entry = {
        id: nextLogId++,
        timestamp: new Date().toISOString(),
        level: level.toUpperCase(),
        module: moduleName || "System",
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

function getLogs({ level = "ALL", limit = 100, search = "", sinceId = 0 } = {}) {
    let filtered = logBuffer;

    if (sinceId && !isNaN(sinceId) && sinceId > 0) {
        filtered = filtered.filter(l => l.id > sinceId);
    }

    if (level && level !== "ALL") {
        const lvl = level.toUpperCase();
        filtered = filtered.filter(l => l.level === lvl);
    }

    if (search && search.trim() !== "") {
        const q = search.toLowerCase();
        filtered = filtered.filter(l => l.message.toLowerCase().includes(q) || l.module.toLowerCase().includes(q));
    }

    const lim = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
    return filtered.slice(-lim);
}

function clearLogs() {
    logBuffer.length = 0;
    return true;
}

module.exports = {
    addLog,
    getLogs,
    clearLogs,
    initConsoleInterceptors
};
