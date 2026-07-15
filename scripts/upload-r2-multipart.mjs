import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [slug, relativePath] = process.argv.slice(2);
if (!slug || !relativePath) throw new Error("Usage: node scripts/upload-r2-multipart.mjs SLUG RELATIVE_PATH");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "game-workers", slug, ".stage-r2.json"), "utf8"));
const entry = manifest.find((item) => item.relativePath === relativePath);
if (!entry) throw new Error(`No staged R2 entry for ${slug}/${relativePath}`);
const base = "http://127.0.0.1:8799";
const key = `${slug}/${relativePath}`;
const create = await fetch(`${base}/create?key=${encodeURIComponent(key)}`, {
  method: "POST",
  headers: {
    "x-content-type": entry.contentType,
    ...(entry.contentEncoding ? { "x-content-encoding": entry.contentEncoding } : {}),
  },
});
if (!create.ok) throw new Error(`Multipart create failed: ${create.status} ${await create.text()}`);
const { uploadId } = await create.json();
const partSize = 32 * 1024 * 1024;
const handle = fs.openSync(entry.source, "r");
const parts = [];
try {
  for (let offset = 0, partNumber = 1; offset < entry.size; offset += partSize, partNumber += 1) {
    const length = Math.min(partSize, entry.size - offset);
    const bytes = Buffer.allocUnsafe(length);
    fs.readSync(handle, bytes, 0, length, offset);
    const response = await fetch(`${base}/part?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}&partNumber=${partNumber}`, { method: "PUT", body: bytes });
    if (!response.ok) throw new Error(`Part ${partNumber} failed: ${response.status} ${await response.text()}`);
    parts.push(await response.json());
    console.log(`${slug}: uploaded part ${partNumber}/${Math.ceil(entry.size / partSize)}`);
  }
  const complete = await fetch(`${base}/complete?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(parts),
  });
  if (!complete.ok) throw new Error(`Multipart complete failed: ${complete.status} ${await complete.text()}`);
  console.log(await complete.text());
} catch (error) {
  await fetch(`${base}/abort?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}`, { method: "POST" }).catch(() => {});
  throw error;
} finally {
  fs.closeSync(handle);
}
