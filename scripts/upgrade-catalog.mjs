import fs from "node:fs";

const catalogPath = new URL("../games.json", import.meta.url);
const current = JSON.parse(fs.readFileSync(catalogPath, "utf8"));

const metadata = {
  "coldplay-canoodle": ["A tiny word game about the kiss-cam moment nobody could stop watching.", ["funny", "weird"]],
  ctn: ["Run, jump, and survive the annual nightmare of crypto taxes.", ["funny", "weird"]],
  windows: ["A broken-computer fever dream where the error messages fight back.", ["funny", "weird"]],
  tallgrass: ["Wander through tall grass and discover what is hiding inside it.", ["art", "relaxing"]],
  chonksisyphus: ["Help a very determined chonk push onward against impossible odds.", ["funny", "weird"]],
  oil: ["A slippery mobile game about power, scandal, and keeping your balance.", ["political", "funny", "weird"]],
  loki: ["A mythic, shape-shifting browser adventure.", ["art", "weird"]],
  pong: ["Pong rebuilt as a collaborative music game.", ["art", "multiplayer"]],
  rcs: ["Save the art before somebody else right-clicks it first.", ["art", "funny"]],
  kevin: ["Run with Kevin. Do not ask Kevin to slow down.", ["funny", "weird"]],
  fuckice: ["A furious arcade game about resisting ICE.", ["political", "funny"]],
  bubble: ["Drift, distort, and become one with a very strange bubble.", ["art", "relaxing", "weird"]],
  cyber: ["Smash through a bright cyber-sunshine playground.", ["art", "funny", "weird"]],
  punkmatch: ["A fast memory-matching game made from CryptoPunks.", ["art", "relaxing"]],
  beepleblox: ["Stack, sort, and survive a world built from Beeple blocks.", ["art", "weird"]],
  doge: ["A small game made in memory of Kabosu.", ["art", "relaxing"]],
  girlscouts: ["Sort the scouts before the whole troop gets out of hand.", ["funny"]],
  dream: ["A surreal journey into the mouth dream.", ["art", "weird"]],
  kombatice: ["Fight the cold in a pocket-sized combat game.", ["funny"]],
  lidstaysclosed: ["Whatever happens, the lid stays closed.", ["funny", "weird"]],
  meelode: ["Classic platforming rebuilt with Meebits and pixels.", ["art"]],
  synthsnow: ["Make music in an endless field of synthesized snow.", ["art", "relaxing"]],
  protectgreenland: ["Defend Greenland in a political arcade scramble.", ["political", "funny"]],
  penisvagina: ["An adults-only multiplayer game about bodies and boundaries.", ["multiplayer", "funny", "NSFW"]],
  punksinspace: ["Launch a crew of punks into the void.", ["art", "funny"]],
  towerofpunks: ["Build a precarious tower out of tiny punks.", ["art", "funny"]],
  armfulofpunks: ["Catch as many falling punks as your arms can hold.", ["art", "funny"]],
  punkfling: ["Fling a punk and see how far chaos can carry it.", ["art", "funny"]],
  dontscroll: ["The only rule is right there in the title.", ["funny", "weird"]],
  perilouspenguin: ["Guide a brave penguin through a very bad day.", ["funny"]],
  flighttosfo: ["Take a strange and scenic flight to San Francisco.", ["art", "relaxing", "weird"]],
  meebitsmountain: ["Climb a mountain populated by Meebits.", ["art"]],
  "100goombas": ["One hundred Goombas. One increasingly complicated problem.", ["funny", "weird"]],
  sledding: ["Launch a sled, chase distance, and try again.", ["funny", "relaxing"]],
  hell: ["Escape a pixel-art inferno starring Senator Lindsey Graham.", ["political", "funny", "weird"]],
};

const featured = { fuckice: 1, "coldplay-canoodle": 2, hell: 3 };
const dedicatedWorkers = {
  "coldplay-canoodle": "mann-cool-coldplay-canoodle",
  fuckice: "mann-cool-fuckice",
  hell: "mann-cool-hell-redirect",
  sledding: "mann-cool-sledding",
  pong: "mann-cool-pong",
  protectgreenland: "mann-cool-protectgreenland",
  penisvagina: "mann-cool-penisvagina",
  punkfling: "mann-cool-punkfling",
};
const gifSlugs = new Set(fs.readdirSync(new URL("../public/game-gifs", import.meta.url)).map((name) => name.replace(/\.gif$/i, "")));

const games = current.games.map((game, index) => {
  const [description, tags] = metadata[game.slug] || [`Play ${game.title}.`, ["weird"]];
  const sourceUrl = game.legacy?.gameUrl || game.gameUrl;
  const sourceImage = game.cover || game.image;
  const originUrl = new URL(sourceUrl);
  const entryPath = game.slug === "meelode" ? originUrl.pathname : undefined;
  originUrl.pathname = "/";
  originUrl.search = "";
  originUrl.hash = "";
  const mobileFirst = (game.legacy?.platform || game.platform) === "mobile";
  const leaderboard = game.slug === "punksinspace"
    ? { enabled: true, direction: "asc", variants: ["default"], scoreDisplay: "absolute" }
    : game.slug === "beepleblox"
      ? { enabled: true, direction: "asc", variants: ["default"], scoreDisplay: "absolute", apiAliases: ["beeple-blox"] }
      : game.slug === "punkfling"
        ? { enabled: true, direction: "desc", variants: ["default"], apiAliases: ["flingpunk"] }
        : game.slug === "sledding"
          ? { enabled: true, direction: "asc", variants: ["default"], scoreDisplay: "absolute", apiAliases: ["sledlaunch", "sledlaunch2"] }
          : game.slug === "meelode"
            ? { enabled: true, direction: "desc", variants: ["classic", "professional", "revenge", "fanbook", "championship", "generated"] }
            : game.slug === "penisvagina"
              ? { enabled: true, direction: "asc", variants: ["default"], scoreDisplay: "absolute" }
              : game.slug === "punkmatch"
                ? { enabled: true, direction: "asc", variants: ["4x4", "6x6", "8x8"] }
                : game.slug === "hell"
                  ? { enabled: true, direction: "asc", variants: ["default"], provider: "hell-worker", path: "/hell/leaderboard/" }
                  : { enabled: false, direction: "desc", variants: ["default"] };

  return {
    id: game.id,
    slug: game.slug,
    title: game.title,
    description,
    cover: sourceImage.startsWith("/covers/")
      ? sourceImage
      : `/covers/${sourceImage.split("/").pop().replace(/\.png$/i, ".webp")}`,
    ...(gifSlugs.has(game.slug) ? { hoverGif: `/game-gifs/${game.slug}.gif` } : {}),
    tags,
    ...(featured[game.slug] ? { featuredRank: featured[game.slug] } : {}),
    catalogOrder: index + 1,
    publishedAt: null,
    deviceSupport: {
      mobile: mobileFirst || Boolean(game.mobileMode) || (game.legacy ? game.legacy.controls === null : game.controls === null),
      tablet: true,
      desktop: true,
    },
    leaderboard,
    delivery: {
      mode: dedicatedWorkers[game.slug] ? "worker-route" : "legacy-proxy",
      origin: dedicatedWorkers[game.slug]
        ? `https://${dedicatedWorkers[game.slug]}.novox-robot.workers.dev`
        : originUrl.origin,
      ...(entryPath && entryPath !== "/" ? { entryPath } : {}),
      workerName: dedicatedWorkers[game.slug] || null,
      routePatterns: [`mann.cool/${game.slug}`, `mann.cool/${game.slug}/*`],
    },
    status: "published",
    legacy: {
      gameUrl: sourceUrl,
      platform: game.legacy?.platform || game.platform || null,
      aspectRatio: game.legacy?.aspectRatio || game.aspectRatio || null,
      controls: game.legacy ? game.legacy.controls : (game.controls ?? null),
      permissions: game.legacy?.permissions || game.permissions || [],
    },
  };
});

fs.writeFileSync(catalogPath, `${JSON.stringify({
  version: 1,
  tagVocabulary: ["political", "art", "relaxing", "multiplayer", "funny", "weird", "NSFW"],
  games,
}, null, 2)}\n`);
