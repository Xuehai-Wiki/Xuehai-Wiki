---
title: "智通平台入口点索引"
description: "智通平台所有入口点：Application 初始化、Activity、Service、Receiver、Provider、路由、IPC 通道"
categories:
  - 索引
excerpt: 智通平台的全部入口点索引：从 Application 启动链、manifest 组件、ZRouter 路由表、ContentProvider IPC 通道到各功能模块的入口函数。
---

# 智通平台入口点索引

## 1. Application 启动链

### 入口类

| 类 | 说明 |
|---|---|
| `com.tinkerpatch.sdk.loader.TinkerPatchReflectApplication` | **manifest Application**，Tinker 反射壳 |
| `com.xuehai.launcher.App` | 真实 Application（`TINKER_PATCH_APPLICATION` meta-data 指定） |
| `com.xuehai.launcher.ModuleApplication` | App 的父类，注册模块 ApplicationLike |
| `com.xuehai.launcher.common.base.XhApplication` | 模块 Application 的父类，核心初始化 |
| `com.xuehai.launcher.common.base.BaseApplication` | XhApplication 的父类，Activity 生命周期管理 |
| `com.p017xh.xhcore.common.base.XhBaseApplication` | 底层框架 Application，Tinker/日志/埋点初始化 |

### 启动时序

```
TinkerPatchReflectApplication.attachBaseContext()
  └─ 反射创建 App 实例，替换 ActivityThread 中的 Application
  └─ 注入 TinkerPatchApplicationLike.application

App.onCreate()
  └─ FileCheckUtil.autoCheckXhDir()   // 检查/创建 xuehai 目录
  └─ super.onCreate() → ModuleApplication.onCreate()
  │    └─ XhApplication.onCreate()
  │    │    └─ BaseApplication.onCreate()
  │    │    │    └─ XhBaseApplication.onCreate()
  │    │    │    │    └─ MatrixUtil.init()          // APM 监控
  │    │    │    │    └─ TinkerPatchUtil.initTinkerPatch()  // 热修复
  │    │    │    │    └─ CPVDManager.init()          // ContentProvider 数据层
  │    │    │    │    └─ initEnvironment()           // 服务器环境
  │    │    │    │    └─ LogManager.init()           // 日志
  │    │    │    │    └─ initBaseRequestInfo()       // 基础请求信息
  │    │    │    │    └─ DataCollectionUtil.listenerAppLifecycle()
  │    │    │    │    └─ ActivityListAdapter.init()
  │    │    │    │    └─ startLogcatService()        // logcat 日志服务
  │    │    │    │    └─ SystemBarTintManager.init()
  │    │    │    │    └─ DensityUtil.initAppDensity()
  │    │    │    │    └─ BuryManager.start()         // 埋点
  │    │    │    │    └─ BuryStrategyManager.init()
  │    │    │    └─ KeepRunningManager.setLauncherKeepRunningTime()
  │    │    │    └─ Configuration.loadEnvironment()
  │    │    │    └─ registerActivityLifecycleCallbacks()
  │    │    │    └─ serverTypeMap 初始化（各服务器 URL）
  │    │    │    └─ ReleaseNoteReminder.init()
  │    │    │    └─ bindService/startService(DownloadService)
  │    │    └─ MyUncaughtExceptionHandler.init()     // 崩溃捕获
  │    │    └─ init() → initLog() + Permission.initPermission()
  │    │    └─ ZRouter.init(this, LAUNCHER_MDM_STU)  // 路由初始化
  │    │    └─ applicationLike.preCreate()
  │    │    └─ BaseRemoteDataSource.initRequest()
  │    │    └─ doOnMainProcess()                     // 主进程
  │    │         └─ ClockUtil.start()
  │    │         └─ applicationLike.onCreateOnMainProcess()
  │    │         └─ clipboard()                      // 剪贴板监控
  │    └─ ZRouter.registerInterceptor(PlatformInterceptor)
  │    └─ CPVDManager.setCallback(ContentProviderReceiver)
  └─ EduOauth.registInstance()   // 讯飞 OAuth
  └─ init() → ServiceBury.BURY_LOG=true, CPVDManager.init(this,"CA106004"), RxJavaPlugins
  └─ doOnMainProcess() → ResourceUpdateManager.startLooper(), WifiCompat, FontReceiver
```

### attachBaseContext 链

```
TinkerPatchReflectApplication.attachBaseContext()
  └─ TinkerApplication.attachBaseContext()   // Tinker 加载补丁
  └─ XhBaseApplication.attachBaseContext()
  │    └─ mContext = this
  │    └─ XHAppConfigProxy.setConfig(getAppConfig())
  │    └─ XCrashUtil.init()                  // 原生崩溃捕获
  └─ BaseApplication.attachBaseContext()
  │    └─ created = new Object()
  └─ XhApplication.attachBaseContext()
       └─ AuthorityUris.setAuthorityUris("com.xh.zhitongyun.provider")
       └─ MultiDex.install()
       └─ CrashLevelManager.initLevel()      // 崩溃级别
       └─ CrashLevelManager.onAppStart()     // 启动计数
       └─ applicationLike.attachBaseContext() // 各模块 ApplicationLike
```

## 2. 模块 ApplicationLike

`ModuleApplication.getApplications()` 注册 5 个模块：

| 模块 | 类 | 初始化内容 |
|---|---|---|
| App | `ApplicationLikeApp` | 包接收器、保活时间接收器、流量分析、屏幕状态监听、应用锁刷新 |
| Control | `ApplicationLikeControl` | 控制接收器、场景控制、考试模式、护眼、控制模式启动 |
| User | `ApplicationLikeUser` | 屏幕解锁时刷新 token、主题初始化 |
| MDM | `ApplicationLikeMdm` | License 接收器、设备安全检测、MDM 用户特权规则 |
| Message | `ApplicationLikeMessage` | 通知接收器、推送服务、消息初始化 |

## 3. Activity 入口（manifest）

| Activity | 路由/Intent | 说明 |
|---|---|---|
| `WelcomeActivity` | MAIN / `com.xh.zhitongyun.launcher` / `xhzytpt://com.xh.zhitongyun/zhitongyun` | **启动页**，崩溃时跳安全页 |
| `HomeActivity` | `/app/home` | 主页（桌面） |
| `LoginActivity` | `/user/login` | 登录页 |
| `DebugActivity` | `app/debug` | 调试页 |
| `DeveloperActivity` | `/app/developer` | 开发者模式 |
| `SafeActivity` | `/app/safe` | 安全模式页 |
| `RemoteAssistActivity` | `/app/assist` | 远程协助状态页 |
| `EmptyActivity` | `com.xh.zhitongyun.empty` | MDM 调起亮屏 |
| `EntryActivity` | `com.xh.zhitongyun.plugin.entry` | 分享/插件入口 |
| `AgentActivity` | `com.xh.zhitongyun.action.agent_login` | 开放 SDK 登录代理（`:openSdk` 进程） |
| `OutLoginActivity` | `com.xh.zhitongyun.action.out_login` | 退出登录 |
| `OutAppLockPasswordActivity` | `com.xuehai.action.unlock` | 应用锁解锁 |
| `AppStorageActivity` | `com.xuehai.action.storage.clear` | 存储清理 |
| `ConfigActivity` / `NetworkLineActivity` | `/app/config` / `/app/network/lines` | 隐藏配置页（环境切换/网络线路） |
| `WebViewActivity` | - | 调试 WebView |

## 4. Service 入口（manifest）

| Service | 进程 | 说明 |
|---|---|---|
| `AssistService` | `:assist` | 远程协助服务 |
| `LogService` | `:log` | 日志服务 |
| `LauncherService` | 主进程 | 通用服务 |
| `DownloadService` | 主进程 | 下载服务（前台 dataSync） |
| `AppStorageService` | 主进程 | 存储清理服务 |
| `SyncService` | 主进程 | 控制同步服务 |
| `LogcatService` | 主进程 | logcat 日志服务 |
| `SampleResultService` | 主进程 | Tinker 补丁结果服务 |
| `TinkerPatchService` / `InnerService` | `:patch` | Tinker 补丁合并 |
| `TinkerPatchForeService` | `:patch` | Tinker 前台服务 |
| `DefaultTinkerResultService` | 主进程 | Tinker 默认结果服务 |
| `PushService` | 主进程 | 消息推送服务 |
| `HeapAnalyzeService` | `:heap_analysis` | 内存分析服务 |

## 5. Receiver 入口（manifest）

| Receiver | Action | 说明 |
|---|---|---|
| `BootReceiver` | `BOOT_COMPLETED` / `ACTION_SHUTDOWN` | 开机/关机（关机时记录护眼埋点） |
| `LauncherReceiver` | `com.xuehai.service.box.force_check` / `auto_check` | 盒子强制/自动检查 |
| `LicenseReceiver` | `com.xuehai.mdm.Knox` | MDM License 状态（动态注册） |
| `ContentProviderReceiver` | CPVD 回调 | 资源同步通知（动态注册） |

## 6. Provider 入口（manifest）

| Provider | Authority | 说明 |
|---|---|---|
| `MyContentProvider` | `com.xh.zhitongyun.provider` | **核心 IPC 通道**（导出） |
| `FileProvider` | `com.xh.zhitongyunstu.fileProvider` | 文件共享 |
| `InitContentProvider` | `com.xh.zhitongyunstu.initControl.provider` | 控制初始化 |
| `InitProvider` | `com.xh.zhitongyunstu.open.init.provider` | 开放 SDK 初始化 |
| `AnsContentProvider` | `com.xh.zhitongyunstu.AnsContentProvider` | 埋点数据 |
| `ProcessLifecycleOwnerInitializer` | `com.xh.zhitongyunstu.lifecycle-process` | 生命周期 |

## 7. ZRouter 路由表

`RouterPath` 常量（部分）：

| 路径 | 目标 |
|---|---|
| `/app/welcome` | WelcomeActivity |
| `/app/home` | HomeActivity |
| `/user/login` | LoginActivity |
| `/app/assist` | RemoteAssistActivity |
| `/app/developer` | DeveloperActivity |
| `/app/debug` | DebugActivity |
| `/app/config` | ConfigActivity |
| `/app/network/lines` | NetworkLineActivity |
| `/app/network/auth` | NetworkAuthActivity |
| `/app/advert` | AdvertActivity |
| `/app/storage` | AppStorageActivity |
| `/control/main` / `/control/v2/main` | ControlActivity / ControlV2Activity |
| `/message` / `/message/detail` | MessageActivity / MessageDetailActivity |
| `/user/center` | UserCenterActivity |
| `/user/signature` | SignatureActivity |
| `/user/graduate` | StudentGraduateActivity |
| `/user/count/down` | CountDownActivity |
| `/qr/code` | QrScannerActivity |
| `/ty/webview` | TYWebViewActivity |
| `/photoplus/ui/...` | 拍照组件 |

## 8. IPC 通道

### Messenger（远程协助）

- `IpcHelper`：`BC_ASSIST=2000001`、`BC_GETSTATUS=2000002`、`BR_LOOP=1000001`。
- `AssistManager` 绑定 `AssistService`（`:assist` 进程），通过 Messenger 发送协助通知。

### AIDL（MDM 设备管理）

- `MdmAidlInterface`：`com.xuehai.system.mdm.action_aidl`。
- `MdmServiceManager` 绑定 `com.xuehai.launcher`（学生）或 `com.xuehai.response_launcher_teacher`（教师）的 MDM 服务。
- 140+ 个设备管理方法。

### ContentProvider（智通云数据同步）

- `MyContentProvider`（authority `com.xh.zhitongyun.provider`）是智通平台与智通云/其他学海应用共享数据的核心通道。
- 数据码（`ApiDataCode`）触发各模块刷新：

| 数据码 | 触发动作 |
|---|---|
| `CA106004SA1060030001` REMOTE_CONFIG | 拉取远程配置 |
| `CA106004SA1060030002` LOCAL_BRUSH_SECRET_KEY | 拉取本地刷机密钥 |
| `CA106004SA1060030003` STUDY_DESK_BG_CHANGE_KEY | 刷新学习桌背景 |
| `CA106004SA1060030011` AUTO_LOG_REPORTING | 自动日志上报 |
| `CA106004SB1030140001` REMOTE_ASSIST | **发起远程协助** |
| `CA106004SB1030150001` SCENE_CONTROL | 拉取场景控制 |
| `CA106004SB1010030001` TENANT_CHANGED | 租户变更 |
| `CA106004SB1010130001` MESSAGE_LIST | 拉取消息列表 |
| `CA106004SB1010070001` APP_INFO_LIST | 应用信息列表（盒子检查） |
| `CA106004SB1010070002` FIREWALL_DOMAIN_RULES | 更新域名防火墙 |
| `CA106004SB1010070003` HOTFIX_PATCH_INFOS | **拉取热修复补丁信息** |
| `CA106004SB1010070004` FIREWALL_CONFIG | 拉取防火墙配置 |
| `CA106004SB1010070005` APP_MODULE_PERMISSION | 应用模块权限 |
| `CA106004SB1010070006` FIREWALL_USER_APP_CONFIG | 用户应用防火墙配置 |

## 9. 各功能入口函数

| 功能 | 入口类.方法 |
|---|---|
| 登录 | `LoginViewModel.login()` / `LoginActivity` |
| 获取 token | `AccountModelImpl` / `LoginSdkModelImpl` |
| 应用列表 | `AppModel.requestUserAppList()` |
| 应用安装/卸载 | `AppUpdateManager.realDownloadApp()` / `ApplicationPolicyProxy.installApplication()` |
| 夜禁/控制 | `ControlRepository.startControlMode()` / `ControlServer.startControl()` |
| 每日一言 | `DayWords*`（user 模块） |
| 日志上报 | `ClientLogManager` / `LogManager.uploadLog()` / `LogUpload` |
| 远程协助 | `AssistManager.requestAssist()` / `AssistService.doAssist()` |
| 热修复 | `TinkerPatchUtil.initTinkerPatch()` / `tryFetchUpdate()` |
| 崩溃处理 | `MyUncaughtExceptionHandler.uncaughtException()` |
| 原生崩溃/ANR | `XCrashUtil.init()`（xcrash SDK，tombstone 解析后上报） |
| 安全模式 | `SafeActivity` / `CrashLevelManager` |
| 开发者模式 | `DeveloperActivity` / `DeveloperViewModel` |
| 设备管控状态上报 | `DeviceControlManager.checkDeviceControlStatus()` |
| 设备安全检测 | `DeviceChecker.detectSafely()` |
| 消息推送 | `LauncherPushService` / `MessageModel.initializePushMessage()` |
| 资源更新 | `ResourceUpdateManager.startLooper()` |
| 网络认证 | `NetworkAuthActivity` / `NetworkBusiness` |

## 10. 服务器地址

| 用途 | 地址 |
|---|---|
| 平台 API | `https://ztp.yunzuoye.net` |
| 微服务 | `https://ms.yunzuoye.net` |
| 大数据/埋点 | `https://trackdata.yunzuoye.net` |
| 控制服务 | `https://control.yunzuoye.net` |
| 任务奖励 | `https://task-reward.yunzuoye.net` |
| 讯飞 OAuth | `http://dn.yqer.cn` |
| 补丁 OSS | `http://xhzty.oss-cn-hangzhou.aliyuncs.com` |
| 文件 OSS | `http://xuehaifile.oss-cn-hangzhou.aliyuncs.com` |

> 内嵌 **任务奖励（TaskReward）** 子系统的全部入口（23 个 manifest Activity、ARouter 路由 `/taskRewardStu/...`、Flutter 计划页、以及 `task-reward.yunzuoye.net` 的完整 API）见 `14-taskreward-module.md`。