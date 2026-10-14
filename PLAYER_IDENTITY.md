# Player identity and wallet detection

Two shell features (`public/platform/v1/game-shell.js`, worker in `worker/player-identity.js`,
schema in `migrations/0009_player_identity_wallets.sql`).

## Player identity: "Save your scores"

No accounts. Each browser keeps a private random secret (`localStorage["mann.cool.player.v1"]`,
same for every game on mann.cool). Its public player ID (`mc_…`) is derived from that secret,
so it can appear on leaderboards while only that browser can prove it.

A player can save their scores to an email: they enter it, get a 6-digit code (Resend), and
type it in. Doing the same on another browser, or after clearing site data, gives that browser
the email's player ID; any scores it had already posted under its own ID move over. Emails are
never stored readable: only a keyed hash for lookups and a masked hint (`j•••@gmail.com`).
A browser saved to one email can't be moved to another.

Limits: codes expire after 10 minutes, five wrong tries kill a code, a code only works in the
browser that asked for it, 3 codes per email per hour, 5 sends per IP per 10 minutes.

### For games

```html
<script src="https://mann.cool/platform/v1/game-shell.js" data-slug="my-game"
  data-leaderboard="true" data-player-identity="true" defer></script>
```

`data-player-identity="true"` adds **Save your scores** to the shell menu. Every game gets:

```js
const playerId = await window.mannCool.player.getId();   // send as playerId with scores
await window.mannCool.player.get();   // { playerId, linked, emailHint }
window.mannCool.player.openSave();     // open the panel (if the game opted in)
window.addEventListener("mann-cool:player", (e) => e.detail);   // after saving/recovery the ID can change
```

Read the ID when you submit a score rather than caching it at load. `window.mannCool` exists
once the shell has run (`mann-cool:ready` fires then). The panel stops key events so typing an
email does not reach the game, unless the game listens in the capture phase.

### API (`POST`, JSON)

| Route | Body | Returns |
| --- | --- | --- |
| `/api/v1/player/email/start` | `{ secret, email }` | `{ emailHint }` |
| `/api/v1/player/email/verify` | `{ secret, email, code }` | `{ playerId, emailHint, linked, merged }` |
| `/api/v1/player/session` | `{ secret }` | `{ playerId, linked, emailHint }` |

Leaderboard posts are unchanged and still trust the `playerId` they're given.

## Wallet detection

On every game page the shell checks, about 1.5 s after load, whether a crypto wallet extension
is installed: Ethereum-style wallets announcing themselves (EIP-6963, or the older
`window.ethereum`) and Solana and other Wallet Standard wallets (or `window.phantom.solana`
and friends). It never asks to connect and never reads an address.

```js
const w = await window.mannCool.wallets.detect();   // { hasWallet, evm, solana, names: ["MetaMask", ...] }
window.addEventListener("mann-cool:wallets", (e) => e.detail);
```

Each browser reports once per game per day, anonymously (counts and wallet names only).
Note that Brave's built-in wallet counts as a wallet.

```
GET /api/v1/wallets?days=30            all games
GET /api/v1/wallets?slug=my-game&days=7
→ { reports, withWallet, withEvm, withSolana, share, wallets: [{ name, reports }] }
```

## Setup before deploying

1. In Resend, verify the sending domain (e.g. `mann.cool`).
2. `npx wrangler secret put RESEND_API_KEY` and `npx wrangler secret put PLAYER_EMAIL_SALT`
   (any long random string; changing it later orphans every saved email).
3. Add `PLAYER_EMAIL_FROM` to `vars` in `wrangler.jsonc`, e.g. `"mann.cool <play@mann.cool>"`
   (no mailbox needed), and optionally `PLAYER_EMAIL_REPLY_TO` for replies.
4. `npm run db:migrate:remote` (adds tables only).
5. Deploy the worker. The shell version bump redirects every game to the new shell.

Without the secrets, saving scores answers 503 and the rest of the shell works as before.

## Local testing

`.dev.vars` with `PLAYER_EMAIL_DEV=1` (and no `RESEND_API_KEY`) returns codes in the response
instead of emailing them. Then:

```sh
npm run build && npm run db:migrate:local
npx wrangler dev --port 8788
node scripts/verify-player-identity.mjs --base http://127.0.0.1:8788   # writes test data: local only
node scripts/verify-platform.mjs --base http://127.0.0.1:8788
```
