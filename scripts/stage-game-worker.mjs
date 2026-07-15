import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projects = path.resolve(root, "../..");
const sourceMap = JSON.parse(fs.readFileSync(path.join(root, "game-workers/source-map.json"), "utf8"));
const slugs = process.argv.slice(2);
if (!slugs.length) throw new Error("Pass one or more slugs to stage");
const STATIC_LIMIT = 25 * 1024 * 1024;
const ignoredDirectories = new Set([".git", ".claude", ".cursor", ".godot", ".vercel", "node_modules", "llm-chats", "human-materials", "human-materials-ignore", "human-stuff-ignore", "test-results"]);
const ignoredFiles = new Set([".DS_Store", "games.json", "agents.md", "AGENTS.md", "GAME_INTEGRATION.md"]);

function shouldCopy(source) {
  const name = path.basename(source);
  if (name.startsWith(".")) return false;
  if (ignoredDirectories.has(name) || ignoredFiles.has(name)) return false;
  if (/\.(?:md|blend|fbx|rar|zip|unitypackage)$/i.test(name)) return false;
  if (/^(?:test|debug)[^/]*\.html$/i.test(name)) return false;
  return true;
}

function metadata(relativePath) {
  const lower = relativePath.toLowerCase();
  const encoding = lower.endsWith(".br") ? "br" : lower.endsWith(".gz") ? "gzip" : null;
  const uncompressed = lower.replace(/\.(?:br|gz)$/, "");
  const ext = path.extname(uncompressed);
  const types = {
    ".wasm": "application/wasm", ".js": "text/javascript", ".json": "application/json",
    ".data": "application/octet-stream", ".pck": "application/octet-stream", ".mp4": "video/mp4",
    ".webm": "video/webm", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".png": "image/png",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  };
  return { contentType: types[ext] || "application/octet-stream", contentEncoding: encoding };
}

function rewriteForSlug(stage, slug, roots) {
  if (!roots?.length) return;
  const escaped = roots.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`/(?=${escaped.join("|")})(?!${slug}/)`, "g");
  const textExtensions = new Set([".html", ".js", ".css", ".json", ".txt", ".xml", ".webmanifest"]);
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && textExtensions.has(path.extname(entry.name).toLowerCase()) && fs.statSync(target).size < 8 * 1024 * 1024) {
        const original = fs.readFileSync(target, "utf8");
        const rewritten = original.replace(pattern, `/${slug}/`);
        if (rewritten !== original) fs.writeFileSync(target, rewritten);
      }
    }
  };
  visit(stage);
}

for (const slug of slugs) {
  const config = sourceMap[slug];
  if (!config) throw new Error(`No source mapping for ${slug}`);
  if (config.build) execSync(config.build, { cwd: path.join(projects, config.buildCwd), stdio: "inherit" });
  const sourceRoot = path.join(projects, config.assets);
  if (!fs.existsSync(path.join(sourceRoot, "index.html"))) throw new Error(`${slug}: missing index.html in ${sourceRoot}`);
  const workerDir = path.join(root, "game-workers", slug);
  const stage = path.join(workerDir, ".stage");
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  const large = [];
  const copyOptions = {
    recursive: true,
    dereference: false,
    filter(source) {
      if (!shouldCopy(source)) return false;
      const stat = fs.lstatSync(source);
      if (stat.isSymbolicLink()) return false;
      if (stat.isFile() && stat.size > STATIC_LIMIT) {
        const relativePath = path.relative(sourceRoot, source).split(path.sep).join("/");
        large.push({ relativePath, source, size: stat.size, ...metadata(relativePath) });
        return false;
      }
      return true;
    },
  };
  if (config.include?.length) {
    for (const relative of config.include) {
      const source = path.join(sourceRoot, relative);
      const destination = path.join(stage, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.cpSync(source, destination, copyOptions);
    }
  } else {
    fs.cpSync(sourceRoot, stage, copyOptions);
  }
  rewriteForSlug(stage, slug, config.rewriteRoots);
  fs.writeFileSync(path.join(workerDir, ".stage-r2.json"), `${JSON.stringify(large, null, 2)}\n`);
  console.log(`${slug}: staged assets; ${large.length} oversized file(s) reserved for R2`);
}
