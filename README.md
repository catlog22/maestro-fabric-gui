# Maestro Fabric GUI

Standalone Tauri desktop control surface for Maestro Gateway and Fabric.

## Current scope

This application is a focused **Maestro Gateway Console**. Its primary jobs are:

- Start, stop, restart, and inspect the Gateway process.
- Monitor sanitized Gateway logs and resynchronize when event continuity is degraded.
- Register, renew, bind, and remove Gateway-managed workspaces.
- Switch the console between English and Simplified Chinese; the default follows the system language.

Advanced Fabric and Gateway tools remain available under the collapsed **Advanced tools** section, but they are intentionally secondary to the Gateway operations workflow.

- Gateway profiles with independent connection generations and capability manifests.
- Local Gateway lifecycle, pairing, connector, tunnel and workspace registry controls.
- Three-layer workspace topology: authorized workspace, local registry workspace, Fabric binding.
- Typed Gateway pages for Board, Host, Exec, Job, File, Session, Monitor, Todo, Teammate, Handoff, Skill, Maestro CLI and Browser.
- Fabric Device, Workspace, Endpoint and Route control with revision/generation fencing.
- Fabric monitor snapshot validation, push event buffering, cursor/gap recovery and bounded activity.
- Tauri single-instance/tray behavior and OS credential-store references.

## Security model

The React WebView never receives owner tokens, bearer tokens, pairing secrets or route proofs. Tauri resolves a credential reference through the OS credential store and injects the secret only into the supervised bridge request. The bridge has a fixed action/tool registry: it does not expose arbitrary shell commands, arbitrary files, or arbitrary MCP tool names. Remote Gateway URLs must use HTTPS; only loopback may use HTTP.

High-risk actions such as `exec`, file mutation, browser `run`, knowledge staging, tunnel changes and destructive Fabric actions require explicit UI confirmation and remain subject to Gateway scopes. Revision/generation conflicts are reported and never replayed automatically.

## Workspace model

The GUI keeps these records separate:

1. **Authorized workspace** — policy-visible workspace returned by Gateway.
2. **Local registry workspace** — Gateway lease/permanent registry entry with TTL and generation.
3. **Fabric binding** — connection/device/workspace binding with revision, generation and expiry.

Expired, orphaned, unauthorized or unknown records are not projected as online.

## Development

Requirements: Node.js 22+, npm, Rust stable and Tauri 2 platform prerequisites.

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run verify:package
npm run tauri dev
```

### GitHub builds and releases

Every push and pull request runs the Windows verification workflow and uploads the generated web package as a short-lived artifact. A release is built when a semantic-version tag is pushed, for example:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The release workflow checks that the tag matches the versions in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`, then builds Tauri installers independently on Ubuntu, Windows, and macOS. It creates a draft GitHub Release with the installers attached; review and publish the draft from GitHub after the matrix completes. The repository needs Actions enabled and the default `GITHUB_TOKEN` write permission for releases.

The standalone package currently uses wire-level Fabric DTOs because `pi-maestro-fabric-core@0.1.0` is not published on npm. It does not import `D:/pi-maestro-flow` source files. Unsupported upstream capabilities fail closed and are shown as unavailable rather than bypassing Gateway policy.
