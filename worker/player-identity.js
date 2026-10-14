import { HttpError, cleanSlug, cleanText, hashIdentity, json, options as corsOptions, readJson } from "./lib/http.js";
import { consumeRateLimit, enforceRateLimit, ensureRegisteredGame } from "./platform-api.js";

// Player identity without accounts. A browser keeps a private random secret (32 bytes,
// base64url) in localStorage; its public player ID is derived from it, so the ID can be
// shown on leaderboards while only that browser can prove it. Linking an email lets
// another browser prove the same person later: it gets the email's player ID, and any
// scores it posted under its own ID move over.
//
// Environment: RESEND_API_KEY (secret), PLAYER_EMAIL_FROM (e.g. "mann.cool <play@mann.cool>",
// a domain verified in Resend), PLAYER_EMAIL_SALT (secret, keys the email hashes) and,
// optionally, PLAYER_EMAIL_REPLY_TO (where a reply to a code email goes).
// PLAYER_EMAIL_DEV=1 (in .dev.vars, which is never deployed) with no RESEND_API_KEY skips
// Resend and returns the code in the response, for local testing only.

const SECRET = /^[A-Za-z0-9_-]{43}$/;
const CODE_TTL_SECONDS = 600;
const CODE_ATTEMPTS = 5;
const EMAIL_RULE = { requests: 3, seconds: 3_600 };

function base64url(bytes) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

// Must match derivePlayerId in public/platform/v1/game-shell.js.
export async function derivedPlayerId(secret) {
  return `mc_${base64url(await sha256(`mann.cool-player-v1:${secret}`)).slice(0, 24)}`;
}

async function secretHash(secret) {
  return Array.from(await sha256(`mann.cool-device-v1:${secret}`), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cleanSecret(value) {
  const secret = String(value || "");
  if (!SECRET.test(secret)) throw new HttpError(400, "A valid player secret is required");
  return secret;
}

function cleanEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Enter a valid email address");
  return email;
}

function emailHint(email) {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 1)}•••@${domain}`;
}

function devMode(env) {
  // wrangler dev rewrites request URLs to the mann.cool route, so the host can't tell.
  return env.PLAYER_EMAIL_DEV === "1" && !env.RESEND_API_KEY;
}

function emailSalt(request, env) {
  if (env.PLAYER_EMAIL_SALT) return env.PLAYER_EMAIL_SALT;
  if (devMode(env)) return "mann.cool-player-email-dev";
  throw new HttpError(503, "Saving scores by email is temporarily unavailable");
}

function sixDigitCode() {
  const value = new Uint32Array(1);
  do crypto.getRandomValues(value); while (value[0] >= 4_294_000_000); // no modulo bias
  return String(value[0] % 1_000_000).padStart(6, "0");
}

async function sendCode(env, email, code) {
  if (!env.RESEND_API_KEY || !env.PLAYER_EMAIL_FROM) {
    throw new HttpError(503, "Saving scores by email is temporarily unavailable");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env.PLAYER_EMAIL_FROM,
      ...(env.PLAYER_EMAIL_REPLY_TO ? { reply_to: env.PLAYER_EMAIL_REPLY_TO } : {}),
      to: [email],
      subject: `${code} is your mann.cool code`,
      text: `Your mann.cool code is ${code}\n\nEnter it in the game to save your scores to this email. It expires in 10 minutes.\n\nDidn't ask for this? You can ignore this email.`,
      html: `<p>Your mann.cool code is</p><p style="font:700 32px/1 monospace;letter-spacing:6px">${code}</p><p>Enter it in the game to save your scores to this email. It expires in 10 minutes.</p><p style="color:#777">Didn't ask for this? You can ignore this email.</p>`,
    }),
  });
  if (!response.ok) {
    console.warn(JSON.stringify({ message: "Resend rejected a player code email", status: response.status }));
    throw new HttpError(503, "We couldn't send the code. Please try again.");
  }
}

async function handleEmailStart(request, env) {
  await enforceRateLimit(request, env, "player-email:start");
  const body = await readJson(request, 2_048);
  const secret = cleanSecret(body.secret);
  const email = cleanEmail(body.email);
  const salt = emailSalt(request, env);
  const emailHash = await hashIdentity(email, salt);
  await consumeRateLimit(env, "player-email:email", emailHash, EMAIL_RULE);
  const deviceHash = await secretHash(secret);
  const code = sixDigitCode();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM player_email_codes WHERE email_hash = ? AND secret_hash = ? AND consumed_at IS NULL")
      .bind(emailHash, deviceHash),
    env.DB.prepare(`
      INSERT INTO player_email_codes (id, email_hash, secret_hash, code_hash, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), emailHash, deviceHash, await hashIdentity(`${emailHash}:${code}`, salt),
      Math.floor(Date.now() / 1000) + CODE_TTL_SECONDS),
  ]);
  if (devMode(env)) {
    return json({ success: true, emailHint: emailHint(email), devCode: code });
  }
  await sendCode(env, email, code);
  return json({ success: true, emailHint: emailHint(email) });
}

async function handleEmailVerify(request, env) {
  await enforceRateLimit(request, env, "player-email:verify");
  const body = await readJson(request, 2_048);
  const secret = cleanSecret(body.secret);
  const email = cleanEmail(body.email);
  const code = String(body.code || "").replace(/\D/g, "");
  if (code.length !== 6) throw new HttpError(400, "Enter the 6-digit code");
  const salt = emailSalt(request, env);
  const emailHash = await hashIdentity(email, salt);
  const deviceHash = await secretHash(secret);

  const pending = await env.DB.prepare(`
    SELECT id, code_hash AS codeHash, attempts, expires_at AS expiresAt
    FROM player_email_codes
    WHERE email_hash = ? AND secret_hash = ? AND consumed_at IS NULL
    ORDER BY created_at DESC LIMIT 1
  `).bind(emailHash, deviceHash).first();
  if (!pending || pending.expiresAt < Math.floor(Date.now() / 1000) || pending.attempts >= CODE_ATTEMPTS) {
    throw new HttpError(400, "That code has expired. Send a new one.");
  }
  if (pending.codeHash !== await hashIdentity(`${emailHash}:${code}`, salt)) {
    await env.DB.prepare("UPDATE player_email_codes SET attempts = attempts + 1 WHERE id = ?").bind(pending.id).run();
    throw new HttpError(400, pending.attempts + 1 >= CODE_ATTEMPTS ? "Too many tries. Send a new code." : "That code isn't right.");
  }
  const used = await env.DB.prepare("UPDATE player_email_codes SET consumed_at = CURRENT_TIMESTAMP WHERE id = ? AND consumed_at IS NULL")
    .bind(pending.id).run();
  if (!used.meta?.changes) throw new HttpError(400, "That code has expired. Send a new one.");

  // This browser's current ID: the email's ID if it already linked one, else its own.
  const device = await env.DB.prepare("SELECT player_id AS playerId FROM player_devices WHERE secret_hash = ?").bind(deviceHash).first();
  const current = device?.playerId || await derivedPlayerId(secret);
  const profile = await env.DB.prepare("SELECT player_id AS playerId, email_hint AS emailHint FROM player_profiles WHERE email_hash = ?")
    .bind(emailHash).first();

  if (!profile) {
    if (device) throw new HttpError(409, "This browser is already saved to another email.");
    const hint = emailHint(email);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO player_profiles (player_id, email_hash, email_hint) VALUES (?, ?, ?)").bind(current, emailHash, hint),
      env.DB.prepare("INSERT INTO player_devices (secret_hash, player_id) VALUES (?, ?)").bind(deviceHash, current),
    ]);
    return json({ success: true, playerId: current, emailHint: hint, linked: true, merged: 0 });
  }
  if (device && device.playerId !== profile.playerId) throw new HttpError(409, "This browser is already saved to another email.");

  let merged = 0;
  if (device) {
    await env.DB.prepare("UPDATE player_devices SET last_seen_at = CURRENT_TIMESTAMP WHERE secret_hash = ?").bind(deviceHash).run();
  } else {
    // A new browser for this email: scores it already posted under its own ID (proven by
    // its secret) join the email's player ID.
    const statements = [env.DB.prepare("INSERT INTO player_devices (secret_hash, player_id) VALUES (?, ?)").bind(deviceHash, profile.playerId)];
    if (current !== profile.playerId) {
      statements.unshift(env.DB.prepare("UPDATE leaderboard_entries SET player_id = ? WHERE player_id = ?").bind(profile.playerId, current));
    }
    const results = await env.DB.batch(statements);
    merged = current !== profile.playerId ? Number(results[0].meta?.changes || 0) : 0;
  }
  return json({ success: true, playerId: profile.playerId, emailHint: profile.emailHint, linked: true, merged });
}

// Where are this browser's scores saved, if anywhere?
async function handleSession(request, env) {
  await enforceRateLimit(request, env, "player:session");
  const body = await readJson(request, 1_024);
  const secret = cleanSecret(body.secret);
  const row = await env.DB.prepare(`
    SELECT d.player_id AS playerId, p.email_hint AS emailHint
    FROM player_devices d JOIN player_profiles p ON p.player_id = d.player_id
    WHERE d.secret_hash = ?
  `).bind(await secretHash(secret)).first();
  if (row) return json({ success: true, playerId: row.playerId, emailHint: row.emailHint, linked: true });
  return json({ success: true, playerId: await derivedPlayerId(secret), emailHint: null, linked: false });
}

export async function handlePlayerApi(request, env, route) {
  if (request.method === "OPTIONS") return corsOptions();
  try {
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
    if (route === "email/start") return await handleEmailStart(request, env);
    if (route === "email/verify") return await handleEmailVerify(request, env);
    if (route === "session") return await handleSession(request, env);
    return json({ error: "API route not found" }, { status: 404 });
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, { status: error.status });
    console.error(JSON.stringify({ message: "player API request failed", route, error: error instanceof Error ? error.message : String(error) }));
    return json({ error: "Internal server error" }, { status: 500 });
  }
}

// Wallet presence: one anonymous report per browser per game per day, saying whether a
// crypto wallet extension is installed (EVM and/or Solana) and which ones by name. The
// shell only listens for wallets announcing themselves; it never connects or reads addresses.
function cleanWalletNames(value) {
  if (!Array.isArray(value)) return [];
  const names = value.map((name) => cleanText(name, 40)).filter(Boolean);
  return [...new Set(names)].slice(0, 8);
}

export async function handleWalletsApi(request, env) {
  if (request.method === "OPTIONS") return corsOptions();
  try {
    const url = new URL(request.url);
    if (request.method === "GET") {
      await enforceRateLimit(request, env, "wallets:get");
      const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 30, 1), 365);
      const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
      const slug = cleanSlug(url.searchParams.get("slug"));
      if (url.searchParams.has("slug") && !slug) throw new HttpError(400, "Invalid slug");
      const where = slug ? "WHERE day >= ? AND slug = ?" : "WHERE day >= ?";
      const binds = slug ? [since, slug] : [since];
      const totals = await env.DB.prepare(`
        SELECT COALESCE(SUM(reports), 0) AS reports, COALESCE(SUM(with_wallet), 0) AS withWallet,
          COALESCE(SUM(with_evm), 0) AS withEvm, COALESCE(SUM(with_solana), 0) AS withSolana
        FROM wallet_presence_daily ${where}
      `).bind(...binds).first();
      const names = await env.DB.prepare(`
        SELECT name, SUM(reports) AS reports FROM wallet_names_daily ${where}
        GROUP BY name ORDER BY reports DESC, name LIMIT 20
      `).bind(...binds).all();
      const reports = Number(totals.reports);
      return json({
        success: true, slug: slug || null, since, days,
        reports, withWallet: Number(totals.withWallet), withEvm: Number(totals.withEvm), withSolana: Number(totals.withSolana),
        share: reports ? Number(totals.withWallet) / reports : null,
        wallets: names.results.map((row) => ({ name: row.name, reports: Number(row.reports) })),
      });
    }
    if (request.method === "POST") {
      await enforceRateLimit(request, env, "wallets:post");
      const body = await readJson(request, 2_048);
      const slug = cleanSlug(body.slug);
      if (!slug) throw new HttpError(400, "A valid slug is required");
      const game = await ensureRegisteredGame(env, slug);
      const evm = body.evm === true, solana = body.solana === true;
      const names = cleanWalletNames(body.names);
      const any = evm || solana || names.length > 0;
      const day = new Date().toISOString().slice(0, 10);
      await env.DB.batch([
        env.DB.prepare(`
          INSERT INTO wallet_presence_daily (slug, day, reports, with_wallet, with_evm, with_solana)
          VALUES (?, ?, 1, ?, ?, ?)
          ON CONFLICT(slug, day) DO UPDATE SET
            reports = reports + 1, with_wallet = with_wallet + excluded.with_wallet,
            with_evm = with_evm + excluded.with_evm, with_solana = with_solana + excluded.with_solana
        `).bind(game.slug, day, any ? 1 : 0, evm ? 1 : 0, solana ? 1 : 0),
        ...names.map((name) => env.DB.prepare(`
          INSERT INTO wallet_names_daily (slug, day, name, reports) VALUES (?, ?, ?, 1)
          ON CONFLICT(slug, day, name) DO UPDATE SET reports = reports + 1
        `).bind(game.slug, day, name)),
      ]);
      return json({ success: true }, { status: 201 });
    }
    throw new HttpError(405, "Method not allowed");
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, { status: error.status });
    console.error(JSON.stringify({ message: "wallets API request failed", error: error instanceof Error ? error.message : String(error) }));
    return json({ error: "Internal server error" }, { status: 500 });
  }
}
