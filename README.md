# 自律打卡 (Habit Tracker)

一个零依赖、单文件的习惯打卡 App：纯 HTML/CSS/JS 实现，外加一层极薄的 Android WebView 壳。
视觉按设计稿（390×844 移动端）逐像素还原。

## 功能

- **今日打卡**：习惯列表勾选、今日完成度进度卡、连续天数徽章
- **打卡日历**：月历热力图 + 最近打卡记录
- **数据统计**：完成率大数字卡、周趋势柱状图、本月坚持榜
- **新建习惯**：名称 / 图标 / 频率 / 提醒时间 / 每日目标
- **我的**：累计数据、成就徽章、设置
- 数据存于 `localStorage`，打卡记录、新建习惯跨会话保留

## 快速开始

### 浏览器直接打开

双击 `index.html` 即可，无需安装任何东西。

### 安卓 APK

`自律打卡-1.0.apk` 可直接安装（Android 8.0+）。允许「未知来源」后点开安装。

## 目录结构

```
habit-tracker/
├── index.html            应用本体（单一真源，APK 内嵌的就是它）
├── LICENSE               MIT 许可证
├── android/              Android 壳工程源码
│   ├── AndroidManifest.xml
│   ├── java/com/wren/habitapp/MainActivity.java
│   └── res/...
└── build-apk.js          一键构建脚本
```

APK 不入库（二进制产物）。要装直接跑 `node build-apk.js` 自己出包，
或者到 [Releases](../../releases) 页面下载。

## 重新构建 APK

本机需要先装一套编译链（JDK 17 + Android build-tools/platform，无需 Gradle），
默认路径约定为 `D:\android-toolchain`。然后：

```bash
node build-apk.js
```

构建流程：`aapt2 → javac → d8 → zipalign → apksigner`。
脚本内置硬校验：确认 APK 含 `classes.dex` / `AndroidManifest.xml` /
`resources.arsc` / `assets/index.html`，并解析 dex 头验证 adler32 与 sha1。

## 注意

- `D:\android-toolchain\build-habit\habit.keystore` 是签名密钥，**丢了就只能卸载重装**，别删。
- 路径约定如果和你的环境不同，改 `build-apk.js` 顶部的常量即可。

## 许可证

[MIT](./LICENSE) © 2026 ts
