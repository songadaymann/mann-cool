// GameResults: the trusted way for a game's own Worker to report multiplayer outcomes (2026-11-18, Metal Gear Huang).
// It is a named entrypoint, so only Workers on this Cloudflare account that declare a service binding to it can call
// it; there is no public URL and no shared secret. A game Worker binds it with
//   "services": [{ "binding": "MANN_COOL", "service": "mann-cool", "entrypoint": "GameResults" }]
// Browsers cannot reach it, and boards marked "submitter": "server" in games.json refuse browser POSTs.
import { WorkerEntrypoint } from "cloudflare:workers";
import { recordServerOutcome } from "./platform-api.js";
import { playerForSecret } from "./player-identity.js";

export class GameResults extends WorkerEntrypoint {
  // The mann.cool player a browser's secret proves (the email's player ID when that browser is saved to one). The
  // game's server asks once when a player joins and keeps only the public ID. null for a malformed secret.
  async player(secret) {
    try {
      const { playerId, signedIn } = await playerForSecret(this.env, secret);
      return { playerId, signedIn };
    } catch {
      return null;
    }
  }

  // One player's outcome of one finished match: { slug, variant, name, playerId, result, submissionId, metadata }.
  // Returns { ok: true, duplicate } or { ok: false, error }; never throws over RPC.
  async submitOutcome(input) {
    try {
      return await recordServerOutcome(this.env, input);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
