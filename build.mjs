/** Bundles the chat sidebar (React + pi) into dist/chat.js. */
import * as esbuild from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");

const context = await esbuild.context({
  entryPoints: { chat: join(root, "src/chat/main.tsx") },
  bundle: true,
  platform: "browser",
  format: "iife",
  outdir: join(root, "dist"),
  jsx: "automatic",
  sourcemap: watch ? "inline" : false,
  minify: !watch,
  logLevel: "info",
  define: {
    "process.env.NODE_ENV": watch ? '"development"' : '"production"',
  },
  // pi-ai probes optional node builtins behind runtime guards; keep them
  // external so esbuild doesn't try to resolve them for the browser.
  external: ["node:*"],
});

if (watch) {
  await context.watch();
  console.log("watching…");
} else {
  await context.rebuild();
  await context.dispose();
  console.log("build complete → dist/chat.js");
}
