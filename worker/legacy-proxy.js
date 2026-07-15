import { getDeliveryConfig } from "./lib/catalog.js";

const HTML_LIMIT_BYTES = 5 * 1024 * 1024;

function upstreamUrlFor(requestUrl, game) {
  const delivery = getDeliveryConfig(game);
  const origin = new URL(delivery.origin || game.gameUrl);
  const prefix = `/${game.slug}`;
  const strippedPath = requestUrl.pathname.slice(prefix.length) || "/";

  if ((strippedPath === "/" || strippedPath === "") && delivery.entryPath) {
    origin.pathname = delivery.entryPath;
  } else {
    const basePath = delivery.basePath ? `/${String(delivery.basePath).replace(/^\/+|\/+$/g, "")}` : "";
    origin.pathname = `${basePath}${strippedPath}`.replace(/\/{2,}/g, "/");
  }
  origin.search = requestUrl.search;
  return origin;
}

function rewriteLocation(location, upstream, game, requestUrl) {
  const target = new URL(location, upstream);
  if (target.origin !== upstream.origin) return target.toString();
  return new URL(`/${game.slug}${target.pathname}${target.search}${target.hash}`, requestUrl.origin).toString();
}

function rewriteHtml(html, game) {
  const prefix = `/${game.slug}/`;
  const escapedSlug = game.slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let rewritten = html
    .replace(/<base\b[^>]*>/gi, "")
    .replace(/\b(href|src|action|poster)=(['"])\/(?!\/)/gi, `$1=$2${prefix}`)
    .replace(/\bsrcset=(['"])([^'"]+)\1/gi, (match, quote, value) => {
      const next = value.replace(/(^|,\s*)\/(?!\/)/g, `$1${prefix}`);
      return `srcset=${quote}${next}${quote}`;
    })
    .replace(/url\((['"]?)\/(?!\/)/gi, `url($1${prefix}`)
    .replace(new RegExp(`(${prefix})${escapedSlug}/`, "g"), prefix);

  const shell = [
    `<base href="${prefix}">`,
    `<script src="/platform/v1/game-shell.js"`,
    ` data-slug="${game.slug}"`,
    ` data-title="${String(game.title).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`,
    ` data-leaderboard="${game.leaderboard?.enabled ? "true" : "false"}" defer></script>`,
  ].join("");

  if (/<head\b[^>]*>/i.test(rewritten)) {
    rewritten = rewritten.replace(/<head\b([^>]*)>/i, `<head$1>${shell}`);
  } else {
    rewritten = `${shell}${rewritten}`;
  }
  return rewritten;
}

function proxyHeaders(upstreamHeaders) {
  const headers = new Headers(upstreamHeaders);
  for (const name of [
    "content-length",
    "content-security-policy",
    "content-security-policy-report-only",
    "x-frame-options",
    "clear-site-data",
    "report-to",
    "nel",
  ]) {
    headers.delete(name);
  }
  headers.set("x-mann-cool-delivery", "legacy-proxy");
  return headers;
}

export async function proxyLegacyGame(request, game) {
  const requestUrl = new URL(request.url);
  const upstreamUrl = upstreamUrlFor(requestUrl, game);
  const upstreamRequest = new Request(upstreamUrl, request);
  const upstreamResponse = await fetch(upstreamRequest, { redirect: "manual" });
  const headers = proxyHeaders(upstreamResponse.headers);

  if (upstreamResponse.status >= 300 && upstreamResponse.status < 400) {
    const location = upstreamResponse.headers.get("location");
    if (location) headers.set("location", rewriteLocation(location, upstreamUrl, game, requestUrl));
    return new Response(null, { status: upstreamResponse.status, headers });
  }

  const contentType = upstreamResponse.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("text/html")) {
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers,
    });
  }

  const declaredLength = Number(upstreamResponse.headers.get("content-length") || 0);
  if (declaredLength > HTML_LIMIT_BYTES) {
    return new Response("Upstream game document is too large to rewrite", { status: 502 });
  }
  const html = await upstreamResponse.text();
  if (new TextEncoder().encode(html).byteLength > HTML_LIMIT_BYTES) {
    return new Response("Upstream game document is too large to rewrite", { status: 502 });
  }
  headers.set("content-type", "text/html; charset=utf-8");
  return new Response(rewriteHtml(html, game), {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers,
  });
}
