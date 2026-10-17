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


## Independently hosted games

The play API also accepts WAMP (`slug: "wamp"`) at `/api/v1/plays` and the legacy `/api/plays` route. Its play-only registration lives in `worker/lib/externalPlayGames.js`; WAMP continues to run at https://wamp.land and does not become a catalog route. This registration does not enable comments, tips or leaderboards. Run `npm run test:external-plays` to verify counts, CORS and this boundary.
