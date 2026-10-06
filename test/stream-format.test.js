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

test("formatAioStream - behaviorHints exploitables par les agrégateurs (AIOStreams)", () => {
    // AIOStreams lit behaviorHints.filename EN PRIORITÉ : sans lui, il parse notre titre affiché
    // et perd résolution/qualité/langue — ses filtres excluent alors tous nos flux.
    // service/cached déclarent explicitement le débrideur et le statut de cache, sans dépendre
    // des symboles de notre badge (☁️ est classé « uncached » par AIOStreams !).
    const ad = formatAioStream({
        filename: "Dune.Part.Two.2024.1080p.BluRay.x264-GROUP.mkv",
        sizeBytes: 8589934592,
        seeders: 42,
        indexer: "Prowlarr | YggTorrent",
        isInstant: true,
        debridProvider: "alldebrid",
        url: "http://example.com/s"
    });
    assert.equal(ad.behaviorHints.filename, "Dune.Part.Two.2024.1080p.BluRay.x264-GROUP.mkv");
    assert.equal(ad.behaviorHints.videoSize, 8589934592);
    assert.equal(ad.behaviorHints.seeders, 42);
    assert.equal(ad.behaviorHints.indexer, "YggTorrent");
    assert.equal(ad.behaviorHints.service, "alldebrid");
    assert.equal(ad.behaviorHints.cached, true);

    // Cloud personnel : instantané malgré le badge [AD ☁️] (lu comme non caché par AIOStreams).
    const cloudBadge = formatAioStream({
        filename: "Inception.2010.1080p.BluRay.x264.mkv",
        isInstant: true,
        isCloud: true,
        cacheType: "cloud",
        debridProvider: "alldebrid",
        url: "http://example.com/s"
    });
    assert.equal(cloudBadge.behaviorHints.cached, true, "Le cloud personnel doit être annoncé comme caché");

    const tb = formatAioStream({
        filename: "Scrubs.S01E04.MULTI.VFF.1080p.WEB.mkv",
        sizeBytes: 1500000000,
        seeders: 7,
        indexer: "Torrentio | 1337x",
        isInstant: false,
        debridProvider: "torbox",
        url: "http://example.com/s"
    });
    assert.equal(tb.behaviorHints.service, "torbox");
    assert.equal(tb.behaviorHints.cached, false);
    assert.equal(tb.behaviorHints.indexer, "1337x");

    // Libellé générique : pas de filename (un faux nom fausserait le dédoublonnage).
    const generic = formatAioStream({ filename: "Film Cloud", isInstant: true });
    assert.equal(generic.behaviorHints.filename, undefined);
    assert.equal(generic.behaviorHints.videoSize, undefined);
    assert.equal(generic.behaviorHints.service, "alldebrid");
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
