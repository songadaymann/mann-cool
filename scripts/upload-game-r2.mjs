import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const slugs = process.argv.slice(2);
if (!slugs.length) throw new Error("Pass one or more staged slugs to upload");

for (const slug of slugs) {
  const manifestPath = path.join(root, "game-workers", slug, ".stage-r2.json");
  const entries = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  for (const entry of entries) {
    if (entry.size > 300 * 1024 * 1024) {
      console.log(`${slug}: skipping ${entry.relativePath}; multipart upload required`);
      continue;
    }
    const args = ["r2", "object", "put", `mann-cool-game-assets/${slug}/${entry.relativePath}`, "--remote", "--file", entry.source, "--content-type", entry.contentType, "--cache-control", "public, max-age=31536000, immutable", "--force"];
    if (entry.contentEncoding) args.push("--content-encoding", entry.contentEncoding);
    const result = spawnSync("wrangler", args, { stdio: "inherit" });
    if (result.status !== 0) throw new Error(`${slug}: R2 upload failed for ${entry.relativePath}`);
  }
  console.log(`${slug}: processed ${entries.length} oversized R2 asset(s)`);
}
