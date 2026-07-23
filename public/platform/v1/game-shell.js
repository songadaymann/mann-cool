(() => {
  const script = document.currentScript;
  const slug = script?.dataset.slug || location.pathname.split("/").filter(Boolean)[0] || "";
  const gameTitle = script?.dataset.title || document.title || slug;
  const leaderboardEnabled = script?.dataset.leaderboard === "true";
  const leaderboardUrl = script?.dataset.leaderboardUrl || "";
  const leaderboardVariant = script?.dataset.leaderboardVariant || "default";
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

  class MannCoolGameShell extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this.config = null;
      this.turnstileToken = "";
      this.turnstileWidgetId = null;
      this.turnstileSetupPromise = null;
      this.leaderboardBoard = leaderboardBoards[0] || null;
    }

    connectedCallback() {
      this.render();
      this.bindEvents();
      this.loadConfig();
    }

    render() {
      this.shadowRoot.innerHTML = `
        <style>
          :host { ${shellThemeCss}; position:fixed; inset:0; z-index:2147483000; pointer-events:none; font:700 14px/1.2 var(--shell-font); color:var(--ink); }
          *,*::before,*::after { box-sizing:border-box; }
          button,a,input,textarea { font:inherit; }
          button,a,.panel,.backdrop { pointer-events:auto; }
          .home { position:absolute; top:${homeTop}; left:max(12px,env(safe-area-inset-left)); display:inline-flex; align-items:center; gap:8px; min-height:44px; padding:0 13px; border:2px solid var(--ink); border-radius:var(--control-radius); color:var(--ink); background:var(--paper); box-shadow:4px 4px 0 var(--ink); text-decoration:none; text-transform:uppercase; letter-spacing:.045em; }
          .home:hover,.home:focus-visible { outline:3px solid var(--focus); outline-offset:2px; color:var(--paper); background:var(--ink); box-shadow:2px 2px 0 var(--ink); transform:translate(2px,2px); }
          .home b { font-size:16px; }
          .actions { position:absolute; top:max(12px,env(safe-area-inset-top)); right:max(12px,env(safe-area-inset-right)); display:flex; gap:8px; }
          .action { display:flex; align-items:center; justify-content:center; gap:5px; width:62px; min-height:48px; border:2px solid var(--ink); border-radius:var(--control-radius); color:var(--ink); background:var(--paper); box-shadow:4px 4px 0 var(--ink); cursor:pointer; text-decoration:none; }
          .action:hover,.action:focus-visible { outline:3px solid var(--focus); outline-offset:2px; color:var(--paper); background:var(--ink); box-shadow:2px 2px 0 var(--ink); transform:translate(2px,2px); }
          .tip { color:var(--ink); background:var(--accent); font-size:11px; letter-spacing:.04em; text-transform:uppercase; }
          .tip:hover,.tip:focus-visible { color:var(--paper); background:var(--ink); }
          .tip[hidden] { display:none; }
          .menu-button { font-size:20px; }
          .menu { position:absolute; top:0; right:72px; width:min(280px,calc(100vw - 96px)); padding:0; border:2px solid var(--ink); border-radius:var(--control-radius); color:var(--ink); background:var(--paper); box-shadow:6px 6px 0 var(--ink); }
          .menu[hidden] { display:none; }
          .menu-title { margin:0; padding:13px; overflow:hidden; color:var(--muted); font-size:11px; letter-spacing:.08em; text-overflow:ellipsis; text-transform:uppercase; white-space:nowrap; }
          .menu button,.menu a { display:flex; align-items:center; justify-content:space-between; width:100%; min-height:46px; padding:0 13px; border:0; border-top:2px solid var(--rule); border-radius:0; color:var(--ink); background:var(--paper); text-align:left; text-decoration:none; text-transform:uppercase; letter-spacing:.04em; cursor:pointer; }
          .menu button:hover,.menu button:focus-visible,.menu a:hover,.menu a:focus-visible { outline:3px solid var(--focus); outline-offset:-3px; color:var(--paper); background:var(--ink); }
          .backdrop { position:fixed; inset:0; display:grid; place-items:center; padding:20px; background:rgba(0,0,0,.66); backdrop-filter:blur(8px); }
          .backdrop[hidden] { display:none; }
          .panel { position:relative; width:min(620px,100%); max-height:min(720px,calc(100dvh - 40px)); padding:clamp(24px,5vw,42px); border:3px solid var(--accent); border-radius:var(--panel-radius); color:var(--panel-ink); background:var(--panel); box-shadow:10px 10px 0 var(--ink),0 30px 100px rgba(0,0,0,.58); overflow:auto; }
          .close { position:absolute; top:17px; right:17px; display:grid; place-items:center; width:42px; height:42px; border:2px solid var(--panel-ink); border-radius:var(--control-radius); color:var(--panel-ink); background:var(--field); font-size:24px; cursor:pointer; }
          .close:hover,.close:focus-visible { outline:3px solid var(--focus); outline-offset:2px; color:var(--panel); background:var(--accent); }
          .kicker { margin:0 48px 8px 0; color:var(--accent); font-size:11px; letter-spacing:.1em; text-transform:uppercase; }
          h2 { margin:0 48px 26px 0; font-family:var(--heading-font); font-size:clamp(32px,7vw,54px); line-height:.95; letter-spacing:-.025em; text-transform:uppercase; }
          form { display:grid; gap:14px; }
          label { display:grid; gap:7px; color:var(--panel-muted); font-size:12px; letter-spacing:.05em; text-transform:uppercase; }
          input,textarea { width:100%; border:2px solid var(--panel-muted); border-radius:var(--control-radius); padding:12px; color:var(--panel-ink); background:var(--field); resize:vertical; }
          input:focus-visible,textarea:focus-visible { outline:3px solid var(--focus); outline-offset:2px; }
          form button { min-height:46px; border:2px solid var(--panel-ink); border-radius:var(--control-radius); color:var(--ink); background:var(--accent); box-shadow:4px 4px 0 var(--panel-ink); cursor:pointer; text-transform:uppercase; }
          form button:disabled { color:var(--muted); background:var(--rule); box-shadow:none; cursor:not-allowed; opacity:1; }
          .status { color:var(--panel-muted); line-height:1.5; }
          .entries,.scores { display:grid; gap:6px; margin:28px 0 0; padding:0; list-style:none; }
          .entry,.score { padding:13px; border:1px solid var(--rule); border-radius:var(--control-radius); background:var(--field); }
          .entry header,.score { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:12px; }
          .entry time { color:var(--panel-muted); font-size:11px; }
          .entry p { margin:8px 0 0; color:var(--panel-muted); font-weight:400; line-height:1.45; white-space:pre-wrap; }
          .score { grid-template-columns:36px minmax(0,1fr) auto; align-items:center; }
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
          .turnstile { min-height:65px; }
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
          <a class="action tip" data-tip target="_blank" rel="noopener noreferrer" hidden><span aria-hidden="true">$</span><span>Tip</span></a>
          <button class="action menu-button" type="button" aria-label="Open game menu" aria-expanded="false">☰</button>
          <div class="menu" hidden>
            <p class="menu-title"></p>
            <button type="button" data-open="guestbook"><span>Guestbook</span><span>↗</span></button>
            ${leaderboardEnabled
              ? (leaderboardUrl
                ? `<a href="${leaderboardUrl}"><span>Leaderboard</span><span>↗</span></a>`
                : '<button type="button" data-open="leaderboard"><span>Leaderboard</span><span>↗</span></button>')
              : ""}
            <a data-patreon target="_blank" rel="noopener noreferrer"><span>Patreon</span><span>↗</span></a>
          </div>
        </div>
        <div class="backdrop" data-modal="guestbook" hidden>
          <section class="panel" role="dialog" aria-modal="true" aria-labelledby="mann-cool-guestbook-title">
            <button class="close" type="button" aria-label="Close">×</button><p class="kicker"></p>
            <h2 id="mann-cool-guestbook-title">Guestbook</h2>
            <form>
              <label>Name<input name="name" maxlength="50" required autocomplete="name"></label>
              <label>Message<textarea name="message" maxlength="500" rows="3" required></textarea></label>
              <div class="turnstile"></div><p class="status form-status" hidden></p>
              <button type="submit" disabled>Sign guestbook</button>
            </form>
            <div class="entries"><p class="status">Loading notes…</p></div>
          </section>
        </div>
        <div class="backdrop" data-modal="leaderboard" hidden>
          <section class="panel" role="dialog" aria-modal="true" aria-labelledby="mann-cool-leaderboard-title">
            <button class="close" type="button" aria-label="Close">×</button><p class="kicker"></p>
            <h2 id="mann-cool-leaderboard-title">Leaderboard</h2>
            <div class="leaderboard-tabs" role="tablist" aria-label="Leaderboard boards"></div>
            <p class="leaderboard-metric"></p>
            <ol class="scores"><p class="status">Loading scores…</p></ol>
          </section>
        </div>`;
      this.shadowRoot.querySelector(".menu-title").textContent = gameTitle;
      this.shadowRoot.querySelectorAll(".kicker").forEach((element) => { element.textContent = gameTitle; });
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
      this.shadowRoot.querySelector("form").addEventListener("submit", (event) => this.submitGuestbook(event));
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
    }

    async loadConfig() {
      try {
        const response = await fetch("/platform/config.json");
        this.config = await response.json();
      } catch {
        this.config = { patreonUrl: "https://www.patreon.com/jonathanmann" };
      }
      const patreon = this.shadowRoot.querySelector("[data-patreon]");
      patreon.href = this.config.patreonUrl || "https://www.patreon.com/jonathanmann";
      const tip = this.shadowRoot.querySelector("[data-tip]");
      if (this.config.tipUrl) { tip.href = this.config.tipUrl; tip.hidden = false; }
      if (!this.config.turnstileSiteKey) this.setFormStatus("Guestbook signing is temporarily unavailable.");
    }

    async setupTurnstile() {
      if (!window.turnstile) {
        await new Promise((resolve, reject) => {
          const existing = document.querySelector('script[data-mann-cool-turnstile]');
          if (existing) { existing.addEventListener("load", resolve, { once:true }); existing.addEventListener("error", reject, { once:true }); return; }
          const loader = document.createElement("script");
          loader.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
          loader.async = true; loader.defer = true; loader.dataset.mannCoolTurnstile = "true";
          loader.addEventListener("load", resolve, { once:true }); loader.addEventListener("error", reject, { once:true });
          document.head.append(loader);
        });
      }
      this.turnstileWidgetId = window.turnstile.render(this.shadowRoot.querySelector(".turnstile"), {
        sitekey: this.config.turnstileSiteKey,
        theme: "dark",
        callback: (token) => { this.turnstileToken = token; this.shadowRoot.querySelector("form button[type=submit]").disabled = false; },
        "expired-callback": () => { this.turnstileToken = ""; this.shadowRoot.querySelector("form button[type=submit]").disabled = true; },
      });
    }

    ensureTurnstile() {
      if (!this.config?.turnstileSiteKey || this.turnstileWidgetId !== null) return;
      if (!this.turnstileSetupPromise) {
        this.turnstileSetupPromise = this.setupTurnstile().catch(() => {
          this.setFormStatus("Guestbook verification could not load. Please try again.", true);
        }).finally(() => { this.turnstileSetupPromise = null; });
      }
    }

    openModal(name) {
      const modal = this.shadowRoot.querySelector(`[data-modal="${name}"]`);
      if (!modal) return;
      modal.hidden = false;
      modal.querySelector(".close").focus();
      if (name === "guestbook") { this.loadGuestbook(); this.ensureTurnstile(); }
      if (name === "leaderboard") this.loadLeaderboard();
    }

    closeModal(modal) { modal.hidden = true; }

    setFormStatus(message, isError = false) {
      const status = this.shadowRoot.querySelector(".form-status");
      status.textContent = message;
      status.style.color = isError ? "#ff9c9c" : "var(--panel-muted)";
      status.hidden = !message;
    }

    async loadGuestbook() {
      const container = this.shadowRoot.querySelector(".entries");
      try {
        const response = await fetch(`/api/v1/guestbook?slug=${encodeURIComponent(slug)}&limit=50`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Guestbook unavailable");
        container.replaceChildren();
        if (!data.entries.length) { const empty = document.createElement("p"); empty.className = "status"; empty.textContent = "Be the first to leave a note."; container.append(empty); return; }
        data.entries.forEach((entry) => {
          const item = document.createElement("article"); item.className = "entry";
          const header = document.createElement("header"); const name = document.createElement("strong"); const time = document.createElement("time");
          name.textContent = entry.name; time.textContent = new Date(entry.timestamp).toLocaleDateString();
          const message = document.createElement("p"); message.textContent = entry.message;
          header.append(name, time); item.append(header, message); container.append(item);
        });
      } catch (error) { container.innerHTML = `<p class="status"></p>`; container.firstElementChild.textContent = error.message; }
    }

    async submitGuestbook(event) {
      event.preventDefault();
      const form = event.currentTarget; const button = form.querySelector("button[type=submit]");
      button.disabled = true; this.setFormStatus("Signing…");
      try {
        const fields = new FormData(form);
        const response = await fetch("/api/v1/guestbook", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ slug, name:fields.get("name"), message:fields.get("message"), turnstileToken:this.turnstileToken }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not sign guestbook");
        form.reset(); this.setFormStatus("Thanks for signing."); await this.loadGuestbook();
      } catch (error) { this.setFormStatus(error.message, true); }
      finally { this.turnstileToken = ""; if (window.turnstile && this.turnstileWidgetId !== null) window.turnstile.reset(this.turnstileWidgetId); }
    }

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
