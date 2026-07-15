const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "Content-Type, Idempotency-Key",
};

export function json(data, init = {}) {
  const headers = new Headers(JSON_HEADERS);
  for (const [key, value] of Object.entries(init.headers || {})) {
    headers.set(key, value);
  }
  return Response.json(data, { ...init, headers });
}

export function options() {
  return new Response(null, { status: 204, headers: JSON_HEADERS });
}

export async function readJson(request, maxBytes = 8_192) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "Content-Type must be application/json");
  }

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) {
    throw new HttpError(413, "Request body is too large");
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new HttpError(413, "Request body is too large");
  }

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function cleanText(value, maxLength) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function cleanSlug(value) {
  const slug = String(value || "").toLowerCase().trim();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : "";
}

export function cleanSource(value) {
  const source = String(value || "direct").toLowerCase().trim();
  return /^[a-z0-9][a-z0-9._-]{0,39}$/.test(source) ? source : "direct";
}

export async function hashIdentity(value, salt = "mann.cool") {
  const bytes = new TextEncoder().encode(`${salt}:${value || "unknown"}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
