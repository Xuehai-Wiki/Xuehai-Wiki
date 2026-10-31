---
title: "智通平台初始化流程"

description: "智通平台从进程装配、Application 初始化到 Welcome 路由、首装/全新平板行为的完整时序"

categories:
  - 技术解析
excerpt: 智通平台（学生端 com.xh.zhitongyunstu）的完整初始化链：Tinker 外壳 → App → ModuleApplication → XhApplication → BaseApplication 的 Application 继承链，WelcomeActivity 的路由决策，以及全新平板首次安装的行为。
---

# 智通平台初始化流程

## 一、Application 继承链

真实应用类 `com.xuehai.launcher.App` 由 Tinker 热修复外壳 `com.tinkerpatch.sdk.loader.TinkerPatchReflectApplication` 反射实例化（Manifest 中 `android:name` 为外壳，`TINKER_PATCH_APPLICATION` meta-data 指向 `com.xuehai.launcher.App`）。

继承链（自底向上）：
```
com.p017xh.xhcore.common.base.XhBaseApplication  (xhcore 框架基类)
  └── com.xuehai.launcher.common.base.BaseApplication
        └── com.xuehai.launcher.common.base.XhApplication
              └── com.xuehai.launcher.ModuleApplication   (多模块装配)
                    └── com.xuehai.launcher.App            (最终 App)
```

## 二、attachBaseContext（进程装配）

`XhApplication.attachBaseContext()` 在 context 装配阶段执行：

1. `AuthorityUris.setAuthorityUris("com.xh.zhitongyun.provider")` — 设定与智通云 IPC 的 authority（`com.xuehai.provider.constants.AuthorityUris`）
2. `OSSLogToFileUtils.setUseSdCard(false)` — 阿里云 OSS 日志关 sd 卡
3. `MultiDex.install(context)` — 多 dex 加载
4. `CrashLevelManager.initLevel(this)` + `onAppStart()` — 崩溃等级管理启动；若上次启动崩溃则 `notifyError(context)`
5. `LogManager.enableFileLooper = false`
6. 把 `getApplications()` 返回的模块集注册进 `ApplicationLikeComponent` 并 `attachBaseContext(context)`。

`ModuleApplication.getApplications()` 返回 5 个 `ApplicationLike` 模块：
- `ApplicationLikeApp` — 应用管理
- `ApplicationLikeControl` — 管控/夜禁
- `ApplicationLikeUser` — 用户/登录
- `ApplicationLikeMdm` — 设备管理（MDM）
- `ApplicationLikeMessage` — 消息推送

## 三、Application.onCreate

### 3.1 App.onCreate
- `FileCheckUtil.autoCheckXhDir()` — 校验/初始化 xh 目录结构
- `super.onCreate()`（进入 XhApplication / ModuleApplication 逻辑）
- `EduOauth.registInstance(this, "0fd67f5b189d40b0bad2981db58ef9f8", "http://dn.yqer.cn", OBS)` — 注册教育云 OAuth SDK

### 3.2 XhApplication.onCreate
- `super.onCreate()`（xhcore 基类初始化）
- `new MyUncaughtExceptionHandler().init(this)` — 全局未捕获异常处理器
- `init()` → `initLog()`：
  - 装配 `DumpExceptionHandler`（写 `FilePath.LOG_DIR_ERROR/launcher_error`）+ `DeadObjectExceptionHandler` 异常链
  - `MyLog.INSTANCE.setExceptionHandler(...)`（日志可写文件）
  - `ZLog`、`LogUtils` 日志级别配置
  - `OkHttpClientManager.getInstance().setLogEnable(true)` — 打开 OkHttp 日志
  - `ContentProviderLog.LOG = true`
- `Permission.initPermission()`
- 若 debug 模式：`ZRouter.openDebug()` — 打开路由调试
- `ZRouter.init(this, Constants.LAUNCHER_MDM_STU)` — 初始化 ZRouter 路由框架
- `applicationLike.preCreate()` — 各模块预创建
- `BaseRemoteDataSource.INSTANCE.initRequest()` — **初始化网络请求层（签名拦截器等网络栈装配点）**
- 若主进程且非严重崩溃：`doOnMainProcess()`

### 3.3 ModuleApplication.onCreate
- `ZRouter.INSTANCE.registerInterceptor(new PlatformInterceptor())` — 注册平台级路由拦截器

### 3.4 doOnMainProcess（主进程专属）
- `ModuleApplication`：`CPVDManager.setCallback(new ContentProviderReceiver())` — 装配跨进程 ContentProvider 回调接收
- `App`：`ResourceUpdateManager.startLooper()`（资源热更新轮询）、`WifiCompat.listenerByConn()`（WiFi 网络监听）、注册 `FontReceiver`（字体热更新）
- `XhApplication`：`ClockUtil.INSTANCE.start()`（时钟校准）、`applicationLike.onCreateOnMainProcess()`、`clipboard()`（剪贴板监听并覆盖为"学海教育"）

## 四、Welcome 路由（WelcomeActivity → WelcomeViewModel.welcome）

`WelcomeActivity`（MAIN/LAUNCHER，开机首页）`init()` 逻辑：

1. `isTaskRoot()==false` → `finish()`（防重复实例）
2. 若 `CrashLevelManager.isSeriousCrash()` → 跳转 `SafeActivity`（安全模式/动态码重置页）并 finish
3. 否则 `CrashLevelManager.postClear(60000)` 后，权限授予后执行 `welcome()`

`WelcomeViewModel.welcome()` 并行初始化（IO/文件/多线程调度器）：

| 并行任务 | 说明 |
|----------|------|
| `BaseLocalDataSource.preInitDb()` | 预初始化本地数据库 |
| `ApplicationManager.init()` | 应用管理器初始化（设备配置档位） |
| `CheckDataUtil.clearDeprecatedData()` | 清理废弃数据 |
| `loadHistoryNetworkLine()` | 加载历史网络线路配置（`NetworkLineConfig` 自定义服务器地址） |
| `PolicyManager.testBinderLink()` 轮询（2s 超时） | 等待 MDM 设备管理 Binder 绑定就绪 |
| `ModelFactory.getFirewallModel().initFirewall()` | 防火墙规则初始化 |

完成后 `LauncherUtil.initInputMethod()`（输入法）、`LocationHelper.start()`（定位）、最后 `router()`。

### router() 决策（进入登录页 or 桌面）

```kotlin
fun router() {
    if (!SessionData.canAutoLogin()                     // 无自动登录凭据
        || !(SessionData.enableNetwork is Wifi)          // 非 WiFi
        || !signatureModel.signatureStatus.isNotSignature() // 签名未就绪
        || !AppUtil.isInstalled(mdmPackageName)          // MDM 应用未安装
        || !DeviceManager.isAdminActive()                 // 设备管理员未激活
        || ProviderUtil.loadUser() == null)              // 本地无用户
        → toLogin()   // ZRouter 跳 LoginActivity（router path LOGIN_ACTIVITY）
    else
        → toHome()    // ZRouter 跳 HomeActivity（router path HOME_ACTIVITY）
}
```

> **关键结论**：全新平板（无用户、无 MDM 激活、无自动登录凭据）必然进入登录页；已登录且设备状态完整则直接进桌面。

## 五、首次安装 / 全新平板行为

全新平板首次启动的完整时序：

1. 开机 → ztp **不通过广播自启**（`BootReceiver` 收到 `BOOT_COMPLETED` 不做任何事，仅处理 `ACTION_SHUTDOWN` 存护眼埋点）；进程由 `android:persistent="true"` 常驻拉起，界面由 zty（MDM）的启动链拉起 `WelcomeActivity`（MAIN/LAUNCHER，详见 `15-zty-mdm-startup.md` §1/§4）
2. Application 初始化链完成（多 dex、崩溃管理、路由、网络栈）
3. `WelcomeViewModel.welcome()` 预初始化数据库/应用管理器/MDM Binder/防火墙
4. `router()`：因无用户/MDM 未激活 → 跳转 `LoginActivity`（存疑）
5. `LoginActivity.init()`：进入登录页即调用 `XhSecretKeyUtils.deleteSecretFile()` 删除旧密钥文件；显示 `MdmRouter.initGuideView()` 引导激活设备管理员（DeviceAdmin）
6. 学生输入账号密码 → `POST /api/v2/platform/login` → 获取 `Account`（含 token/密钥 uv+randomStr）
7. 登录成功后：`XhSecretKeyUtils.writeSecretToFile(uv, randomStr)` 写密钥；`LoginUtil.afterLogin()`；注册消息客户端；写设备 `SecretKey`（`/sdcard/xuehai/keep/device/*.ls`，AES 加密，终身绑定设备）
8. 重新执行路由 → 满足条件 → 进入 `HomeActivity` 桌面

## 六、主要初始化涉及的类

| 类 | 作用 |
|----|------|
| `com.xuehai.launcher.App` | 最终 Application（createAppClientArgs 定义客户端标识 CA106004） |
| `com.xuehai.launcher.ModuleApplication` | 装配 5 个 ApplicationLike 模块 |
| `com.xuehai.launcher.common.base.XhApplication` | 初始化日志、路由、网络请求层、崩溃管理 |
| `com.xuehai.launcher.common.base.BaseApplication` | 设备信息（getDeviceId 通过 MDM getSerialNumber）、应用基类 |
| `com.xuehai.launcher.WelcomeActivity` | 启动页/路由入口 |
| `com.xuehai.launcher.WelcomeViewModel` | 启动初始化 + router() 路由决策 |
| `com.xuehai.launcher.home.HomeActivity` | 桌面图标墙（登录后） |
| `com.xuehai.launcher.user.login.LoginActivity` | 登录页 |
| `com.xuehai.launcher.receiver.BootReceiver` | 开机自启/关机回收 |
| `com.xuehai.launcher.common.sdk.proxy.PolicyManager` | MDM 设备策略代理（getDevicePolicyProxy 等） |
| `com.xuehai.launcher.common.crash.CrashLevelManager` | 崩溃等级/安全模式判定 |
