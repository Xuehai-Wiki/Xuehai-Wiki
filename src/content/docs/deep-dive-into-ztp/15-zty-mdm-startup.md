---
title: "zty 与 ztp 的启动关系、看门狗与安装器"

description: "zty（com.xuehai.launcher，MDM/桌面）如何启动自己、如何拉起/安装/看护 ztp（com.xh.zhitongyunstu，智通平台），以及 ztp 对 zty 的反向支撑"

categories:
  - 架构总览
excerpt: zty 是预装 MDM 代理（桌面+设备管理员+厂商特权+看门狗），ztp 是业务端。本文按源码给出两者相互启动的完整机制：开机广播、文件锁看门狗、健康心跳、内置安装器与初始化向导。
---

# zty 与 ztp 的启动关系、看门狗与安装器

## 0. 术语与常见混淆

| 代号 | 包名 | 一句话角色 |
|------|------|-----------|
| **zty** | `com.xuehai.launcher`（学生）/ `com.xuehai.response_launcher_teacher`（教师） | 预装 **MDM 代理**：系统桌面（HOME）+ 设备管理员 + Knox/HEM/联想特权载体 + RPC 服务端 + 看门狗 + 解锁工具 |
| **ztp** | `com.xh.zhitongyunstu`（学生）/ `com.xh.zhitongyuntch`（教师） | 智通平台：登录 + 图标墙桌面 + 应用管理 + 管控策略消费端（特权从 zty 借） |

> ⚠️ **命名交叉**：zty 源码里反过来把 ztp 叫 "ZTY 客户端 / 智通云客户端"（`ZtyClientUtil.ZTY_STU = "com.xh.zhitongyunstu"`，`MDM_STU = "com.xuehai.launcher"` 是 zty 自己）。日志中的"启动智通云客户端"指的是**启动 ztp**。

## 1. zty 如何启动自己

`zty/app/src/main/java/com/xuehai/launcher/receiver/BootReceiver.java`：

| 广播 | 行为 |
|------|------|
| `BOOT_COMPLETED` / `LOCKED_BOOT_COMPLETED` / `USER_UNLOCKED` | `startSelf(context)` 拉起自己 |
| `ACTION_SHUTDOWN` | 仅日志 |

`startSelf()` 的前置条件（L47-68）：
- 联想机型（`DeviceSupport.isLenovoSupport()`）**直接 return**（由 CSDK 自身拉起）；
- 非学生端 return；已在前台（`SessionData.isOnTop()`）return；
- 华为 HEM 机型要求：Knox/HEM 许可已激活 **且** `IntentUtil.isMyLauncherDefault()`（自己已是默认桌面），否则"进入桌面"不拉起；
- 通过后 `ApplicationUtil.startApp(自己包名)` → `MainActivity`。

`MainActivity` 在 manifest 中声明 `android.intent.category.HOME`（L247-256），launchMode `singleTask`、`clearTaskOnLaunch`、`directBootAware` —— **zty 是系统桌面本体**。

启动后 `MainViewModel.load()`：`CrashLevelManager.isSeriousCrash()`（崩溃 ≥3 次）→ `SafeActivity`；否则 `DeviceChecker.detectSafely()`（Xposed/模拟器/Root 检测）→ `postClear` → `showNormalMode`。

## 2. zty 的拉起判定链

`MainViewModel.handleDeferredResume()`（L135-158），五个条件**全部满足**才拉起 ztp，否则进初始化向导：

```
DeviceActiveManager.isDeviceActivated(cxt)      // 设备管理员已激活 && SDK 已激活
&& ZtyClientUtil.isZtyClientInstalled()          // ztp 已安装（仅查包名）
&& SettingManager.checkAppUsagePermission()      // 使用统计权限（PACKAGE_USAGE_STATS）
&& PermissionManager.getDeniedPermission(...).isEmpty()  // 无未授予的运行时权限
→ openZtyClient → MainActivity 里调 ZtyClientUtil.startZtyClient()
否则 → startGuide → InitGuideActivity
```

满足拉起条件时还会在协程里先执行 `PolicyManagerExtKt.tryUpgrade + doFixedRules`（"启动智通平台前，初始化完成"）。

## 3. zty 帮 ztp 启动的四条路

### 3.1 直接拉起（`ZtyClientUtil.getZtyClientIntent()` L89-107）

```java
Intent intent = new Intent("com.xh.zhitongyun.launcher");   // ztp WelcomeActivity 的 action
intent.setPackage("com.xh.zhitongyunstu");
// query 不到可启动组件 → 先 setEnableApplication(ztp) 把被禁用的 ztp 重新启用，再查
// 仍查不到 → return null → markStartZtyFailed()
```

`startZtyClient()`（L128-158）里还会：
- `PermissionManager.applyRuntimePermissions(context, ztp)` —— **替 ztp 授运行时权限**；
- `KeepLiveService.isAlive()` 为假时 `ZtyFlagManager.increase()` + `postMarkError`；
- 拉起失败计数 `startZtyFailedCount++`。

### 3.2 文件锁看门狗（核心保活）

两端配合（`ztp/.../common/sdk/MdmHolder.java` + `zty/.../system/mdm/KeepLiveService.java`）：

1. **ztp 侧** `MdmHolder.registerMdm()`：绑定 zty 的 `MdmService`（AIDL），把三个参数经 Service intent 传给 zty：`package_name`（ztp）、`lockPath`（`{SD}/xuehai/keep/launcherLock.txt`）、`emptyActivityAction`（`com.xh.zhitongyun.empty`，ztp 的 EmptyActivity）；同时 ztp 自己 `tryLock()` **持有该文件的 FileLock**（L113-116）。
2. **zty 侧** `KeepLiveService.LockThread.run()`（L150-194）：阻塞调用 `lock(lockFile)` 抢占同一把文件锁——ztp 活着就永远抢不到（阻塞）；**ztp 一死锁释放**：
   - `ZtyFlagManager.increase()`（唤醒计数）、`postClear`、`stopMarkErrorTask`；
   - PowerManager WakeLock（10s）；
   - 1 秒后 `wakeupAppTask`：`new Intent(emptyActivityAction).setPackage(package_name)` 重新拉起 ztp；
   - `postMarkError`：20 秒内 ztp 没发"正常"心跳则记异常。

`ZtyFlagManager`（`zty/.../launcher/util/ZtyFlagManager.java`）：`ztyWakeupFlag <= 30` 才允许继续尝试（`WAKEUP_INTERRUPT = 30`），计数经 `XHContentProvider.clearFlag` 跨进程清除。

### 3.3 健康心跳广播

ztp 启动异常/恢复时向 zty 发：
- `com.xuehai.launcher.mark_zty_error` → zty `BusinessReceiver` → `ZtyFlagManager.markZtyError(true)`；
- `com.xuehai.launcher.mark_zty_normally` → 清除异常标记。

### 3.4 反向状态共享

ztp 崩溃计数/登录状态写入外部存储 MMKV：`{SD}/xuehai/keep/zty_crash`、`{SD}/xuehai/keep/zty_login`（`ZTYCrashStatus` / `ZTYLoginStatus`），zty 进程可直接读。

## 4. ztp 的"自启"真相（误传修正）

| 流传说法 | 源码事实 |
|----------|----------|
| "ztp 收开机广播自启" | **否**。`ztp/.../receiver/BootReceiver.java` 收到 `BOOT_COMPLETED` **什么都不做**，仅处理 `ACTION_SHUTDOWN`（`BuryUtil.saveEyeShieldBury(SHUTDOWN_CANCEL)` 护眼埋点）。manifest L177-183 虽注册了 BOOT_COMPLETED，但接收器空跑。 |
| "ztp 不自启" | 半真。ztp **不靠广播自启**，但 manifest L130 `android:persistent="true"` 常驻进程（系统自动拉起/保活；该标志对 data 分区手动安装的 app 不可靠，预装才稳）。 |
| 重启后的表现 | 有 zty：BootReceiver → MainActivity → 拉起 ztp（§1-§3）；无 zty：persistent 拉进程但无界面，**点图标才出现**。 |

> 修正记录：`00-overview.md` / `06-initialization.md` 旧版写的"BootReceiver 收 BOOT_COMPLETED 拉起 WelcomeActivity"与本节源码结论不符，已同步修正。

## 5. ztp 对 zty 的反向支撑

ztp 通过 AIDL（见 `16-permissions-device-identity.md`）为 zty 做的事：

- **钉死桌面**：`SystemSDK.initPermission()` → `setDefaultHome("com.xuehai.launcher", "com.xuehai.launcher.MainActivity")` + `controlChangeHome(false)`（禁止换桌面）；
- **保活三名单**：`addPackageToBatteryOptimizationWhiteList`（电池优化白名单，即"忽略电池优化"）、`addAppAutoRunningList`（launcher / MDM / `com.xh.arespunc`）、`addPackagesToNotificationWhiteList`；
- **卸载保护**：`setApplicationUninstallationDisabled(zty)`（正式版）；
- HEM 机型的"是否默认桌面"判断（BootReceiver L55）反过来依赖上述 setDefaultHome 的结果。

## 6. zty 安装 ztp（初始化向导全流程）

`InitGuideActivity` / `InitGuideViewModel`（`zty/.../launcher/guide/`）：

1. `checkOSVersion()` → `GET /api/v1/pub/platform/check/system?system=Build.DISPLAY`；非定制包弹"是否继续安装"。
2. `activateDeviceManager()` → 引导激活设备管理器（`AdminReceiver`）→ Knox/HEM 许可激活。
3. 引导授予 **PACKAGE_USAGE_STATS + WRITE_SETTINGS**；期间 `SettingSafeGuard`（L1040-1343）10 秒窗口、10ms 轮询顶部应用，发现用户进入 `com.android.settings.DeviceAdminAdd` 三次即 `simulateFatalCrash()` 强制进安全模式（防逃逸）。
4. `doLast()`（L380-470）：发现装了**错配变体**（学生机装了教师版等）→ `setApplicationUninstallationEnabled + uninstallApplication` 先卸掉 → `downloadBusinessClient(forceAuto)`。
5. **下载**（`InitGuideViewModel.downloadBusinessClient` L643 + `ZtyClientUtil`）：
   - `needUseInnerApk()`（DynamicConfig `need_use_inner_apk`）为真 → `downloadOffline`：读 **assets 内置 `apk/com.xh.zhitongyun{stu|tch}.apk`** 拷到 `{bakPath}/zhitongyun.apk`；
   - 否则在线：先 `GET /api/v1/pub/platform/check/device`（设备入库校验，未入库弹"非学海设备！请将设备号提供给运营"）；再 `GET /api/v2/platform/apk?appId&versionCode`（或 `launcher_dynamic.ini` 的 `download_config_url`）→ `{url, checksum}` → 下载（**MD5 校验**）。
6. **安装** `installBusinessClient()`：`AppInstallManager.addToInstallPool(AppUpdateTask)` 排队，走 MDM 通道（Knox/Root 静默；标准机 VIEW+package-archive 用户确认）。失败分支：`ApkFileError` 删文件重试；`ExecuteError` → `installFailed()` 会 `setApplicationUninstallationEnabled + uninstallApplication(ztp)` 清场。
7. **回拉起**：`PACKAGE_ADDED/REPLACED` → zty `PackageReceiver` → `setZtyUpdating(false)` → `onAppUpdated` → HEM 机型 `addRuntimePermissionFixAppList([ztp])` 延迟 5s，其余 1s → `openZtyClient`。
8. 拉起前 `tryInitialize`（`PolicyManagerExtKt.java` L15-28）：`wipeRecentTasks()` + `isZtyUpgraded()`（zty 自身 versionCode vs `KeepConfig("last_version")`）→ 刚升级或 ztp 未安装则 `lock(false)`（系统+业务全锁，含"禁用所有非白名单应用直到 ztp 登录"）并记录版本号；否则仅 `lock(true)`（系统锁）。

## 7. 相关：ztp 自我更新的等待协作

ztp 自更新（应用列表含自身包名，见 `07-app-management.md`）期间置 `SessionData.setZtyUpdating(true)`；zty 的 `MainViewModel.onResume()` 检测到该标志会**等待安装结果**（"智通平台正在更新中, 等待安装结果..."），ztp 安装完成的 `PACKAGE_REPLACED` 广播解除等待并重新拉起。

## 8. 关键源码索引

| 文件 | 作用 |
|------|------|
| `zty/.../launcher/receiver/BootReceiver.java` | 开机自启（含 HEM 双条件） |
| `zty/.../launcher/MainViewModel.java` | 拉起判定链 / 等待 ztp 更新 |
| `zty/.../launcher/util/ZtyClientUtil.java` | 启动/下载/安装 ztp 的全部工具方法 |
| `zty/.../launcher/util/ZtyFlagManager.java` | 唤醒计数（≤30）与异常标记 |
| `zty/.../launcher/util/PolicyManagerExtKt.java` | tryInitialize / tryUpgrade → lock() |
| `zty/.../system/mdm/KeepLiveService.java` | 文件锁看门狗 LockThread |
| `zty/.../launcher/guide/InitGuideViewModel.java` | 初始化向导 / 下载安装 ztp |
| `zty/.../launcher/receiver/PackageReceiver.java` | 包增删改监听（驱动 ztp 更新态） |
| `zty/.../launcher/receiver/BusinessReceiver.java` | mark_zty_error / mark_zty_normally |
| `ztp/.../common/sdk/MdmHolder.java` | 持锁 + 绑定 MDM 服务 + 传参 |
| `ztp/.../receiver/BootReceiver.java` | 关机埋点（无自启） |
