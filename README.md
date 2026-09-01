# Vistask

一个使用 electron-vite、React、TypeScript 和 electron-builder 构建的 macOS 日程看板应用。

## 看板功能

- 多看板与四种卡片状态
- 项目分组、顶部项目切换及看板归属管理
- 卡片拖拽、父子卡片、列级状态筛选
- 标注视图、截止时间与重复周期设置
- 50 分钟推进计时及番茄钟统计
- 数据通过 Electron 主进程持久化到 SQLite
- 可在设置页选择或新建自定义 SQLite 数据库文件

全新安装的默认数据库位于 macOS 的 `~/Library/Application Support/Vistask/vistask.db`。从 Cardex 升级时会自动沿用原数据库及自定义数据库配置，避免数据丢失。首次从旧版 JSON 升级还会自动导入 `boards.json`；旧 JSON 文件会保留为备份，不再作为运行时数据源。

旧版已有看板会在升级时自动归入“默认项目”。

## 环境要求

- macOS
- Node.js 20 或更高版本
- npm 10 或更高版本

## 开始使用

```bash
npm install
npm run dev
```

## 常用命令

```bash
npm run typecheck  # TypeScript 类型检查
npm run build      # 构建主进程、preload 和 renderer
npm run preview    # 预览构建结果
npm run pack       # 生成未封装的 .app 目录（便于本机测试）
npm run dist:mac   # 生成 macOS DMG 和 ZIP 安装包
```

构建产物在 `out/`，electron-builder 打包产物在 `release/`。

## 项目结构

```text
src/
├── main/          # Electron 主进程与 IPC handler
├── preload/       # 安全的 contextBridge API
└── renderer/      # React 渲染进程
```

示例页面通过 `window.api.getSystemInfo()` 调用 preload，再由 preload 使用 `ipcRenderer.invoke` 请求主进程中的 `ipcMain.handle`。renderer 未启用 Node.js 集成。

## macOS 发布说明

示例配置将签名身份设为 `null`，适合本地构建和测试。正式分发时，请移除 `identity: null`，配置 Apple Developer ID、代码签名与 notarization（公证）。首次打开未签名应用时，macOS 可能显示安全提示。
