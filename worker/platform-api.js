import { getGame, getGameByApiSlug, getGameStatus, getLeaderboardConfig } from "./lib/catalog.js";
import {
  HttpError,
  cleanSlug,
  cleanSource,
  cleanText,
  hashIdentity,
  json,
  options,
  readJson,
} from "./lib/http.js";

const LIMITS = {
  "plays:post": { requests: 60, seconds: 60 },
  "guestbook:get": { requests: 120, seconds: 60 },
  "guestbook:post": { requests: 5, seconds: 600 },
  "leaderboard:get": { requests: 120, seconds: 60 },
  "leaderboard:post": { requests: 20, seconds: 60 },
};

function remoteIp(request) {
  return request.headers.get("cf-connecting-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "local";
}

async function enforceRateLimit(request, env, endpoint) {
  const rule = LIMITS[endpoint];
  if (!rule) return;

  const identity = await hashIdentity(remoteIp(request), env.RATE_LIMIT_SALT || "mann.cool-rate-limit-v1");
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / rule.seconds) * rule.seconds;
  const result = await env.DB.prepare(`
    INSERT INTO rate_limits (endpoint, identity_hash, window_start, request_count)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(endpoint, identity_hash, window_start)
    DO UPDATE SET request_count = request_count + 1
    RETURNING request_count
  `).bind(endpoint, identity, windowStart).first();

  if (Number(result?.request_count || 0) > rule.requests) {
    throw new HttpError(429, "Too many requests. Please try again later.");
  }
}

async function ensureRegisteredGame(env, slug) {
  const game = slug === "mann-cool"
    ? { slug: "mann-cool", title: "mann.cool", status: "hidden", leaderboard: { enabled: false, direction: "desc" } }
    : getGame(slug) || getGameByApiSlug(slug);
  if (!game) throw new HttpError(404, "Unknown game slug");

  const leaderboard = getLeaderboardConfig(game);
  await env.DB.prepare(`
    INSERT INTO games (slug, title, status, leaderboard_enabled, leaderboard_direction, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(slug) DO UPDATE SET
      title = excluded.title,
      status = excluded.status,
      leaderboard_enabled = excluded.leaderboard_enabled,
      leaderboard_direction = excluded.leaderboard_direction,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    game.slug,
    game.title,
    getGameStatus(game),
    leaderboard.enabled ? 1 : 0,
    leaderboard.direction,
  ).run();

  return game;
}

async function verifyTurnstile(request, env, token) {
  if (!env.TURNSTILE_SECRET_KEY) {
    throw new HttpError(503, "Guestbook signing is temporarily unavailable");
  }
  if (!token || String(token).length > 2_048) {
    throw new HttpError(400, "Human verification is required");
  }

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      secret: env.TURNSTILE_SECRET_KEY,
      response: String(token),
      remoteip: remoteIp(request),
      idempotency_key: crypto.randomUUID(),
    }),
  });
  const result = await response.json();
  if (!response.ok || result.success !== true) {
    throw new HttpError(400, "Human verification failed");
  }
}

async function handlePlays(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET") {
    const requestedSlug = cleanSlug(url.searchParams.get("slug"));
    if (url.searchParams.has("slug") && !requestedSlug) throw new HttpError(400, "Invalid slug");

    if (requestedSlug) {
      await ensureRegisteredGame(env, requestedSlug);
      const row = await env.DB.prepare(
        "SELECT COALESCE(SUM(play_count), 0) AS count FROM play_totals WHERE slug = ?",
      ).bind(requestedSlug).first();
      return json({ slug: requestedSlug, count: Number(row?.count || 0) });
    }

    const result = await env.DB.prepare(`
      SELECT slug, COALESCE(SUM(play_count), 0) AS count
      FROM play_totals GROUP BY slug ORDER BY slug
    `).all();
    const counts = Object.fromEntries(result.results.map((row) => [row.slug, Number(row.count)]));
    return json({ counts });
  }

  if (request.method === "POST") {
    await enforceRateLimit(request, env, "plays:post");
    const body = await readJson(request, 2_048);
    const slug = cleanSlug(body.slug);
    if (!slug) throw new HttpError(400, "A valid slug is required");
    await ensureRegisteredGame(env, slug);
    const source = cleanSource(body.source);
    const row = await env.DB.prepare(`
      INSERT INTO play_totals (slug, source, play_count, updated_at)
      VALUES (?, ?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(slug, source) DO UPDATE SET
        play_count = play_count + 1,
        updated_at = CURRENT_TIMESTAMP
      RETURNING play_count
    `).bind(slug, source).first();
    return json({ success: true, slug, source, count: Number(row?.play_count || 1) });
  }

  throw new HttpError(405, "Method not allowed");
}

async function handleGuestbook(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET") {
    await enforceRateLimit(request, env, "guestbook:get");
    const slug = cleanSlug(url.searchParams.get("slug") || url.searchParams.get("game") || "mann-cool");
    if (!slug) throw new HttpError(400, "A valid slug is required");
    await ensureRegisteredGame(env, slug);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 100);
    const result = await env.DB.prepare(`
      SELECT id, slug, name, message, created_at AS timestamp
      FROM guestbook_entries
      WHERE slug = ? AND moderation_status = 'approved'
      ORDER BY created_at DESC LIMIT ?
    `).bind(slug, limit).all();
    return json({ success: true, slug, entries: result.results });
  }

  if (request.method === "POST") {
    await enforceRateLimit(request, env, "guestbook:post");
    const body = await readJson(request, 4_096);
    const slug = cleanSlug(body.slug || body.game || "mann-cool");
    if (!slug) throw new HttpError(400, "A valid slug is required");
    await ensureRegisteredGame(env, slug);
    const name = cleanText(body.name, 50);
    const message = cleanText(body.message, 500);
    if (!name || !message) throw new HttpError(400, "Name and message are required");
    await verifyTurnstile(request, env, body.turnstileToken || body.turnstile_token);
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const ipHash = await hashIdentity(remoteIp(request), env.RATE_LIMIT_SALT || "mann.cool-guestbook-v1");
    await env.DB.prepare(`
      INSERT INTO guestbook_entries
        (id, slug, name, message, moderation_status, created_at, ip_hash)
      VALUES (?, ?, ?, ?, 'approved', ?, ?)
    `).bind(id, slug, name, message, timestamp, ipHash).run();
    const entry = { id, slug, name, message, timestamp };
    return json({ success: true, entry }, { status: 201 });
  }

  throw new HttpError(405, "Method not allowed");
}

function parseMetadata(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "metadata must be an object");
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).byteLength > 2_048) throw new HttpError(400, "metadata is too large");
  return value;
}

const LEADERBOARD_RESERVED_FIELDS = new Set([
  "slug", "game", "variant", "name", "playerName", "score", "metadata",
  "playerId", "address", "submissionId",
]);

function leaderboardMetadata(body) {
  const metadata = { ...(body.metadata || {}) };
  for (const [key, value] of Object.entries(body)) {
    if (LEADERBOARD_RESERVED_FIELDS.has(key) || value === undefined) continue;
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key)) continue;
    if (["string", "number", "boolean"].includes(typeof value) || value === null) metadata[key] = value;
  }
  return parseMetadata(metadata);
}

function leaderboardEntry(row, config, rank) {
  const metadata = JSON.parse(row.metadata || "{}");
  return {
    ...metadata,
    ...row,
    address: row.playerId || null,
    ...(rank ? { rank } : {}),
    displayScore: config.scoreDisplay === "absolute" ? Math.abs(Number(row.score)) : Number(row.score),
    metadata,
  };
}

async function handleLeaderboard(request, env, legacy = false) {
  const url = new URL(request.url);
  const requestedSlug = request.method === "GET"
    ? url.searchParams.get("slug") || url.searchParams.get("game")
    : null;

  if (request.method === "GET") {
    await enforceRateLimit(request, env, "leaderboard:get");
    const requestedApiSlug = cleanSlug(requestedSlug);
    if (!requestedApiSlug) throw new HttpError(400, "A valid slug is required");
    const game = await ensureRegisteredGame(env, requestedApiSlug);
    const slug = game.slug;
    const config = getLeaderboardConfig(game);
    if (!config.enabled) throw new HttpError(404, "Leaderboard is not enabled for this game");
    const variant = cleanText(url.searchParams.get("variant") || "default", 40);
    if (!config.variants.includes("*") && !config.variants.includes(variant)) {
      throw new HttpError(400, "Unknown leaderboard variant");
    }
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 25, 1), 100);
    const order = config.direction === "asc" ? "ASC" : "DESC";
    const result = await env.DB.prepare(`
      SELECT submission_id AS submissionId, player_name AS name, player_id AS playerId,
        score, metadata, created_at AS timestamp
      FROM leaderboard_entries
      WHERE slug = ? AND variant = ? AND moderation_status = 'approved'
      ORDER BY score ${order}, created_at ASC LIMIT ?
    `).bind(slug, variant, limit).all();
    const entries = result.results.map((row, index) => leaderboardEntry(row, config, index + 1));
    return json({ success: true, game: slug, slug, variant, direction: config.direction, entries });
  }

  if (request.method === "POST") {
    await enforceRateLimit(request, env, "leaderboard:post");
    const body = await readJson(request, 6_144);
    const requestedApiSlug = cleanSlug(body.slug || body.game);
    if (!requestedApiSlug) throw new HttpError(400, "A valid slug is required");
    const game = await ensureRegisteredGame(env, requestedApiSlug);
    const slug = game.slug;
    const config = getLeaderboardConfig(game);
    if (!config.enabled) throw new HttpError(404, "Leaderboard is not enabled for this game");
    const variant = cleanText(body.variant || "default", 40);
    if (!config.variants.includes("*") && !config.variants.includes(variant)) {
      throw new HttpError(400, "Unknown leaderboard variant");
    }
    const name = cleanText(body.name || body.playerName, 30);
    if (!name) throw new HttpError(400, "Player name is required");
    const score = Number(body.score);
    if (!Number.isFinite(score) || Math.abs(score) > 1e15) throw new HttpError(400, "Score must be a finite number");
    const metadata = leaderboardMetadata(body);
    const playerId = (body.playerId || body.address) ? cleanText(body.playerId || body.address, 100) : null;
    const submissionId = cleanText(
      request.headers.get("idempotency-key") || body.submissionId || crypto.randomUUID(),
      100,
    );
    if (!/^[a-zA-Z0-9._:-]{8,100}$/.test(submissionId)) throw new HttpError(400, "Invalid submission ID");
    const timestamp = new Date().toISOString();
    const ipHash = await hashIdentity(remoteIp(request), env.RATE_LIMIT_SALT || "mann.cool-leaderboard-v1");
    await env.DB.prepare(`
      INSERT INTO leaderboard_entries
        (submission_id, slug, variant, player_name, player_id, score, metadata,
         moderation_status, created_at, ip_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)
      ON CONFLICT(submission_id) DO NOTHING
    `).bind(
      submissionId,
      slug,
      variant,
      name,
      playerId,
      score,
      JSON.stringify(metadata),
      timestamp,
      ipHash,
    ).run();
    const row = await env.DB.prepare(`
      SELECT submission_id AS submissionId, player_name AS name, player_id AS playerId,
        score, metadata, created_at AS timestamp
      FROM leaderboard_entries WHERE submission_id = ? AND slug = ?
    `).bind(submissionId, slug).first();
    if (!row) throw new HttpError(409, "Submission ID already belongs to another score");
    const entry = leaderboardEntry(row, config);
    const comparator = config.direction === "asc" ? "<" : ">";
    const rankRow = await env.DB.prepare(`
      SELECT 1 + COUNT(*) AS rank FROM leaderboard_entries
      WHERE slug = ? AND variant = ? AND moderation_status = 'approved'
        AND (score ${comparator} ? OR (score = ? AND created_at < ?))
    `).bind(slug, variant, score, score, row.timestamp).first();
    return json(
      { success: true, game: slug, slug, variant, entry, rank: Number(rankRow?.rank || 1) },
      { status: legacy ? 200 : 201 },
    );
  }

  throw new HttpError(405, "Method not allowed");
}

export async function handlePlatformApi(request, env, endpoint, options = {}) {
  if (request.method === "OPTIONS") return options();
  try {
    if (endpoint === "plays") return await handlePlays(request, env);
    if (endpoint === "guestbook") return await handleGuestbook(request, env);
    if (endpoint === "leaderboard") return await handleLeaderboard(request, env, options.legacy === true);
    return json({ error: "API route not found" }, { status: 404 });
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, { status: error.status });
    console.error(JSON.stringify({
      message: "platform API request failed",
      endpoint,
      path: new URL(request.url).pathname,
      error: error instanceof Error ? error.message : String(error),
    }));
    return json({ error: "Internal server error" }, { status: 500 });
  }
}
