interface Env {
  SCORES_DB: D1Database;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  GUESTBOOK_IP_HASH_SALT?: string;
}

interface ScoreBody {
  gameId?: unknown;
  playerId?: unknown;
  playerName?: unknown;
  timeMs?: unknown;
  birdos?: unknown;
  coins?: unknown;
  lives?: unknown;
  heartsCollected?: unknown;
  cockrings?: unknown;
  completionPercent?: unknown;
}

interface GuestbookBody {
  displayName?: unknown;
  body?: unknown;
  guestSessionId?: unknown;
  turnstileToken?: unknown;
}

interface GuestbookEntryRow {
  id: string;
  display_name: string;
  body: string;
  created_at: string;
}

const GUESTBOOK_LIMIT = 30;
const GUESTBOOK_IP_HOURLY_LIMIT = 5;
const GUESTBOOK_SESSION_MINUTE_LIMIT = 1;
const GUESTBOOK_SESSION_DAILY_LIMIT = 10;
const GUESTBOOK_HOSTNAME = 'mann.cool';

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { ...CORS, 'Cache-Control': 'no-store' } });
}

function cleanId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) throw new Error(`${field} is invalid.`);
  return value;
}

function cleanName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('playerName is invalid.');
  const name = value.trim().replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 20);
  if (!name) throw new Error('playerName is invalid.');
  return name;
}

function cleanInteger(value: unknown, field: string, minimum: number, maximum: number): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) throw new Error(`${field} is invalid.`);
  return number;
}

function guestbookConfig(env: Env) {
  return {
    turnstileSiteKey: env.TURNSTILE_SITE_KEY?.trim() || null,
    turnstileRequired: Boolean(env.TURNSTILE_SECRET_KEY?.trim()),
  };
}

function cleanGuestbookName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Name is required.');
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length < 2) throw new Error('Name must be at least 2 characters.');
  if (normalized.length > 32) throw new Error('Name must be 32 characters or fewer.');
  if (/[<>]/.test(normalized)) throw new Error('Name cannot contain angle brackets.');
  return normalized;
}

function cleanGuestbookMessage(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Message is required.');
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) throw new Error('Message is required.');
  if (normalized.length > 280) throw new Error('Message must be 280 characters or fewer.');
  if (/[<>]/.test(normalized)) throw new Error('Message cannot contain angle brackets.');
  if (/(https?:\/\/|www\.)/i.test(normalized)) throw new Error('Links are not allowed in the guestbook.');
  return normalized;
}

function cleanGuestSessionId(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(value.trim())) throw new Error('guestSessionId is invalid.');
  return value.trim();
}

function requestIp(request: Request): string | null {
  const value = request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For')?.split(',')[0] ?? '';
  return value.trim() || null;
}

async function hashIp(env: Env, ip: string): Promise<string> {
  const salt = env.GUESTBOOK_IP_HASH_SALT?.trim() || 'lindsay-in-hell-guestbook';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${ip}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function countGuestbookEntries(env: Env, column: 'ip_hash' | 'guest_session_id', value: string, since: string): Promise<number> {
  const row = await env.SCORES_DB.prepare(`SELECT COUNT(*) AS count FROM guestbook_entries WHERE ${column} = ?1 AND created_at >= ?2`)
    .bind(value, since).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function enforceGuestbookRateLimit(env: Env, ipHash: string | null, sessionId: string | null, now: number) {
  if (ipHash && await countGuestbookEntries(env, 'ip_hash', ipHash, new Date(now - 3_600_000).toISOString()) >= GUESTBOOK_IP_HOURLY_LIMIT) {
    throw new HttpError(429, 'Too many guestbook entries from this network. Try again later.');
  }
  if (!sessionId) return;
  if (await countGuestbookEntries(env, 'guest_session_id', sessionId, new Date(now - 60_000).toISOString()) >= GUESTBOOK_SESSION_MINUTE_LIMIT) {
    throw new HttpError(429, 'Please wait a minute before signing again.');
  }
  if (await countGuestbookEntries(env, 'guest_session_id', sessionId, new Date(now - 86_400_000).toISOString()) >= GUESTBOOK_SESSION_DAILY_LIMIT) {
    throw new HttpError(429, 'This browser has signed the guestbook enough for today.');
  }
}

async function verifyTurnstile(env: Env, token: unknown, ip: string | null): Promise<string | null> {
  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return null;
  if (typeof token !== 'string' || !token.trim()) throw new Error('Turnstile verification is required.');
  const form = new FormData();
  form.set('secret', secret);
  form.set('response', token.trim());
  if (ip) form.set('remoteip', ip);
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  if (!response.ok) throw new Error('Turnstile verification is temporarily unavailable.');
  const result = await response.json<{ success?: boolean; hostname?: string }>();
  if (!result.success) throw new Error('Turnstile verification failed. Try again.');
  if (result.hostname !== GUESTBOOK_HOSTNAME) throw new Error('Turnstile verification came from the wrong site.');
  return new Date().toISOString();
}

async function listGuestbook(env: Env): Promise<Response> {
  const result = await env.SCORES_DB.prepare(`
    SELECT id, display_name, body, created_at
    FROM guestbook_entries
    WHERE hidden_at IS NULL
    ORDER BY created_at DESC, id DESC
    LIMIT ?1
  `).bind(GUESTBOOK_LIMIT).all<GuestbookEntryRow>();
  return json({
    entries: result.results.map((entry) => ({ id: entry.id, displayName: entry.display_name, body: entry.body, createdAt: entry.created_at })),
    config: guestbookConfig(env),
  });
}

async function signGuestbook(request: Request, env: Env): Promise<Response> {
  let body: GuestbookBody;
  try { body = await request.json<GuestbookBody>(); }
  catch { return json({ error: 'Body must be valid JSON.' }, 400); }
  const displayName = cleanGuestbookName(body.displayName);
  const message = cleanGuestbookMessage(body.body);
  const sessionId = cleanGuestSessionId(body.guestSessionId);
  const ip = requestIp(request);
  const ipHash = ip ? await hashIp(env, ip) : null;
  const now = Date.now();
  await enforceGuestbookRateLimit(env, ipHash, sessionId, now);
  const verifiedAt = await verifyTurnstile(env, body.turnstileToken, ip);
  const entry = { id: crypto.randomUUID(), displayName, body: message, createdAt: new Date(now).toISOString() };
  await env.SCORES_DB.prepare(`
    INSERT INTO guestbook_entries (id, display_name, body, guest_session_id, ip_hash, user_agent, turnstile_verified_at, created_at, hidden_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL)
  `).bind(entry.id, entry.displayName, entry.body, sessionId, ipHash, request.headers.get('User-Agent')?.slice(0, 260) || null, verifiedAt, entry.createdAt).run();
  return json({ entry, config: guestbookConfig(env) }, 201);
}

async function leaderboard(requestUrl: URL, env: Env): Promise<Response> {
  const gameId = cleanId(requestUrl.searchParams.get('gameId'), 'gameId');
  const requestedLimit = requestUrl.searchParams.get('limit') ?? '10';
  const showAll = requestedLimit === 'all';
  const limit = showAll ? null : cleanInteger(requestedLimit, 'limit', 1, 100);
  const statement = env.SCORES_DB.prepare(`
    SELECT player_name AS playerName, time_ms AS timeMs, birdos, coins, lives,
      hearts_collected AS heartsCollected, cockrings, completion_percent AS completionPercent,
      created_at AS createdAt
    FROM (
      SELECT player_name, time_ms, birdos, coins, lives, hearts_collected, cockrings, completion_percent, created_at,
        ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY completion_percent DESC, time_ms ASC, coins DESC, created_at ASC) AS player_rank
      FROM scores WHERE game_id = ?1
    )
    WHERE player_rank = 1
    ORDER BY completionPercent DESC, timeMs ASC, coins DESC, createdAt ASC
    ${showAll ? '' : 'LIMIT ?2'}
  `);
  const result = showAll
    ? await statement.bind(gameId).all()
    : await statement.bind(gameId, limit).all();
  return json({ entries: result.results });
}

async function submitScore(request: Request, env: Env): Promise<Response> {
  let body: ScoreBody;
  try { body = await request.json<ScoreBody>(); }
  catch { return json({ error: 'Body must be valid JSON.' }, 400); }
  try {
    const gameId = cleanId(body.gameId, 'gameId');
    const playerId = cleanId(body.playerId, 'playerId');
    const playerName = cleanName(body.playerName);
    const timeMs = cleanInteger(body.timeMs, 'timeMs', 500, 86_400_000);
    const birdos = cleanInteger(body.birdos, 'birdos', 0, 10_000);
    const coins = cleanInteger(body.coins, 'coins', 0, 1_000_000);
    const lives = cleanInteger(body.lives, 'lives', 0, 10_000);
    // Keep already-published player bundles compatible while new builds begin
    // reporting the richer completion breakdown.
    const heartsCollected = cleanInteger(body.heartsCollected ?? 0, 'heartsCollected', 0, 10_000);
    const cockrings = cleanInteger(body.cockrings ?? 0, 'cockrings', 0, 5);
    const completionPercent = cleanInteger(body.completionPercent ?? 0, 'completionPercent', 0, 100);
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await env.SCORES_DB.prepare(`
      INSERT INTO scores (id, game_id, player_id, player_name, time_ms, birdos, coins, lives, hearts_collected, cockrings, completion_percent, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
    `).bind(id, gameId, playerId, playerName, timeMs, birdos, coins, lives, heartsCollected, cockrings, completionPercent, createdAt).run();
    return json({ ok: true, id, createdAt }, 201);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Score is invalid.' }, 400);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && url.pathname === '/api/health') return json({ ok: true, service: 'lindsay-in-hell-leaderboard' });
      if (request.method === 'GET' && url.pathname === '/api/leaderboard') return await leaderboard(url, env);
      if (request.method === 'POST' && url.pathname === '/api/scores') return await submitScore(request, env);
      if (request.method === 'GET' && url.pathname === '/api/guestbook') return await listGuestbook(env);
      if (request.method === 'POST' && url.pathname === '/api/guestbook') return await signGuestbook(request, env);
      return json({ error: 'Not found.' }, 404);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Request failed.' }, error instanceof HttpError ? error.status : 400);
    }
  },
};
