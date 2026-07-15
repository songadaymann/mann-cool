import fs from "node:fs";

const root = new URL("../", import.meta.url);
const catalog = JSON.parse(fs.readFileSync(new URL("games.json", root), "utf8"));
const errors = [];
const reserved = new Set(["api", "platform", "assets", "covers", "game-gifs", "nes-game-images", "archive"]);
const tags = new Set(catalog.tagVocabulary || []);
const expectedTags = ["political", "art", "relaxing", "multiplayer", "funny", "weird", "NSFW"];

if (catalog.version !== 1) errors.push("catalog version must be 1");
if (JSON.stringify([...tags]) !== JSON.stringify(expectedTags)) errors.push("tag vocabulary changed without approval");
if (!Array.isArray(catalog.games) || catalog.games.length !== 35) errors.push("catalog must contain all 35 launch games");

const slugs = new Set();
const orders = new Set();
const featuredRanks = [];
for (const game of catalog.games || []) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(game.slug || "")) errors.push(`invalid slug: ${game.slug}`);
  if (slugs.has(game.slug)) errors.push(`duplicate slug: ${game.slug}`);
  if (reserved.has(game.slug)) errors.push(`reserved slug collision: ${game.slug}`);
  slugs.add(game.slug);
  if (!game.title || !game.description) errors.push(`${game.slug}: title and description are required`);
  if (!Array.isArray(game.tags) || !game.tags.length) errors.push(`${game.slug}: tags are required`);
  for (const tag of game.tags || []) if (!tags.has(tag)) errors.push(`${game.slug}: unapproved tag ${tag}`);
  if (!["published", "hidden", "migrating"].includes(game.status)) errors.push(`${game.slug}: invalid status`);
  if (orders.has(game.catalogOrder)) errors.push(`${game.slug}: duplicate catalogOrder ${game.catalogOrder}`);
  orders.add(game.catalogOrder);
  if (game.featuredRank !== undefined) featuredRanks.push([game.featuredRank, game.slug]);
  if (!game.deviceSupport || !Object.values(game.deviceSupport).some(Boolean)) errors.push(`${game.slug}: no supported devices`);
  if (!game.delivery || !["legacy-proxy", "worker-route"].includes(game.delivery.mode)) errors.push(`${game.slug}: invalid delivery mode`);
  if (game.delivery?.mode === "legacy-proxy" && !game.delivery.origin) errors.push(`${game.slug}: proxy origin is required`);
  const coverPath = new URL(`public${game.cover}`, root);
  if (!fs.existsSync(coverPath)) errors.push(`${game.slug}: missing cover ${game.cover}`);
  if (game.hoverGif && !fs.existsSync(new URL(`public${game.hoverGif}`, root))) errors.push(`${game.slug}: missing hover GIF ${game.hoverGif}`);
}

featuredRanks.sort((a, b) => a[0] - b[0]);
if (JSON.stringify(featuredRanks) !== JSON.stringify([[1, "fuckice"], [2, "coldplay-canoodle"], [3, "hell"]])) {
  errors.push("featured games must be FUCK ICE, Coldplay Canoodle, and Lindsay Graham In Hell in ranks 1-3");
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}
console.log(`Catalog valid: ${catalog.games.length} games, ${tags.size} approved tags, 3 featured games.`);
