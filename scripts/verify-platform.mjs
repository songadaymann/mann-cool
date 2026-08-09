#!/usr/bin/env node

const argv = process.argv.slice(2);
const options = {};
for (let index = 0; index < argv.length; index += 1) {
  if (argv[index].startsWith("--")) options[argv[index].slice(2)] = argv[++index];
}

const base = new URL(options.base || "http://127.0.0.1:8788");
const allowWrites = options.writes === "true";
const results = [];

async function check(path, expected, init = {}) {
  const url = new URL(path, base);
  const response = await fetch(url, { redirect: "manual", ...init });
  const body = await response.text();
  let json;
  try { json = JSON.parse(body); } catch { json = null; }
  const statuses = Array.isArray(expected) ? expected : [expected];
  if (!statuses.includes(response.status)) {
    throw new Error(`${init.method || "GET"} ${url.pathname} returned ${response.status}: ${body.slice(0, 200)}`);
  }
  results.push({ method: init.method || "GET", path: `${url.pathname}${url.search}`, status: response.status });
  return { response, body, json };
}

const config = await check("/platform/config.json", 200);
if (config.json?.version !== 1 || !config.json?.homeUrl || !config.json?.patreonUrl) {
  throw new Error("Platform config is incomplete");
}
const shell = await check("/platform/v1/game-shell.js", 200, { redirect: "follow" });
if (!shell.body.includes("api/v1/plays") || !shell.body.includes("/tip?from=") || !shell.body.includes("leaderboardBoards") || !shell.body.includes("data-leaderboard-board")) {
  throw new Error("Shared shell does not reference play tracking, tip attribution, and toggleable leaderboard boards");
}
if (shell.body.includes("api/v1/guestbook") || shell.body.includes("Guestbook")) {
  throw new Error("Shared shell still contains the retired per-game guestbook");
}

for (const prefix of ["/api/v1", "/api"]) {
  const plays = await check(`${prefix}/plays?slug=fuckice`, 200);
  if (plays.json?.slug !== "fuckice" || !Number.isFinite(plays.json?.count)) throw new Error(`${prefix}/plays shape is invalid`);
  await check(`${prefix}/plays?slug=not-a-registered-game`, 404);
  const tipClicks = await check(`${prefix}/tip-clicks?slug=fuckice`, 200);
  if (tipClicks.json?.slug !== "fuckice" || !Number.isFinite(tipClicks.json?.count)) throw new Error(`${prefix}/tip-clicks shape is invalid`);
  await check(`${prefix}/tip-clicks?slug=not-a-registered-game`, 404);
  const guestbook = await check(`${prefix}/guestbook?slug=mann-cool&limit=2`, 200);
  if (guestbook.json?.slug !== "mann-cool" || !Array.isArray(guestbook.json?.entries)) throw new Error(`${prefix}/guestbook shape is invalid`);
  const commentCounts = await check(`${prefix}/comments`, 200);
  if (!commentCounts.json?.counts || Array.isArray(commentCounts.json.counts)) throw new Error(`${prefix}/comments count shape is invalid`);
  const comments = await check(`${prefix}/comments?slug=hell&limit=2`, 200);
  if (comments.json?.slug !== "hell" || !Array.isArray(comments.json?.entries) || comments.json.entries.some((entry) => entry.slug !== "hell")) {
    throw new Error(`${prefix}/comments shape or slug isolation is invalid`);
  }
  await check(`${prefix}/leaderboard?slug=sledding&variant=not-real`, 400);
  await check(`${prefix}/leaderboard?slug=fuckice&variant=default`, 404);
  const ascending = await check(`${prefix}/leaderboard?slug=sledding&variant=default&limit=100`, 200);
  if (ascending.json?.direction !== "asc") throw new Error("Ascending leaderboard configuration is missing");
  const descending = await check(`${prefix}/leaderboard?slug=punkfling&variant=default&limit=100`, 200);
  if (descending.json?.direction !== "desc") throw new Error("Descending leaderboard configuration is missing");
}

await check("/api/v1/comments", [400, 503], {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ slug: "fuckice", name: "Platform audit", message: "Turnstile is required" }),
});
await check("/api/v1/plays", 404, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ slug: "not-a-registered-game", source: "verification" }),
});
await check("/api/v1/plays", 415, { method: "POST", body: "{}" });
await check("/api/v1/plays", 413, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ slug: "fuckice", source: "verification", padding: "x".repeat(2_100) }),
});
const preflight = await check("/api/v1/comments", 204, { method: "OPTIONS" });
if (preflight.response.headers.get("access-control-allow-origin") !== "*") throw new Error("CORS preflight headers are missing");

if (allowWrites) {
  const tipClicksBefore = await check("/api/v1/tip-clicks?slug=fuckice", 200);
  const tipRedirect = await check("/tip?from=fuckice", 302);
  if (tipRedirect.response.headers.get("location") !== config.json.tipUrl) throw new Error("Tip redirect destination is incorrect");
  if (tipRedirect.response.headers.get("cache-control") !== "no-store") throw new Error("Tip redirect must not be cached");
  const tipClicksAfter = await check("/api/v1/tip-clicks?slug=fuckice", 200);
  if (tipClicksAfter.json.count !== tipClicksBefore.json.count + 1) throw new Error("Tip click total did not increment exactly once");

  const before = await check("/api/v1/plays?slug=fuckice", 200);
  await check("/api/v1/plays", 200, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ slug: "fuckice", source: "verification" }),
  });
  const after = await check("/api/v1/plays?slug=fuckice", 200);
  if (after.json.count !== before.json.count + 1) throw new Error("Play total did not increment exactly once");

  const run = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const submit = async (slug, score, suffix, legacy = false) => check(`${legacy ? "/api" : "/api/v1"}/leaderboard`, legacy ? 200 : 201, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": `audit-${run}-${suffix}` },
    body: JSON.stringify({ slug, variant: "default", name: "Platform audit", score, metadata: { verificationRun: run } }),
  });
  await submit("sledding", 20, "sled-high");
  await submit("sledding", 10, "sled-low", true);
  await submit("punkfling", 10, "fling-low");
  await submit("punkfling", 20, "fling-high", true);

  const idempotencyKey = `audit-${run}-idempotent`;
  const firstIdempotent = await check("/api/v1/leaderboard", 201, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify({ slug: "sledding", variant: "default", name: "Platform audit", score: 30 }),
  });
  const retryIdempotent = await check("/api/v1/leaderboard", 201, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify({ slug: "sledding", variant: "default", name: "Changed retry", score: -999 }),
  });
  if (firstIdempotent.json.entry.score !== 30 || retryIdempotent.json.entry.score !== 30 || retryIdempotent.json.rank !== firstIdempotent.json.rank) {
    throw new Error("Leaderboard idempotency retry changed the stored score or rank");
  }
  await check("/api/v1/leaderboard", 400, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": `audit-${run}-metadata` },
    body: JSON.stringify({ slug: "sledding", variant: "default", name: "Platform audit", score: 40, metadata: ["invalid"] }),
  });
  const crossVariantKey = `audit-${run}-variant`;
  await check("/api/v1/leaderboard", 201, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": crossVariantKey },
    body: JSON.stringify({ slug: "punkmatch", variant: "4x4", name: "Platform audit", score: 50 }),
  });
  await check("/api/v1/leaderboard", 409, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": crossVariantKey },
    body: JSON.stringify({ slug: "punkmatch", variant: "6x6", name: "Platform audit", score: 50 }),
  });

  const asc = (await check("/api/v1/leaderboard?slug=sledding&variant=default&limit=100", 200)).json.entries
    .filter((entry) => entry.metadata?.verificationRun === run);
  const desc = (await check("/api/v1/leaderboard?slug=punkfling&variant=default&limit=100", 200)).json.entries
    .filter((entry) => entry.metadata?.verificationRun === run);
  if (asc.length !== 2 || asc[0].score !== 10 || asc[1].score !== 20) throw new Error("Ascending leaderboard order is wrong");
  if (desc.length !== 2 || desc[0].score !== 20 || desc[1].score !== 10) throw new Error("Descending leaderboard order is wrong");
}

console.log(JSON.stringify({ base: base.toString(), writes: allowWrites, checks: results }, null, 2));
console.log(`Verified ${results.length} platform API and shell behaviors.`);
