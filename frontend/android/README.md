# Android 壳工程 · task-33

> Capacitor 6.x · 双 ABI（arm64-v8a + armeabi-v7a）· 联网直连线上 Worker

## 目录
- `frontend/capacitor.config.ts` — Capacitor 配置（webDir=out, appId=com.tavern.home）
- `frontend/android/` — Capacitor 生成的原生壳（执行 `npx cap add android` 后出现）
- `frontend/android/app/build.gradle` — 已加入 task-33 双 ABI 配置（ndk abiFilters + splits.abi）
- `android/app/build.gradle` — 仓库根镜像（与 frontend/android 同步，满足任务书 files 字段）

## 首次生成（需本机已装 Android Studio / SDK / JDK17）

```bash
cd frontend
npm install                 # 安装 @capacitor/* 依赖（已加入 package.json）
npm run build               # next build --webpack 产出 out/
npx cap add android         # 生成 android/ 目录（若已存在可跳过）
npx cap sync android        # 同步 out/ 到 android/assets
```

> 若 `npx cap add android` 已执行过，本仓库的 `frontend/android/app/build.gradle` 会被生成阶段覆盖；
> 覆盖后请重新应用双 ABI 补丁（见下节）。

## 双 ABI 补丁（已在当前 build.gradle 中体现）

`android/app/build.gradle` 需包含：

```gradle
android {
  defaultConfig {
    ndk { abiFilters 'arm64-v8a', 'armeabi-v7a' }
  }
  splits {
    abi {
      enable true
      reset()
      include 'arm64-v8a', 'armeabi-v7a'
      universalApk false
    }
  }
}
```

验证：
- `splits.abi.enable true` → `assembleRelease` 会产出两个 APK：`app-arm64-v8a-release.apk` / `app-armeabi-v7a-release.apk`
- `bundleRelease` → 产出 `app-release.aab`（含双 ABI，Play Store 按设备分发）

## 生产打包（联网即用，不依赖电脑）

1. 配置线上 Worker：
   ```bash
   # frontend/.env.local 或 .env.production
   NEXT_PUBLIC_WORKER_URL=https://tavern-home.<your-subdomain>.workers.dev
   NEXT_PUBLIC_AUTH_TOKEN=<与 wrangler secret AUTH_TOKEN 一致>
   ```
   确保 `wrangler.toml` 的 `ALLOWED_ORIGINS` 已放行 `https://localhost,capacitor://localhost`（已配置）。

2. 构建并安装：
   ```bash
   cd frontend
   npm run build
   npx cap sync android

   cd android
   ./gradlew assembleRelease   # 或 bundleRelease
   # 产物：
   #   android/app/build/outputs/apk/release/app-arm64-v8a-release.apk
   #   android/app/build/outputs/apk/release/app-armeabi-v7a-release.apk
   #   android/app/build/outputs/bundle/release/app-release.aab
   ```

3. 真机验证（arm64 与 arm32 各一台）：
   - 安装对应 ABI 的 APK，启动直连线上 Worker
   - 完成：选项目 → 看角色块 → 开新窗 → 发消息/记忆/日记 全流程

## 签名

`versionCode/versionName` 来自 `android/app/build.gradle`（当前 1 / 0.2.0），与 `frontend/package.json` version 保持一致。
Release 签名走 `android/app` 的 `signingConfigs`（Android Studio 生成的 keystore，勿提交）。

## 常见问题

- `next build` 失败：确认 `frontend/next.config.ts` 为 `output: 'export'`（已配置），且 `NEXT_PUBLIC_WORKER_URL` 已设。
- `cap sync` 提示 webDir 不存在：先 `npm run build` 生成 `out/`。
- 真机白屏/请求 403：检查 `ALLOWED_ORIGINS` 是否包含 `capacitor://localhost` 与线上 Worker 域名 CORS。
- 仅出一个 APK：检查 `splits.abi` 是否被覆盖，重新应用补丁后 `./gradlew clean assembleRelease`。

## 触控适配

现有 `frontend/app/study/page.tsx` 已做响应式（700px 断点、左廊横排、按钮热区 ≥44px，见 task-30 角色块多选）。Capacitor WebView 默认为全屏，无需额外适配；如需沉浸式状态栏可在 `capacitor.config.ts` 的 `plugins.SplashScreen` / `StatusBar` 中追加。
