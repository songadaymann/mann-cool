import test, { after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The Tip Jar is Song A Day's Zeffy donation form. TIP_URL in wrangler.jsonc is the one place it's
// set; the site, Bot Blast and the game shell all link straight to it, and /tip redirects there.
const wrangler = JSON.parse((await fs.readFile("wrangler.jsonc", "utf8")).replace(/^\s*\/\/.*$/gm, ""));
const TIP_URL = wrangler.vars.TIP_URL;
const siteTip = `${TIP_URL}?utm_source=mann.cool`;
const gameTip = (slug) => `${siteTip}&utm_campaign=${slug}`;

const temp = await fs.mkdtemp(path.join(os.tmpdir(), "tip-jar-test-"));
after(() => fs.rm(temp, { recursive: true, force: true }));

await build({ entryPoints: ["worker/index.js"], bundle: true, platform: "node", format: "esm", outfile: path.join(temp, "worker.mjs"), logLevel: "silent" });
const { default: worker } = await import(path.join(temp, "worker.mjs"));

// The site's header and footer, and the Bot Blast page, rendered to HTML.
await fs.writeFile(path.join(temp, "pages.jsx"), `
import { renderToStaticMarkup } from "react-dom/server";
import { SiteFooter, SiteHeader } from ${JSON.stringify(path.resolve("src/SiteChrome.jsx"))};
import BotBlastPage from ${JSON.stringify(path.resolve("src/BotBlastPage.jsx"))};
export const header = (tipUrl) => renderToStaticMarkup(<SiteHeader tipUrl={tipUrl} />);
export const footer = (tipUrl) => renderToStaticMarkup(<SiteFooter tipUrl={tipUrl} showLab />);
export const botBlast = () => renderToStaticMarkup(<BotBlastPage />);
`);
await build({
  entryPoints: [path.join(temp, "pages.jsx")], bundle: true, platform: "node", format: "esm", jsx: "automatic",
  nodePaths: [path.resolve("node_modules")], loader: { ".css": "empty" }, outfile: path.join(temp, "pages.mjs"), logLevel: "silent",
  // react-dom/server requires Node built-ins, which an ES module bundle can't do without this.
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
});
const pages = await import(path.join(temp, "pages.mjs"));

const migrations = await Promise.all((await fs.readdir("migrations")).filter((file) => file.endsWith(".sql")).sort()
  .map((file) => fs.readFile(path.join("migrations", file), "utf8")));

function fixture(t, vars = { TIP_URL }) {
  const db = new DatabaseSync(":memory:");
  for (const sql of migrations) db.exec(sql);
  t.after(() => db.close());
  const wrap = (statement) => {
    let values = [];
    return {
      bind(...next) { values = next; return this; },
      async first() { return statement.get(...values) || null; },
      async all() { return { results: statement.all(...values) }; },
      async run() { return { meta: { changes: statement.run(...values).changes } }; },
    };
  };
  const env = { ...vars, DB: { prepare: (sql) => wrap(db.prepare(sql)) }, ASSETS: { fetch: () => new Response("spa") } };
  const request = (url, init = {}) => worker.fetch(new Request(`https://mann.cool${url}`, {
    redirect: "manual", ...init, headers: { "cf-connecting-ip": "192.0.2.93", ...init.headers },
  }), env);
  const config = async (query = "") => (await request(`/platform/config.json${query}`)).json();
  return { db, request, config };
}

// Every <a> in some HTML whose text is exactly `label`, with its attributes.
function linksLabelled(html, label) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)]
    .filter(([, , text]) => text.replace(/<[^>]+>/g, "").trim() === label)
    .map(([, attributes]) => Object.fromEntries([...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value.replaceAll("&amp;", "&")])));
}
const visibleText = (html) => html.replace(/<[^>]+>/g, " ");

test("TIP_URL is the Zeffy form, and nothing points at Stripe or the old Support link", async () => {
  assert.equal(TIP_URL, "https://www.zeffy.com/en-US/donation-form/song-a-day-studios");
  assert.equal(wrangler.vars.SUPPORT_URL, undefined);
  const files = ["wrangler.jsonc", "worker-configuration.d.ts", "worker/index.js", "public/platform/v1/game-shell.js",
    ...(await fs.readdir("src")).filter((file) => /\.(jsx?|css)$/.test(file)).map((file) => `src/${file}`)];
  for (const file of files) {
    const text = await fs.readFile(file, "utf8");
    assert.doesNotMatch(text, /\bstripe\b|SUPPORT_URL|supportUrl|#donate/i, file);
  }
});

test("the config's Tip Jar link is tagged with mann.cool, and in a game with its slug", async (t) => {
  const f = fixture(t);
  const site = await f.config();
  assert.equal(site.tipUrl, siteTip);
  assert.equal("supportUrl" in site, false);
  assert.equal((await f.config("?slug=sledding")).tipUrl, gameTip("sledding"));
  assert.equal((await f.config("?slug=not-a-game")).tipUrl, siteTip);
});

test("/tip still redirects old links to the same Zeffy form, and counts the click", async (t) => {
  const f = fixture(t);
  for (const [query, location, source] of [["", siteTip, "mann-cool"], ["?from=sledding", gameTip("sledding"), "sledding"]]) {
    const response = await f.request(`/tip${query}`);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), location);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(f.db.prepare("SELECT COUNT(*) AS count FROM tip_clicks WHERE source_slug = ?").get(source).count, 1);
  }
  assert.equal((await f.request("/tip", { method: "POST" })).status, 405);
});

test("with no TIP_URL there is no Tip Jar link to hand out", async (t) => {
  const f = fixture(t, {});
  assert.equal((await f.config()).tipUrl, null);
  assert.equal((await f.request("/tip")).status, 404);
});

test("the site header and footer each have one Tip Jar, straight to Zeffy in a new tab, and no Support", () => {
  for (const render of [pages.header, pages.footer]) {
    const html = render(siteTip);
    const tips = linksLabelled(html, "Tip Jar");
    assert.equal(tips.length, 1);
    assert.deepEqual([tips[0].href, tips[0].target, tips[0].rel], [siteTip, "_blank", "noopener noreferrer"]);
    assert.doesNotMatch(visibleText(html), /Support/);
    assert.doesNotMatch(html, /aria-label="[^"]*Support/);
    // Before the config answers, the Tip Jar is already there and reaches Zeffy through /tip.
    assert.deepEqual(linksLabelled(render(""), "Tip Jar").map((link) => link.href), ["/tip?from=mann-cool"]);
  }
});

test("Bot Blast has one Tip Jar, and its help link says Help, not Support", () => {
  const html = pages.botBlast();
  const tips = linksLabelled(html, "Tip Jar");
  assert.equal(tips.length, 1);
  assert.deepEqual([tips[0].target, tips[0].rel], ["_blank", "noopener noreferrer"]);
  assert.equal(linksLabelled(html, "Help")[0].href, "https://twitter-bot-destroyer-registry.novox-robot.workers.dev/support");
  assert.doesNotMatch(visibleText(html), /Support|Stripe/);
});

test("the game shell's menu has a Tip Jar in place of Support, and both tip links open Zeffy safely", async () => {
  const shell = await fs.readFile("public/platform/v1/game-shell.js", "utf8");
  assert.equal(shell.match(/<span>Tip Jar<\/span>/g)?.length, 1);
  assert.doesNotMatch(shell, /data-support|<span>Support<\/span>/);
  const tipLinks = shell.match(/<a [^>]*data-tip\b[^>]*>/g);
  assert.equal(tipLinks.length, 2);
  for (const link of tipLinks) assert.match(link, /target="_blank" rel="noopener noreferrer"/);
  // The config's tagged link replaces the /tip fallback once it arrives.
  assert.match(shell, /this\.setTipUrl\(this\.config\.tipUrl\)/);
  assert.match(shell, /https:\/\/mann\.cool\/tip\?from=\$\{encodeURIComponent\(slug\)\}/);
  // Games that draw their own tip button read the same link.
  assert.match(shell, /mannCool\.tipUrl = href;/);
});

// Every page, script and markup file a game Worker serves from this repo.
async function gameFiles(dir = "game-workers") {
  const files = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await gameFiles(file));
    else if (/\.(html?|m?js|ts)$/.test(entry.name)) files.push(file);
  }
  return files;
}

test("no game served from this repo links Patreon or Stripe", async () => {
  for (const file of await gameFiles()) {
    assert.doesNotMatch(await fs.readFile(file, "utf8"), /patreon\.com|buy\.stripe\.com|ko-fi\.com/i, file);
  }
});

test("Lindsay Graham In Hell's own Tip Jar button opens the shell's link, with /tip as the fallback", async () => {
  const bundle = await fs.readFile("game-workers/hell/assets/assets/player-bV2bU6c6.js", "utf8");
  assert.doesNotMatch(bundle, /patreon/i);
  assert.match(bundle, /\{id:"tip",label:"TIP JAR",shortLabel:"TIP",url:"https:\/\/mann\.cool\/tip\?from=hell"\}/);
  assert.match(bundle, /window\.open\(H\.id==="tip"&&window\.mannCool\?\.tipUrl\|\|H\.url,"_blank","noopener,noreferrer"\)/);
  // The pause screen's caption names the Tip Jar, not Support.
  assert.match(bundle, /"WAMP {2}\/ {2}TIP JAR {2}\/ {2}FOLLOW"/);
  assert.doesNotMatch(bundle, /"[^"]*\bSUPPORT\b[^"_]*"/);
});
