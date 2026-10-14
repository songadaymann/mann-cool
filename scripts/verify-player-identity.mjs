#!/usr/bin/env node
// End-to-end check of email-linked player identity and wallet counts against a LOCAL
// worker started with PLAYER_EMAIL_DEV=1 (codes come back in the response instead of
// being emailed). It writes scores and profiles, so never point it at production.
//   node scripts/verify-player-identity.mjs --base http://127.0.0.1:8788
import assert from "node:assert/strict";

const argv = process.argv.slice(2);
const base = new URL(argv[argv.indexOf("--base") + 1] || "http://127.0.0.1:8788");
if (!["127.0.0.1", "localhost"].includes(base.hostname)) throw new Error("Local workers only: this writes test data");

const run = Math.random().toString(36).slice(2, 8);
const slug = "beepleblox";
const results = [];
let ip = 0;
const nextIp = () => `10.${run.length}.${++ip}.${Math.floor(Math.random() * 250)}`;

const b64 = (bytes) => Buffer.from(bytes).toString("base64url");
const newSecret = () => b64(crypto.getRandomValues(new Uint8Array(32)));
// Same derivation as the shell and worker.
async function derived(secret) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`mann.cool-player-v1:${secret}`));
  return `mc_${b64(new Uint8Array(digest)).slice(0, 24)}`;
}

async function call(path, body, { method = "POST", from = nextIp() } = {}) {
  const response = await fetch(new URL(path, base), {
    method,
    headers: { "content-type": "application/json", "cf-connecting-ip": from },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json() };
}
function pass(name) { results.push(name); }

async function link(secret, email, from = nextIp()) {
  const start = await call("/api/v1/player/email/start", { secret, email }, { from });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  assert.match(start.data.devCode, /^\d{6}$/);
  return { start, verify: await call("/api/v1/player/email/verify", { secret, email, code: start.data.devCode }, { from }) };
}

const emailOne = `player-${run}@example.com`;
const a = newSecret(), b = newSecret(), c = newSecret(), d = newSecret();
const idA = await derived(a), idB = await derived(b);

let r = await call("/api/v1/player/session", { secret: a });
assert.deepEqual([r.status, r.data.linked, r.data.playerId], [200, false, idA]);
pass("Unlinked browser: its player ID is derived from its secret (worker and shell agree)");

r = await call("/api/v1/player/email/start", { secret: a, email: "not-an-email" });
assert.equal(r.status, 400);
const from = nextIp();
const startA = await call("/api/v1/player/email/start", { secret: a, email: emailOne }, { from });
assert.equal(startA.data.emailHint, `p•••@example.com`);
const wrong = String((Number(startA.data.devCode) + 1) % 1_000_000).padStart(6, "0");
r = await call("/api/v1/player/email/verify", { secret: a, email: emailOne, code: wrong }, { from });
assert.deepEqual([r.status, r.data.error], [400, "That code isn't right."]);
r = await call("/api/v1/player/email/verify", { secret: b, email: emailOne, code: startA.data.devCode }, { from });
assert.equal(r.status, 400, "A code only works in the browser that asked for it");
r = await call("/api/v1/player/email/verify", { secret: a, email: emailOne, code: startA.data.devCode }, { from });
assert.deepEqual([r.status, r.data.linked, r.data.playerId, r.data.merged], [200, true, idA, 0]);
r = await call("/api/v1/player/email/verify", { secret: a, email: emailOne, code: startA.data.devCode }, { from });
assert.equal(r.status, 400, "A code works once");
pass("First browser links: bad email and wrong code refused, code bound to its browser and single-use");

// Browser B posts a score under its own ID, then proves the same email.
r = await call("/api/v1/leaderboard", { slug, name: "Test B", playerId: idB, score: 4321, submissionId: `verify-${run}-b` });
assert.equal(r.status, 201, JSON.stringify(r.data));
const linkB = await link(b, emailOne);
assert.deepEqual([linkB.verify.status, linkB.verify.data.playerId, linkB.verify.data.merged], [200, idA, 1]);
r = await call(`/api/v1/leaderboard?slug=${slug}&variant=default&limit=100`, null, { method: "GET" });
const moved = r.data.entries.find((entry) => entry.submissionId === `verify-${run}-b`);
assert.equal(moved?.playerId, idA);
r = await call("/api/v1/player/session", { secret: b });
assert.deepEqual([r.data.linked, r.data.playerId, r.data.emailHint], [true, idA, "p•••@example.com"]);
pass("Second browser, same email: takes the first browser's ID and its earlier score moves over");

// Browser C belongs to another email; it can't join the first one.
const linkC = await link(c, `other-${run}@example.com`);
assert.equal(linkC.verify.status, 200);
const crossC = await link(c, emailOne);
assert.deepEqual([crossC.verify.status, crossC.verify.data.error], [409, "This browser is already saved to another email."]);
pass("A browser saved to one email can't be moved to another");

// Five wrong guesses kill the code; the right one no longer works.
const lockFrom = nextIp();
const emailLock = `lock-${run}@example.com`;
const startD = await call("/api/v1/player/email/start", { secret: d, email: emailLock }, { from: lockFrom });
const wrongD = String((Number(startD.data.devCode) + 7) % 1_000_000).padStart(6, "0");
for (let i = 0; i < 5; i++) r = await call("/api/v1/player/email/verify", { secret: d, email: emailLock, code: wrongD }, { from: lockFrom });
assert.equal(r.data.error, "Too many tries. Send a new code.");
r = await call("/api/v1/player/email/verify", { secret: d, email: emailLock, code: startD.data.devCode }, { from: lockFrom });
assert.deepEqual([r.status, r.data.error], [400, "That code has expired. Send a new one."]);
pass("Five wrong codes lock that code");

// Three codes per email per hour, whatever the browser or IP.
const emailLimit = `limit-${run}@example.com`;
const statuses = [];
for (let i = 0; i < 4; i++) statuses.push((await call("/api/v1/player/email/start", { secret: newSecret(), email: emailLimit })).status);
assert.deepEqual(statuses, [200, 200, 200, 429]);
pass("Code emails are limited to 3 per address per hour");

// Wallet presence counts.
const before = (await call(`/api/v1/wallets?slug=${slug}&days=1`, null, { method: "GET" })).data;
assert.equal((await call("/api/v1/wallets", { slug, evm: true, solana: false, names: ["MetaMask", "MetaMask", "Rabby"] })).status, 201);
assert.equal((await call("/api/v1/wallets", { slug, evm: false, solana: false, names: [] })).status, 201);
const after = (await call(`/api/v1/wallets?slug=${slug}&days=1`, null, { method: "GET" })).data;
assert.deepEqual([after.reports - before.reports, after.withWallet - before.withWallet, after.withEvm - before.withEvm], [2, 1, 1]);
assert.equal(after.wallets.find((w) => w.name === "MetaMask").reports - (before.wallets.find((w) => w.name === "MetaMask")?.reports || 0), 1);
pass("Wallet reports: counted per game and day, names de-duplicated");

console.log(JSON.stringify({ passed: true, base: base.origin, cases: results }, null, 2));
