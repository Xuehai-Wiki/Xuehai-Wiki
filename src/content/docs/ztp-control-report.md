---
title: "智通平台管控策略"

description: "智通平台管控策略"
categories:
  - 应用
---

# 学海智通云学生端（com.xh.zhitongyunstu）管控策略全量分析报告

> 分析对象：JADX 反编译源码 `D:\Users\root\Desktop\ztpt\sources`（+ `resources`）
> 应用：`com.xh.zhitongyunstu`，versionCode 312504 / versionName `v3.125.04.20251125S`，minSdk 21 / targetSdk 28
> 定位：学生平板"管控型桌面"（Launcher + 管控服务 + MDM 代理 + 推送通道），配合云端平台（TOB 学校 / TOC 家长）实现设备级管控。
> 说明：jadx 将 `com.xh.*` 重命名为 `com.p017xh.*`；行号均为反编译源文件行号。

---

## 0. 总体架构

管控逻辑分布在两条并行引擎 + 一条设备底座上：

| 层 | 包 | 角色 |
|---|---|---|
| **管控服务引擎** | `com.xuehai.service.control`（classes4.dex） | 独立 `ControlService`/`SyncService`，120 秒定时拉取 `/api/v1/forbidden/detail`，本地落库并向全设备分发 |
| **桌面管控引擎** | `com.xuehai.launcher.control`（classes3.dex） | `ControlRepository`（2280 行）为核心的策略中枢：拉取/合并/存储 4 类管控 + 宵禁 + 考试模式 + 护眼 + 违规上报 |
| **设备管控底座** | `com.xuehai.launcher.common.sdk` + `launcher.mdm` | 通过私有 MDM SDK（`com.xuehai.system.mdm`，binder 服务 `PolicyManager`）下发系统级策略：桌面锁定、禁用设置、USB/恢复出厂/多用户/截屏/输入法/防火墙 iptables 等 |
| **指令通道** | `com.xuehai.message`（自研 TCP push）+ 广播 + ContentProvider | 实时推送 `control-service` 消息触发即时刷新；广播与 Provider 向第三方 App 分发权限 |

策略执行优先级（`com.xuehai.service.control.ControlManager`）：**场景管控 > 长期管控 > 夜间管控**；模块管控（应用禁用）由 MDM 单独通道执行，与前三者正交。

---

## 1. 权限位系统（策略总开关）

`com.xuehai.launcher.common.config.Permission`（124 行）：服务器通过登录/配置接口下发 long 型位掩码，持久化于 SP key `"permission_23"`：

| 位 | 常量 | 含义 |
|---|---|---|
| 1 | QR_FOREVER | 二维码永久有效 |
| 4 | DEBUG_MODE | 调试版本（放开双清/刷机/USB 调试） |
| 8 | FIRE_WALL | 防火墙（iptables）管控开启 |
| 32/64 | AUTO_UPDATE_APP/LAUNCHER | 应用/桌面自动更新 |
| 128 | DELETE_UN_KEEP_APP | 允许删除非保留应用 |
| 256 | SYSTEM_ADMIN_SDK | 系统管理 SDK |
| 512 | AUTO_UPLOAD_LOG | 自动上传日志 |
| 1024 | HTTP_PROXY_ENABLE | HTTP 代理 |
| 4096 | **CONTROL** | 本地管控总权限（`ApplicationLikeControl.onCreateOnMainProcess` L106：`isStudentClient && checkPermission(4096L)` 不成立则整个管控模块不启动） |
| 16384 | NOTIFICATION | 通知栏管控 |
| 32768 | FORBIDDEN_CLIPBOARD | 禁用剪贴板（TOB 学生端默认加，TOC 家长端默认不加，见 L71-73） |
| 65536 | CLOSE_DEVICE_CONTROL | 关闭设备管控（`SystemSDK` L80：置位则走 `permissionCloseDeviceControl()` 恢复全部系统限制） |
| 131072 | APP_SIGNATURE_CHECK | 应用签名校验 |

学生端默认集合（`initPermission()` L65-103）：`128|8|32768(TOB)|16384|4096|16|32|64|512|131072`，即 **默认开防火墙、禁剪贴板（仅 TOB）、开管控、推送、自动更新、签名校验**。

---

## 2. 指令下发与数据同步通道

### 2.1 HTTP 定时轮询（主通道）
- `com.xuehai.service.control.SyncService`（75 行）：`HandlerThread "SyncServiceThread"`，`onStartCommand` 携带 schoolId/user_id，**立即执行 + 每 120000ms 重复** → `ControlService.syncControlData`。
- `ControlService.reqControlData`（337 行）：`GET {serviceUrl.getMicroUrl("/api/v1/forbidden/detail")}`，参数 schoolId+userId；成功后 `saveControlData`（写 XmConfig 本地）→ `syncControlData`（分发给其它 App）。
- 桌面侧 `ControlRepository.startControlMode()`（L534）：受 `CommonControlsManager.hasPermission()` 门控（标志 4096L + 是学生端 + isStudent + getUserId>0）；TOC 用户走 `reqForbiddenDetailV2(modeId)`，TOB 走 `reqForbiddenDetail`。

### 2.2 自研 TCP 长连接推送（实时通道）
`com.xuehai.message`（约 90 个文件）：私有二进制协议（`proto/`：Authorization、Echo、Heartbeat、Message、MessageFeedback、Pull，命令字 `MessageCmd`：HEART_BEAT=1/AUTHORIZATION=2/MESSAGE=3/PULL=5），`TcpClient`(255 行) + `PushClient`(331 行)，靠 `PushAlarmReceiver`+`AlarmWalkman`+`WakeLockUtil`+屏幕/WiFi 广播保活。
`LauncherPushService`（业务接收器，`extends PushMessageReceiver`）分发 `MsgType`：
- **`control-service`（CONTROL_UPDATE）**：收到即 `ControlRepository.startControlMode()` + `reqStudentControlModes`，实现管控策略秒级下发（LauncherPushService L221-237）；
- `assist-notify`：远程协助请求；
- `app-upgrade` / `app-upgrade-prepare`：应用升级与预下载；
- `app-notification` / `app-syncMessage`：通知与资源同步。
过滤包名白名单 `["com.xh.arespunc"]`（课堂 App）。

### 2.3 广播分发（跨 App）
- `ControlReceiver`（65 行，动态注册）：`com.xuehai.control.action.all_control` → `startControlMode()`；`com.xuehai.control.action.app_permission` → `reqAppModulePermission()`。
- `AppModulePermission.syncAppPermissions()`（66 行）：通过发送上述 app_permission 广播通知第三方 App 模块权限变化。
- 场景管控：`SceneInfoControler.ACTION_START/STOP_SCENE_CONTROL` 广播（见 §5）。
- 考试模式：`com.xh.zhitongyun.action.start/stop_exam_mode`（见 §5）。

### 2.4 ContentProvider（跨进程读取）
`MyContentProvider`，authority `com.xh.zhitongyun.provider`，暴露 `/cache`、`/client`、`/control`、`/appModelPermission` 四类 URI；第三方通过 `DataLoaderV2.loadControlData` 读取管控数据，模块权限 key = `"module_permission_" + packageName`。

---

## 3. 四类管控类型与执行引擎

### 3.1 ControlType（`com.xuehai.service.control.core.ControlType`）
四种：`SCENE`（场景/课堂）、`NIGHT`（夜间/宵禁）、`LONG_TIME`（长期禁用时段）、`MODULE`（模块级，即按应用禁用）。

### 3.2 服务端执行引擎（service.control）
- `ControlManager`：按 **Scene → LongTime → Night** 优先级依次判定；
- `ControlRealTimeManager`（938 行）：核心实时裁决器 —— 挂 Activity 生命周期回调（`onActivityResumed` 等）+ 轮询任务；被管控时：最小延迟 1000ms 轮询复查、最大重检间隔 60000ms、管控**结束前 2 分钟（FORWARD_TIP_MINUTE）弹出前置提示**；在管控窗口内调起 `ControlDialog`。
- `ControlDialog`（371 行）：不可取消弹窗（`setCancelable(false)`），可对背景 Activity 截屏并高斯模糊（radius 20），固定按钮"我知道了"，可带"退出应用"按钮触发 `onExit()` 回调关闭前台 Activity。

### 3.3 桌面侧数据模型（launcher.control）
- `LongTimeAndNightForbid`（674 行）= 禁止策略详情实体：
  - `curfew`（夜间宵禁）：`NightForbid.getDefaultNightForbid()` 默认 **今天 22:30（+81000000ms）→ 次日 06:00（+21600000ms+1天）**；`isInCurfew()/getForwardMinute()` 计算窗口与提前量；
  - `periods`（长期管控）：beginTime/endTime/packageName/schoolId/classId/status，日期按 +8 时区归一；
  - `modeDuration`（TOC 单应用模式）：maxDuration/committedDuration/forceDisableUntil；
  - `userDuration`（全局使用时长）：beginTime=360min（06:00）~ endTime=1320min（22:00），maxDuration=86400s，含 forceDisableStart/forceDisableUntil、countDownSeconds；
  - `ModeRule.ruleType==1` → `isTrusteeship`（托管模式）。
- `ControlMode` / `ControlModeApp` Room 实体持久化当前模式；`ControlSharedPreferences` 存考试模式 map（packageName→endTime）。

### 3.4 夜间管控调度（桌面侧）
`NightForbidManager`（98 行）：LooperTask 重算下一次触发延迟 = 距下个管控边界的时间；仅 TOB 生效（TOC 返回 null）；**服务器未下发时启用本地默认 22:30–06:00**；到期经 EventBus + `TimeControlManager.notifyTimeControlChanged(NIGHT_CONTROL)` 通知。
`LongTimeManager`（207 行）：同理处理长期时段的到期与提前提示。

### 3.5 控制模式切换/选择（TOC 家长端）
`ControlRepository`：`reqStudentControlModes`(L1492)、`selectedStudentControlMode`(L1775+) —— 学生可选家长预设的管控模式；`reqCurfews`/`modifyCurfewTime`(L966/971) 修改宵禁；`requestStudentCurfewDetail`(L1431)。

---

## 4. 场景管控（课堂/考试场景）

### 4.1 服务端 → 桌面
`ControlService` 成功拉取后若发现场景管控，`checkSceneControlAndShow`(L325) 直接弹全屏模糊弹窗。

### 4.2 桌面执行 `SceneControlStatus`（258 行）
- 由类场景计算 **allowed-app 白名单**，然后通过 MDM `ApplicationPolicyProxy.setDisableApplication` **禁用名单外所有第三方应用**（Google WebView 永不禁用——WebView 运行需要）；
- 场景结束后统一 `setEnableApplication` 恢复；
- 监听 `ThirdPartyAppListChangedEvent`，已卸载应用的禁用设置自动清除；
- 场景期间**暂停护眼计时**（`EyeShieldManager.setEyeShieldStop("SceneControl", true)`）。

### 4.3 考试/课堂 App 发起的场景（加密广播）
`SceneControlManager`（255 行）动态注册接收 `SceneInfoControler.ACTION_START/STOP_SCENE_CONTROL`：
- 广播携带 `SceneInfoControler.CIPHERTEXT`（**AES 密文，`LauncherAesUtil` 校验防伪造**）+ package_name + force_close；
- 启动/停止时与服务器场景数据合并（按 updateAt 较新者胜；删除场景持久化 updateAt=Long.MAX_VALUE 防复活），结果 JSON 落盘并刷新缓存 `SceneInfoControler.refreshSceneInfosCache()`。

### 4.4 考试模式 `ExamModeStatus`（166 行）
- 广播 `com.xh.zhitongyun.action.start_exam_mode`（packageName + duration，**上限 12 小时**）→ 写入 SP map `examMode`（pkg→endTime）→ LooperTask 到期解除；
- 生效期间 `EyeShieldManager.setEyeShieldStop("ExamMode", true)` 停护眼；
- 调试面板（`ApplicationLikeControl.getDebug`）可手动触发 start/stop 广播做验证。

---

## 5. 应用级管控

### 5.1 注销/登录切换 `ControlAppManager`（363 行）
- `ControlAppState(packageName, enable, force)` + `historyOperatedApps` 记录本进程操作过的应用；
- **注销时：除 MDM 固定白名单 + 平台应用 + 输入法外，全部 `setDisableApplication`**（设备恢复到"未绑定"锁定态）；登录后 `enableApps()` 恢复。

### 5.2 首页过滤 `HomeViewModel`
- `loadData()`（L557-604）：先 `initMdmRules()`、强制启用 Google WebView、`ControlAppManager.enableApps()`；
- `checkControlApp`（L543）：对每个桌面 App 调 `ControlModel.checkInControl(packageName)`，受控应用在桌面上标记/置灰（配合倒计时 CountDown LiveData 展示剩余可用时间）。

### 5.3 应用使用时段（TOC 个人管控）
`ControlRepository.req/add/modify/delete AppPeriods`（L848-864）：按 App 粒度配置可用时段；`PersonalAppControlTimeActivity`/`PersonAppControlDetailAct`（v2 包）为对应界面；`modeDuration.forceDisableUntil` 支持强制禁用到期时间。

### 5.4 应用锁（application.applock）
- 列表持久化：`AppLockLocalDataSource`（385 行）写文件 `appLocksDir/<userKey>`（每行一个包名）+ `appLocksAlwaysDir`（"独立加密"应用锁，始终需验证）+ `appLocksFailPath`（失败计数，格式 `userKey&&pkg&&count`，≥3 次失败触发重新验证）；同时同步 `CPVDAppData.updateAppLockStatus`。
- 解锁：`AppLockPasswordActivity/Fragment`（taskAffinity 独立任务栈），`AppLockPasswordViewModel` 目标类型：1=设置密码、2=验证（忘记密码）、3=重置、4=关闭应用锁、5=解锁应用；支持密保问题找回（`VerifyFindPasswordAnswerActivity`）。
- 触发：打开被锁应用时由桌面拦截启动解锁页（`UnlockView` 218 行）。

### 5.5 安装/卸载控制
- `ApplicationPolicyProxy.setApplicationUninstallationDisabled(自身包名)`：正式版禁止卸载桌面（SystemSDK L92）；调试版放开；
- `AppInstallManager`/`AppUpdateManager`/`PackageReceiver`：安装来源与升级管控（静默安装/升级、非白名单包处理）；
- `DELETE_UN_KEEP_APP`（128）位控制删除非保留应用。

---

## 6. MDM 设备管控（SystemSDK + PolicyManager 代理层）

### 6.1 `SystemSDK.initPermission()`（297 行）—— 学生端登录后的"设备锁定"全量下发
`ClientConfig.isStudentClient()` 且未置 `CLOSE_DEVICE_CONTROL(65536)` 时（L84-131）：
- **桌面锁定**：`setDefaultHome(mdmPackageName, "com.xuehai.launcher.MainActivity")` + `controlChangeHome(false)`（禁止换桌面）；
- **通知白名单**：`addPackagesToNotificationWhiteList`（launcher+课堂 App），`addPackageToBatteryOptimizationWhiteList` + `addAppAutoRunningList`（launcher、MDM、`com.xh.arespunc`）保活；
- **防卸载/防刷机**：正式版 `setApplicationUninstallationDisabled`；`allowFirmwareRecovery(debug)`、`allowFactoryReset(debug)`、`setUsbDebuggingEnabled(debug)`、`setMTPEnabled(debug)`、`setSdCardState(debug)`、`allowMultiWindowMode(false)` —— 全部随 DEBUG_MODE 开关；
- **设置项封锁**：`setSettingsHiddenState(true)` + `controlSettingsTopLevelMenu(SettingsTopLevelMenu.getTopLevelKeyList())` 逐项禁用设置入口、`setDevelopHiddenState(true)`（隐藏开发者选项）、`setDropMenuHiddenState`（下拉栏）、`setLockScreenItems(false)`、`setKanbanEnabled(false)`、`setCameraShortcutEnabled(false)`、`setBixbyShortcutEnabled(false)`、`setSwitchInputMethodEnabled(false)`、`setTaskBarEnabled(false)`、`allowSoftUpdate(false)`；
- **防改时间**：`DateTimePolicyProxy.setDateTimeChangeEnabled(false)` + 强制自动时间/时区（防绕过宵禁）；
- **厂商特化**：三星 V3 → 禁用 Knox SecureFolder；SMP200/SMP615C → 保留系统设置；华为 HEM → `setSettingEnabled` + 禁用华为桌面/文件管理(`HUAWEI_DOCUMENTS_UI`)/浏览器；华为普通机 → 同上三件套；全平台禁用 `GOOGLE_ANDROID_AS`（Google 搜索）；
- **紧急模式/定位**：`setEmergencyCallOnly(true)`（SIM 仅紧急呼叫）、开启 GPS（定位追踪）；
- **杂项**：禁止多用户（`MultiUserChecker`）、禁止文件共享（华为）、禁随机 MAC（防脱管换 MAC）；
- **截屏/投屏**：`setScreenCapture` 由服务器配置 `IS_MIRACAST_ENABLED` 控制（默认禁）；2C 且不在校管控时放开；
- **硬件按键**：`allowHardwareKey` 远程配置，可禁多任务键（`disableAppSwitch`）。
- **剪贴板**：`Permission 32768L` 或（学生 && isUnderSchoolControl）时禁用剪贴板。

### 6.2 注销/解绑重置（L240-278 `permissionCloseDeviceControl` 路径）
对称恢复：启用组件、`setMTPEnabled(true)`、`setDateTimeChangeEnabled(true)`、恢复锁屏项/看板/相机快捷/Bixby/输入法切换/任务栏、`setEmergencyCallOnly(false)`、`controlChangeHome(true)`、`setSettingsHiddenState(false)`、状态栏按钮全部恢复、多窗口开启。

### 6.3 MDM 代理层（`com.xuehai.launcher.common.sdk.proxy`，11 个代理）
`PolicyManager.checkEnvironment()` 门控所有调用（MDM 服务未激活时安全跳过）：
`ApplicationPolicyProxy`（应用启停/卸载开关/默认桌面/使用统计/流量/电池白名单/自启动/getTopAppPackageName）、`FirewallPolicyProxy.setIptablesOption`、`WifiPolicyProxy`（开关 WiFi/限速 setNetworkSpeedState/禁随机 MAC/应用流量统计）、`DateTimePolicyProxy`、`SettingPolicyProxy`（设置项/状态栏按钮/音量）、`RestrictionPolicyProxy`（输入法/剪贴板/相机/截屏/SD 卡/USB 调试/MTP/锁屏项/任务栏/文件共享/Bixby）、`DevicePolicyProxy`（序列号/IMEI/SIM/紧急呼叫/S Pen）、`DeviceManagerPolicyProxy`（设备管理员状态）、`LicensePolicyProxy`、`LocationPolicyProxy`、`DataPolicyProxy`。

### 6.4 设备状态自检与上报 `DeviceControlManager`（148 行）
非教师端；要求 MDM 版本 ≥ `getMdmSupportCheckStatusVersion()` 且 binder 可用；检查设备管理员激活（`SafeCheckUtils.getActiveAdmins`）、恢复出厂/USB 调试/MTP/SD 卡/多用户/锁屏安全等当前状态，与期望不符或变化即 `uploadDeviceStatus` 上报服务器（`report()`，带 isReporting 防重入）。

### 6.5 刷机码/解锁码 `MdmModelImpl`
- `checkBrushCode`：解锁码本地 MDM 动态码校验，或请求服务器校验 —— 用于售后/管理员越权解锁通道；
- `wipeRecentTasks()`：清除最近任务列表（隐藏逃逸入口）；
- `disableRecentSettingApps()`（L263-274）：读 `R.array.app_white_list` 资源数组，**对设备上每一个已安装应用：在白名单中→enable，否则→disable**（白名单外的全部禁用的兜底闸门）。

---

## 7. 网络管控

### 7.1 防火墙 `FirewallManager`（340 行，`launcher.component.firewall`）
- 前置条件：`Permission.FIRE_WALL(8)` 位（学生端默认开）；
- `openFirewall()` → `firewallPolicy.setIptablesOption(true)`（MDM 层 iptables）；
- **域名规则**：`cleanDomainRules()` + 下发黑/白名单域名规则（服务器 `FirewallConfig`）；`executeDynamicAppFirewall()`（jadx 未完整反编译，493 条指令）为**按 App 的动态网络规则**；
- 配合 `RegularProcessor/UrlRegular` 做 URL 正则匹配；`AssistFunc` 中也提供 `setFirewall` 指令（远程排障时可临时开/关）。

### 7.2 WebView URL 白名单 `WebViewUrlFilter`（135 行）
内建白名单正则（L31-47）：`192.168.5.5/51`、`43.227.195.106`、`\w*.xh.com`、`\w*.xht.com`、`\w*.yunzuoye.net`、staging 域；资源域白名单（`isUrlSupportingDomain`）：aliyuncs.com、ztytech.com、ztyedu.com、zjxhedu.com、100fen.com、xh.com、xht.com 等；`initBaseUrl` 动态加入当前基础域名 —— 内嵌 WebView 只放行自有域名，拦截外链。

### 7.3 WiFi/流量
`WifiPolicyProxy.setWiFiState`（远程开关 WiFi）、`setNetworkSpeedState`（**限速**）、`setRandomMacDisabled`；`ApplicationPolicyProxy` 移动数据开关与应用流量统计（`TrafficInfo`）。

---

## 8. 使用时长统计、违规上报与护眼

### 8.1 使用统计
- `AppUsagesManager`：基于 MDM `getAppUsageStats` 周期采集各 App 前台使用时长，写入 Room `AppUsages`；
- `ReportUsageDataState`（48 行）：`preReportMap(start→pkg→AppUsages)` 记录上次上报快照，`hasChanged()` 变化才上报（幂等去重）；
- 上报走 `ReportDataTask`（552 行，`launcher.control.task`）：使用数据 + 管控状态 + 违规记录批量上传；服务端再提供 `requestStudentViolationStatistics`(L2239)/`requestClassViolationStatistics`(L2260) 违规统计、`requestControlRecordFilterData/Data`(L2199/2219) 管控记录查询（v2 包 `ControlModifyRecordAct` 展示）。

### 8.2 护眼 `EyeShieldManager`（225 行）
- 配置：`ControlRepository.getEyeShieldFirst/Second/KeepTime`（L789-801）→ 服务器下发 `firstTime/secondTime/keepTime`（两次休息间隔与休息时长），写 `EyeShieldConfig`；
- 计时：`getTimeObservable()` 每秒 `increaseElapsedTime()`（`ApplicationLikeControl` L113-124，受 `SessionData.getSysAuthority().isEyeShieldEnable()` 门控）；到期 `executeCheckEyeShield()` 弹 `EyeShieldDialog` 全屏休息页；
- **白名单豁免**：`eyeShieldFilter()`（L213）—— 顶部应用在 `getEyeShieldWhite()`（护眼白名单 + 课堂教学固定白名单）内则不计时；
- **暂停条件**：`setEyeShieldStop(mode, true)`（场景管控/考试模式注入 configMap，任一为 true 即停）、屏幕熄灭 `screenOff()` 暂停、解锁 `userPresent()` 恢复；
- `ControlsRefreshManager`（151 行）：按管控边界时间定时 `startControlMode()` + `updateUserEyeShieldInfo()`（L141-148，仅登录态）。

### 8.3 AI 违规识别
`control.p027v2.p028ui.AIViolationWarningActivity`（901 行）+ `ReportDataTask`：设备端行为数据上传后由服务端 AI 判定违规（截图/使用行为），推送告警并在教师端展示；学生端 `requestStudentViolationStatistics` 查询。

---

## 9. 远程协助（assist）

- `AssistService`（582 行）：常驻协助进程，`TYPE_APPLICATION_OVERLAY(2038)` 悬浮窗（协助状态："协助中/协助断开/协助完成"），`Messenger` IPC（`IpcHelper.BC_ASSIST=2000001` 接收指令 JSON、`BC_GETSTATUS=2000002` 查询状态）；`AssistManager.bindAssist`（198 行）负责绑定。
- `AssistInstruction`（46 行）+ `AssistNotify`（50 行）：推送 `assist-notify` 消息 → 弹出"老师请求协助"确认 → 进入 `RemoteAssistActivity`。
- `AssistFunc`（438 行，指令执行器，`antlr` 包 = 指令脚本解析）：远程可执行指令集包括：
  - `checkNetwork`（采集 SSID/RSSI/IP/DNS/网关/MAC 上报）、`probe(url)`（连通性探测）；
  - `getSystemConfig`（系统版本/型号/bootloader/指纹）；
  - 应用操作：安装/卸载/启动/停止/清数据/禁用/启用（走 `ApplicationPolicyProxy`）；
  - `setFirewall`（远程启停 iptables）、WiFi 相关操作、截屏采集上传；
  - 文件操作（下载/解压/上传，`DownloadManager`+`UploadHelper`+华为 OBS SDK）；
  - 结果统一 `upAssistResult` 回传服务器。
- 交互期间 `PolicyManager` 可临时放开被禁应用/设置，结束后由指令恢复正常策略。

---

## 10. 保活与防逃逸机制汇总

| 机制 | 实现位置 |
|---|---|
| 管控轮询 | `SyncService` 120s 定时 + `ControlRealTimeManager` 1s~60s 自适应轮询 |
| 推送保活 | TCP 心跳 + `PushAlarmReceiver` 闹钟唤醒 + WakeLock + 屏幕/WiFi 广播重连 |
| 进程保活 | 电池优化白名单、自启动白名单、通知白名单、前台服务 |
| 桌面锁定 | `setDefaultHome` + `controlChangeHome(false)` + 禁用华为/三星原桌面 |
| 防绕过 | 禁 USB 调试/MTP/SD 卡/多用户/多窗口/恢复出厂/刷机；禁改系统时间；清最近任务；禁开发者选项与设置入口；截屏管控 |
| 通知/状态栏 | 下拉栏隐藏、状态栏按钮逐项控制（PowerMode 等）、锁屏项禁用 |
| 签名防篡改 | `APP_SIGNATURE_CHECK` 位 + 安装时签名校验 |

---

## 11. 教师端管控控制台（编译进同一 APK 的 v2 模块）

`launcher.control.p027v2`（约 100 个文件）为 TOB 教师/管理员界面（与教师端共用模块）：
- 班级/学生管控主页 `ControlV2Activity` + `ClassControlFragment`/`StudentListControlFragment`；
- 批量管控：`StudentBatchControlListAct`（435 行）/`StudentListBatchControlFragment`，tab 切换管控类型；
- 应用管控：`StudentControlAppsAct`（874 行）、`PackageListControlFragment`（1220 行，全包列表管控）、`AppDetailActivity`（单应用详情 + 学生使用时长图表 `UseTimeChartView` 586 行）；
- 宵禁配置 `CurfewTimeActivity`（+ `CurfewTimeAdapter`/`WeekDaySelectView` 按周几配置时段）；
- 个人应用时段 `PersonalAppControlTimeActivity`/`PersonAppControlDetailAct`（707 行）；
- 管控模式 `SchoolControlDetailActivity`（694 行，模式规则编辑）、`ControlRuleAct`；
- 记录与违规：`ControlModifyRecordAct`（728 行，操作/变更记录）、`AIViolationWarningActivity`（901 行）；
- 临时解除：`TempRelieveControlDialog`（176 行，临时豁免管控）。

---

## 12. 关键默认值与常量表

| 项 | 默认值 | 出处 |
|---|---|---|
| 夜间管控窗口 | 22:30 → 次日 06:00 | `NightForbid.getDefaultNightForbid` |
| 服务端提前提示 | 2 分钟 | `ControlRealTimeManager.FORWARD_TIP_MINUTE` |
| 实体提前提示 | 5 分钟（TIP_OFFSET=300000） | `ForbidTime`/`LongTimeAndNightForbid` |
| 策略同步周期 | 120000ms | `SyncService` |
| 实时复查最小延迟 | 1000ms / 最大 60000ms | `ControlRealTimeManager` |
| 全局可用时段 | 06:00(360min) ~ 22:00(1320min)，maxDuration 86400s | `userDuration` |
| 考试模式上限 | 12 小时 | `ExamModeStatus` |
| 艺术类 App 长期禁用默认（遗留） | com.xh.aartunc 07:50-11:50 & 13:10-17:50 | `ForbidTime` |
| 应用锁失败阈值 | 3 次失败触发重验 | `AppLockLocalDataSource` |
| MDM 管控刷新 | 登录后 + `ControlsRefreshManager` 定时 + push 触发 | `startControlMode` 调用点 |

---

## 13. 结论：管控逻辑实施全链路

```
云端平台(TOB学校/TOC家长)
   │  HTTP /api/v1/forbidden/detail 等（120s 轮询）+ TCP push(control-service) + 设备状态上报
   ▼
ControlService/SyncService（服务进程）          ControlRepository（桌面进程）
   ├─ saveControlData → XmConfig                  ├─ startControlMode（权限4096门控）
   ├─ syncControlData → 广播/Provider             ├─ 合并 TOB/TOC 策略 → Room ControlMode
   └─ ControlRealTimeManager 实时裁决              ├─ Night/LongTime LooperTask 定时
        │  弹 ControlDialog（模糊+禁取消）          └─ ControlsRefreshManager 边界刷新
   ▼
PolicyManager（MDM binder）
   ├─ ApplicationPolicyProxy：应用启停/默认桌面/卸载锁
   ├─ RestrictionPolicyProxy：USB/MTP/SD/截屏/输入法/剪贴板…
   ├─ SettingPolicyProxy：设置隐藏/下拉栏/状态栏
   ├─ DateTimePolicyProxy：锁定系统时间
   └─ FirewallPolicyProxy：iptables 域名/应用规则
   ▼
学生可见效果：锁定的桌面 + 受控 App 列表 + 宵禁/时段弹窗 + 护眼休息页 + 应用锁 + 远程协助浮窗
```

**核心特征**：
1. **双保险下发**——HTTP 轮询兜底 + TCP 推送秒级生效，断网时本地默认策略（22:30-06:00 夜禁）仍生效；
2. **设备级釜底抽薪**——不是普通 App 层管控，而是通过厂商 MDM 系统服务直接操作系统策略（禁设置、禁时间修改、iptables），普通用户无法从系统设置逃逸；
3. **防篡改纵深**——加密广播（场景）、防伪造的考试模式、MDM 动态解锁码、签名校验、注销即全禁；
4. **优先级明确**——Scene > LongTime > Night，模块管控正交叠加，互斥时高优先级胜出；
5. **数据闭环**——使用时长、管控命中、违规行为全量上报，支撑 AI 违规识别与教师端审计。

（附：本报告基于静态反编译分析；`executeDynamicAppFirewall`、`reqForbiddenDetailV2`/`updateToBControlData`/`refreshControlModeDetail`、`DataLoaderV2.loadControlData`、`requestSchoolControlHolidayState` 等少数方法 jadx 未能完整反编译，其逻辑已通过调用点与 lambda 类（C278xx/C279xx）交叉还原，细节以混淆后字节码为准。）
