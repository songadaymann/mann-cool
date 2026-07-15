import { createStaticGameWorker } from "../../shared/static-worker.js";
import hellApi from "./api.ts";

const PLATFORM_GUESTBOOK = "https://mann.cool/api/v1/guestbook";

async function guestbookConfig(env) {
  try {
    const response = await env.PLATFORM.fetch("https://mann.cool/platform/config.json");
    const config = await response.json();
    return {
      turnstileSiteKey: config.turnstileSiteKey || null,
      turnstileRequired: Boolean(config.turnstileSiteKey),
    };
  } catch {
    return { turnstileSiteKey: null, turnstileRequired: false };
  }
}

async function sharedGuestbook(request, env) {
  if (request.method === "GET") {
    const response = await env.PLATFORM.fetch(new Request(`${PLATFORM_GUESTBOOK}?slug=hell&limit=30`, request));
    const data = await response.json();
    return Response.json({
      entries: (data.entries || []).map((entry) => ({
        id: entry.id,
        displayName: entry.name,
        body: entry.message,
        createdAt: entry.timestamp,
      })),
      config: await guestbookConfig(env),
      ...(response.ok ? {} : { error: data.error || "Guestbook unavailable" }),
    }, { status: response.status });
  }

  if (request.method === "POST") {
    const upstream = await env.PLATFORM.fetch(new Request(`${PLATFORM_GUESTBOOK}?slug=hell`, request));
    const data = await upstream.json();
    return Response.json({
      ...(data.entry ? {
        entry: {
          id: data.entry.id,
          displayName: data.entry.name,
          body: data.entry.message,
          createdAt: data.entry.timestamp,
        },
      } : {}),
      config: await guestbookConfig(env),
      ...(upstream.ok ? {} : { error: data.error || "Could not sign guestbook" }),
    }, { status: upstream.status });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}

const staticWorker = createStaticGameWorker({
  slug: "hell",
  title: "Lindsay Graham In Hell",
  leaderboard: true,
  leaderboardUrl: "/hell/leaderboard/",
  async api(request, env) {
    const url = new URL(request.url);
    url.pathname = url.pathname.slice("/hell".length);
    if (url.pathname === "/api/guestbook") return sharedGuestbook(request, env);
    return hellApi.fetch(new Request(url, request), env);
  },
});

export default staticWorker;
