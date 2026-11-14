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

**One row per player, and signing in for the challenge (2026-11-09).** Jonathan: "if they want to have their run count for the contest, they have to sign in, but if they just want to put their run there, they don't have to".
- **Who the player is:** for p(DOOM) the server works it out from the browser's player secret (`playerSecret`, from the shell's `mannCool.player.credential()`; `player-identity.js playerForSecret`). It never trusts a claimed ID, so nobody can post as someone else. The secret is never stored. A run without one is anonymous: no player, its own row.
- **The board (`aggregation: "player-best"`):** one row per player, their best approved time. A row is `signedIn` when its player has saved their scores to an email (`player_profiles`). The check is made when the board is read, so signing in later counts the runs that browser already posted. The shell marks signed-in rows ✓, with a key under the list.
- **The top-ten hold counts players,** not runs.
- **The moderation list** shows `player_id`, `signed_in` (the email hint) and `same_ip_players`: how many other players posted from the same IP (its hash). That's a reason to look twice, not proof: households, schools and phone networks share IPs.
- **Wallet sign-in (2026-11-09):** a second way to sign in, in the same "Save your scores" panel, using Sign-In with Ethereum (EIP-4361).
  - **Finding wallets:** the shell lists the wallets this browser announces (EIP-6963), else `window.ethereum`. On a phone that usually means a wallet's own browser.
  - **The message:** `POST /api/v1/player/wallet/start` writes the whole message (domain, checksummed address, statement, nonce, ten-minute expiry) for this browser's secret. The wallet signs it with `personal_sign`, which is free and sends no transaction.
  - **The check:** `POST /api/v1/player/wallet/verify` accepts it only from the browser that asked, once, in time, word for word. It recovers the signer with viem. A smart-contract wallet (Coinbase Smart Wallet, Safe) is checked over an RPC (ERC-1271/6492): public defaults for Ethereum, Base, Optimism, Arbitrum and Polygon, which `PLAYER_WALLET_RPCS` (JSON) replaces. That path wasn't tested with a real smart wallet.
  - **Pages:** only https://mann.cool and www.mann.cool can start one. Local dev (`PLAYER_EMAIL_DEV=1`) also takes http loopback, and http://mann.cool, because wrangler dev rewrites the Origin's host.
  - **Tables:** migration `0012_player_wallets.sql` adds `player_wallets` and `player_wallet_challenges`. A wallet-only player still has a `player_profiles` row (`email_hash` `wallet:<address>`, `email_hint` the short address), so sign-in checks, the board's ✓ and other browsers work unchanged. Adding an email later takes over that row, and a player can have both.
  - **Moderation:** the list shows `wallet`.
  - **Solana (2026-11-09, Jonathan: "we need solana wallets"):** the same flow through `POST /api/v1/player/solana/start` and `/verify`.
    - **Finding wallets:** the shell finds Solana wallets through the Wallet Standard (Phantom, Solflare, Backpack and others), else `window.phantom.solana`, `window.solflare` or `window.solana`. Buttons name the network: "Sign in with Phantom (Solana)", "Sign in with MetaMask (Ethereum)".
    - **The message:** follows Sign In With Solana ("mann.cool wants you to sign in with your Solana account:", Chain ID `mainnet`). The wallet signs its bytes (`solana:signMessage`), which is free and sends no transaction.
    - **The check:** the Worker verifies the Ed25519 signature against the address (a base58 32-byte public key) with Web Crypto, so no new dependency.
    - **Storage:** the wallet is stored as `sol:<address>`, case and all. One player can hold Solana and Ethereum wallets and an email.
  - **Not supported:** WalletConnect (it needs a project ID).

```sh
npm run leaderboard:moderate -- list                      # pending rows, newest first
npm run leaderboard:moderate -- list --status approved --slug pdoom --sort score-asc   # fastest first
npm run leaderboard:moderate -- approve <submissionId>
npm run leaderboard:moderate -- hide <submissionId>       # kept in D1, off the board
```

It uses production D1 unless `--local` is given.

**The review page (2026-11-13): https://mann.cool/admin/runs.** Jonathan: "give me the place where i can see people's submitted runs". It does in a browser what `leaderboard:moderate` does in a terminal.
- **What it shows:** every run, newest first, under the tabs Waiting, Approved, Hidden and All, with counts. Each run has its time, name, when it was sent, why it's held, the video link, sign-in (email hint or short wallet), a same-IP warning, and its splits, restarts, hero, wallet, player and submission ID.
- **Actions:** Approve, Hide and Back to waiting.
- **The game box:** switches to another game's slug.
- **Access:** the page holds nothing. Its data comes from `GET /api/v1/admin/runs` and `POST /api/v1/admin/runs/moderate`, which need the `ADMIN_TOKEN` Worker secret as a Bearer token. The page asks for it once and keeps it in that browser until Sign out.
- **Protection:**
  - Without the secret the API answers 503.
  - Wrong tokens are rate-limited: 10 per 10 minutes per IP.
  - Other sites can't send the header, because CORS doesn't allow Authorization.
  - The page has a per-response CSP nonce, `X-Frame-Options: DENY` and `noindex`, and every value is set as text.
- **Setting or changing the token:** run this once in this repo. It prints the token for you to paste into the page:
  `T=$(openssl rand -hex 24) && echo "$T" && printf '%s' "$T" | CLOUDFLARE_ACCOUNT_ID=a79a1faef6e8f94566f3320429d54006 npx wrangler secret put ADMIN_TOKEN`
