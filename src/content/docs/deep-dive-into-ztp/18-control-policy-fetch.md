---
title: "管控策略的获取链路与轮询机制"

description: "ztp 如何拿到服务器下发的管控策略：startControlMode 入口、V1/V2 forbidden-detail 接口、从 LRequest 到 OkHttp 的完整网络路径、以及五套轮询/定时循环的真实周期与勘误"

categories:
  - 技术解析
excerpt: 拆解 ztp 管控策略的获取链路：4096 权限位门控、/api/v1|v2/pub/platform/users/forbidden/detail、LCall→RealRequest→OkHttp 网络栈、UrlCache 网关轮换与微服务寻址，以及 ControlRealTimeManager 自适应轮询（1s~60s）与 120s SyncService 的真相。
---

# 管控策略的获取链路与轮询机制

> 分析对象：ZTP 反编译源码（`mdm_stu_v3.123.10.20250218S.apk`，jadx 输出）。
> 路径均相对 `app/src/main/java/`，行号为反编译源文件行号。
> 配套阅读：[[08-control-night-ban]]（管控执行引擎）、[[01-network-api]]（网络栈）、[[ztp-control-report]]（管控策略全量）。

## 一、结论速览

| 问题 | 答案 |
|------|------|
| 策略从哪来 | 一次 HTTP GET：`/api/v1/pub/platform/users/forbidden/detail`（ToB）或 `/api/v2/pub/platform/users/forbidden/detail`（ToC） |
| 谁发起 | `ControlRepository.startControlMode()`，**事件驱动**，共 7 个触发点 |
| 前置门控 | `Permission` 位掩码第 **4096** 位 + 学生端 + `userId > 0` |
| 有没有"定时拉网络" | **没有固定周期的网络轮询**。唯一的周期循环是一个 1s~60s 的**本地**重算循环，和 120s 的**本地文件→内存**同步循环 |
| 断网还能管控吗 | 能。配置落盘 `XmConfig(control)`，夜禁有本地默认 22:30–06:00 兜底 |
| 秒级下发靠什么 | 自研 TCP 推送 `control-service` 消息（心跳 30s） |

一句话概括：**ztp 的"轮询"绝大多数是本地定时重算，真正的策略拉取是事件驱动的一次性 GET**。这一点与 `ztp-control-report` §2.1 的表述（"每 120000ms 重复 → ControlService.syncControlData"被理解为网络轮询）有实质差异，见 §8 勘误。

---

## 二、数据结构：一条策略长什么样

### 2.1 ControlType（`com.xuehai.service.control.ControlType`）

| 值 | 常量 | 含义 |
|---|------|------|
| 0 | `CONTROL_TYPE_TOB` | 学校管控（教师/管理员配置） |
| 1 | `CONTROL_TYPE_TOC` | 家长管控（个人模式） |

`CommonControlsManager.updateControlType(int)`（L164-175）会在每次策略拉取成功后，把服务端返回的 `controlType` 写入 `SessionData.saveControlType()`，并 emit 一个 `StateFlow<Integer>`。`-1` 表示未知，此时用 `lastControlType` 兜底判断（L97-112）。

### 2.2 LongTimeAndNightForbid（策略主体实体）

`com.xuehai.launcher.common.data.entity.LongTimeAndNightForbid`，一个实体承载全部四类策略：

| 字段 | 类型 | 说明 |
|------|------|------|
| `curfew` | `NightForbid` | 夜禁窗口；`getDefaultNightForbid()` = 今天 22:30 → 次日 06:00 |
| `periods` | `List<LongTime>` | 长期时段管控（beginTime/endTime/packageName/classId/status） |
| `modeDuration` | `ModeDuration` | ToC 单应用模式时长（maxDuration/committedDuration/forceDisableUntil） |
| `userDuration` | `UserDuration` | 全局可用时长（06:00~22:00，maxDuration 86400s，倒计时） |
| `controlType` | int | 见 2.1 |
| `statusRefreshTime` | Long | **下一次该刷新策略的绝对时间戳**（驱动 §6.4 的定时器） |

`statusRefreshTime` 是个容易漏掉的字段——它不是心跳间隔，而是服务端指定的"下次检查点"，客户端拿它直接 `postDelayed`。

### 2.3 权限位门控

`com.xuehai.launcher.common.config.Permission` 的 long 位掩码，第 **4096** 位 = 本地管控总开关。`CommonControlsManager.hasPermission()`（L133-135）三条件与运算：

```java
Permission.checkPermission(4096L) && SessionData.isStudentLauncher()
    && SessionData.isStudent() && SessionData.getUserId() > 0
```

`ApplicationLikeControl.onCreateOnMainProcess()`（L208-236）用同一表达式决定整个 Control 模块是否初始化；`startControlMode()` 入口处再判一次（`ControlRepository` L2943-2949），不通过只打一行日志：

```
[Lc]::Control 本地管控权限已关闭！！
```

---

## 三、拉取入口：startControlMode 全链路

### 3.1 入口方法

`ControlRepository.startControlMode()`（L2943-2949）：

```java
public final void startControlMode() {
    if (CommonControlsManager.INSTANCE.hasPermission()) {
        ThreadPlugins.INSTANCE.getMyScope().launchInRequest(new AnonymousClass1(null));
    } else {
        MyLog.w("[Lc]::Control", "本地管控权限已关闭！！");
    }
}
```

协程体 `startControlMode$1`（L492-536）只做一件事——**按打包形态二选一**：

```java
if (ClientConfig.is2C()) {
    reqForbiddenDetailV2(this);   // ToC 个人版
} else {
    MyLog.w("[Lc]::Control", "reqForbiddenDetail");
    reqForbiddenDetail(this);     // ToB 学校版
}
```

> 注意：分流依据是 **APK 的 2B/2C 形态**，不是上一条策略的 `controlType`。同一份代码在学生 2B 包里永远走 V1。

### 3.2 七个触发点（全部事件驱动）

| # | 触发点 | 位置 | 场景 |
|---|--------|------|------|
| 1 | `ApplicationLikeControl.onCreateOnMainProcess` | L231-234 | 主进程启动且已登录 |
| 2 | `ApplicationLikeControl.whenOnTop` | L238-246 | 应用回到前台 |
| 3 | `HomeViewModel` | L320 | 首页"正在检查数据更新…"阶段 |
| 4 | `NetworkBusiness.refreshWifi` | L64-69 | 网络恢复可用 |
| 5 | `LauncherPushService.disposeMessage` | L153-161 | 收到推送 `control-service` |
| 6 | `ControlReceiver.onReceive` | L53-56 | 广播 `com.xuehai.control.action.all_control` |
| 7 | `PackageReceiver` | L36-41 | 应用安装/卸载后 |

另外 `ControlsRefreshManager.RefreshControlRunnable.run()`（L46-55）在服务端指定的 `statusRefreshTime` 到点后也会调一次。

### 3.3 两个接口的入参

`ControlRemoteDataSource`（L332-349）：

```java
// ToB
public LResponse reqForbiddenDetail(long userId) {
    MyLog.d("[Lc]::Http", "请求长期管控和夜禁数据等详情");
    HashMap map = new HashMap();
    map.put("userId", String.valueOf(userId));
    return requestWithRestfulSync(new LRequest.Builder()
        .url(url() + "/api/v1/pub/platform/users/forbidden/detail", map).build());
}

// ToC
public LResponse reqForbiddenDetailV2(long modeId, long userId) {
    MyLog.d("[Lc]::Http", "获取平台使用时长和应用管控等相关信息");
    HashMap map = new HashMap();
    map.put("modeId", String.valueOf(modeId));
    map.put("userId", String.valueOf(userId));
    map.put("deviceId", XhApplication.getInstance().getDeviceId());
    return requestWithRestfulSync(new LRequest.Builder()
        .url(url() + "/api/v2/pub/platform/users/forbidden/detail", map).build());
}
```

- 全部是 **GET + 全部参数走 query string**（`LRequest.Builder.url(url, map)` → `HttpUtil.buildGetRequest`，L286-294）。
- V2 多两个参数：`modeId`（当前选中的管控模式，来自 Room `ControlMode`）与 `deviceId`。
- `url()` = `UrlCache.getHttpUrl()`，即**网关地址**，不是微服务地址（详见 §4.1）。

### 3.4 响应处理：去重 + 日切 + 落盘

`reqForbiddenDetail`（L795-998）的主干逻辑：

1. `parseJson(body, LongTimeAndNightForbid.class)`，失败打 `长期管控和夜禁数据解析失败!`。
2. 与静态缓存 `forbidHistoryData` 比较；`latelyUpdate` 记录上次"生效日"（`DayUtils.floorToDayStart(now)`）。
3. **写盘条件** = `!equals(forbidHistoryData, body) || latelyUpdate != todayStart`。第二个条件意味着**每天至少强制重放一次**，防止跨天窗口（如 22:30 起夜禁）在进程长期存活时算错。
4. 写盘 → `localDataSource.saveControlData(schoolId, userId, body)`。
5. `controlModeDetail.emit(forbid)`（`MutableSharedFlow`，replay=1）广播给 UI。
6. `NightForbidManager.notifyControlChanged()` + `LongTimeManager.notifyControlChanged()` 重建两个 LooperTask。

V2 路径（L1000-1115）多两步业务分流：

```java
if (CommonControlsManager.INSTANCE.updateControlType(forbid.getControlType())) {
    CPVDControlData.update(ctx, new CPVDControl(Long controlType));
    ControlsRefreshManager.INSTANCE.refreshControls(forbid.getStatusRefreshTime());  // ← 定时器
    if (isToCControlType) updateToCControlData(...);   // 写 control_key_v2_{userId}_{modeId}
    if (isToBControlType) updateToBControlData(...);   // 写 control_key_{schoolId}_{userId}
}
```

> 反编译噪声：jadx 在 L1052-1068 把 `isSuccessful()` 的判断渲染反了（成功分支里写 `responseBody=""`）。对照 V1 同名逻辑（L846-896）与日志文案可知实际语义是：**成功 → 解析并更新；失败/解析失败 → `refreshControlModeDetail()` 用本地数据兜底**。

---

## 四、网络路径

### 4.1 第一跳：UrlCache 多网关轮换

`com.xuehai.launcher.data.cache.UrlCache`：

```java
// L29-36
errorSet = { 107000006, 107001012, 107004001 };
// L127-140
public static final String nextHttpUrl() {
    position++;
    List<String> addressList = getAddressList("SA106003");       // 服务端下发的网关列表
    List listPlus = CollectionsKt.plus(addressList, Configuration.getHttpUrlArray());
    if (position >= listPlus.size()) position = 0;
    setHttpUrl((String) listPlus.get(position));
    return getHttpUrl();
}
```

- 地址池 = 登录返回的 `Account.MicroAddressDTO`（`serverType = "SA106003"`，需 `NetworkLineConfig.isRemoteUrlEnable()`）**拼接** 内置兜底 `Constants.Default.URL_ARRAY = {"https://ztp.yunzuoye.net"}`（L21）。
- `getHttpUrl()`（L86-91）懒初始化：第一次访问触发 `nextHttpUrl()`（`position` 从 -1 起，取下标 0）。
- `nextHttpUrl(int errorCode)`（L143-147）只对 3 个错误码换网关：`107000006 / 107001012 / 107004001`。
- 登录信息变更时 `checkLauncherUrlChange()`（L42-46）→ `reset()` 清空重取。

### 4.2 第二跳：LCall 拦截器链

`RequestHelper`（L52-62）三个入口：

```java
requestWithRestfulSync(req)      → new LCall(req).execute()
requestWithRestfulByRx(req)      → new LCall(req).executeByRx().subscribeOn(requestScheduler).observeOn(ioScheduler)
requestWithRestful(req, cb)      → new LCall(req).execute(cb)
```

管控用的是 **同步版** `requestWithRestfulSync`，跑在 `ThreadPlugins.getRequestDispatcher()` 上（`ControlRepository$reqForbiddenDetail$response$1`）。

`LCall.getResponseWhitChain()`（L131-137）拼链，极简：

```java
interceptors(业务自定义，通常为空) + HttpLogInterceptor + RealRequest
→ RealInterceptorChain.process(request)
```

### 4.3 第三跳：RealRequest → XHRequestOkHttpProxy

`RealRequest.intercept()`（L167-229）是链尾，负责把 `LRequest` 翻译成 `XHRequestOkHttpProxy`：

```java
if (!BaseApplication.getInstance().isOnline())     → 直接返回 -1 "当前处于离线状态"
if (TextUtils.isEmpty(request.getUrl()))           → -1 "请求的URL不可为空"

XHRequestProxy.createOkHttp()
    .setUrl(request.getUrl())
    .setIsAsync(false)                              // 同步（虽然包了 callback）
    .setMethod(request.getMethod())
    .setHeaders(request.getHeader().headers)
    .tag(AllowUploadNetworkError.class, new AllowUploadNetworkError(request.getSaveError()))
    .setCallback(...)
```

回调里有一段解包：响应体若是 `{"httpResponse": "..."}` 包装，取内层（L192-197），这是为了兼容老网关的二次包装。

`XHRequestOkHttpProxy.requestInner()`（L236-264）负责 URL 拼装与微服务寻址：

```java
if (TextUtils.isEmpty(getServerType())) {
    frontAppendWithServerTypeUrl = businessUrl;                  // 已是绝对 URL
} else {
    String actualIp = XHMicroServer.getInstance().getActualIp(getServerType(), classId);
    if (TextUtils.isEmpty(actualIp)) { 回调 107001206; return; }
    frontAppendWithServerTypeUrl = actualIp + businessUrl;
}
```

### 4.4 默认请求头

`BaseRemoteDataSource.Companion.initRequest()`（L95-102）注册全局默认头构造器：

| Header | 值 |
|--------|-----|
| `Content-Type` | `application/json` |
| `Accept` | `*/*` |
| `User-Agent` | `{pkg}/{ver} ({MODEL}; android; {RELEASE}; {deviceId})` |
| `AppCode` | `ClientConfig.getAppCode()` |
| `Tenant` | `SessionData.getPlatformMode()` |
| `Authorization` | `Bearer {accessToken}`（登录后） |
| `UserId` | `{userId}`（>0 时） |

`LRequest.needHeader()` 打开的是另一条路：给 OkHttp 挂一个应用拦截器，把真实 `Response.headers` 回写到 `LResponse`（`RealRequest` L211-218），用于读 `X-Accept-Security`、`X-B3-TraceId` 等。

### 4.5 微服务寻址（另一条独立通道）

管控拉取本身不走微服务（用的是网关 `SA106003`），但**同包内的 service 进程通道**走微服务，两者容易混：

```
ServerConfig.controlServiceConfig()  →  ServiceConfig("SB103015", 3000ms)   // L18-20
        │
        ▼
BaseService.getServiceUrl(0)  →  ServiceUrl("SB103015", classId=0)
        │
        ▼
AddressLoader.getServiceUrl(classId, type)
        ├─ classId > 0 → XHMicroServerV3.getServerUrl(type, classId)
        └─ else        → XHMicroServerV2.getServerUrl(type)          // L13-15
        │
        ▼
BaseMicroServer.getServerUrl()  ← URL_MAP（内存） / XmConfig（磁盘缓存） / new ServerUrlUnify(type, classId)
        │
        ▼
ServerUrlUnify.getUrl()  =  protocol + "://" + (domainOrIp[:port]) [ + "/" + dirLocation ]   // L204-227
```

地址来源：`POST https://ms.yunzuoye.net/api/v1/pub/microServer/`（`Configuration.microServerRestfulArray()`，L172-174），请求体 `MicroServerReqBeanV2` 含 `schoolId` + `serverTypes[]`（每项带 `version`，版本未变可命中缓存）。

### 4.6 失败轮换与容错

三层，逐层下沉：

| 层 | 机制 | 位置 |
|---|------|------|
| JDK 层 | `isNeedPolling(code)` 命中则 `requestAgain()` → 切下一个 IP 并**重放请求** | `XHRequestOkHttpProxy.failedCallBack` L94-105；`XHHttpUtil.isNeedPolling` L12-14 |
| 微服务层 | `BaseMicroServer.nextMicro()` 环状递增 `currentIndex`，越界归零并返回 false（表示已轮完一圈） | L362-377 / L521-526 |
| 网关层 | `UrlCache.nextHttpUrl(errorCode)` 换网关 | L143-147 |

需轮询的错误码：`107000006 / 107001012 / 107001016 / 107004001`（比 `UrlCache.errorSet` 多一个 `107001016`）。

`ControlService.reqControlData` 的 `failed` 回调还给了一个**业务级**补救（L293-300）：`serviceUrl.nextMicro()` 换到下一个微服务地址，供下一次调用使用。

### 4.7 全链路示意

```
ControlRepository.startControlMode()
        │ GET /api/v2/pub/platform/users/forbidden/detail?modeId&userId&deviceId
        ▼
LRequest(url = UrlCache.getHttpUrl() + path, header = 默认头)
        ▼
LCall: [HttpLogInterceptor] → [RealRequest]
        ▼
XHRequestOkHttpProxy.setUrl().setMethod().setHeaders().setCallback().request()
        ▼
OkHttpClientManager.defaultRequestClient
   RedirectInterceptor → RequestHeadHandlerInterceptor(白名单/剥 Authorization)
   → ResponseSignInterceptor → logBodyInterceptor → ResponseSignCheckInterceptor
   [network] RequestSignInterceptor(V1/V2 签名，JNI)
   BootstrapDNS(Cache → Local → HTTPDNS 203.107.1.1) / XHHostnameVerifier(IP 直接放行)
   [HTTP/1.1 only]
        ▼
LResponse{code, responseBody}  ← 同步返回
        ▼
XmJsonUtil.parseJson → LongTimeAndNightForbid
        ▼
XmConfig(control) 落盘 + SharedFlow 广播 + LooperTask 重建
```

---

## 五、落库、分发与跨进程可见性

### 5.1 存储位置

`ControlLocalDataSource`（L21-23、L55-61、L113-124）统一写 `XmConfig.getControlConfig()`（properties 文件）：

| key | 内容 | 写入方 |
|-----|------|--------|
| `control_key_{schoolId}_{userId}` | V1 全量策略 JSON | `saveControlData` |
| `control_key_v2_{userId}_{modeId}` | V2 ToC 模式策略 JSON | `saveForbiddenDetailV2` |

`saveControlData` 末尾还会 `ControlService.syncControlData(schoolId, userId)`——**同进程立即刷新** service 层的静态 `forbidTime`（L70-73）。

### 5.2 三条分发通道

| 通道 | 载体 | 消费方 |
|------|------|--------|
| 进程内响应式 | `MutableSharedFlow<LongTimeAndNightForbid> controlModeDetail`（replay=1） | UI（`controlModeDetail()`、倒计时、桌面角标） |
| 进程内定时器 | `NightForbidManager.notifyControlChanged()` / `LongTimeManager.notifyControlChanged()` | 两个 LooperTask 重排下次触发点 |
| 跨进程 | `MyContentProvider`（`content://com.xh.zhitongyun.provider/control`）；广播 `com.xuehai.control.action.all_control`、`...app_permission` | 第三方 App（`DataLoaderV2.loadControlData`，L28-47）；`ControlReceiver` |

`DataLoaderV2` 还带一层内存兜底 `historyDataMap`：Cursor 取不到时回退上次值（L49-56），避免 Provider 抖动导致管控瞬间失效。

---

## 六、轮询机制（重点）

### 6.1 五套循环总览

| 循环 | 载体 | 周期 | 走网络？ | 作用 |
|------|------|------|---------|------|
| `ControlRealTimeManager` | `Handler.postDelayed` 链式自调 | `min(距下次管控边界, 60s)`，下限 1s | ❌ | 前台界面实时判定/弹窗 |
| `NightForbidManager` | `LooperTask` | 距夜禁边界，下限 5s | ❌ | 到点切换夜禁态 |
| `LongTimeManager` | `LooperTask` | 距时段边界，下限 10s | ❌ | 到点切换时段态 |
| `ControlsRefreshManager` | `Handler.postDelayed` | 服务端 `statusRefreshTime` + 2s | ✅ 一次 | 到点重拉策略 + 护眼信息 |
| `SyncService` | `HandlerThread` | 固定 120s | ❌ | XmConfig → 内存重载 |
| Push 心跳 | `ScheduledExecutor` | 30s（`PushConfig` 默认） | TCP | 保活长连接 |

### 6.2 ControlRealTimeManager——真正意义上的"轮询"

`com.xuehai.service.control.ControlRealTimeManager`（832 行），是**唯一会按秒级节奏反复执行的循环**，但它的每一轮**只读本地数据**，不发请求。

**启动/停止挂在 Activity 生命周期上**（`init()` L749-756 注册 `ActivityLifecycleCallbacks`）：

```java
public final void onResume(Activity activity) {          // L806-816
    if (isSkip(activity)) return;                        // SkipCheckControl 接口 / skipClass 名单
    this.stopFlag = false;
    cancel();                                            // 取消上一轮
    startWork(activity);
}
public final void onPause(Activity activity) { stop(); }  // L796-804，stopFlag=true + cancel
```

**核心节奏**由 `DelayModel` 决定，默认配置（L124-126）：

```java
new Config(skipClass = [], forwardTipMinute = 2,
           delayModel = new MaxDelayModel(60000L, 60000L),   // maxDelay=60s, errorDelay=60s
           threadScheduler = new DefThreadScheduler());
```

`MaxDelayModel.computationTime()`（L325-335）：

```java
if (timeControl == null) return errorDelayTime;                       // 60s
return coerceAtMost(timeControl.getBeginTime() - now, maxDelayTime);  // min(距开始, 60s)
```

`handleControl()`（L508-557）的分支：

| 状态 | 行为 | 下次延迟 |
|------|------|---------|
| 无管控数据 | 记日志"没有获取到管控数据，启用延迟 Xms 后再次检测" | `max(computationTime(null)=60s, 1s)` = **60s** |
| 正在管控中 | `showControl(true, ...)` 弹窗并 `stop()` 停止循环 | 不再调度 |
| 未管控，且进入提前 2 分钟窗口 | 弹"X 分钟后限制使用"提醒（`advancedFlag` 防重复） | `computationTime(data)` |
| 未管控，延迟 ≤ 0 | 立即弹管控窗 | 不再调度 |
| 未管控，延迟 > 0 | 精确睡到边界 | `coerceAtMost(begin-now, 60s)` |
| 抛异常 | 记日志 + 堆栈，延迟重试 | `max(errorDelay=60s, 1s)` |

所以实际行为是：**距离下一个管控边界还很久时，每 60s 醒一次复查；一旦进入最后 60s，则精确睡到边界那一毫秒**。这就是文档里"最小延迟 1000ms / 最大 60000ms"的准确含义——1s 只是兜底下限（`coerceAtLeast`），默认配置下永远触发不到。

`DefThreadScheduler`（L222-291）：`Executors.newCachedThreadPool()` 跑 IO，`Handler(Looper.getMainLooper())` 跑 UI 与 `startDelay`；`cancel()` 通过 `removeCallbacks` 实现，一次只有一个链在飞（`currentCancelable` 单槽）。

提示提前量：常量 `FORWARD_TIP_MINUTE = 2`（L37），而实体层 `LongTimeAndNightForbid` 的 `TIP_OFFSET = 300000`（5 分钟）——**两层不一致**，界面上看到的"还剩几分钟"取决于走的是哪个入口。

### 6.3 NightForbidManager / LongTimeManager——边界对齐型定时

两者都是 `LooperTask`，不是固定周期，而是**每次算到下一个业务边界**。

`NightForbidManager`（L15-51）：

```java
protected long calculateNextDelay() { return Math.max(this.delay, 5000L); }
// run() 里重算：
if (now > beginToday)                 delay = (endToday + 86400000) - now;
else if (now < endToday)              delay = endToday - now;
else                                  delay = beginToday - now;
```

到点动作三连：`EventBus.post(RefreshTheme)` + `EventBus.post(RefreshTimeControl)` + `TimeControlManager.notifyTimeControlChanged(ctx, "NightControl", null)`。

策略缺失时的兜底（L79-83）：

```java
if (curfew != null && beginTime != 0 && endTime != 0) return curfew;
MyLog.i("[Lc]::Control", "没有获取到服务端夜禁时间, 使用本地默认 22:30 - 6:00");
return LongTimeAndNightForbid.NightForbid.getDefaultNightForbid();
```

`LongTimeManager`（L37-70）同理，下限提高到 **10000ms**，数据为空时直接睡到**当天结束**（`DayUtils.roundToDayEnd`）。

### 6.4 ControlsRefreshManager——唯一会"到点重拉"的定时器

`refreshControls(Long refreshMills)`（L122-132）：

```java
if (refreshMills == null) { TaskPlugins.removeTask(runnable); return; }   // 服务端说不用刷
TaskPlugins.postTask(runnable, (refreshMills - now) + 2000L);             // 注意 +2s
```

`run()` 里做三件事（L46-55）：拉管控模式列表 + `startControlMode()` + `updateUserEyeShieldInfo()`。

`+2000ms` 是刻意的服务端时钟偏差补偿——客户端时钟被 MDM 强制 NTP 同步后仍有秒级漂移，提前发起会拿到旧配置。

### 6.5 SyncService 的 120s：不是网络轮询

`com.xuehai.service.control.SyncService`（75 行）：

```java
private static final Handler syncDataHandler = new Handler(handlerThread.getLooper()) {
    public void handleMessage(Message msg) {
        if (msg.what != 0) return;
        syncDataHandler.sendEmptyMessageDelayed(0, 120000L);      // L33
        ControlService.syncControlData(schoolId, userId);          // L34
    }
};
```

而 `ControlService.syncControlData`（L70-73）的实现是：

```java
forbidTime = (ForbidTime) XmJsonUtil.parseJson(
        XmConfig.getControlConfig().getProperty(getConfigKey(schoolId, userId)), ForbidTime.class);
Log.i("ControlService", "从本地文件中同步管控数据到内存 : " + forbidTime);
```

**它只是把 properties 文件里的字符串重新反序列化到静态字段**，一次网络请求都没有。

真正的网络请求在 `ControlService.reqControlData`（L281-327）：

```java
map.put("schoolId", ...); map.put("userId", ...);
ServiceUrl serviceUrl = getServiceUrl(0);                              // SB103015, classId=0 → V2
String url = ServiceUtil.buildGetRequest(serviceUrl.getMicroUrl("/api/v1/forbidden/detail"), map);
get(url).setCallback(...).request();                                    // ← 一次性 GET
SyncService.start(context, schoolId, userId);                           // ← 顺手把 120s 循环拉起来
```

而 `reqControlData` 的唯一上层调用是 `DataLoaderV1.syncControlData`（L79）← `ControlServer.reqControlData`（L158）← `ControlServer.startControl`（L162）← **只有调试面板** `DebugViewModel` L889 调用。

结论：**service 进程这条 `/api/v1/forbidden/detail` 通道在正式使用路径上已退化为调试入口**（`ControlServer` 类上还标着 `@Deprecated`）。线上生效的是 launcher 进程的 `ControlRepository` 链路。120s 循环的真实作用，是在同一份 `XmConfig` 被**另一个进程**（launcher 主进程）改写后，让 service 进程的静态 `forbidTime` 在最多 2 分钟内跟上——跨进程一致性轮询，而非策略拉取轮询。

### 6.6 TaskPlugins / LooperTask——所有 LooperTask 的节拍器

`TaskPlugins`（L19-191）用一个 `HandlerThread("launcher_task_thread")` 驱动全部 `LooperTask`：

```java
private final void startLooper(long startAt) {                       // L175-177
    postTask(looperRunnable, coerceAtLeast(startAt - SystemClock.elapsedRealtime(), 500L));
}
// runLooper() 遍历所有 task：reachTime() → filter() → run() → markExecuted() → next()
// 然后把 tick 对齐到所有 task 中最早的 whenDo
```

- 节拍**下限 500ms**，且靠 `elapsedRealtime()`（不受用户改时间影响 —— 这一点和 MDM 禁改时间互为加固）。
- `addLooperTask` 内用 `WeakReference` 存 task（L26、L62），进程内存压力下自动摘除。
- `LooperTask.calculateNextTimeMills()` 同样有 `coerceAtLeast(delay, 500)`（L17）。

### 6.7 推送长连接：把"轮询"换成"推送"

`com.xuehai.message.sdk`：

| 参数 | 值 | 出处 |
|------|-----|------|
| 心跳周期 | 30s | `PushConfig` 构造默认值（L39，mask 64 → 30000L） |
| `HEART_DELAY` | 90000 | `PushConstants` L9 |
| AlarmManager 兜底唤醒 | `now + heartbeatPeriod * 2`（≈60s） | `PushAlarmReceiver` L53-55 |
| 重连退避 | `RetryRuleV1(0, 600000, ...)`，上限 10 分钟 | `PushClient` L65 |
| 心跳调度 | `scheduleAtFixedRate(task, 1000L, period)` | `PushClient` L248 |

收到 `control-service` 消息即 `startControlMode()`（`LauncherPushService` L153-161，常量见 `MsgType.CONTROL_UPDATE`）。这就是"秒级下发"的全部秘密——**没有轮询，纯推送 + 一次 GET**。报文本身不含任何策略字段（`payload` 该分支不读取），完整拆解见 [[19-push-control-service]]。

断线期间只能靠 §3.2 的 7 个事件点补拉，最坏情况是"网络正常、无 push、用户不切前台"——此时依赖 `statusRefreshTime` 定时器兜底（服务端可在响应里指定 5 分钟/15 分钟级别的检查点）。

---

## 七、判定与生效（拿到之后怎么用）

`ControlManager.getControlData(req, forwardTipMinute)`（L82-117）的优先级：

```
1. SceneControl   处于启用          → 返回场景管控
2. NightControl   处于启用          → 返回夜禁
3. LongTimeControl 处于启用         → 返回时段管控
4. NightControl   进入 forward 窗口 → 返回夜禁（提前提醒）
5. LongTimeControl 进入 forward 窗口 → 返回时段（提前提醒）
6. 都没有 → findClosedControl(Scene/Night, LongTime) 取 beginTime 更早者
```

注意 `checkControlStatus()`（L18-34）的短路顺序是 **Scene → LongTime → Night**，与 `getControlData` 的 **Scene → Night → LongTime** 不同。前者只回答"要不要拦"，后者回答"拦哪一个"，所以不影响结果，但读代码时容易看错。

时间判定（`NightControl.checkInControl`，L13-16）：

```java
return timeMillis > getFormatBeginTime()          // 已过今天开始
    || timeMillis + 86400000 < getFormatEndTime(); // 或还没到今天结束（跨日）
```

弹窗不可取消（`ControlDialog.setCancelable(false)`），可对宿主 Activity 截屏 + 高斯模糊，按钮为"我知道了"，提前提醒态额外带"退出应用"。

---

## 八、勘误与易错点

| 既有表述 | 实测 | 说明 |
|---------|------|------|
| `SyncService` 每 120s **拉取** `/api/v1/forbidden/detail` | 120s 只做 `XmConfig → 内存`；网络 GET 在 `reqControlData` 里，只发生一次 | `SyncService` L33-34 vs `ControlService` L281-327 |
| 策略拉取是"定时轮询为主通道" | 主通道是**事件驱动**（7 个触发点）+ 推送；无固定周期网络轮询 | §3.2 / §6.7 |
| `ControlRealTimeManager` 每 1s 复查 | 默认 60s，只在进入边界前 60s 内才精确到边界；1s 是 `coerceAtLeast` 下限，默认配置不触发 | L124-126 / L325-335 |
| 提前提示 5 分钟 | 服务端裁决层 `FORWARD_TIP_MINUTE = 2`；实体层 `TIP_OFFSET = 300000`（5 分钟） | 两套常量并存 |
| V1/V2 按 controlType 分流 | 按 `ClientConfig.is2C()` 分流；`controlType` 由响带回写 | L516-527 |
| `/api/v1/config/policy` 是策略主接口 | 只被教师端 UI 用作宵禁时间选择器范围（`ControlPolicy.CurfewTimeRange`） | `ControlRemoteDataSource` L313，调用于 `ControlCurfewFragment` L47 / `PackageListViewModel` L360 |
| jadx 还原的 V2 成功分支是 `responseBody=""` | 反了。成功 → 解析；失败 → 本地兜底 | L1052-1068，对照 V1 L846-896 |

另外两个隐蔽点：

1. **`forbidHistoryData` / `latelyUpdate` 是 `static`**，跨用户不清理（登出只 `CommonControlsManager.reset()`）。切换账号后首轮判断可能命中旧缓存，靠 `latelyUpdate != todayStart` 在跨天时刻自愈。
2. **`ApplicationLikeControl.whenOnTop` 每次回前台都发一次 GET**（L238-246），没有节流。频繁切前台的设备一天可产生数百次请求，这也是抓包时最容易看到的管控流量。

---

## 九、可观测点（抓包/日志对照表）

| 抓什么 | 特征 |
|--------|------|
| URL | `GET https://ztp.yunzuoye.net/api/v1/pub/platform/users/forbidden/detail?userId=…`（ToB），`/api/v2/…?modeId=…&deviceId=…`（ToC） |
| 频率 | 登录后 1 次；每次回前台 1 次；每次网络恢复 1 次；每次 push 1 次；`statusRefreshTime` 到点 1 次 |
| 日志 tag | `[Lc]::Control`、`[Lc]::Http`、`ControlRealTimeManager`、`ControlService`、`SyncService`、`AddressLoader` |
| 关键日志 | `本地管控权限已关闭！！`（4096 未置位）、`请求长期管控和夜禁数据等详情`、`接口返回模式管控数据 modeId:`、`没有获取到服务端夜禁时间, 使用本地默认 22:30 - 6:00`、`NightForbidManager 下次检测夜禁管控状态 : …` |
| 落盘 | `XmConfig(control)`：`control_key_{schoolId}_{userId}`、`control_key_v2_{userId}_{modeId}` |
| 错误码 | `107000006 / 107001012 / 107001016 / 107004001` → 触发换 IP 重放；`107000401` → token 失效 |
| 跨进程 | Provider `content://com.xh.zhitongyun.provider/control`；广播 `com.xuehai.control.action.all_control` |

---

## 十、关键类索引

| 类 | 位置 | 职责 |
|----|------|------|
| `ControlRepository` | `launcher/control/data`（2981 行） | 策略中枢：拉取/去重/落盘/广播/兜底 |
| `ControlRemoteDataSource` | `launcher/control/data` | 全部管控 REST 接口定义 |
| `ControlLocalDataSource` | `launcher/control/data` | `XmConfig` 读写 + Room 模式表 |
| `CommonControlsManager` | `launcher/control` | 4096 门控、controlType 状态机 |
| `ControlsRefreshManager` | `launcher/control` | `statusRefreshTime` 定时重拉 |
| `NightForbidManager` / `LongTimeManager` | `launcher/control` | 边界对齐 LooperTask |
| `ControlRealTimeManager` | `service/control`（832 行） | 前台界面级自适应轮询 1s~60s |
| `ControlManager` | `service/control` | Scene > Night > LongTime 裁决 |
| `ControlService` | `service/control` | `ForbidTime` 缓存 + 弹窗工厂 + 调试拉取 |
| `SyncService` | `service/control` | 120s 跨进程内存同步 |
| `ControlReceiver` | `launcher/control/receiver` | 广播触发重拉 |
| `LauncherPushService` | `launcher/message/push` | `control-service` 推送分发 |
| `UrlCache` | `launcher/data/cache` | 网关地址池与轮换 |
| `LCall` / `RealRequest` | `launcher/common/http` | 请求抽象与链尾 |
| `XHRequestOkHttpProxy` | `xh/xhcore/.../request` | OkHttp 代理 + 微服务寻址 + 错误轮换 |
| `BaseMicroServer` | `xh/xhcore/common/http` | IP 列表缓存、`nextMicro` 环状轮换 |
| `TaskPlugins` / `LooperTask` | `launcher/data/util/plugins` | 全局定时器（500ms 节拍） |
