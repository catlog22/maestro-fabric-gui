import { rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";

await rm(new URL("../bridge/dist/", import.meta.url), { recursive: true, force: true });
const result = spawnSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "bridge/tsconfig.json"], { stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
await build({
  entryPoints: ["bridge/src/worker.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "bridge/dist/worker.js",
  logLevel: "info",
});
