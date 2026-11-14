// https://mann.cool/admin/runs (worker/admin-runs.js): the private review page for submitted leaderboard runs.
// Everything shown comes from /api/v1/admin/runs and is set as text, never as HTML.
export const ADMIN_RUNS_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Submitted runs · mann.cool</title>
<style nonce="__NONCE__">
:root{--bg:#141210;--panel:#1f1b17;--rule:#3a332b;--ink:#f1e8d8;--muted:#a99c88;--accent:#7bd88f;--warn:#f2b35b;--bad:#ef7a6a;--focus:#ffe08a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:980px;margin:0 auto;padding:24px 16px 64px}
h1{margin:0 0 4px;font-size:28px;letter-spacing:-.01em}
.sub{margin:0 0 20px;color:var(--muted)}
button,input,select{font:inherit}
button{min-height:38px;padding:0 14px;border:2px solid var(--accent);border-radius:8px;background:transparent;color:var(--ink);cursor:pointer}
button.primary{background:var(--accent);color:#10140f;font-weight:700}
button.danger{border-color:var(--bad)}
button:focus-visible,input:focus-visible,select:focus-visible,a:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
button[disabled]{opacity:.55;cursor:progress}
input,select{min-height:38px;padding:0 10px;border:2px solid var(--rule);border-radius:8px;background:#0f0d0b;color:var(--ink)}
.gate{max-width:460px;padding:20px;border:1px solid var(--rule);border-radius:12px;background:var(--panel)}
.gate label{display:block;margin:0 0 8px;color:var(--muted);font-size:13px}
.gate .row{display:flex;gap:8px}.gate input{flex:1;min-width:0}
.error{color:var(--bad)}
.bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 16px}
.tabs{display:flex;flex-wrap:wrap;gap:6px}
.tabs button[aria-pressed="true"]{background:var(--accent);color:#10140f;font-weight:700}
.spacer{flex:1}
.note{color:var(--muted);font-size:13px}
.runs{display:grid;gap:12px;margin:0;padding:0;list-style:none}
.run{padding:16px;border:1px solid var(--rule);border-radius:12px;background:var(--panel)}
.top{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 14px}
.time{font:700 26px/1 ui-monospace,SFMono-Regular,Menlo,monospace}
.name{font-size:18px;font-weight:700;overflow-wrap:anywhere}
.badge{padding:2px 8px;border-radius:999px;border:1px solid var(--rule);font-size:12px;text-transform:uppercase;letter-spacing:.04em}
.badge.pending{border-color:var(--warn);color:var(--warn)}.badge.approved{border-color:var(--accent);color:var(--accent)}.badge.hidden,.badge.rejected{color:var(--muted)}
.facts{display:flex;flex-wrap:wrap;gap:6px 18px;margin:10px 0 0;color:var(--muted);font-size:14px}
.facts b{color:var(--ink);font-weight:600}
.warn{color:var(--warn)}
.reasons{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0}
.reason{padding:2px 8px;border-radius:6px;background:#3a2b14;color:var(--warn);font-size:13px}
a{color:var(--accent)}
details{margin:10px 0 0}summary{cursor:pointer;color:var(--muted);font-size:14px}
dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 16px;margin:8px 0 0;font-size:14px}dt{color:var(--muted)}dd{margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 0}
.toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);max-width:calc(100vw - 32px);padding:10px 16px;border-radius:10px;background:#2b2620;border:1px solid var(--rule)}
[hidden]{display:none!important}
</style>
</head>
<body>
<main>
  <h1>Submitted runs</h1>
  <p class="sub">Every run sent to the leaderboard. Held runs stay off the board until you approve them.</p>
  <section class="gate" data-gate hidden>
    <form data-gate-form>
      <label for="token">Admin token</label>
      <div class="row"><input id="token" name="token" type="password" autocomplete="current-password" required><button class="primary" type="submit">Open</button></div>
      <p class="error" data-gate-error role="alert"></p>
      <p class="note">This browser keeps the token until you sign out.</p>
    </form>
  </section>
  <section data-app hidden>
    <div class="bar">
      <div class="tabs" role="group" aria-label="Status" data-tabs></div>
      <span class="spacer"></span>
      <label class="note" for="slug">Game</label><input id="slug" data-slug size="12" autocomplete="off">
      <button type="button" data-refresh>Refresh</button>
      <button type="button" data-signout>Sign out</button>
    </div>
    <p class="note" data-status role="status"></p>
    <ol class="runs" data-runs></ol>
  </section>
</main>
<div class="toast" data-toast role="status" hidden></div>
<script nonce="__NONCE__">
(() => {
  const KEY = "mann-cool-admin-token";
  const $ = (selector) => document.querySelector(selector);
  const STATUSES = [["pending", "Waiting"], ["approved", "Approved"], ["hidden", "Hidden"], ["all", "All"]];
  const REASONS = { "top-ten": "Top ten", "below-time-floor": "Under 20 minutes", "faster-than-real-time": "Faster than real time" };
  const SPLITS = [["five-prisons", "Level 1"], ["hal-station", "Level 2"], ["meg3n-factory", "Level 3"], ["agentic-pods", "Level 4"], ["safe-mode", "SAFE MODE"], ["endgame", "Endgame"]];
  let token = ""; try { token = localStorage.getItem(KEY) || ""; } catch {}
  const params = new URLSearchParams(location.search);
  let status = params.get("status") || "pending", slug = params.get("slug") || "pdoom", busy = false;

  const time = (ms) => {
    if (!Number.isFinite(ms)) return "—";
    const total = Math.max(0, ms) / 1000, hours = Math.floor(total / 3600), minutes = Math.floor(total / 60) - hours * 60;
    const seconds = (total - Math.floor(total / 60) * 60).toFixed(2).padStart(5, "0");
    return hours ? hours + ":" + String(minutes).padStart(2, "0") + ":" + seconds : minutes + ":" + seconds;
  };
  const el = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children.filter((child) => child !== null && child !== undefined && child !== false)); return node; };
  function toast(text) { const box = $("[data-toast]"); box.textContent = text; box.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { box.hidden = true; }, 3500); }

  function showGate(message = "") {
    $("[data-app]").hidden = true; $("[data-gate]").hidden = false; $("[data-gate-error]").textContent = message; $("#token").focus();
  }
  $("[data-gate-form]").addEventListener("submit", (event) => {
    event.preventDefault(); token = $("#token").value.trim();
    try { localStorage.setItem(KEY, token); } catch {}
    $("#token").value = ""; load();
  });
  $("[data-signout]").addEventListener("click", () => { token = ""; try { localStorage.removeItem(KEY); } catch {} showGate(); });
  $("[data-refresh]").addEventListener("click", () => load());
  $("[data-slug]").value = slug;
  $("[data-slug]").addEventListener("change", (event) => { slug = event.target.value.trim() || "pdoom"; load(); });

  async function api(path, body) {
    const response = await fetch(path, body
      ? { method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify(body) }
      : { headers: { authorization: "Bearer " + token } });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 503) { if (response.status === 401) { token = ""; try { localStorage.removeItem(KEY); } catch {} } showGate(data.error || "Sign in again."); throw new Error("signed out"); }
    if (!response.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  }

  function renderTabs(counts) {
    const tabs = $("[data-tabs]");
    tabs.replaceChildren(...STATUSES.map(([key, label]) => {
      const n = key === "all" ? Object.values(counts).reduce((a, b) => a + b, 0) : counts[key] || 0;
      const button = el("button", { type: "button", textContent: label + " (" + n + ")" });
      button.setAttribute("aria-pressed", String(key === status));
      button.addEventListener("click", () => { status = key; load(); });
      return button;
    }));
  }

  function renderRun(run) {
    const ms = Number.isFinite(run.activeMs) ? run.activeMs : run.score;
    const top = el("div", { className: "top" },
      el("span", { className: "time", textContent: slug === "pdoom" ? time(ms) : String(run.score) }),
      el("span", { className: "name", textContent: run.name }),
      el("span", { className: "badge " + run.status, textContent: run.status }));
    let video = null;
    try { const href = new URL(String(run.videoUrl || "")); if (href.protocol === "https:") video = el("a", { href: href.toString(), target: "_blank", rel: "noopener noreferrer", textContent: "Watch ▶ " + href.hostname.replace(/^www\\./, "") }); } catch {}
    const facts = el("div", { className: "facts" },
      el("span", {}, "Sent ", el("b", { textContent: new Date(run.createdAt.replace(" ", "T") + (/Z|[+-]\\d\\d:?\\d\\d$/.test(run.createdAt) ? "" : "Z")).toLocaleString() })),
      run.signedIn ? el("span", {}, "Signed in ", el("b", { textContent: run.signedIn })) : el("span", { className: "warn", textContent: "Not signed in (doesn't count for the challenge)" }),
      video || el("span", { textContent: "No video" }),
      run.sameIpPlayers ? el("span", { className: "warn", textContent: "Same IP as " + run.sameIpPlayers + " other player" + (run.sameIpPlayers === 1 ? "" : "s") }) : null);
    const reasons = Array.isArray(run.review) && run.review.length ? el("div", { className: "reasons" }, ...run.review.map((reason) => el("span", { className: "reason", textContent: "Held: " + (REASONS[reason] || reason) }))) : null;
    const details = el("details", {}, el("summary", { textContent: "Details" }), el("dl", {},
      ...(run.splits ? SPLITS.flatMap(([key, label]) => [el("dt", { textContent: label }), el("dd", { textContent: time(run.splits[key]) })]) : []),
      ...(run.restarts !== undefined ? [el("dt", { textContent: "Restarts" }), el("dd", { textContent: String(run.restarts) })] : []),
      ...(run.ceo ? [el("dt", { textContent: "Hero" }), el("dd", { textContent: run.ceo === "amodei" ? "Dario" : "Sam" })] : []),
      ...(run.wallet ? [el("dt", { textContent: "Wallet" }), el("dd", { textContent: run.wallet.replace(/^sol:/, "") + (run.wallet.startsWith("sol:") ? " (Solana)" : " (Ethereum)") })] : []),
      el("dt", { textContent: "Player" }), el("dd", { textContent: run.playerId || "anonymous" }),
      el("dt", { textContent: "Submission" }), el("dd", { textContent: run.submissionId })));
    const actions = el("div", { className: "actions" });
    const act = (label, action, className = "") => {
      const button = el("button", { type: "button", className, textContent: label });
      button.addEventListener("click", async () => {
        if (busy) return; busy = true; button.disabled = true;
        try { await api("/api/v1/admin/runs/moderate", { slug, action, submissionIds: [run.submissionId] }); toast(run.name + ": " + (action === "approve" ? "approved, it's on the board" : action === "hide" ? "hidden" : "back to waiting")); await load(); }
        catch (error) { if (error.message !== "signed out") toast(error.message); }
        finally { busy = false; button.disabled = false; }
      });
      return button;
    };
    if (run.status !== "approved") actions.append(act("Approve", "approve", "primary"));
    if (run.status !== "hidden") actions.append(act("Hide", "hide", "danger"));
    if (run.status !== "pending") actions.append(act("Back to waiting", "pending"));
    return el("li", { className: "run" }, top, facts, reasons, details, actions);
  }

  async function load() {
    if (!token) { showGate(); return; }
    const url = new URL(location.href); url.searchParams.set("status", status); url.searchParams.set("slug", slug); history.replaceState(null, "", url);
    $("[data-status]").textContent = "Loading…";
    try {
      const data = await api("/api/v1/admin/runs?slug=" + encodeURIComponent(slug) + "&status=" + encodeURIComponent(status) + "&limit=300");
      $("[data-gate]").hidden = true; $("[data-app]").hidden = false;
      renderTabs(data.counts || {});
      $("[data-runs]").replaceChildren(...data.runs.map(renderRun));
      $("[data-status]").textContent = data.runs.length ? data.runs.length + " run" + (data.runs.length === 1 ? "" : "s") + ", newest first." : "No runs here.";
    } catch (error) { if (error.message !== "signed out") $("[data-status]").textContent = error.message; }
  }
  load();
})();
</script>
</body>
</html>`;
