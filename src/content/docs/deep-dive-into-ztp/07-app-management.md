---
title: "应用管理子系统"

description: "智通平台拉取、下载、安装、更新、卸载学生应用的完整流水线，及对应 API 与本地存储"

categories:
  - 技术解析
excerpt: 智通平台的应用管理流水线：从服务器拉取应用列表、解析、对比已安装版本、下载 APK、安装、更新、卸载、校验签名，以及相关的服务（DownloadService/BoxServer）与存储位置。
---

# 应用管理子系统

## 一、总体流程

智通平台的核心职责之一：**从学海服务器 fetch 最新应用数据，并自动安装或卸载或更新**。流程如下：

```
HomeViewModel.loadAppPages()
  → AppModel.requestUserAppList(version)        // 拉取服务器应用列表
  → parseAppList()                              // 解析
  → 对比本地已装应用（getNeedInstallList/getNeedUpdateList/getNeedShowList）
  → DownloadService.downloadFile()              // 下载 APK
  → ApplicationManager/AppInstallHelper 安装
  → 更新/卸载 由 AppUpdateManager 调度
  → 上报安装/卸载结果（AppRemoteDataSource）
```

## 二、应用列表拉取 API

应用列表通过 `com.xuehai.launcher.application.data.AppRemoteDataSource` 获取：

| API | 方法 | 说明 |
|-----|------|------|
| `GET /api/v1/pub/platform/users/{userId}/apps/` | GET | 拉取用户应用列表（带 `version` 参数，`needVerifyResponseSign()` 校验响应签名） |
| `GET /api/v1/pub/applications/offshelf/simple` | GET | 拉取已下架应用列表 |
| `POST /api/v1/pub/application/patch/distribution` | POST | 获取热修复补丁分发信息（HotfixLocalInfos） |
| `POST /api/v1/pub/distribution/apps/legality/check` | POST | 检测 APP 签名合法性（签名校验） |
| `GET /api/v1/pub/user/{userId}/app/modules` | GET | 拉取用户应用模块权限 |
| `GET /api/v1/applications/{appId}/versions/{version}/info` | GET | 拉取应用更新信息 |
| `POST /api/v1/users/{userId}/devices/{deviceId}/apps/changes` | POST | 上传应用安装状态变化 |
| `POST /api/v1/users/{userId}/devices/{deviceId}/tasks/result` | POST | 上报更新任务结果 |

> 早期的应用列表接口为 `/api/v2/platform/apk`（appId=mdm_stu_to_c，versionCode 参数），详见 xuehai-sign.md 中的签名示例。

## 三、应用模型（AppModel / AppModelImpl）

`AppModel`（接口）定义在 `com.xuehai.launcher.common.model`，实现在 `com.xuehai.launcher.application.data.AppModelImpl`。核心方法：

| 方法 | 说明 |
|------|------|
| `getApps()` | 已安装应用列表（StateFlow，首页订阅） |
| `requestUserAppList(version)` | 拉取服务器应用列表 |
| `getUserNeedInstallAppList()` | 需要安装的应用 |
| `getNeedUpdateList(packageNames)` | 需要更新的应用 |
| `getNeedShowAppList()` | 需要在桌面显示的应用 |
| `getThirdPartyAppList()` | 第三方应用列表 |
| `parseAppList(json)` | 解析服务器应用列表 JSON |
| `unShelveAppList()` | 处理已下架应用（卸载） |
| `reqCheckAppSignAndUninstallAppList(infoList)` | 校验签名并卸载非法应用 |
| `reqPatchInfos(localInfos)` | 获取热修复补丁 |
| `updateAppInstalledStatus(list, uploadStatus)` | 更新并上报应用安装状态 |
| `updateAppUpdateStatus(list, uploadStatus)` | 更新并上报应用更新状态 |

## 四、下载与安装

### 4.1 DownloadService

`com.xuehai.launcher.common.download.DownloadService`（Manifest 中前台服务 `foregroundServiceType="dataSync"`）：

- 前台服务，Channel `ZtyDownloadServiceChannel`，通知 ID `99999`
- `downloadFile(LRequest, interceptors)`：拦截器链 `[DownloadCheckInterceptor, 业务拦截器, OkHttpDownload]` → `RealInterceptorChain.process()`
- 回调 `DownloadCallback`：`onStart` / `onProgress`（更新通知"下载进度: x%"）/ `onSuccess`（保存到 `savePath`）/ `onFailed`

### 4.2 DownloadManager

`com.xuehai.launcher.common.download.DownloadManager`：`start()` 启动下载调度（HomeViewModel.loadData() 调用）。

### 4.3 应用安装/更新/卸载

- 由 `com.xuehai.launcher.data.util.app.ApplicationManager`（初始化/设备配置档位/输入法）+ `com.xuehai.launcher.application.util.AppUpdateManager`（更新管理，HomeActivity 调用）驱动
- 安装：下载的 APK 落盘后通过 PackageInstaller 安装（请求 `REQUEST_INSTALL_PACKAGES` 权限）
- 卸载：`REQ_DEQUEST_DELETE_PACKAGES` 权限；`unShelveAppList()` 卸载已下架应用；签名校验失败应用自动卸载
- 卸载前移除 AppLock 等记录；卸载后从桌面图标移除

## 五、盒子服务（BoxServer / service.box）

`com.xuehai.service.box.BoxServer`：基于 `FileServiceDispatcher` 的文件服务（`ServerConfig.getConfig().boxFileServiceConfig()`），用于应用包分发：

- `isBoxEnable()` — 盒子是否启用
- `checkBoxStatus()` — 检查盒子服务集群状态
- `requestDownloadUrl()` — 请求下载地址
- `upload()` / `download()` — 上传/下载应用包

LauncherReceiver 监听 `com.xuehai.service.box.force_check` / `com.xuehai.service.box.auto_check` 广播触发盒子检查。

## 六、本地存储

- 下载的 APK：外部存储 `/sdcard/xuehai/` 下（与下载日志同区，见 03-file-io.md）
- 应用列表/配置：Room 数据库（`com.xuehai.launcher.p031db.room`，按 schoolId/userId 隔离）+ GreenDAO（SD 卡，`com.xuehai.greendao`）
- 应用图标缓存：`IconCache`（内存缓存）
- 应用状态/更新状态：`AppInstalledStatus`/`AppUpdateStatus` 实体，待上报标记后通过 `AppRemoteDataSource` 上报
- 已安装包信息：`ThemeApp`（Room 实体）

## 七、桌面图标呈现

`HomeViewModel.loadAppPages()` 拉取应用后按 `AppLayoutType` 分页（首页/研修等布局），用 `HomeAdapter`/`AppCardHolder`/`HomeItem` 渲染图标；点击图标 `AppOperateWindow`/`PersonalAppOperateWindow` 弹出操作（打开/更新/卸载/锁定等）；`AppCardX11Holder`/`AppCardX12Holder` 为特定机型图标样式。

## 八、关键类清单

| 类 | 位置 | 作用 |
|----|------|------|
| `AppRemoteDataSource` | `com.xuehai.launcher.application.data` | 应用列表/状态 API |
| `AppRepository` | `com.xuehai.launcher.application.data` | 应用数据仓库 |
| `AppModel` / `AppModelImpl` | `com.xuehai.launcher.common.model` | 应用模型接口/实现 |
| `DownloadService` / `DownloadManager` | `com.xuehai.launcher.common.download` | 下载服务/管理 |
| `BoxServer` | `com.xuehai.service.box` | 应用包盒子分发 |
| `AppUpdateManager` / `AppUpdateModel` | `com.xuehai.launcher.application.util` / `.common.model` | 更新调度 |
| `ApplicationManager` | `com.xuehai.launcher.data.util.app` | 设备应用配置/档位 |
| `AppStorageService` / `AppStorageActivity` | `com.xuehai.launcher.application.storage` | 存储清理/管理 |
| `AppDetailActivity` | `com.xuehai.launcher.application.detail` | 应用详情页 |
| `SpecialApp` | `com.xuehai.launcher.data.util.app` | 特殊应用（CWP_MAKER 等）启动与权限 |
