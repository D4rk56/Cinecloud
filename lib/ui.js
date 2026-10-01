"use strict";

/**
 * Module d'interface utilisateur pour CinéCloud FR.
 * Génère les pages HTML/CSS/JS modernes avec le style sombre Cyber / Stream-Fusion.
 */

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0a0f1d"/>
      <stop offset="50%" stop-color="#050813"/>
      <stop offset="100%" stop-color="#02040a"/>
    </linearGradient>
    <linearGradient id="borderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.6"/>
      <stop offset="50%" stop-color="#818cf8" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#0284c7" stop-opacity="0.5"/>
    </linearGradient>
    <radialGradient id="ambientGlow" cx="50%" cy="40%" r="55%">
      <stop offset="0%" stop-color="#0284c7" stop-opacity="0.3"/>
      <stop offset="60%" stop-color="#38bdf8" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="cloudGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="40%" stop-color="#0284c7"/>
      <stop offset="100%" stop-color="#1d4ed8"/>
    </linearGradient>
    <linearGradient id="playGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f8fafc"/>
      <stop offset="100%" stop-color="#cbd5e1"/>
    </linearGradient>
    <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="8" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
  </defs>
  <!-- Fond Squircle Élégant -->
  <rect width="512" height="512" rx="112" fill="url(#bgGrad)"/>
  <rect x="2" y="2" width="508" height="508" rx="110" fill="none" stroke="url(#borderGrad)" stroke-width="2.5"/>
  <!-- Halo Ambiant -->
  <circle cx="256" cy="205" r="150" fill="url(#ambientGlow)"/>
  <!-- Anneau Orbital Fin -->
  <circle cx="256" cy="205" r="125" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-opacity="0.25" stroke-dasharray="8 6"/>
  <!-- Nuage Stylisé Haute Précision -->
  <g filter="url(#softGlow)">
    <path d="M332 245c0-18-12-33-28-37-3-22-22-38-45-38-16 0-30 8-38 21-6-4-13-6-21-6-19 0-35 15-36 34-18 4-32 20-32 39 0 22 18 40 40 40h152c24 0 44-19 44-43 0-21-15-39-36-42z" fill="url(#cloudGrad)"/>
  </g>
  <!-- Prisme / Icône Lecture Centrale Biseautée -->
  <polygon points="242,212 242,274 292,243" fill="url(#playGrad)"/>
  <!-- Typographie Épurée Cinécloud -->
  <text x="256" y="420" text-anchor="middle" fill="#ffffff" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="44" font-weight="900" letter-spacing="3">CINÉCLOUD</text>
  <text x="256" y="452" text-anchor="middle" fill="#38bdf8" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="700" letter-spacing="6">STREAMING HYBRIDE</text>
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
    const safeTab = String(initialTab || "register").replace(/[^a-zA-Z0-9_-]/g, "");
    const safeUuid = String(initialUuid || "").replace(/[^a-zA-Z0-9_-]/g, "");
    return `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cinécloud • Addon de Streaming Haute Performance</title>
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
        .btn-chip {
            background: rgba(56, 189, 248, 0.08);
            border: 1px solid rgba(56, 189, 248, 0.25);
            color: var(--accent-cyan);
            border-radius: 6px;
            padding: 3px 8px;
            font-size: 11px;
            cursor: pointer;
            transition: all 0.2s;
        }
        .btn-chip:hover {
            background: rgba(56, 189, 248, 0.2);
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
        .preset-card-btn {
            background: #0f1624;
            border: 1px solid var(--card-border);
            border-radius: 12px;
            padding: 12px 10px;
            text-align: center;
            cursor: pointer;
            transition: all 0.2s ease;
        }
        .preset-card-btn:hover {
            border-color: var(--accent-cyan);
            background: rgba(56, 189, 248, 0.08);
            transform: translateY(-2px);
        }
        .preset-card-btn.active-preset {
            border-color: var(--accent-cyan);
            box-shadow: 0 0 14px rgba(56, 189, 248, 0.25);
            background: #111e38;
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
            <img src="/logo.png" alt="Cinécloud">
        </div>
        <h1 class="brand-title">Cinécloud</h1>
        <div class="brand-subtitle">Streaming haute performance • AllDebrid & Torbox</div>
    </div>

    <!-- Sélecteur Principal : Créer ou Gérer -->
    <div class="main-mode-tabs">
        <button type="button" class="main-mode-btn ${initialTab === 'configure' ? '' : 'active'}" id="modeRegisterBtn" onclick="switchMainMode('register')">⚡ Nouveau Manifest / Profil</button>
        <button type="button" class="main-mode-btn ${initialTab === 'configure' ? 'active' : ''}" id="modeConfigureBtn" onclick="switchMainMode('configure')">⚙️ Gérer mon Profil / Manifest</button>
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
    <!-- VUE 1 : CRÉATION DE MANIFEST / PROFIL (STEPPER)                           -->
    <!-- ========================================================================= -->
    <div id="registerContainer" style="display: ${initialTab === 'configure' ? 'none' : 'block'};">
        <!-- Navigation Stepper -->
        <div class="stepper-nav">
            <button type="button" class="step-node active" onclick="goToStep(1)">
                <div class="step-circle">⚡</div>
                <div class="step-label" id="step1Label">Débrid</div>
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
                <div class="step-label">Qualité & Cache</div>
            </button>
            <button type="button" class="step-node" onclick="goToStep(5)">
                <div class="step-circle">👤</div>
                <div class="step-label">Installation</div>
            </button>
        </div>

        <form id="configForm" onsubmit="event.preventDefault();">
            <!-- Étape 1 : Fournisseur Débrid (AllDebrid ou Torbox) -->
            <div class="step-content active" id="step1">
                <div class="section-title">Fournisseur Débrid</div>
                <div class="section-desc">Choisissez votre service de débridage haute performance (AllDebrid ou Torbox).</div>

                <div class="prowlarr-mode-cards" style="grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); margin-bottom: 20px;">
                    <div class="prowlarr-card active" id="debridCard_alldebrid" onclick="selectDebridProvider('alldebrid')">
                        <div class="prowlarr-card-icon">⚡</div>
                        <div class="prowlarr-card-title">AllDebrid</div>
                        <div class="prowlarr-card-desc">Proxy WARP sécurisé</div>
                    </div>
                    <div class="prowlarr-card" id="debridCard_torbox" onclick="selectDebridProvider('torbox')">
                        <div class="prowlarr-card-icon">📦</div>
                        <div class="prowlarr-card-title">Torbox</div>
                        <div class="prowlarr-card-desc">Connexion directe & CDN</div>
                    </div>
                    <div class="prowlarr-card" id="debridCard_both" onclick="selectDebridProvider('both')">
                        <div class="prowlarr-card-icon">⚡📦</div>
                        <div class="prowlarr-card-title">AllDebrid + Torbox</div>
                        <div class="prowlarr-card-desc">Les 2 services en simultané</div>
                    </div>
                </div>
                <input type="hidden" id="debridProvider" value="alldebrid">

                <!-- Bloc AllDebrid -->
                <div id="block_alldebrid">
                    <div class="form-group">
                        <label for="apiKey">Clé API AllDebrid *</label>
                        <div class="input-row">
                            <input type="password" name="apiKey" id="apiKey" placeholder="Votre clé API AllDebrid">
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
                </div>

                <!-- Bloc Torbox -->
                <div id="block_torbox" style="display: none;">
                    <div class="form-group">
                        <label for="torboxApiKey">Clé API Torbox *</label>
                        <div class="input-row">
                            <input type="password" name="torboxApiKey" id="torboxApiKey" placeholder="Votre clé API Torbox">
                            <button type="button" class="btn-eye" onclick="togglePassVisibility('torboxApiKey', this)" title="Afficher/Masquer la clé">👁️</button>
                            <button type="button" class="btn btn-check" onclick="checkTorbox()">Tester</button>
                        </div>
                        <div id="tbStatus" class="status-badge"></div>
                        <div style="font-size: 11px; margin-top: 6px; color: var(--text-dim);">
                            🔑 Obtenez votre clé sur <a href="https://torbox.app/settings" target="_blank" style="color: var(--accent-cyan);">torbox.app/settings</a>
                        </div>
                    </div>

                    <div style="background: rgba(56, 189, 248, 0.08); border-left: 3px solid #38bdf8; border-radius: 6px; padding: 12px 14px; margin-top: 14px; font-size: 12px; color: #bae6fd; line-height: 1.5;">
                        🚀 <strong>Connexion directe Torbox :</strong><br>
                        Torbox bénéficie de connexions directes ultra-rapides sans proxy nécessaire, avec génération de permaliens de streaming haute vitesse.
                    </div>
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
                    <label for="tmdbKey">Clé API TheMovieDB / TMDB (Optionnel)</label>
                    <div class="input-row">
                        <input type="password" name="tmdbKey" id="tmdbKey" placeholder="Optionnel : Cinemeta gratuit si vide">
                        <button type="button" class="btn-eye" onclick="togglePassVisibility('tmdbKey', this)" title="Afficher/Masquer la clé">👁️</button>
                        <button type="button" class="btn btn-check" onclick="checkTmdb()">Tester</button>
                    </div>
                    <div id="tmdbStatus" class="status-badge"></div>
                    <div style="font-size: 11px; margin-top: 6px; color: var(--text-dim); line-height: 1.4;">
                        ℹ️ <strong>Optionnel :</strong> aucune clé n'est requise. Si laissé vide, Cinemeta prend le relais gratuitement. Si vous souhaitez des titres et affiches enrichis en français, vous pouvez ajouter votre clé gratuite TheMovieDB : <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener noreferrer" style="color: var(--accent-cyan);">themoviedb.org/settings/api</a>.
                    </div>
                </div>

                <div class="form-group">
                    <label>Gestion des Catalogues Personnels Stremio</label>
                    <div class="checkbox-card" style="border-color: #38bdf8; margin-bottom: 12px;" onclick="toggleCheckbox('disableCatalogs'); toggleCatalogListVisibility();">
                        <div>
                            <div class="item-label" style="color: #38bdf8;">🚫 Désactiver tous les catalogues personnels (Recommandé)</div>
                            <div class="item-sub">Supprime les rangées de catalogues de l'accueil Stremio (conserve uniquement la recherche et les flux vidéo sur Cinemeta)</div>
                        </div>
                        <input type="checkbox" id="disableCatalogs" checked onclick="event.stopPropagation(); toggleCatalogListVisibility();">
                    </div>
                    <div id="catalogsList" style="display: none;">
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
                <div class="section-title">Qualité & Cache : Résolutions, Prowlarr & Tri des Flux</div>
                <div class="section-desc">Personnalisez les qualités, votre indexeur Prowlarr et les critères de tri des flux vidéo.</div>

                <!-- Profils Rapides en 1 Clic -->
                <div style="margin-bottom: 20px;">
                    <label style="font-weight: 700; font-size: 13px; color: var(--text-main); display: block; margin-bottom: 8px;">⚡ Profils Rapides en 1 Clic</label>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px;">
                        <button type="button" class="preset-card-btn" onclick="applyPreset('mobile')" id="preset_mobile">
                            <div style="font-size: 20px; margin-bottom: 4px;">📱</div>
                            <div style="font-weight: 800; font-size: 13px; color: #fff;">Mobile 4G</div>
                            <div style="font-size: 11px; color: var(--text-muted); line-height: 1.3;">1080p max • Économie</div>
                        </button>
                        <button type="button" class="preset-card-btn active-preset" onclick="applyPreset('tv')" id="preset_tv">
                            <div style="font-size: 20px; margin-bottom: 4px;">📺</div>
                            <div style="font-weight: 800; font-size: 13px; color: #fff;">Smart TV</div>
                            <div style="font-size: 11px; color: var(--text-muted); line-height: 1.3;">4K & 1080p • Équilibré</div>
                        </button>
                        <button type="button" class="preset-card-btn" onclick="applyPreset('cinema')" id="preset_cinema">
                            <div style="font-size: 20px; margin-bottom: 4px;">🍿</div>
                            <div style="font-weight: 800; font-size: 13px; color: #fff;">Home Cinéma</div>
                            <div style="font-size: 11px; color: var(--text-muted); line-height: 1.3;">4K HDR/DV • Remux max</div>
                        </button>
                    </div>
                </div>

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
                            <div class="prowlarr-card-desc">Pas de Prowlarr personnel. Cache partagé + Lumio</div>
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
                    <div style="background: rgba(56, 189, 248, 0.08); border-left: 3px solid #38bdf8; border-radius: 6px; padding: 10px 14px; margin-bottom: 14px; font-size: 12px; color: #bae6fd; line-height: 1.5;">
                        ℹ️ <strong>Recherches directes Prowlarr :</strong><br>
                        L'addon propose un <strong>Cache Global mutualisé</strong> pré-alimenté par le serveur et ses utilisateurs. Pour effectuer des recherches en direct sur des contenus non encore en cache, vous devez renseigner une <strong>instance Prowlarr externe accessible</strong>. Si vous n'avez pas de Prowlarr externe ou le laissez vide, vous bénéficierez exclusivement du cache global mutualisé.
                    </div>
                    <div class="form-group">
                        <label for="prowlarrUrl">URL Prowlarr (Optionnel - Instance externe ou interne)</label>
                        <input type="text" id="prowlarrUrl" placeholder="Ex: http://prowlarr:9696 ou http://host.docker.internal:9696">
                        <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; align-items: center;">
                            <span style="font-size: 11px; color: var(--text-dim);">💡 Suggestions Docker :</span>
                            <button type="button" class="btn-chip" onclick="setProwlarrUrlPreset('prowlarrUrl', 'http://prowlarr:9696')">prowlarr:9696</button>
                            <button type="button" class="btn-chip" onclick="setProwlarrUrlPreset('prowlarrUrl', 'http://host.docker.internal:9696')">host.docker.internal:9696</button>
                            <button type="button" class="btn-chip" onclick="setProwlarrUrlPreset('prowlarrUrl', '/prowlarr')">+ /prowlarr</button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="prowlarrKey">Clé API Prowlarr (Optionnel - Instance externe ou interne)</label>
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

                <div class="form-group" style="background: rgba(56, 189, 248, 0.05); border: 1px solid rgba(56, 189, 248, 0.2); border-radius: 8px; padding: 12px; margin-bottom: 16px;">
                    <label style="display: flex; align-items: center; justify-content: space-between; cursor: pointer; margin-bottom: 0;">
                        <span style="font-weight: 600; color: var(--text-main); display: flex; align-items: center; gap: 8px;">
                            ☁️ Prioriser "Mon Cloud" en premier
                        </span>
                        <input type="checkbox" id="prioritizeCloud" checked style="width: 18px; height: 18px; accent-color: var(--primary);">
                    </label>
                    <div style="font-size: 11px; color: var(--text-dim); margin-top: 6px; line-height: 1.4;">
                        Affiche vos fichiers cloud personnels (AllDebrid et Torbox) tout en haut de la liste de lecture avant les résultats Prowlarr et Lumio.
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

                <div class="form-group" style="margin-top: 12px;">
                    <label for="lumioUrl">URL Manifest Lumio (Optionnel)</label>
                    <input type="text" id="lumioUrl" placeholder="Ex: https://mylumio.tv/.../manifest.json">
                    <div style="font-size: 11px; margin-top: 4px; color: var(--text-dim); line-height: 1.4;">
                        💡 Source externe optionnelle pour enrichir les flux instantanés (AllDebrid / Torbox) uniquement à la demande.<br>
                        ⚠️ <em>Cette fonctionnalité utilise votre manifest configuré via <a href="https://mylumio.tv" target="_blank" rel="noopener noreferrer" style="color: var(--accent-cyan); text-decoration: underline;">mylumio.tv</a> et sera retirée si l'auteur de l'addon le désire.</em>
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
                        Permet d'afficher par exemple "Cinécloud (Alex)" dans votre liste d'addons Stremio et de sauvegarder vos identifiants dans votre navigateur.
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

                <button type="submit" class="btn btn-primary btn-install" onclick="submitRegister()">🚀 Générer mon Manifest Personnel</button>

                <!-- Boîte de résultat d'installation -->
                <div class="result-box" id="resultBox">
                    <div style="font-size: 18px; font-weight: 800; color: var(--success); margin-bottom: 8px;">✨ Manifest Créé avec Succès !</div>
                    <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 12px;">Votre profil privé et sécurisé est prêt.</div>

                    <a id="stremioBtn" href="#" class="btn btn-primary btn-install">📲 Installer dans Stremio</a>

                    <div class="btn-grid">
                        <button type="button" class="btn btn-secondary" onclick="copyManifestUrl()">📋 Copier le lien</button>
                        <a id="webBtn" href="#" target="_blank" class="btn btn-secondary">🌐 Stremio Web</a>
                    </div>

                    <input type="text" id="manifestInput" readonly class="manifest-link-input">
                    <div style="margin-top: 10px;">
                        <button type="button" class="btn btn-secondary" style="width: 100%; padding: 10px;" onclick="toggleQrCode()">📱 Afficher QR Code (TV / Mobile)</button>
                        <div id="qrCodeContainer" style="display: none; margin-top: 12px; background: #ffffff; padding: 16px; border-radius: 12px; width: fit-content; margin-left: auto; margin-right: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.5);">
                            <div id="qrCodeSvg"></div>
                            <div style="color: #0f172a; font-size: 11px; font-weight: 700; margin-top: 8px;">Scannez pour installer sur votre TV</div>
                        </div>
                    </div>
                    <div style="font-size: 11px; color: var(--text-dim); margin-top: 10px;">
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
    <div id="configureContainer" style="display: ${safeTab === 'configure' ? 'block' : 'none'};">
        <!-- Connexion à la configuration -->
        <div id="cfgLoginCard">
            <div class="section-title">Accéder à mes réglages</div>
            <div class="section-desc">Entrez l'UUID de votre instance et le mot de passe associé pour charger et modifier vos options.</div>

            <form id="cfgLoginForm" onsubmit="event.preventDefault(); submitLogin();">
                <div class="form-group">
                    <label for="cfgUuid">UUID de l'Instance *</label>
                    <input type="text" id="cfgUuid" name="username" autocomplete="username" value="${safeUuid}" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" required>
                </div>

                <div class="form-group">
                    <label for="cfgPassword">Mot de passe de vos réglages *</label>
                    <div class="input-row">
                        <input type="password" id="cfgPassword" name="password" autocomplete="current-password" placeholder="Votre mot de passe" required>
                        <button type="button" class="btn-eye" onclick="togglePassVisibility('cfgPassword', this)" title="Afficher/Masquer le mot de passe">👁️</button>
                    </div>
                </div>

                <button type="submit" class="btn btn-primary btn-install">🔓 Charger ma Configuration</button>
                <div id="cfgLoginError" class="status-badge error" style="display: none; margin-top: 10px;"></div>
            </form>
        </div>

        <!-- Formulaire d'édition une fois connecté -->
        <div id="cfgEditCard" style="display: none;">
            <div class="section-title">Modifier mon Profil / Manifest</div>
            <div class="section-desc">Vos modifications s'appliquent immédiatement en direct.</div>

            <!-- Bandeau info persistance sans réinstallation -->
            <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 12px; padding: 12px 16px; margin-bottom: 16px;">
                <div style="display: flex; align-items: flex-start; gap: 10px;">
                    <div style="font-size: 20px; line-height: 1;">⚡</div>
                    <div style="font-size: 13px; line-height: 1.5; color: #d1fae5;">
                        <strong style="color: #34d399;">Mise à jour instantanée sans réinstallation :</strong><br>
                        Vos préférences (langues, résolutions, modes Prowlarr, mode téléchargement, tris, taille max) sont appliquées immédiatement dans Stremio.
                        <div style="margin-top: 6px; font-size: 12px; color: #a7f3d0; opacity: 0.9;">
                            ℹ️ <em>Réinstallation dans Stremio requise uniquement si vous modifiez la sélection des catalogues (activés/désactivés).</em>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Liens Manifest Personnel -->
            <div style="background: #090e18; border: 1px solid var(--card-border); border-radius: 14px; padding: 14px; margin-bottom: 20px;">
                <div style="font-size: 12px; color: var(--text-dim); margin-bottom: 6px;">URL de votre Manifest Personnel :</div>
                <input type="text" id="editManifestInput" readonly class="manifest-link-input" style="margin: 0 0 10px 0;">
                <div class="btn-grid" style="grid-template-columns: 1fr 1fr; margin-bottom: 8px;">
                    <button type="button" class="btn btn-secondary" onclick="copyEditManifestUrl()" style="padding: 10px;">📋 Copier le lien</button>
                    <a id="editWebBtn" href="#" target="_blank" class="btn btn-secondary" style="padding: 10px;">🌐 Ouvrir Stremio Web</a>
                </div>
                <div style="text-align: center; margin-top: 8px;">
                    <a id="editStremioBtn" href="#" class="btn btn-secondary" style="display: inline-block; padding: 8px 14px; font-size: 12px; opacity: 0.85; border-color: rgba(255,255,255,0.15);">🔄 Réinstaller dans Stremio (catalogues modifiés uniquement)</a>
                </div>
            </div>

            <form id="cfgEditForm" onsubmit="event.preventDefault(); submitUpdate();">
                <div class="form-group">
                    <label for="editPseudo">Pseudo / Nom dans Stremio</label>
                    <input type="text" id="editPseudo" name="username" autocomplete="username" placeholder="Ex: Salon, Alex...">
                </div>

                <div class="form-group">
                    <label>Fournisseur Débrid</label>
                    <div class="prowlarr-mode-cards" style="grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); margin-bottom: 16px;">
                        <div class="prowlarr-card active" id="editDebridCard_alldebrid" onclick="selectEditDebridProvider('alldebrid')">
                            <div class="prowlarr-card-icon">⚡</div>
                            <div class="prowlarr-card-title">AllDebrid</div>
                            <div class="prowlarr-card-desc">Proxy WARP</div>
                        </div>
                        <div class="prowlarr-card" id="editDebridCard_torbox" onclick="selectEditDebridProvider('torbox')">
                            <div class="prowlarr-card-icon">📦</div>
                            <div class="prowlarr-card-title">Torbox</div>
                            <div class="prowlarr-card-desc">Connexion directe & CDN</div>
                        </div>
                        <div class="prowlarr-card" id="editDebridCard_both" onclick="selectEditDebridProvider('both')">
                            <div class="prowlarr-card-icon">⚡📦</div>
                            <div class="prowlarr-card-title">AllDebrid + Torbox</div>
                            <div class="prowlarr-card-desc">Les 2 services en simultané</div>
                        </div>
                    </div>
                    <input type="hidden" id="editDebridProvider" value="alldebrid">
                </div>

                <div id="editBlock_alldebrid">
                    <div class="form-group">
                        <label for="editApiKey">Clé API AllDebrid (Optionnel si inchangée)</label>
                        <div class="input-row">
                            <input type="password" id="editApiKey" placeholder="Laisser vide pour ne pas modifier">
                            <button type="button" class="btn-eye" onclick="togglePassVisibility('editApiKey', this)" title="Afficher/Masquer la clé">👁️</button>
                            <button type="button" class="btn btn-check" onclick="checkEditAllDebrid()">Tester</button>
                        </div>
                        <div id="editAdStatus" class="status-badge"></div>
                    </div>
                </div>

                <div id="editBlock_torbox" style="display: none;">
                    <div class="form-group">
                        <label for="editTorboxApiKey">Clé API Torbox (Optionnel si inchangée)</label>
                        <div class="input-row">
                            <input type="password" id="editTorboxApiKey" placeholder="Laisser vide pour ne pas modifier">
                            <button type="button" class="btn-eye" onclick="togglePassVisibility('editTorboxApiKey', this)" title="Afficher/Masquer la clé">👁️</button>
                            <button type="button" class="btn btn-check" onclick="checkEditTorbox()">Tester</button>
                        </div>
                        <div id="editTbStatus" class="status-badge"></div>
                    </div>
                </div>

                <div class="form-group">
                    <label for="editTmdbKey">Clé API TMDB (Optionnel)</label>
                    <div class="input-row">
                        <input type="password" id="editTmdbKey" placeholder="Optionnel : Cinemeta gratuit si vide">
                        <button type="button" class="btn-eye" onclick="togglePassVisibility('editTmdbKey', this)" title="Afficher/Masquer la clé">👁️</button>
                        <button type="button" class="btn btn-check" onclick="checkEditTmdb()">Tester</button>
                    </div>
                    <div id="editTmdbStatus" class="status-badge"></div>
                    <div style="font-size: 11px; margin-top: 4px; color: var(--text-dim);">
                        ℹ️ Si laissé vide, Cinemeta prend le relais gratuitement sans configuration.
                    </div>
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
                            <div class="prowlarr-card-desc">Pas de Prowlarr personnel. Cache partagé + Lumio</div>
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
                    <div style="background: rgba(56, 189, 248, 0.08); border-left: 3px solid #38bdf8; border-radius: 6px; padding: 10px 14px; margin-bottom: 14px; font-size: 12px; color: #bae6fd; line-height: 1.5;">
                        ℹ️ <strong>Recherches directes Prowlarr :</strong><br>
                        Le serveur synchronise un <strong>Cache Global mutualisé</strong>. Pour rechercher des contenus non encore en cache, une <strong>instance Prowlarr externe accessible</strong> est requise. En mode Local ou sans Prowlarr, vous accédez au cache global partagé.
                    </div>
                    <div class="form-group">
                        <label for="editProwlarrUrl">URL Prowlarr (Optionnel - Instance externe ou interne)</label>
                        <input type="text" id="editProwlarrUrl" placeholder="Ex: http://prowlarr:9696 ou http://host.docker.internal:9696">
                        <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; align-items: center;">
                            <span style="font-size: 11px; color: var(--text-dim);">💡 Suggestions Docker :</span>
                            <button type="button" class="btn-chip" onclick="setProwlarrUrlPreset('editProwlarrUrl', 'http://prowlarr:9696')">prowlarr:9696</button>
                            <button type="button" class="btn-chip" onclick="setProwlarrUrlPreset('editProwlarrUrl', 'http://host.docker.internal:9696')">host.docker.internal:9696</button>
                            <button type="button" class="btn-chip" onclick="setProwlarrUrlPreset('editProwlarrUrl', '/prowlarr')">+ /prowlarr</button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="editProwlarrKey">Clé API Prowlarr (Optionnel - Instance externe ou interne)</label>
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

                <div class="form-group" style="background: rgba(56, 189, 248, 0.05); border: 1px solid rgba(56, 189, 248, 0.2); border-radius: 8px; padding: 12px; margin-bottom: 16px;">
                    <label style="display: flex; align-items: center; justify-content: space-between; cursor: pointer; margin-bottom: 0;">
                        <span style="font-weight: 600; color: var(--text-main); display: flex; align-items: center; gap: 8px;">
                            ☁️ Prioriser "Mon Cloud" en premier
                        </span>
                        <input type="checkbox" id="editPrioritizeCloud" style="width: 18px; height: 18px; accent-color: var(--primary);">
                    </label>
                    <div style="font-size: 11px; color: var(--text-dim); margin-top: 6px; line-height: 1.4;">
                        Affiche vos fichiers cloud personnels (AllDebrid et Torbox) tout en haut de la liste de lecture avant les résultats Prowlarr et Lumio.
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

                <div class="form-group" style="margin-top: 12px;">
                    <label for="editLumioUrl">URL Manifest Lumio (Optionnel)</label>
                    <input type="text" id="editLumioUrl" placeholder="Ex: https://mylumio.tv/.../manifest.json">
                    <div style="font-size: 11px; margin-top: 4px; color: var(--text-dim); line-height: 1.4;">
                        💡 Source externe optionnelle pour enrichir les flux instantanés (AllDebrid / Torbox) uniquement à la demande.<br>
                        ⚠️ <em>Cette fonctionnalité utilise votre manifest configuré via <a href="https://mylumio.tv" target="_blank" rel="noopener noreferrer" style="color: var(--accent-cyan); text-decoration: underline;">mylumio.tv</a> et sera retirée si l'auteur de l'addon le désire.</em>
                    </div>
                </div>

                <div class="form-group">
                    <label>Gestion des Catalogues Personnels Stremio</label>
                    <div class="checkbox-card" style="border-color: #38bdf8; margin-bottom: 12px;" onclick="toggleCheckbox('editDisableCatalogs'); toggleEditCatalogListVisibility();">
                        <div>
                            <div class="item-label" style="color: #38bdf8;">🚫 Désactiver tous les catalogues personnels</div>
                            <div class="item-sub">Supprime les rangées de catalogues de l'accueil Stremio (conserve uniquement la recherche et les flux vidéo sur Cinemeta)</div>
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
        <a href="#" onclick="switchMainMode('register'); return false;">⚡ Nouveau Manifest / Profil</a> • 
        <a href="#" onclick="switchMainMode('configure'); return false;">⚙️ Gérer mon Profil</a> • 
        <a href="/admin">🛡️ Administration</a>
    </div>
</div>

<script>
    let currentStep = 1;
    let activeUuid = "${initialUuid || ""}";
    let activePass = "";
    let initialDisableCatalogs = false;
    let initialCatalogs = "";

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

    function selectDebridProvider(provider) {
        const field = document.getElementById('debridProvider');
        if (field) field.value = provider;
        ['alldebrid', 'torbox', 'both'].forEach(p => {
            const card = document.getElementById('debridCard_' + p);
            if (card) {
                if (p === provider) card.classList.add('active');
                else card.classList.remove('active');
            }
        });
        const blockAd = document.getElementById('block_alldebrid');
        const blockTb = document.getElementById('block_torbox');
        if (blockAd) blockAd.style.display = (provider === 'alldebrid' || provider === 'both') ? 'block' : 'none';
        if (blockTb) blockTb.style.display = (provider === 'torbox' || provider === 'both') ? 'block' : 'none';
    }

    function selectEditDebridProvider(provider) {
        const field = document.getElementById('editDebridProvider');
        if (field) field.value = provider;
        ['alldebrid', 'torbox', 'both'].forEach(p => {
            const card = document.getElementById('editDebridCard_' + p);
            if (card) {
                if (p === provider) card.classList.add('active');
                else card.classList.remove('active');
            }
        });
        const blockAd = document.getElementById('editBlock_alldebrid');
        const blockTb = document.getElementById('editBlock_torbox');
        if (blockAd) blockAd.style.display = (provider === 'alldebrid' || provider === 'both') ? 'block' : 'none';
        if (blockTb) blockTb.style.display = (provider === 'torbox' || provider === 'both') ? 'block' : 'none';
    }

    async function checkTorboxKeyGeneric(key, badgeId) {
        const badge = document.getElementById(badgeId);
        if (!key) {
            badge.className = 'status-badge error';
            badge.textContent = 'Veuillez saisir votre clé API Torbox';
            badge.style.display = 'inline-block';
            return;
        }
        badge.className = 'status-badge';
        badge.style.display = 'inline-block';
        badge.textContent = 'Vérification Torbox en cours...';

        try {
            const res = await fetch('/api/check/torbox', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey: key })
            });
            const data = await res.json();
            if (data.valid) {
                badge.className = 'status-badge success';
                badge.textContent = '✅ Valide • ' + (data.email || data.username) + ' (' + data.planName + ')';
            } else {
                badge.className = 'status-badge error';
                badge.textContent = '❌ ' + (data.error || 'Clé Torbox invalide');
            }
        } catch (e) {
            badge.className = 'status-badge error';
            badge.textContent = '❌ Erreur de connexion au serveur';
        }
    }

    function checkTorbox() {
        const apiKey = document.getElementById('torboxApiKey').value.trim();
        checkTorboxKeyGeneric(apiKey, 'tbStatus');
    }

    function checkEditTorbox() {
        const apiKey = document.getElementById('editTorboxApiKey').value.trim();
        checkTorboxKeyGeneric(apiKey, 'editTbStatus');
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
            badge.textContent = 'Mode gratuit actif : Cinemeta fournit les métadonnées';
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
            badge.textContent = "Veuillez saisir l'URL et la clé API Prowlarr";
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
            if (data.valid || data.success) {
                badge.className = 'status-badge success';
                let successTxt = '✅ Prowlarr connecté (' + (data.version ? 'v' + data.version : 'OK') + ')';
                if (data.suggestedUrl && data.suggestedUrl !== url) {
                    const inputEl = document.getElementById(badgeId === 'editProwlarrStatus' ? 'editProwlarrUrl' : 'prowlarrUrl');
                    if (inputEl) {
                        inputEl.value = data.suggestedUrl;
                    }
                    successTxt += ' • URL ajustée : ' + data.suggestedUrl;
                }
                badge.textContent = successTxt;
            } else {
                badge.className = 'status-badge error';
                badge.textContent = '❌ ' + (data.error || 'Impossible de joindre Prowlarr');
            }
        } catch (e) {
            badge.className = 'status-badge error';
            badge.textContent = '❌ Erreur réseau lors du test Prowlarr';
        }
    }

    function setProwlarrUrlPreset(inputId, presetVal) {
        const el = document.getElementById(inputId);
        if (!el) return;
        if (presetVal === '/prowlarr') {
            let cur = el.value.trim();
            while (cur.endsWith('/')) {
                cur = cur.slice(0, -1);
            }
            if (cur && !cur.endsWith('/prowlarr')) {
                el.value = cur + '/prowlarr';
            } else if (!cur) {
                el.value = 'http://prowlarr:9696/prowlarr';
            }
        } else {
            el.value = presetVal;
        }
        el.focus();
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

    function applyPreset(name) {
        document.querySelectorAll('.preset-card-btn').forEach(b => b.classList.remove('active-preset'));
        const btn = document.getElementById('preset_' + name);
        if (btn) btn.classList.add('active-preset');

        const pills = document.querySelectorAll('#resBar .res-pill');
        if (name === 'mobile') {
            pills.forEach(p => {
                const res = p.getAttribute('data-res');
                if (res === '4k') {
                    p.classList.remove('active');
                    p.classList.add('disabled');
                } else {
                    p.classList.add('active');
                    p.classList.remove('disabled');
                }
            });
            const sizeInput = document.getElementById('maxSizeGb');
            if (sizeInput) sizeInput.value = 6;
            const streamsInput = document.getElementById('maxStreams');
            if (streamsInput) streamsInput.value = 5;
            const sortSelect = document.getElementById('sortBy');
            if (sortSelect) sortSelect.value = 'quality';
        } else if (name === 'tv') {
            pills.forEach(p => {
                p.classList.add('active');
                p.classList.remove('disabled');
            });
            const sizeInput = document.getElementById('maxSizeGb');
            if (sizeInput) sizeInput.value = 40;
            const streamsInput = document.getElementById('maxStreams');
            if (streamsInput) streamsInput.value = 8;
            const sortSelect = document.getElementById('sortBy');
            if (sortSelect) sortSelect.value = 'quality';
        } else if (name === 'cinema') {
            pills.forEach(p => {
                p.classList.add('active');
                p.classList.remove('disabled');
            });
            const sizeInput = document.getElementById('maxSizeGb');
            if (sizeInput) sizeInput.value = 0;
            const streamsInput = document.getElementById('maxStreams');
            if (streamsInput) streamsInput.value = 12;
            const sortSelect = document.getElementById('sortBy');
            if (sortSelect) sortSelect.value = 'size';
        }
    }

    function toggleQrCode() {
        const box = document.getElementById('qrCodeContainer');
        if (!box) return;
        if (box.style.display === 'none' || !box.style.display) {
            const url = document.getElementById('manifestInput')?.value || '';
            if (url) {
                const qrSvgBox = document.getElementById('qrCodeSvg');
                if (qrSvgBox) {
                    qrSvgBox.innerHTML = '<img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=' + encodeURIComponent(url) + '" width="180" height="180" alt="QR Code Manifest" style="display:block; margin:0 auto; border-radius:4px;">';
                }
            }
            box.style.display = 'block';
        } else {
            box.style.display = 'none';
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
        const debridProvider = document.getElementById('debridProvider')?.value || 'alldebrid';
        const apiKey = document.getElementById('apiKey').value.trim();
        const torboxApiKey = document.getElementById('torboxApiKey')?.value.trim() || '';
        const password = document.getElementById('password').value;
        const pseudo = document.getElementById('pseudo').value.trim();
        const tmdbKey = document.getElementById('tmdbKey').value.trim() || 'default';
        const hideUnknownLanguages = document.getElementById('hideUnknownLanguages').checked;
        const prioritizeCloud = Boolean(document.getElementById('prioritizeCloud')?.checked);
        const sortBy = document.getElementById('sortBy').value;
        const maxSizeGb = parseFloat(document.getElementById('maxSizeGb').value) || 150;
        const maxStreams = parseInt(document.getElementById('maxStreams').value, 10) || 0;
        const prowlarrMode = document.getElementById('prowlarrMode')?.value || 'shared';
        const prowlarrUrl = document.getElementById('prowlarrUrl')?.value.trim() || '';
        const prowlarrKey = document.getElementById('prowlarrKey')?.value.trim() || '';
        const allowDownload = Boolean(document.getElementById('allowDownload')?.checked);
        const disableCatalogs = Boolean(document.getElementById('disableCatalogs')?.checked);
        const lumioUrl = document.getElementById('lumioUrl')?.value.trim() || '';

        if (debridProvider === 'both') {
            if (!apiKey && !torboxApiKey) {
                alert("Veuillez saisir au moins une clé API (AllDebrid ou Torbox) pour le mode combiné.");
                goToStep(1);
                return;
            }
        } else if (debridProvider === 'alldebrid' && !apiKey) {
            alert("Veuillez saisir votre clé API AllDebrid.");
            goToStep(1);
            return;
        } else if (debridProvider === 'torbox' && !torboxApiKey) {
            alert("Veuillez saisir votre clé API Torbox.");
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
                    debridProvider,
                    apiKey,
                    torboxApiKey,
                    password,
                    pseudo,
                    tmdbKey,
                    langPref,
                    resolutions,
                    hideUnknownLanguages,
                    prioritizeCloud,
                    sortBy,
                    maxSizeGb,
                    maxStreams,
                    enabledCatalogs,
                    prowlarrMode,
                    prowlarrUrl,
                    prowlarrKey,
                    allowDownload,
                    disableCatalogs,
                    lumioUrl
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
                alert('Erreur: ' + (data.error || 'Impossible de créer le profil'));
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
            if (cfg.debridProvider) {
                selectEditDebridProvider(cfg.debridProvider);
            }
            if (cfg.apiKeyPreview) {
                document.getElementById('editApiKey').placeholder = 'Clé enregistrée (' + cfg.apiKeyPreview + ')';
            }
            if (cfg.torboxApiKeyPreview) {
                document.getElementById('editTorboxApiKey').placeholder = 'Clé enregistrée (' + cfg.torboxApiKeyPreview + ')';
            }
            document.getElementById('editPseudo').value = cfg.pseudo || '';
            document.getElementById('editTmdbKey').value = (cfg.tmdbKey === 'default' ? '' : cfg.tmdbKey) || '';
            document.getElementById('editSortBy').value = cfg.sortBy || 'quality';
            document.getElementById('editMaxSizeGb').value = (cfg.maxSizeGb !== undefined && cfg.maxSizeGb !== null) ? cfg.maxSizeGb : 150;
            document.getElementById('editMaxStreams').value = cfg.maxStreams || '';
            document.getElementById('editHideUnknown').checked = Boolean(cfg.hideUnknownLanguages);
            document.getElementById('editPrioritizeCloud').checked = (cfg.prioritizeCloud !== undefined) ? Boolean(cfg.prioritizeCloud) : true;

            selectEditProwlarrMode(cfg.prowlarrMode || 'shared');
            document.getElementById('editProwlarrUrl').value = cfg.prowlarrUrl || '';
            document.getElementById('editProwlarrKey').value = cfg.prowlarrKey || '';
            document.getElementById('editAllowDownload').checked = Boolean(cfg.allowDownload);
            document.getElementById('editDisableCatalogs').checked = Boolean(cfg.disableCatalogs);
            document.getElementById('editLumioUrl').value = cfg.lumioUrl || '';
            toggleEditCatalogListVisibility();

            initialDisableCatalogs = Boolean(cfg.disableCatalogs);
            const cats = Array.isArray(cfg.enabledCatalogs) ? cfg.enabledCatalogs : [];
            initialCatalogs = [...cats].sort().join(',');

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
        const debridProvider = document.getElementById('editDebridProvider')?.value || 'alldebrid';
        const apiKey = document.getElementById('editApiKey').value.trim();
        const torboxApiKey = document.getElementById('editTorboxApiKey')?.value.trim() || '';
        const pseudo = document.getElementById('editPseudo').value.trim();
        const tmdbKey = document.getElementById('editTmdbKey').value.trim() || 'default';
        const newPassword = document.getElementById('editNewPassword').value;
        const hideUnknownLanguages = document.getElementById('editHideUnknown').checked;
        const prioritizeCloud = Boolean(document.getElementById('editPrioritizeCloud')?.checked);
        const sortBy = document.getElementById('editSortBy').value;
        const maxSizeGb = parseFloat(document.getElementById('editMaxSizeGb').value) || 150;
        const maxStreams = parseInt(document.getElementById('editMaxStreams').value, 10) || 0;
        const prowlarrMode = document.getElementById('editProwlarrMode')?.value || 'shared';
        const prowlarrUrl = document.getElementById('editProwlarrUrl')?.value.trim() || '';
        const prowlarrKey = document.getElementById('editProwlarrKey')?.value.trim() || '';
        const allowDownload = Boolean(document.getElementById('editAllowDownload')?.checked);
        const disableCatalogs = Boolean(document.getElementById('editDisableCatalogs')?.checked);
        const lumioUrl = document.getElementById('editLumioUrl')?.value.trim() || '';

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

        const catalogsChanged = (initialDisableCatalogs !== disableCatalogs) || (initialCatalogs !== [...enabledCatalogs].sort().join(','));

        try {
            const res = await fetch('/api/user/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    uuid: activeUuid,
                    password: activePass,
                    debridProvider,
                    apiKey,
                    torboxApiKey,
                    pseudo,
                    newPassword,
                    tmdbKey,
                    langPref,
                    resolutions,
                    hideUnknownLanguages,
                    prioritizeCloud,
                    sortBy,
                    maxSizeGb,
                    maxStreams,
                    enabledCatalogs,
                    prowlarrMode,
                    prowlarrUrl,
                    prowlarrKey,
                    allowDownload,
                    disableCatalogs,
                    lumioUrl
                })
            });
            const data = await res.json();
            if (data.success) {
                if (newPassword && newPassword.length >= 4) {
                    activePass = newPassword;
                }
                initialDisableCatalogs = disableCatalogs;
                initialCatalogs = [...enabledCatalogs].sort().join(',');

                if (catalogsChanged) {
                    alert("✅ Réglages mis à jour avec succès !\\n\\nℹ️ Vous avez modifié vos catalogues Stremio : rechargez ou réinstallez l'addon dans Stremio pour mettre à jour les rangées de votre accueil.");
                } else {
                    alert("✅ Réglages mis à jour avec succès !\\n\\n⚡ Vos modifications de préférences sont immédiatement actives en direct dans Stremio (aucune réinstallation nécessaire).");
                }
            } else {
                alert("Erreur: " + (data.error || "Impossible de mettre à jour"));
            }
        } catch (e) {
            alert("Erreur de connexion au serveur.");
        }
    }

    // Suppression de l'instance
    async function submitDelete() {
        if (!confirm("⚠️ Êtes-vous absolument sûr de vouloir supprimer définitivement ce profil et vos données ? Votre manifest cessera immédiatement de fonctionner.")) {
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
                alert("Profil supprimé avec succès.");
                window.location.href = "/";
            } else {
                alert("Erreur: " + (data.error || "Impossible de supprimer le profil"));
            }
        } catch (e) {
            alert("Erreur de connexion.");
        }
    }

    function copyManifestUrl() {
        const input = document.getElementById('manifestInput');
        if (!input || !input.value) return;
        input.select();
        navigator.clipboard.writeText(input.value);
        alert('Lien copié dans le presse-papiers !');
    }

    function copyEditManifestUrl() {
        const input = document.getElementById('editManifestInput');
        if (!input || !input.value) return;
        input.select();
        navigator.clipboard.writeText(input.value);
        alert('Lien du Manifest copié dans le presse-papiers !');
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
    <title>Cinécloud • Panneau d'Administration</title>
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
        <div style="display: flex; gap: 8px;">
            <button class="btn btn-primary" style="flex: 1; padding: 12px;" onclick="loginAdmin()">Se Connecter</button>
            <a href="/" class="btn btn-secondary" style="padding: 12px; text-decoration: none; text-align: center;">Retour</a>
        </div>
        <div id="authError" style="color: var(--danger); font-size: 12px; margin-top: 10px; display: none;">Mot de passe incorrect</div>
    </div>
</div>

<div class="admin-header">
    <div class="header-title" style="display: flex; align-items: center; gap: 10px;">
        <div>🛡️ Cinécloud <span>Administration</span></div>
        <span id="adminAuthBadge" style="font-size: 11px; padding: 3px 8px; border-radius: 6px; font-weight: 600; background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3);">🔴 Déconnecté</span>
    </div>
    <div style="display: flex; gap: 8px; align-items: center;">
        <a href="/" class="btn btn-secondary">Retour à l'Addon</a>
        <button id="btnAdminLogin" class="btn btn-primary" onclick="openLoginModal()" style="display: none;">Connexion</button>
        <button id="btnAdminLogout" class="btn btn-danger" onclick="logoutAdmin()">Déconnexion</button>
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
            <div class="kpi-card">
                <div class="kpi-title">Disponibilité Immédiate</div>
                <div class="kpi-val" id="kpiCacheRate" style="color: var(--accent);">--%</div>
            </div>
        </div>

        <div class="card">
            <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                <span>Santé des Services & Sondes Débrideurs</span>
                <button class="btn btn-secondary" onclick="checkDebridHealthAdmin()" style="font-size: 11px; padding: 4px 10px;">⚡ Sonder les APIs</button>
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px;">
                <div style="background: #080d1a; padding: 14px; border-radius: 10px; border: 1px solid var(--card-border);">
                    <div style="font-weight: 700; margin-bottom: 6px;">⚡ Sondes APIs AllDebrid & Torbox</div>
                    <div id="adminDebridHealthStatus" style="font-size: 13px; color: var(--text-muted);">Cliquez sur "Sonder les APIs" ou chargement auto...</div>
                </div>
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

        <div class="card" style="margin-top: 16px;">
            <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                <span>🏆 Classement des Top Recherches & Titres Populaires</span>
                <div style="display: flex; gap: 8px; align-items: center;">
                    <input type="text" id="searchQueryFilterInput" placeholder="🔍 Filtrer recherches..." oninput="filterSearchesTable()" style="background:#080d1a; color:#fff; border:1px solid var(--card-border); padding:5px 10px; border-radius:6px; font-size:12px; width:180px;">
                    <button class="btn btn-secondary" onclick="clearSearchesAdmin()" style="font-size: 11px; padding: 5px 10px;">🗑️ Réinitialiser</button>
                </div>
            </div>
            <div style="overflow-x: auto;">
                <table>
                    <thead>
                        <tr>
                            <th style="width: 45px; text-align: center;">#</th>
                            <th>Titre Recherché</th>
                            <th style="width: 110px;">Type</th>
                            <th style="width: 110px; text-align: center;">Requêtes</th>
                            <th style="width: 170px;">Dernière Requête</th>
                        </tr>
                    </thead>
                    <tbody id="topSearchesTableBody">
                        <tr><td colspan="5" style="text-align: center; color: var(--text-dim);">Aucune recherche enregistrée pour l'instant</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    <!-- Onglet 2 : Utilisateurs -->
    <div class="tab-content" id="tabUsers">
        <div class="card">
            <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                <span>Comptes Utilisateurs Enregistrés</span>
                <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                    <input type="text" id="userSearchInput" placeholder="🔍 Rechercher (pseudo, UUID...)" oninput="filterUsersTable()" style="background:#090d16; color:#fff; border:1px solid var(--card-border); padding:5px 12px; border-radius:6px; font-size:12px; width:220px;">
                    <label style="font-size: 12px; color: var(--text-muted); margin: 0;">Trier :</label>
                    <select id="userSortSelect" onchange="loadUsers()" style="background:#090d16; color:#fff; border:1px solid var(--card-border); padding:5px 10px; border-radius:6px; font-size:12px;">
                        <option value="newest">📅 Plus récents d'abord (Défaut)</option>
                        <option value="oldest">📅 Plus anciens d'abord</option>
                        <option value="alpha">🔤 Ordre alphabétique (Pseudo)</option>
                        <option value="last_active">⚡ Dernière activité</option>
                    </select>
                    <button class="btn btn-secondary" onclick="loadUsers()">🔄 Actualiser</button>
                </div>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>UUID</th>
                        <th>Pseudo</th>
                        <th>Mode Prowlarr</th>
                        <th>Créé le</th>
                        <th>Dernière Activité</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody id="usersTableBody">
                    <tr><td colspan="6" style="text-align: center; color: var(--text-dim);">Chargement des utilisateurs...</td></tr>
                </tbody>
            </table>
        </div>
    </div>

    <!-- Onglet 3 : Logs -->
    <div class="tab-content" id="tabLogs">
        <div class="card">
            <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                    <span>Journal des Événements</span>
                    <select id="logLevelFilter" onchange="loadLogs()" style="background:#090d16; color:#fff; border:1px solid var(--card-border); padding:4px 8px; border-radius:6px; font-size:12px;">
                        <option value="ALL">Tous les niveaux</option>
                        <option value="INFO">INFO</option>
                        <option value="WARN">WARN</option>
                        <option value="ERROR">ERROR</option>
                    </select>
                    <input type="text" id="logSearchInput" placeholder="🔍 Filtrer logs..." oninput="applyLogFilter()" style="background:#090d16; color:#fff; border:1px solid var(--card-border); padding:4px 8px; border-radius:6px; font-size:12px; width:160px;">
                </div>
                <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                    <button id="btnTogglePauseLogs" class="btn btn-secondary" onclick="togglePauseLogs()">⏸️ Pause</button>
                    <button id="btnCopyLogs" class="btn btn-secondary" onclick="copyConsoleLogs()">📋 Copier</button>
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
            <div class="card-header">🛠️ Outils de Maintenance & Optimisation</div>
            <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 18px;">
                <button class="btn btn-primary" onclick="triggerProwlarrSyncAdmin()">⚡ Forcer le Cycle RSS Prowlarr</button>
                <button class="btn btn-secondary" onclick="purgeExpiredTorrentsAdmin()">🧹 Purger Torrents Expirés (+30j)</button>
                <button class="btn btn-secondary" onclick="vacuumDatabaseAdmin()">⚡ Optimiser SQLite (VACUUM & WAL)</button>
                <button class="btn btn-secondary" onclick="downloadBackupAdmin()">💾 Télécharger Backup SQLite</button>
            </div>
            <div class="card-header" style="font-size: 14px; margin-top: 14px;">Nettoyage Intégral du Cache</div>
            <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                <button class="btn btn-danger" onclick="clearCacheTarget('torrents')">Vider le Cache des Torrents Prowlarr</button>
                <button class="btn btn-danger" onclick="clearCacheTarget('movies')">Vider le Cache des Métadonnées</button>
                <button class="btn btn-secondary" onclick="clearCacheTarget('searches')">Vider l'Historique des Recherches</button>
            </div>
        </div>
    </div>
</div>

<script>
    let adminToken = localStorage.getItem('adminToken') || sessionStorage.getItem('adminToken');

    function updateAuthUI() {
        const badge = document.getElementById('adminAuthBadge');
        const loginBtn = document.getElementById('btnAdminLogin');
        const logoutBtn = document.getElementById('btnAdminLogout');
        if (adminToken) {
            if (badge) {
                badge.textContent = '🟢 Connecté';
                badge.style.color = '#10b981';
                badge.style.background = 'rgba(16, 185, 129, 0.15)';
                badge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
            }
            if (loginBtn) loginBtn.style.display = 'none';
            if (logoutBtn) logoutBtn.style.display = 'inline-block';
        } else {
            if (badge) {
                badge.textContent = '🔴 Déconnecté';
                badge.style.color = '#ef4444';
                badge.style.background = 'rgba(239, 68, 68, 0.15)';
                badge.style.borderColor = 'rgba(239, 68, 68, 0.3)';
            }
            if (loginBtn) loginBtn.style.display = 'inline-block';
            if (logoutBtn) logoutBtn.style.display = 'none';
        }
    }

    function checkAuth() {
        updateAuthUI();
        if (adminToken) {
            document.getElementById('authOverlay').style.display = 'none';
            loadAllAdminData();
        } else {
            document.getElementById('authOverlay').style.display = 'flex';
        }
    }

    function openLoginModal() {
        document.getElementById('authOverlay').style.display = 'flex';
        const inp = document.getElementById('adminPassword');
        if (inp) inp.focus();
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
                localStorage.setItem('adminToken', adminToken);
                sessionStorage.setItem('adminToken', adminToken);
                document.getElementById('authOverlay').style.display = 'none';
                updateAuthUI();
                loadAllAdminData();
            } else {
                err.style.display = 'block';
            }
        } catch (e) {
            err.textContent = 'Erreur serveur';
            err.style.display = 'block';
        }
    }

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    async function logoutAdmin() {
        if (adminToken) {
            try {
                await fetch('/api/admin/logout', {
                    method: 'POST',
                    headers: { 'x-admin-token': adminToken }
                });
            } catch (e) {}
        }
        localStorage.removeItem('adminToken');
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

    async function checkDebridHealthAdmin() {
        const box = document.getElementById('adminDebridHealthStatus');
        if (box) box.textContent = 'Sondage en direct en cours...';
        try {
            const res = await fetch('/api/admin/health/debrid', {
                headers: { 'x-admin-token': adminToken }
            });
            const data = await res.json();
            if (box) {
                const adColor = data.alldebrid.status === 'online' ? '#10b981' : (data.alldebrid.status === 'degraded' ? '#f59e0b' : '#ef4444');
                const tbColor = data.torbox.status === 'online' ? '#10b981' : (data.torbox.status === 'degraded' ? '#f59e0b' : '#ef4444');
                box.innerHTML = \`
                    <div style="display: flex; gap: 16px; flex-wrap: wrap;">
                        <div>
                            <strong>AllDebrid :</strong> <span style="color: \${adColor}; font-weight: 700;">\${data.alldebrid.status.toUpperCase()}</span>
                            <span style="color: var(--text-muted); font-size: 11px;">(\${data.alldebrid.latencyMs} ms)</span>
                            \${data.alldebrid.error ? ('<div style="color: #ef4444; font-size: 11px;">' + escapeHtml(data.alldebrid.error) + '</div>') : ''}
                        </div>
                        <div>
                            <strong>Torbox :</strong> <span style="color: \${tbColor}; font-weight: 700;">\${data.torbox.status.toUpperCase()}</span>
                            <span style="color: var(--text-muted); font-size: 11px;">(\${data.torbox.latencyMs} ms)</span>
                            \${data.torbox.error ? ('<div style="color: #ef4444; font-size: 11px;">' + escapeHtml(data.torbox.error) + '</div>') : ''}
                        </div>
                    </div>
                \`;
            }
        } catch (e) {
            if (box) box.textContent = 'Erreur lors de la sonde des APIs débrideurs.';
        }
    }

    async function triggerProwlarrSyncAdmin() {
        const btn = event?.target;
        if (btn) btn.disabled = true;
        try {
            const res = await fetch('/api/admin/prowlarr/sync', {
                method: 'POST',
                headers: { 'x-admin-token': adminToken }
            });
            const data = await res.json();
            alert(data.message || (data.success ? 'Cycle RSS Prowlarr déclenché.' : 'Erreur'));
            loadLogs();
        } catch (e) {
            alert('Erreur lors du déclenchement du cycle Prowlarr.');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    async function purgeExpiredTorrentsAdmin() {
        if (!confirm('Purger tous les torrents non mis à jour depuis plus de 30 jours ?')) return;
        try {
            const res = await fetch('/api/admin/maintenance/purge-expired', {
                method: 'POST',
                headers: { 'x-admin-token': adminToken }
            });
            const data = await res.json();
            alert(data.message || ((data.purged || 0) + ' torrents expirés purgés.'));
            loadStats();
        } catch (e) {
            alert('Erreur lors de la purge.');
        }
    }

    async function vacuumDatabaseAdmin() {
        try {
            const res = await fetch('/api/admin/maintenance/vacuum', {
                method: 'POST',
                headers: { 'x-admin-token': adminToken }
            });
            const data = await res.json();
            alert(data.message || (data.success ? 'Base de données optimisée.' : data.error));
            loadStats();
        } catch (e) {
            alert("Erreur lors de l'optimisation SQLite.");
        }
    }

    function downloadBackupAdmin() {
        if (!adminToken) return;
        fetch('/api/admin/backup', {
            headers: { 'x-admin-token': adminToken }
        })
        .then(res => {
            if (!res.ok) throw new Error('Erreur de téléchargement du backup');
            return res.blob();
        })
        .then(blob => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'cinecloud-backup-' + new Date().toISOString().slice(0, 10) + '.db';
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        })
        .catch(err => alert('Échec du téléchargement du backup : ' + err.message));
    }

    let cachedTopSearches = [];
    function filterSearchesTable() {
        const q = (document.getElementById('searchQueryFilterInput')?.value || '').toLowerCase().trim();
        if (!q) {
            renderTopSearches(cachedTopSearches);
            return;
        }
        const filtered = cachedTopSearches.filter(s =>
            (s.title && s.title.toLowerCase().includes(q)) ||
            (s.id && s.id.toLowerCase().includes(q)) ||
            (s.type && s.type.toLowerCase().includes(q))
        );
        renderTopSearches(filtered);
    }

    function renderTopSearches(searches) {
        const stb = document.getElementById('topSearchesTableBody');
        if (!stb) return;
        if (!searches || searches.length === 0) {
            stb.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-dim);">Aucune recherche enregistrée pour l\\'instant</td></tr>';
            return;
        }
        stb.innerHTML = searches.map((s, idx) => {
            const typeBadge = s.type === 'series'
                ? '<span style="background: rgba(168, 85, 247, 0.15); color: #c084fc; padding: 2px 6px; border-radius: 4px; font-weight: 600; font-size: 11px;">📺 Série</span>'
                : (s.type === 'anime'
                    ? '<span style="background: rgba(236, 72, 153, 0.15); color: #f472b6; padding: 2px 6px; border-radius: 4px; font-weight: 600; font-size: 11px;">🇯🇵 Animé</span>'
                    : '<span style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; padding: 2px 6px; border-radius: 4px; font-weight: 600; font-size: 11px;">🎬 Film</span>');
            const lastDate = s.lastSearchedAt ? new Date(s.lastSearchedAt * 1000).toLocaleString() : '--';
            const rankMedal = idx === 0 ? '🥇' : (idx === 1 ? '🥈' : (idx === 2 ? '🥉' : (idx + 1)));
            return \`
                <tr>
                    <td style="text-align: center; font-weight: 700;">\${rankMedal}</td>
                    <td><strong>\${escapeHtml(s.title)}</strong> <span style="font-size: 11px; color: var(--text-dim); margin-left: 6px;">(\${escapeHtml(s.id)})</span></td>
                    <td>\${typeBadge}</td>
                    <td style="text-align: center;"><span style="background: rgba(16, 185, 129, 0.15); color: #10b981; padding: 2px 8px; border-radius: 10px; font-weight: 700; font-size: 11px;">\${s.count}</span></td>
                    <td style="color: var(--text-muted); font-size: 12px;">\${lastDate}</td>
                </tr>
            \`;
        }).join('');
    }

    async function loadStats() {
        try {
            const res = await fetch('/api/admin/stats', { headers: { 'x-admin-token': adminToken } });
            if (res.status === 401) { logoutAdmin(); return; }
            const data = await res.json();
            document.getElementById('kpiTotalUsers').textContent = data.totalUsers || 0;
            document.getElementById('kpiActive24h').textContent = data.active24h || 0;
            const totalTorrents = data.totalCachedTorrents || 0;
            const instantTorrents = data.instantTorrents || 0;
            document.getElementById('kpiTorrents').textContent = totalTorrents;
            document.getElementById('kpiInstant').textContent = instantTorrents;

            const rate = totalTorrents > 0 ? Math.round((instantTorrents / totalTorrents) * 100) : 0;
            const rateElem = document.getElementById('kpiCacheRate');
            if (rateElem) rateElem.textContent = rate + '%';

            document.getElementById('adminWarpStatus').textContent = data.warp
                ? (data.warp.active ? 'Connecté (' + data.warp.mode + ')' : (data.warp.configured ? 'Secours direct actif' : 'Non configuré'))
                : 'Direct';

            document.getElementById('adminSysStatus').textContent = 'Node ' + (data.nodeVersion || '') + ' • RAM: ' + (data.memoryRssMb || 0) + ' MB • Uptime: ' + Math.round(data.uptimeSeconds / 60) + ' min';

            checkDebridHealthAdmin();

            cachedTopSearches = data.topSearches || [];
            renderTopSearches(cachedTopSearches);
        } catch (e) {}
    }

    async function clearSearchesAdmin() {
        if (!confirm("Réinitialiser l'historique et le classement des recherches ?")) return;
        await fetch('/api/admin/cache/clear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
            body: JSON.stringify({ target: 'searches' })
        });
        loadStats();
    }

    let cachedUsersList = [];
    function filterUsersTable() {
        const q = (document.getElementById('userSearchInput')?.value || '').toLowerCase().trim();
        if (!q) {
            renderUsersTable(cachedUsersList);
            return;
        }
        const filtered = cachedUsersList.filter(u =>
            (u.pseudo && u.pseudo.toLowerCase().includes(q)) ||
            (u.uuid && u.uuid.toLowerCase().includes(q)) ||
            (u.prowlarrMode && u.prowlarrMode.toLowerCase().includes(q))
        );
        renderUsersTable(filtered);
    }

    function renderUsersTable(users) {
        const tb = document.getElementById('usersTableBody');
        if (!tb) return;
        if (!Array.isArray(users) || users.length === 0) {
            tb.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-dim);">Aucun utilisateur trouvé</td></tr>';
            return;
        }
        tb.innerHTML = users.map(u => {
            const modeBadge = u.prowlarrMode === 'shared'
                ? '<span style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;">🤝 Mutualisé</span>'
                : (u.prowlarrMode === 'private'
                    ? '<span style="background: rgba(168, 85, 247, 0.15); color: #c084fc; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;">🔒 Privé</span>'
                    : '<span style="background: rgba(100, 116, 139, 0.15); color: #94a3b8; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;">💾 Local</span>');
            return \`
                <tr>
                    <td style="font-family: monospace; color: var(--accent); font-size: 12px;">\${escapeHtml(u.uuid)}</td>
                    <td><strong>\${escapeHtml(u.pseudo || 'Anonyme')}</strong></td>
                    <td>\${modeBadge}</td>
                    <td>\${new Date(u.createdAt * 1000).toLocaleDateString()}</td>
                    <td>\${new Date(u.lastActiveAt * 1000).toLocaleTimeString()}</td>
                    <td>
                        <button class="btn btn-danger" onclick="deleteUserAdmin('\${encodeURIComponent(u.uuid)}')">Supprimer</button>
                    </td>
                </tr>
            \`;
        }).join('');
    }

    async function loadUsers() {
        const sortBy = document.getElementById('userSortSelect')?.value || 'newest';
        try {
            const res = await fetch('/api/admin/users?sortBy=' + encodeURIComponent(sortBy), { headers: { 'x-admin-token': adminToken } });
            if (res.status === 401) { logoutAdmin(); return; }
            cachedUsersList = await res.json();
            filterUsersTable();
        } catch (e) {}
    }

    async function deleteUserAdmin(uuid) {
        if (!confirm("Supprimer définitivement cet utilisateur ?")) return;
        await fetch('/api/admin/users/' + encodeURIComponent(uuid), {
            method: 'DELETE',
            headers: { 'x-admin-token': adminToken }
        });
        loadUsers();
        loadStats();
    }

    let isLogsPaused = false;
    let rawLogsList = [];

    function togglePauseLogs() {
        isLogsPaused = !isLogsPaused;
        const btn = document.getElementById('btnTogglePauseLogs');
        if (btn) {
            btn.textContent = isLogsPaused ? '▶️ Reprendre' : '⏸️ Pause';
            btn.style.color = isLogsPaused ? '#f59e0b' : '';
        }
    }

    function applyLogFilter() {
        renderLogs(rawLogsList);
    }

    function copyConsoleLogs() {
        const q = (document.getElementById('logSearchInput')?.value || '').toLowerCase().trim();
        const logsToCopy = rawLogsList
            .filter(l => !q || (l.message && l.message.toLowerCase().includes(q)) || (l.module && l.module.toLowerCase().includes(q)) || (l.user && l.user.toLowerCase().includes(q)))
            .map(l => \`[\${l.timestamp}] [\${l.level}] [\${l.module}]\${l.user ? ' [' + l.user + ']' : ''} \${l.message}\`)
            .join('\\n');
        if (!logsToCopy) {
            alert('Aucun log à copier.');
            return;
        }
        navigator.clipboard.writeText(logsToCopy).then(() => {
            alert('Logs copiés dans le presse-papiers !');
        }).catch(() => {
            alert('Impossible de copier automatiquement.');
        });
    }

    function renderLogs(logs) {
        const con = document.getElementById('logConsole');
        if (!con) return;
        const q = (document.getElementById('logSearchInput')?.value || '').toLowerCase().trim();
        const filtered = q
            ? logs.filter(l => (l.message && l.message.toLowerCase().includes(q)) || (l.module && l.module.toLowerCase().includes(q)) || (l.user && l.user.toLowerCase().includes(q)))
            : logs;

        con.innerHTML = filtered.map(l => {
            const userBadge = l.user ? ('<span style="background: rgba(56, 189, 248, 0.15); color: var(--accent); padding: 1px 6px; border-radius: 4px; font-weight: 700; margin-right: 4px;">👤 ' + escapeHtml(l.user) + '</span>') : '';
            return \`
            <div class="log-line">
                <span class="log-time">\${escapeHtml(l.timestamp.slice(11, 19))}</span>
                <span class="log-level \${escapeHtml(l.level)}">[\${escapeHtml(l.level)}]</span>
                <span class="log-mod">[\${escapeHtml(l.module)}]</span>
                \${userBadge}
                <span class="log-msg">\${escapeHtml(l.message)}</span>
            </div>
        \`;
        }).join('');
        if (!isLogsPaused) {
            con.scrollTop = con.scrollHeight;
        }
    }

    async function loadLogs() {
        if (isLogsPaused) return;
        const level = document.getElementById('logLevelFilter').value;
        try {
            const res = await fetch('/api/admin/logs?limit=150&level=' + level, { headers: { 'x-admin-token': adminToken } });
            if (res.status === 401) { logoutAdmin(); return; }
            rawLogsList = await res.json();
            renderLogs(rawLogsList);
        } catch (e) {}
    }

    async function clearLogsServer() {
        await fetch('/api/admin/logs/clear', { method: 'POST', headers: { 'x-admin-token': adminToken } });
        loadLogs();
    }

    async function loadSettings() {
        try {
            const res = await fetch('/api/admin/settings', { headers: { 'x-admin-token': adminToken } });
            if (res.status === 401) { logoutAdmin(); return; }
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
    setInterval(() => { if (adminToken && !isLogsPaused) loadLogs(); }, 3000);
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
