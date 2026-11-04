---
title: "Tinker 热修复（Hotfix）"
description: "智通平台基于腾讯 Tinker 的热修复机制：补丁下发、下载、加载、回滚、上报"
categories:
  - 技术解析
excerpt: 智通平台通过腾讯 Tinker（1.9.14.7）实现热修复。补丁信息由学海服务器通过 CPVD 缓存下发，补丁文件托管在阿里云 OSS（xhzty.oss-cn-hangzhou.aliyuncs.com），客户端按 1/2/4/6 小时轮询拉取并下载安装。
---

# Tinker 热修复（Hotfix）

## 概述

智通平台使用**腾讯 Tinker**（版本 `1.9.14.7`，见 manifest `tinker_version`）实现热修复。整个系统由以下部分组成：

1. **学海服务器**：通过 CPVD 缓存下发补丁信息（`hotfix_patch_infos`）。
2. **阿里云 OSS**：托管补丁文件（`patch_signed.apk`）。
3. **智通平台客户端**：轮询补丁信息、下载补丁、交给 Tinker 安装、重启生效、上报结果。

## 关键类

| 类 | 作用 |
|---|---|
| `com.p017xh.xhcore.common.hotfix.TinkerPatchUtil` | 热修复总入口，初始化 Tinker、轮询补丁 |
| `com.p017xh.xhcore.common.hotfix.TinkerPatchTaskHandler` | 轮询调度器（1/2/4/6 小时间隔） |
| `com.p017xh.xhcore.common.hotfix.TinkerAliyunPatchUtil` | 从阿里云 OSS 下载补丁 |
| `com.p017xh.xhcore.common.hotfix.tinker.util.TinkerManager` | Tinker 安装、补丁版本管理、回滚 |
| `com.p017xh.xhcore.common.hotfix.tinker.service.SampleResultService` | 补丁安装结果处理、进程重启 |
| `com.p017xh.xhcore.common.hotfix.UploadLoadReporter` | 加载阶段错误上报 |
| `com.p017xh.xhcore.common.hotfix.UploadPatchReporter` | 补丁阶段错误上报 |
| `com.p017xh.xhcore.common.hotfix.UploadPatchListener` | 补丁接收监听 |
| `com.p017xh.xhcore.common.hotfix.PatchUpdateBroadcastUtil` | 补丁更新广播 |
| `com.p017xh.xhcore.common.hotfix.bury.HotfixBuryManager` | 热修复埋点 |
| `com.xuehai.platform.hotfix.HotfixPatchInfoManager` | 补丁信息读写（CPVD 缓存） |
| `com.xuehai.platform.hotfix.PatchInfo` | 补丁信息模型 |
| `com.tinkerpatch.sdk.loader.TinkerPatchReflectApplication` | 反射 Application（manifest 入口） |
| `com.tinkerpatch.sdk.loader.TinkerPatchApplicationLike` | Tinker ApplicationLike |

## 初始化流程

### 1. Application 入口

manifest 中 `android:name="com.tinkerpatch.sdk.loader.TinkerPatchReflectApplication"`。

`TinkerPatchReflectApplication` 继承 `TinkerApplication`：
- 构造参数：`(15, "com.tinkerpatch.sdk.loader.TinkerPatchApplicationLike", TinkerLoader.class.getName(), false)`。
- `attachBaseContext()` 时从 manifest meta-data `TINKER_PATCH_APPLICATION` 读取真实 Application 类名（`com.xuehai.launcher.App`），反射创建实例。
- 通过反射把 `ActivityThread.mInitialApplication`、`mAllApplications`、`LoadedApk.mApplication` 替换为真实 Application。
- 把真实 Application 注入 `TinkerPatchApplicationLike.application` 字段。

### 2. Tinker 初始化

`XhBaseApplication.onCreate()` 调用 `TinkerPatchUtil.initTinkerPatch(this)`：

```java
if (XHAppConfigProxy.getInstance().getTinkerConfig().isTinkerEnable()) {
    ApplicationLike appLike = TinkerPatchApplicationLike.getTinkerPatchApplicationLike();
    TinkerManager.setTinkerApplicationLike(appLike);
    // 设置上报回调（写入崩溃统计附加信息）
    SampleTinkerReport.setReporter(...);
    TinkerManager.initFastCrashProtect();          // 快速崩溃保护
    TinkerManager.setUpgradeRetryEnable(true);     // 升级重试
    TinkerManager.setPatchRollbackOnScreenOff(config.isPatchRollbackOnScreenOff());
    TinkerManager.setPatchRestartOnScreenOff(config.isPatchRestartOnScreenOff());
    TinkerManager.installTinker(appLike);          // 安装 Tinker
    Tinker.with(appLike.getApplication());
    if (ShareTinkerInternals.isInMainProcess(application)) {
        fetchPatchUpdateWithMinimize();            // 主进程空闲时拉取补丁
        PatchUpdateBroadcastUtil.registerPatchUpdateReceiver(application);
    }
    // 上报补丁版本和加载结果
    CrashOrErrorStatisticsInfo.extraUploadMessage.put("tinkerPatchVersion", ...);
    CrashOrErrorStatisticsInfo.extraUploadMessage.put("tinkerLoadResult", ...);
}
```

`TinkerConfig` 默认 `tinkerEnable=false`，但 `App.getAppConfig()` 中显式 `setTinkerEnable(true)` 开启。

### 3. 补丁轮询

`fetchPatchUpdateWithMinimize()` 在主线程空闲时启动 `TinkerPatchTaskHandler`。

`TinkerPatchTaskHandler` 的轮询间隔（`getLoopIntervalMillis`）：
- `currentPoolCount % 4 == 0` → **6 小时**
- `% 4 == 1` → **1 小时**
- `% 4 == 2` → **2 小时**
- `% 4 == 3` → **4 小时**

每次轮询调用 `tryFetchUpdate()`：

1. 读取当前已加载补丁版本（`TinkerManager.loadPatchVersion()`，SP key `{tinkerId}_patchVersion`）。
2. 从 CPVD 缓存读取补丁信息（`HotfixPatchInfoManager.queryPatchInfo(packageName)`）。
3. 若 `patchInfo.version == 当前App版本号`：
   - `isActive()`（status=0）：比较 patchId 与当前版本，若更新则拉取。
   - `isSuspend()`（status=1）：暂停，不操作。
   - `isRollback()`（status=2）：`TinkerManager.onPatchRollback()` 回滚。
4. 拉取间隔控制：SP `fetch_patch_last_check_millis`，**30 分钟内不重复拉取**。

### 4. 补丁下载

`TinkerManager.downloadPatch(patchId)` → `TinkerAliyunPatchUtil.downloadPatchWithAliyunObjectKey()`：

- 下载 URL：`http://xhzty.oss-cn-hangzhou.aliyuncs.com/patch/{appId}/{tinkerId}/{debug|release}/{patchId}/patch_signed.apk`
- 保存路径：`{filesDir}/download/patch/patch_signed.apk`
- 下载完成后：
  - `TinkerManager.savePatchVersion(patchId)`。
  - `TinkerInstaller.onReceiveUpgradePatch(app, localPath)` 交给 Tinker 安装。

### 5. 补丁安装与重启

- Tinker 在 `:patch` 进程（`TinkerPatchService`）中执行补丁合并。
- 完成后 `SampleResultService.onPatchResult()`：
  - 删除原始补丁文件。
  - 若需要重启：
    - 后台时直接 `restartProcess()`。
    - 前台且 `patchRestartOnScreenOff=true` 时，**等待屏幕熄灭后重启**。
  - `restartProcess()`：发送 `ReportBroadCast`（extra `tinkerpatch_intent_patch_restart=true`），1 秒后通过 AlarmManager 触发，然后 `XHAppUtil.killAllProcess()`。

## 补丁信息模型

`PatchInfo`：
```json
{
  "packageName": "com.xh.zhitongyunstu",
  "version": 312504,          // 对应 App versionCode
  "distributionId": "...",
  "patchId": "...",           // 补丁版本号
  "strategy": "...",
  "status": 0                 // 0=ACTIVE 1=SUSPEND 2=ROLLBACK
}
```

`RemotePatchInfos` 存储在 CPVD 缓存 key `hotfix_patch_infos`。

服务器通过资源同步数据码 `HOTFIX_PATCH_INFOS`（`CA106004SB1010070003`）通知客户端更新补丁信息，`ContentProviderReceiver` 收到后调用 `AppModel.reqPatchInfos()` 拉取。

## 错误上报

所有 Tinker 错误通过 `LogManager.getInstance().uploadLog()` 上报到学海日志服务器，带 `errorTag=...Tinker` 前缀：

| 上报点 | 触发条件 |
|---|---|
| `onLoadException` | 加载异常 |
| `onLoadInterpret` | 解释模式加载异常 |
| `onLoadPackageCheckFail` | 补丁包校验失败 |
| `onLoadPatchListenerReceiveFail` | 补丁监听接收失败 |
| `onLoadPatchInfoCorrupted` | 补丁信息损坏 |
| `onLoadFileMd5Mismatch` | 文件 MD5 不匹配 |
| `onLoadResult` | 加载结果（loadCode≠0 时） |
| `onPatchDexOptFail` | dex 优化失败 |
| `onPatchException` | 补丁异常 |
| `onPatchInfoCorrupted` | 补丁信息损坏 |
| `onPatchVersionCheckFail` | 版本校验失败 |
| `onPatchPackageCheckFail` | 包校验失败 |
| `onPatchTypeExtractFail` | 解压失败 |

## 快速崩溃保护

`SampleUncaughtExceptionHandler`（`initFastCrashProtect` 时注册为默认异常处理器）：

1. **快速崩溃保护**：若 Tinker 加载成功且启动 10 秒内崩溃，记录崩溃次数到 SP `tinker_share_config`（key 为补丁版本）。**连续崩溃 3 次**则 `cleanPatch()` 清除补丁。
2. **Xposed 崩溃处理**：若检测到 Xposed 且崩溃信息含 `"Class ref in pre-verified class resolved to unexpected implementation"`，清除补丁并禁用 Tinker。

## 回滚机制

`TinkerManager.onPatchRollback()`：
- 若 `patchRollbackOnScreenOff=true`，等待屏幕熄灭后 `rollbackPatchDirectly()`（清补丁 + 重启）。
- `cleanAll()`：清空补丁版本 SP + `Tinker.with(app).cleanPatch()`。

## 相关 manifest 组件

| 组件 | 说明 |
|---|---|
| `TinkerPatchReflectApplication` | Application 入口 |
| `SampleResultService` | 补丁结果服务（`BIND_JOB_SERVICE`） |
| `TinkerPatchForeService` | 前台服务（`:patch` 进程） |
| `TinkerPatchService` / `InnerService` | 补丁合并服务（`:patch` 进程） |
| `DefaultTinkerResultService` | 默认结果服务 |
| `ActivityStubs.*` | Tinker 热插拔 Activity 占位（STD/SGT/SGTK/SI 系列） |
| meta-data `TINKER_PATCH_APPLICATION` | 真实 Application 类名 |
| meta-data `TINKER_ID` | `tinker_id_v3.125.04.20251125S_312504` |

## 安全分析

1. **补丁无签名校验**：下载 URL 为明文 HTTP（`http://xhzty.oss-cn-hangzhou.aliyuncs.com`），Tinker 的 `ShareSecurityCheck` 会校验补丁签名，但下载通道本身可被中间人替换。
2. **补丁可执行任意代码**：Tinker 补丁本质是 dex 补丁，可修改任意类方法，等同于远程代码执行。
3. **补丁信息来自服务器**：`hotfix_patch_infos` 由服务器下发，服务器可随时下发恶意补丁。
4. **回滚/暂停机制**：服务器可通过 `status=1`（暂停）或 `status=2`（回滚）控制补丁生命周期。

## 卸载后重装行为

智通平台被卸载（用户手动卸载或开发者模式自卸载）后重装，Tinker 热修复的状态如下：

### 卸载时被清除（应用私有数据）

| 数据 | 位置 | 影响 |
|---|---|---|
| 补丁版本 SP | `patch_config`（SharedPreferences） | `loadPatchVersion()` 返回空 |
| 补丁文件 | `{filesDir}/download/patch/patch_signed.apk` | 已下载补丁丢失 |
| Tinker 补丁目录 | `{filesDir}/tinker/` | 已加载补丁丢失 |
| 补丁信息缓存 | `zaze_provider.db`（CPVD `hotfix_patch_infos`） | 补丁信息丢失 |
| 快速崩溃计数 | `tinker_share_config`（SharedPreferences） | 崩溃保护计数清零 |

### 重装后的行为

1. **补丁版本归零**：`TinkerManager.loadPatchVersion()` 返回 `""`。
2. **重新拉取补丁**：`TinkerPatchUtil.tryFetchUpdate()` 发现 `isPatchAddedOrUpdated("", patchId)` 为 true（新 patchId > 空串），立即触发 `fetchPatchUpdate()`。
3. **重新下载补丁**：从阿里云 OSS 重新下载 `patch_signed.apk` 并安装。
4. **补丁信息重新获取**：`hotfix_patch_infos` 缓存被清空，需等服务器重新下发 `HOTFIX_PATCH_INFOS` 数据码（或应用启动时主动拉取）。
5. **快速崩溃保护重置**：`tinker_share_config` 清空，崩溃计数从 0 开始。
6. **Tinker 重新初始化**：`XhBaseApplication.onCreate()` → `TinkerPatchUtil.initTinkerPatch()` 重新安装 Tinker 并注册补丁更新广播。

**结论**：卸载重装后热修复系统完全重置，但会**自动重新拉取并应用最新补丁**，设备仍处于学海的可控范围内。