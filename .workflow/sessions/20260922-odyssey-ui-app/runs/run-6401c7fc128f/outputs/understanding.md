# UI Odyssey — 深入优化当前 App 界面与交互逻辑

## 1. Target & Design Context

- **Target**: `src/` — the entire React frontend of the Maestro Gateway Console (Tauri 2 desktop app, occasional-use local ops console).
- **Stack**: React 19 + TypeScript + Vite; no component library; plain CSS custom-property theming; bilingual EN/简体中文; theme system/light/dark.
- **UI surface**: `App.tsx` sidebar shell + 7 feature components (~395 lines): `Dashboard`, `GatewayPanel`, `GatewayToolsPanel`, `FabricPanel`, `ActivityPanel`, `MonitorControls`, `WorkspaceTopologyPanel`.
- **Styles**: `global.css` (tokens + resets, 14 lines) + `app.css` (all component styles, 32 dense lines).
- **Product constraints** (PRODUCT.md): security-first ops console; explicit confirmations on high-risk actions are a commitment; native file picker approved for path fields; fast orientation on open is the core UX goal.

## 2. Survey

### Design system inventory
- **Tokens** (`global.css`): `--canvas --structural --container --floating --text --muted --accent --good --danger --line --radius`. Missing: spacing scale, typography scale, shadow/elevation, z-index, transition tokens.
- **Theming**: dark default; light via `prefers-color-scheme` media + `:root[data-theme]` overrides. Accent `--accent`/`--good`/`--danger` are shared across themes (no per-theme tuning).
- **Motion**: single `transition` on `button` (120ms bg/color) gated behind `prefers-reduced-motion: no-preference`. No other animation.

### Current state analysis
- **Layout**: `.shell` grid 240px sidebar + fluid main (max 1280px); collapses to single column ≤760px; sidebar becomes horizontal scroll nav.
- **Patterns**: `.panel` + `.panel-heading`, `.action-row` button strips, `.resource-form` / `.form-row` label+input grids, `.error-box`, `.evidence <details>` for JSON results, `.metric` cards, `.console-card` nav cards, `.workspace-row` selectable rows, `.activity-list` log rows.
- **Interaction primitives**: buttons only; `window.confirm` gates high-risk actions; `details/summary` for monitor controls + result payloads.
- **i18n**: `useI18n()` context dictionary + a duplicated inline `useI18nSafe` dictionary in `App.tsx` for the shell.

### Delegate survey
- codex analysis delegate dispatched (background) for independent cross-angle audit; results merged in §3.
