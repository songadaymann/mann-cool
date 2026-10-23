(() => {
  const script = document.currentScript;
  const slug = script?.dataset.slug || location.pathname.split("/").filter(Boolean)[0] || "";
  const gameTitle = script?.dataset.title || document.title || slug;
  const leaderboardEnabled = script?.dataset.leaderboard === "true";
  const leaderboardUrl = script?.dataset.leaderboardUrl || "";
  const leaderboardVariant = script?.dataset.leaderboardVariant || "default";
  // Games opt in to the "Save your scores" panel; every game gets window.mannCool.player.
  const playerIdentityEnabled = script?.dataset.playerIdentity === "true";
  const homeTop = slug === "windows"
    ? "max(68px,calc(env(safe-area-inset-top) + 68px))"
    : "max(12px,env(safe-area-inset-top))";
  const defaultShellTheme = {
    paper: "#f8f7f2",
    ink: "#171714",
    muted: "#6d6a61",
    rule: "#d8d6ce",
    accent: "#7bd389",
    panel: "#171713",
    panelInk: "#ffffff",
    panelMuted: "#c9c7be",
    field: "#302f2a",
    focus: "#f4d94f",
    font: "Arial, Helvetica, sans-serif",
    headingFont: "Arial Black, Impact, sans-serif",
    controlRadius: "0px",
    panelRadius: "24px",
  };
  const shellTheme = (() => {
    try {
      const value = JSON.parse(script?.dataset.shellTheme || "{}");
      if (!value || typeof value !== "object" || Array.isArray(value)) return defaultShellTheme;
      const color = /^#[0-9a-f]{6}$/i;
      const font = /^[a-z0-9 ,.'"-]{1,180}$/i;
      const radius = /^(?:0|[0-9]{1,3}(?:\.[0-9]+)?px)$/;
      const next = { ...defaultShellTheme };
      for (const key of ["paper", "ink", "muted", "rule", "accent", "panel", "panelInk", "panelMuted", "field", "focus"]) {
        if (color.test(value[key] || "")) next[key] = value[key];
      }
      for (const key of ["font", "headingFont"]) {
        if (font.test(value[key] || "")) next[key] = value[key];
      }
      for (const key of ["controlRadius", "panelRadius"]) {
        if (radius.test(value[key] || "")) next[key] = value[key];
      }
      return next;
    } catch {
      return defaultShellTheme;
    }
  })();
  const shellThemeCss = Object.entries({
    "--paper": shellTheme.paper,
    "--ink": shellTheme.ink,
    "--muted": shellTheme.muted,
    "--rule": shellTheme.rule,
    "--accent": shellTheme.accent,
    "--panel": shellTheme.panel,
    "--panel-ink": shellTheme.panelInk,
    "--panel-muted": shellTheme.panelMuted,
    "--field": shellTheme.field,
    "--focus": shellTheme.focus,
    "--shell-font": shellTheme.font,
    "--heading-font": shellTheme.headingFont,
    "--control-radius": shellTheme.controlRadius,
    "--panel-radius": shellTheme.panelRadius,
  }).map(([key, value]) => `${key}:${value}`).join(";");
  const leaderboardBoards = (() => {
    if (!leaderboardEnabled) return [];
    try {
      const parsed = JSON.parse(script?.dataset.leaderboardBoards || "[]");
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {}
    return [{ variant: leaderboardVariant, label: "Leaderboard", metricLabel: "Score", display: "number", aggregation: "best" }];
  })();
  if (!slug || document.querySelector("mann-cool-game-shell")) return;

  fetch("https://mann.cool/api/v1/plays", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, source: "direct" }),
  }).catch(() => {});

  // Player identity: a private random secret stays in this browser; the public player ID
  // is derived from it (must match derivedPlayerId in worker/player-identity.js). Linking
  // an email lets another browser take the same ID later.
  const PLAYER_KEY = "mann.cool.player.v1";
  const SECRET = /^[A-Za-z0-9_-]{43}$/;
  const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const derivePlayerId = async (secret) => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`mann.cool-player-v1:${secret}`));
    return `mc_${base64url(new Uint8Array(digest)).slice(0, 24)}`;
  };
  const savePlayer = (state) => { try { localStorage.setItem(PLAYER_KEY, JSON.stringify(state)); } catch {} };
  let playerPromise = null;
  const loadPlayer = () => {
    playerPromise ??= (async () => {
      let state = null;
      try { state = JSON.parse(localStorage.getItem(PLAYER_KEY) || "null"); } catch {}
      if (!state || !SECRET.test(state.secret || "")) state = { secret: base64url(crypto.getRandomValues(new Uint8Array(32))) };
      if (!state.playerId) state.playerId = await derivePlayerId(state.secret);
      savePlayer(state);
      return state;
    })();
    return playerPromise;
  };
  const publicPlayer = (state) => ({ playerId: state.playerId, linked: Boolean(state.linked), emailHint: state.emailHint || null });
  const announcePlayer = (state) => window.dispatchEvent(new CustomEvent("mann-cool:player", { detail: publicPlayer(state) }));

  // Wallet detection: listen for wallets announcing themselves (EIP-6963 for Ethereum-style
  // wallets, Wallet Standard for Solana and others) plus the older injected globals. This
  // never asks to connect and never reads an address. One anonymous report per day per game.
  const legacyEvmName = (provider) => provider.isRabby ? "Rabby" : provider.isCoinbaseWallet ? "Coinbase Wallet"
    : provider.isBraveWallet ? "Brave Wallet" : provider.isPhantom ? "Phantom" : provider.isMetaMask ? "MetaMask" : "Ethereum wallet";
  const detectWallets = async () => {
    const evm = new Map();
    const others = [];
    const onAnnounce = (event) => { const info = event.detail?.info; if (info?.name) evm.set(String(info.rdns || info.name), String(info.name)); };
    const register = (...wallets) => { others.push(...wallets); return () => {}; };
    const onRegister = (event) => { try { event.detail?.({ register }); } catch {} };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.addEventListener("wallet-standard:register-wallet", onRegister);
    try {
      window.dispatchEvent(new Event("eip6963:requestProvider"));
      window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: { register } }));
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 600));
    window.removeEventListener("eip6963:announceProvider", onAnnounce);
    window.removeEventListener("wallet-standard:register-wallet", onRegister);
    try { if (!evm.size && window.ethereum) evm.set("injected", legacyEvmName(window.ethereum)); } catch {}
    const solana = new Map();
    const otherNames = new Set();
    for (const wallet of others) {
      const name = String(wallet?.name || "").slice(0, 40);
      if (!name) continue;
      const chains = Array.isArray(wallet.chains) ? wallet.chains.map(String) : [];
      if (chains.some((chain) => chain.startsWith("solana:"))) solana.set(name, name); else otherNames.add(name);
    }
    try {
      const injected = window.phantom?.solana || window.solflare || window.backpack || window.solana;
      if (!solana.size && injected) solana.set("injected", injected.isPhantom ? "Phantom" : injected.isSolflare ? "Solflare" : injected.isBackpack ? "Backpack" : "Solana wallet");
    } catch {}
    const names = [...new Set([...evm.values(), ...solana.values(), ...otherNames])].slice(0, 8);
    return { hasWallet: names.length > 0, evm: evm.size > 0, solana: solana.size > 0, names };
  };
  let walletPromise = null;
  const wallets = () => {
    walletPromise ??= detectWallets().then((result) => {
      window.dispatchEvent(new CustomEvent("mann-cool:wallets", { detail: result }));
      const day = new Date().toISOString().slice(0, 10);
      let fresh = true;
      try {
        const key = `mann.cool.wallets.reported.v1:${slug}`;
        fresh = localStorage.getItem(key) !== day;
        localStorage.setItem(key, day);
      } catch {}
      if (fresh) {
        fetch("/api/v1/wallets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, evm: result.evm, solana: result.solana, names: result.names }),
          keepalive: true,
        }).catch(() => {});
      }
      return result;
    });
    return walletPromise;
  };

  let shellElement = null;
  const mannCool = window.mannCool = window.mannCool || {};
  mannCool.player = {
    // The ID to send as playerId with leaderboard scores.
    getId: async () => (await loadPlayer()).playerId,
    get: async () => publicPlayer(await loadPlayer()),
    openSave: () => shellElement?.openModal("player"),
  };
  mannCool.wallets = { detect: wallets };
  if (document.readyState === "complete") setTimeout(wallets, 1_500);
  else window.addEventListener("load", () => setTimeout(wallets, 1_500), { once: true });
  window.dispatchEvent(new CustomEvent("mann-cool:ready"));

  class MannCoolGameShell extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this.config = null;
      this.leaderboardBoard = leaderboardBoards[0] || null;
    }

    connectedCallback() {
      shellElement = this;
      this.render();
      this.bindEvents();
      this.loadConfig();
    }

    render() {
      this.shadowRoot.innerHTML = `
        <style>
          :host { ${shellThemeCss}; position:fixed; inset:0; z-index:2147483000; pointer-events:none; font:700 14px/1.2 var(--shell-font); color:var(--ink); }
          *,*::before,*::after { box-sizing:border-box; }
          button,a { font:inherit; }
          button,a,.panel,.backdrop { pointer-events:auto; }
          .home { position:absolute; top:${homeTop}; left:max(12px,env(safe-area-inset-left)); display:inline-flex; align-items:center; gap:8px; min-height:44px; padding:0 13px; border:2px solid var(--ink); border-radius:var(--control-radius); color:var(--ink); background:var(--paper); box-shadow:4px 4px 0 var(--ink); text-decoration:none; text-transform:uppercase; letter-spacing:.045em; }
          .home:hover,.home:focus-visible { outline:3px solid var(--focus); outline-offset:2px; color:var(--paper); background:var(--ink); box-shadow:2px 2px 0 var(--ink); transform:translate(2px,2px); }
          .home b { font-size:16px; }
          .actions { position:absolute; top:max(12px,env(safe-area-inset-top)); right:max(12px,env(safe-area-inset-right)); display:flex; gap:8px; }
          .action { display:flex; align-items:center; justify-content:center; gap:5px; width:62px; min-height:48px; border:2px solid var(--ink); border-radius:var(--control-radius); color:var(--ink); background:var(--paper); box-shadow:4px 4px 0 var(--ink); cursor:pointer; text-decoration:none; }
          .action:hover,.action:focus-visible { outline:3px solid var(--focus); outline-offset:2px; color:var(--paper); background:var(--ink); box-shadow:2px 2px 0 var(--ink); transform:translate(2px,2px); }
          .tip { color:var(--ink); background:var(--accent); font-size:11px; letter-spacing:.04em; text-transform:uppercase; }
          .tip:hover,.tip:focus-visible { color:var(--paper); background:var(--ink); }
          .menu-button { font-size:20px; }
          .menu { position:absolute; top:0; right:72px; width:min(280px,calc(100vw - 96px)); padding:0; border:2px solid var(--ink); border-radius:var(--control-radius); color:var(--ink); background:var(--paper); box-shadow:6px 6px 0 var(--ink); }
          .menu[hidden] { display:none; }
          .menu-title { margin:0; padding:13px; overflow:hidden; color:var(--muted); font-size:11px; letter-spacing:.08em; text-overflow:ellipsis; text-transform:uppercase; white-space:nowrap; }
          .menu button,.menu a { display:flex; align-items:center; justify-content:space-between; width:100%; min-height:46px; padding:0 13px; border:0; border-top:2px solid var(--rule); border-radius:0; color:var(--ink); background:var(--paper); text-align:left; text-decoration:none; text-transform:uppercase; letter-spacing:.04em; cursor:pointer; }
          .menu button:hover,.menu button:focus-visible,.menu a:hover,.menu a:focus-visible { outline:3px solid var(--focus); outline-offset:-3px; color:var(--paper); background:var(--ink); }
          .menu a[data-game-link] { gap:12px; padding-top:11px; padding-bottom:11px; line-height:1.25; }
          .backdrop { position:fixed; inset:0; display:grid; place-items:center; padding:20px; background:rgba(0,0,0,.66); backdrop-filter:blur(8px); }
          .backdrop[hidden] { display:none; }
          .panel { position:relative; width:min(620px,100%); max-height:min(720px,calc(100dvh - 40px)); padding:clamp(24px,5vw,42px); border:3px solid var(--accent); border-radius:var(--panel-radius); color:var(--panel-ink); background:var(--panel); box-shadow:10px 10px 0 var(--ink),0 30px 100px rgba(0,0,0,.58); overflow:auto; }
          .close { position:absolute; top:17px; right:17px; display:grid; place-items:center; width:42px; height:42px; border:2px solid var(--panel-ink); border-radius:var(--control-radius); color:var(--panel-ink); background:var(--field); font-size:24px; cursor:pointer; }
          .close:hover,.close:focus-visible { outline:3px solid var(--focus); outline-offset:2px; color:var(--panel); background:var(--accent); }
          .kicker { margin:0 48px 8px 0; color:var(--accent); font-size:11px; letter-spacing:.1em; text-transform:uppercase; }
          h2 { margin:0 48px 26px 0; font-family:var(--heading-font); font-size:clamp(32px,7vw,54px); line-height:.95; letter-spacing:-.025em; text-transform:uppercase; }
          .status { color:var(--panel-muted); line-height:1.5; }
          .scores { display:grid; gap:6px; margin:28px 0 0; padding:0; list-style:none; }
          .score { display:grid; grid-template-columns:36px minmax(0,1fr) auto; align-items:center; gap:12px; padding:13px; border:1px solid var(--rule); border-radius:var(--control-radius); background:var(--field); }
          .rank { color:var(--accent); }
          .leaderboard-tabs { display:flex; flex-wrap:wrap; gap:0; margin:0 0 12px; border:2px solid var(--panel-muted); }
          .leaderboard-tabs[hidden] { display:none; }
          .leaderboard-tabs button { flex:1 1 120px; min-height:42px; padding:0 12px; border:0; border-right:2px solid var(--panel-muted); border-radius:0; color:var(--panel-ink); background:var(--panel); cursor:pointer; }
          .leaderboard-tabs button:last-child { border-right:0; }
          .leaderboard-tabs button[aria-selected="true"] { color:var(--ink); background:var(--accent); }
          .leaderboard-tabs.many { display:grid; grid-template-columns:repeat(7,minmax(42px,1fr)); max-height:190px; overflow:auto; }
          .leaderboard-tabs.many button { min-width:0; min-height:36px; padding:0 6px; border-right:2px solid var(--panel-muted); border-bottom:2px solid var(--panel-muted); }
          .leaderboard-tabs.many button:first-child { grid-column:span 3; }
          .leaderboard-metric { margin:0; color:var(--panel-muted); font-size:12px; letter-spacing:.04em; text-transform:uppercase; }
          .player-form { display:grid; gap:10px; margin:22px 0 0; }
          .player-form[hidden],.player-saved[hidden],.status[hidden] { display:none; }
          .player-form label { color:var(--panel-muted); font-size:12px; letter-spacing:.04em; text-transform:uppercase; }
          .player-form input { width:100%; min-height:48px; padding:0 14px; border:2px solid var(--panel-muted); border-radius:var(--control-radius); color:var(--panel-ink); background:var(--field); font:700 18px/1 var(--shell-font); }
          .player-form input:focus-visible { outline:3px solid var(--focus); outline-offset:2px; }
          .player-form .primary { min-height:48px; border:2px solid var(--accent); border-radius:var(--control-radius); color:var(--ink); background:var(--accent); cursor:pointer; }
          .player-form .primary:hover,.player-form .primary:focus-visible { outline:3px solid var(--focus); outline-offset:2px; }
          .player-form .primary[disabled] { opacity:.6; cursor:progress; }
          .player-form .link { justify-self:start; padding:4px 0; border:0; color:var(--panel-muted); background:none; text-decoration:underline; cursor:pointer; }
          .player-saved { margin:0; padding:14px; border:2px solid var(--accent); border-radius:var(--control-radius); color:var(--panel-ink); }
          .player-message { min-height:1.5em; margin:14px 0 0; }
          .player-message.error { color:#ff9a85; }
          @media (max-width:720px) {
            .actions { top:max(10px,env(safe-area-inset-top)); right:max(10px,env(safe-area-inset-right)); bottom:auto; }
            .action { width:54px; min-height:46px; }
            .menu { top:54px; right:0; bottom:auto; width:min(260px,calc(100vw - 20px)); }
            .backdrop { align-items:end; padding:10px; }
            .panel { max-height:calc(100dvh - 20px); border-radius:22px; }
            .leaderboard-tabs.many { grid-template-columns:repeat(5,minmax(42px,1fr)); max-height:200px; }
            .leaderboard-tabs.many button:first-child { grid-column:span 2; }
          }
          @media (max-height:520px) and (orientation:landscape) {
            .actions { top:max(10px,env(safe-area-inset-top)); right:max(10px,env(safe-area-inset-right)); bottom:auto; display:flex; }
            .menu { top:0; right:62px; bottom:auto; }
          }
          @media (prefers-reduced-motion:reduce) { * { transition:none!important; } }
        </style>
        <a class="home" href="https://mann.cool/" aria-label="Back to mann.cool"><b aria-hidden="true">←</b><span>Back to mann.cool</span></a>
        <div class="actions">
          <a class="action tip" data-tip target="_blank" rel="noopener noreferrer" aria-label="Tip Jar"><span aria-hidden="true">$</span><span>Tip</span></a>
          <button class="action menu-button" type="button" aria-label="Open game menu" aria-expanded="false">☰</button>
          <div class="menu" hidden>
            <p class="menu-title"></p>
            ${leaderboardEnabled
              ? (leaderboardUrl
                ? `<a href="${leaderboardUrl}"><span>Leaderboard</span><span>↗</span></a>`
                : '<button type="button" data-open="leaderboard"><span>Leaderboard</span><span>↗</span></button>')
              : ""}
            ${playerIdentityEnabled ? '<button type="button" data-open="player"><span data-player-menu>Save your scores</span><span>↗</span></button>' : ""}
            <a data-tip data-tip-menu target="_blank" rel="noopener noreferrer"><span>Tip Jar</span><span>↗</span></a>
          </div>
        </div>
        <div class="backdrop" data-modal="leaderboard" hidden>
          <section class="panel" role="dialog" aria-modal="true" aria-labelledby="mann-cool-leaderboard-title">
            <button class="close" type="button" aria-label="Close">×</button><p class="kicker"></p>
            <h2 id="mann-cool-leaderboard-title">Leaderboard</h2>
            <div class="leaderboard-tabs" role="tablist" aria-label="Leaderboard boards"></div>
            <p class="leaderboard-metric"></p>
            <ol class="scores"><p class="status">Loading scores…</p></ol>
          </section>
        </div>
        ${playerIdentityEnabled ? `<div class="backdrop" data-modal="player" hidden>
          <section class="panel" role="dialog" aria-modal="true" aria-labelledby="mann-cool-player-title">
            <button class="close" type="button" aria-label="Close">×</button><p class="kicker"></p>
            <h2 id="mann-cool-player-title">Save your scores</h2>
            <p class="status" data-player-intro>Keep your scores if you clear your browser or switch devices. We'll email you a code, and only use your email for this.</p>
            <p class="player-saved" data-player-saved hidden></p>
            <form class="player-form" data-player-step="email">
              <label for="mann-cool-player-email">Email</label>
              <input id="mann-cool-player-email" name="email" type="email" autocomplete="email" maxlength="254" required>
              <button class="primary" type="submit">Send code</button>
            </form>
            <form class="player-form" data-player-step="code" hidden>
              <label for="mann-cool-player-code">6-digit code</label>
              <input id="mann-cool-player-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required>
              <button class="primary" type="submit">Confirm</button>
              <button class="link" type="button" data-player-back>Use a different email</button>
            </form>
            <p class="status player-message" data-player-message role="status" aria-live="polite"></p>
          </section>
        </div>` : ""}`;
      this.shadowRoot.querySelector(".menu-title").textContent = gameTitle;
      this.shadowRoot.querySelectorAll(".kicker").forEach((element) => { element.textContent = gameTitle; });
      // Until the config answers (or if it can't be read), the Tip Jar reaches Zeffy through mann.cool/tip.
      this.setTipUrl(`https://mann.cool/tip?from=${encodeURIComponent(slug)}`);
      this.renderLeaderboardControls();
    }

    renderLeaderboardControls() {
      const tabs = this.shadowRoot.querySelector(".leaderboard-tabs");
      const metric = this.shadowRoot.querySelector(".leaderboard-metric");
      tabs.replaceChildren();
      tabs.hidden = leaderboardBoards.length <= 1;
      tabs.classList.toggle("many", leaderboardBoards.length > 8);
      leaderboardBoards.forEach((board) => {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.leaderboardBoard = board.variant;
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", String(board.variant === this.leaderboardBoard?.variant));
        button.textContent = board.label || board.variant;
        tabs.append(button);
      });
      metric.textContent = this.leaderboardBoard?.metricLabel || "Score";
    }

    bindEvents() {
      const menuButton = this.shadowRoot.querySelector(".menu-button");
      const menu = this.shadowRoot.querySelector(".menu");
      menuButton.addEventListener("click", () => {
        const open = menu.hidden;
        menu.hidden = !open;
        menuButton.setAttribute("aria-expanded", String(open));
      });
      this.shadowRoot.querySelectorAll("[data-open]").forEach((button) => {
        button.addEventListener("click", () => {
          menu.hidden = true;
          menuButton.setAttribute("aria-expanded", "false");
          this.openModal(button.dataset.open);
        });
      });
      this.shadowRoot.querySelectorAll(".backdrop").forEach((backdrop) => {
        backdrop.addEventListener("click", (event) => { if (event.target === backdrop) this.closeModal(backdrop); });
        backdrop.querySelector(".close").addEventListener("click", () => this.closeModal(backdrop));
      });
      this.shadowRoot.querySelector(".leaderboard-tabs").addEventListener("click", (event) => {
        const button = event.target.closest("[data-leaderboard-board]");
        if (!button) return;
        const board = leaderboardBoards.find((candidate) => candidate.variant === button.dataset.leaderboardBoard);
        if (!board || board.variant === this.leaderboardBoard?.variant) return;
        this.leaderboardBoard = board;
        this.renderLeaderboardControls();
        this.loadLeaderboard();
      });
      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") this.shadowRoot.querySelectorAll(".backdrop:not([hidden])").forEach((modal) => this.closeModal(modal));
      });
      const playerPanel = this.shadowRoot.querySelector('[data-modal="player"]');
      if (playerPanel) {
        // Typing an email must not reach the game's own key handlers.
        for (const type of ["keydown", "keyup", "keypress"]) {
          playerPanel.addEventListener(type, (event) => { if (event.key !== "Escape") event.stopPropagation(); });
        }
        playerPanel.querySelector('[data-player-step="email"]').addEventListener("submit", (event) => { event.preventDefault(); this.sendPlayerCode(); });
        playerPanel.querySelector('[data-player-step="code"]').addEventListener("submit", (event) => { event.preventDefault(); this.verifyPlayerCode(); });
        playerPanel.querySelector("[data-player-back]").addEventListener("click", () => this.showPlayerStep("email"));
      }
    }

    async loadConfig() {
      try {
        const response = await fetch(`/platform/config.json?slug=${encodeURIComponent(slug)}`);
        this.config = await response.json();
      } catch {
        this.config = {};
      }
      // The config's Tip Jar link goes straight to the Zeffy form, tagged with this game's slug.
      if (/^https:\/\//.test(String(this.config.tipUrl))) this.setTipUrl(this.config.tipUrl);
      this.renderGameLinks(this.config.game);
    }

    // The corner "$ Tip" button and the menu's Tip Jar go to the same place.
    setTipUrl(href) {
      this.shadowRoot.querySelectorAll("[data-tip]").forEach((tip) => { tip.href = href; });
    }

    // The Song A Day song a game came from, and its public source code, sit above the Tip Jar.
    renderGameLinks(game) {
      const tipJar = this.shadowRoot.querySelector("[data-tip-menu]");
      const songs = Array.isArray(game?.songs) ? game.songs : [];
      const links = [
        ...songs.map((song) => [`Hear the song: Song A Day #${song.number}`, song.url]),
        ...(game?.sourceUrl ? [["Source", game.sourceUrl]] : []),
      ];
      for (const [label, href] of links) {
        if (!/^https:\/\//.test(String(href))) continue;
        const link = document.createElement("a");
        link.dataset.gameLink = "";
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        const text = document.createElement("span");
        text.textContent = label;
        const arrow = document.createElement("span");
        arrow.textContent = "↗";
        link.append(text, arrow);
        tipJar.before(link);
      }
    }

    openModal(name) {
      const modal = this.shadowRoot.querySelector(`[data-modal="${name}"]`);
      if (!modal) return;
      modal.hidden = false;
      modal.querySelector(".close").focus();
      if (name === "leaderboard") this.loadLeaderboard();
      if (name === "player") this.loadPlayerPanel();
    }

    async loadPlayerPanel() {
      const state = await loadPlayer();
      this.renderPlayerPanel(state);
      if (!state.linked && !this.playerEmail) this.showPlayerStep("email");
      try {
        // Another browser may have changed where this one's scores are saved.
        const data = await this.playerRequest("session", { secret: state.secret });
        if (Boolean(data.linked) !== Boolean(state.linked) || data.playerId !== state.playerId) {
          Object.assign(state, { playerId: data.playerId, linked: Boolean(data.linked), emailHint: data.emailHint || null });
          savePlayer(state); announcePlayer(state); this.renderPlayerPanel(state);
        }
      } catch {}
    }

    renderPlayerPanel(state) {
      const root = this.shadowRoot;
      const saved = root.querySelector("[data-player-saved]");
      saved.hidden = !state.linked;
      saved.textContent = state.linked ? `Your scores are saved to ${state.emailHint}. On another device, open Save your scores and enter the same email.` : "";
      root.querySelector("[data-player-intro]").hidden = Boolean(state.linked);
      if (state.linked) root.querySelectorAll("[data-player-step]").forEach((form) => { form.hidden = true; });
      root.querySelector("[data-player-menu]").textContent = state.linked ? "Scores saved ✓" : "Save your scores";
    }

    showPlayerStep(step) {
      this.shadowRoot.querySelectorAll("[data-player-step]").forEach((form) => { form.hidden = form.dataset.playerStep !== step; });
      this.setPlayerMessage("");
      if (step === "email") this.playerEmail = null;
      this.shadowRoot.querySelector(step === "email" ? "#mann-cool-player-email" : "#mann-cool-player-code").focus();
    }

    setPlayerMessage(text, error = false) {
      const message = this.shadowRoot.querySelector("[data-player-message]");
      message.textContent = text;
      message.classList.toggle("error", error);
    }

    async playerRequest(path, body) {
      const response = await fetch(`/api/v1/player/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
      return data;
    }

    async sendPlayerCode() {
      const form = this.shadowRoot.querySelector('[data-player-step="email"]');
      const button = form.querySelector(".primary");
      button.disabled = true;
      this.setPlayerMessage("Sending…");
      try {
        const state = await loadPlayer();
        const email = form.elements.email.value.trim();
        const data = await this.playerRequest("email/start", { secret: state.secret, email });
        this.showPlayerStep("code");
        this.playerEmail = email;
        this.setPlayerMessage(`We sent a code to ${data.emailHint}. It expires in 10 minutes.`);
      } catch (error) {
        this.setPlayerMessage(error.message, true);
      } finally {
        button.disabled = false;
      }
    }

    async verifyPlayerCode() {
      const form = this.shadowRoot.querySelector('[data-player-step="code"]');
      const button = form.querySelector(".primary");
      button.disabled = true;
      this.setPlayerMessage("Checking…");
      try {
        const state = await loadPlayer();
        const data = await this.playerRequest("email/verify", { secret: state.secret, email: this.playerEmail, code: form.elements.code.value });
        const returning = data.playerId !== state.playerId;
        Object.assign(state, { playerId: data.playerId, linked: true, emailHint: data.emailHint });
        savePlayer(state);
        announcePlayer(state);
        form.reset();
        this.playerEmail = null;
        this.renderPlayerPanel(state);
        this.setPlayerMessage(!returning ? "Saved."
          : data.merged ? `Welcome back. ${data.merged} score${data.merged === 1 ? "" : "s"} from this browser joined the rest.`
          : "Welcome back. Your scores are on this device now.");
      } catch (error) {
        this.setPlayerMessage(error.message, true);
      } finally {
        button.disabled = false;
      }
    }

    closeModal(modal) { modal.hidden = true; }

    async loadLeaderboard() {
      const container = this.shadowRoot.querySelector(".scores");
      const board = this.leaderboardBoard || { variant: leaderboardVariant, display: "number", aggregation: "best" };
      container.innerHTML = '<p class="status">Loading scores…</p>';
      try {
        const response = await fetch(`/api/v1/leaderboard?slug=${encodeURIComponent(slug)}&variant=${encodeURIComponent(board.variant)}&limit=25`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Leaderboard unavailable");
        container.replaceChildren();
        if (!data.entries.length) { const empty = document.createElement("p"); empty.className = "status"; empty.textContent = "No scores yet."; container.append(empty); return; }
        data.entries.forEach((entry) => {
          const item = document.createElement("li"); item.className = "score";
          const rank = document.createElement("span"); rank.className = "rank"; rank.textContent = entry.rank;
          const name = document.createElement("span"); name.textContent = entry.name;
          const score = document.createElement("strong"); score.textContent = this.formatLeaderboardScore(entry, board);
          item.append(rank, name, score); container.append(item);
        });
      } catch (error) { container.innerHTML = `<p class="status"></p>`; container.firstElementChild.textContent = error.message; }
    }

    formatLeaderboardScore(entry, board) {
      const value = Number(entry.displayScore ?? entry.score);
      if (board.display === "record" || board.aggregation === "win-loss-rate") {
        const wins = Number(entry.wins ?? entry.metadata?.wins ?? 0);
        const losses = Number(entry.losses ?? entry.metadata?.losses ?? 0);
        const draws = Number(entry.draws ?? entry.metadata?.draws ?? 0);
        const rate = Number.isFinite(value) ? `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%` : "—";
        return `${rate} · ${wins}-${losses}${draws ? `-${draws}` : ""}`;
      }
      if (board.display === "percent") return Number.isFinite(value) ? `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%` : "—";
      if (board.display === "integer") return Number.isFinite(value) ? Math.round(value).toLocaleString() : "—";
      if (board.display === "time-ms" && Number.isFinite(value)) {
        const totalSeconds = Math.max(0, value) / 1000;
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds - minutes * 60;
        return `${minutes}:${seconds.toFixed(2).padStart(5, "0")}`;
      }
      return Number.isFinite(value) ? value.toLocaleString() : "—";
    }
  }

  customElements.define("mann-cool-game-shell", MannCoolGameShell);
  document.documentElement.append(document.createElement("mann-cool-game-shell"));
})();
