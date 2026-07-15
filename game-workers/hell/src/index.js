import { createStaticGameWorker } from "../../shared/static-worker.js";
import hellApi from "./api.ts";

const staticWorker = createStaticGameWorker({
  slug: "hell",
  title: "Lindsay Graham In Hell",
  leaderboard: true,
  leaderboardUrl: "/hell/leaderboard/",
  async api(request, env) {
    const url = new URL(request.url);
    url.pathname = url.pathname.slice("/hell".length);
    if (url.pathname === "/api/guestbook") {
      const upstream = new URL(url.pathname + url.search, "https://lindsay-in-hell-leaderboard.novox-robot.workers.dev");
      return fetch(new Request(upstream, request));
    }
    return hellApi.fetch(new Request(url, request), env);
  },
});

export default staticWorker;
