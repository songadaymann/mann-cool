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

- `status: "lab"` puts a game on [mann.cool/lab](https://mann.cool/lab) instead of the homepage grid. Lab games are unfinished or one-off experiments. A lab game can link to its own host with `url` instead of a Worker route, and `mann.cool/<slug>` redirects there. `crypto: true` shows a lab game only to visitors whose browser has a wallet; `?crypto=1`, `?crypto=0` and `?crypto=auto` test both states.
- `songs: [number]` lists the Song A Day songs a game came from. Each number needs a YouTube video ID in the top-level `songVideos` map. Cards and the in-game menu link to the video as "Hear the song: Song A Day #N".
- `sourceUrl` is the game's public GitHub repo, or `null` when the source is private or unknown. Cards and the in-game menu show it as "Source".

Run `npm run test:lab` to check lab redirects, the in-game menu links and lab play registration.

## Independently hosted games

The play API also accepts WAMP (`slug: "wamp"`) at `/api/v1/plays` and the legacy `/api/plays` route. Its play-only registration lives in `worker/lib/externalPlayGames.js`; WAMP continues to run at https://wamp.land and does not become a catalog route. This registration does not enable comments, tips or leaderboards. Run `npm run test:external-plays` to verify counts, CORS and this boundary.
