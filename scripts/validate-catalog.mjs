import fs from "node:fs";

const root = new URL("../", import.meta.url);
const catalog = JSON.parse(fs.readFileSync(new URL("games.json", root), "utf8"));
const errors = [];
const reserved = new Set(["api", "platform", "assets", "covers", "game-gifs", "nes-game-images", "archive", "lab"]);
const tags = new Set(catalog.tagVocabulary || []);
const expectedTags = ["political", "art", "relaxing", "multiplayer", "funny", "weird", "game a day", "NSFW"];
const launchSlugs = new Set([
  "coldplay-canoodle", "ctn", "windows", "tallgrass", "chonksisyphus", "oil", "loki", "pong", "rcs",
  "kevin", "fuckice", "bubble", "cyber", "punkmatch", "beepleblox", "doge", "girlscouts", "dream",
  "kombatice", "lidstaysclosed", "meelode", "synthsnow", "protectgreenland", "penisvagina", "punksinspace",
  "towerofpunks", "armfulofpunks", "punkfling", "dontscroll", "perilouspenguin", "flighttosfo",
  "meebitsmountain", "100goombas", "sledding", "hell",
]);
// Song A Day #1 was 2009-01-01, one song a day since, counted in New York time.
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const todaysSong = Math.round((Date.parse(today) - Date.parse("2009-01-01")) / 86_400_000) + 1;
const songVideos = catalog.songVideos || {};
const usedSongs = new Set();
// Public repos the cards don't link as "Source" (checked 2026-10-21): some hold only a build, and
// some carry other people's NFT art or media.
const unlinkedSources = {
  tallgrass: "the repo holds only a Godot web export",
  bubble: "the repo holds only a Unity WebGL build",
  doge: "the repo holds only a Unity WebGL build",
  punkmatch: "the repo carries CryptoPunks images",
  punksinspace: "the repo carries CryptoPunks images",
  towerofpunks: "the repo carries CryptoPunks images",
  armfulofpunks: "the repo carries CryptoPunks images",
  punkfling: "the repo carries CryptoPunks images",
  meelode: "the repo carries Meebits art",
  meebitsmountain: "the repo carries Meebits art",
  rcs: "the repo carries XCOPY art and scraped images",
  kevin: "the repo carries the Pixelmon Kevin and CryptoPunks",
  beepleblox: "the repo carries Beeple art",
  chonksisyphus: "the repo carries Chonks NFT art",
  fuckice: "the repo carries Unity Asset Store packages and Super Mario Bros. 2 sprites",
  kombatice: "the repo has a committed .env.local to check, plus Mortal Kombat art",
  "coldplay-canoodle": "the repo carries kiss-cam photos of real people",
  "100goombas": "the repo carries Super Mario sprites",
  girlscouts: "the repo carries photos of cookie boxes",
};

if (catalog.version !== 1) errors.push("catalog version must be 1");
if (JSON.stringify([...tags]) !== JSON.stringify(expectedTags)) errors.push("tag vocabulary changed without approval");
if (!Array.isArray(catalog.games) || catalog.games.length < launchSlugs.size) errors.push("catalog must contain all 35 launch games");

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
  if (!["published", "hidden", "migrating", "lab"].includes(game.status)) errors.push(`${game.slug}: invalid status`);
  if (orders.has(game.catalogOrder)) errors.push(`${game.slug}: duplicate catalogOrder ${game.catalogOrder}`);
  orders.add(game.catalogOrder);
  if (game.featuredRank !== undefined) featuredRanks.push([game.featuredRank, game.slug]);
  if (!game.deviceSupport || !Object.values(game.deviceSupport).some(Boolean)) errors.push(`${game.slug}: no supported devices`);
  if (game.legacy !== undefined) errors.push(`${game.slug}: legacy origin metadata must not ship in the active catalog`);
  // Lab games are B-sides: they may stay on their own host (url) and may have no cover yet.
  const lab = game.status === "lab";
  if (lab && game.featuredRank !== undefined) errors.push(`${game.slug}: lab games can't be featured`);
  if (game.url !== undefined && !lab) errors.push(`${game.slug}: only lab games may link to an external url`);
  if (game.crypto !== undefined && (!lab || game.crypto !== true)) errors.push(`${game.slug}: crypto must be true and is only for lab games`);
  if (lab && game.url !== undefined) {
    let url = null;
    try { url = new URL(game.url); } catch {}
    if (url?.protocol !== "https:") errors.push(`${game.slug}: lab url must be an https URL`);
    if (game.delivery !== undefined) errors.push(`${game.slug}: a lab game uses either url or delivery, not both`);
  } else {
    if (game.delivery?.mode !== "worker-route") errors.push(`${game.slug}: every game on mann.cool must use a dedicated Worker route`);
    if (!game.delivery?.workerName || !game.delivery?.origin) errors.push(`${game.slug}: Worker metadata is required`);
  }
  if ((game.cover !== null || !lab) && !fs.existsSync(new URL(`public${game.cover}`, root))) {
    errors.push(`${game.slug}: missing cover ${game.cover}`);
  }
  if (game.hoverGif && !fs.existsSync(new URL(`public${game.hoverGif}`, root))) errors.push(`${game.slug}: missing hover GIF ${game.hoverGif}`);
  if (game.sourceUrl !== undefined && game.sourceUrl !== null && !/^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(game.sourceUrl)) {
    errors.push(`${game.slug}: sourceUrl must be null or a public GitHub repo URL`);
  }
  if (game.sourceUrl && unlinkedSources[game.slug]) errors.push(`${game.slug}: sourceUrl must stay null: ${unlinkedSources[game.slug]}`);
  if (game.songs !== undefined) {
    if (!Array.isArray(game.songs) || !game.songs.length) errors.push(`${game.slug}: songs must be a non-empty array`);
    for (const song of Array.isArray(game.songs) ? game.songs : []) {
      if (!Number.isInteger(song) || song < 1 || song > todaysSong) errors.push(`${game.slug}: song ${song} must be a Song A Day number from 1 to ${todaysSong}`);
      else if (!songVideos[song]) errors.push(`${game.slug}: song ${song} needs a songVideos entry`);
      usedSongs.add(String(song));
    }
    if (Array.isArray(game.songs) && new Set(game.songs).size !== game.songs.length) errors.push(`${game.slug}: duplicate song numbers`);
  }
  if (game.leaderboard?.boards !== undefined) {
    if (!Array.isArray(game.leaderboard.boards) || !game.leaderboard.boards.length) errors.push(`${game.slug}: leaderboard boards must be a non-empty array`);
    const boardVariants = new Set();
    for (const board of game.leaderboard.boards || []) {
      if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(board.variant || "")) errors.push(`${game.slug}: invalid leaderboard board variant ${board.variant}`);
      if (boardVariants.has(board.variant)) errors.push(`${game.slug}: duplicate leaderboard board ${board.variant}`);
      boardVariants.add(board.variant);
      if (!board.label || !board.metric || !board.metricLabel) errors.push(`${game.slug}/${board.variant}: board label and metric fields are required`);
      if (!["asc", "desc"].includes(board.direction)) errors.push(`${game.slug}/${board.variant}: invalid board direction`);
      if (!["number", "integer", "percent", "time-ms", "record"].includes(board.display)) errors.push(`${game.slug}/${board.variant}: invalid board display`);
      if (!["best", "win-loss-rate"].includes(board.aggregation)) errors.push(`${game.slug}/${board.variant}: invalid board aggregation`);
      if (board.aggregation === "win-loss-rate" && board.direction !== "desc") errors.push(`${game.slug}/${board.variant}: win/loss rate must rank descending`);
    }
    const legacyVariants = game.leaderboard.variants || [];
    if (JSON.stringify([...boardVariants]) !== JSON.stringify(legacyVariants)) errors.push(`${game.slug}: leaderboard variants must match board order`);
  }
}
for (const slug of launchSlugs) if (!slugs.has(slug)) errors.push(`missing launch game: ${slug}`);
for (const [song, video] of Object.entries(songVideos)) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(video)) errors.push(`songVideos ${song}: invalid YouTube video ID`);
  if (!usedSongs.has(song)) errors.push(`songVideos ${song}: no game lists this song`);
}

featuredRanks.sort((a, b) => a[0] - b[0]);
if (JSON.stringify(featuredRanks) !== JSON.stringify([[1, "fuckice"], [2, "coldplay-canoodle"], [3, "hell"]])) {
  errors.push("featured games must be FUCK ICE, Coldplay Canoodle, and Lindsay Graham In Hell in ranks 1-3");
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}
const labCount = catalog.games.filter((game) => game.status === "lab").length;
console.log(`Catalog valid: ${catalog.games.length} games (${labCount} in the lab), ${tags.size} approved tags, 3 featured games, ${usedSongs.size} linked songs.`);
