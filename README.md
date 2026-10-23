# mann.cool

[mann.cool](https://mann.cool) is the Game A Day catalog and shared game platform. Code is MIT licensed; see LICENSE and ASSETS.md for media terms.

## Develop

```sh
npm install
npm run dev
```

## Build

```sh
npm run build
npm run preview
```


## Catalog fields

`games.json` is the catalog. Run `npm run catalog:validate` after editing it.

- `status: "lab"` puts a game on [mann.cool/lab](https://mann.cool/lab) instead of the homepage grid. Lab games are unfinished or one-off experiments. A lab game can link to its own host with `url` instead of a Worker route, and `mann.cool/<slug>` redirects there. `crypto: true` shows a lab game only to visitors whose browser has a wallet; set it on any lab game whose page shows tokens, points, payouts, mints or wallet prompts. Crypto games sort after the others so nothing moves when they appear. The homepage's lab teaser and the footer's lab link show only when this visitor can see at least one lab game; anyone who goes to /lab with nothing to see gets "Nothing here yet." `?crypto=1`, `?crypto=0` and `?crypto=auto` test both states.
- `songs: [number]` lists the Song A Day songs a game came from. Each number needs a YouTube video ID in the top-level `songVideos` map. Cards and the in-game menu link to the video as "Hear the song: Song A Day #N".
- `sourceUrl` is the game's public GitHub repo, or `null` when the source is private or unknown, when the repo holds only a build, or when it carries other people's NFT art or media. Cards and the in-game menu show it as "Source". `scripts/validate-catalog.mjs` lists the public repos that stay unlinked, and why.

Run `npm run test:lab` to check lab redirects, the in-game menu links, lab play registration and which lab games each visitor sees.

## The Song A Day bar

The homepage and /lab start with the Song A Day universe bar from songaday.studio (`https://songaday.studio/bar/v1/bar.js`, with `data-here="play"`), above mann.cool's own header. `UniverseBar` in `src/SiteChrome.jsx` renders the `<songaday-bar>` placeholder, which `src/styles.css` holds at 36px, and adds the script once the placeholder is on the page. Game pages don't get the bar.

## Tip Jar

The Tip Jar is Song A Day's Zeffy donation form (fiscally sponsored, so gifts are tax-deductible). `TIP_URL` in `wrangler.jsonc` is the one place it's set. `/platform/config.json` hands it out tagged `utm_source=mann.cool`, plus `utm_campaign=<slug>` when a game's shell asks with `?slug=`. The site header and footer, the lab, Bot Blast and the in-game menu each link straight to it in a new tab, so games that load the shared shell get it with no changes of their own. Until the config answers, those links go through `mann.cool/tip`, which still redirects older links to the same form and counts the click. Run `npm run test:tip-jar` to check it.

## Independently hosted games

The play API also accepts WAMP (`slug: "wamp"`) at `/api/v1/plays` and the legacy `/api/plays` route. Its play-only registration lives in `worker/lib/externalPlayGames.js`; WAMP continues to run at https://wamp.land and does not become a catalog route. This registration does not enable comments, tips or leaderboards. Run `npm run test:external-plays` to verify counts, CORS and this boundary.
