import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const required = ["dist/index.html", "bridge/dist/worker.js", "src-tauri/tauri.conf.json", "package-lock.json"];
for (const relative of required) { await access(resolve(root, relative)); }
const worker = await readFile(resolve(root, "bridge/dist/worker.js"), "utf8");
if (worker.includes("D:/pi-maestro-flow") || worker.includes("ownerToken") || /Bearer\\s+secret/i.test(worker)) throw new Error("Bundle contains a source checkout path or credential literal");
const config = JSON.parse(await readFile(resolve(root, "src-tauri/tauri.conf.json"), "utf8"));
if (!Array.isArray(config.bundle?.resources) || !config.bundle.resources.some((item) => String(item).includes("bridge/dist"))) throw new Error("Bridge resource is not declared in Tauri bundle");
console.log(JSON.stringify({ ok: true, checked: required, workerBytes: Buffer.byteLength(worker) }));
