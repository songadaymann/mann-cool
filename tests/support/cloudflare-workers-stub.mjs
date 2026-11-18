// The Workers runtime module "cloudflare:workers" does not exist in Node; the tests bundle the Worker with this
// stand-in so its named entrypoints (worker/game-results.js) can be constructed and called directly.
export const cloudflareWorkersStub = {
  name: "cloudflare-workers-stub",
  setup(build) {
    build.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: "cloudflare:workers", namespace: "cf-stub" }));
    build.onLoad({ filter: /.*/, namespace: "cf-stub" }, () => ({
      contents: "export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }",
      loader: "js",
    }));
  },
};
