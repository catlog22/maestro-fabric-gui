import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const tag = process.env.RELEASE_TAG ?? process.argv[2];
if (!tag) throw new Error("RELEASE_TAG or a release tag argument is required");

const expected = tag.replace(/^v/, "");
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const tauriConfig = JSON.parse(await readFile(resolve(root, "src-tauri/tauri.conf.json"), "utf8"));
const cargoToml = await readFile(resolve(root, "src-tauri/Cargo.toml"), "utf8");
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const versions = {
  package: packageJson.version,
  tauri: tauriConfig.version,
  cargo: cargoVersion,
};

const mismatches = Object.entries(versions).filter(([, version]) => version !== expected);
if (mismatches.length > 0) {
  throw new Error(`Release tag ${tag} does not match ${JSON.stringify(Object.fromEntries(mismatches))}; expected ${expected}`);
}

console.log(JSON.stringify({ ok: true, tag, version: expected }));
