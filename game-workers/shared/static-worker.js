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
  return `<script src="https://mann.cool/platform/v1/game-shell.js" data-slug="${config.slug}" data-title="${config.title.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}" data-leaderboard="${config.leaderboard ? "true" : "false"}"${leaderboardUrl} defer></script>`;
}

function injectShell(html, config) {
  if (html.includes("/platform/v1/game-shell.js")) return html;
  const shell = gameShell(config);
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${shell}</head>`) : `${shell}${html}`;
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
      const headers = responseHeaders(assetResponse.headers);
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
