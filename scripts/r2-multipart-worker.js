export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const key = url.searchParams.get("key");
    if (!key) return new Response("Missing key", { status: 400 });

    if (request.method === "POST" && url.pathname === "/create") {
      const upload = await env.GAME_ASSETS.createMultipartUpload(key, {
        httpMetadata: {
          contentType: request.headers.get("x-content-type") || "application/octet-stream",
          contentEncoding: request.headers.get("x-content-encoding") || undefined,
          cacheControl: "public, max-age=31536000, immutable",
        },
      });
      return Response.json({ uploadId: upload.uploadId });
    }

    const uploadId = url.searchParams.get("uploadId");
    if (!uploadId) return new Response("Missing uploadId", { status: 400 });
    const upload = env.GAME_ASSETS.resumeMultipartUpload(key, uploadId);
    if (request.method === "PUT" && url.pathname === "/part") {
      const partNumber = Number(url.searchParams.get("partNumber"));
      if (!Number.isInteger(partNumber) || partNumber < 1 || !request.body) return new Response("Invalid part", { status: 400 });
      const part = await upload.uploadPart(partNumber, request.body);
      return Response.json(part);
    }
    if (request.method === "POST" && url.pathname === "/complete") {
      const parts = await request.json();
      const object = await upload.complete(parts);
      return Response.json({ key: object.key, etag: object.etag, size: object.size });
    }
    if (request.method === "POST" && url.pathname === "/abort") {
      await upload.abort();
      return new Response(null, { status: 204 });
    }
    return new Response("Not found", { status: 404 });
  },
};
