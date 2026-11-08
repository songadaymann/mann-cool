import { timingSafeEqual } from "node:crypto";
import { HttpError, hashIdentity } from "./lib/http.js";

// p(DOOM) has one leaderboard: a whole-game speedrun, lowest time wins. It replaced the
// four per-level rescue-score boards on 2026-11-07 (Jonathan: "One single leaderboard
// that measures how fast people can beat the game"). The clock runs from the first level
// to the MCP going down: the four levels, safe mode and the endgame, played in one run.
// The descriptor locks the campaign and its rules. A map/rules change needs a new board key.
const CAMPAIGN = Object.freeze({
  levelId: "campaign", levelVersion: "campaign-v1", scoreVersion: "speedrun-v1", boardVersion: "v1",
});
const VARIANT = "campaign-speedrun-v1";
// Every split must be present, in milliseconds of active play. Each level and the endgame
// must take some time; safe mode may record 0.
const SPLIT_MINIMUM_MS = Object.freeze({
  "five-prisons": 1, "hal-station": 1, "meg3n-factory": 1, "agentic-pods": 1, "safe-mode": 0, endgame: 1,
});
const SPLITS = Object.freeze(Object.keys(SPLIT_MINIMUM_MS));
const SPLIT_MAXIMUM_MS = 86_400_000;
const RESCUE_TOTAL = 20;
const RUN_ID = /^[a-zA-Z0-9._-]{8,64}$/;
const NONCE = /^[a-f0-9]{64}$/;
const TICKET_ID = /^[a-f0-9-]{36}$/;
const TICKET_LIFETIME = 90 * 24 * 60 * 60 * 1000;
// Faster claims are stored but held for review, never rejected. This floor is a
// conservative estimate, not a measured record; tighten it as real runs arrive.
const REVIEW_BELOW_MS = 1_200_000;
const CLOCK_SLACK_MS = 10_000;
const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;

function requireCampaign(value) {
  if (!value || Object.keys(CAMPAIGN).some(key => value[key] !== CAMPAIGN[key])) {
    throw new HttpError(400, "This leaderboard needs the current campaign and scoring version.");
  }
}

function equalHash(a, b) {
  const encoder = new TextEncoder();
  return a.length === b.length && timingSafeEqual(encoder.encode(a), encoder.encode(b));
}

// The game requests a ticket when a ranked run begins; its issue time bounds the run's real time.
export async function issuePdoomTicket(env, body, now = Date.now()) {
  requireCampaign(body);
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
// The score is the run's active time in milliseconds; the board ranks it ascending.
export function calculatePdoomScore(variant, input) {
  requireCampaign(input);
  if (variant !== VARIANT) throw new HttpError(400, "The board does not belong to this run.");
  if (input.outcome !== "complete" || input.practice !== false) {
    throw new HttpError(400, "Only a completed run on the standard rules qualifies.");
  }
  if (input.saved !== RESCUE_TOTAL || input.total !== RESCUE_TOTAL) {
    throw new HttpError(400, "A ranked speedrun must rescue everyone.");
  }
  const splits = input.splits;
  if (!splits || typeof splits !== "object" || Array.isArray(splits)
    || Object.keys(splits).length !== SPLITS.length
    || SPLITS.some(key => !Object.hasOwn(splits, key)
      || !integer(splits[key], SPLIT_MINIMUM_MS[key], SPLIT_MAXIMUM_MS))) {
    throw new HttpError(400, "The split times are missing or inconsistent.");
  }
  const activeMs = SPLITS.reduce((sum, key) => sum + splits[key], 0);
  if (!integer(input.activeMs, 1, Number.MAX_SAFE_INTEGER) || input.activeMs !== activeMs) {
    throw new HttpError(400, "Active time does not match the split times.");
  }
  if (!integer(input.restarts, 0, 100_000)) throw new HttpError(400, "Invalid restart count.");
  if (input.ceo !== undefined && !["altman", "amodei"].includes(input.ceo)) {
    throw new HttpError(400, "Unknown hero.");
  }
  const metadata = {
    ...CAMPAIGN, outcome: "complete", practice: false, saved: RESCUE_TOTAL, total: RESCUE_TOTAL,
    activeMs, splits: Object.fromEntries(SPLITS.map(key => [key, splits[key]])), restarts: input.restarts,
    ...(input.ceo === undefined ? {} : { ceo: input.ceo }),
    validation: "server-rules-v2",
  };
  return { score: activeMs, metadata };
}

// Pausing only adds real time, so active time beyond the ticket's age means the
// run was not played in real time (or its ticket arrived late, e.g. offline at start).
export function pdoomReviewReasons(metadata, issuedAt, now = Date.now()) {
  const reasons = [];
  if (metadata.activeMs < REVIEW_BELOW_MS) reasons.push("below-time-floor");
  if (now - issuedAt + CLOCK_SLACK_MS < metadata.activeMs) reasons.push("faster-than-real-time");
  return reasons;
}

export async function validatePdoomSubmission(env, { body, variant, submissionId, name, playerId, metadata }, now = Date.now()) {
  const ticket = body.runTicket;
  if (!ticket || typeof ticket.id !== "string" || !TICKET_ID.test(ticket.id)
    || typeof ticket.token !== "string" || !NONCE.test(ticket.token)) {
    throw new HttpError(401, "Leaderboard validation was updated. Reload before starting a new ranked run.");
  }
  const row = await env.DB.prepare(`
    SELECT id, run_id, nonce_hash, level_id, level_version, issued_at, expires_at, completed_at
    FROM pdoom_ranked_runs WHERE id = ?
  `).bind(ticket.id).first();
  const nonceHash = await hashIdentity(ticket.token, "pdoom-run-v1");
  if (!row || !equalHash(row.nonce_hash, nonceHash)) throw new HttpError(401, "The run ticket could not be verified.");
  if (!row.completed_at && now > row.expires_at) throw new HttpError(410, "This unused run ticket has expired.");
  // Older per-level tickets carry a level ID, so they cannot complete a campaign run.
  if (submissionId !== `${row.run_id}:${variant}` || metadata.levelId !== row.level_id
    || metadata.levelVersion !== row.level_version) {
    throw new HttpError(400, "The ticket, campaign and submission ID must describe the same run.");
  }
  const result = calculatePdoomScore(variant, metadata);
  const completionHash = await hashIdentity(JSON.stringify({ name, playerId, metadata: result.metadata }), "pdoom-result-v1");
  // A single atomic comparison binds the board entry to the same completed run.
  // A failed insert/network response can safely retry the identical completion.
  const bound = await env.DB.prepare(`
    UPDATE pdoom_ranked_runs
    SET completion_hash = COALESCE(completion_hash, ?), completed_at = COALESCE(completed_at, ?)
    WHERE id = ? AND nonce_hash = ? AND (completion_hash IS NULL OR completion_hash = ?)
    RETURNING completion_hash
  `).bind(completionHash, now, row.id, nonceHash, completionHash).first();
  if (!bound) throw new HttpError(409, "This run ticket is already bound to a different result. Retry the original result.");
  // Not part of the completion hash: a retry keeps the first stored moderation status.
  return { ...result, review: pdoomReviewReasons(result.metadata, row.issued_at, now) };
}
