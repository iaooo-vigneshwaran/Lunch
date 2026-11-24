import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = resolve(process.env.LUNCH_WEB_DIR ?? join(root, "dist", "web"));
const sourceConfig = resolve(process.env.LUNCH_FIREBASE_CONFIG ?? join(root, "firebase-config.json"));
let config = null;
try {
  config = JSON.parse(await readFile(sourceConfig, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT" || process.env.LUNCH_FIREBASE_CONFIG) throw error;
}
if (config !== null) {
  const options = config.firebase;
  if (!options || ["apiKey", "authDomain", "projectId", "appId"].some((key) =>
    typeof options[key] !== "string" || !options[key].trim())) {
    throw new Error("Firebase web configuration needs apiKey, authDomain, projectId, and appId.");
  }
}

await mkdir(output, { recursive: true });
await Promise.all([
  build({
    absWorkingDir: root,
    entryPoints: ["src/app.ts"],
    outdir: output,
    chunkNames: "chunks/[name]-[hash]",
    bundle: true,
    splitting: true,
    format: "esm",
    target: "es2022",
    minify: true,
  }),
  copyFile(join(root, "public", "index.html"), join(output, "index.html")),
  copyFile(join(root, "public", "styles.css"), join(output, "styles.css")),
  writeFile(join(output, "firebase-config.json"), JSON.stringify(config) + "\n"),
]);
