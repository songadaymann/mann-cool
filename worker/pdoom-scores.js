import { timingSafeEqual } from "node:crypto";
import { HttpError, hashIdentity } from "./lib/http.js";

// These are the locked competitive maps. A map/rules change needs a new board key.
const LEVELS = Object.freeze({
  "five-prisons": "five-prisons-v3",
  "hal-station": "hal-station-v3",
});
const RUN_ID = /^[a-zA-Z0-9._-]{8,64}$/;
const NONCE = /^[a-f0-9]{64}$/;
const TICKET_ID = /^[a-f0-9-]{36}$/;
const TICKET_LIFETIME = 90 * 24 * 60 * 60 * 1000;
const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;

function requireLevel(value) {
  if (!value || typeof value.levelId !== "string" || !Object.hasOwn(LEVELS, value.levelId)
    || value.levelVersion !== LEVELS[value.levelId]
    || value.scoreVersion !== "rescue-v2" || value.boardVersion !== "v3") {
    throw new HttpError(400, "This leaderboard needs the current level and scoring version.");
  }
}

function equalHash(a, b) {
  const encoder = new TextEncoder();
  return a.length === b.length && timingSafeEqual(encoder.encode(a), encoder.encode(b));
}

export async function issuePdoomTicket(env, body, now = Date.now()) {
  requireLevel(body);
  if (typeof body.runId !== "string" || !RUN_ID.test(body.runId)
    || typeof body.nonce !== "string" || !NONCE.test(body.nonce)) {
    throw new HttpError(400, "A valid run ID and private run nonce are required.");
  }
  const nonceHash = await hashIdentity(body.nonce, "pdoom-run-v1");
  await env.DB.prepare(`
    INSERT INTO pdoom_ranked_runs
      (id, run_id, nonce_hash, level_id, level_version, issued_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO NOTHING
  `).bind(crypto.randomUUID(), body.runId, nonceHash, body.levelId,
    body.levelVersion, now, now + TICKET_LIFETIME).run();
  const row = await env.DB.prepare(`
    SELECT id, nonce_hash, level_id, level_version, expires_at, completed_at
    FROM pdoom_ranked_runs WHERE run_id = ?
  `).bind(body.runId).first();
  if (!row || !equalHash(row.nonce_hash, nonceHash)
    || row.level_id !== body.levelId || row.level_version !== body.levelVersion) {
    throw new HttpError(409, "This run ID is already registered to another attempt.");
  }
  if (!row.completed_at && now > row.expires_at) {
    throw new HttpError(410, "This unused run ticket has expired.");
  }
  return { success: true, runId: body.runId, ticketId: row.id, expiresAt: row.expires_at };
}

// Plausibility checks, not proof of gameplay. All inputs from the browser remain
// untrusted; only replay/server simulation can establish that the run happened.
export function calculatePdoomScore(variant, input) {
  requireLevel(input);
  const variants = ["rescue", "perfect", "clean-sweep"].map(kind => `${input.levelId}-${kind}-v3`);
  const category = variants.indexOf(variant);
  if (category < 0) throw new HttpError(400, "The board does not belong to this run's level.");
  if (input.outcome !== "escaped" || input.practice !== false || input.skill !== 3
    || input.entry !== "cold" || input.retreat !== false) {
    throw new HttpError(400, "Only a completed fresh run on the standard rules qualifies.");
  }
  if (!integer(input.savedFigures, 0, 5) || !["conscious", "carried"].includes(input.ceoState)
    || input.total !== 6 || !integer(input.saved, 1, 6)
    || input.saved !== input.savedFigures + (input.ceoState === "conscious" ? 1 : 0)
    || input.camerasTotal !== 9 || !integer(input.camerasDestroyed, 0, 9)
    || !integer(input.activeTics, 1, 2_147_483_647)
    || !integer(input.pDoomAtCoverOpen, 1, 99) || input.pDoomFinal !== 0) {
    throw new HttpError(400, "The rescue counts, active time or escape result are inconsistent.");
  }
  const activeMs = Math.round(input.activeTics * 1000 / 35);
  if (input.activeMs !== activeMs) throw new HttpError(400, "Active time does not match the native game clock.");
  if (category > 0 && (input.savedFigures !== 5 || input.ceoState !== "conscious")
    || category === 2 && input.camerasDestroyed !== 9) {
    throw new HttpError(400, "This rescue does not qualify for that board.");
  }
  const routes = input.routes ?? [];
  if (!Array.isArray(routes) || routes.length > 5
    || routes.some(route => typeof route !== "string" || route.length > 64)) {
    throw new HttpError(400, "Invalid rescue route metadata.");
  }
  if (input.ceo !== undefined && !["altman", "amodei", "doomguy"].includes(input.ceo)) {
    throw new HttpError(400, "Unknown hero.");
  }
  const breakdown = {
    rescue: input.savedFigures * 10_000,
    ceo: input.ceoState === "conscious" ? 1000 : 0,
    cameras: input.camerasDestroyed * 250,
    speed: Math.round(2000 * 600 / (600 + input.activeTics / 35)),
    outlook: 10 * (100 - input.pDoomAtCoverOpen),
  };
  const metadata = {
    levelId: input.levelId, levelVersion: input.levelVersion,
    scoreVersion: "rescue-v2", boardVersion: "v3", outcome: "escaped", practice: false,
    savedFigures: input.savedFigures, ceoState: input.ceoState, skill: 3, entry: "cold", retreat: false,
    saved: input.saved, total: 6, camerasDestroyed: input.camerasDestroyed, camerasTotal: 9,
    activeMs, activeTics: input.activeTics, pDoomAtCoverOpen: input.pDoomAtCoverOpen,
    pDoomFinal: 0, breakdown, routes,
    ...(input.ceo === undefined ? {} : { ceo: input.ceo }),
    validation: "server-rules-v1",
  };
  return { score: category === 0 ? Object.values(breakdown).reduce((a, b) => a + b, 0) : activeMs, metadata };
}

export async function validatePdoomSubmission(env, { body, variant, submissionId, name, playerId, metadata }, now = Date.now()) {
  const ticket = body.runTicket;
  if (!ticket || typeof ticket.id !== "string" || !TICKET_ID.test(ticket.id)
    || typeof ticket.token !== "string" || !NONCE.test(ticket.token)) {
    throw new HttpError(401, "Leaderboard validation was updated. Reload before starting a new ranked run.");
  }
  const row = await env.DB.prepare(`
    SELECT id, run_id, nonce_hash, level_id, level_version, expires_at, completed_at
    FROM pdoom_ranked_runs WHERE id = ?
  `).bind(ticket.id).first();
  const nonceHash = await hashIdentity(ticket.token, "pdoom-run-v1");
  if (!row || !equalHash(row.nonce_hash, nonceHash)) throw new HttpError(401, "The run ticket could not be verified.");
  if (!row.completed_at && now > row.expires_at) throw new HttpError(410, "This unused run ticket has expired.");
  if (submissionId !== `${row.run_id}:${variant}` || metadata.levelId !== row.level_id
    || metadata.levelVersion !== row.level_version) {
    throw new HttpError(400, "The ticket, level and submission ID must describe the same run.");
  }
  const result = calculatePdoomScore(variant, metadata);
  const completionHash = await hashIdentity(JSON.stringify({ name, playerId, metadata: result.metadata }), "pdoom-result-v1");
  // A single atomic comparison binds every board to the same completed run.
  // A failed insert/network response can safely retry the identical completion.
  const bound = await env.DB.prepare(`
    UPDATE pdoom_ranked_runs
    SET completion_hash = COALESCE(completion_hash, ?), completed_at = COALESCE(completed_at, ?)
    WHERE id = ? AND nonce_hash = ? AND (completion_hash IS NULL OR completion_hash = ?)
    RETURNING completion_hash
  `).bind(completionHash, now, row.id, nonceHash, completionHash).first();
  if (!bound) throw new HttpError(409, "This run ticket is already bound to a different result. Retry the original result.");
  return result;
}
