import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env";
import { fetchEvents } from "./clickhouse";
import { getRecallDetail, isValidRecallId } from "./recalls";

loadEnv();

const PORT = Number(process.env.PORT ?? 3000);
const DIST = fileURLToPath(new URL("../dist", import.meta.url));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

async function serveStatic(res: import("node:http").ServerResponse, urlPath: string) {
  let rel = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  if (rel === "/") rel = "/index.html";
  const filePath = normalize(join(DIST, rel));

  // Evita path traversal fuera de dist/.
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403);
    res.end();
    return;
  }

  try {
    const s = await stat(filePath);
    if (s.isDirectory()) throw new Error("dir");
    const buf = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream" });
    res.end(buf);
  } catch {
    // SPA fallback -> index.html
    try {
      const buf = await readFile(join(DIST, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(buf);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(
        "Dashboard sin compilar. Corre:  npm run build -w @farmavigia/dashboard",
      );
    }
  }
}

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";
  try {
    if (url.startsWith("/api/events")) {
      const data = await fetchEvents();
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(data));
      return;
    }
    if (url.startsWith("/api/recall/")) {
      const id = decodeURIComponent(url.slice("/api/recall/".length).split("?")[0] ?? "");
      if (!isValidRecallId(id)) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "recall id inválido" }));
        return;
      }
      const detail = await getRecallDetail(id);
      if (!detail) {
        res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "recall no encontrado" }));
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      });
      res.end(JSON.stringify(detail));
      return;
    }
    if (url.startsWith("/healthz")) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }
    await serveStatic(res, url);
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: (e as Error).message }));
  }
});

server.listen(PORT, () => {
  console.log(`📊 FarmacoVigía dashboard en http://localhost:${PORT}`);
});
