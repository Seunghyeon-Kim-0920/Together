import react from "@vitejs/plugin-react";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

// PDF fonts, character maps and decoders must remain available without a network.
function offlinePdfResources(): Plugin {
  const require = createRequire(import.meta.url);
  const pdfRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
  const directories = new Set(["cmaps", "standard_fonts", "wasm"]);
  const prefix = "/pdf-resources/";
  const mimeTypes: Record<string, string> = { ".wasm": "application/wasm", ".ttf": "font/ttf", ".otf": "font/otf", ".js": "text/javascript" };
  return {
    name: "offline-pdf-resources",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith(prefix)) return next();
        let relative: string;
        try { relative = decodeURIComponent(request.url.split("?")[0].slice(prefix.length)); }
        catch { response.statusCode = 400; response.end(); return; }
        const parts = relative.split("/");
        if (!directories.has(parts[0]) || parts.some((part) => !part || part === "." || part === ".." || part.includes("\\") || part.includes("\0"))) {
          response.statusCode = 404; response.end(); return;
        }
        if (request.method !== "GET" && request.method !== "HEAD") { response.statusCode = 405; response.end(); return; }
        try {
          const content = await readFile(path.join(pdfRoot, ...parts));
          response.setHeader("Content-Type", mimeTypes[path.extname(relative)] ?? "application/octet-stream");
          response.setHeader("Content-Length", content.length);
          response.setHeader("Cache-Control", "public, max-age=3600");
          response.end(request.method === "HEAD" ? undefined : content);
        } catch { response.statusCode = 404; response.end(); }
      });
    },
    async generateBundle() {
      const visit = async (relative: string): Promise<void> => {
        const entries = await readdir(path.join(pdfRoot, relative), { withFileTypes: true });
        await Promise.all(entries.map(async (entry) => {
          const file = relative + "/" + entry.name;
          if (entry.isDirectory()) return visit(file);
          if (entry.isFile()) this.emitFile({ type: "asset", fileName: "pdf-resources/" + file, source: await readFile(path.join(pdfRoot, file)) });
        }));
      };
      await Promise.all([...directories].map(visit));
    },
  };
}

export default defineConfig({
  plugins: [react(), offlinePdfResources()],
  build: {
    target: "es2022",
  },
});
