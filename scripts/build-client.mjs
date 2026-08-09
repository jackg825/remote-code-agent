import { build } from "esbuild";

await build({
  entryPoints: { app: "src/client.ts" },
  outdir: "public",
  bundle: true,
  format: "esm",
  minify: process.env.NODE_ENV === "production",
  sourcemap: true,
  target: ["safari16.4", "chrome110"],
  logLevel: "info",
});
