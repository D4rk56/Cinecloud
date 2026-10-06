const test = require("node:test");
const assert = require("node:assert/strict");
const { buildStatusLine, buildTechLine, buildLangSourceLine, formatAioStream } = require("../lib/helpers");

test("buildStatusLine - 3 états normalisés, cloud et seeders", () => {
    assert.equal(buildStatusLine({ isInstant: true }), "⚡ IMMÉDIAT");
    assert.equal(buildStatusLine({ isInstant: true, isCloudSource: true }), "☁️ CLOUD • ⚡ IMMÉDIAT");
    assert.equal(
        buildStatusLine({ isInstant: false, isExplicitDownload: true, seeders: 7 }),
        "⏳ TÉLÉCHARGEMENT (7 seeders)"
    );
    assert.equal(buildStatusLine({ isInstant: false, isProwlarrDirect: true }), "🔍 À VÉRIFIER");
    assert.equal(
        buildStatusLine({ isInstant: false, isProwlarrDirect: true, seeders: 12 }),
        "🔍 À VÉRIFIER (12 seeders)"
    );
    assert.equal(
        buildStatusLine({ isInstant: false, isExplicitDownload: true, subtitle: "Téléchargement (42 seeders)" }),
        "⏳ TÉLÉCHARGEMENT (42 seeders)"
    );
    assert.equal(buildStatusLine({ isInstant: false }), "⏳ TÉLÉCHARGEMENT");
});

test("buildTechLine - fusionne vidéo, audio et taille sans séparateur orphelin", () => {
    assert.equal(
        buildTechLine({
            resBadge: "4K",
            quality: "WEB-DL",
            codec: "HEVC",
            visuals: ["HDR10"],
            audioCodec: "E-AC3",
            channels: "5.1",
            sizeStr: "4.2 GB"
        }),
        "4K • WEB-DL • HEVC • HDR10 • E-AC3 5.1 • 4.2 GB"
    );
    assert.equal(buildTechLine({ sizeStr: "700 MB" }), "700 MB");
    assert.equal(buildTechLine({}), "");
});

test("buildLangSourceLine - langues, source, groupe, seeders et VOSTFR", () => {
    assert.equal(
        buildLangSourceLine({
            langFlags: ["🇫🇷", "🌐"],
            sourceLabel: "🔍 Prowlarr (YGG)",
            group: "FW",
            seeders: 5,
            showSeeders: true
        }),
        "🇫🇷 🌐 | 🔍 Prowlarr (YGG) • FW • 5 seeders"
    );
    assert.equal(
        buildLangSourceLine({ langFlags: [], hasVostfr: true, hasVf: false, sourceLabel: "🚀 Torrentio" }),
        "VOSTFR | 🚀 Torrentio"
    );
    assert.equal(buildLangSourceLine({ sourceLabel: "🌐 Lumio", seeders: 9, showSeeders: false }), "🌐 Lumio");
    assert.equal(buildLangSourceLine({}), "");
});

test("formatAioStream - format strict 4 lignes (statut / titre / technique / langues+source)", () => {
    const s = formatAioStream({
        filename: "Gladiator.II.2024.MULTi.2160p.WEB-DL.HEVC.HDR10-FW.mkv",
        sizeBytes: 4500000000,
        indexer: "Prowlarr | YGG",
        seeders: 8,
        isInstant: false,
        url: "http://example.com/s"
    });
    const lines = s.title.split("\n");
    assert.equal(lines.length, 4);
    assert.ok(lines[0].startsWith("🔍 À VÉRIFIER"));
    assert.ok(lines[1].startsWith("📁 "));
    assert.ok(lines[2].startsWith("🎬 "));
    assert.ok(!s.title.includes("📄"), "La ligne raw 📄 est supprimée");
});

test("formatAioStream - Torbox non instantané via Prowlarr : badge [TB 🔍] et statut À VÉRIFIER", () => {
    const s = formatAioStream({
        filename: "Film.2024.1080p.WEB-DL.x264-GRP.mkv",
        sizeBytes: 2000000000,
        indexer: "Prowlarr | YGG",
        seeders: 3,
        isInstant: false,
        debridProvider: "torbox",
        url: "http://example.com/s"
    });
    assert.ok(s.name.includes("[TB 🔍]"), "Badge Torbox 🔍 attendu");
    assert.equal(s.title.split("\n")[0], "🔍 À VÉRIFIER (3 seeders)");
});
