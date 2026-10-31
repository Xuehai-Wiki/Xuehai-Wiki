---
title: "智通云管控策略"

description: "智通云管控策略"
categories:
  - 应用
---

# 学海智通云 MDM 管控体系逆向分析报告

**分析对象**:`com.xuehai.launcher`(学生端)/ `com.xuehai.response_launcher_teacher`(教师端变体)
**版本**:versionName `v1.19.06.20250731S`,versionCode `1019006`;minSdk 19 / targetSdk 28
**角色**:HOME 桌面启动器 + 厂商 MDM SDK 载体 + 解锁工具 + 智通云(ZTY)平台守护进程
**分析方式**:反编译源码全量静态分析(`sources\` + `resources\`),全部结论附类/方法/行号引用

---

## 一、总体架构:四层管控栈

```
┌─────────────────────────────────────────────────────────────┐
│ L4  业务层:InitGuideActivity / MainActivity / SafeActivity   │
│     DeviceResetActivity / ZtyClientUtil / NetStore            │
├─────────────────────────────────────────────────────────────┤
│ L3  控制平面:AIDL MdmService ←→ MdmBinder(~160 方法)        │
│     教师/智通云客户端通过 AIDL 驱动全部管控能力                  │
├─────────────────────────────────────────────────────────────┤
│ L2  策略编排:PolicyManager 单例 + 9 个 XxxPolicyProxy        │
│     (Device/DateTime/Wifi/Location/Firewall/License/          │
│      Setting/Application/Restriction)                         │
├─────────────────────────────────────────────────────────────┤
│ L1  设备适配层:DeviceSupport 按机型路由                        │
│     ├ Samsung Knox v2(SM-P350/P355C/P583)                    │
│     ├ Samsung Knox v3(SM-P200/P615C/P620)+ 自定义 ROM 层      │
│     ├ Huawei HEM(BZT-W09/BTKZ-W00 等 7 机型)                 │
│     ├ Lenovo MIA/CSDK(TB-8604F/TB-X6C6F/TB223FC)             │
│     └ Root 回退(su 探测→pm 静默安装/iptables)                 │
└─────────────────────────────────────────────────────────────┘
```

- 9 个策略接口定义于 `sources\com\xuehai\system\common\`(约 182 个方法),AOSP 默认实现 + root 回退在 `system\common\policy\`,厂商适配在 `system\{samsung,lenovo,huawei_c5}\`,静态代理 `system\mdm\proxy\*PolicyProxy` 统一做 try/catch + 日志(标签 `MDM:*`),失败不可见于调用方。
- 编排中心 `sources\com\xuehai\system\mdm\proxy\PolicyManager.java`(380 行):`lock(ignoreBusiness)` L221-262、`unLock()` L195-211、`disableApps` L325-343、`checkMdmPermission` L345-353(仅 Samsung v3 需要 Knox 运行时权限 `com.samsung.android.knox.permission.KNOX_APP_MGMT`)。

---

## 二、设备路由:机型 → 厂商 SDK 分发

`sources\com\xuehai\mdm\config\DeviceSupport.java`:`isDeviceSupport(model, res)` 将 `Build.MODEL` 与 `resources\res\values\arrays.xml` 内机型数组逐项比对:

| 厂商通道 | 机型数组 |
|---|---|
| Knox v2 | SM-P350、SM-P355C、SM-P583 |
| Knox v3 | SM-P200、SM-P615C、SM-P620 |
| Huawei HEM | BZT-W09、BTKZ-W00、BZF5-W00、AY6-W00、BBG7-W00、BJS5-W00、BTKZ-AL00 |
| Lenovo CSDK | TB-8604F、TB-X6C6F、TB223FC |

v3 内部再经 `SamsungDeviceProviderV3.getDevice()` 二次分发到 p200/p615/p620 三个定制策略包。

---

## 三、Knox 许可激活(硬编码密钥)

**v2(KLM+ELM 双步骤)** — `LicensePolicySamsung.java` L36-46:
```
KLM: KLM09-F7TPK-RD12M-VULHR-IZNMH-F2OAC
ELM: 33E67254A91B7C777011B5BA51A750E4AD277E9AEF51039030266268AAEEC60C
     350B0E85443EED0525AA847AE149A3BD7491180E4EEBB5378AAF654FB5D42286
```
- v2 免费版状态用 SP 标志 `samsung_elm_key_status`+`samsung_klm_key_status`(`LicenseState.java` L13-14);付费接口 `activatePayLicense` 为空操作、`isPayLicenseActivated` 恒真。
- v3 — `LicensePolicySamsungV3.java` L24-27:KLM `KLM09-GAQR3-O9AY0-C3390-I7FTD-H16V3`;激活校验=运行时权限 `checkEnterprisePermission(KNOX_FIREWALL && KNOX_APP_MGMT)`,付费=有 `KNOX_CUSTOM_SETTING`。
- 回调接收器 `KnoxReceiver`(manifest L425-432,action `edm.intent.action.license.status`/`knox_license.status`):Toast `"激活失败(ELM)…"`/`"激活成功(ELM)."`,并经内部广播 `com.xuehai.mdm.knox.free`/`pay` 重放;`KnoxV3Receiver` action `com.xuehai.mdm.Knox.v3`,错误码映射 0/101/102/201/203/204/205/301/401/501/502/601。
- 激活链:`DeviceActiveManager.activateSDK()` L131 → `LicensePolicyProxy` → AIDL 事务 6-9 → `MdmBinder` L147-164。

**Knox 能力映射要点**(适配器层,`system\samsung\knox\*` 与 `...\knox\v3\*`):
- 应用管控:启/禁应用、清数据、静默安装卸载、组件开关、强制停止、通知白名单、`setDefaultApplication(LAUNCHER_TASK)`(锁死桌面)、`addPackagesToForceStopBlackList`(保活)、`applyRuntimePermissions(pkg, perms, 1)`(自动授权运行时权限)。
- 防火墙:`DomainFilterRule` 域名黑白名单、`AppIdentity("*")` 全局规则、`clearRules(15)`、enableFirewall —— **URL 管控走域名过滤而非浏览器代理**(Knox `BrowserPolicy.setHttpProxy` 存根在 `com\xuehai\**` 中零引用)。
- 限制策略:剪贴板/相机/截屏/SD 卡/USB 调试/MTP/恢复出厂/OTA/固件恢复/安全模式/多用户/紧急呼叫/USB host 存储/下拉菜单(`allowStatusBarExpansion`)/硬件按键(kioskMode)/DeX 禁用。
- `reboot()` = `passwordPolicy().reboot("xuehai")`。
- v3 启动/关机动画替换:写入 `filesDir/booting/{animation.qmg, animation_loopsource.qmg, wav.ogg}` → `systemManager().setBootingAnimation`。
- P615C 独有:前台应用/运行任务获取、默认桌面、响铃/旋转/护眼/省电(唯一 Knox SettingsManager 使用)/SmartView 投屏/设置顶级菜单;P620:防火墙读取 `getRules(1|2, ENABLED)`+`listIptablesRules()`、锁屏项目/看板/相机/Bixby/三星账户/任务栏全禁用;P200:S Pen 悬浮点、tcpdump、状态栏按钮、序列号回退链(Knox→`getSN()`→`MdmUtil.getUUID()`)。
- 已知缺陷:`WifiPolicySamsung.setWiFiState` 映射到 `setWifiTethering`(疑似 bug);v3 走 ROM `setWifiState`。

---

## 四、华为 HEM / 联想 CSDK / Root 回退

- **Huawei HEM**(`system\huawei_c5\`):华为企业定制 SDK,管控入口 `turnOnConnectionAlwaysOn(true)` / `initComponents(false)`;`HuaweiHemInstallMdmPackageReceiver`(manifest L417-424)监听 `com.huawei.intent.action.InstallMdmPackage` 完成自有 MDM 包安装;`BootReceiver` 对 HEM 机型要求“已激活 Knox/HEM 许可 + 已设默认桌面”才开机自启(L51-59)。
- **Lenovo**(`system\lenovo\` + `csdk\tb223fc`/`tb_x6c6f`):MIA/CSDK 策略 + AIDL 防火墙服务;`Lenovo223FCAccessibilityService`(manifest L406-416,exported)在 TB223FC 上用无障碍服务执行按键/导航类操作;联想机型完全跳过 `BootReceiver` 自启逻辑,改由 CSDK 自身拉起。
- **Root 回退**:`su` 探测成功 → `MdmDevice.Root`:静默 `pm install/uninstall`、防火墙走 DroidWall fork `IptableApi v1.5.7`;`PolicyManager.lock()` 中显式 `ZCommand.execRootCmd("iptables -F")` 清空规则再下发。标准机则多数接口 `throw UnSupportException("api未定制")`。

---

## 五、核心锁机流程 `PolicyManager.lock()`(L221-262 逐条)

`Permission.isDebugMode()`(`com\xuehai\launcher\common\config\Permission.java` L46-48,Debug 版为真)是关键闸门;学生/教师分流在 `PolicyManagerExtKt.tryInitialize`(39 行):

- `wipeRecentTasks()` → `ZtyClientUtil.isZtyUpgraded()`:
  - ZTY 已升级或未安装 → `lock(false)`(系统+业务全锁)+ `saveZtyUpgradeVersion`;
  - 否则 → `lock(true)`(仅系统锁)。
- 教师端:仅置 `isLocked=true`。
- 学生端 `lock()` 依次执行:
  1. 自身加入电池优化白名单(保活);
  2. `locationPolicyProxy.startGPS(true)`(强制开 GPS)、`setAdminRemovable(false)`(设备管理员不可移除);
  3. 若非 Debug:`allowFirmwareRecovery(false)`、`allowFactoryReset(false)`、`allowUsbDebugging(false)`、`setUsbMediaPlayerAvailability(false)`(MTP)、SD 卡挂载限制、`allowUsbHostStorage(false)`、`allowOTG(false)`;
  4. `allowMultiWindowMode(false)`、`setDevelopHiddenState(true)`、`setClipboardEnabled(false)`、`doFixedRules()`(L242,固定规则集)、`allowMultipleUsers(false)`、`allowSafeMode(false)`、`disableSetting()`(禁系统设置)、`setDropMenuHiddenState(true)`、状态栏按钮、`addIgnoreFrequentRelaunchAppList(["com.xuehai.launcher"])`、`setAutomaticTime(true)`(强制自动时间,配合服务端时间签名)、`setEmergencyCallOnly(true)`(仅紧急呼叫)、`setDexDisable(true)`;
  5. HEM:`turnOnConnectionAlwaysOn(true)`;否则 `initComponents(false)`;
  6. `!ignoreBusiness` 时:`setScreenCapture(false)`、`allowOTAUpgrade(false)`、禁用所有非白名单应用直到登录 ZTY、`ZCommand.execRootCmd("iptables -F")`、`cleanAppRules()`、`setIptablesOption(false)`。

`unLock()` 路径(L195-211)逆序恢复:重新启用被禁应用、多窗口、系统账户登录、设置入口;`doFixedRules` 在 ZTY 每次启动前由 `MainViewModel` L204-205 `tryUpgrade+doFixedRules` 重放。

**应用级禁用**:`disableApps` L325-343 遍历应用黑名单,非白名单一律 `setDisableApplication`。

---

## 六、解锁与凭证体系(核心安全链)

### 6.1 在线刷机码
- 请求:`NetStore.checkBrushCode(code)`(`com\xuehai\launcher\common\http\NetStore.java` L214-228)→ `PATCH https://ztp.yunzuoye.net/api/v2/pub/platform/brushCode`,body `{code, deviceId}`。
- 响应经 `StringEncryptUtils` 混淆:有效期 5 分钟(`DECRYPTION_VALIDITY_PERIOD=300000`)、校验位 `9-(digitSum%10)`、混淆长度 96(`OBFUSCATION_LENGTH`);`InputViewModel` 解析 `status==1` 放行。

### 6.2 离线 TOTP
- 密钥存储 `KeepCode`:密钥文件名 = `dir + '/' + AES_ECB(code) + '.' + suffix`,AES 密钥**硬编码** `453DA222330F6F421E7DABF2CAB6AECC`(`LauncherAesUtil`,AES/ECB/PKCS5Padding,SALTPRE="TEST"),目录 `/sdcard/xuehai/keep`(`FilePath.getKeepDir()` L27-29),后缀 `.ls`,按 lastModified 降序取最新。
- 校验 `MdmBinder.verifyDynamicCode`(L690-719):
  - `@code@` 格式 → `TotpUtils.verify(key, code, 3600)`(1 小时窗口);
  - 普通码 → 先 `Base32` 编码 key,再 `TotpUtils.verify(b32key, code, 900, 8)`(15 分钟窗口)。
- `TotpUtils`:HMAC-SHA1、6 位、TIME_STEP 60、verify 循环 `i3<=1`、限 1-18 位("不支持X位数的动态口令");随机文本用 `SecretUtil.createRandomText`(`java.util.Random`,非安全随机)与 `TotpUtils.createDeviceRandomText(deviceId)`。
- **密钥文件以 AES-ECB(硬编码密钥)加密的文件名形式明文存于 SD 卡**,拿到密钥常量即可离线解出 TOTP 种子(重大弱点,见 §13)。

### 6.3 原生令牌(SecretJni)
- `com\xuehai\launcher\natives\SecretJni.java` → `libsecret-lib.so`(arm64 5.2MB / 32 位 183KB):`verifyQrToken(context, token)`(扫码解锁)、`verifyDevelopToken(context, token, null)`(开发令牌,900s 窗口)。
- AIDL 同名入口 `MdmBinder.verifyDynamicToken` L136-143:tokenType 分流到上述两个 JNI。

### 6.4 恢复出厂链
- `MdmBinder.resetFactory(token)` L616-629:**token 参数本身未校验**,校验责任在调用方;实际动作 = 启动 `WipeDataActivity`(`com\xuehai\system\mdm\WipeDataActivity.java`):
  - 设备管理员已激活 → 直接 `wipeData()` L132-137:`allowFirmwareRecovery(true)` + `allowFactoryReset(true)` + `DeviceManager.wipe()`(=`wipeData(0)`);
  - 未激活 → 弹设备管理器激活页,激活成功回调里执行抹除。
- `DeviceResetActivity`(taskAffinity `com.xuehai.mdm.reset`,excludeFromRecents,manifest L302-307)+ `DeviceResetViewModel`:「一键还原」→ `PolicyManager.unLock()` L135;「删除launcher」→ 要求先还原(`isLocked` 为真则拒绝),再 `setApplicationUninstallationEnabled(ZTY)` → `uninstallApplication(ZTY)` → `removeDeviceAdmin` → root 静默自卸载 `AppUtil.unInstallApkSilent` L180-190。
- `SafeActivity`(deep link `mdm://com.xuehai.mdm:8080/safe`,manifest L290-301)承载清除数据/设备重置入口,`onKeyDown` L72-78 吞掉 BACK 键(`if (4 == keyCode) return true`);`MainActivity` 同样吞 BACK。`MdmRouter` 暴露 `mdm://com.xuehai.mdm:8080/init/guide` 与 `/safe` 两个深链。

### 6.5 密码重置防拆闭环
- `DevicePasswordManager.resetPassword`(`system\mdm\device\DevicePasswordManager.java` L25):若锁屏有密码,先降级为 NONE 再重置;新密码仅 `SM-P355C/SM-P350` API<23 用 `"123456"`,**其余机型为空串(直接清空锁屏密码)**。
- `AdminReceiver`(`com\p031xh\common\lib\sdk\samsung\AdminReceiver.java`,148 行,manifest L386-396):
  - `onDisabled` L111-129:恢复固件恢复/恢复出厂/MTP/USB 调试/设置入口(即“卸载管理器时自动解锁全部限制”——防止被学生擅自卸载后残留锁死);
  - `onPasswordChanged/Failed/Succeeded` 全部 → `DeviceManager.resetPassword(context)`:**任何人改锁屏密码立即被重置**(防拆核心);
  - `device_admin.xml`:声明 limit-password/watch-login/reset-password/force-lock/wipe-data/expire-password/encrypted-storage/disable-camera/disable-keyguard-features 九项策略。
- `DeviceManager`(`system\mdm\device\DeviceManager.java` L38):admin 增删走 `IDevicePolicy` 代理;`isAdminActiveInSystem` **异常时返回 true(fail-open)**;`resetPassword` 仅当调用包名精确等于 `com.xuehai.launcher` 时生效。

---

## 七、AIDL 控制平面(无鉴权)

- `MdmService`(manifest L312-318,action `com.xuehai.system.mdm.action_aidl`)+ `MdmBinder`(1075 行,~160 方法)。
- **结论:整个 Binder 面无任何 `onTransact`/`checkPermission`/`getCallingUid` 校验**(grep 证实),管控面(安装/卸载/抹机/重启/防火墙/密码重置)对任何能 bind 该服务的应用开放;防护完全依赖 manifest 组件可见性。
- 每个方法一行委托到对应 PolicyProxy;特殊实现:`statusDump()`(全量状态聚合给教师端)、`dumpAppUsageEventsSnapshot(begin,end)`(使用事件导出 JSON)、`writeFileToData(...)`(经 ParcelFileDescriptor 管道写 `launcher.ini`/`zaze_provider.db`)、`setPowerSavingMode/controlRingerMode`。
- 客户端 `MdmServiceManager`:按包名 bind 学生端 `com.xuehai.launcher` 或回退教师端 `com.xuehai.response_launcher_teacher`,ServiceBinder 缓存于 WeakHashMap。
- `MdmErrorCheck`(MyLog.LogListener):`sn_error`/`admin_error` 触发计数;若 admin 激活失败发生在 `start_admin_time_key` 后 1500ms 内且 `reboot_count≤3`,延迟 Toast `"重启后新功能生效，即将重启平板"` 并**自动重启**。

---

## 八、网络管控平面

### 8.1 证书验证
- **无证书锁定**:`okhttp3\CertificatePinner.java` pins 恒空,全库无 add-pin 调用。
- 信任锚 = 系统 CA:`HttpsUtil.getSSLSocketFactory(null,null)`(`com\p031xh\xhcore\common\http\strategy\okhttp\https\HttpsUtil.java` L72-103)→ `Util.platformTrustManager()`;接入点 `OkHttpExtensionKt.java` L34-41;OkHttp 单参 `sslSocketFactory()` 重载(`okhttp3\OkHttpClient.java` L503-510)。
- `XHHostnameVerifier.verifyIpAddress` L37-39:**IP 直连无条件 `return true`** —— HTTPDNS/微服务换 IP 后的 TLS 会话不校验主机名。
- 遗留 `XHTrustManager`(checkClientTrusted 空实现)未接入;BKS 客户端口令硬编码 `"654321"`,旧双向证书方案已废弃。

### 8.2 请求签名与防篡改(密钥在 native)
- V1(`RequestSignInterceptor` L36-49 + `RequestSignUtil`):`sign = MD5(method+url+t+key[+bodyHash][+Authorization])`,`?sign=&t=` 追加;密钥 `XHCoreJni.getSignatureKey()` 来自 `libxhcore.so`,Java 层无明文。
- V2(`RequestSignV2Interceptor` L46-63):URL 追加 `_xhsrc_/_nonce_/_uid_`;`getSignKey()` 返回 `[AK,SK]`,`"-1"` → `IOException("签名异常")`;无 Authorization 时回退静态密钥 JNI。
- 响应防篡改 `ResponseSignInterceptor` L19-23/96-113:头 `X-Content-Sign-Token`,盐**硬编码** `GHU^B_)+*&^%3~]`,`MD5(盐+body)` 不符 → `IOException("响应md5校验失败")`。
- `ResponseSignCheckInterceptor` L50-62:业务码 403001/403002/403003 → 强制登出。
- 密钥复用:`EncryptAndDecryptQuestionUtils` 用签名密钥加解密题目数据。

### 8.3 17 个拦截器(OkHttp 链 + DNS 链)
应用拦截器:RedirectInterceptor、RequestHeadHandlerInterceptor(域名白名单 `DOMAIN_WHITE_LIST` 硬编码 L28:`yunzuoye.net/ztytech.com/100fen.com/xht.com/xh.com` + 47.111.87.154 等 4 公网 IP + 192.168.10.47/192.168.5.66;非白名单请求剥除 `Authorization` 头,登录态不外泄)、ResponseSignInterceptor、ResponseSignCheckInterceptor、logBodyInterceptor、DNSStateRetryInterceptor、GzipRequestInterceptor、ProgressResponseInterceptor、DownloadCheck/RetryInterceptor(下载专用)。
网络拦截器:OkHttpExceptionCollect、ProxyException、CollectIP(X-B3-TraceId)、requestSign(V1/V2)、FollowUpMarkNetwork、ConnectionReuse(观测)、DateRefreshInterceptor(`yunzuoye.net` 响应 `Date` 头 → `setCurrentServerTime`,**服务端时间同步防本地改钟破坏签名 t**)。
协议:强制 HTTP/1.1(`OkHttpClientManager` L94)。

### 8.4 HTTPDNS(自研双层解析)
- `BootstrapDNS` → `XhOkHttpDNS` → `DNSManager` 拦截器链 `[CacheDNSInterceptor, LocalDNSInterceptor, HttpDNSInterceptor]`。
- `HttpDNSInterceptor` L28-29:`SERVER_IP=203.107.1.1`,`ACCOUNT_ID=103172`,查询 **明文 HTTP** `http://203.107.1.1/103172/d?host=<host>`;`DNSBuryUtil.isHostNameNeedHttpDNS()` 恒 true(全部域名走 HTTPDNS)。
- 失败重试引擎 `DNSStateRetryInterceptor`:ConnectException 同链重试、SocketTimeout 借用 `PathInterpolatorCompat.MAX_NUM_POINTS` 放宽超时,按 lookupType 步进升级。

### 8.5 微服务与 KZ 协议
- `XHRequestOkHttpProxy.requestInner()` L208-236:`serverType` 非空 → `XHMicroServer.getActualIp(serverType, classId)` **域名→IP 替换**(IP 列表来自 `/api/v{1,2,3}/pub/microServer/list/`);无 IP 回调 `XH_MICRO_SERVER_NO_IP`。
- 非 restful 请求体包装为 **`K=<bodyData>&Z=0`**(form-urlencoded),响应剥 `httpResponse` 外壳,`r==200` 取 `d`。
- 失败可经 `XHMicroServer.requestAgain` 换 IP 重试;`107000400` 走 restful 业务失败。

### 8.6 文件服务与 OSS(STS 凭证体系)
- STS 获取:`AkSkUtil.request()` L279-297 → `GET {ALI_AK_SK_HOST}/XHFileServer/sts/certificate?appName=<appId>`;响应 `AES-GCM` 解密,**AES 密钥硬编码 `xhyadfaf342sx@fs`**(`AkSkUtil.java` L39;`AesEncryptUtils` L22 格式 `[4B ivLen][12B IV][密文+tag]`)。
- 凭证**明文落盘** `cacheDir/<userId>.aksk`(L152-159/337-340);华为 OBS 域 `<userId>.obsaksk_<domain>`。
- `OssConfig.java` L24/L26:**两段 RSA 私钥硬编码**(akPrivateKey RSA-512 / skPrivateKey RSA-1024,PKCS#8 base64url);发布桶 `xhfs0..xhfs9`(staging `xhfs0-staging`),`x-oss-forbid-overwrite=true`。
- 文件 ACL(security 包):`setAcl` 接口 POST url/type/conditions/condSign;**上传签名 `MD5(reverse(securityType+";"+conditions))`,下载签名 `MD5(reverse(conditions))`**;私有 URL 后缀 `?!`;conditions = schoolId/classId/userId/isTeacher;私有下载先 `getTempUrl` 换临时地址。
- 下载链:`DownloadCheckInterceptor`(MD5 秒传;**md5 缺省则跳过校验**)→ `DownloadRetryInterceptor` 失败换 **明文 HTTP 开放代理** `http://filesoss.yunzuoye.net/XHFileServer/file/stream?url=<原URL>` → `OkHttpDownload` 执行。
- 原生网络栈(仅 32 位):`libcrypto/libssl/libxh_curl/libxh_common/libxh_network_client`(arm64 缺失,64 位机实际走 OkHttp);`HttpRequest.checkProxy()` L793-800 扫描 `/mnt/sdcard/xhproxy` 目录,首个文件名解码后调 `JNISetProxy(host:port)` —— **外部文件名驱动的代理后门**,与 launcher 层 `HttpProxyInterceptor`(检测系统代理则拒绝 `"请关闭网络代理(host:port)"`)形成两套矛盾管控。
- launcher 请求头 `LRequestHeader` L30-41:UA=`包名/版本 (机型; android; 系统版本; deviceId)`,deviceId 随 UA 上报。

---

## 九、监控、保活与防篡改

### 9.1 破解/环境检测
`DeviceChecker.detectSafely(force)`(`com\xuehai\launcher\common\crack\DeviceChecker.java`,115 行,L58-66 流水线):
- `XposedChecker`:classloader 特征 / `/proc/self/maps` / 堆栈特征三路检测;
- `QemuChecker`:模拟器特征(构建指纹/驱动/传感器);
- `RootChecker`:`su` 二进制探测;
- 命中 → 收集系统属性 → `MyLog.saveAppErrorLog(...)` 落 `/sdcard/xuehai/log/mdm/error/`;SP 键 `lately_hit_key` 24 小时限频。

### 9.2 崩溃分级与安全模式
- `CrashLevelManager`(87 行):同版本崩溃计数,`SERIOUS_CRASH_FLAG=3`;`simulateFatalCrash()` 直接置 flag=3 并 Toast `"模拟崩溃，进入安全模式: time ..."`(L44-48)。≥3 次崩溃 → 启动进入 `SafeActivity`(仅清除数据/设备重置可用,吞 BACK)。

### 9.3 引导期"安全检查护卫"(SettingSafeGuard,InitGuideViewModel L1040-1343)
- 10s 窗口、10ms 轮询顶部应用:
  - `isUnSafeActivity` = **`com.android.settings.DeviceAdminAdd`**(用户试图进入设备管理器页禁用管理员)→ 3 次即 `simulateFatalCrash()` 强制安全模式;
  - `disableSettingsDeferred()`(L1130 附近):`clearActivityTop()`(CLEAR_TOP 重启引导页)+ `disableSetting()` + `wipeRecentTasks()` + `stopApp(com.android.settings)` + `stopApp(com.samsung.android.permissioncontroller)` + `stopApp(com.samsung.android.forest)`;
  - 超时/退出检测,Toast 文案 `zty_initial_safe_check_*`。
- 用途:引导授予 `PACKAGE_USAGE_STATS`(应用使用统计)与 `WRITE_SETTINGS` 权限时,防止用户逃逸到系统设置其他页面。

### 9.4 无障碍服务
- `MdmAccessibilityService`(manifest L375-385,`accessibility_service_config.xml`:`typeAllMask` + `canRetrieveWindowContent="true"` + notificationTimeout 100):**全事件日志器**,仅 `MdmLog` 记录包名+事件类型(L37-44),构成全局操作监控流。
- `Lenovo223FCAccessibilityService`(exported):联想机型上执行实际按键/导航动作。

### 9.5 保活全家桶
- `BootReceiver`(manifest L319-331):LOCKED_BOOT_COMPLETED / USER_UNLOCKED / BOOT_COMPLETED / ACTION_SHUTDOWN 四广播;仅学生端自启,HEM 机型需"已激活+已设默认桌面"(L51-59),联想跳过。
- `MdmService` `START_STICKY` + `KeepLiveService`(前台看门狗)+ ActivityLifecycleMonitor + `MonitoringReceiverSamsungV3`(`APPLICATION_FOCUS_CHANGE`,manifest L440-446)+ `AppUsageHelper`(UsageEvents 每活动前台时长统计,过滤唤醒活动 `com.xh.arespunc/.WakeUpResponseActivity`,快照落 `sys_usage_events_snapshot.json.1`)。
- `ZtyFlagManager`:ZTY 拉起失败计数;`ztyWakeupFlag≤30` 才继续尝试(超过 30 次放弃),标志经 `XHContentProvider.clearFlag` 跨进程清除。
- `BusinessReceiver`:action `com.xuehai.launcher.mark_zty_error` / `mark_zty_normally` —— ZTY 客户端健康心跳,异常→`markZtyError(true)`。
- 自动重启:`MdmErrorCheck`(§7)≤3 次循环。

### 9.6 接收器编队(`com\xuehai\launcher\receiver\`)
| 接收器 | 触发 | 行为 |
|---|---|---|
| BootReceiver | 开机四广播 | 自启(L47-68) |
| PackageReceiver | PACKAGE_ADDED/REPLACED/REMOVED | 日志落 `packageChangeFile`,驱动 `AppInstallManager`/ZTY 更新态(L60-88) |
| UsbReceiver | USB_DEVICE_ATTACHED/DETACHED | 外接设备日志 + `saveAppErrorLog("usb device attached: ...")`(L96-102) |
| InputMethodReceiver | INPUT_METHOD_CHANGED | 记录当前输入法(锁定目标 `com.xh.ime`,SpecialApp L18) |
| ScreenReceiver | SCREEN_OFF / USER_PRESENT | 亮屏时启动 ZTY 拉起监督、灭屏停 mark-error 任务 |
| BusinessReceiver | ZTY 心跳 | 错误标记(§9.5) |
| WifiReceiver/WifiCompat | WiFi 状态 | 配合 `wifi\WifiViewModel`、`WifiClientUtil` |
| MyMonitoringReceiver | 前台焦点 | 保活配套 |
| HuaweiHemInstallMdmPackageReceiver / KnoxReceiver / KnoxV3Receiver | 许可回调 | §三 |

---

## 十、跨应用协同与启动器状态机

- **ContentProvider 转发器**:`XHContentProvider`(manifest L363-367,exported,authorities `com.xuehai.provider`,独立进程 `:transProvider`)→ 转发 `com.xh.zhitongyun.provider`(CPVD* DTO);ZTY 客户端经此读写共享状态(含 `clearFlag`)。
- **外部存储状态文件**:`/sdcard/xuehai/keep/zty_login|zty_crash`(MMKV,登录/崩溃标志)、`keep.ini`(KeepConfig:`purpose`、`serviceVersionCode`;"6"=合作版 ZS、"9"=Qw、`national_version` 国产化版本)、`launcher_dynamic.ini`(DynamicConfig:`download_config_url`、`need_use_inner_apk` 内置 APK 开关)、`/sdcard/xuehai/log/mdm/**`(MyLog)。
- **启动器状态机**:
  - 崩溃(flag≥3)→ SafeActivity(deep link 托管 OtherFragment,吞 BACK);
  - 正常启动 → 激活检查(`DeviceActiveManager.isDeviceActivated = isAdminActive && isSDKActivated`,教师端与联想跳过)→ 已激活 → `tryUpgrade`+`doFixedRules` → 启动 ZTY 客户端(assets 内置 `apk/com.xh.zhitongyunstu.apk` 自动安装,MD5 校验,`clearData` 自擦除);
  - 未激活 → `InitGuideActivity`(引导:设备管理器激活 → Knox 许可激活 → 使用统计/写设置权限 → 安装 ZTY)。
- **权限位图**:`Permission`(`common\config\Permission.java`,VERSION=20)`checkPermission = (own & permission) > 0` 的位标志体系,供服务端下发"功能权限";`isDebugMode()` 直通 `BaseApplication.isDebug()`。

---

## 十一、后端资产清单

| 类别 | 值 | 出处 |
|---|---|---|
| 生产网关 | `https://ztp.yunzuoye.net` | NetStore/HttpConst |
| 测试网关 | `http://ztp.xht.com` | 同上 |
| 刷机码 | `PATCH /api/v2/pub/platform/brushCode` | NetStore L214-228 |
| 设备校验 | `/api/v2/.../checkDevice`、`GET /api/v2/platform/apk` | NetStore L201-212 |
| 微服务列表 | `/api/v{1,2,3}/pub/microServer/list/` | XHMicroServer |
| 文件代理 | `http://filesoss.yunzuoye.net/XHFileServer/file/stream?url=` | DownloadRetryInterceptor L22 |
| STS | `GET /XHFileServer/sts/certificate?appName=<appId>` | AkSkUtil L279 |
| ACL | `POST /XHFileServer/file/setAcl`、`/file/getTempUrl` | SecuritySetApi L18 |
| OSS 桶 | `xhfs0..xhfs9`(staging `xhfs0-staging`) | OssConfig L66-70 |
| HTTPDNS | `http://203.107.1.1/103172/d?host=` | HttpDNSInterceptor L53 |
| 客户端标识 | `APP_CODE="CA106002"`,appId `mdm_stu`/`mdm_tea`(`is2C()` 恒假,`"toB"=="toC"` 死代码) | ClientConfig L26 |
| 关联应用 | `com.xh.ime`(定制输入法)、`com.xh.assist`(网络助手)、`com.xh.arespunc`(唤醒)、`com.xh.zhitongyunstu`/`...tea`(业务端)、`xuehai_keep_app`(QA 后门嫌疑)、`com.zaze.*`(辅助框架) | SpecialApp/ZtyClientUtil |
| 硬编码密钥 | Knox v2 KLM/ELM、v3 KLM(§三);AES `453DA222330F6F421E7DABF2CAB6AECC`;AES `"xhyadfaf342sx@fs"`;BKS `"654321"`;响应盐 `GHU^B_)+*&^%3~]`;RSA-512/RSA-1024 私钥 | 各节 |
| 域名白名单 | yunzuoye.net / ztytech.com / 100fen.com / xht.com / xh.com + 47.x×4 + 192.168.10.47/192.168.5.66 | RequestHeadHandlerInterceptor L28 |

---

## 十二、管控闭环总结(单图)

```
开机 BootReceiver ─→ launcher 自启 ─→ 激活检查 ─→ InitGuide(管理员+Knox+权限+ZTY)
        │                                                    │
        ▼                                                    ▼
 lock(false/true) ◄──── MainViewModel/MdmBinder/AIDL ──── ZTY 客户端(教师端)
 禁用设置/USB/恢复出厂/OTA/多用户/安全模式          心跳 BusinessReceiver
 强制 GPS+自动时间+仅紧急呼叫                       30 次拉起上限
 iptables -F 后下发防火墙域名黑白名单               |
        |                                            |
        ▼                                            ▼
 AdminReceiver 防拆:密码变更→resetPassword 立即重置  ZtyFlagManager(≤30)
 onDisabled→自动解除全部限制(防残留锁死)           崩溃≥3→SafeActivity(吞BACK)
        |                                            |
        ▼                                            ▼
 DeviceChecker(Xposed/Root/模拟器)→saveAppErrorLog  MdmErrorCheck 自动重启(≤3)
        |
        ▼
 解锁:在线 brushCode(5min 混淆响应)/ 离线 TOTP(SD 卡 AES 文件名种子)
      / SecretJni 扫码 / WipeDataActivity 恢复出厂
```

---

## 十三、风险与弱点汇总(按严重度)

1. **AIDL 无鉴权**:~160 个管控方法对任意 bind 应用开放(无 onTransact/checkPermission;§7)。同设备任意第三方 app 可静默安装/卸载/抹机/改防火墙。
2. **离线 TOTP 种子可离线解出**:种子文件名 AES-ECB 加密,密钥 `453DA222330F6F421E7DABF2CAB6AECC` 硬编码,文件在可读的 `/sdcard/xuehai/keep/*.ls`(§6.2)。
3. **无证书锁定 + IP 直连免主机名校验**:HTTPDNS/微服务换 IP 后 TLS 不校验主机名;用户 CA 即可中间人(§8.1)。
4. **HTTPDNS 明文 HTTP**,可被网络劫持污染解析结果(仍受系统 CA TLS 约束)(§8.4)。
5. **多组硬编码密钥**:Knox 许可密钥、两把 AES、BKS 口令、响应签名盐、两段 RSA 私钥;签名密钥虽在 .so 内但被题目加解密跨用途复用(§8.2)。
6. **STS 凭证明文落盘** `cacheDir/<userId>.aksk`(含 accessSecret)(§8.6)。
7. **明文 HTTP 面**:native 文件服务基址、批量 tmp 接口、下载重试开放代理 `file/stream?url=`(可被当作任意 URL 的服务端转发器)(§8.6)。
8. **`/mnt/sdcard/xhproxy` 原生代理后门**:外部存储文件名即可驱动 `JNISetProxy`(§8.6)。
9. **fail-open**:`DeviceManager.isAdminActiveInSystem` 异常返回 true;`checkMdmPermission` 仅覆盖 Samsung v3(§6.5/§一)。
10. **无障碍全事件监控**(`typeAllMask`+`canRetrieveWindowContent`)+ 输入法/USB/包安装监听构成持续隐私面(§9.4/§9.6)。
11. **强制 900s/3600s TOTP 窗口 + 服务端时间同步**使离线破解依赖种子;但 `@..@` 3600s 窗口放大暴力枚举面。
12. `HttpProxyInterceptor` 禁系统代理 vs 原生代理后门,两套代理管控互相矛盾(§8.6)。

---

*报告由全量静态分析生成;所有行号基于 JADX 反编译输出。补充材料:Knox 专题(对话内)、`analysis\com-xuehai-system-mdm-report.md`(system 子系统 204 文件全读)。*
