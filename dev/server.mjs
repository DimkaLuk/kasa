// Локальний сервер для розробки: статика + API з даними в dev/data.json
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { handle } from "../netlify/lib/core.mjs";

const root = path.resolve("public");
const dataFile = path.resolve("dev/data.json");
const store = {
  async get() { try { return JSON.parse(await fs.readFile(dataFile, "utf8")); } catch { return null; } },
  async setJSON(key, v) { if (key === "db") await fs.writeFile(dataFile, JSON.stringify(v)); },
};
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await handle(new Request(url, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined }), store, process.env.APP_PASSWORD || "1234");
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(await r.text()); return;
  }
  const file = path.join(root, url.pathname === "/" ? "index.html" : url.pathname);
  try { const b = await fs.readFile(file); res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" }); res.end(b); }
  catch { res.writeHead(404); res.end("404"); }
}).listen(process.env.PORT || 8888, () => console.log("http://localhost:" + (process.env.PORT || 8888)));
