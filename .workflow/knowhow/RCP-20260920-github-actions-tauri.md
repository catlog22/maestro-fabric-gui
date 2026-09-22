---
title: GitHub Actions Tauri 打包与发布管线
type: recipe
created: 2026-09-20T06:08:31.308Z
keywords:
  - github-actions
  - tauri
  - 发布管线
  - 版本校验
language: zh-CN
lifecycleStatus: active
relatedPaths:
  - .github/workflows/ci.yml
  - .github/workflows/release.yml
  - scripts/verify-release-version.mjs
  - src-tauri/tauri.conf.json
---

## Goal
为 Tauri 桌面应用建立可重复的 GitHub 构建、校验与发布流程，并让发布产物进入 draft GitHub Release 供人工复核。

## Prerequisites
- GitHub Actions 已启用，仓库默认 `GITHUB_TOKEN` 可写 `contents`。
- Node.js 22、npm lockfile、Rust stable。
- 发布前 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 使用同一版本号。

## Steps
1. 在 PR 或 push 上运行 `npm ci`、`npm run typecheck`、`npm test`、`npm run verify:package` 和 Rust 测试；CI 上传 web package artifact 供检查。
2. 将三处版本号更新为同一语义化版本，例如 `0.1.0`。
3. 创建并推送匹配的 tag：`git tag v0.1.0 && git push origin v0.1.0`。
4. `release.yml` 在 Ubuntu、Windows、macOS 矩阵上安装平台依赖，运行版本校验，然后由 `tauri-apps/tauri-action` 构建安装包。
5. 工作流创建 draft Release；检查三个平台的附件、版本和安装结果后，在 GitHub 页面手动发布 draft。

## Expected Outcome
PR/push 有可追踪的构建 artifact；`v*.*.*` tag 生成包含 Linux、Windows、macOS 安装包的 draft GitHub Release；tag 与应用元数据不一致时会在构建前失败。

## Common Pitfalls
- 不要直接推送与应用版本不一致的 tag；`scripts/verify-release-version.mjs` 会拒绝该发布。
- Linux runner 必须安装 WebKit、Ayatana、librsvg、patchelf 等 Tauri 依赖。
- 发布工作流必须保留 `permissions: contents: write`，而普通 CI 只需 `contents: read`。
- 本地 Windows `npm run tauri build` 成功不代表 Linux/macOS 构建成功，必须等待完整矩阵完成。

## Related
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `scripts/verify-release-version.mjs`
- `src-tauri/tauri.conf.json`
