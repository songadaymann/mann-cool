(() => {
  const script = document.currentScript;
  const slug = script?.dataset.slug || location.pathname.split("/").filter(Boolean)[0] || "";
  const gameTitle = script?.dataset.title || document.title || slug;
  const leaderboardEnabled = script?.dataset.leaderboard === "true";
  const leaderboardUrl = script?.dataset.leaderboardUrl || "";
  const leaderboardVariant = script?.dataset.leaderboardVariant || "default";
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
    }

    connectedCallback() {
      this.render();
      this.bindEvents();
      this.loadConfig();
    }

    render() {
      this.shadowRoot.innerHTML = `
        <style>
          :host { --paper:#f8f5ea; --ink:#171713; --accent:#ffdd45; position:fixed; inset:0; z-index:2147483000; pointer-events:none; font:700 14px/1.2 Arial,Helvetica,sans-serif; color:var(--ink); }
          *,*::before,*::after { box-sizing:border-box; }
          button,a,input,textarea { font:inherit; }
          button,a,.panel,.backdrop { pointer-events:auto; }
          .home { position:absolute; top:max(12px,env(safe-area-inset-top)); left:max(12px,env(safe-area-inset-left)); display:inline-flex; align-items:center; gap:8px; min-height:44px; padding:0 15px 0 12px; border:1px solid rgba(255,255,255,.45); border-radius:999px; color:#fff; background:rgba(18,18,15,.78); box-shadow:0 8px 28px rgba(0,0,0,.25); backdrop-filter:blur(12px); text-decoration:none; }
          .home:hover,.home:focus-visible { background:rgba(18,18,15,.96); transform:translateX(-2px); }
          .home b { font-size:19px; }
          .actions { position:absolute; top:50%; right:max(12px,env(safe-area-inset-right)); display:grid; gap:8px; transform:translateY(-50%); }
          .action { display:grid; place-items:center; width:56px; min-height:56px; border:1px solid rgba(255,255,255,.5); border-radius:16px; color:#fff; background:rgba(18,18,15,.82); box-shadow:0 8px 28px rgba(0,0,0,.28); backdrop-filter:blur(12px); cursor:pointer; text-decoration:none; }
          .action:hover,.action:focus-visible { transform:translateY(-2px); }
          .tip { color:var(--ink); background:var(--accent); font-size:11px; text-transform:uppercase; }
          .tip[hidden] { display:none; }
          .menu-button { font-size:22px; }
          .menu { position:absolute; top:0; right:64px; width:min(260px,calc(100vw - 96px)); padding:8px; border:1px solid rgba(255,255,255,.2); border-radius:18px; color:#fff; background:rgba(19,19,15,.96); box-shadow:0 18px 60px rgba(0,0,0,.42); }
          .menu[hidden] { display:none; }
          .menu-title { margin:0; padding:11px 12px 9px; overflow:hidden; color:rgba(255,255,255,.55); font-size:11px; letter-spacing:.07em; text-overflow:ellipsis; text-transform:uppercase; white-space:nowrap; }
          .menu button,.menu a { display:flex; align-items:center; justify-content:space-between; width:100%; min-height:44px; padding:0 12px; border:0; border-radius:10px; color:#fff; background:transparent; text-align:left; text-decoration:none; cursor:pointer; }
          .menu button:hover,.menu button:focus-visible,.menu a:hover,.menu a:focus-visible { outline:none; background:rgba(255,255,255,.1); }
          .backdrop { position:fixed; inset:0; display:grid; place-items:center; padding:20px; background:rgba(0,0,0,.66); backdrop-filter:blur(8px); }
          .backdrop[hidden] { display:none; }
          .panel { position:relative; width:min(620px,100%); max-height:min(720px,calc(100dvh - 40px)); padding:clamp(24px,5vw,42px); border:1px solid rgba(255,255,255,.22); border-radius:24px; color:#fff; background:#171713; box-shadow:0 30px 100px rgba(0,0,0,.58); overflow:auto; }
          .close { position:absolute; top:17px; right:17px; display:grid; place-items:center; width:42px; height:42px; border:1px solid rgba(255,255,255,.24); border-radius:50%; color:#fff; background:rgba(255,255,255,.08); font-size:24px; cursor:pointer; }
          .kicker { margin:0 48px 8px 0; color:#f4d94f; font-size:11px; letter-spacing:.09em; text-transform:uppercase; }
          h2 { margin:0 48px 26px 0; font-size:clamp(32px,7vw,54px); line-height:.95; letter-spacing:-.055em; }
          form { display:grid; gap:14px; }
          label { display:grid; gap:7px; color:rgba(255,255,255,.72); font-size:12px; text-transform:uppercase; }
          input,textarea { width:100%; border:1px solid rgba(255,255,255,.2); border-radius:10px; padding:12px; color:#fff; background:rgba(255,255,255,.08); resize:vertical; }
          form button { min-height:46px; border:0; border-radius:10px; color:var(--ink); background:var(--accent); cursor:pointer; }
          form button:disabled { cursor:not-allowed; opacity:.5; }
          .status { color:rgba(255,255,255,.62); line-height:1.5; }
          .entries,.scores { display:grid; gap:6px; margin:28px 0 0; padding:0; list-style:none; }
          .entry,.score { padding:13px; border-radius:10px; background:rgba(255,255,255,.06); }
          .entry header,.score { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:12px; }
          .entry time { color:rgba(255,255,255,.42); font-size:11px; }
          .entry p { margin:8px 0 0; color:rgba(255,255,255,.72); font-weight:400; line-height:1.45; white-space:pre-wrap; }
          .score { grid-template-columns:36px minmax(0,1fr) auto; align-items:center; }
          .rank { color:var(--accent); }
          .turnstile { min-height:65px; }
          @media (max-width:720px) {
            .actions { top:auto; right:max(10px,env(safe-area-inset-right)); bottom:max(14px,env(safe-area-inset-bottom)); display:flex; transform:none; }
            .action { width:52px; min-height:52px; border-radius:14px; }
            .menu { top:auto; right:0; bottom:61px; width:min(260px,calc(100vw - 20px)); }
            .backdrop { align-items:end; padding:10px; }
            .panel { max-height:calc(100dvh - 20px); border-radius:22px; }
          }
          @media (max-height:520px) and (orientation:landscape) {
            .actions { top:50%; right:max(10px,env(safe-area-inset-right)); bottom:auto; display:grid; transform:translateY(-50%); }
            .menu { top:0; right:61px; bottom:auto; }
          }
          @media (prefers-reduced-motion:reduce) { * { transition:none!important; } }
        </style>
        <a class="home" href="https://mann.cool/" aria-label="Return to mann.cool"><b aria-hidden="true">←</b><span>mann.cool</span></a>
        <div class="actions">
          <a class="action tip" data-tip target="_blank" rel="noopener noreferrer" hidden>Tip</a>
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
            <ol class="scores"><p class="status">Loading scores…</p></ol>
          </section>
        </div>`;
      this.shadowRoot.querySelector(".menu-title").textContent = gameTitle;
      this.shadowRoot.querySelectorAll(".kicker").forEach((element) => { element.textContent = gameTitle; });
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
      if (this.config.turnstileSiteKey) await this.setupTurnstile();
      else this.setFormStatus("Guestbook signing is temporarily unavailable.");
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

    openModal(name) {
      const modal = this.shadowRoot.querySelector(`[data-modal="${name}"]`);
      if (!modal) return;
      modal.hidden = false;
      modal.querySelector(".close").focus();
      if (name === "guestbook") this.loadGuestbook();
      if (name === "leaderboard") this.loadLeaderboard();
    }

    closeModal(modal) { modal.hidden = true; }

    setFormStatus(message, isError = false) {
      const status = this.shadowRoot.querySelector(".form-status");
      status.textContent = message;
      status.style.color = isError ? "#ff9c9c" : "rgba(255,255,255,.62)";
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
      try {
        const response = await fetch(`/api/v1/leaderboard?slug=${encodeURIComponent(slug)}&variant=${encodeURIComponent(leaderboardVariant)}&limit=25`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Leaderboard unavailable");
        container.replaceChildren();
        if (!data.entries.length) { const empty = document.createElement("p"); empty.className = "status"; empty.textContent = "No scores yet."; container.append(empty); return; }
        data.entries.forEach((entry) => {
          const item = document.createElement("li"); item.className = "score";
          const rank = document.createElement("span"); rank.className = "rank"; rank.textContent = entry.rank;
          const name = document.createElement("span"); name.textContent = entry.name;
          const score = document.createElement("strong"); score.textContent = Number(entry.displayScore ?? entry.score).toLocaleString();
          item.append(rank, name, score); container.append(item);
        });
      } catch (error) { container.innerHTML = `<p class="status"></p>`; container.firstElementChild.textContent = error.message; }
    }
  }

  customElements.define("mann-cool-game-shell", MannCoolGameShell);
  document.documentElement.append(document.createElement("mann-cool-game-shell"));
})();
