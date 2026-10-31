---
title: "智通平台后门与隐藏能力"
description: "智通平台内置的各类后门：远程协助、开发者模式、安全模式、一键还原、自卸载、动态码、隐藏协助等"
categories:
  - 安全分析
excerpt: 智通平台作为学海教育管控学生平板的系统，内置了大量后门能力：远程协助（可执行 shell 命令）、开发者模式（一键还原/双清/自卸载）、安全模式页、崩溃动态码、隐藏协助等。
---

# 智通平台后门与隐藏能力

## 概述

智通平台（学生端 `com.xh.zhitongyunstu`）是一个**设备管控型**应用，其"后门"能力分为几类：

1. **远程协助后门**（`com.xuehai.launcher.assist`）—— 老师远程控制平板，可执行 shell 命令、安装/卸载应用、读写文件。
2. **开发者模式后门**（`com.xuehai.launcher.developer`）—— 一键还原、双清、删除自身。
3. **安全模式页**（`com.xuehai.launcher.safe`）—— 清除自身数据、跳转 MDM 安全页。
4. **崩溃动态码**（`com.xuehai.launcher.common.crash`）—— 多次崩溃后进入安全页。
5. **隐藏协助** —— 服务器下发 `hidden=1` 时悬浮窗不显示。
6. **MDM 设备管理后门** —— 通过 AIDL 调用 MDM 服务执行设备级操作。

## 1. 远程协助后门

详见 [doc/10-remote-assist.md](10-remote-assist.md)。

核心能力：
- `executeCmd(cmd)` —— 任意 shell 命令执行（RCE）。
- `installAppOnline(url)` / `unInstallApp(pkg)` —— 远程安装/卸载应用。
- `getFileTree(dir)` / `downloadFile(url, path)` / `uploadFile(path)` —— 文件系统完全访问。
- `hidden=1` —— 隐藏协助悬浮窗，学生无感知。

## 2. 开发者模式后门

### 入口

- `DeveloperActivity`（`com.xuehai.launcher.developer.DeveloperActivity`），路由路径 `/app/developer`。
- 从 `DebugActivity` 的"开发者模式"按钮进入。
- 需要传入 `token`（`getIntent().getStringExtra("token")`），用于双清时的 MDM 验证。

### 功能列表（`DeveloperViewModel`）

| 功能 | 说明 |
|---|---|
| **一键还原**（`resetAll()`） | 恢复设备到出厂管控状态 |
| **删除智通平台**（`deleteLauncher()`） | 卸载自身（root 时静默卸载，否则普通卸载） |
| **跳转 MDM 解锁页**（`skipToMdm()`） | 打开 `mdm://com.xuehai.mdm:8080/init/guide` |
| **双清**（`wipe()`） | 通过 MDM `resetFactory(md5(token))` 恢复出厂设置 |

### 一键还原（resetAll）详细操作

`DeveloperViewModel.C31091.invoke2()` 执行以下 MDM 策略操作：

1. 删除 `{SD}/xuehai/download` 和 `{SD}/xuehai/bak/xh_launcher.apk`。
2. 清除应用防火墙规则、域名防火墙规则，关闭 iptables。
3. 开启刷机（`allowFirmwareRecovery(true)`）。
4. 开启双清（`allowFactoryReset(true)`）。
5. 开启安全模式（`allowSafeMode(true)`）。
6. 开启 OTA 升级（`allowOTAUpgrade(true)`）。
7. 允许使用 SD 卡、USB MTP、USB 调试。
8. 清除锁屏（`removeLockScreen()`）。
9. 开启截屏、启用设置、启用切换应用按钮。
10. 显示设置隐藏项、状态栏按钮、下拉菜单隐藏项、开发者模式。
11. 清空通知栏名单。
12. 恢复平台和"大厅"（`com.xuehai.xuehailauncher`）为可卸载。
13. 移除默认桌面（MDM 的 `com.xuehai.launcher.MainActivity`）。
14. 恢复设置界面顶级菜单、允许修改桌面。
15. 华为设备：启用华为桌面/文档管理器/浏览器，恢复 HEM 系统组件。
16. 三星设备：启用 MTP 应用。
17. 启用谷歌实时字幕、允许修改时间、锁屏界面、每日看板、相机快捷键、Bixby、输入法切换、任务栏。
18. 重置本地激活状态。
19. 恢复所有配置组件状态。
20. 从服务器拉取应用黑名单并恢复所有被禁用的应用。

### 删除自身（deleteLauncher）

```java
if (ZCommand.isRoot()) {
    AppUtil.unInstallApkSilent(packageName);   // root 静默卸载
} else {
    AppUtil.unInstall(xhApplication, packageName);  // 普通卸载
}
```

### 双清（wipe）

- 若 MDM 设备管理员已激活：弹出确认框，确认后 `allowFactoryReset(true)` + `resetFactory(MD5(token))`。
- 若未激活：跳转 MDM 引导页（`initGuideView`）。

## 3. 安全模式页（SafeActivity）

### 入口

- `com.xuehai.launcher.safe.SafeActivity`，路由 `/app/safe`。
- 从 `DebugActivity` 的"安全模式页"进入。
- **崩溃 3 次以上**（`CrashLevelManager.isSeriousCrash()`）时，`WelcomeActivity` 自动跳转到 `SafeActivity`。

### 功能

| 功能 | 说明 |
|---|---|
| **清除自身数据**（`clear_self_data`） | 确认后 `CrashLevelManager.clear()` + `LauncherUtil.clearDataAndExit()` |
| **进入安全模式**（`to_safe_mode`） | 跳转 `mdm://com.xuehai.mdm:8080/safe`（MDM 安全页） |

- `onKeyDown` 拦截返回键（`keyCode == 4` 时返回 true），**禁止用户退出安全页**。

### clearDataAndExit 详细操作

`LauncherUtil.clearDataAndExit()`：

1. 清空任务队列、停止所有下载。
2. 删除 `{SD}/xuehai/download`。
3. `clearCacheData()`：
   - `ProviderUtil.exit()`（退出 ContentProvider 进程）。
   - 备份本地消息已读状态。
   - 清除应用文件数据、数据库数据。
   - 删除 `{SD}/Download`、`{SD}/xuehai/zip`、`{SD}/xuehai/log/cache`。
4. 删除 `/data/data/{包名}`。
5. 删除密钥文件（`XhSecretKeyUtils.deleteSecretFile()`）。
6. `XHAppUtil.killAllProcess()` 杀掉所有进程。
7. `clearApplicationUserData()` 清除应用用户数据。

## 4. 崩溃动态码机制

### 崩溃计数（AppCrashManager）

- SharedPreferences 文件：`app_crash_flag`。
- 每次崩溃 `levelUp()` 使 `crash_flag` +1。
- 版本号变化时重置计数。
- `flag >= 3` 时 `isSeriousCrash()` 返回 true（**严重崩溃**）。

### 启动计数（AppStartupManager）

- SharedPreferences 文件：`app_start_flag`。
- 每次启动 `markStart()` 使 `start_flag_{进程名}` +1。
- `flag >= 5` 时 `isStartError()` 返回 true（**启动异常**）。

### 崩溃处理流程

1. `MyUncaughtExceptionHandler`（在 `XhApplication.onCreate()` 中注册）捕获未处理异常。
2. `CrashReportHandler` 记录崩溃详情（PID、包名、版本、时间、堆栈）到日志。
3. `CrashLevelManager.levelUp()` 增加崩溃计数。
4. 启动时若 `isStartError()`，向 MDM 发送广播 `com.xuehai.launcher.mark_zty_error`。
5. 恢复正常后发送广播 `com.xuehai.launcher.mark_zty_normally`。
6. `WelcomeActivity` 启动时若 `isSeriousCrash()`，直接跳转 `SafeActivity`（安全页）。

### 崩溃状态跨进程共享

- `ZTYCrashStatus`：MMKV 文件 `{SD}/xuehai/keep/zty_crash`，key `zty_crash_status`。
- `ZTYLoginStatus`：MMKV 文件 `{SD}/xuehai/keep/zty_login`，key `zty_login_status`。
- 这两个状态文件放在**外部存储**，供 MDM 进程读取。

## 5. MDM 设备管理后门

智通平台通过 AIDL 接口 `com.xuehai.system.mdm.MdmAidlInterface` 与 MDM 服务（`com.xuehai.launcher` 学生端 或 `com.xuehai.response_launcher_teacher` 教师端）通信。

### 连接方式

- `MdmServiceManager.bindService()`：设置 action `com.xuehai.system.mdm.action_aidl`，绑定到 MDM 包。
- `MdmHolder.registerMdm()`：主进程创建文件锁 `{SD}/xuehai/keep/launcherLock.txt`，传入 `lockPath`、`emptyActivityAction`（`com.xh.zhitongyun.empty`）、`package_name`。
- 断线自动重连（`onServiceDisconnected` → `registerMdm()`）。

### AIDL 能力（部分）

| 类别 | 方法 |
|---|---|
| 设备管理 | `deactivateDevice()`、`isDeviceAdminActivated()`、`lockScreen()`、`unlockScreen()`、`reboot()`、`shoutdown()`、`resetFactory(md5)` |
| 应用管理 | `installApplication(path)`、`uninstallApplication(pkg)`、`setApplicationState()`、`setApplicationUninstalltionState()`、`wipeApplicationData()`、`stopApp()` |
| 防火墙 | `addFirewallAllowApps()`、`addFirewallDenyApps()`、`addDomainsRules()`、`setIptablesOption()` |
| 限制策略 | `allowFactoryReset()`、`allowFirmwareRecovery()`、`allowSafeMode()`、`allowOTAUpgrade()`、`setSdCardState()`、`setMTPEnabled()`、`setUsbDebuggingEnabled()`、`setScreenCapture()` |
| 系统设置 | `setSystemTime()`、`setTimeZone()`、`setWiFiState()`、`setMobileDataState()`、`setBluetoothEnable()`、`setInputMethod()` |
| 信息获取 | `getSerialNumber()`、`getImei()`、`getDeviceMacAddress()`、`getTopAppPackageName()`、`getAppUsage()`、`getApplicationNetworkStats()` |
| 动态码 | `verifyDynamicCode()`、`verifyDynamicToken()` |
| 其他 | `startTcpdump()`、`runBugReport()`、`readFileFromData()`、`setBootingAnimation()`、`setShuttingDownAnimation()` |

## 6. 动态码（TOTP）设备重置后门

动态码是学海用于**重置设备**的 TOTP（基于时间的单次密码）。详见 [[xuehai-brushcode]]。

### 触发方式

| 方式 | 操作 | 界面 |
|---|---|---|
| 反复杀进程 | 反复杀死智通平台进程约 15 次，智通云显示"启动失败"→ 点击"其他"→"设备重置" | 动态码界面 |
| 制造崩溃 | 使智通平台崩溃 3 次（如填满存储空间触发 `No Space Left On Device`），智通云显示"设备修复"→"进入安全模式"→"设备重置" | 动态码界面 |

### 验证流程

`MdmModelImpl.checkBrushCode(key, code, expectLocal)`：

1. **离线验证**（无网络且 `expectLocal=true`）：调用 MDM AIDL `verifyDynamicCode(key, code, 0)`，由 MDM 服务用本地 `SecretKey` 做 TOTP 校验。
2. **在线验证**：输入以 `*...*`、`#...#`、`@...@` 包裹的码时，调用：

```
PATCH /api/v2/pub/platform/brushCode
body: {"code": "...", "deviceId": "..."}
```

   服务器返回加密的 `status`（`StringEncryptUtils.decrypt`），`status == 1` 时验证通过。

### SecretKey 存储

- 位置：`{SD}/xuehai/keep/device/*.ls`（**外部存储，卸载后仍保留**）。
- 文件名是 AES 加密后的 SecretKey（160 位 Hex），用密钥 `453DA222330F6F421E7DABF2CAB6AECC`（ECB/PKCS5Padding）解密得到 Base32 的 SecretKey。
- SecretKey 在账户初始化时生成，**终身绑定设备**，刷机也不更换。
- 学海官方持有设备号-SecertKey 配对关系，可随时算出动态码。
- 代码中残留测试 SecretKey：`GYZWCYTCMMZGELJUMVRWGLJUMJRGILLBGJRTQLJVMVQTQNJXMRSTENJRHFRXITDY`。

### 验证通过后

- 跳转 `MdmRouter.initSafeView()` → `mdm://com.xuehai.mdm:8080/safe`（MDM 安全页）。
- `CrashLevelManager.postClear()` 清除崩溃计数。
- 设备可被重置（恢复出厂/清除管控）。

### 本地特殊密钥

- `MdmModelImpl.reqSecretKeyLocalSpecial()`：从服务器拉取"本地特殊密钥"（`GET /api/v1/pub/platform/secretKey/localSpecial`，header `original-key` 为加密后的本地密钥），保存到 `{SD}/xuehai/keep/device/*.ls`。
- 服务器通过数据码 `LOCAL_BRUSH_SECRET_KEY`（`CA106004SA1060030002`）触发拉取。

## 7. 卸载后重装行为（自卸载后门）

> zty 侧对应的入口是 `DeviceResetActivity`（"一键还原" = `PolicyManager.unLock()` 全量撤销，删除自身前的硬性前置）；卸掉 zty+ztp 两者只装回 ztp 的推演、数据去留总表、自写 ztp 可行性见 `17-reinstall-and-rewrite.md`，权限与设备身份机制见 `16-permissions-device-identity.md`。

智通平台可通过开发者模式"删除智通平台"（`deleteLauncher()`）卸载自身。用户手动重装后：

### 卸载时被清除（应用私有数据）

- `/data/data/com.xh.zhitongyunstu/` 全部数据。
- `zaze_provider.db`（CPVD 缓存：`hotfix_patch_infos`、用户数据、消息、配置）。
- SharedPreferences（`patch_config`、`app_crash_flag`、`app_start_flag`、`user_state` 等）。
- Tinker 补丁文件（`{filesDir}/download/patch/`）。
- Room 数据库（`xh_launcher.db` 等）。

### 卸载后仍保留（外部存储 `/sdcard/xuehai/`）

| 路径 | 内容 | 影响 |
|---|---|---|
| `keep/device/*.ls` | 加密 SecretKey | **设备身份保留**，TOTP 动态码仍有效 |
| `keep/zty_crash` | MMKV 崩溃状态 | MDM 可读取 |
| `keep/zty_login` | MMKV 登录状态 | MDM 可读取 |
| `keep/launcherLock.txt` | 文件锁 | - |
| `keep/appStats` | 应用统计 | - |
| `download/` | 已下载 APK | 重装后可复用 |
| `bak/xh_launcher.apk` | 备份启动器 | - |
| `log/` | 日志 | 重装后继续上报 |
| `config/device_status.ini` | 设备管控状态 | 重装后继续上报 |
| `zip/` | 压缩包 | - |

### 重装后的行为

1. **设备仍受管控**：MDM 应用（`com.xuehai.launcher`）未卸载，设备管理员仍激活，`MdmHolder` 重装后自动重新绑定。
2. **设备身份不变**：`getDeviceId()` 仍返回 MDM 的 `getSerialNumber()`，SecretKey 保留，服务器仍认识这台设备。
3. **热修复重新拉取**：`patch_config` SP 被清空 → `loadPatchVersion()` 返回空 → 启动后重新从服务器拉取补丁信息并下载补丁。
4. **崩溃计数清零**：`app_crash_flag` / `app_start_flag` 被清空 → 不再进入安全模式。
5. **需要重新登录**：`zaze_provider.db` 被清空 → `SessionData.isLogin()` 为 false → `WelcomeActivity.router()` 跳转登录页。
6. **重新注册**：`LauncherSPUtil.isRegister()` 为 false → 重新向服务器注册设备。

## 8. 其他隐藏能力

### 隐藏配置页（ConfigActivity / NetworkLineActivity）

`com.xuehai.launcher.config` 包包含两个**隐藏配置页**，通过 ZRouter 路由访问（`/app/config`、`/app/network/lines`），manifest 中已声明但无导出 Intent：

| 页面 | 功能 | 危险等级 |
|---|---|---|
| `ConfigActivity` | **环境切换器**：生产/预发/测试/开发环境一键切换（`Configuration.setEnvironmentMode()`），修改数据库名、服务器 URL、微服务 URL、大数据 URL；可查看/修改配置属性（`ConfigProperty`）；**按钮直达开发者模式**（`DeveloperActivity`） | **高** |
| `NetworkLineActivity` | **网络线路切换器**：选择/保存网络线路方案（`NetworkLineScheme`），支持远程 URL 开关（`isRemoteUrlEnable`），可清空线路配置 | 高 |

- `ConfigActivity.onDestroy()` 会 `CacheManager.clearCache()` + `CPVDUserData.clearCache()` + `LauncherUtil.exitNormally()`（退出时清缓存）。
- 环境切换后 `Configuration.loadEnvironment()` 会加载对应环境的服务器地址（生产 `ztp.yunzuoye.net`、预发 `ztp-staging.yunzuoye.net`、测试 `ztp.xht.com`、开发 `zty.xh.com`）。
- 这些页面是**调试/运维后门**：可把学生平板切换到测试服务器，或直达开发者模式执行一键还原/双清/自卸载。

### 原生崩溃捕获（xcrash）

- `XCrashUtil.init()`（`XhBaseApplication.attachBaseContext()` 中调用）初始化 xcrash SDK。
- 捕获 **native 崩溃**（Java 崩溃由 `MyUncaughtExceptionHandler` 处理）和 **ANR**。
- 崩溃 tombstone 文件通过 `TombstoneParser` 解析后，`LogManager.uploadCrashLog()` 上报服务器，然后删除。
- 启动时主线程空闲后自动上传上次遗留的崩溃日志。
- 磁盘耗尽时（`isDiskExhausted`）跳过本地写日志，直接网络上报。

### 剪贴板监控

`XhApplication.clipboard()`：监听剪贴板变化，若内容不是"学海教育"，则**强制覆盖为"学海教育"**。

### 设备安全检测

`DeviceChecker.detectSafely()`（学生端启动时调用）：
- 检测 Xposed（classloader/maps/stacktrace）。
- 检测模拟器（Qemu）。
- 检测 Root。
- 检测多用户。
- 检测到不安全时，把系统属性（prop）和检测信息写入**应用错误日志**上报服务器。
- 一天内只上报一次（`lately_hit_key`）。

### 安全状态检测

`SafeCheckUtils.check()`（每 5 分钟）：
- 检测用户是否开启安全锁屏（`isKeyguardSecure()`）。
- 检测是否安装了"安全文件夹"应用。
- 检测是否设置了额外的设备管理器。
- 检测到异常时写入应用错误日志上报。

### 设备管控状态上报

`DeviceControlManager.checkDeviceControlStatus()`：
- 检测固件恢复、恢复出厂、USB 调试、USB MTP、外部 SD 卡、多用户、安全文件夹、锁屏等状态。
- 状态变化时通过 `MdmModel.uploadDeviceStatus()` 上报服务器。

### 隐藏协助

- 服务器下发 `hidden=1` 时，`AssistService` 不显示悬浮窗。
- 协助期间屏幕常亮（`setScreenCloseTime(Integer.MAX_VALUE)`）。

## 后门入口汇总

| 后门 | 入口 | 触发方式 |
|---|---|---|
| 远程协助 | `AssistService` / `RemoteAssistActivity` | 服务器下发 `REMOTE_ASSIST` 数据码 |
| 开发者模式 | `DeveloperActivity` | DebugActivity → 开发者模式 |
| 安全模式页 | `SafeActivity` | 崩溃 3 次 / DebugActivity |
| 一键还原 | `DeveloperViewModel.resetAll()` | 开发者模式按钮 |
| 删除自身 | `DeveloperViewModel.deleteLauncher()` | 开发者模式按钮 |
| 双清 | `DeveloperViewModel.wipe()` | 开发者模式按钮 |
| 崩溃动态码 | `WelcomeActivity` → `SafeActivity` | 崩溃计数 ≥ 3 |
| 动态码设备重置 | `MdmModelImpl.checkBrushCode()` | 杀进程 15 次 / 崩溃 3 次 → 输入 TOTP |
| 自卸载 | `DeveloperViewModel.deleteLauncher()` | 开发者模式按钮（root 静默卸载） |
| 卸载后重装 | 重装后自动重绑 MDM、重拉补丁、重新登录 | 设备身份与管控不丢失 |
| MDM 设备管理 | `MdmAidlInterface` | AIDL 绑定 MDM 服务 |
| 剪贴板覆盖 | `XhApplication.clipboard()` | 剪贴板变化时 |
| 设备安全检测 | `DeviceChecker` | 学生端启动时 |