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

const BOARD_DISPLAYS = new Set(["number", "integer", "percent", "time-ms", "record"]);
const BOARD_AGGREGATIONS = new Set(["best", "win-loss-rate"]);

function boardLabel(variant) {
  return String(variant).replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeBoard(board, fallbackDirection) {
  const variant = String(board?.variant || "default");
  const aggregation = BOARD_AGGREGATIONS.has(board?.aggregation) ? board.aggregation : "best";
  const direction = board?.direction === "asc" ? "asc" : board?.direction === "desc" ? "desc" : fallbackDirection;
  const display = BOARD_DISPLAYS.has(board?.display)
    ? board.display
    : aggregation === "win-loss-rate" ? "record" : "number";
  return {
    variant,
    label: String(board?.label || boardLabel(variant)).slice(0, 32),
    metric: String(board?.metric || "score").slice(0, 40),
    metricLabel: String(board?.metricLabel || "Score").slice(0, 60),
    direction,
    display,
    aggregation,
    minimumMatches: Math.max(1, Math.min(1_000, Math.floor(Number(board?.minimumMatches) || 1))),
  };
}

export function getLeaderboardConfig(game) {
  const config = game?.leaderboard || {};
  const fallbackDirection = config.direction === "asc" ? "asc" : "desc";
  const configuredBoards = Array.isArray(config.boards) && config.boards.length
    ? config.boards
    : (Array.isArray(config.variants) && config.variants.length ? config.variants : ["default"])
      .map((variant) => ({ variant, direction: fallbackDirection }));
  const boards = configuredBoards.map((board) => normalizeBoard(board, fallbackDirection));
  return {
    enabled: Boolean(config.enabled),
    direction: boards[0]?.direction || fallbackDirection,
    variants: boards.map((board) => board.variant),
    boards,
    scoreDisplay: config.scoreDisplay === "absolute" ? "absolute" : "raw",
  };
}
