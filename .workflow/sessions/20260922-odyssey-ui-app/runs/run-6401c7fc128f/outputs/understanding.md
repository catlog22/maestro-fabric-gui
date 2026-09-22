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

## 3. Audit

Severity matrix (18 findings; dims = visual_hierarchy / interaction_states / accessibility / responsiveness / micro_interactions / edge_cases):

| ID | Sev | Dim | Finding | Location |
|----|-----|-----|---------|----------|
| F1 | high | visual | hero `.error-box` absolute `bottom:-56px` overlaps content below | app.css:17 |
| F2 | high | a11y | `.nav-item.active` white text on 28% accent fails contrast in light theme | app.css:8 |
| F3 | high | edge/interaction | workspace `bind` hardcodes expected generations = 1 → real binds conflict | WorkspaceTopologyPanel.tsx:12 |
| F4 | medium | interaction | `.workspace-row` no `:hover` feedback | app.css:28 |
| F5 | medium | interaction/a11y | inputs lack `:focus-visible` styling | app.css:24,26 |
| F6 | medium | visual | unstyled `<h3>` "Current profile" | GatewayPanel.tsx:34 |
| F7 | medium | micro | console-card hover transform not transitioned | app.css:18,32 |
| F8 | high | edge | activity `info/warning/error` classes unstyled — severity invisible | app.css:28 |
| F9 | medium | edge | no truncation for long paths/IDs | app.css:28 |
| F10 | medium | edge | i18n gaps: advancedSections, FabricPanel, GatewayToolsPanel, theme enum | App.tsx:17,80 |
| F11 | medium | a11y | `--danger` on tinted bg low contrast in light theme | app.css:27 |
| F12 | medium | edge | `unsubscribe` no try/catch → stale subscription state | MonitorControls.tsx:13 |
| F13 | low | visual | readiness banner fully visible when ready (duplicates status) | App.tsx:85 |
| F14 | low | interaction | `.evidence summary` no `cursor:pointer` | app.css:27 |
| F15 | low | a11y | `<time>` missing `dateTime` | ActivityPanel.tsx:6 |
| F16 | low | a11y | workspace-row selected not exposed via aria | WorkspaceTopologyPanel.tsx:13 |
| F17 | low | responsive | no other responsive defects (F1 overlap is main) | app.css |
| F18 | low | micro | no loading affordance beyond text; static status-dot | app.css:11 |

Distribution: 0C / 4H / 8M / 6L. All 6 dimensions audited; delegate cross-check pending (claude, background).
