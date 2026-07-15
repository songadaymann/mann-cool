import catalog from "../games.json" with { type: "json" };
import runtimeChecks from "../game-workers/runtime-checks.json" with { type: "json" };

const errors = [];
const results = [];
for (const game of catalog.games.filter((entry) => entry.status === "published")) {
  const canonical = `https://mann.cool/${game.slug}/`;
  try {
    const redirect = await fetch(`https://mann.cool/${game.slug}`, {
      redirect: "manual",
      headers: { "user-agent": "mann-cool-catalog-verifier/2.0" },
    });
    const redirectTarget = new URL(redirect.headers.get("location") || "", canonical);
    if (redirect.status !== 308 || redirectTarget.href !== canonical) {
      throw new Error(`canonical redirect returned ${redirect.status} ${redirect.headers.get("location") || ""}`.trim());
    }
    const response = await fetch(`${canonical}?catalog-check=${Date.now()}`, {
      redirect: "manual",
      headers: { "user-agent": "mann-cool-catalog-verifier/2.0" },
    });
    const type = response.headers.get("content-type") || "";
    if (response.status !== 200 || response.headers.get("location")) {
      throw new Error(`root returned ${response.status} ${response.headers.get("location") || ""}`.trim());
    }
    if (!type.includes("text/html")) throw new Error(`root content type is ${type}`);
    const html = await response.text();
    if (!html.includes("/platform/v1/game-shell.js")) throw new Error("shared v1 shell is missing");
    const candidates = [...html.matchAll(/\b(?:src|href|poster)=["']([^"']+)["']/gi)]
      .map((match) => match[1])
      .filter((value) => !/^(?:data:|blob:|#|javascript:|mailto:|https?:\/\/)/i.test(value))
      .map((value) => new URL(value, canonical))
      .filter((url) => url.hostname === "mann.cool" && url.pathname.startsWith(`/${game.slug}/`))
      .filter((url, index, all) => all.findIndex((item) => item.href === url.href) === index)
      .slice(0, 20);
    const assetChecks = [];
    for (const asset of candidates) {
      const assetResponse = await fetch(asset, { method: "HEAD", redirect: "manual", headers: { "user-agent": "mann-cool-catalog-verifier/2.0" } });
      if (assetResponse.status >= 300 && assetResponse.status < 400) {
        const location = assetResponse.headers.get("location");
        const redirected = location ? new URL(location, asset) : null;
        if (!redirected || redirected.origin !== new URL(canonical).origin || !redirected.pathname.startsWith(`/${game.slug}/`)) {
          throw new Error(`asset ${asset.pathname} escaped its canonical slug with ${assetResponse.status}`);
        }
        const finalResponse = await fetch(redirected, { method: "HEAD", redirect: "manual", headers: { "user-agent": "mann-cool-catalog-verifier/2.0" } });
        if (finalResponse.status < 200 || finalResponse.status >= 300 || finalResponse.headers.get("location")) {
          throw new Error(`asset redirect ${redirected.pathname} returned ${finalResponse.status}`);
        }
        await finalResponse.body?.cancel();
      } else if (assetResponse.status < 200 || assetResponse.status >= 300 || assetResponse.headers.get("location")) {
        throw new Error(`asset ${asset.pathname} returned ${assetResponse.status}`);
      }
      assetChecks.push(asset.pathname);
      await assetResponse.body?.cancel();
    }
    const check = runtimeChecks[game.slug];
    if (!check) throw new Error("runtime verification manifest is missing");
    for (const relative of [...(check.paths || []), ...(check.deepLinks || [])]) {
      const target = new URL(relative, canonical);
      const runtimeResponse = await fetch(target, { method: "HEAD", redirect: "follow", headers: { "user-agent": "mann-cool-catalog-verifier/2.0" } });
      if (runtimeResponse.status < 200 || runtimeResponse.status >= 300) throw new Error(`runtime path ${target.pathname} returned ${runtimeResponse.status}`);
      if (runtimeResponse.url && !new URL(runtimeResponse.url).pathname.startsWith(`/${game.slug}/`)) throw new Error(`runtime path ${target.pathname} escaped the canonical slug`);
      if (runtimeResponse.headers.get("x-mann-cool-delivery") !== "dedicated-worker") throw new Error(`runtime path ${target.pathname} did not use its dedicated Worker`);
      assetChecks.push(target.pathname);
      await runtimeResponse.body?.cancel();
    }
    const rangeChecks = [];
    for (const relative of check.ranges || []) {
      const target = new URL(relative, canonical);
      const rangeResponse = await fetch(target, { headers: { range: "bytes=0-1023", "accept-encoding": "br, gzip", "user-agent": "mann-cool-catalog-verifier/2.0" } });
      const contentRange = rangeResponse.headers.get("content-range") || "";
      if (rangeResponse.status !== 206 || !/^bytes 0-1023\/\d+$/.test(contentRange)) throw new Error(`range path ${target.pathname} returned ${rangeResponse.status} ${contentRange}`.trim());
      if (rangeResponse.headers.get("x-mann-cool-delivery") !== "dedicated-worker") throw new Error(`range path ${target.pathname} did not use its dedicated Worker`);
      rangeChecks.push(target.pathname);
      await rangeResponse.body?.cancel();
    }
    results.push({ slug: game.slug, delivery: response.headers.get("x-mann-cool-delivery") || "existing-route", assets: [...new Set(assetChecks)], ranges: rangeChecks });
  } catch (error) {
    errors.push(`${game.slug}: ${error.message}`);
  }
}

const publishedSlugs = new Set(catalog.games.filter((entry) => entry.status === "published").map((entry) => entry.slug));
for (const slug of Object.keys(runtimeChecks)) if (!publishedSlugs.has(slug)) errors.push(`${slug}: runtime verification manifest has no published catalog game`);

console.log(JSON.stringify(results, null, 2));
if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}
console.log(`Verified ${results.length} canonical game roots.`);
