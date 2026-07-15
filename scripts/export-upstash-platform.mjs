import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Redis } from "@upstash/redis";
import catalog from "../games.json" with { type: "json" };

function loadEnv(file) {
  const values = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

async function scanKeys(redis, pattern) {
  const keys = [];
  let cursor = "0";
  do {
    const result = await redis.scan(cursor, { match: pattern, count: 100 });
    cursor = String(result[0]);
    keys.push(...result[1]);
  } while (cursor !== "0");
  return keys;
}

function parseEntry(value) {
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return { message: value }; }
  }
  return value && typeof value === "object" ? value : {};
}

function canonicalLeaderboardSlug(value) {
  for (const game of catalog.games) {
    if (game.slug === value || game.leaderboard?.apiAliases?.includes(value)) return game.slug;
  }
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ? value : null;
}

const playAliases = {
  "dont-scroll": "dontscroll",
  "mouth-dream": "dream",
};

const envPath = process.argv[2] || path.resolve(process.cwd(), "../mann-dot-cool/.env.local");
const outputPath = process.argv[3] || path.resolve(process.cwd(), "migration-backups", `upstash-platform-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
const env = loadEnv(envPath);
const token = env.KV_REST_API_READ_ONLY_TOKEN || env.KV_REST_API_TOKEN;
if (!env.KV_REST_API_URL || !token) throw new Error("Upstash read-only credentials are unavailable");

const redis = new Redis({ url: env.KV_REST_API_URL, token });
const rawPlays = await redis.hgetall("game_plays") || {};
const plays = {};
for (const [rawSlug, value] of Object.entries(rawPlays)) {
  const slug = playAliases[rawSlug] || rawSlug;
  plays[slug] ||= [];
  plays[slug].push({ sourceSlug: rawSlug, count: Math.max(0, Math.trunc(Number(value) || 0)) });
}
const guestbookKeys = [...new Set(["guestbook_entries", ...(await scanKeys(redis, "guestbook_entries:*"))])];
const guestbooks = [];
for (const key of guestbookKeys) {
  const slug = key === "guestbook_entries" ? "mann-cool" : key.slice("guestbook_entries:".length);
  const entries = await redis.lrange(key, 0, -1) || [];
  for (const raw of entries) guestbooks.push({ key, slug, entry: parseEntry(raw) });
}

const leaderboardKeys = (await scanKeys(redis, "leaderboard:*")).filter((key) => !key.startsWith("leaderboard:clickstr"));
const leaderboards = [];
const skippedLeaderboardKeys = [];
for (const key of leaderboardKeys) {
  const [, rawSlug, ...variantParts] = key.split(":");
  const slug = canonicalLeaderboardSlug(rawSlug);
  if (!slug) { skippedLeaderboardKeys.push(key); continue; }
  const variant = variantParts.join(":") || "default";
  const values = await redis.zrange(key, 0, -1, { withScores: true }) || [];
  for (let index = 0; index < values.length; index += 2) {
    const entry = parseEntry(values[index]);
    const score = Number(values[index + 1]);
    const fingerprint = crypto.createHash("sha256").update(`${key}:${JSON.stringify(entry)}:${score}`).digest("hex").slice(0, 32);
    leaderboards.push({ key, slug, variant, score, submissionId: `legacy:${fingerprint}`, entry });
  }
}

const backup = {
  format: "mann-cool-upstash-platform-v1",
  exportedAt: new Date().toISOString(),
  plays,
  guestbooks,
  leaderboards,
  skippedLeaderboardKeys,
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(backup, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({
  outputPath,
  playSlugs: Object.keys(plays).length,
  guestbookEntries: guestbooks.length,
  leaderboardEntries: leaderboards.length,
  skippedLeaderboardKeys: skippedLeaderboardKeys.length,
}));
