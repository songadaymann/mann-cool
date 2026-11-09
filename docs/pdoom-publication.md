# p(DOOM) publication

Canonical URL: https://mann.cool/pdoom/
Source: https://github.com/songadaymann/pdoom
Delivery: dedicated `mann-cool-pdoom` Worker, existing shared platform APIs.

The cover follows the catalog cartridge format, inspired by the existing red bunker banner and title heroes. The five-second hover preview comes from the matching trailer's final 30 seconds. Desktop support is advertised; physical mobile compatibility is not claimed because the engine requires WebAssembly JSPI.

Open-source check: added missing MIT license and package metadata. The checker also flags historical `.env` in commit `123abcd`; inspected safely: it contains only `VITE_WALLET_CONNECT_PROJECT_ID`, a public client identifier, not a credential. No secret requires rotation and history is preserved.

## Score review

p(DOOM) has one leaderboard, `campaign-speedrun-v1`: the whole game as a speedrun, lowest time wins, timed from the first level to the MCP going down (since 2026-11-07; it replaced the four per-level rescue-score boards, whose rows stay in D1). Runs faster than the floor (`REVIEW_BELOW_MS` in `worker/pdoom-scores.js`, 20 minutes for now) or with more active time than real time since their ticket are stored as `pending`, not ranked. The player sees that the run is held for review. Retries keep that status. The floor is an estimate: tighten it once real runs exist.

**Top ten and videos (2026-11-09).** Jonathan is running a challenge judged on screen recordings.
- **Top-ten hold:** every time that would make the top ten of the approved board is also held (`top-ten` in its `review`), so whatever reaches the top has been checked by a person. `PDOOM_REVIEW_TOP` in the Worker's vars changes the ten; `0` turns this hold off.
- **Video link:** a run can carry a link to its recording, `videoUrl`. It must be https and point at a known video site (YouTube, Twitch, Kick, Vimeo, Streamable, Loom, archive.org, TikTok, Instagram, Facebook, X, Bluesky, Google Drive or Dropbox; `VIDEO_HOSTS` in `worker/pdoom-scores.js`). It's given with the time, or added, changed or cleared later from the browser that played the run: `POST /api/v1/pdoom/runs/video` with the run's ticket and its private token. That route is rate-limited to 10 per 10 minutes. The link isn't part of the result's fingerprint, and changing it never changes the time or the review status.
- **Where it shows:** `list` shows each row's `video`. The shared shell shows a ▶ link next to the name of a run that has one.
- **Times over an hour:** the shell shows them as h:mm:ss.cc.

```sh
npm run leaderboard:moderate -- list                      # pending rows, newest first
npm run leaderboard:moderate -- list --status approved --slug pdoom --sort score-asc   # fastest first
npm run leaderboard:moderate -- approve <submissionId>
npm run leaderboard:moderate -- hide <submissionId>       # kept in D1, off the board
```

It uses production D1 unless `--local` is given.
