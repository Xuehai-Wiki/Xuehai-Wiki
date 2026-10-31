---
title: "权限分层与设备身份"

description: "zty/ztp 的四层权限模型（清单权限、设备管理员、厂商 MDM SDK、IPC 暴露面）、AIDL/MdmService 机制、deviceId 读取链与服务器设备身份（deviceId + SecretKey）模型"

categories:
  - 技术解析
excerpt: zty 持有全部特权（126 项清单权限 + DeviceAdmin 九项策略 + Knox/HEM + Root + 无障碍），ztp 仅 34 项且靠 AIDL 借权；设备身份 = zty 读出的序列号/回退值 + SD 卡 SecretKey，服务器只做字符串比对。
---

# 权限分层与设备身份

## 0. 四层模型总览

| 层 | 载体 | 内容 |
|----|------|------|
| 1 | Android 清单权限 | zty 126 项 / ztp 34 项（含 signature 级，预装才生效） |
| 2 | 设备管理员（DeviceAdmin） | 仅 zty：`device_admin.xml` 九项策略 + 防拆闭环 |
| 3 | 厂商 MDM SDK / Root / 无障碍 | 仅 zty：Knox ~45 项权限、华为 HEM ~20 项、联想、`ZCommand` su 回退、`typeAllMask` 无障碍 |
| 4 | IPC 暴露面 | zty 的 MdmService（AIDL，无鉴权）、两端 exported ContentProvider |

**一句话**：zty 是特权载体（系统预装 + DeviceAdmin + Knox/HEM + Root + 无障碍），ztp 是特权消费者（AIDL 客户端）。

## 1. 第 1 层：Android 清单权限

### zty（126 项，`zty/app/src/main/AndroidManifest.xml`）关键项

| 类别 | 权限 | 说明 |
|------|------|------|
| 静默装卸应用 | `INSTALL_PACKAGES`、`DELETE_PACKAGES`（signature 级）+ `REQUEST_INSTALL/DELETE_PACKAGES` | 静默安装/卸载的能力来源 |
| 系统设置 | `WRITE_SECURE_SETTINGS`、`WRITE_SETTINGS` | 直写全局 Settings（含输入法指定） |
| 任务/进程 | `REAL_GET_TASKS`、`REMOVE_TASKS`、`GET_TASKS`、`KILL_BACKGROUND_PROCESSES`、`CHANGE_COMPONENT_ENABLED_STATE` | 取真实前台任务、清最近任务、杀进程、**启停任意应用**（禁用/启用应用的基础） |
| 监控 | `READ_LOGS`（全机 logcat）、`PACKAGE_USAGE_STATS`、`BATTERY_STATS`、`READ_NETWORK_USAGE_HISTORY` | 日志抓取、使用时长、流量统计 |
| 电话 | `READ_PHONE_STATE`、`READ_PRIVILEGED_PHONE_STATE`（signature 级） | 序列号/IMEI |
| 悬浮/锁屏 | `SYSTEM_ALERT_WINDOW`、`SYSTEM_OVERLAY_WINDOW`、`DISABLE_KEYGUARD`、`WAKE_LOCK` | 悬浮窗、锁屏控制 |
| 其他 | `ACCESS_NOTIFICATION_POLICY`、`MODIFY_AUDIO_SETTINGS`、`CAMERA`、定位两项、`QUERY_ALL_PACKAGES`、`RECEIVE_BOOT_COMPLETED` | |

### ztp（34 项）关键项

`WRITE_SETTINGS`、`READ_LOGS`、`READ_PRIVILEGED_PHONE_STATE`、`MOUNT_UNMOUNT_FILESYSTEMS`、`SET_PROCESS_LIMIT`、`SET_TIME_ZONE`（后三个 signature 级，预装才生效）、`CLEAR_APP_CACHE`、`REORDER_TASKS`、`KILL_BACKGROUND_PROCESSES`、`SYSTEM_ALERT_WINDOW`、`REQUEST_INSTALL/DELETE_PACKAGES`（仅用户确认版，**无**静默的 INSTALL/DELETE_PACKAGES）、`com.android.permission.GET_INSTALLED_APPS` + `persistent="true"`。

> **signature/privileged 权限只对预装在系统分区（priv-app）的 app 授予**——学海平板出厂预装两 app 就是为了这个。手动装到 data 分区后，这类权限全部失效。

## 2. 第 2 层：设备管理员（仅 zty）

`AdminReceiver`（`com.xh.common.lib.sdk.samsung.AdminReceiver`）声明 `device_admin.xml` 九项策略：

```xml
limit-password / watch-login / reset-password / force-lock /
wipe-data / expire-password / encrypted-storage / disable-camera / disable-keyguard-features
```

配套防拆闭环（wiki zty 报告 §6.5）：
- `onPasswordChanged/Failed/Succeeded` 全部 → `DeviceManager.resetPassword`：**任何人改锁屏密码立即被重置**（多数机型重置为空串）；
- `onDisabled`（管理员被停用）→ **自动恢复**固件恢复/恢复出厂/MTP/USB 调试/设置入口（防卸载后残留锁死）；
- Knox 层 `setAdminRemovable(false)`（管理员本身不可移除）；
- `DeviceManager.isAdminActiveInSystem` 异常时返回 true（fail-open）；
- `resetPassword` 仅当调用包名精确等于 `com.xuehai.launcher` 时生效。

## 3. 第 3 层：厂商 MDM SDK / Root / 无障碍（仅 zty）

- **三星 Knox**（约 45 项权限）：`com.samsung.android.knox.permission.KNOX_*`（FIREWALL、APP_MGMT、KIOSK_MODE、DATE_TIME、RESTRICTION_MGMT、MULTI_USER_MGMT、CUSTOM_SETTING…）+ 旧版 `com.sec.*` / `android.permission.sec.MDM_*`。许可密钥硬编码：v2 KLM `KLM09-F7TPK-...` + ELM 双 key，v3 KLM `KLM09-GAQR3-...`（`LicensePolicySamsung/V3`）。
- **华为 HEM**（约 20 项）：`com.huawei.permission.sec.MDM_*`（APP_MANAGEMENT、CLIPBOARD、CAPTURE_SCREEN、KEYGUARD、SDCARD、USB、TELEPHONY…）+ `com.huawei.systemmanager.permission.ACCESS_INTERFACE`。
- **联想**：`lenovo.permission.ota.exported`（+ Lenovo223FCAccessibilityService 执行按键）。
- **Root 回退**：`ZCommand.isRoot()` 探测 `su` → 静默 `pm install/uninstall`、`iptables -F`（`PolicyManager.lock` 显式清规则再下发）。
- **无障碍**：`MdmAccessibilityService`（`accessibility_service_config.xml`：`typeAllMask` + `canRetrieveWindowContent="true"`）——全事件日志监控流。

## 4. 第 4 层：IPC 暴露面

| 通道 | 位置 | 保护 |
|------|------|------|
| `MdmService`（AIDL，~160 方法） | zty，action `com.xuehai.system.mdm.action_aidl` | **无 onTransact/checkPermission/getCallingUid 校验**；targetSdk 28 + intent-filter → 默认 exported。同机任意 app 可 bind 调用静默装卸/抹机/改防火墙 |
| `XHContentProvider` | zty，authority `com.xuehai.provider`，独立 `:transProvider` 进程 | exported，转发 ztp 的 CPVD 数据 |
| `MyContentProvider` | ztp，authority `com.xh.zhitongyun.provider` | exported，管控/客户端/模块权限虚拟表 |

## 5. AIDL / MdmService 机制详解

**AIDL = Android Interface Definition Language，安卓的跨进程方法调用（RPC）机制**：A 进程"调用一个函数"，函数实际在 B 进程执行，参数/返回值由 Binder 驱动打包传送。AIDL 文件编译生成 `Stub`（服务端骨架）与 `Proxy`（客户端代理）。

三要素在本项目的对应：

1. **合同**：`com.xuehai.system.mdm.MdmAidlInterface`（ztp 源码内含生成的 Stub，~160 方法，如 L968 `boolean stopApp(String)`）。
2. **服务端（zty）**：manifest L312-318 声明 `MdmService`；`MdmBinder extends MdmAidlInterface.Stub`（1075 行），每个方法一行委托，如：
   ```java
   // zty/.../system/mdm/MdmBinder.java:148
   public String getSerialNumber() {
       return PolicyManager.getDevicePolicyProxy().getSerialNumber();  // 在 zty 进程里执行
   }
   ```
3. **客户端（ztp）**：`MdmServiceManager` bind（`Intent setPackage("com.xuehai.launcher").setAction("com.xuehai.system.mdm.action_aidl")`）→ `MdmAidlInterface.Stub.asInterface(binder)` 得 Proxy → 调 `proxy.getSerialNumber()` 即跨进程执行 zty 的实现。

调用链示例（读序列号）：
```
ztp XhApplication.getDeviceId()
  → PolicyManager.getDevicePolicyProxy().getSerialNumber()   // ztp 侧 LocalMdmInterface 代理
  → MdmProxy（AIDL Proxy）
  → [Binder 跨进程]
  → zty MdmBinder.getSerialNumber()                           // zty 进程
  → zty PolicyManager.getDevicePolicyProxy()
  → Knox 通道（真序列号）或 DevicePolicyDefault.getSerialNumber()（回退链）
```

`MdmHolder.registerMdm()` 绑定时附带 `lockPath` / `emptyActivityAction` / `package_name`（看门狗参数，见 `15-zty-mdm-startup.md` §3.2），断线自动重连。

**为什么 ztp 要这么绕**：`getSerialNumber`、静默装卸、锁设置等能力需要 Knox/DeviceAdmin/特权权限，ztp 没有，zty 有。**MdmAidlInterface 本质是 ztp 借用 zty 特权的遥控器**。

## 6. 设备身份链（getDeviceId）

### ztp 侧（`ztp/.../common/base/XhApplication.java:184-195`）

```java
public String getDeviceId() {
    String serialNumber = PolicyManager.getDevicePolicyProxy().getSerialNumber(); // → AIDL → zty
    if (!isEmpty(serialNumber) && !"unknown".equals(serialNumber)) return serialNumber;
    return XHDeviceUtil.getUUID(this);   // ztp 自身回退：IMEI → ANDROID_ID → WiFi MAC
}
```

### zty 侧实现（被 AIDL 调用的那个）

| 机型通道 | 实现 | 返回值 |
|----------|------|--------|
| 三星 Knox v2/v3 | `DevicePolicySamsung*`（Knox API） | **真出厂序列号**（"设置→关于平板→状态"里的 S/N，形如 `R9WT30XXXXX`） |
| 标准机（`DevicePolicyDefault.java:79-81`） | `MdmUtil.getUUID()`（L43） | IMEI → ANDROID_ID（排除 `9774d56d682e549c`）→ WiFi MAC |
| 华为 HEM / 联想 | 各自实现 | 类似序列号/回退 |

> **术语**：Knox = 三星的企业移动安全管理平台（KLM/ELM 许可 + SDK）。激活许可后 app 可调企业级 API，包括读硬件序列号。WiFi 版学生平板无 SIM/无有效 IMEI，出厂序列号是唯一稳定标识。
>
> **注意**：Android 8+ 的 ANDROID_ID 按"应用签名密钥 + 用户 + 设备"区分——**换一个签名的 app 读到的 ANDROID_ID 不同**。所以回退值只能复用"当年 zty 进程读到的那个字符串"，无法在新 app 里现读现对上。

### 为什么 deviceId 要靠 zty

不是技术上必须，而是**权力分布的结果**：Android 8 起普通 app 读不到硬件序列号（`Build.getSerial` 需特权权限，Android 10 起三方 app 直接返回 unknown），Knox API 更是只有激活许可的 MDM 能调。ztp 读不到，只能 RPC 问 zty——**zty 是"设备的代言人"**。

## 7. 服务器登记表模型（deviceId + SecretKey）

```
学海服务器·设备表
┌───────────────────────────┬──────────────┬──────────────────────────┐
│ deviceId（主键）           │ SecretKey    │ 绑定信息（license/用户/  │
│ = 当年 zty 上报的序列号    │ = 与 deviceId│ 激活状态…）              │
│   或回退值                 │   成对存两边 │                          │
└───────────────────────────┴──────────────┴──────────────────────────┘
```

- 首次初始化：zty 读序列号 → 上报登记 → 服务器下发/生成 SecretKey → 写入 `{SD}/xuehai/keep/device/*.ls`（文件名 = AES-ECB(硬编码密钥 `453DA222330F6F421E7DABF2CAB6AECC`) 加密后的 Base32 SecretKey，**卸载不消失**）。
- 此后每个请求都带该 deviceId（请求头/UA 第 4 段/参数）+ 签名；**动态码 = 用 SecretKey 算的 TOTP**，服务器按 deviceId 查表比对。
- 卸 zty 重装 ztp 时：ztp 问不到序列号 → 回退 ANDROID_ID/MAC → 字符串 ≠ 登记主键 → `checkDevice` 不过、license 查不到、在线动态码对不上。**"缺口"是字符串对不上号，不是数据丢了。**

## 8. 离线动态码由谁校验

**由 zty 校验**（`ztp/.../mdm/data/MdmModelImpl.java:157-178`）：

```java
checkBrushCode(key, code, expectLocal=true) {
    if (expectLocal && 无网络)
        return PolicyManager.getDeviceManagerPolicyProxy().verifyDynamicCode(key, code, 0);
        // → AIDL → zty MdmBinder.verifyDynamicCode（L690-719）
        // → zty 读 {SD}/xuehai/keep/device/*.ls 取 SecretKey
        // → TotpUtils.verify：HMAC-SHA1、6 位、TIME_STEP 60s；普通码窗口 900s、@..@ 码窗口 3600s
}
```

全程在 zty 进程内，服务器不参与（故名"离线"）。有网络才走在线通道 `PATCH /api/v2/pub/platform/brushCode`。

> **重写要点**：解 `.ls` 的 AES 密钥在 **ztp 里也有一份**（`ztp/.../component/utils/LauncherAesUtil.java:13`，`453DA222330F6F421E7DABF2CAB6AECC`）——密钥文件 ztp 自己就能解开，自写 ztp 完全可以本地实现 TOTP 校验，不依赖 zty。

## 9. "已知一切"的情形（deviceId + SecretKey 都在手）

服务器端只做字符串/数值比对，**没有任何手段"重新摸硬件"验证 deviceId 来源**：

| 已知项 | 用法 |
|--------|------|
| 原 deviceId | 自写 ztp 里**写死/配置**即可命中登记表：`checkDevice` 通过、license 激活状态保留、在线动态码恢复。（该值极易获取：任意请求 UA 第 4 段、logcat、抓包） |
| SecretKey（`.ls` 可解） | 本地实现 TOTP → 离线动态码不再依赖 zty |
| 账号密码 | 正常登录，token / `sec/sec.ini` 密钥重新下发 |
| 签名体系 | 按 `xuehai-sign.md` / `02-signing.md` 实现（或复用 libxhcore） |
| SD 卡保留数据 | 登录同一账号即复用（见 `17-reinstall-and-rewrite.md`） |

**剩余缺口只有一样，且与服务器身份无关**：系统级特权（静默装卸、禁用应用、锁桌面、防火墙、DeviceAdmin…）。那是 zty 对**操作系统**的权力，不是对**服务器**的身份。
