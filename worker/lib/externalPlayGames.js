// Play counts for independently hosted games; this is not a homepage/route entry.
const externalPlayGames = new Map([
  ["wamp", {
    slug: "wamp",
    title: "WAMP",
    status: "hidden",
    canonicalUrl: "https://wamp.land/",
    sourceUrl: "https://github.com/songadaymann/wamp",
    leaderboard: { enabled: false, direction: "desc" },
  }],
]);

export function getExternalPlayGame(slug) {
  return externalPlayGames.get(slug) || null;
}
