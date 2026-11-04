---
title: "智通平台（智通云）总体架构"

description: "智通平台是学海教育安装在学生平板上的管控/桌面/登录软件，本文从 AndroidManifest、Application 初始化链、Activity 路由三方面给出完整架构地图。"

categories:
  - 架构总览
excerpt: 智通平台（学生端 com.xh.zhitongyunstu）的总体架构：包名标识、服务器、入口点、初始化链、Welcome/Home/Login 路由与子系统文档索引。
---

# 智通平台（智通云）总体架构

## 定位

智通平台（**学生端**，包名 `com.xh.zhitongyunstu`，品牌名"智通云组件"）是学海教育预装/下发到学生平板上的**管控 + 桌面 + 登录**一体软件。它通过自动启动实现类似桌面的功能；学生开机第一眼看到的就是它的主页（HomeActivity 的图标墙），可启动 APP、查看个人主页；同时它承担账号登录（向学海服务器换取 token）并把 token 提供给学海其它软件使用；还负责从服务器拉取应用列表并自动安装/卸载/更新、执行"夜禁"时段管控、显示"每日一言"、上报日志、以及提供老师的远程协助（远程控制）。

> 版本信息：`versionCode=312504`，`versionName=v3.125.04.20251125S`，minSdk 21 / targetSdk 28，`persistent=true`（常驻进程，不易被杀）。

## 包名与客户端标识

`com.xuehai.launcher.App#createAppClientArgs()` 定义客户端参数：

| 参数 | 值 | 含义 |
|------|----|------|
| appId / clientId | `CA106004` | 客户端应用 ID（与 Tinker 补丁 AppKey 相同） |
| packageName | `com.xh.zhitongyunstu` | 应用包名（学生端；教师端为 `com.xh.zhitongyuntch`） |
| versionName | `v3.125.04.20251125S` | 版本名 |
| versionCode | `312504` | 版本号 |
| env | `Production` | 生产环境 |
| 客户端形态 | 由 `isStudentClient("student")` 判定：学生端 / 教师端 | 本包为 `com.xh.zhitongyunstu`（`...stu`），故取 zty_stu |
| 组件名 | `智通云组件` | 界面文字 |
| mdmCode | `zty_stu`（学生端）/ `zty_tea`（教师端） | MDM 代码 |
| appKey | `dsjiqw495soisoss`（学生端）/ `asdf8934589sdfsa`（教师端） | 密钥 |
| secret | `5ec34bbc9eecc360c02484ba`（学生端）/ `5ec34bc7b57f7d40cbd9ec9e`（教师端） | 密钥 |

## 主要 Server

- REST API 主域：`https://ztp.yunzuoye.net`（`/api/v2/...`）
- 文件服务器：`http://files.yunzuoye.net/XHFileServer/file/`（见 `config.properties`，可被 NetworkLine 配置覆盖）
- 教育云 OAuth：`http://dn.yqer.cn`（`EduOauth.registInstance`）

---

## 入口点（AndroidManifest 摘要）

### 进程 / 组件

| 类型 | 类名 | 作用 |
|------|------|------|
| Application | `com.tinkerpatch.sdk.loader.TinkerPatchReflectApplication` → 真实 App `com.xuehai.launcher.App` | Tinker 热修复外壳，最终实例化 `App`（TINKER_PATCH_APPLICATION=com.xuehai.launcher.App） |
| 启动 Activity | `com.xuehai.launcher.WelcomeActivity` | **MAIN/LAUNCHER**，开机第一个界面 |
| 桌面 Activity | `com.xuehai.launcher.home.HomeActivity` | 图标墙主页（登录后进入） |
| 登录 Activity | `com.xuehai.launcher.user.login.LoginActivity` | 账号/密码/短信/微信登录 |
| 欢迎空 Activity | `com.xuehai.launcher.EmptyActivity` | 自定义 action `com.xh.zhitongyun.empty` |
| 插件入口 | `com.xuehai.launcher.plugin.EntryActivity` | action `com.xh.zhitongyun.plugin.entry` |
| 日志 Service | `com.xuehai.launcher.log.LogService`（进程 `:log`） | 日志上报 |
| 协助 Service | `com.xuehai.launcher.assist.AssistService`（进程 `:assist`） | 远程协助/远程控制 |
| 下载 Service | `com.xuehai.launcher.common.download.DownloadService` | 应用下载（dataSync 前台服务） |
| 通用 Service | `com.xuehai.launcher.common.service.LauncherService` | 主进程服务 |
| 控制同步 Service | `com.xuehai.service.control.SyncService` | 管控/夜禁策略同步 |
| 推送 Service | `com.xuehai.message.sdk.PushService` | 消息推送 |
| 内容提供者 | `com.xuehai.launcher.component.provider.MyContentProvider`（authority `com.xh.zhitongyun.provider`，**exported**） | 与智通云跨进程 IPC 的桥 |
| 内容提供者 | `com.xuehai.service.InitContentProvider` / `com.xuehai.open.InitProvider` | 多进程初始化 |
| 接收器 | `com.xuehai.launcher.receiver.BootReceiver`（BOOT_COMPLETED / ACTION_SHUTDOWN） | 收开机广播**不做任何事**（自启靠 `persistent=true` + zty 拉起，见 `15-zty-mdm-startup.md` §4），关机时保存护眼埋点 |
| 接收器 | `com.xuehai.launcher.receiver.LauncherReceiver`（`com.xuehai.service.box.force_check` / `auto_check`） | 应用盒子强制/自动检查 |

### 各功能入口类速查（详见 `99-entry-points-index.md`）

| 功能 | 入口类/方法 |
|------|-----------|
| 登录拿 token | `LoginActivity` → `LoginViewModel` → `AccountRepository.userLogin()` → `POST /api/v2/platform/login` |
| 桌面图标墙 | `HomeActivity` → `HomeViewModel.loadHomePage()/loadAppPages()` |
| 每日一言 | `HomeViewModel`（`getDayWords()` 订阅）+ `DayWordsHistory/Favorites/SearchActivity` |
| 夜禁管控 | `ControlActivity` / `SyncService` / `com.xuehai.launcher.control.*` |
| 应用安装/更新 | `DownloadService` + `ApplicationManager` + `AppUpdateManager` + `com.xuehai.service.box` |
| 远程协助 | `AssistService` / `RemoteAssistActivity` / `AssistModel.bindAssistService()` |
| 动态码/设备重置 | MDM 相关（`brushCode`、TOTP，见 `11-backdoors.md` / `xuehai-brushcode.md`） |
| 崩溃安全模式 | `WelcomeActivity` → `CrashLevelManager.isSeriousCrash()` → `SafeActivity` |
| 开发者/调试 | `DeveloperActivity` / `DebugActivity` / `ConfigActivity` |

---

## 初始化流程

### 1. 进程/Application 装配（attachBaseContext）

`App`（`com.xuehai.launcher.App`）由 Tinker 外壳 `TinkerPatchReflectApplication` 实例化。继承链：`App → ModuleApplication → XhApplication → BaseApplication → com.p017xh.xhcore.common.base.XhBaseApplication → android.app.Application`。

`XhApplication.attachBaseContext()` 依次执行：

1. `AuthorityUris.setAuthorityUris("com.xh.zhitongyun.provider")` — 设定 IPC authority
2. `OSSLogToFileUtils.setUseSdCard(false)`
3. `MultiDex.install(context)` — 多 dex 加载
4. `CrashLevelManager.initLevel(this)` + `onAppStart()` — 崩溃等级管理启动；若上次启动崩溃则 `notifyError`
5. 把 `getApplications()`（5 个 ApplicationLike 模块）注册进 `applicationLike` 组件并 `attachBaseContext`

### 2. Application.onCreate

- `App.onCreate()`：`FileCheckUtil.autoCheckXhDir()`（校验/初始化 xh 目录）、`super.onCreate()`、`EduOauth.registInstance(this, "0fd67f5b189d40b0bad2981db58ef9f8", "http://dn.yqer.cn", ...)`。
- `XhApplication.onCreate()`：
  - `super.onCreate()`（基类启动 xhcore/日志）
  - `new MyUncaughtExceptionHandler().init(this)` — 全局未捕获异常处理
  - `init()` → `initLog()`（DumpExceptionHandler、异常链、OkHttp 日志）、`Permission.initPermission()`
  - 若 debug 模式 `ZRouter.openDebug()`
  - `ZRouter.init(this, Constants.LAUNCHER_MDM_STU)` — 路由初始化
  - `applicationLike.preCreate()` — 各模块预创建
  - `BaseRemoteDataSource.INSTANCE.initRequest()` — **网络请求层初始化（即签名拦截器装配点）**
  - 若主进程：若非严重崩溃，则 `doOnMainProcess()`。
- `ModuleApplication.onCreate()`：`ZRouter.registerInterceptor(new PlatformInterceptor())`。
- `ModuleApplication.doOnMainProcess()`：`CPVDManager.setCallback(new ContentProviderReceiver())` — 装配跨进程 ContentProvider 回调。
- `App.doOnMainProcess()`：`ResourceUpdateManager.startLooper()`（资源热更新轮询）、`WifiCompat.listenerByConn()`（WiFi 监听）、注册 `FontReceiver`。
- 各 `ApplicationLike` 模块：`ApplicationLikeApp`、`ApplicationLikeControl`（管控）、`ApplicationLikeUser`（用户）、`ApplicationLikeMdm`（MDM）、`ApplicationLikeMessage`（消息）。

### 3. Welcome 路由（WelcomeActivity → WelcomeViewModel.welcome()）

`WelcomeActivity`（MAIN/LAUNCHER）`init()`：

- 若 `isTaskRoot()==false` → `finish()`（避免重复实例）
- 若 `CrashLevelManager.isSeriousCrash()` → 跳转 `SafeActivity`（安全模式/动态码重置入口）并 finish
- 否则 `CrashLevelManager.postClear(60000)` 后，权限授予后执行 `welcome()`

`WelcomeViewModel.welcome()` 并行（IO/文件/多线程调度器）初始化：

1. `BaseLocalDataSource.preInitDb()` — 预初始化本地数据库
2. `ApplicationManager.init()` — 应用管理器初始化
3. `CheckDataUtil.clearDeprecatedData()` + `loadHistoryNetworkLine()` — 清理废弃数据、加载历史网络线路配置
4. 检测 MDM 连接：`PolicyManager.testBinderLink()` 轮询直至绑定成功（2 秒超时）— 等待设备管理（MDM/DeviceAdmin）就绪
5. `ModelFactory.getFirewallModel().initFirewall()` — 防火墙初始化
6. `LauncherUtil.initInputMethod()` + `LocationHelper.start()`（定位启动）
7. `router()` 决定去向：

```kotlin
fun router() {
    if (!SessionData.canAutoLogin()           // 无自动登录凭据
        || !(SessionData.enableNetwork is Wifi) // 非 WiFi
        || !ModelFactory.signatureModel.signatureStatus.isNotSignature() // 签名未就绪
        || !AppUtil.isInstalled(mdmPackageName) // MDM 应用未安装
        || !DeviceManager.isAdminActive()        // 未激活设备管理员
        || ProviderUtil.loadUser() == null)      // 本地无用户
        → toLogin()   // 进入 LoginActivity
    else
        → toHome()    // 进入 HomeActivity 桌面
}
```



### 4. 登录页（LoginActivity）

- 使用 `UserLoginActBinding` 布局，`LoginModeFragment` 承载账号/密码/手机/微信等登录方式。
- `init()` 中调用 `XhSecretKeyUtils.deleteSecretFile()` — **进入登录页即删除旧的密钥文件**（重新登录会重新下发并写回，见 `03-file-io.md`）。
- 与 `MdmRouter`（`com.xuehai.system.mdm`）交互：`initGuideView()` / `initSafeView()` 引导激活设备管理员 / 进入安全模式。
- 登录成功后 `AccountRepository.unifiedDealLoginResult()` 处理：写密钥文件、保存最近账号/密码、`LoginUtil.afterLogin()`、刷新场景缓存、注册消息客户端、更新系统时间等（详见 `01-network-api.md`）。

### 5. 桌面（HomeActivity）

- `init()`：`setContentView(home_act)`（可含滑动二层面板）、`ViewPager2` + `TabLayout` 多页图标墙、`HomeViewModel.loadHomePage()/loadData()`、`HomeAdvertViewModel.loadAd()`（广告）、`applyPermission()`。
- `initService()`：`AssistModel.bindAssistService()`（绑定远程协助服务）+ 绑定 `LogService`（日志服务）。
- 订阅 `HomeViewModel.getDayWords()`（每日一言，触发 `loadAppPages()`）、`getApps()`（应用列表，触发 `loadAppPagesAndUpdateAll()`）、`getHomePageData()`（首页分页）。
- 监听应用状态：`AppOperateWindow`/`PersonalAppOperateWindow` 管理应用；顶部时检查 SD 卡是否满（`checkSdcardIsFull()`），满则弹存储清理框（关联 `AppStorageActivity`）。
- 注册 `EventBus`，处理 `LogoutEvent`（登出）、`TokenRefreshEvent`（token 刷新）、`LicenseEvent`、`PersonalAppsEvent` 等事件。

---

## 子系统文档索引

| 文档 | 内容 |
|------|------|
| `01-network-api.md` | 与学海服务器全部 API、请求/响应格式 |
| `02-signing.md` | 学海请求签名（xhcore JNI）算法确认与展开 |
| `03-file-io.md` | 本地文件读写清单（xuehai/keep/device 等） |
| `04-ipc-ztcloud.md` | 与智通云跨进程 IPC（MyContentProvider 等） |
| `05-logging.md` | 日志上报机制（LogService/xhlog/崩溃） |
| `06-initialization.md` | 初始化/首次安装/全新平板行为 |
| `07-app-management.md` | 应用拉取/安装/卸载/更新流水线 |
| `08-control-night-ban.md` | 夜禁/管控时段限制 |
| `09-daily-words.md` | 每日一言功能 |
| `10-remote-assist.md` | 远程协助/远程控制 |
| `11-backdoors.md` | 后门（自卸载/设备重置/动态码等） |
| `12-ipc-open-sdk.md` | Open SDK / 消息推送 / token 共享 |
| `13-tinker-hotfix.md` | Tinker 热修复 / 卸载重装行为 |
| `14-taskreward-module.md` | 内嵌任务奖励模块（TaskReward：每日任务/专注/学习计划/藏宝箱等） |
| `15-zty-mdm-startup.md` | zty（MDM）与 ztp 的启动关系、文件锁看门狗、健康心跳、内置安装器 |
| `16-permissions-device-identity.md` | 四层权限模型、AIDL/MdmService 机制、设备身份（deviceId/SecretKey/Knox 序列号） |
| `17-reinstall-and-rewrite.md` | 一键还原（unLock 全清单）、卸载重装场景推演、自写 ztp 可行性与兼容面 |
| `99-entry-points-index.md` | 功能入口函数/类 + Manifest 组件总索引 |

> 本文档为系列总览；各子系统详见对应文档。每个子文档由专项分析员基于反编译源码撰写。
