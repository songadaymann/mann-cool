import fs from "node:fs";

const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || !outputPath) throw new Error("Usage: node scripts/upstash-export-to-d1-sql.mjs INPUT.json OUTPUT.sql");
const backup = JSON.parse(fs.readFileSync(inputPath, "utf8"));
if (backup.format !== "mann-cool-upstash-platform-v1") throw new Error("Unsupported backup format");
const quote = (value) => value === null || value === undefined ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
const statements = ["PRAGMA foreign_keys = ON;"];

const dataSlugs = new Set([
  ...Object.keys(backup.plays || {}),
  ...(backup.guestbooks || []).map((record) => record.slug),
  ...(backup.leaderboards || []).map((record) => record.slug),
]);
for (const slug of dataSlugs) {
  const title = slug.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
  statements.push(`INSERT INTO games (slug, title, status, leaderboard_enabled, leaderboard_direction) VALUES (${quote(slug)}, ${quote(title)}, 'hidden', 0, 'desc') ON CONFLICT(slug) DO NOTHING;`);
}

for (const [slug, sourceCounts] of Object.entries(backup.plays || {})) {
  for (const sourceCount of sourceCounts) {
    const source = `legacy-total:${sourceCount.sourceSlug}`.slice(0, 40);
    statements.push(`INSERT INTO play_totals (slug, source, play_count, updated_at) VALUES (${quote(slug)}, ${quote(source)}, ${sourceCount.count}, CURRENT_TIMESTAMP) ON CONFLICT(slug, source) DO UPDATE SET play_count = MAX(play_count, excluded.play_count), updated_at = CURRENT_TIMESTAMP;`);
  }
}

for (const record of backup.guestbooks || []) {
  const entry = record.entry || {};
  const legacyId = String(entry.id || entry.timestamp || crypto.randomUUID());
  const id = `legacy:${record.slug}:${legacyId}`.slice(0, 180);
  const name = String(entry.name || "Anonymous").trim().slice(0, 50) || "Anonymous";
  const message = String(entry.message || "").trim().slice(0, 500);
  if (!message) continue;
  const timestamp = entry.timestamp && !Number.isNaN(Date.parse(entry.timestamp)) ? new Date(entry.timestamp).toISOString() : backup.exportedAt;
  statements.push(`INSERT INTO guestbook_entries (id, slug, name, message, moderation_status, created_at) VALUES (${quote(id)}, ${quote(record.slug)}, ${quote(name)}, ${quote(message)}, 'approved', ${quote(timestamp)}) ON CONFLICT(id) DO NOTHING;`);
}

for (const record of backup.leaderboards || []) {
  const entry = record.entry || {};
  const name = String(entry.name || entry.playerName || "Anonymous").trim().slice(0, 30) || "Anonymous";
  const playerId = entry.address || entry.playerId || null;
  const timestampValue = entry.timestamp || entry.createdAt;
  const timestamp = timestampValue && !Number.isNaN(Date.parse(timestampValue)) ? new Date(timestampValue).toISOString() : backup.exportedAt;
  const metadata = { ...entry };
  delete metadata.name; delete metadata.playerName; delete metadata.address; delete metadata.playerId; delete metadata.score; delete metadata.timestamp; delete metadata.createdAt;
  statements.push(`INSERT INTO leaderboard_entries (submission_id, slug, variant, player_name, player_id, score, metadata, moderation_status, created_at) VALUES (${quote(record.submissionId)}, ${quote(record.slug)}, ${quote(record.variant)}, ${quote(name)}, ${quote(playerId)}, ${Number(record.score)}, ${quote(JSON.stringify(metadata))}, 'approved', ${quote(timestamp)}) ON CONFLICT(submission_id) DO NOTHING;`);
}

statements.push(`INSERT INTO migration_imports (source, source_key) VALUES ('upstash-platform-v1', ${quote(backup.exportedAt)}) ON CONFLICT(source, source_key) DO NOTHING;`);
fs.writeFileSync(outputPath, `${statements.join("\n")}\n`, { mode: 0o600 });
console.log(JSON.stringify({ outputPath, statements: statements.length }));
