import { timingSafeEqual } from "node:crypto";
import { HttpError, cleanSlug, json, options as corsOptions, readJson } from "./lib/http.js";
import { enforceRateLimit } from "./platform-api.js";
import { ADMIN_RUNS_PAGE } from "./admin-runs-page.js";

// The private review page for submitted leaderboard runs (2026-11-13, Jonathan: "give me the place where i can
// see people's submitted runs"): https://mann.cool/admin/runs. It does in a browser what
// scripts/moderate-leaderboard.mjs does in a terminal: every run with why it's held, its video, who signed in and
// from where, and Approve / Hide. The page itself holds nothing; its data needs the ADMIN_TOKEN secret
// (`wrangler secret put ADMIN_TOKEN`), sent as a Bearer token. Cross-site pages can't send that header (CORS
// allows only Content-Type and Idempotency-Key), and wrong tokens are rate-limited.

const STATUSES = ["pending", "approved", "hidden", "rejected"];
const SUBMISSION_ID = /^[a-zA-Z0-9._:-]{8,100}$/;

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

async function requireAdmin(request, env) {
  const expected = env.ADMIN_TOKEN || "";
  if (expected.length < 24) throw new HttpError(503, "The review page isn't set up yet: set the ADMIN_TOKEN secret.");
  const given = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  // compare digests, so the lengths always match
  if (!given || !timingSafeEqual(await sha256(given), await sha256(expected))) {
    await enforceRateLimit(request, env, "admin:fail");
    throw new HttpError(401, "That token isn't right.");
  }
}

// What a run carries that's worth reviewing (its metadata is free-form for other games).
function runDetails(text) {
  let metadata = {};
  try { metadata = JSON.parse(text || "{}") || {}; } catch {}
  const pick = {};
  for (const key of ["activeMs", "splits", "restarts", "ceo", "review", "videoUrl", "validation", "levelId", "scoreVersion"]) {
    if (metadata[key] !== undefined) pick[key] = metadata[key];
  }
  return pick;
}

async function listRuns(request, env) {
  const url = new URL(request.url);
  const slug = cleanSlug(url.searchParams.get("slug") || "pdoom");
  if (!slug) throw new HttpError(400, "A valid slug is required");
  const status = url.searchParams.get("status") || "pending";
  if (status !== "all" && !STATUSES.includes(status)) throw new HttpError(400, "Unknown status");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 200, 1), 500);
  const rows = await env.DB.prepare(`
    SELECT e.submission_id AS submissionId, e.variant, e.player_name AS name, e.player_id AS playerId, e.score,
      e.moderation_status AS status, e.created_at AS createdAt, e.metadata,
      (SELECT email_hint FROM player_profiles p WHERE p.player_id = e.player_id) AS signedIn,
      (SELECT address FROM player_wallets w WHERE w.player_id = e.player_id ORDER BY w.created_at LIMIT 1) AS wallet,
      (SELECT COUNT(DISTINCT COALESCE(NULLIF(o.player_id, ''), o.submission_id)) FROM leaderboard_entries o
        WHERE o.slug = e.slug AND o.ip_hash = e.ip_hash AND o.submission_id != e.submission_id
          AND COALESCE(o.player_id, '') != COALESCE(e.player_id, '')) AS sameIpPlayers
    FROM leaderboard_entries e
    WHERE e.slug = ? ${status === "all" ? "" : "AND e.moderation_status = ?"}
    ORDER BY e.created_at DESC LIMIT ?
  `).bind(...(status === "all" ? [slug, limit] : [slug, status, limit])).all();
  const counts = await env.DB.prepare(`
    SELECT moderation_status AS status, COUNT(*) AS n FROM leaderboard_entries WHERE slug = ? GROUP BY moderation_status
  `).bind(slug).all();
  return json({
    success: true, slug, status,
    counts: Object.fromEntries(counts.results.map((row) => [row.status, Number(row.n)])),
    runs: rows.results.map(({ metadata, sameIpPlayers, ...row }) => ({
      ...row, score: Number(row.score), sameIpPlayers: Number(sameIpPlayers || 0), ...runDetails(metadata),
    })),
  });
}

async function moderateRuns(request, env) {
  const body = await readJson(request, 8_192);
  const slug = cleanSlug(body.slug || "pdoom");
  if (!slug) throw new HttpError(400, "A valid slug is required");
  const status = { approve: "approved", hide: "hidden", pending: "pending" }[body.action];
  if (!status) throw new HttpError(400, "action must be approve, hide or pending");
  const ids = Array.isArray(body.submissionIds) ? [...new Set(body.submissionIds.map(String))] : [];
  if (!ids.length || ids.length > 50 || ids.some((id) => !SUBMISSION_ID.test(id))) throw new HttpError(400, "Give 1 to 50 submission IDs");
  const result = await env.DB.prepare(`
    UPDATE leaderboard_entries SET moderation_status = ?
    WHERE slug = ? AND submission_id IN (${ids.map(() => "?").join(", ")})
    RETURNING submission_id AS submissionId
  `).bind(status, slug, ...ids).all();
  const changed = result.results.map((row) => row.submissionId);
  return json({ success: true, status, changed, missing: ids.filter((id) => !changed.includes(id)) });
}

export async function handleAdminApi(request, env, route) {
  if (request.method === "OPTIONS") return corsOptions();
  try {
    await enforceRateLimit(request, env, "admin:api");
    await requireAdmin(request, env);
    if (route === "runs" && request.method === "GET") return await listRuns(request, env);
    if (route === "runs/moderate" && request.method === "POST") return await moderateRuns(request, env);
    return json({ error: "API route not found" }, { status: 404 });
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, { status: error.status });
    console.error(JSON.stringify({ message: "admin API request failed", route, error: error instanceof Error ? error.message : String(error) }));
    return json({ error: "Internal server error" }, { status: 500 });
  }
}

// The page: static, its script allowed by a per-response nonce, never framed, cached or indexed.
export function adminRunsPage() {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))));
  return new Response(ADMIN_RUNS_PAGE.replaceAll("__NONCE__", nonce), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    },
  });
}
