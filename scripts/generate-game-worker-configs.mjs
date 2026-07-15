import fs from "node:fs";
import path from "node:path";

const games = ["pong", "protectgreenland", "penisvagina", "punkfling"];
for (const slug of games) {
  const config = {
    $schema: "../../node_modules/wrangler/config-schema.json",
    name: `mann-cool-${slug}`,
    main: "src/index.js",
    compatibility_date: "2026-07-15",
    routes: [
      `mann.cool/${slug}`, `mann.cool/${slug}/*`, `mann.cool/${slug}*`,
      `www.mann.cool/${slug}`, `www.mann.cool/${slug}/*`, `www.mann.cool/${slug}*`,
    ].map((pattern) => ({ pattern, zone_name: "mann.cool" })),
    assets: { directory: "./assets", binding: "ASSETS", run_worker_first: true },
  };
  fs.writeFileSync(path.resolve(`game-workers/${slug}/wrangler.jsonc`), `${JSON.stringify(config, null, 2)}\n`);
}
