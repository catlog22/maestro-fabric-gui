import { rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";

await rm(new URL("../bridge/dist/", import.meta.url), { recursive: true, force: true });
const result = spawnSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "bridge/tsconfig.json"], { stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
const bundle = spawnSync(process.execPath, ["node_modules/esbuild/bin/esbuild", "bridge/src/worker.ts", "--bundle", "--platform=node", "--format=esm", "--target=node22", "--outfile=bridge/dist/worker.js"], { stdio: "inherit" });
if (bundle.status !== 0) process.exit(bundle.status ?? 1);
