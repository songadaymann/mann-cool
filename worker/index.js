import { games, getDeliveryConfig, getGame } from "./lib/catalog.js";
import { handleLegacyApi } from "./legacy-api.js";
import { proxyLegacyGame } from "./legacy-proxy.js";
import { handlePlatformApi } from "./platform-api.js";

const PLATFORM_ENDPOINTS = new Set(["plays", "guestbook", "leaderboard"]);

function platformConfig(env) {
  return Response.json({
    version: 1,
    homeUrl: "https://mann.cool/",
    patreonUrl: env.PATREON_URL || "https://www.patreon.com/jonathanmann",
    tipUrl: env.TIP_URL || null,
    turnstileSiteKey: env.TURNSTILE_SITE_KEY || null,
  }, {
    headers: {
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}

function gameOpenGraph(request, game) {
  const url = new URL(request.url);
  const canonical = `${url.origin}/${game.slug}/`;
  const cover = new URL(game.cover || game.image, url.origin).toString();
  const title = `${game.title} | mann.cool`;
  const description = game.description || `Play ${game.title}, a game by Jonathan Mann.`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<meta name="description" content="${description}"><link rel="canonical" href="${canonical}">
<meta property="og:type" content="website"><meta property="og:url" content="${canonical}">
<meta property="og:title" content="${title}"><meta property="og:description" content="${description}">
<meta property="og:image" content="${cover}"><meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${cover}"></head><body><a href="${canonical}">${title}</a></body></html>`;
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=900" },
  });
}

function isCrawler(request) {
  return /facebookexternalhit|facebot|twitterbot|linkedinbot|pinterest|slackbot|telegrambot|whatsapp|discordbot/i
    .test(request.headers.get("user-agent") || "");
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (url.hostname === "www.mann.cool") {
    url.hostname = "mann.cool";
    return Response.redirect(url, 308);
  }

  const segments = url.pathname.split("/").filter(Boolean);

  if (segments[0] === "api") {
    const isVersioned = segments[1] === "v1";
    const endpoint = isVersioned ? segments[2] : segments[1];
    if (PLATFORM_ENDPOINTS.has(endpoint)) return handlePlatformApi(request, env, endpoint, { legacy: !isVersioned });
    return handleLegacyApi(request, env, endpoint);
  }

  if (url.pathname === "/platform/config.json") return platformConfig(env);
  if (url.pathname.startsWith("/platform/")) return env.ASSETS.fetch(request);

  const game = getGame(segments[0]);
  if (game) {
    if (segments.length === 1 && !url.pathname.endsWith("/")) {
      url.pathname = `${url.pathname}/`;
      return Response.redirect(url, 308);
    }
    if (isCrawler(request) && segments.length === 1) return gameOpenGraph(request, game);
    const delivery = getDeliveryConfig(game);
    if (delivery.mode === "legacy-proxy") return proxyLegacyGame(request, game);
    return new Response("This game is served by its dedicated Worker route.", { status: 404 });
  }

  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error(JSON.stringify({
        message: "unhandled Worker error",
        path: new URL(request.url).pathname,
        error: error instanceof Error ? error.message : String(error),
      }));
      return Response.json({ error: "Internal server error" }, { status: 500 });
    }
  },

  async scheduled(_event, env, ctx) {
    const request = new Request("https://mann.cool/api/clickstr-v2?dashboard=true&range=24h");
    ctx.waitUntil(handleLegacyApi(request, env, "clickstr-v2"));
    const staleWindow = Math.floor(Date.now() / 1000) - 86_400;
    ctx.waitUntil(env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?").bind(staleWindow).run());
  },
};

export { games };
