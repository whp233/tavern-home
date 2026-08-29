import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tavern.home',
  appName: '酒馆书房',
  webDir: 'out',
  // Next 已配置 output: 'export'，out 即为静态产物目录
  server: {
    // 生产环境直连线上 Worker，无需本地服务
    // 开发时如需热重载可临时配置 url: 'http://192.168.101.8:3001'
    androidScheme: 'https',
    iosScheme: 'https',
  },
  android: {
    // 双 ABI 构建在 android/app/build.gradle 中通过 ndk.abiFilters 与 splits.abi 控制
    // 此处保留 Capacitor 层最小配置，具体 ABI 分包见 android/app/build.gradle
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
    },
  },
};

export default config;
