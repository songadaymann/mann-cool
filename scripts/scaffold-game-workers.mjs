import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = path.join(root, "games.json");
const sourceMap = JSON.parse(fs.readFileSync(path.join(root, "game-workers/source-map.json"), "utf8"));
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const requested = process.argv.slice(2);
const slugs = requested.length ? requested : Object.keys(sourceMap);

for (const slug of slugs) {
  const game = catalog.games.find((entry) => entry.slug === slug);
  if (!game || !sourceMap[slug]) throw new Error(`Unknown source-backed game: ${slug}`);
  const workerDir = path.join(root, "game-workers", slug);
  fs.mkdirSync(path.join(workerDir, "src"), { recursive: true });
  const title = JSON.stringify(game.title);
  const leaderboardUrl = JSON.stringify(game.leaderboard?.path || "");
  const leaderboardVariant = JSON.stringify(game.leaderboard?.variants?.[0] || "default");
  fs.writeFileSync(path.join(workerDir, "src/index.js"), `import { createStaticGameWorker } from "../../shared/static-worker.js";\n\nexport default createStaticGameWorker({\n  slug: ${JSON.stringify(slug)},\n  title: ${title},\n  leaderboard: ${Boolean(game.leaderboard?.enabled)},\n  leaderboardUrl: ${leaderboardUrl},\n  leaderboardVariant: ${leaderboardVariant},\n});\n`);
  const name = `mann-cool-${slug}`;
  const route = (host, suffix) => ({ pattern: `${host}/${slug}${suffix}`, zone_name: "mann.cool" });
  const config = {
    $schema: "../../node_modules/wrangler/config-schema.json",
    name,
    main: "src/index.js",
    compatibility_date: "2026-07-15",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: true,
    preview_urls: false,
    routes: [
      route("mann.cool", ""), route("mann.cool", "/*"),
      route("www.mann.cool", ""), route("www.mann.cool", "/*"),
    ],
    assets: { directory: "./.stage", binding: "ASSETS", run_worker_first: true },
    r2_buckets: [{ binding: "GAME_ASSETS", bucket_name: "mann-cool-game-assets" }],
    observability: {
      enabled: true,
      logs: { head_sampling_rate: 1 },
      traces: { enabled: true, head_sampling_rate: 0.05 },
    },
  };
  fs.writeFileSync(path.join(workerDir, "wrangler.jsonc"), `${JSON.stringify(config, null, 2)}\n`);
  game.delivery = {
    mode: "worker-route",
    origin: `https://${name}.novox-robot.workers.dev`,
    workerName: name,
    routePatterns: [`mann.cool/${slug}`, `mann.cool/${slug}/*`],
  };
}

fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Scaffolded ${slugs.length} dedicated game Workers.`);
