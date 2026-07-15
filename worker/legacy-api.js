const API_HANDLERS = {
  "clickstr": () => import("../api/clickstr.js"),
  "clickstr-admin-reset": () => import("../api/clickstr-admin-reset.js"),
  "clickstr-claim-signature": () => import("../api/clickstr-claim-signature.js"),
  "clickstr-eligible": () => import("../api/clickstr-eligible.js"),
  "clickstr-v2": () => import("../api/clickstr-v2.js"),
};

function applyEnv(env) {
  const nextEnv = { ...(globalThis.process?.env || {}) };
  for (const [key, value] of Object.entries(env || {})) {
    if (typeof value === "string") nextEnv[key] = value;
  }
  globalThis.process = { ...(globalThis.process || {}), env: nextEnv };
}

function createResponseShim() {
  const headers = new Headers();
  let statusCode = 200;
  let body = "";
  const shim = {
    setHeader(name, value) { headers.set(name, value); return shim; },
    status(code) { statusCode = code; return shim; },
    json(data) { headers.set("content-type", "application/json; charset=utf-8"); body = JSON.stringify(data); return shim; },
    end(data = "") { body = data; return shim; },
    toResponse() { return new Response(body, { status: statusCode, headers }); },
  };
  return shim;
}

async function parseBody(request) {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    const text = await request.text();
    return text ? JSON.parse(text) : {};
  }
  if (type.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries((await request.formData()).entries());
  }
  return undefined;
}

export async function handleLegacyApi(request, env, apiName) {
  const loadHandler = API_HANDLERS[apiName];
  if (!loadHandler) return Response.json({ error: "API route not found" }, { status: 404 });
  applyEnv(env);
  const url = new URL(request.url);
  const req = {
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    query: Object.fromEntries(url.searchParams.entries()),
    body: await parseBody(request.clone()),
    socket: { remoteAddress: request.headers.get("cf-connecting-ip") || "" },
  };
  const res = createResponseShim();
  const mod = await loadHandler();
  await mod.default(req, res);
  return res.toResponse();
}
