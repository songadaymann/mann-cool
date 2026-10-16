#!/usr/bin/env node
// Review, approve or hide leaderboard rows in the platform D1 database via wrangler.
// Uses production (--remote) unless --local is given. Hidden rows are kept, not deleted.
//   node scripts/moderate-leaderboard.mjs list [--status pending|approved|hidden|rejected|all]
//       [--slug pdoom] [--variant five-prisons-rescue-v3] [--sort recent|score|score-asc] [--limit 25]
//   node scripts/moderate-leaderboard.mjs approve <submissionId>...
//   node scripts/moderate-leaderboard.mjs hide <submissionId>...
import { execFileSync } from "node:child_process";

const DATABASE = "mann-cool-platform";
const STATUSES = ["pending", "approved", "hidden", "rejected"];
const SUBMISSION_ID = /^[a-zA-Z0-9._:-]{8,100}$/;
const ORDER = { recent: "created_at DESC", score: "score DESC, created_at ASC", "score-asc": "score ASC, created_at ASC" };

const [command, ...rest] = process.argv.slice(2);
const flags = {};
const ids = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--local") flags.local = true;
  else if (rest[i].startsWith("--")) flags[rest[i].slice(2)] = rest[++i];
  else ids.push(rest[i]);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

// Every interpolated value is checked against a quote-free pattern first.
function checked(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) fail(`Invalid ${label}: ${value}`);
  return `'${value}'`;
}

function query(sql) {
  const output = execFileSync("npx", ["wrangler", "d1", "execute", DATABASE, flags.local ? "--local" : "--remote", "--json", "--command", sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  return JSON.parse(output).flatMap((result) => result.results || []);
}

const COLUMNS = `submission_id, slug, variant, player_name, score, moderation_status AS status, created_at,
  json_extract(metadata, '$.activeMs') AS active_ms, json_extract(metadata, '$.review') AS review`;

if (command === "list") {
  const status = flags.status || "pending";
  if (status !== "all" && !STATUSES.includes(status)) fail(`--status must be all or one of ${STATUSES.join(", ")}`);
  const order = ORDER[flags.sort || "recent"] || fail(`--sort must be one of ${Object.keys(ORDER).join(", ")}`);
  const limit = Number(flags.limit || 25);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) fail("--limit must be 1-500");
  const where = [
    status === "all" ? null : `moderation_status = '${status}'`,
    flags.slug ? `slug = ${checked(flags.slug, /^[a-z0-9-]{1,64}$/, "slug")}` : null,
    flags.variant ? `variant = ${checked(flags.variant, /^[a-zA-Z0-9._-]{1,40}$/, "variant")}` : null,
  ].filter(Boolean);
  const rows = query(`SELECT ${COLUMNS} FROM leaderboard_entries
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${order} LIMIT ${limit}`);
  if (rows.length) console.table(rows);
  else console.log(`No ${status === "all" ? "" : `${status} `}leaderboard rows.`);
} else if (command === "approve" || command === "hide") {
  if (!ids.length) fail(`Usage: node scripts/moderate-leaderboard.mjs ${command} <submissionId>...`);
  const list = ids.map((id) => checked(id, SUBMISSION_ID, "submission ID")).join(", ");
  const rows = query(`UPDATE leaderboard_entries SET moderation_status = '${command === "hide" ? "hidden" : "approved"}'
    WHERE submission_id IN (${list}) RETURNING ${COLUMNS}`);
  if (rows.length) console.table(rows);
  const missing = ids.filter((id) => !rows.some((row) => row.submission_id === id));
  if (missing.length) fail(`Not found: ${missing.join(", ")}`);
} else {
  fail("Usage: node scripts/moderate-leaderboard.mjs list|approve|hide [options] — see the header of this file.");
}
