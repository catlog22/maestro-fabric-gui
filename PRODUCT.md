# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Solo developer running their own local Maestro Gateway and Fabric on their own machine. Uses the console occasionally — opens it to start/stop/check the gateway, register or bind a workspace, run an advanced tool, then closes it.

## Product Purpose

Standalone Tauri desktop control surface ("Maestro Gateway Console") for Maestro Gateway and Fabric. Its primary jobs: start/stop/restart/inspect the Gateway process; monitor sanitized Gateway logs with resync on degraded continuity; register/renew/bind/remove Gateway-managed workspaces. Success means a developer can operate and observe their local gateway confidently without touching a terminal.

## Positioning

A security-first local operations console: the React WebView never holds tokens or pairing secrets — the OS credential store injects secrets only into supervised bridge requests, and the bridge exposes a fixed action/tool registry (no arbitrary shell, files, or MCP tools). Remote Gateway URLs must be HTTPS; only loopback may use HTTP. High-risk actions (exec, file mutation, browser run, knowledge staging, tunnel changes, destructive Fabric actions) require explicit UI confirmation and stay subject to Gateway scopes. Revision/generation conflicts are reported and never replayed automatically.

## Operating Context

Local desktop use on the developer's own machine (Windows/macOS/Linux via Tauri 2). Three-layer workspace model kept distinct in the UI: authorized workspace (Gateway policy-visible), local registry workspace (lease/permanent, TTL + generation), Fabric binding (revision, generation, expiry). Expired/orphaned/unauthorized records are never projected as online. Occasional-control usage: the console must orient the user fast on open — current gateway state, profile, workspace count — and confirm actions cleanly on exit.

## Capabilities and Constraints

- React 19 + TypeScript + Vite frontend inside a Tauri WebView; no component library; plain CSS custom-property theming.
- Bilingual EN / 简体中文; default follows system language. Theme: system / light / dark.
- Confirmed product functions (must keep working): gateway lifecycle controls, profile connect/disconnect, sanitized live logs with cursor/gap recovery, workspace register/renew/bind/remove/unbind, Fabric device/endpoint/route control with revision-generation fencing, typed Gateway tools (Board, Host, Exec, Jobs, Files, Sessions, Todos, Teammates, Handoffs, Skills, Knowledge, Browser), connector and tunnel diagnostics.
- Explicit confirmations on high-risk actions are a product commitment, not a style choice.
- Native file/folder picker via `tauri-plugin-dialog` is approved for path fields (workspace registration, Files tool).

## Brand Commitments

Name: "Maestro Fabric GUI" / title "Maestro Gateway Console". The "M" brand mark exists. No other confirmed brand assets.

## Evidence on Hand

Working application: sidebar shell, dashboard hero + console cards + metrics, panels for Gateway/Activity/Workspaces/Fabric/tools, EN+ZH i18n dictionary, light/dark themes. No DESIGN.md; the incumbent look is evidence, not authority.

## Product Principles

- Operator truth first: every state the gateway can be in must be visible and unambiguous (readiness, degraded logs, revision conflicts).
- Fail closed: unsupported capabilities render as unavailable; errors are surfaced, never swallowed.
- Power without exposure: advanced tools stay reachable but secondary to the gateway operations workflow.
- Density with discipline: pro control-surface register — compact and precise, never cramped or cryptic.
