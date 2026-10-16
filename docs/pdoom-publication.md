# p(DOOM) publication

Canonical URL: https://mann.cool/pdoom/
Source: https://github.com/songadaymann/pdoom
Delivery: dedicated `mann-cool-pdoom` Worker, existing shared platform APIs.

The cover follows the catalog cartridge format, inspired by the existing red bunker banner and title heroes. The five-second hover preview comes from the matching trailer's final 30 seconds. Desktop support is advertised; physical mobile compatibility is not claimed because the engine requires WebAssembly JSPI.

Open-source check: added missing MIT license and package metadata. The checker also flags historical `.env` in commit `123abcd`; inspected safely: it contains only `VITE_WALLET_CONNECT_PROJECT_ID`, a public client identifier, not a credential. No secret requires rotation and history is preserved.

## Score review

Runs faster than a level's floor (`REVIEW_BELOW_MS` in `worker/pdoom-scores.js`, 90 s for now) or with more active time than real time since their ticket are stored as `pending`, not ranked. The player sees that the run is held for review. Retries keep that status. The floors are estimates: tighten them once real runs exist.

```sh
npm run leaderboard:moderate -- list                      # pending rows, newest first
npm run leaderboard:moderate -- list --status approved --slug pdoom --sort score
npm run leaderboard:moderate -- approve <submissionId>
npm run leaderboard:moderate -- hide <submissionId>       # kept in D1, off the board
```

It uses production D1 unless `--local` is given.
