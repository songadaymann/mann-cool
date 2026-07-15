import catalog from "../games.json" with { type: "json" };

const errors = [];
const results = [];
for (const game of catalog.games.filter((entry) => entry.status === "published")) {
  const canonical = `https://mann.cool/${game.slug}/`;
  try {
    const response = await fetch(`${canonical}?catalog-check=${Date.now()}`, {
      redirect: "manual",
      headers: { "user-agent": "mann-cool-catalog-verifier/1.0" },
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
      .slice(0, 2);
    const assetChecks = [];
    for (const asset of candidates) {
      const assetResponse = await fetch(asset, { redirect: "manual", headers: { "user-agent": "mann-cool-catalog-verifier/1.0" } });
      if (assetResponse.status < 200 || assetResponse.status >= 300 || assetResponse.headers.get("location")) {
        throw new Error(`asset ${asset.pathname} returned ${assetResponse.status}`);
      }
      assetChecks.push(asset.pathname);
      await assetResponse.body?.cancel();
    }
    results.push({ slug: game.slug, delivery: response.headers.get("x-mann-cool-delivery") || "existing-route", assets: assetChecks });
  } catch (error) {
    errors.push(`${game.slug}: ${error.message}`);
  }
}

console.log(JSON.stringify(results, null, 2));
if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}
console.log(`Verified ${results.length} canonical game roots.`);
