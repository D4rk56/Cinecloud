"use strict";

/**
 * Module d'interface utilisateur pour CinéCloud FR.
 * Génère les pages HTML/CSS/JS modernes avec le style sombre Cyber / Stream-Fusion.
 */

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <radialGradient id="bgGrad" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#0e172a"/>
      <stop offset="60%" stop-color="#080d1a"/>
      <stop offset="100%" stop-color="#03060d"/>
    </radialGradient>
    <linearGradient id="neonCyan" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#0284c7"/>
    </linearGradient>
    <linearGradient id="neonPurple" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#818cf8"/>
      <stop offset="100%" stop-color="#c084fc"/>
    </linearGradient>
    <filter id="neonGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="10" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
  </defs>
  <rect width="512" height="512" rx="100" fill="url(#bgGrad)"/>
  <circle cx="256" cy="220" r="140" fill="none" stroke="url(#neonCyan)" stroke-width="4" stroke-opacity="0.3" filter="url(#neonGlow)"/>
  <circle cx="256" cy="220" r="115" fill="none" stroke="url(#neonPurple)" stroke-width="3" stroke-dasharray="12 8" stroke-opacity="0.6"/>
  <circle cx="256" cy="220" r="85" fill="#0f172a" stroke="url(#neonCyan)" stroke-width="3"/>
  <path d="M295 210c0-22-18-40-40-40-6 0-12 1-17 4-8-15-24-25-43-25-27 0-49 22-49 49 0 3 0 6 1 9-17 5-29 20-29 39 0 22 18 40 40 40h137c20 0 36-16 36-36 0-19-14-34-34-41z" fill="url(#neonCyan)"/>
  <polygon points="225,215 225,265 268,240" fill="#080d1a"/>
  <text x="256" y="420" text-anchor="middle" fill="#f8fafc" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-size="40" font-weight="900" letter-spacing="2">CINÉCLOUD FR</text>
  <text x="256" y="455" text-anchor="middle" fill="#38bdf8" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-size="16" font-weight="700" letter-spacing="4">ALLDEBRID • PROWLARR</text>
</svg>`;

const BACKGROUND_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="1920" height="1080">
  <defs>
    <radialGradient id="bgBase" cx="50%" cy="30%" r="80%">
      <stop offset="0%" stop-color="#0b1329"/>
      <stop offset="50%" stop-color="#060a14"/>
      <stop offset="100%" stop-color="#020408"/>
    </radialGradient>
    <radialGradient id="glowPoint" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="#0284c7" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#bgBase)"/>
  <circle cx="960" cy="350" r="500" fill="url(#glowPoint)"/>
  <circle cx="300" cy="800" r="350" fill="url(#glowPoint)"/>
  <circle cx="1600" cy="700" r="400" fill="url(#glowPoint)"/>
</svg>`;

function renderConfigPage(initialTab = "register", initialUuid = "") {
    return `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CinéCloud FR • Addon AllDebrid Optimisé pour le Contenu Francophone</title>
    <link rel="icon" type="image/svg+xml" href="/logo.png">
    <style>
        :root {
            --bg: #07090e;
            --card-bg: rgba(13, 17, 26, 0.92);
            --card-border: #1a2333;
            --accent-cyan: #38bdf8;
            --accent-blue: #3b82f6;
            --accent-purple: #a855f7;
            --success: #10b981;
            --warning: #f59e0b;
            --danger: #ef4444;
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --text-dim: #64748b;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: radial-gradient(circle at 50% 0%, #0d1b38 0%, var(--bg) 75%);
            background-color: var(--bg);
            color: var(--text-main);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 30px 16px;
        }
        .app-container {
            width: 100%;
            max-width: 680px;
            background: var(--card-bg);
            backdrop-filter: blur(20px);
            border: 1px solid var(--card-border);
            border-radius: 24px;
            padding: 36px 32px;
            box-shadow: 0 30px 60px -12px rgba(0, 0, 0, 0.8), 0 0 30px rgba(56, 189, 248, 0.05);
        }
        .brand-header {
            text-align: center;
            margin-bottom: 24px;
        }
        .logo-circle {
            width: 76px;
            height: 76px;
            margin: 0 auto 14px;
            border-radius: 22px;
            background: linear-gradient(135deg, #0284c7 0%, #38bdf8 100%);
            box-shadow: 0 10px 25px rgba(56, 189, 248, 0.35);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 10px;
        }
        .logo-circle img {
            width: 100%;
            height: 100%;
            object-fit: contain;
        }
        .brand-title {
            font-size: 26px;
            font-weight: 800;
            background: linear-gradient(135deg, #ffffff 30%, #93c5fd 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            letter-spacing: -0.5px;
            margin-bottom: 4px;
        }
        .brand-subtitle {
            font-size: 13px;
            color: var(--text-muted);
        }
        /* Dual Mode Switcher */
        .main-mode-tabs {
            display: flex;
            gap: 8px;
            margin-bottom: 20px;
            background: #090e18;
            padding: 5px;
            border-radius: 14px;
            border: 1px solid var(--card-border);
        }
        .main-mode-btn {
            flex: 1;
            padding: 11px;
            border: none;
            background: transparent;
            color: var(--text-muted);
            font-weight: 700;
            font-size: 13px;
            border-radius: 10px;
            cursor: pointer;
            transition: all 0.2s;
        }
        .main-mode-btn.active {
            background: #172238;
            color: var(--accent-cyan);
            box-shadow: 0 0 14px rgba(56, 189, 248, 0.25);
        }
        /* Stats Pill */
        .stats-pill {
            display: flex;
            align-items: center;
            justify-content: space-around;
            background: #090d16;
            border: 1px solid var(--card-border);
            border-radius: 14px;
            padding: 10px 16px;
            margin-bottom: 24px;
        }
        .stat-item {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .stat-icon-badge {
            width: 32px;
            height: 32px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 15px;
        }
        .stat-icon-users { background: rgba(56, 189, 248, 0.15); color: var(--accent-cyan); }
        .stat-icon-streams { background: rgba(168, 85, 247, 0.15); color: var(--accent-purple); }
        .stat-val {
            font-size: 15px;
            font-weight: 800;
            color: var(--text-main);
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .pulse-dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: var(--success);
            box-shadow: 0 0 8px var(--success);
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0% { transform: scale(0.95); opacity: 0.8; }
            50% { transform: scale(1.3); opacity: 1; }
            100% { transform: scale(0.95); opacity: 0.8; }
        }
        .stat-label {
            font-size: 10px;
            font-weight: 700;
            color: var(--text-dim);
            letter-spacing: 0.5px;
            text-transform: uppercase;
        }
        /* Stepper Navigation */
        .stepper-nav {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 28px;
            position: relative;
        }
        .stepper-nav::before {
            content: '';
            position: absolute;
            top: 20px;
            left: 30px;
            right: 30px;
            height: 2px;
            background: var(--card-border);
            z-index: 1;
        }
        .step-node {
            position: relative;
            z-index: 2;
            display: flex;
            flex-direction: column;
            align-items: center;
            cursor: pointer;
            background: transparent;
            border: none;
            outline: none;
        }
        .step-circle {
            width: 42px;
            height: 42px;
            border-radius: 50%;
            background: #090d16;
            border: 2px solid var(--card-border);
            color: var(--text-muted);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 15px;
            font-weight: 700;
            transition: all 0.25s;
            margin-bottom: 6px;
        }
        .step-label {
            font-size: 11px;
            font-weight: 700;
            color: var(--text-dim);
            transition: color 0.25s;
        }
        .step-node.active .step-circle {
            border-color: var(--accent-cyan);
            background: #0e1e38;
            color: var(--accent-cyan);
            box-shadow: 0 0 16px rgba(56, 189, 248, 0.4);
        }
        .step-node.active .step-label { color: var(--accent-cyan); }
        .step-node.completed .step-circle {
            border-color: var(--success);
            background: rgba(16, 185, 129, 0.15);
            color: var(--success);
        }
        /* Formulaires & Cartes d'Étapes */
        .step-content {
            display: none;
            animation: fadeIn 0.25s ease;
        }
        .step-content.active { display: block; }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(6px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .section-title {
            font-size: 16px;
            font-weight: 800;
            margin-bottom: 4px;
            color: #ffffff;
        }
        .section-desc {
            font-size: 12px;
            color: var(--text-muted);
            margin-bottom: 18px;
            line-height: 1.4;
        }
        .form-group {
            margin-bottom: 18px;
        }
        label {
            display: block;
            font-size: 12px;
            font-weight: 700;
            color: var(--text-main);
            margin-bottom: 6px;
        }
        .input-row {
            display: flex;
            gap: 10px;
        }
        input[type="text"], input[type="password"], input[type="number"], select {
            width: 100%;
            background: #090e18;
            border: 1px solid var(--card-border);
            border-radius: 12px;
            padding: 12px 14px;
            color: var(--text-main);
            font-size: 13px;
            outline: none;
            transition: border-color 0.2s, box-shadow 0.2s;
        }
        input:focus, select:focus {
            border-color: var(--accent-cyan);
            box-shadow: 0 0 12px rgba(56, 189, 248, 0.2);
        }
        .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 12px 20px;
            border-radius: 12px;
            font-weight: 700;
            font-size: 13px;
            cursor: pointer;
            border: none;
            transition: all 0.2s;
            text-decoration: none;
        }
        .btn-primary {
            background: linear-gradient(135deg, #0284c7 0%, #38bdf8 100%);
            color: #030712;
            box-shadow: 0 6px 20px rgba(56, 189, 248, 0.3);
        }
        .btn-primary:hover {
            transform: translateY(-1px);
            box-shadow: 0 8px 24px rgba(56, 189, 248, 0.45);
        }
        .btn-secondary {
            background: #101624;
            color: var(--text-muted);
            border: 1px solid var(--card-border);
        }
        .btn-secondary:hover {
            background: #1c273d;
            border-color: var(--accent-cyan);
            color: #fff;
        }
        .btn-danger {
            background: rgba(239, 68, 68, 0.15);
            color: var(--danger);
            border: 1px solid rgba(239, 68, 68, 0.3);
        }
        .btn-danger:hover {
            background: var(--danger);
            color: #fff;
        }
        .btn-check {
            white-space: nowrap;
            padding: 12px 16px;
            background: #152238;
            color: var(--accent-cyan);
            border: 1px solid rgba(56, 189, 248, 0.3);
        }
        .btn-check:hover {
            background: #1c2e4c;
            border-color: var(--accent-cyan);
        }
        .status-badge {
            margin-top: 8px;
            font-size: 12px;
            padding: 6px 12px;
            border-radius: 8px;
            display: none;
        }
        .status-badge.success {
            display: inline-block;
            background: rgba(16, 185, 129, 0.15);
            color: var(--success);
            border: 1px solid rgba(16, 185, 129, 0.3);
        }
        .status-badge.error {
            display: inline-block;
            background: rgba(239, 68, 68, 0.15);
            color: var(--danger);
            border: 1px solid rgba(239, 68, 68, 0.3);
        }
        /* Carte Proxy WARP */
        .warp-card {
            background: rgba(18, 25, 41, 0.7);
            border: 1px solid var(--card-border);
            border-radius: 14px;
            padding: 14px 18px;
            margin-top: 14px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .warp-info {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .warp-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: var(--warning);
        }
        .warp-dot.active { background: var(--success); box-shadow: 0 0 10px var(--success); }
        .warp-dot.fallback { background: var(--warning); box-shadow: 0 0 10px var(--warning); }
        .warp-title { font-size: 13px; font-weight: 700; color: var(--text-main); }
        .warp-desc { font-size: 11px; color: var(--text-muted); }
        /* Cartes de drag-and-drop pour Qualités et Langues */
        .draggable-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin: 14px 0;
        }
        .draggable-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: #0f1624;
            border: 1px solid var(--card-border);
            border-radius: 12px;
            padding: 10px 14px;
            user-select: none;
            transition: all 0.2s;
        }
        .draggable-item.dragging {
            opacity: 0.4;
            border-color: var(--accent-cyan);
        }
        .item-left {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .drag-handle {
            cursor: grab;
            color: var(--text-dim);
            font-size: 16px;
            padding: 0 4px;
        }
        .item-label {
            font-size: 13px;
            font-weight: 700;
            color: var(--text-main);
        }
        .item-sub {
            font-size: 11px;
            color: var(--text-muted);
            margin-left: 6px;
        }
        .item-actions {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .btn-icon {
            background: transparent;
            border: none;
            color: var(--text-dim);
            cursor: pointer;
            padding: 4px 6px;
            border-radius: 6px;
            font-size: 12px;
            transition: all 0.15s;
        }
        .btn-icon:hover {
            color: var(--accent-cyan);
            background: #172238;
        }
        /* Boutons de résolutions déplaçables */
        .resolutions-bar {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin: 14px 0;
        }
        .res-pill {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 10px 16px;
            border-radius: 12px;
            background: #0f1624;
            border: 1px solid var(--card-border);
            color: var(--text-main);
            font-size: 13px;
            font-weight: 700;
            cursor: grab;
            transition: all 0.2s;
            user-select: none;
        }
        .res-pill.active {
            border-color: var(--accent-cyan);
            background: rgba(56, 189, 248, 0.12);
            color: #ffffff;
            box-shadow: 0 0 12px rgba(56, 189, 248, 0.25);
        }
        .res-pill.disabled {
            opacity: 0.4;
            border-color: var(--card-border);
            text-decoration: line-through;
        }
        .res-pill .pill-del {
            cursor: pointer;
            font-size: 12px;
            color: var(--text-dim);
            padding: 0 2px;
        }
        .res-pill .pill-del:hover {
            color: var(--danger);
        }
        .btn-eye {
            background: #0d1424;
            border: 1px solid var(--card-border);
            color: var(--text-muted);
            border-radius: 12px;
            padding: 0 14px;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.2s;
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }
        .btn-eye:hover {
            color: var(--accent-cyan);
            border-color: var(--accent-cyan);
            background: #172238;
        }
        .prowlarr-mode-cards {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
            margin-bottom: 14px;
        }
        .prowlarr-card {
            background: #090e18;
            border: 1px solid var(--card-border);
            border-radius: 12px;
            padding: 12px 10px;
            cursor: pointer;
            text-align: center;
            transition: all 0.2s;
        }
        .prowlarr-card:hover {
            border-color: #2a3a54;
        }
        .prowlarr-card.active {
            border-color: var(--accent-cyan);
            background: rgba(56, 189, 248, 0.08);
            box-shadow: 0 0 14px rgba(56, 189, 248, 0.2);
        }
        .prowlarr-card-icon {
            font-size: 20px;
            margin-bottom: 6px;
        }
        .prowlarr-card-title {
            font-size: 12px;
            font-weight: 700;
            color: #fff;
            margin-bottom: 4px;
        }
        .prowlarr-card-desc {
            font-size: 10px;
            color: var(--text-dim);
            line-height: 1.3;
        }
        /* Switch & Checkboxes */
        .checkbox-card {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: #0f1624;
            border: 1px solid var(--card-border);
            border-radius: 12px;
            padding: 12px 16px;
            margin: 10px 0;
            cursor: pointer;
        }
        .checkbox-card input[type="checkbox"] {
            width: 18px;
            height: 18px;
            accent-color: var(--accent-cyan);
            cursor: pointer;
        }
        .step-footer {
            display: flex;
            justify-content: space-between;
            margin-top: 26px;
            padding-top: 18px;
            border-top: 1px solid var(--card-border);
        }
        .result-box {
            display: none;
            background: #0f1624;
            border: 1px solid var(--accent-cyan);
            border-radius: 16px;
            padding: 24px 20px;
            margin-top: 20px;
            text-align: center;
            animation: fadeIn 0.3s ease;
        }
        .manifest-link-input {
            width: 100%;
            background: #07090e;
            border: 1px solid var(--card-border);
            border-radius: 8px;
            padding: 10px;
            color: var(--accent-cyan);
            font-family: monospace;
            font-size: 12px;
            margin: 14px 0;
            text-align: center;
        }
        .btn-install {
            width: 100%;
            padding: 14px;
            font-size: 15px;
            margin-bottom: 8px;
        }
        .btn-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
        }
        .footer-links {
            text-align: center;
            margin-top: 24px;
            font-size: 12px;
            color: var(--text-dim);
        }
        .footer-links a {
            color: var(--text-dim);
            text-decoration: none;
            transition: color 0.2s;
        }
        .footer-links a:hover {
            color: var(--accent-cyan);
        }
    </style>
</head>
<body>

<div class="app-container">
    <!-- En-tête -->
    <div class="brand-header">
        <div class="logo-circle">
            <img src="/logo.png" alt="CinéCloud FR">
        </div>
        <h1 class="brand-title">CinéCloud FR</h1>
        <div class="brand-subtitle">Optimisé pour le contenu francophone</div>
    </div>

    <!-- Sélecteur Principal : Créer ou Gérer -->
    <div class="main-mode-tabs">
        <button type="button" class="main-mode-btn ${initialTab === 'configure' ? '' : 'active'}" id="modeRegisterBtn" onclick="switchMainMode('register')">⚡ Créer un Addon</button>
        <button type="button" class="main-mode-btn ${initialTab === 'configure' ? 'active' : ''}" id="modeConfigureBtn" onclick="switchMainMode('configure')">⚙️ Gérer ma Configuration</button>
    </div>

    <!-- Barre de statistiques en temps réel -->
    <div class="stats-pill">
        <div class="stat-item">
            <div class="stat-icon-badge stat-icon-users">👥</div>
            <div class="stat-content">
                <div class="stat-val"><span id="statRegistered">--</span></div>
                <div class="stat-label">Inscrits</div>
            </div>
        </div>
        <div class="stat-item">
            <div class="stat-icon-badge stat-icon-active">🟢</div>
            <div class="stat-content">
                <div class="stat-val"><span class="pulse-dot"></span> <span id="statActive">--</span></div>
                <div class="stat-label">Actifs (24h)</div>
            </div>
        </div>
        <div class="stat-item">
            <div class="stat-icon-badge stat-icon-streams">⚡</div>
            <div class="stat-content">
                <div class="stat-val"><span id="statCached">--</span></div>
                <div class="stat-label">En cache</div>
            </div>
        </div>
    </div>

    <!-- ========================================================================= -->
    <!-- VUE 1 : CRÉATION D'ADDON (STEPPER)                                        -->
    <!-- ========================================================================= -->
    <div id="registerContainer" style="display: ${initialTab === 'configure' ? 'none' : 'block'};">
        <!-- Navigation Stepper -->
        <div class="stepper-nav">
            <button type="button" class="step-node active" onclick="goToStep(1)">
                <div class="step-circle">⚡</div>
                <div class="step-label">AllDebrid</div>
            </button>
            <button type="button" class="step-node" onclick="goToStep(2)">
                <div class="step-circle">🎬</div>
                <div class="step-label">TMDB</div>
            </button>
            <button type="button" class="step-node" onclick="goToStep(3)">
                <div class="step-circle">🌐</div>
                <div class="step-label">Langues</div>
            </button>
            <button type="button" class="step-node" onclick="goToStep(4)">
                <div class="step-circle">📐</div>
                <div class="step-label">Qualité</div>
            </button>
            <button type="button" class="step-node" onclick="goToStep(5)">
                <div class="step-circle">👤</div>
                <div class="step-label">Installation</div>
            </button>
        </div>

        <form id="configForm" onsubmit="event.preventDefault();">
            <!-- Étape 1 : AllDebrid & Statut WARP -->
            <div class="step-content active" id="step1">
                <div class="section-title">Connexion AllDebrid</div>
                <div class="section-desc">Entrez votre clé API AllDebrid pour débloquer les flux et les torrents instantanés.</div>

                <div class="form-group">
                    <label for="apiKey">Clé API AllDebrid *</label>
                    <div class="input-row">
                        <input type="password" name="apiKey" id="apiKey" placeholder="Votre clé API AllDebrid" required>
                        <button type="button" class="btn-eye" onclick="togglePassVisibility('apiKey', this)" title="Afficher/Masquer la clé">👁️</button>
                        <button type="button" class="btn btn-check" onclick="checkAllDebrid()">Tester</button>
                    </div>
                    <div id="adStatus" class="status-badge"></div>
                    <div style="font-size: 11px; margin-top: 6px; color: var(--text-dim);">
                        🔑 Obtenez votre clé sur <a href="https://alldebrid.fr/apikeys" target="_blank" style="color: var(--accent-cyan);">alldebrid.fr/apikeys</a>
                    </div>
                </div>

                <!-- Encart Statut WARP Live -->
                <div class="warp-card">
                    <div class="warp-info">
                        <div class="warp-dot active" id="warpDot"></div>
                        <div>
                            <div class="warp-title">Proxy Cloudflare WARP</div>
                            <div class="warp-desc" id="warpDesc">Vérification de l'état du proxy...</div>
                        </div>
                    </div>
                    <button type="button" class="btn btn-secondary" style="padding: 6px 12px; font-size: 11px;" onclick="checkWarpStatus()">Rafraîchir</button>
                </div>

                <div class="step-footer">
                    <div></div>
                    <button type="button" class="btn btn-primary" onclick="goToStep(2)">Suivant ➔</button>
                </div>
            </div>

            <!-- Étape 2 : TMDB & Catalogues Cloud -->
            <div class="step-content" id="step2">
                <div class="section-title">Métadonnées & Catalogues Cloud</div>
                <div class="section-desc">Enrichissement francophone avec TMDB et activation de vos sections Stremio.</div>

                <div class="form-group">
                    <label for="tmdbKey">Clé API TMDB (Optionnel)</label>
                    <div class="input-row">
                        <input type="password" name="tmdbKey" id="tmdbKey" placeholder="Optionnel (laisser vide pour la clé par défaut)">
                        <button type="button" class="btn-eye" onclick="togglePassVisibility('tmdbKey', this)" title="Afficher/Masquer la clé">👁️</button>
                        <button type="button" class="btn btn-check" onclick="checkTmdb()">Tester</button>
                    </div>
                    <div id="tmdbStatus" class="status-badge"></div>
                    <div style="font-size: 11px; margin-top: 6px; color: var(--text-dim);">
                        🔑 Obtenez gratuitement votre clé personnelle sur <a href="https://www.themoviedb.org/settings/api" target="_blank" style="color: var(--accent-cyan);">themoviedb.org/settings/api</a>
                    </div>
                </div>

                <div class="form-group">
                    <label>Gestion des Catalogues Stremio</label>
                    <div class="checkbox-card" style="border-color: #38bdf8; margin-bottom: 12px;" onclick="toggleCheckbox('disableCatalogs'); toggleCatalogListVisibility();">
                        <div>
                            <div class="item-label" style="color: #38bdf8;">🚫 Désactiver tous les catalogues</div>
                            <div class="item-sub">Supprime les rangées de catalogues de l'accueil Stremio (conserve uniquement la recherche et les flux vidéo)</div>
                        </div>
                        <input type="checkbox" id="disableCatalogs" onclick="event.stopPropagation(); toggleCatalogListVisibility();">
                    </div>
                    <div id="catalogsList">
                        <div class="checkbox-card" onclick="toggleCheckbox('cat_magnets')">
                            <div>
                                <div class="item-label">Mes Fichiers Cloud ☁️</div>
                                <div class="item-sub">Vos magnets débridés et stockés dans AllDebrid</div>
                            </div>
                            <input type="checkbox" id="cat_magnets" checked onclick="event.stopPropagation()">
                        </div>
                        <div class="checkbox-card" onclick="toggleCheckbox('cat_links')">
                            <div>
                                <div class="item-label">Mes Liens & Historique 🕒</div>
                                <div class="item-sub">Vos liens téléchargés et votre historique de débridage</div>
                            </div>
                            <input type="checkbox" id="cat_links" checked onclick="event.stopPropagation()">
                        </div>
                        <div class="checkbox-card" onclick="toggleCheckbox('cat_animes')">
                            <div>
                                <div class="item-label">Mes Animés 🇯🇵</div>
                                <div class="item-sub">Classification automatique des séries et films animés</div>
                            </div>
                            <input type="checkbox" id="cat_animes" checked onclick="event.stopPropagation()">
                        </div>
                        <div class="checkbox-card" onclick="toggleCheckbox('cat_reco')">
                            <div>
                                <div class="item-label">Recommandations Populaires 🍿</div>
                                <div class="item-sub">Films, séries et animés tendances basés sur votre compte</div>
                            </div>
                            <input type="checkbox" id="cat_reco" checked onclick="event.stopPropagation()">
                        </div>
                    </div>
                </div>

                <div class="step-footer">
                    <button type="button" class="btn btn-secondary" onclick="goToStep(1)">⬅ Précédent</button>
                    <button type="button" class="btn btn-primary" onclick="goToStep(3)">Suivant ➔</button>
                </div>
            </div>

            <!-- Étape 3 : Priorités Linguistiques & Exclusions -->
            <div class="step-content" id="step3">
                <div class="section-title">Priorités Linguistiques</div>
                <div class="section-desc">Glissez-déposez pour réordonner vos préférences de langue ou utilisez les flèches.</div>

                <div class="draggable-list" id="langList">
                    <div class="draggable-item" draggable="true" data-lang="multi_vff">
                        <div class="item-left">
                            <span class="drag-handle">☰</span>
                            <input type="checkbox" class="lang-check" checked>
                            <span class="item-label">🇫🇷 MULTI (VFF + VOSTFR)</span>
                        </div>
                        <div class="item-actions">
                            <button type="button" class="btn-icon" onclick="moveItem(this, -1)">▲</button>
                            <button type="button" class="btn-icon" onclick="moveItem(this, 1)">▼</button>
                        </div>
                    </div>
                    <div class="draggable-item" draggable="true" data-lang="vff">
                        <div class="item-left">
                            <span class="drag-handle">☰</span>
                            <input type="checkbox" class="lang-check" checked>
                            <span class="item-label">🇫🇷 VFF (TrueFrench)</span>
                        </div>
                        <div class="item-actions">
                            <button type="button" class="btn-icon" onclick="moveItem(this, -1)">▲</button>
                            <button type="button" class="btn-icon" onclick="moveItem(this, 1)">▼</button>
                        </div>
                    </div>
                    <div class="draggable-item" draggable="true" data-lang="vfi">
                        <div class="item-left">
                            <span class="drag-handle">☰</span>
                            <input type="checkbox" class="lang-check" checked>
                            <span class="item-label">⚜️ VFI / VFQ (Québec / International)</span>
                        </div>
                        <div class="item-actions">
                            <button type="button" class="btn-icon" onclick="moveItem(this, -1)">▲</button>
                            <button type="button" class="btn-icon" onclick="moveItem(this, 1)">▼</button>
                        </div>
                    </div>
                    <div class="draggable-item" draggable="true" data-lang="multi">
                        <div class="item-left">
                            <span class="drag-handle">☰</span>
                            <input type="checkbox" class="lang-check" checked>
                            <span class="item-label">🌐 MULTI (Général)</span>
                        </div>
                        <div class="item-actions">
                            <button type="button" class="btn-icon" onclick="moveItem(this, -1)">▲</button>
                            <button type="button" class="btn-icon" onclick="moveItem(this, 1)">▼</button>
                        </div>
                    </div>
                    <div class="draggable-item" draggable="true" data-lang="vf">
                        <div class="item-left">
                            <span class="drag-handle">☰</span>
                            <input type="checkbox" class="lang-check" checked>
                            <span class="item-label">🇫🇷 VF Standard</span>
                        </div>
                        <div class="item-actions">
                            <button type="button" class="btn-icon" onclick="moveItem(this, -1)">▲</button>
                            <button type="button" class="btn-icon" onclick="moveItem(this, 1)">▼</button>
                        </div>
                    </div>
                    <div class="draggable-item" draggable="true" data-lang="vostfr">
                        <div class="item-left">
                            <span class="drag-handle">☰</span>
                            <input type="checkbox" class="lang-check" checked>
                            <span class="item-label">💬 VOSTFR (Sous-titres FR)</span>
                        </div>
                        <div class="item-actions">
                            <button type="button" class="btn-icon" onclick="moveItem(this, -1)">▲</button>
                            <button type="button" class="btn-icon" onclick="moveItem(this, 1)">▼</button>
                        </div>
                    </div>
                    <div class="draggable-item" draggable="true" data-lang="vo">
                        <div class="item-left">
                            <span class="drag-handle">☰</span>
                            <input type="checkbox" class="lang-check" checked>
                            <span class="item-label">🇬🇧 VO / Anglais</span>
                        </div>
                        <div class="item-actions">
                            <button type="button" class="btn-icon" onclick="moveItem(this, -1)">▲</button>
                            <button type="button" class="btn-icon" onclick="moveItem(this, 1)">▼</button>
                        </div>
                    </div>
                </div>

                <div class="checkbox-card" onclick="toggleCheckbox('hideUnknownLanguages')">
                    <div>
                        <div class="item-label">Effacer les langues inconnues</div>
                        <div class="item-sub">Masquer les torrents où aucune langue francophone ou originale n'a pu être identifiée</div>
                    </div>
                    <input type="checkbox" id="hideUnknownLanguages" onclick="event.stopPropagation()">
                </div>

                <div class="step-footer">
                    <button type="button" class="btn btn-secondary" onclick="goToStep(2)">⬅ Précédent</button>
                    <button type="button" class="btn btn-primary" onclick="goToStep(4)">Suivant ➔</button>
                </div>
            </div>

            <!-- Étape 4 : Gestion des Résolutions & Tri -->
            <div class="step-content" id="step4">
                <div class="section-title">Résolutions, Prowlarr & Tri des Flux</div>
                <div class="section-desc">Personnalisez les qualités, votre indexeur Prowlarr et les critères de tri des flux vidéo.</div>

                <div class="form-group">
                    <label>Mode Prowlarr (Indexeurs de Torrents)</label>
                    <div class="prowlarr-mode-cards">
                        <div class="prowlarr-card active" id="prowlarrCard_shared" onclick="selectProwlarrMode('shared')">
                            <div class="prowlarr-card-icon">🤝</div>
                            <div class="prowlarr-card-title">Partagé</div>
                            <div class="prowlarr-card-desc">Crowdsourcing : cache mutualisé & RSS pour tous</div>
                        </div>
                        <div class="prowlarr-card" id="prowlarrCard_local" onclick="selectProwlarrMode('local')">
                            <div class="prowlarr-card-icon">💾</div>
                            <div class="prowlarr-card-title">Local</div>
                            <div class="prowlarr-card-desc">Pas de Prowlarr personnel. Cache partagé + Torrentio</div>
                        </div>
                        <div class="prowlarr-card" id="prowlarrCard_private" onclick="selectProwlarrMode('private')">
                            <div class="prowlarr-card-icon">🔒</div>
                            <div class="prowlarr-card-title">Privé</div>
                            <div class="prowlarr-card-desc">Votre Prowlarr sans ajout dans le cache public</div>
                        </div>
                    </div>
                    <input type="hidden" id="prowlarrMode" value="shared">
                </div>

                <div id="prowlarrCredentialsBlock">
                    <div class="form-group">
                        <label for="prowlarrUrl">URL Prowlarr (Optionnel si instance système)</label>
                        <input type="text" id="prowlarrUrl" placeholder="Ex: http://prowlarr:9696 ou http://192.168.1.50:9696">
                    </div>
                    <div class="form-group">
                        <label for="prowlarrKey">Clé API Prowlarr (Optionnel si instance système)</label>
                        <div class="input-row">
                            <input type="password" id="prowlarrKey" placeholder="Votre clé API Prowlarr">
                            <button type="button" class="btn-eye" onclick="togglePassVisibility('prowlarrKey', this)" title="Afficher/Masquer">👁️</button>
                            <button type="button" class="btn btn-check" onclick="checkProwlarr()">Tester</button>
                        </div>
                        <div id="prowlarrStatus" class="status-badge"></div>
                    </div>
                </div>

                <div class="checkbox-card" style="margin-bottom: 18px;" onclick="toggleCheckbox('allowDownload')">
                    <div>
                        <div class="item-label">⏳ Mode Téléchargement AllDebrid</div>
                        <div class="item-sub">Afficher les torrents non encore en cache AllDebrid et lancer leur téléchargement en tâche de fond (désactivé par défaut)</div>
                    </div>
                    <input type="checkbox" id="allowDownload" onclick="event.stopPropagation()">
                </div>

                <div class="form-group">
                    <label>Ordre des Résolutions (Déplaçable)</label>
                    <div class="resolutions-bar" id="resBar">
                        <div class="res-pill active" draggable="true" data-res="4k">
                            <span>✨ 4K / UHD</span>
                            <span class="pill-del" onclick="toggleResolution(this)">✕</span>
                        </div>
                        <div class="res-pill active" draggable="true" data-res="1080p">
                            <span>💎 1080p Full HD</span>
                            <span class="pill-del" onclick="toggleResolution(this)">✕</span>
                        </div>
                        <div class="res-pill active" draggable="true" data-res="720p">
                            <span>📺 720p HD</span>
                            <span class="pill-del" onclick="toggleResolution(this)">✕</span>
                        </div>
                        <div class="res-pill active" draggable="true" data-res="480p">
                            <span>📼 480p SD</span>
                            <span class="pill-del" onclick="toggleResolution(this)">✕</span>
                        </div>
                    </div>
                    <div style="font-size: 11px; color: var(--text-dim);">
                        💡 Les résolutions barrées seront complètement exclues des résultats.
                    </div>
                </div>

                <div class="form-group">
                    <label for="sortBy">Critère de Tri Principal</label>
                    <select id="sortBy">
                        <option value="quality">Par Qualité puis Seeders (Recommandé)</option>
                        <option value="size">Par Taille Décroissante (Meilleur débit / Remux)</option>
                        <option value="size_asc">Par Taille Croissante (Connexions lentes)</option>
                    </select>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <div class="form-group">
                        <label for="maxSizeGb">Taille Max par Fichier (Go)</label>
                        <input type="number" id="maxSizeGb" placeholder="Ex: 150 (0 = Aucune limite)" value="150" min="0" step="0.5">
                    </div>
                    <div class="form-group">
                        <label for="maxStreams">Nombre Max de Flux</label>
                        <input type="number" id="maxStreams" placeholder="Ex: 8 (0 = Tout afficher)" min="0" step="1">
                    </div>
                </div>

                <div class="step-footer">
                    <button type="button" class="btn btn-secondary" onclick="goToStep(3)">⬅ Précédent</button>
                    <button type="button" class="btn btn-primary" onclick="goToStep(5)">Suivant ➔</button>
                </div>
            </div>

            <!-- Étape 5 : Profil & Installation -->
            <div class="step-content" id="step5">
                <div class="section-title">Profil & Sécurité</div>
                <div class="section-desc">Personnalisez le nom affiché dans Stremio et sécurisez vos réglages par mot de passe.</div>

                <div class="form-group">
                    <label for="pseudo">Pseudo / Nom dans Stremio (Optionnel)</label>
                    <input type="text" id="pseudo" name="username" autocomplete="username" placeholder="Ex: Salon, Alex, Tablette...">
                    <div style="font-size: 11px; margin-top: 4px; color: var(--text-dim);">
                        Permet d'afficher par exemple "CinéCloud FR (Alex)" dans votre liste d'addons Stremio et de sauvegarder vos identifiants dans votre navigateur.
                    </div>
                </div>

                <div class="form-group">
                    <label for="password">Mot de passe pour vos réglages *</label>
                    <div class="input-row">
                        <input type="password" id="password" name="password" autocomplete="new-password" placeholder="Mot de passe d'au moins 4 caractères" required>
                        <button type="button" class="btn-eye" onclick="togglePassVisibility('password', this)" title="Afficher/Masquer le mot de passe">👁️</button>
                    </div>
                    <div style="font-size: 11px; margin-top: 4px; color: var(--text-dim);">
                        Requis pour modifier vos préférences plus tard sans réinstaller.
                    </div>
                </div>

                <button type="submit" class="btn btn-primary btn-install" onclick="submitRegister()">🚀 Générer mon Addon Stremio</button>

                <!-- Boîte de résultat d'installation -->
                <div class="result-box" id="resultBox">
                    <div style="font-size: 18px; font-weight: 800; color: var(--success); margin-bottom: 8px;">✨ Addon Créé avec Succès !</div>
                    <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 12px;">Votre instance privée et sécurisée est prête.</div>

                    <a id="stremioBtn" href="#" class="btn btn-primary btn-install">📲 Installer dans Stremio</a>

                    <div class="btn-grid">
                        <button type="button" class="btn btn-secondary" onclick="copyManifestUrl()">📋 Copier le lien</button>
                        <a id="webBtn" href="#" target="_blank" class="btn btn-secondary">🌐 Stremio Web</a>
                    </div>

                    <input type="text" id="manifestInput" readonly class="manifest-link-input">
                    <div style="font-size: 11px; color: var(--text-dim);">
                        Conservez votre UUID : <strong id="uuidDisplay" style="color: var(--text-main);"></strong>
                    </div>
                </div>

                <div class="step-footer">
                    <button type="button" class="btn btn-secondary" onclick="goToStep(4)">⬅ Précédent</button>
                    <div></div>
                </div>
            </div>
        </form>
    </div>

    <!-- ========================================================================= -->
    <!-- VUE 2 : GESTION DE CONFIGURATION EXISTANTE                                -->
    <!-- ========================================================================= -->
    <div id="configureContainer" style="display: ${initialTab === 'configure' ? 'block' : 'none'};">
        <!-- Connexion à la configuration -->
        <div id="cfgLoginCard">
            <div class="section-title">Accéder à mes réglages</div>
            <div class="section-desc">Entrez l'UUID de votre instance et le mot de passe associé pour charger et modifier vos options.</div>

            <form id="cfgLoginForm" onsubmit="event.preventDefault(); submitLogin();">
                <div class="form-group">
                    <label for="cfgUuid">UUID de l'Instance *</label>
                    <input type="text" id="cfgUuid" name="username" autocomplete="username" value="${initialUuid || ""}" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" required>
                </div>

                <div class="form-group">
                    <label for="cfgPassword">Mot de passe de vos réglages *</label>
                    <div class="input-row">
                        <input type="password" id="cfgPassword" name="password" autocomplete="current-password" placeholder="Votre mot de passe" required>
                        <button type="button" class="btn-eye" onclick="togglePassVisibility('cfgPassword', this)" title="Afficher/Masquer le mot de passe">👁️</button>
                    </div>
                </div>

                <button type="submit" class="btn btn-primary btn-install">🔓 Charger ma Configuration</button>
                <div id="cfgLoginError" class="status-badge error" style="margin-top: 10px;"></div>
            </form>
        </div>

        <!-- Formulaire d'édition une fois connecté -->
        <div id="cfgEditCard" style="display: none;">
            <div class="section-title">Modifier ma Configuration</div>
            <div class="section-desc">Vos modifications seront appliquées instantanément sans changer votre lien Stremio.</div>

            <!-- Liens Stremio Express -->
            <div style="background: #090e18; border: 1px solid var(--card-border); border-radius: 14px; padding: 14px; margin-bottom: 20px;">
                <div style="font-size: 12px; color: var(--text-dim); margin-bottom: 6px;">URL de votre Addon :</div>
                <input type="text" id="editManifestInput" readonly class="manifest-link-input" style="margin: 0 0 10px 0;">
                <div class="btn-grid">
                    <a id="editStremioBtn" href="#" class="btn btn-primary" style="padding: 10px;">📲 Réinstaller Stremio</a>
                    <a id="editWebBtn" href="#" target="_blank" class="btn btn-secondary" style="padding: 10px;">🌐 Ouvrir Stremio Web</a>
                </div>
            </div>

            <form id="cfgEditForm" onsubmit="event.preventDefault(); submitUpdate();">
                <div class="form-group">
                    <label for="editPseudo">Pseudo / Nom dans Stremio</label>
                    <input type="text" id="editPseudo" name="username" autocomplete="username" placeholder="Ex: Salon, Alex...">
                </div>

                <div class="form-group">
                    <label for="editApiKey">Clé API AllDebrid (Optionnel si inchangée)</label>
                    <div class="input-row">
                        <input type="password" id="editApiKey" placeholder="Laisser vide pour ne pas modifier">
                        <button type="button" class="btn-eye" onclick="togglePassVisibility('editApiKey', this)" title="Afficher/Masquer la clé">👁️</button>
                        <button type="button" class="btn btn-check" onclick="checkEditAllDebrid()">Tester</button>
                    </div>
                    <div id="editAdStatus" class="status-badge"></div>
                </div>

                <div class="form-group">
                    <label for="editTmdbKey">Clé API TMDB (Optionnel)</label>
                    <div class="input-row">
                        <input type="password" id="editTmdbKey" placeholder="Laisser vide pour clé CinéCloud par défaut">
                        <button type="button" class="btn-eye" onclick="togglePassVisibility('editTmdbKey', this)" title="Afficher/Masquer la clé">👁️</button>
                        <button type="button" class="btn btn-check" onclick="checkEditTmdb()">Tester</button>
                    </div>
                    <div id="editTmdbStatus" class="status-badge"></div>
                </div>

                <div class="form-group">
                    <label>Mode Prowlarr (Indexeurs de Torrents)</label>
                    <div class="prowlarr-mode-cards">
                        <div class="prowlarr-card active" id="editProwlarrCard_shared" onclick="selectEditProwlarrMode('shared')">
                            <div class="prowlarr-card-icon">🤝</div>
                            <div class="prowlarr-card-title">Partagé</div>
                            <div class="prowlarr-card-desc">Crowdsourcing : cache mutualisé & RSS pour tous</div>
                        </div>
                        <div class="prowlarr-card" id="editProwlarrCard_local" onclick="selectEditProwlarrMode('local')">
                            <div class="prowlarr-card-icon">💾</div>
                            <div class="prowlarr-card-title">Local</div>
                            <div class="prowlarr-card-desc">Pas de Prowlarr personnel. Cache partagé + Torrentio</div>
                        </div>
                        <div class="prowlarr-card" id="editProwlarrCard_private" onclick="selectEditProwlarrMode('private')">
                            <div class="prowlarr-card-icon">🔒</div>
                            <div class="prowlarr-card-title">Privé</div>
                            <div class="prowlarr-card-desc">Votre Prowlarr sans ajout dans le cache public</div>
                        </div>
                    </div>
                    <input type="hidden" id="editProwlarrMode" value="shared">
                </div>

                <div id="editProwlarrCredentialsBlock">
                    <div class="form-group">
                        <label for="editProwlarrUrl">URL Prowlarr</label>
                        <input type="text" id="editProwlarrUrl" placeholder="Ex: http://prowlarr:9696 ou http://192.168.1.50:9696">
                    </div>
                    <div class="form-group">
                        <label for="editProwlarrKey">Clé API Prowlarr</label>
                        <div class="input-row">
                            <input type="password" id="editProwlarrKey" placeholder="Laisser vide pour ne pas modifier">
                            <button type="button" class="btn-eye" onclick="togglePassVisibility('editProwlarrKey', this)" title="Afficher/Masquer">👁️</button>
                            <button type="button" class="btn btn-check" onclick="checkEditProwlarr()">Tester</button>
                        </div>
                        <div id="editProwlarrStatus" class="status-badge"></div>
                    </div>
                </div>

                <div class="checkbox-card" style="margin-bottom: 18px;" onclick="toggleCheckbox('editAllowDownload')">
                    <div>
                        <div class="item-label">⏳ Mode Téléchargement AllDebrid</div>
                        <div class="item-sub">Afficher les torrents non encore en cache AllDebrid et lancer leur téléchargement en tâche de fond</div>
                    </div>
                    <input type="checkbox" id="editAllowDownload" onclick="event.stopPropagation()">
                </div>

                <div class="form-group">
                    <label>Priorités Linguistiques</label>
                    <div class="draggable-list" id="editLangList">
                        <!-- Généré dynamiquement lors du login -->
                    </div>
                    <div class="checkbox-card" onclick="toggleCheckbox('editHideUnknown')">
                        <div>
                            <div class="item-label">Effacer les langues inconnues</div>
                            <div class="item-sub">Masquer les flux sans langue détectée</div>
                        </div>
                        <input type="checkbox" id="editHideUnknown" onclick="event.stopPropagation()">
                    </div>
                </div>

                <div class="form-group">
                    <label>Ordre des Résolutions (Déplaçable)</label>
                    <div class="resolutions-bar" id="editResBar">
                        <!-- Généré dynamiquement lors du login -->
                    </div>
                </div>

                <div class="form-group">
                    <label for="editSortBy">Critère de Tri Principal</label>
                    <select id="editSortBy">
                        <option value="quality">Par Qualité puis Seeders (Recommandé)</option>
                        <option value="size">Par Taille Décroissante (Remux / Gros débits)</option>
                        <option value="size_asc">Par Taille Croissante (Connexions modestes)</option>
                    </select>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <div class="form-group">
                        <label for="editMaxSizeGb">Taille Max (Go)</label>
                        <input type="number" id="editMaxSizeGb" placeholder="Ex: 150 (0 = Illimité)" value="150" min="0" step="0.5">
                    </div>
                    <div class="form-group">
                        <label for="editMaxStreams">Nombre Max Flux</label>
                        <input type="number" id="editMaxStreams" placeholder="0 = Tout afficher" min="0" step="1">
                    </div>
                </div>

                <div class="form-group">
                    <label>Gestion des Catalogues Stremio</label>
                    <div class="checkbox-card" style="border-color: #38bdf8; margin-bottom: 12px;" onclick="toggleCheckbox('editDisableCatalogs'); toggleEditCatalogListVisibility();">
                        <div>
                            <div class="item-label" style="color: #38bdf8;">🚫 Désactiver tous les catalogues</div>
                            <div class="item-sub">Supprime les rangées de catalogues de l'accueil Stremio (conserve uniquement la recherche et les flux vidéo)</div>
                        </div>
                        <input type="checkbox" id="editDisableCatalogs" onclick="event.stopPropagation(); toggleEditCatalogListVisibility();">
                    </div>
                    <div id="editCatalogsList">
                        <div class="checkbox-card" onclick="toggleCheckbox('edit_cat_magnets')">
                            <div class="item-label">Mes Fichiers Cloud ☁️</div>
                            <input type="checkbox" id="edit_cat_magnets" onclick="event.stopPropagation()">
                        </div>
                        <div class="checkbox-card" onclick="toggleCheckbox('edit_cat_links')">
                            <div class="item-label">Mes Liens & Historique 🕒</div>
                            <input type="checkbox" id="edit_cat_links" onclick="event.stopPropagation()">
                        </div>
                        <div class="checkbox-card" onclick="toggleCheckbox('edit_cat_animes')">
                            <div class="item-label">Mes Animés 🇯🇵</div>
                            <input type="checkbox" id="edit_cat_animes" onclick="event.stopPropagation()">
                        </div>
                        <div class="checkbox-card" onclick="toggleCheckbox('edit_cat_reco')">
                            <div class="item-label">Recommandations Populaires 🍿</div>
                            <input type="checkbox" id="edit_cat_reco" onclick="event.stopPropagation()">
                        </div>
                    </div>
                </div>

                <div class="form-group">
                    <label for="editNewPassword">Changer le mot de passe (Optionnel)</label>
                    <div class="input-row">
                        <input type="password" id="editNewPassword" name="password" autocomplete="new-password" placeholder="Nouveau mot de passe (optionnel)">
                        <button type="button" class="btn-eye" onclick="togglePassVisibility('editNewPassword', this)" title="Afficher/Masquer le mot de passe">👁️</button>
                    </div>
                </div>

                <button type="submit" class="btn btn-primary btn-install">💾 Enregistrer les Modifications</button>
                <button type="button" class="btn btn-danger" style="width: 100%; margin-top: 10px;" onclick="submitDelete()">🗑️ Supprimer définitivement cette instance</button>
            </form>
        </div>
    </div>

    <div class="footer-links">
        <a href="#" onclick="switchMainMode('register'); return false;">⚡ Créer un nouvel Addon</a> • 
        <a href="#" onclick="switchMainMode('configure'); return false;">⚙️ Gérer ma configuration</a> • 
        <a href="/admin">🛡️ Administration</a>
    </div>
</div>

<script>
    let currentStep = 1;
    let activeUuid = "${initialUuid || ""}";
    let activePass = "";

    const DEFAULT_LANG_DEFS = {
        multi_vff: { label: '🇫🇷 MULTI (VFF + VOSTFR)', checked: true },
        vff: { label: '🇫🇷 VFF (TrueFrench)', checked: true },
        vfi: { label: '⚜️ VFI / VFQ (Québec / International)', checked: true },
        multi: { label: '🌐 MULTI (Général)', checked: true },
        vf: { label: '🇫🇷 VF Standard', checked: true },
        vostfr: { label: '💬 VOSTFR (Sous-titres FR)', checked: true },
        vo: { label: '🇬🇧 VO / Anglais', checked: true }
    };

    const DEFAULT_RES_DEFS = {
        '4k': { label: '✨ 4K / UHD' },
        '1080p': { label: '💎 1080p Full HD' },
        '720p': { label: '📺 720p HD' },
        '480p': { label: '📼 480p SD' }
    };

    function switchMainMode(mode) {
        if (mode === 'register') {
            document.getElementById('modeRegisterBtn').classList.add('active');
            document.getElementById('modeConfigureBtn').classList.remove('active');
            document.getElementById('registerContainer').style.display = 'block';
            document.getElementById('configureContainer').style.display = 'none';
        } else {
            document.getElementById('modeRegisterBtn').classList.remove('active');
            document.getElementById('modeConfigureBtn').classList.add('active');
            document.getElementById('registerContainer').style.display = 'none';
            document.getElementById('configureContainer').style.display = 'block';
            if (activeUuid) {
                const passField = document.getElementById('cfgPassword');
                if (passField) passField.focus();
            }
        }
    }

    function goToStep(step) {
        currentStep = step;
        document.querySelectorAll('.step-content').forEach(c => c.classList.remove('active'));
        document.querySelectorAll('.step-node').forEach((n, idx) => {
            n.classList.remove('active');
            if (idx + 1 === step) n.classList.add('active');
            if (idx + 1 < step) n.classList.add('completed');
            else n.classList.remove('completed');
        });
        const target = document.getElementById('step' + step);
        if (target) target.classList.add('active');
    }

    function toggleCheckbox(id) {
        const cb = document.getElementById(id);
        if (cb) cb.checked = !cb.checked;
    }

    function togglePassVisibility(inputId, btn) {
        const input = document.getElementById(inputId);
        if (!input) return;
        if (input.type === 'password') {
            input.type = 'text';
            if (btn) btn.textContent = '🔒';
        } else {
            input.type = 'password';
            if (btn) btn.textContent = '👁️';
        }
    }

    function selectProwlarrMode(mode) {
        const field = document.getElementById('prowlarrMode');
        if (field) field.value = mode;
        ['shared', 'local', 'private'].forEach(m => {
            const card = document.getElementById('prowlarrCard_' + m);
            if (card) {
                if (m === mode) card.classList.add('active');
                else card.classList.remove('active');
            }
        });
        const creds = document.getElementById('prowlarrCredentialsBlock');
        if (creds) {
            creds.style.display = (mode === 'local') ? 'none' : 'block';
        }
    }

    function selectEditProwlarrMode(mode) {
        const field = document.getElementById('editProwlarrMode');
        if (field) field.value = mode;
        ['shared', 'local', 'private'].forEach(m => {
            const card = document.getElementById('editProwlarrCard_' + m);
            if (card) {
                if (m === mode) card.classList.add('active');
                else card.classList.remove('active');
            }
        });
        const creds = document.getElementById('editProwlarrCredentialsBlock');
        if (creds) {
            creds.style.display = (mode === 'local') ? 'none' : 'block';
        }
    }

    function toggleCatalogListVisibility() {
        const disabled = document.getElementById('disableCatalogs')?.checked;
        const list = document.getElementById('catalogsList');
        if (list) {
            list.style.opacity = disabled ? '0.35' : '1';
            list.style.pointerEvents = disabled ? 'none' : 'auto';
        }
    }

    function toggleEditCatalogListVisibility() {
        const disabled = document.getElementById('editDisableCatalogs')?.checked;
        const list = document.getElementById('editCatalogsList');
        if (list) {
            list.style.opacity = disabled ? '0.35' : '1';
            list.style.pointerEvents = disabled ? 'none' : 'auto';
        }
    }

    async function checkWarpStatus() {
        const dot = document.getElementById('warpDot');
        const desc = document.getElementById('warpDesc');
        try {
            const res = await fetch('/api/status/warp');
            const data = await res.json();
            if (data.active) {
                dot.className = 'warp-dot active';
                desc.textContent = 'Proxy WARP Connecté (' + data.mode.toUpperCase() + ') • Tout est opérationnel';
            } else if (data.configured) {
                dot.className = 'warp-dot fallback';
                desc.textContent = 'Proxy en secours direct actif • Le streaming continue normalement';
            } else {
                dot.className = 'warp-dot';
                desc.textContent = 'Mode Direct sans Proxy WARP';
            }
        } catch (e) {
            dot.className = 'warp-dot fallback';
            desc.textContent = 'Statut indisponible';
        }
    }

    async function checkAllDebridKeyGeneric(key, badgeId) {
        const badge = document.getElementById(badgeId);
        if (!key) {
            badge.className = 'status-badge error';
            badge.textContent = 'Veuillez saisir votre clé API AllDebrid';
            badge.style.display = 'inline-block';
            return;
        }
        badge.className = 'status-badge';
        badge.style.display = 'inline-block';
        badge.textContent = 'Vérification en cours...';

        try {
            const res = await fetch('/api/check/alldebrid', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey: key })
            });
            const data = await res.json();
            if (data.valid) {
                badge.className = 'status-badge success';
                badge.textContent = '✅ Valide • Utilisateur: ' + data.username + (data.isPremium ? ' (⭐ Premium Actif)' : ' (Compte Gratuit)');
            } else {
                badge.className = 'status-badge error';
                badge.textContent = '❌ ' + (data.error || 'Clé AllDebrid invalide');
            }
        } catch (e) {
            badge.className = 'status-badge error';
            badge.textContent = '❌ Erreur de connexion au serveur';
        }
    }

    function checkAllDebrid() {
        const apiKey = document.getElementById('apiKey').value.trim();
        checkAllDebridKeyGeneric(apiKey, 'adStatus');
    }

    function checkEditAllDebrid() {
        const apiKey = document.getElementById('editApiKey').value.trim();
        checkAllDebridKeyGeneric(apiKey, 'editAdStatus');
    }

    async function checkTmdbKeyGeneric(key, badgeId) {
        const badge = document.getElementById(badgeId);
        if (!key) {
            badge.className = 'status-badge success';
            badge.style.display = 'inline-block';
            badge.textContent = 'ℹ️ Clé par défaut CinéCloud utilisée';
            return;
        }
        badge.className = 'status-badge';
        badge.style.display = 'inline-block';
        badge.textContent = 'Vérification TMDB...';

        try {
            const res = await fetch('/api/check/tmdb', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tmdbKey: key })
            });
            const data = await res.json();
            if (data.valid) {
                badge.className = 'status-badge success';
                badge.textContent = '✅ Clé TMDB valide et opérationnelle';
            } else {
                badge.className = 'status-badge error';
                badge.textContent = '❌ ' + (data.error || 'Clé TMDB invalide');
            }
        } catch (e) {
            badge.className = 'status-badge error';
            badge.textContent = '❌ Erreur de vérification TMDB';
        }
    }

    function checkTmdb() {
        const tmdbKey = document.getElementById('tmdbKey').value.trim();
        checkTmdbKeyGeneric(tmdbKey, 'tmdbStatus');
    }

    function checkEditTmdb() {
        const tmdbKey = document.getElementById('editTmdbKey').value.trim();
        checkTmdbKeyGeneric(tmdbKey, 'editTmdbStatus');
    }

    async function checkProwlarrKeyGeneric(url, key, badgeId) {
        const badge = document.getElementById(badgeId);
        if (!url || !key) {
            badge.className = 'status-badge error';
            badge.textContent = 'Veuillez saisir l\'URL et la clé API Prowlarr';
            badge.style.display = 'inline-block';
            return;
        }
        badge.className = 'status-badge';
        badge.style.display = 'inline-block';
        badge.textContent = 'Test de connexion Prowlarr...';
        try {
            const res = await fetch('/api/check/prowlarr', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prowlarrUrl: url, prowlarrKey: key })
            });
            const data = await res.json();
            if (data.valid) {
                badge.className = 'status-badge success';
                badge.textContent = '✅ Prowlarr connecté (' + (data.indexersCount || 0) + ' indexeurs détectés)';
            } else {
                badge.className = 'status-badge error';
                badge.textContent = '❌ ' + (data.error || 'Impossible de joindre Prowlarr');
            }
        } catch (e) {
            badge.className = 'status-badge error';
            badge.textContent = '❌ Erreur réseau lors du test Prowlarr';
        }
    }

    function checkProwlarr() {
        const url = document.getElementById('prowlarrUrl').value.trim();
        const key = document.getElementById('prowlarrKey').value.trim();
        checkProwlarrKeyGeneric(url, key, 'prowlarrStatus');
    }

    function checkEditProwlarr() {
        const url = document.getElementById('editProwlarrUrl').value.trim();
        const key = document.getElementById('editProwlarrKey').value.trim();
        checkProwlarrKeyGeneric(url, key, 'editProwlarrStatus');
    }

    // Gestion Drag-and-Drop pour conteneurs génériques
    function setupDraggableList(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        let draggedItem = null;

        container.addEventListener('dragstart', (e) => {
            draggedItem = e.target.closest('.draggable-item');
            if (draggedItem) draggedItem.classList.add('dragging');
        });
        container.addEventListener('dragend', () => {
            if (draggedItem) draggedItem.classList.remove('dragging');
            draggedItem = null;
        });
        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            const draggableElements = [...container.querySelectorAll('.draggable-item:not(.dragging)')];
            const afterElement = draggableElements.reduce((closest, child) => {
                const box = child.getBoundingClientRect();
                const offset = e.clientY - box.top - box.height / 2;
                if (offset < 0 && offset > closest.offset) {
                    return { offset, element: child };
                } else {
                    return closest;
                }
            }, { offset: Number.NEGATIVE_INFINITY }).element;

            if (draggedItem) {
                if (afterElement == null) container.appendChild(draggedItem);
                else container.insertBefore(draggedItem, afterElement);
            }
        });
    }

    function moveItem(btn, direction) {
        const item = btn.closest('.draggable-item');
        if (direction === -1 && item.previousElementSibling) {
            item.parentNode.insertBefore(item, item.previousElementSibling);
        } else if (direction === 1 && item.nextElementSibling) {
            item.parentNode.insertBefore(item.nextElementSibling, item);
        }
    }

    // Gestion des résolutions déplaçables
    function setupDraggablePills(containerId) {
        const bar = document.getElementById(containerId);
        if (!bar) return;
        let draggedPill = null;

        bar.addEventListener('dragstart', (e) => {
            draggedPill = e.target.closest('.res-pill');
            if (draggedPill) draggedPill.style.opacity = '0.5';
        });
        bar.addEventListener('dragend', () => {
            if (draggedPill) draggedPill.style.opacity = '1';
            draggedPill = null;
        });
        bar.addEventListener('dragover', (e) => {
            e.preventDefault();
            const target = e.target.closest('.res-pill');
            if (target && target !== draggedPill) {
                const rect = target.getBoundingClientRect();
                const next = (e.clientX - rect.left) / (rect.right - rect.left) > 0.5;
                bar.insertBefore(draggedPill, next && target.nextSibling || target);
            }
        });
    }

    function toggleResolution(btn) {
        const pill = btn.closest('.res-pill');
        if (pill) {
            pill.classList.toggle('active');
            pill.classList.toggle('disabled');
        }
    }

    function renderLangItems(containerId, langPrefString) {
        const container = document.getElementById(containerId);
        if (!container) return;
        const requestedLangs = (langPrefString || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        const allKeys = Object.keys(DEFAULT_LANG_DEFS);
        const ordered = [...requestedLangs, ...allKeys.filter(k => !requestedLangs.includes(k))];

        container.innerHTML = ordered.map(key => {
            const def = DEFAULT_LANG_DEFS[key] || { label: key.toUpperCase(), checked: false };
            const isChecked = requestedLangs.length === 0 ? true : requestedLangs.includes(key);
            return \`
                <div class="draggable-item" draggable="true" data-lang="\${key}">
                    <div class="item-left">
                        <span class="drag-handle">☰</span>
                        <input type="checkbox" class="lang-check" \${isChecked ? 'checked' : ''}>
                        <span class="item-label">\${def.label}</span>
                    </div>
                    <div class="item-actions">
                        <button type="button" class="btn-icon" onclick="moveItem(this, -1)">▲</button>
                        <button type="button" class="btn-icon" onclick="moveItem(this, 1)">▼</button>
                    </div>
                </div>
            \`;
        }).join('');
    }

    function renderResPills(containerId, resolutionsString) {
        const container = document.getElementById(containerId);
        if (!container) return;
        const requested = (resolutionsString || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        const allKeys = ['4k', '1080p', '720p', '480p'];
        const ordered = [...requested, ...allKeys.filter(k => !requested.includes(k))];

        container.innerHTML = ordered.map(key => {
            const def = DEFAULT_RES_DEFS[key] || { label: key.toUpperCase() };
            const isActive = requested.length === 0 ? true : requested.includes(key);
            return \`
                <div class="res-pill \${isActive ? 'active' : 'disabled'}" draggable="true" data-res="\${key}">
                    <span>\${def.label}</span>
                    <span class="pill-del" onclick="toggleResolution(this)">✕</span>
                </div>
            \`;
        }).join('');
    }

    // Inscription / Création
    async function submitRegister() {
        const apiKey = document.getElementById('apiKey').value.trim();
        const password = document.getElementById('password').value;
        const pseudo = document.getElementById('pseudo').value.trim();
        const tmdbKey = document.getElementById('tmdbKey').value.trim() || 'default';
        const hideUnknownLanguages = document.getElementById('hideUnknownLanguages').checked;
        const sortBy = document.getElementById('sortBy').value;
        const maxSizeGb = parseFloat(document.getElementById('maxSizeGb').value) || 150;
        const maxStreams = parseInt(document.getElementById('maxStreams').value, 10) || 0;
        const prowlarrMode = document.getElementById('prowlarrMode')?.value || 'shared';
        const prowlarrUrl = document.getElementById('prowlarrUrl')?.value.trim() || '';
        const prowlarrKey = document.getElementById('prowlarrKey')?.value.trim() || '';
        const allowDownload = Boolean(document.getElementById('allowDownload')?.checked);
        const disableCatalogs = Boolean(document.getElementById('disableCatalogs')?.checked);

        if (!apiKey) {
            alert("Veuillez saisir votre clé API AllDebrid.");
            goToStep(1);
            return;
        }
        if (!password || password.length < 4) {
            alert("Veuillez choisir un mot de passe d'au moins 4 caractères.");
            goToStep(5);
            return;
        }

        const langItems = [...document.querySelectorAll('#langList .draggable-item')];
        const langPref = langItems
            .filter(item => item.querySelector('.lang-check').checked)
            .map(item => item.dataset.lang)
            .join(',');

        const resPills = [...document.querySelectorAll('#resBar .res-pill.active')];
        const resolutions = resPills.map(p => p.dataset.res).join(',');

        const enabledCatalogs = [];
        if (document.getElementById('cat_magnets').checked) {
            enabledCatalogs.push('my_ad_magnets', 'my_ad_magnets_series');
        }
        if (document.getElementById('cat_links').checked) {
            enabledCatalogs.push('my_ad_links', 'my_ad_links_series', 'my_ad_history', 'my_ad_history_series');
        }
        if (document.getElementById('cat_animes').checked) {
            enabledCatalogs.push('my_ad_animes', 'my_ad_animes_movies');
        }
        if (document.getElementById('cat_reco').checked) {
            enabledCatalogs.push('my_ad_reco_movies', 'my_ad_reco_series', 'my_ad_reco_animes', 'my_ad_reco_animes_movies');
        }

        try {
            const res = await fetch('/api/user/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apiKey,
                    password,
                    pseudo,
                    tmdbKey,
                    langPref,
                    resolutions,
                    hideUnknownLanguages,
                    sortBy,
                    maxSizeGb,
                    maxStreams,
                    enabledCatalogs,
                    prowlarrMode,
                    prowlarrUrl,
                    prowlarrKey,
                    allowDownload,
                    disableCatalogs
                })
            });
            const data = await res.json();
            if (data.success) {
                document.getElementById('manifestInput').value = data.manifestUrl;
                document.getElementById('stremioBtn').href = data.stremioUrl;
                document.getElementById('webBtn').href = 'https://web.stremio.com/#/addons?addon=' + encodeURIComponent(data.manifestUrl);
                document.getElementById('uuidDisplay').textContent = data.uuid;
                document.getElementById('resultBox').style.display = 'block';
                document.getElementById('resultBox').scrollIntoView({ behavior: 'smooth' });
            } else {
                alert('Erreur: ' + (data.error || 'Impossible de créer l addon'));
            }
        } catch (e) {
            alert('Erreur de connexion au serveur.');
        }
    }

    // Connexion & Chargement des Réglages
    async function submitLogin() {
        const uuid = document.getElementById('cfgUuid').value.trim();
        const password = document.getElementById('cfgPassword').value;
        const errBox = document.getElementById('cfgLoginError');

        if (!uuid || !password) {
            errBox.textContent = "Veuillez renseigner votre UUID et votre mot de passe.";
            errBox.style.display = "block";
            return;
        }
        errBox.style.display = "none";

        try {
            const res = await fetch('/api/user/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uuid, password })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                errBox.textContent = data.error || "UUID ou mot de passe incorrect.";
                errBox.style.display = "block";
                return;
            }

            activeUuid = uuid;
            activePass = password;

            document.getElementById('cfgLoginCard').style.display = 'none';
            document.getElementById('cfgEditCard').style.display = 'block';

            document.getElementById('editManifestInput').value = data.manifestUrl;
            document.getElementById('editStremioBtn').href = data.stremioUrl;
            document.getElementById('editWebBtn').href = 'https://web.stremio.com/#/addons?addon=' + encodeURIComponent(data.manifestUrl);

            const cfg = data.config || {};
            document.getElementById('editPseudo').value = cfg.pseudo || '';
            document.getElementById('editTmdbKey').value = (cfg.tmdbKey === 'default' ? '' : cfg.tmdbKey) || '';
            document.getElementById('editSortBy').value = cfg.sortBy || 'quality';
            document.getElementById('editMaxSizeGb').value = (cfg.maxSizeGb !== undefined && cfg.maxSizeGb !== null) ? cfg.maxSizeGb : 150;
            document.getElementById('editMaxStreams').value = cfg.maxStreams || '';
            document.getElementById('editHideUnknown').checked = Boolean(cfg.hideUnknownLanguages);

            selectEditProwlarrMode(cfg.prowlarrMode || 'shared');
            document.getElementById('editProwlarrUrl').value = cfg.prowlarrUrl || '';
            document.getElementById('editProwlarrKey').value = cfg.prowlarrKey || '';
            document.getElementById('editAllowDownload').checked = Boolean(cfg.allowDownload);
            document.getElementById('editDisableCatalogs').checked = Boolean(cfg.disableCatalogs);
            toggleEditCatalogListVisibility();

            const cats = Array.isArray(cfg.enabledCatalogs) ? cfg.enabledCatalogs : [];
            document.getElementById('edit_cat_magnets').checked = cats.includes('my_ad_magnets');
            document.getElementById('edit_cat_links').checked = cats.includes('my_ad_links');
            document.getElementById('edit_cat_animes').checked = cats.includes('my_ad_animes');
            document.getElementById('edit_cat_reco').checked = cats.includes('my_ad_reco_movies');

            renderLangItems('editLangList', cfg.langPref);
            setupDraggableList('editLangList');

            renderResPills('editResBar', cfg.resolutions);
            setupDraggablePills('editResBar');
        } catch (e) {
            errBox.textContent = "Erreur de connexion au serveur.";
            errBox.style.display = "block";
        }
    }

    // Mise à jour de la configuration
    async function submitUpdate() {
        const pseudo = document.getElementById('editPseudo').value.trim();
        const apiKey = document.getElementById('editApiKey').value.trim();
        const tmdbKey = document.getElementById('editTmdbKey').value.trim() || 'default';
        const newPassword = document.getElementById('editNewPassword').value;
        const hideUnknownLanguages = document.getElementById('editHideUnknown').checked;
        const sortBy = document.getElementById('editSortBy').value;
        const maxSizeGb = parseFloat(document.getElementById('editMaxSizeGb').value) || 150;
        const maxStreams = parseInt(document.getElementById('editMaxStreams').value, 10) || 0;
        const prowlarrMode = document.getElementById('editProwlarrMode')?.value || 'shared';
        const prowlarrUrl = document.getElementById('editProwlarrUrl')?.value.trim() || '';
        const prowlarrKey = document.getElementById('editProwlarrKey')?.value.trim() || '';
        const allowDownload = Boolean(document.getElementById('editAllowDownload')?.checked);
        const disableCatalogs = Boolean(document.getElementById('editDisableCatalogs')?.checked);

        const langItems = [...document.querySelectorAll('#editLangList .draggable-item')];
        const langPref = langItems
            .filter(item => item.querySelector('.lang-check').checked)
            .map(item => item.dataset.lang)
            .join(',');

        const resPills = [...document.querySelectorAll('#editResBar .res-pill.active')];
        const resolutions = resPills.map(p => p.dataset.res).join(',');

        const enabledCatalogs = [];
        if (document.getElementById('edit_cat_magnets').checked) {
            enabledCatalogs.push('my_ad_magnets', 'my_ad_magnets_series');
        }
        if (document.getElementById('edit_cat_links').checked) {
            enabledCatalogs.push('my_ad_links', 'my_ad_links_series', 'my_ad_history', 'my_ad_history_series');
        }
        if (document.getElementById('edit_cat_animes').checked) {
            enabledCatalogs.push('my_ad_animes', 'my_ad_animes_movies');
        }
        if (document.getElementById('edit_cat_reco').checked) {
            enabledCatalogs.push('my_ad_reco_movies', 'my_ad_reco_series', 'my_ad_reco_animes', 'my_ad_reco_animes_movies');
        }

        try {
            const res = await fetch('/api/user/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    uuid: activeUuid,
                    password: activePass,
                    pseudo,
                    apiKey,
                    newPassword,
                    tmdbKey,
                    langPref,
                    resolutions,
                    hideUnknownLanguages,
                    sortBy,
                    maxSizeGb,
                    maxStreams,
                    enabledCatalogs,
                    prowlarrMode,
                    prowlarrUrl,
                    prowlarrKey,
                    allowDownload,
                    disableCatalogs
                })
            });
            const data = await res.json();
            if (data.success) {
                if (newPassword && newPassword.length >= 4) {
                    activePass = newPassword;
                }
                alert("Réglages mis à jour avec succès ! Vos modifications sont immédiatement actives dans Stremio.");
            } else {
                alert("Erreur: " + (data.error || "Impossible de mettre à jour"));
            }
        } catch (e) {
            alert("Erreur de connexion au serveur.");
        }
    }

    // Suppression de l'instance
    async function submitDelete() {
        if (!confirm("⚠️ Êtes-vous absolument sûr de vouloir supprimer définitivement cette instance et vos données ? Votre addon cessera immédiatement de fonctionner.")) {
            return;
        }
        try {
            const res = await fetch('/api/user/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uuid: activeUuid, password: activePass })
            });
            const data = await res.json();
            if (data.success) {
                alert("Instance supprimée avec succès.");
                window.location.href = "/";
            } else {
                alert("Erreur: " + (data.error || "Impossible de supprimer l'instance"));
            }
        } catch (e) {
            alert("Erreur de connexion.");
        }
    }

    function copyManifestUrl() {
        const input = document.getElementById('manifestInput');
        input.select();
        navigator.clipboard.writeText(input.value);
        alert('Lien copié dans le presse-papiers !');
    }

    async function fetchStats() {
        try {
            const res = await fetch('/api/stats');
            const data = await res.json();
            if (data) {
                const regEl = document.getElementById('statRegistered');
                if (regEl) regEl.textContent = data.totalUsers || 0;
                const actEl = document.getElementById('statActive');
                if (actEl) actEl.textContent = data.active24h || data.active10m || 1;
                const cchEl = document.getElementById('statCached');
                if (cchEl) cchEl.textContent = (data.totalCachedTorrents || 0) + (data.totalMovies || 0);
            }
        } catch (e) {}
    }

    // Initialisations
    setupDraggableList('langList');
    setupDraggablePills('resBar');
    fetchStats();
    checkWarpStatus();

    if ("${initialTab}" === "configure") {
        switchMainMode('configure');
    }
</script>
</body>
</html>`;
}

function renderAdminPage() {
    return `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CinéCloud FR • Panneau d'Administration</title>
    <link rel="icon" type="image/svg+xml" href="/logo.png">
    <style>
        :root {
            --bg: #07090e;
            --card-bg: rgba(14, 18, 28, 0.95);
            --card-border: #1a2333;
            --accent: #38bdf8;
            --success: #10b981;
            --warning: #f59e0b;
            --danger: #ef4444;
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --text-dim: #64748b;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: var(--bg);
            color: var(--text-main);
            min-height: 100vh;
            padding: 24px 20px;
        }
        .admin-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            max-width: 1100px;
            margin: 0 auto 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--card-border);
        }
        .header-title {
            display: flex;
            align-items: center;
            gap: 12px;
            font-size: 22px;
            font-weight: 800;
            color: #ffffff;
        }
        .header-title span { color: var(--accent); }
        .admin-container {
            max-width: 1100px;
            margin: 0 auto;
        }
        /* Onglets */
        .tabs {
            display: flex;
            gap: 8px;
            margin-bottom: 20px;
            background: #0d121d;
            padding: 6px;
            border-radius: 12px;
            border: 1px solid var(--card-border);
        }
        .tab-btn {
            flex: 1;
            padding: 10px 14px;
            border: none;
            background: transparent;
            color: var(--text-muted);
            font-weight: 700;
            font-size: 13px;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
        }
        .tab-btn.active {
            background: #172238;
            color: var(--accent);
            box-shadow: 0 0 12px rgba(56, 189, 248, 0.2);
        }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        /* Cartes KPI */
        .kpi-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-bottom: 24px;
        }
        .kpi-card {
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: 16px;
            padding: 18px 20px;
        }
        .kpi-title { font-size: 11px; font-weight: 700; color: var(--text-dim); text-transform: uppercase; margin-bottom: 6px; }
        .kpi-val { font-size: 26px; font-weight: 900; color: var(--text-main); }
        /* Table des utilisateurs */
        .card {
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: 16px;
            padding: 24px;
            margin-bottom: 20px;
        }
        .card-header {
            font-size: 16px;
            font-weight: 800;
            margin-bottom: 16px;
            color: #ffffff;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
        }
        th, td {
            padding: 12px 14px;
            text-align: left;
            border-bottom: 1px solid var(--card-border);
        }
        th { color: var(--text-dim); font-size: 11px; text-transform: uppercase; }
        /* Terminal de Logs */
        .log-console {
            background: #03060c;
            border: 1px solid var(--card-border);
            border-radius: 12px;
            padding: 14px;
            height: 640px;
            min-height: 600px;
            overflow-y: auto;
            font-family: monospace;
            font-size: 12px;
            line-height: 1.5;
        }
        .log-line {
            display: flex;
            gap: 10px;
            margin-bottom: 4px;
            word-break: break-all;
        }
        .log-time { color: var(--text-dim); }
        .log-level { font-weight: 800; border-radius: 4px; padding: 0 4px; }
        .log-level.INFO { color: var(--accent); }
        .log-level.WARN { color: var(--warning); }
        .log-level.ERROR { color: var(--danger); }
        .log-level.DEBUG { color: #a855f7; }
        .log-mod { color: #34d399; font-weight: 700; }
        .log-msg { color: #f1f5f9; }
        /* Boutons */
        .btn {
            padding: 8px 14px;
            border-radius: 8px;
            border: none;
            cursor: pointer;
            font-weight: 700;
            font-size: 12px;
            transition: all 0.2s;
        }
        .btn-danger { background: rgba(239, 68, 68, 0.2); color: var(--danger); border: 1px solid var(--danger); }
        .btn-danger:hover { background: var(--danger); color: #fff; }
        .btn-primary { background: var(--accent); color: #000; }
        .btn-secondary { background: #1a2333; color: var(--text-main); }
        /* Login Modal Admin */
        #authOverlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(3, 6, 12, 0.95);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
        }
        .auth-box {
            background: #0f1624;
            border: 1px solid var(--card-border);
            border-radius: 20px;
            padding: 36px 32px;
            width: 100%;
            max-width: 400px;
            text-align: center;
        }
        .auth-input {
            width: 100%;
            padding: 12px;
            background: #070a12;
            border: 1px solid var(--card-border);
            border-radius: 10px;
            color: #fff;
            margin: 16px 0;
            text-align: center;
        }
    </style>
</head>
<body>

<div id="authOverlay">
    <div class="auth-box">
        <h2 style="margin-bottom: 8px;">🛡️ Accès Administrateur</h2>
        <div style="font-size: 13px; color: var(--text-muted);">Entrez le mot de passe défini dans ADMIN_PASSWORD.</div>
        <input type="password" id="adminPassword" class="auth-input" placeholder="Mot de passe admin" onkeydown="if(event.key==='Enter')loginAdmin()">
        <button class="btn btn-primary" style="width: 100%; padding: 12px;" onclick="loginAdmin()">Se Connecter</button>
        <div id="authError" style="color: var(--danger); font-size: 12px; margin-top: 10px; display: none;">Mot de passe incorrect</div>
    </div>
</div>

<div class="admin-header">
    <div class="header-title">🛡️ CinéCloud FR <span>Administration</span></div>
    <div>
        <a href="/" class="btn btn-secondary">Retour à l'Addon</a>
        <button class="btn btn-danger" onclick="logoutAdmin()">Déconnexion</button>
    </div>
</div>

<div class="admin-container">
    <div class="tabs">
        <button class="tab-btn active" onclick="showTab('tabStats')">📊 Statistiques & Santé</button>
        <button class="tab-btn" onclick="showTab('tabUsers')">👥 Utilisateurs</button>
        <button class="tab-btn" onclick="showTab('tabLogs')">📜 Logs en Direct</button>
        <button class="tab-btn" onclick="showTab('tabSettings')">⚙️ Configuration Runtime</button>
    </div>

    <!-- Onglet 1 : Stats -->
    <div class="tab-content active" id="tabStats">
        <div class="kpi-grid">
            <div class="kpi-card">
                <div class="kpi-title">Utilisateurs Inscrits</div>
                <div class="kpi-val" id="kpiTotalUsers">--</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-title">Actifs (Dernières 24h)</div>
                <div class="kpi-val" id="kpiActive24h">--</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-title">Torrents en Cache</div>
                <div class="kpi-val" id="kpiTorrents">--</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-title">Torrents Instantanés</div>
                <div class="kpi-val" id="kpiInstant">--</div>
            </div>
        </div>

        <div class="card">
            <div class="card-header">Santé des Services</div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px;">
                <div style="background: #080d1a; padding: 14px; border-radius: 10px; border: 1px solid var(--card-border);">
                    <div style="font-weight: 700; margin-bottom: 6px;">🌐 Proxy Cloudflare WARP</div>
                    <div id="adminWarpStatus" style="font-size: 13px; color: var(--text-muted);">Chargement...</div>
                </div>
                <div style="background: #080d1a; padding: 14px; border-radius: 10px; border: 1px solid var(--card-border);">
                    <div style="font-weight: 700; margin-bottom: 6px;">🧠 Mémoire & Système</div>
                    <div id="adminSysStatus" style="font-size: 13px; color: var(--text-muted);">Chargement...</div>
                </div>
            </div>
        </div>
    </div>

    <!-- Onglet 2 : Utilisateurs -->
    <div class="tab-content" id="tabUsers">
        <div class="card">
            <div class="card-header">
                <span>Comptes Utilisateurs Enregistrés</span>
                <button class="btn btn-secondary" onclick="loadUsers()">🔄 Actualiser</button>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>UUID</th>
                        <th>Pseudo</th>
                        <th>Créé le</th>
                        <th>Dernière Activité</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody id="usersTableBody">
                    <tr><td colspan="5" style="text-align: center; color: var(--text-dim);">Chargement des utilisateurs...</td></tr>
                </tbody>
            </table>
        </div>
    </div>

    <!-- Onglet 3 : Logs -->
    <div class="tab-content" id="tabLogs">
        <div class="card">
            <div class="card-header">
                <div style="display: flex; gap: 10px; align-items: center;">
                    <span>Journal des Événements</span>
                    <select id="logLevelFilter" onchange="loadLogs()" style="background:#090d16; color:#fff; border:1px solid var(--card-border); padding:4px 8px; border-radius:6px; font-size:12px;">
                        <option value="ALL">Tous les niveaux</option>
                        <option value="INFO">INFO</option>
                        <option value="WARN">WARN</option>
                        <option value="ERROR">ERROR</option>
                    </select>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button class="btn btn-secondary" onclick="clearLogsServer()">🗑️ Vider</button>
                    <button class="btn btn-secondary" onclick="loadLogs()">🔄 Actualiser</button>
                </div>
            </div>
            <div class="log-console" id="logConsole"></div>
        </div>
    </div>

    <!-- Onglet 4 : Settings -->
    <div class="tab-content" id="tabSettings">
        <div class="card">
            <div class="card-header">Paramètres Runtime de l'Instance</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                <div>
                    <label style="font-size: 12px; color: var(--text-muted);">Timeout Requêtes AllDebrid (ms)</label>
                    <input type="number" id="settingHttpTimeout" style="width:100%; padding:10px; background:#080d1a; color:#fff; border:1px solid var(--card-border); border-radius:8px; margin-top:4px;">
                </div>
                <div>
                    <label style="font-size: 12px; color: var(--text-muted);">Timeout Prowlarr On-Demand (ms)</label>
                    <input type="number" id="settingProwlarrTimeout" style="width:100%; padding:10px; background:#080d1a; color:#fff; border:1px solid var(--card-border); border-radius:8px; margin-top:4px;">
                </div>
                <div>
                    <label style="font-size: 12px; color: var(--text-muted);">TTL Purge Torrents en Cache (Jours)</label>
                    <input type="number" id="settingCacheTtl" style="width:100%; padding:10px; background:#080d1a; color:#fff; border:1px solid var(--card-border); border-radius:8px; margin-top:4px;">
                </div>
            </div>
            <button class="btn btn-primary" style="margin-top: 18px;" onclick="saveSettings()">Enregistrer les Réglages</button>
        </div>

        <div class="card">
            <div class="card-header">Maintenance & Nettoyage du Cache</div>
            <div style="display: flex; gap: 10px;">
                <button class="btn btn-danger" onclick="clearCacheTarget('torrents')">Vider le Cache des Torrents Prowlarr</button>
                <button class="btn btn-danger" onclick="clearCacheTarget('movies')">Vider le Cache des Métadonnées</button>
            </div>
        </div>
    </div>
</div>

<script>
    let adminToken = sessionStorage.getItem('adminToken');

    function checkAuth() {
        if (adminToken) {
            document.getElementById('authOverlay').style.display = 'none';
            loadAllAdminData();
        } else {
            document.getElementById('authOverlay').style.display = 'flex';
        }
    }

    async function loginAdmin() {
        const pwd = document.getElementById('adminPassword').value;
        const err = document.getElementById('authError');
        try {
            const res = await fetch('/api/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pwd })
            });
            const data = await res.json();
            if (data.success && data.token) {
                adminToken = data.token;
                sessionStorage.setItem('adminToken', adminToken);
                document.getElementById('authOverlay').style.display = 'none';
                loadAllAdminData();
            } else {
                err.style.display = 'block';
            }
        } catch (e) {
            err.textContent = 'Erreur serveur';
            err.style.display = 'block';
        }
    }

    function logoutAdmin() {
        sessionStorage.removeItem('adminToken');
        adminToken = null;
        checkAuth();
    }

    function showTab(tabId) {
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.getElementById(tabId).classList.add('active');
        event.target.classList.add('active');
    }

    async function loadAllAdminData() {
        loadStats();
        loadUsers();
        loadLogs();
        loadSettings();
    }

    async function loadStats() {
        try {
            const res = await fetch('/api/admin/stats', { headers: { 'x-admin-token': adminToken } });
            const data = await res.json();
            document.getElementById('kpiTotalUsers').textContent = data.totalUsers || 0;
            document.getElementById('kpiActive24h').textContent = data.active24h || 0;
            document.getElementById('kpiTorrents').textContent = data.totalCachedTorrents || 0;
            document.getElementById('kpiInstant').textContent = data.instantTorrents || 0;

            document.getElementById('adminWarpStatus').textContent = data.warp
                ? (data.warp.active ? 'Connecté (' + data.warp.mode + ')' : (data.warp.configured ? 'Secours direct actif' : 'Non configuré'))
                : 'Direct';

            document.getElementById('adminSysStatus').textContent = 'Node ' + (data.nodeVersion || '') + ' • RAM: ' + (data.memoryRssMb || 0) + ' MB • Uptime: ' + Math.round(data.uptimeSeconds / 60) + ' min';
        } catch (e) {}
    }

    async function loadUsers() {
        try {
            const res = await fetch('/api/admin/users', { headers: { 'x-admin-token': adminToken } });
            const users = await res.json();
            const tb = document.getElementById('usersTableBody');
            if (!Array.isArray(users) || users.length === 0) {
                tb.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-dim);">Aucun utilisateur enregistré</td></tr>';
                return;
            }
            tb.innerHTML = users.map(u => \`
                <tr>
                    <td style="font-family: monospace; color: var(--accent);">\${u.uuid}</td>
                    <td><strong>\${u.pseudo || 'Anonyme'}</strong></td>
                    <td>\${new Date(u.createdAt * 1000).toLocaleDateString()}</td>
                    <td>\${new Date(u.lastActiveAt * 1000).toLocaleTimeString()}</td>
                    <td>
                        <button class="btn btn-danger" onclick="deleteUserAdmin('\${u.uuid}')">Supprimer</button>
                    </td>
                </tr>
            \`).join('');
        } catch (e) {}
    }

    async function deleteUserAdmin(uuid) {
        if (!confirm('Supprimer définitivement cet utilisateur ?')) return;
        await fetch('/api/admin/users/' + uuid, {
            method: 'DELETE',
            headers: { 'x-admin-token': adminToken }
        });
        loadUsers();
        loadStats();
    }

    async function loadLogs() {
        const level = document.getElementById('logLevelFilter').value;
        try {
            const res = await fetch('/api/admin/logs?limit=150&level=' + level, { headers: { 'x-admin-token': adminToken } });
            const logs = await res.json();
            const con = document.getElementById('logConsole');
            con.innerHTML = logs.map(l => {
                const userBadge = l.user ? ('<span style="background: rgba(56, 189, 248, 0.15); color: var(--accent); padding: 1px 6px; border-radius: 4px; font-weight: 700; margin-right: 4px;">👤 ' + l.user + '</span>') : '';
                return \`
                <div class="log-line">
                    <span class="log-time">\${l.timestamp.slice(11, 19)}</span>
                    <span class="log-level \${l.level}">[\${l.level}]</span>
                    <span class="log-mod">[\${l.module}]</span>
                    \${userBadge}
                    <span class="log-msg">\${l.message}</span>
                </div>
            \`;
            }).join('');
            con.scrollTop = con.scrollHeight;
        } catch (e) {}
    }

    async function clearLogsServer() {
        await fetch('/api/admin/logs/clear', { method: 'POST', headers: { 'x-admin-token': adminToken } });
        loadLogs();
    }

    async function loadSettings() {
        try {
            const res = await fetch('/api/admin/settings', { headers: { 'x-admin-token': adminToken } });
            const data = await res.json();
            document.getElementById('settingHttpTimeout').value = data.httpTimeoutMs || 10000;
            document.getElementById('settingProwlarrTimeout').value = data.prowlarrTimeoutMs || 8000;
            document.getElementById('settingCacheTtl').value = data.cacheTtlDays || 30;
        } catch (e) {}
    }

    async function saveSettings() {
        const httpTimeoutMs = parseInt(document.getElementById('settingHttpTimeout').value, 10);
        const prowlarrTimeoutMs = parseInt(document.getElementById('settingProwlarrTimeout').value, 10);
        const cacheTtlDays = parseInt(document.getElementById('settingCacheTtl').value, 10);

        await fetch('/api/admin/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
            body: JSON.stringify({ httpTimeoutMs, prowlarrTimeoutMs, cacheTtlDays })
        });
        alert('Paramètres enregistrés !');
    }

    async function clearCacheTarget(target) {
        if (!confirm('Vider ce cache ?')) return;
        await fetch('/api/admin/cache/clear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
            body: JSON.stringify({ target })
        });
        alert('Cache vidé avec succès !');
        loadStats();
    }

    checkAuth();
    setInterval(() => { if (adminToken) loadLogs(); }, 3000);
</script>
</body>
</html>`;
}

module.exports = {
    LOGO_SVG,
    BACKGROUND_SVG,
    renderConfigPage,
    renderAdminPage
};
