# 安卓 App 亲测指南 · task-33（给用户）

> 当你看到这份文档，说明壳已就绪，只差你点一下安装包

## 1. 一键出包
双击 `frontend/scripts/build-android.bat`，或在 PowerShell：
```powershell
cd "C:\Users\whp18\dev\tavern-study\frontend"
.\scripts\build-android.ps1
```
产物：
- `frontend/android/app/build/outputs/apk/release/app-arm64-v8a-release.apk`（64位）
- `frontend/android/app/build/outputs/apk/release/app-armeabi-v7a-release.apk`（32位）
- `frontend/android/app/build/outputs/bundle/release/app-release.aab`（合一）

若 `android/` 首次生成被覆盖，脚本会提示补回 `build.gradle` 的 `abiFilters/splits.abi`（见 `frontend/android/README.md`）。

## 2. 安装
- 64位手机装 `app-arm64-v8a-release.apk`，32位旧机装 `armeabi-v7a` 版
- 或 `adb install <apk>`，或微信/QQ 传到手机直接点安装
- 首次启动会请求网络权限，允许即可

## 3. 线上 Worker 配置（联网即用，不依赖电脑）
App 内已支持运行时覆盖：
- 构建时：`frontend/.env.local` 设 `NEXT_PUBLIC_WORKER_URL=https://tavern-home.<你的>.workers.dev` + `NEXT_PUBLIC_AUTH_TOKEN`
- 运行时：在 App 浏览器控制台或 `adb shell` 中：
  ```js
  localStorage.setItem('tavern_worker_url','https://tavern-home.xxx.workers.dev')
  localStorage.setItem('tavern_auth_token','<token>')
  location.reload()
  ```
- 服务端 `wrangler.toml` 已放行 `capacitor://localhost` 与 `https://localhost`，无需改后端即可直连线上 Worker

## 4. 亲测清单（打勾即过）
- [ ] 安装启动无白屏，`书房`首页/左廊四门正常
- [ ] 选项目 → 看角色块（task-30 平铺多选，热区≥44px）→ 选中态清晰
- [ ] 开新窗 → 写一楼 → 发消息 → AI 有回复（走线上 Worker + OPENAI 网关）
- [ ] 记忆面板：按 `scope→layer→theme` 三级显示，Compact/快照可用
- [ ] 日记房：按日期写入/读取，中文正常
- [ ] 无电脑，仅手机联网全流程走通

## 5. 失败自检
- 白屏/403 → 检查 `wrangler.toml ALLOWED_ORIGINS` 是否含 `capacitor://localhost`
- 仅出一个 APK → `android/app/build.gradle` 是否被 `cap add` 覆盖，补回 `splits.abi`
- cap sync 提示 webDir 不存在 → 先 `npm run build` 生成 `out/`

---
> 测完若有白屏、请求失败、热区过小，直接回这条线程贴 `adb logcat` 或截图，我来修
