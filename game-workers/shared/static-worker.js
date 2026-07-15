const HTML_LIMIT = 5 * 1024 * 1024;

function responseHeaders(headers) {
  const next = new Headers(headers);
  next.delete("content-length");
  next.set("x-content-type-options", "nosniff");
  next.set("referrer-policy", "strict-origin-when-cross-origin");
  next.set("x-mann-cool-delivery", "dedicated-worker");
  return next;
}

function gameShell(config) {
  const leaderboardUrl = config.leaderboardUrl ? ` data-leaderboard-url="${config.leaderboardUrl}"` : "";
  const leaderboardVariant = config.leaderboardVariant ? ` data-leaderboard-variant="${config.leaderboardVariant}"` : "";
  return `<script src="https://mann.cool/platform/v1/game-shell.js" data-slug="${config.slug}" data-title="${config.title.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}" data-leaderboard="${config.leaderboard ? "true" : "false"}"${leaderboardUrl}${leaderboardVariant} defer></script>`;
}

function injectShell(html, config) {
  if (html.includes("/platform/v1/game-shell.js")) return html;
  const shell = gameShell(config);
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${shell}</head>`) : `${shell}${html}`;
}

function r2Headers(object) {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  if (!headers.has("cache-control")) headers.set("cache-control", "public, max-age=31536000, immutable");
  return responseHeaders(headers);
}

async function fetchLargeAsset(request, env, config, assetPath) {
  if (!env.GAME_ASSETS || !["GET", "HEAD"].includes(request.method)) return null;
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(assetPath).replace(/^\/+/, "");
  } catch {
    return new Response("Invalid asset path", { status: 400 });
  }
  if (!decodedPath || decodedPath.split("/").includes("..")) return null;

  const key = `${config.slug}/${decodedPath}`;
  if (request.method === "HEAD") {
    const object = await env.GAME_ASSETS.head(key);
    if (!object) return null;
    const headers = r2Headers(object);
    headers.set("content-length", String(object.size));
    return new Response(null, { status: 200, headers });
  }

  const rangeHeader = request.headers.get("range");
  const object = await env.GAME_ASSETS.get(key, rangeHeader ? { range: request.headers } : undefined);
  if (!object) return null;
  const headers = r2Headers(object);
  if (object.range) {
    const offset = object.range.offset ?? Math.max(0, object.size - (object.range.suffix || 0));
    const length = object.range.length ?? object.size - offset;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("content-length", String(length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("content-length", String(object.size));
  return new Response(object.body, { status: 200, headers });
}

export function createStaticGameWorker(config) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (url.hostname === "www.mann.cool") {
        url.hostname = "mann.cool";
        return Response.redirect(url, 308);
      }

      const prefix = `/${config.slug}`;
      if (url.pathname === prefix) {
        url.pathname = `${prefix}/`;
        return Response.redirect(url, 308);
      }

      if (config.api && url.pathname.startsWith(`${prefix}/api/`)) {
        return config.api(request, env);
      }

      const assetPath = url.pathname.slice(prefix.length) || "/";
      const assetUrl = new URL(request.url);
      assetUrl.pathname = assetPath;
      const assetResponse = await env.ASSETS.fetch(new Request(assetUrl, request));
      if (assetResponse.status === 404) {
        const largeAsset = await fetchLargeAsset(request, env, config, assetPath);
        if (largeAsset) return largeAsset;
      }
      const headers = responseHeaders(assetResponse.headers);
      if (assetResponse.status >= 300 && assetResponse.status < 400) {
        const location = assetResponse.headers.get("location");
        if (location) {
          const target = new URL(location, assetUrl);
          if (target.origin === assetUrl.origin) {
            headers.set("location", `${prefix}${target.pathname}${target.search}${target.hash}`);
          }
        }
        return new Response(null, { status: assetResponse.status, headers });
      }
      const contentType = assetResponse.headers.get("content-type") || "";
      if (!contentType.toLowerCase().includes("text/html")) {
        return new Response(assetResponse.body, { status: assetResponse.status, headers });
      }

      const declaredLength = Number(assetResponse.headers.get("content-length") || 0);
      if (declaredLength > HTML_LIMIT) return new Response("Game document is too large", { status: 502 });
      const html = await assetResponse.text();
      if (new TextEncoder().encode(html).byteLength > HTML_LIMIT) return new Response("Game document is too large", { status: 502 });
      headers.set("content-type", "text/html; charset=utf-8");
      return new Response(injectShell(html, config), { status: assetResponse.status, headers });
    },
  };
}
