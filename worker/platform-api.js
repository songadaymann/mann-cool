import { getGame, getGameByApiSlug, getGameStatus, getLeaderboardConfig } from "./lib/catalog.js";
import {
  HttpError,
  cleanSlug,
  cleanSource,
  cleanText,
  hashIdentity,
  json,
  options as corsOptions,
  readJson,
} from "./lib/http.js";

const LIMITS = {
  "plays:post": { requests: 60, seconds: 60 },
  "guestbook:get": { requests: 120, seconds: 60 },
  "guestbook:post": { requests: 5, seconds: 600 },
  "leaderboard:get": { requests: 120, seconds: 60 },
  "leaderboard:post": { requests: 20, seconds: 60 },
  "community-levels:get": { requests: 120, seconds: 60 },
  "community-levels:post": { requests: 3, seconds: 600 },
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
    throw new HttpError(503, "Human verification is temporarily unavailable");
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

const COMMUNITY_LEVEL_LIMITS = { walls: 120, rocks: 20, cups: 3, cameras: 20, trees: 30, trashPiles: 30 };
const FOOTPRINT_KINDS = new Set(["rect", "l", "t", "h", "y", "z", "u"]);

function finiteNumber(value, label, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new HttpError(400, `${label} is out of range`);
  }
  return Math.round(number * 1000) / 1000;
}

function communityEntityId(value, fallback) {
  const clean = String(value || fallback).replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 80);
  return clean || fallback;
}

function normalizePoint(value, label, index, width, depth) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, `${label} is invalid`);
  return {
    id: communityEntityId(value.id, `${label}-${index}`),
    x: finiteNumber(value.x, `${label}.x`, -width / 2, width / 2),
    z: finiteNumber(value.z, `${label}.z`, -depth / 2, depth / 2),
  };
}

function normalizeCommunityLevel(value, requestedName) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Number(value.version) !== 1) {
    throw new HttpError(400, "This is not a Jimothy level");
  }
  const width = finiteNumber(value.width, "level width", 8, 36);
  const depth = finiteNumber(value.depth, "level depth", 24, 72);
  const normalizeList = (key) => {
    if (!Array.isArray(value[key]) || value[key].length > COMMUNITY_LEVEL_LIMITS[key]) {
      throw new HttpError(400, `${key} must contain at most ${COMMUNITY_LEVEL_LIMITS[key]} items`);
    }
    return value[key].map((item, index) => normalizePoint(item, key.slice(0, -1), index + 1, width, depth));
  };
  const walls = normalizeList("walls").map((wall, index) => ({
    ...wall,
    hw: finiteNumber(value.walls[index].hw, `wall ${index + 1} width`, 0.2, width / 2),
    hd: finiteNumber(value.walls[index].hd, `wall ${index + 1} depth`, 0.2, depth / 2),
  }));
  const rocks = normalizeList("rocks");
  const cups = Array.isArray(value.cups) ? normalizeList("cups") : [];
  const cameras = normalizeList("cameras").map((camera, index) => ({
    ...camera,
    yaw: finiteNumber(value.cameras[index].yaw, `camera ${index + 1} direction`, -Math.PI * 4, Math.PI * 4),
  }));
  const trees = Array.isArray(value.trees) ? normalizeList("trees").map((tree, index) => ({
    ...tree,
    scale: finiteNumber(value.trees[index].scale, `tree ${index + 1} scale`, 0.4, 1.2),
    seed: finiteNumber(value.trees[index].seed, `tree ${index + 1} seed`, 0, 4294967295),
  })) : [];
  const trashPiles = Array.isArray(value.trashPiles) ? normalizeList("trashPiles").map((pile, index) => ({
    ...pile,
    rot: finiteNumber(value.trashPiles[index].rot, `trash pile ${index + 1} rotation`, -Math.PI * 4, Math.PI * 4),
  })) : [];
  if (!rocks.length || !cameras.length) throw new HttpError(400, "A shared alley needs at least one rock and one camera");
  const name = cleanText(requestedName || value.name, 50);
  if (!name) throw new HttpError(400, "A level name is required");
  const level = {
    version: 1,
    name,
    width,
    depth,
    start: normalizePoint(value.start, "start", 1, width, depth),
    home: normalizePoint(value.home, "home", 1, width, depth),
    walls,
    rocks,
    cups,
    cameras,
    trees,
    trashPiles,
  };
  if (value.footprint && typeof value.footprint === "object" && !Array.isArray(value.footprint)) {
    const kind = String(value.footprint.kind || "rect").toLowerCase();
    if (!FOOTPRINT_KINDS.has(kind)) throw new HttpError(400, "Unknown level footprint");
    level.footprint = {
      kind,
      corridorWidth: finiteNumber(value.footprint.corridorWidth, "corridor width", 5, 11),
      a: finiteNumber(value.footprint.a, "footprint section A", 4, 72),
      b: finiteNumber(value.footprint.b, "footprint section B", 4, 72),
      c: finiteNumber(value.footprint.c, "footprint section C", 4, 72),
    };
  }
  return level;
}

function communityLevelEntry(row) {
  return {
    id: row.id,
    authorName: row.authorName,
    levelName: row.levelName,
    level: JSON.parse(row.levelJson),
    createdAt: row.createdAt,
  };
}

async function handleCommunityLevels(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET") {
    await enforceRateLimit(request, env, "community-levels:get");
    const requestedSlug = cleanSlug(url.searchParams.get("slug") || url.searchParams.get("game"));
    if (!requestedSlug) throw new HttpError(400, "A valid slug is required");
    const game = await ensureRegisteredGame(env, requestedSlug);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 30, 1), 100);
    const result = await env.DB.prepare(`
      SELECT id, author_name AS authorName, level_name AS levelName,
        level_json AS levelJson, created_at AS createdAt
      FROM community_levels
      WHERE slug = ? AND moderation_status = 'approved'
      ORDER BY created_at DESC LIMIT ?
    `).bind(game.slug, limit).all();
    return json({ success: true, slug: game.slug, entries: result.results.map(communityLevelEntry) });
  }

  if (request.method === "POST") {
    await enforceRateLimit(request, env, "community-levels:post");
    const body = await readJson(request, 96_000);
    const requestedSlug = cleanSlug(body.slug || body.game);
    if (!requestedSlug) throw new HttpError(400, "A valid slug is required");
    const game = await ensureRegisteredGame(env, requestedSlug);
    const authorName = cleanText(body.authorName || body.name, 50);
    if (!authorName) throw new HttpError(400, "Your name is required");
    const level = normalizeCommunityLevel(body.level, body.levelName);
    await verifyTurnstile(request, env, body.turnstileToken || body.turnstile_token);
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const ipHash = await hashIdentity(remoteIp(request), env.RATE_LIMIT_SALT || "mann.cool-community-levels-v1");
    await env.DB.prepare(`
      INSERT INTO community_levels
        (id, slug, author_name, level_name, level_json, moderation_status, created_at, ip_hash)
      VALUES (?, ?, ?, ?, ?, 'approved', ?, ?)
    `).bind(id, game.slug, authorName, level.name, JSON.stringify(level), createdAt, ipHash).run();
    return json({ success: true, entry: { id, authorName, levelName: level.name, level, createdAt } }, { status: 201 });
  }

  throw new HttpError(405, "Method not allowed");
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
    const slug = cleanSlug(body.slug || body.game || url.searchParams.get("slug") || "mann-cool");
    if (!slug) throw new HttpError(400, "A valid slug is required");
    await ensureRegisteredGame(env, slug);
    const name = cleanText(body.name || body.displayName, 50);
    const message = cleanText(body.message || body.body, 500);
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
  const metadata = { ...parseMetadata(body.metadata) };
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

function leaderboardBoard(config, variant) {
  return config.boards.find((board) => board.variant === variant) || null;
}

function winLossEntry(row, rank) {
  const wins = Number(row.wins || 0);
  const losses = Number(row.losses || 0);
  const draws = Number(row.draws || 0);
  const matches = Number(row.matches || 0);
  const score = Number(row.score || 0);
  const metadata = { wins, losses, draws, matches, winRate: score };
  return {
    name: row.name,
    playerId: row.playerId,
    address: row.playerId,
    score,
    displayScore: score,
    timestamp: row.timestamp,
    rank,
    ...metadata,
    metadata,
  };
}

async function readWinLossLeaderboard(env, slug, variant, board, limit) {
  const result = await env.DB.prepare(`
    WITH records AS (
      SELECT player_id AS playerId,
        SUM(CASE WHEN score = 1 THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN score = 0 THEN 1 ELSE 0 END) AS losses,
        SUM(CASE WHEN score = 0.5 THEN 1 ELSE 0 END) AS draws,
        COUNT(*) AS matches,
        100.0 * SUM(score) / COUNT(*) AS score,
        MAX(created_at) AS timestamp
      FROM leaderboard_entries
      WHERE slug = ? AND variant = ? AND moderation_status = 'approved'
        AND player_id IS NOT NULL AND player_id != '' AND score IN (0, 0.5, 1)
      GROUP BY player_id
      HAVING COUNT(*) >= ?
    )
    SELECT records.*,
      (SELECT player_name FROM leaderboard_entries latest
       WHERE latest.slug = ? AND latest.variant = ?
         AND latest.player_id = records.playerId AND latest.moderation_status = 'approved'
       ORDER BY latest.created_at DESC LIMIT 1) AS name
    FROM records
    ORDER BY score DESC, wins DESC, matches DESC, timestamp ASC
    LIMIT ?
  `).bind(slug, variant, board.minimumMatches, slug, variant, limit).all();
  return result.results.map((row, index) => winLossEntry(row, index + 1));
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
    const board = leaderboardBoard(config, variant);
    if (!board && !config.variants.includes("*")) {
      throw new HttpError(400, "Unknown leaderboard variant");
    }
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 25, 1), 100);
    if (board?.aggregation === "win-loss-rate") {
      const entries = await readWinLossLeaderboard(env, slug, variant, board, limit);
      return json({ success: true, game: slug, slug, variant, direction: board.direction, board, entries });
    }
    const direction = board?.direction || config.direction;
    const order = direction === "asc" ? "ASC" : "DESC";
    const result = await env.DB.prepare(`
      SELECT submission_id AS submissionId, player_name AS name, player_id AS playerId,
        score, metadata, created_at AS timestamp
      FROM leaderboard_entries
      WHERE slug = ? AND variant = ? AND moderation_status = 'approved'
      ORDER BY score ${order}, created_at ASC LIMIT ?
    `).bind(slug, variant, limit).all();
    const entries = result.results.map((row, index) => leaderboardEntry(row, config, index + 1));
    return json({ success: true, game: slug, slug, variant, direction, board, entries });
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
    const board = leaderboardBoard(config, variant);
    if (!board && !config.variants.includes("*")) {
      throw new HttpError(400, "Unknown leaderboard variant");
    }
    const name = cleanText(body.name || body.playerName, 30);
    if (!name) throw new HttpError(400, "Player name is required");
    const metadata = leaderboardMetadata(body);
    const playerId = (body.playerId || body.address) ? cleanText(body.playerId || body.address, 100) : null;
    let score;
    if (board?.aggregation === "win-loss-rate") {
      if (!playerId) throw new HttpError(400, "A stable playerId is required for win/loss leaderboards");
      const result = String(body.result || metadata.result || "").toLowerCase();
      const outcomes = { win: 1, draw: 0.5, loss: 0 };
      if (!(result in outcomes)) throw new HttpError(400, "result must be win, loss, or draw");
      score = outcomes[result];
      metadata.result = result;
    } else {
      score = Number(body.score);
      if (!Number.isFinite(score) || Math.abs(score) > 1e15) throw new HttpError(400, "Score must be a finite number");
    }
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
      FROM leaderboard_entries WHERE submission_id = ? AND slug = ? AND variant = ?
    `).bind(submissionId, slug, variant).first();
    if (!row) throw new HttpError(409, "Submission ID already belongs to another score");
    const entry = leaderboardEntry(row, config);
    if (board?.aggregation === "win-loss-rate") {
      const records = await readWinLossLeaderboard(env, slug, variant, board, 100);
      const record = records.find((candidate) => candidate.playerId === playerId);
      return json(
        { success: true, game: slug, slug, variant, entry: record || entry, rank: record?.rank || null },
        { status: legacy ? 200 : 201 },
      );
    }
    const storedScore = Number(row.score);
    const comparator = (board?.direction || config.direction) === "asc" ? "<" : ">";
    const rankRow = await env.DB.prepare(`
      SELECT 1 + COUNT(*) AS rank FROM leaderboard_entries
      WHERE slug = ? AND variant = ? AND moderation_status = 'approved'
        AND (score ${comparator} ? OR (score = ? AND created_at < ?))
    `).bind(slug, variant, storedScore, storedScore, row.timestamp).first();
    return json(
      { success: true, game: slug, slug, variant, entry, rank: Number(rankRow?.rank || 1) },
      { status: legacy ? 200 : 201 },
    );
  }

  throw new HttpError(405, "Method not allowed");
}

export async function handlePlatformApi(request, env, endpoint, requestOptions = {}) {
  if (request.method === "OPTIONS") return corsOptions();
  try {
    if (endpoint === "plays") return await handlePlays(request, env);
    if (endpoint === "guestbook") return await handleGuestbook(request, env);
    if (endpoint === "leaderboard") return await handleLeaderboard(request, env, requestOptions.legacy === true);
    if (endpoint === "community-levels") return await handleCommunityLevels(request, env);
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
