---
title: "学海网络子系统"

description: "智通平台客户端的网络请求链路：从 LRequest 抽象层到 OkHttp 拦截器链、微服务寻址、DNS 与 HTTPS 加固"

categories:
  - 技术解析
excerpt: 反编译解析学海客户端的完整网络栈：请求抽象层、OkHttp 拦截器链、微服务 IP 下发、自研 DNS 与 HTTPS 证书体系。
---

# 学海网络子系统解析

## 前言

学海客户端（智通平台 ZTP / 智通云 ZTY）的网络栈分为三层：

1. **业务请求抽象层** `com.xuehai.launcher.common.http` —— 面向业务代码的 `LRequest` / `LCall` / `LResponse` 封装
2. **核心网络引擎** `com.p017xh.xhcore.common.http` —— 基于 OkHttp 的拦截器链、微服务寻址、DNS、HTTPS 加固
3. **网络状态监控** `com.xuehai.launcher.network` —— WiFi 状态监听、网络信息落盘、代理检测

本文按这三层展开。

## 一、业务请求抽象层（com.xuehai.launcher.common.http）

### 1.1 LRequest —— 请求模型

`LRequest` 是业务侧发起请求的统一模型，通过 `Builder` 构建。核心字段：

| 字段 | 说明 |
|------|------|
| `url` | 请求地址 |
| `method` | 请求方法（GET/POST/PUT/PATCH/DELETE，来自 `RequestMethod`） |
| `header` | `LRequestHeader`，携带默认头 + 业务自定义头 |
| `body` | `LRequestBody`，请求体 |
| `gzip` | 是否 gzip 压缩请求体 |
| `timeout` | 超时时间（-1 表示使用默认） |
| `needHeader` | 是否附加默认请求头 |
| `needVerifyResponseSign` | 是否校验响应签名 |
| `needLog` / `saveError` / `toast` | 日志/错误保存/Toast 开关 |
| `extMap` | 扩展参数 |

Builder 默认值：`method = GET`、`timeout = -1`、`saveError = true`。`url(url, map)` 会通过 `HttpUtil.buildGetRequest` 把参数拼进 URL。

### 1.2 LRequestBody —— 请求体

`LRequestBody.create(Object)` 支持三种类型：
- `String` → 原样返回
- `JSONObject` / `JSONArray` → `toString()`

### 1.3 LRequestHeader —— 请求头

- 构造时若设置了 `DefaultBuilder`，会先填充默认头（`getDefaultHeaderMap()`）
- `header(name, value)` / `headers(map)` 追加自定义头
- `log()` 将头序列化为 JSON 打印

### 1.4 LCall —— 拦截器链执行器

`LCall` 是请求的执行单元，模仿 OkHttp 的拦截器链设计：

```
getResponseWhitChain():
    interceptors (业务自定义拦截器)
    + HttpLogInterceptor
    + RealRequest (真正发请求)
    → RealInterceptorChain.process(request)
```

- `execute()`：同步执行，异常时返回 `LResponse.setError(throwable)`
- `executeByRx()`：包装为 `Observable.fromCallable`
- `execute(ZCallback)`：异步执行，成功回调 `onNext(preNext(body))`，失败回调 `onError(code, msg)`，最终 `onCompleted()`

### 1.5 LResponse —— 响应模型

- `code`：HTTP 状态码
- `responseBody`：响应体字符串
- `restfulError`：`RestfulError` 错误对象
- `header`：OkHttp `Headers`
- `isSuccessful()`：`200 <= code < 300`
- `isSessionFailed()`：`code == 107000401`（token 失效）
- `setError(ErrorCode/Throwable/int, msg, RestfulError)`：统一错误处理
- `printError()`：格式化错误信息

### 1.6 RequestHelper —— 请求入口

```java
requestWithRestfulSync(LRequest)   // 同步
requestWithRestfulByRx(LRequest)   // RxJava 异步（requestScheduler → ioScheduler）
requestWithRestful(LRequest, cb)   // 回调式
unifyErrorDispose(LResponse)       // 统一错误处理，token 失效时通知所有 ErrorResponseListener
reqMicroService(ZCallback)         // 请求微服务 IP 列表
```

### 1.7 UploadHelper —— 文件上传

- `uploadBury` / `uploadFileLogService`：上传到 `http://filesoss.yunzuoye.net/XHFileServer/file/upload/{appCode}`
- `upload(url, filePath, extraPath, cb, allowError)`：
  - 校验文件存在、非空、非目录
  - 用 `path + MD5(file)` 作为去重 key（`UPLOAD_HISTORY` LruCache 30 条）
  - 通过 `XHUploadOkHttpProxy` 上传，附加 `XHUploadUtil.ALIYUN_UPLOAD_EXTRA_PATH_HEADER_KEY` 头（`extraPath/yyyyMMdd`）
  - 支持 `AllowUploadNetworkError` tag 控制网络错误是否上报

## 二、核心网络引擎（com.p017xh.xhcore.common.http）

### 2.1 OkHttpClientManager —— 客户端工厂

单例，构造时初始化两个 OkHttpClient：

**defaultRequestClient**（普通请求）：
```
connectTimeout 10s / readTimeout 10s / writeTimeout 10s
拦截器链（按顺序）：
  [应用拦截器]
  1. RedirectInterceptor          —— 记录重定向信息
  2. RequestHeadHandlerInterceptor —— 域名白名单/外链判断
  3. ResponseSignInterceptor       —— 响应签名校验（X-Accept-Security）
  4. logBodyInterceptor            —— 请求/响应日志（BODY 级别）
  5. ResponseSignCheckInterceptor  —— 403 签名错误检查（触发登出）
  [网络拦截器]
  6. RequestSignInterceptor / RequestSignV2Interceptor —— 请求签名（按 useV2Sign 开关）
  [公共]
  - OkHttpExceptionCollectInterceptor —— 异常收集
  - ProxyExceptionInterceptors       —— 代理异常
  - CollectIPInterceptor             —— 收集连接 IP（isObtainDeviceInfo 时）
  - dnsConfig → BootstrapDNS + DNSStateRetryInterceptor + FollowUpMarkNetworkInterceptor
  - httpsConfig → HttpsUtil.getSSLSocketFactory + XHHostnameVerifier
  - protocols = [HTTP_1_1]
  - eventListenerFactory = HttpEventListener.FACTORY
```

**defaultUploadDownloadClient**（上传下载）：
```
readTimeout 300s / writeTimeout 300s
仅 logHeaderInterceptor（HEADERS 级别）
eventListenerFactory = HttpEventListener.DOWNLOAD_UPLOAD_FACTORY
```

`setLogEnable(boolean)` 控制日志级别（BODY/HEADERS/NONE）。

### 2.2 关键拦截器

#### RedirectInterceptor
- 捕获重定向（`priorResponse().isRedirect()`），把重定向信息写入 `RedirectErrorMessage` tag
- 非 IOException 异常包装为 `DelegateIOException`

#### RequestHeadHandlerInterceptor
- 域名白名单：`DOMAIN_WHITE_LIST = [yunzuoye.net, ztytech.com, 100fen.com, 47.111.87.154, 47.110.67.143, 47.110.64.133, 47.111.186.140, xht.com, 192.168.10.47, xh.com, 192.168.5.66]` + 动态白名单
- 命中白名单 → `ExternalLinkTag(false)`；否则若请求带 `ServerTypeTag` 且命中微服务地址 → 非外链
- 外链请求会**移除 Authorization 头**（防止 token 泄露到第三方）

#### CollectIPInterceptor
- 从 `chain.connection().socket()` 收集连接 IP、本地/远端 Socket 地址，写入 `CollectConnectSocketMessage` tag
- 记录 `X-B3-TraceId` 请求头

#### GzipRequestInterceptor
- 请求体 gzip 压缩（`Content-Encoding: gzip` + `Transfer-Encoding: chunked`）

#### OkHttpExceptionCollectInterceptor / ProxyExceptionInterceptors
- 网络异常收集与代理异常处理（写入 `ProxyErrorMessage` 等 tag）

### 2.3 微服务寻址（XHMicroServer / V2 / V3）

学海采用"微服务 IP 下发"机制：客户端先请求一个固定地址获取各服务类型的 IP 列表，再直连这些 IP。

**固定入口**：
- V1: `http://ms.yunzuoye.net/XhServerMg/GetXsList`（GET）
- V2: `http://ms.yunzuoye.net/api/v2/pub/microServer/list/`（POST）
- V3: `http://ms.yunzuoye.net/api/v3/pub/microServer/list/`（POST）

**流程**：
1. `BaseMicroServer.getInstance()` 按 `getMicroServerVersion()` 选择 V1/V2/V3 实现
2. 构造请求体（schoolId + serverTypes + 各类型版本号）
3. 请求微服务列表，解析出 `ServerUrlUnify`（含多个 `MicroServerEntityUnify` 地址）
4. 地址按 `serverType`（V3 为 `serverType_classId`）存入 `URL_MAP` 并持久化到本地配置
5. 业务请求通过 `XHRequestOkHttpProxy.setServerType(type)` 指定服务类型，`requestInner()` 中调用 `XHMicroServer.getInstance().getActualIp(serverType, classId)` 获取真实 IP 拼到 URL 前

**容错**：请求失败时 `isNeedPolling(code)`（107000006/107001012/107001016/107004001）会轮询下一个微服务地址；`nextMicro()` 轮换当前地址。

**地址结构** `MicroServerEntityUnify`：`addressType`(IP/DOMAIN)、`protocol`(HTTP/HTTPS/...)、`domainOrIp`、`port`、`dirLocation`、`schList`、`mode`(0=启用/其他=关闭)、`serverId`、`serverType`。

### 2.4 DNS 子系统（com.p017xh.xhcore.common.http.dns）

**BootstrapDNS**（OkHttp Dns 入口）：
- 若设置了 `forceIp`，直接返回该 IP
- 否则按 `enableExtendDNS()` 选择 `XhOkHttpDNS`（扩展 DNS）或 `OptimizeLocalDNS`（本地 DNS）

**XhOkHttpDNS.lookup**：
1. `DNSLookupTypeManager.getCurrentType(hostname)` 获取当前解析类型
2. 类型 > 1（已用 HTTPDNS）→ 直接本地解析
3. 否则 `DNSManager.getDNSResult(hostname, type+1)` 走拦截器链

**DNSManager 拦截器链**（`RealDNSInterceptorChain`）：
```
CacheDNSInterceptor → LocalDNSInterceptor → HttpDNSInterceptor
```

- **CacheDNSInterceptor**：查内存缓存，`queryTime + ttl * 10^9 > now` 则命中
- **LocalDNSInterceptor**：`DNSLookUpUtil.loadLocalDNS` 本地解析；失败则标记 `setLocalDNSFail(true)` 并埋点
- **HttpDNSInterceptor**：请求阿里云 HTTPDNS `http://203.107.1.1/103172/d?host={host}`（POST，3s 超时），解析 `HttpDNSResult`（host/ips/ttl/queryTime/lookupType），与本地结果对比不一致时埋点

**DNSStateRetryInterceptor**（应用拦截器）：
- 每次请求前 `DNSLookupTypeManager.clear()`
- 捕获 `ConnectException` / `SocketTimeoutException` 时，若 `needRetryForDNS` 则用新 chain 重试（超时重试 3s）
- 重试成功后埋点 `buryDNSEvent(host, 6)`

**FollowUpMarkNetworkInterceptor**（网络拦截器）：
- 检测 OkHttp 内部重定向/重试（301/302/303/307/308/401/407/408/503），命中则 `setFollowUpConditionMatch(true)` 并写入 `NetworkRedirectErrorMessage` tag

**DNSLookupTypeManager**：ThreadLocal 状态机，记录每个 host 的当前解析类型（-1 未设置 / 0 缓存 / 1 本地 / 2 HTTPDNS），`needRetryForDNS` 判断是否可前进到下一级。

### 2.5 HTTPS 加固（com.p017xh.xhcore.common.http.strategy.okhttp.https）

**HttpsUtil.getSSLSocketFactory**：
- 服务端证书：默认用平台 TrustManager（`Util.platformTrustManager()`），不校验自定义证书
- 客户端证书：`client.pem` / `client.key`（BKS 格式，密码 `654321`），从 assets 写入 `/sdcard/xuehai/` 后加载
- 协议 TLS

**XHHostnameVerifier**：
- IP 地址 → `verifyIpAddress` 直接返回 **true**（不校验！）
- 域名 → 校验 SAN（DNS 类型）或 CN，支持通配符 `*.` 匹配

**XHTrustManager**：标准 X509 校验（要求 RSA 算法），未实际使用（HttpsUtil 用平台 TrustManager）。

### 2.6 请求头默认值（XHRequestUtil）

```java
Content-Type: application/json; charset=UTF-8
SchoolId: {schoolId 或 "null"}
User-Agent: {pkg}/{ver} ({MODEL}; android; {RELEASE}; {deviceNum})
Authorization: Bearer {XHSessionId}   // 登录后
UserId: {XHUserId}
X-B3-TraceId: {traceId}   // userId(hex) + currentTimeMillis(hex)
X-B3-SpanId: {randomLong hex}
XHCore-Version: {BuildConfig.VERSION_NAME}
```

### 2.7 网络配置（ServerNetworkConfig）

通过 `ServerNetworkConfigHelper.getServerConfig()` 从 CPVD 远程配置读取（key=`network`），可动态调整：
- `connectionKeepAliveMillis`
- `socketConnectTimeoutMillis` / `socketWriteTimeoutMillis` / `socketReadTimeoutMillis`
- 上传下载独立超时（`...UploadDownload`）

### 2.8 代理支持（HttpConfigKt）

- `setHttpProxy(proxy)` / `clearHttpProxy()` / `getHttpProxy()`：存于 XmConfig 属性文件
- `OkHttpExtensionKt.setProxyIfNotEmpty`：设置 HTTP 代理（端口固定 8888）

## 三、网络状态监控（com.xuehai.launcher.network）

### 3.1 MyNetworkCallback

`ConnectivityManager.NetworkCallback` 实现，监听网络变化：

| 回调 | 动作 |
|------|------|
| `onAvailable` | `NetworkBusiness.refreshWifi` + 写网络信息文件 |
| `onUnavailable` | 写网络信息文件 |
| `onLinkPropertiesChanged` | 写网络信息文件 |
| `onLosing` | `tipAndClearHttpProxy`（检测代理） |
| `onLost` | `refreshWifi(NetworkType.Null)` + 写网络信息文件 |
| `onCapabilitiesChanged` | 写网络信息文件 |

### 3.2 NetworkBusiness

- `refreshWifi(networkType)`：更新网络类型；网络可用时：检测代理、检查盒子、已登录则重置轮询错误、初始化推送、启动管控模式、发 `WifiConnectedEvent`
- `tipAndClearHttpProxy()`：仅学生端（`isStudentClient`）且无权限时，对特定机型（SM-P615C/SM-P620）检测 `http.proxyHost`/`http.proxyPort` 系统属性，发现代理则 `PolicyManager.getWifiPolicyProxy().resetNetworkSetting()` 重置并弹窗

### 3.3 NetworkFile

- 网络信息写入 `LogFile.NETWROK_INFO_PATH`（`{LOG_DIR}/networkinfo`）
- 文件名 `yyyyMMddT1.txt` / `yyyyMMddT2.txt`，超过 5MB 轮转
- 内容 JSON：ssid、bssid、rssi、ip、dns、gateWay、networkType、wlanMacAddress、linkSpeed、frequency、networkCapabilities、linkProperties
- 保留最近 3 天，过期删除

### 3.4 WifiCompat / WifiReceiver

- `WifiCompat.listenerByConn()`：注册 `MyNetworkCallback`（需 CHANGE_NETWORK_STATE 权限）
- `WifiReceiver`：监听 `android.net.conn.CONNECTIVITY_CHANGE` 广播，回调 `refreshWifi`

### 3.5 NetworkType（com.xuehai.launcher.common.network）

网络类型抽象，三种子类：

| 类型 | typeName | 说明 |
|------|----------|------|
| `Mobile` | `4g` | 移动网络（NetworkInfo type 0） |
| `Wifi` | `wifi` | WiFi（type 1/2/3/4/5/9） |
| `Null` | 空 | 无网络 |

- `isAvailable` / `isConnected` / `authState`（认证状态，用于网络认证页）
- `isDisable()` = 不可用；`isSameNetworkType()` 比较类型+可用+连接状态
- `Companion.obtain(NetworkInfo)` 从系统 NetworkInfo 转换

### 3.6 NetworkAuthActivity / NetworkAuthViewModel

- 网络认证页：加载 `NetworkUtil.authUrl`，每 1s 检查连接，60s 超时自动关闭
- 右上角按钮调用 `SpecialApp.startConnectWifi` 打开 WiFi 设置

## 四、关键服务器地址汇总

> 注：`app/src/main/config.properties` 中定义了文件服务器前缀
> `fsHostPrefix = http://filesoss.yunzuoye.net/XHFileServer/file/`
> （注释掉的备选：`http://192.168.0.170:8080/XHFileServer/file/`）

| 用途 | 地址 |
|------|------|
| 微服务列表 V1 | `http://ms.yunzuoye.net/XhServerMg/GetXsList` |
| 微服务列表 V2 | `http://ms.yunzuoye.net/api/v2/pub/microServer/list/` |
| 微服务列表 V3 | `http://ms.yunzuoye.net/api/v3/pub/microServer/list/` |
| 文件服务器 | `https://filesoss.yunzuoye.net` |
| 文件上传 | `https://filesoss.yunzuoye.net/XHFileServer/file/upload/{appId}` |
| 文件批量上传 | `https://filesoss.yunzuoye.net/XHFileServer/file/zip/upload/{appId}` |
| 文件批量下载 | `https://filesoss.yunzuoye.net/XHFileServer/file/batch/download/{appId}` |
| 文件日志上传 | `http://filesoss.yunzuoye.net/XHFileServer/file/upload/{appCode}` |
| 阿里云 STS | `{ALI_AK_SK_HOST}/XHFileServer/sts/certificate` |
| 临时 URL 换取 | `{ALI_AK_SK_HOST}/XHFileServer/file/getTempUrl` |
| 文件 ACL 设置 | `https://filesoss.yunzuoye.net/XHFileServer/file/setAcl` |
| 用户上报 | `https://admin.yunzuoye.net/api/track/saveTrack` |
| 阿里云 HTTPDNS | `http://203.107.1.1/103172/d?host={host}` |
| 预发布文件服务器 | `http://192.168.10.93:8080` |

## 五、安全观察

1. **HTTP 明文**：微服务列表、文件日志上传、HTTPDNS 均使用明文 HTTP，可被中间人篡改
2. **HostnameVerifier 对 IP 直接放行**：`verifyIpAddress` 恒返回 true，配合 HTTPDNS 直连 IP 时无证书域名校验
3. **代理检测**：仅对特定机型（SM-P615C/SM-P620）检测系统代理，其他机型不检测
4. **外链 Authorization 剥离**：`RequestHeadHandlerInterceptor` 对非白名单域名移除 Authorization，防止 token 泄露
5. **HTTP/1.1 强制**：`protocols = [HTTP_1_1]`，禁用 HTTP/2