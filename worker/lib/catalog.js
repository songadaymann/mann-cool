import gamesData from "../../games.json";

export const games = gamesData.games;
export const gamesBySlug = new Map(games.map((game) => [game.slug, game]));
export const gamesByApiSlug = new Map(games.flatMap((game) => [
  [game.slug, game],
  ...((game.leaderboard?.apiAliases || []).map((alias) => [alias, game])),
]));

export function getGame(slug) {
  return gamesBySlug.get(String(slug || "").toLowerCase()) || null;
}

export function getGameByApiSlug(slug) {
  return gamesByApiSlug.get(String(slug || "").toLowerCase()) || null;
}

export function getGameStatus(game) {
  if (game.status) return game.status;
  if (game.hidden) return "hidden";
  return "published";
}

export function getLeaderboardConfig(game) {
  const config = game?.leaderboard || {};
  return {
    enabled: Boolean(config.enabled),
    direction: config.direction === "asc" ? "asc" : "desc",
    variants: Array.isArray(config.variants) && config.variants.length
      ? config.variants
      : ["default"],
    scoreDisplay: config.scoreDisplay === "absolute" ? "absolute" : "raw",
  };
}
