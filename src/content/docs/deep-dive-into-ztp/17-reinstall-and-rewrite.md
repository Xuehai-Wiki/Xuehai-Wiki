---
title: "一键还原、卸载重装场景与自写 ztp 可行性"

description: "zty 的 DeviceResetActivity 一键还原（unLock 全清单）与删除流程；卸掉 zty+ztp 只装回 ztp 的行为推演；数据去留总表；自写 ztp 的两种情形与兼容面速查"

categories:
  - 安全分析
excerpt: 一键还原 = PolicyManager.unLock() 逐条撤销 lock() 的全部系统策略（删除自身前的硬性前置）；卸掉两个 app 只装 ztp 会被 checkMDM 拦在登录；自写 ztp 配合原 zty 只需包名+启动 action+provider 兼容。
---

# 一键还原、卸载重装场景与自写 ztp 可行性

## 1. zty 的 DeviceResetActivity："一键还原"是什么

入口：zty `DeviceResetActivity`（taskAffinity `com.xuehai.mdm.reset`、excludeFromRecents；深链 `mdm://com.xuehai.mdm:8080` 体系）。`DeviceResetViewModel.load()` 注册两个按钮：

| 按钮 | 行为 |
|------|------|
| **一键还原** | `showProgress("正在还原请稍后...")` → 后台执行 `PolicyManager.unLock()` |
| **删除launcher（注： 请先一键还原， 再删除）** | 见 §2 |

**一键还原 = `PolicyManager.unLock()`**（`zty/.../system/mdm/proxy/PolicyManager.java:148-205`），是 `lock()` 的逐条逆操作（源码每步有 MdmLog）：

1. 开启刷机 `allowFirmwareRecovery(true)`、开启双清 `allowFactoryReset(true)`；
2. 允许 SD 卡、MTP、OTG、USB 调试、USB host；
3. 启用设置 `setSettingEnabled()`、显示设置隐藏项、恢复全部设置条目、显示开发者模式、显示状态栏按钮/下拉菜单；
4. **`removeDefaultLauncher`（把自己从默认桌面摘下来）**；
5. `iptables -F` + `cleanAppRules()` + 关防火墙；
6. 开安全模式、开 OTA 升级、**清除锁屏密码**、开截屏、启用剪贴板；
7. 清应用卸载规则 / 权限保护名单 / 桌面豁免名单 / 信任列表；
8. 恢复锁屏界面项、每日看板、相机快捷键、Bixby、输入法切换、任务栏；
9. 重置本地激活状态、允许设置搜索、开多窗口、允许系统账号登录、`initComponents(true)`；
10. **遍历全机所有被 disabled 的应用，逐个 `setEnableApplication` 启用回来**。

## 2. 为什么必须先一键还原再删除

"删除launcher"按钮有硬守卫（`DeviceResetViewModel` L119-125）：

```kotlin
if (PolicyManager.INSTANCE.isLocked()) { toast("请先一键还原, 再删除"); return }
```

通过后的流程：解锁 zty 卸载保护 → `uninstallApplication(ztp)` → 注册 AdminListener → `removeDeviceAdmin` → 管理员移除回调里 `deleteSelf()`：`ZCommand.isRoot()` 则 `AppUtil.unInstallApkSilent(自己)`（root 静默），否则 `AppUtil.unInstall`（普通 ACTION_DELETE）。

**必须先还原的原因**：MDM 下发的策略写在系统/Knox 层，**卸载 app 本身不一定回滚**（Knox 策略不随 app 卸载自动清理）；`AdminReceiver.onDisabled` 只兜底恢复一部分。不先还原就自删，平板会变砖（无桌面、设置打不开、USB 全禁）。一键还原主动、完整地撤销了 `lock()` 的每一条（尤其桌面占用、卸载保护、被禁应用复活）。

## 3. 场景推演：卸掉 zty+ztp、保留 `/sdcard/xuehai`、只装回官方 ztp

前置事实：zty 被正常卸载时 `AdminReceiver.onDisabled` 已自动解开全部系统限制，设备回到普通 Android 状态。

| 环节 | 结果 |
|------|------|
| 启动 | ztp 无自启广播（见 `15-zty-mdm-startup.md` §4）；persistent 对 data 分区手动安装不可靠 → **点图标才开** |
| Welcome 路由 | `router()` 检查 `isInstalled(mdmPackageName)`（= zty）失败 → 进登录页（能显示） |
| **点登录** | **死在 `checkMDM()`**（`LoginViewModel.java:519`）：`checkEnvironment()` = 只查 zty 是否安装 → false → 弹"**智通云运行异常，请联系学海老师**"，登录终止；即使装同名空壳骗过，还要 `isMdmServiceAlive()`（AIDL 活），3 次重连失败弹"请重启应用或前往安全页" |
| 设备身份 | `getDeviceId()`（`XhApplication.java:184`）拿不到 MDM 序列号 → 回退 IMEI → ANDROID_ID → WiFi MAC（`XHDeviceUtil.getUUID`）→ 与服务器登记的 deviceId 不一致，**服务器视为陌生设备**（"非学海设备！请将设备号提供给运营"） |
| 装应用 | `AppInstallManager.installApp()` 只走 `ApplicationPolicyProxy.installApplication(path)`（zty AIDL），无本地兜底 → 下载照常、**安装全失败** |
| 管控/动态码 | 策略能拉能存但无法执行；离线动态码（zty 校验）不可用，仅剩在线 `PATCH brushCode` |

### 误传修正

- "ztp 启动后未登录会杀掉除自己以外的应用"——准确机制是 **MDM 系统级禁用**（`ControlAppManager.onUserLogout → disableApps()`：除 MDM 白名单 + 平台应用 + 输入法外全部 `setDisableApplication`；zty 的 `lock(false)` 也含"禁用所有非白名单应用直到 ztp 登录"），外加管控窗口里 `ControlDialog` 强制关闭前台应用。**不是进程级 kill。**
- "ztp 的桌面应用列表是实际安装列表"——**列表本体是云端下发**（GreenDAO 本地库，`type≠1 && show=true`），渲染时合并真实安装信息（`ApplicationManager.getAppShortcut` 的版本号），所以自装 APK 更新后显示新版本。

## 4. 数据去留总表（保留 `/sdcard/xuehai` 的前提）

### 丢失（`/data/data/com.xh.zhitongyunstu/`，卸载即删）

| 数据 | 内容 | 后果 |
|------|------|------|
| `files/launcher.ini` | **完整 Account JSON（含 accessToken）、最近账号、最近明文密码**（`AccountLocalDataSource` → `Configuration.getLauncherInPath()`） | 自动登录失效，必须重输密码 |
| `zaze_provider.db` | CPVD 跨进程库（用户/消息/远端配置/补丁信息） | 登录态失效、补丁信息清零 |
| SharedPreferences | 权限位 `permission_23`、设备注册标志、推送 clientId、补丁版本、崩溃计数 | 登录后全部重新下发 |
| Tinker 补丁目录 / `sec/sec.ini` | 补丁文件 / 登录密钥 | 重新拉取 / 重新下发 |

### 保留（`/sdcard/xuehai/`）

| 数据 | 意义 |
|------|------|
| `keep/device/*.ls` | **设备终身 SecretKey**（TOTP 种子），服务器绑定关系不变 |
| GreenDAO/Room 数据库（路径含 schoolId/userId） | 应用列表、使用统计历史；重登**同一账号**即复用 |
| `download/app/`、`bak/xh_launcher.apk` | APK 缓存可复用 |
| 全部日志、`keep/zty_crash`、`zty_login`、`config/device_status.ini`、`open/openInfo.ini` | 继续沿用 |

**结论**：可自动重建的一次性缓存（权限位/远端配置/推送 clientId/补丁）登录即恢复；**真正回不来的是设备身份**（序列号读不到）——但见 `16-permissions-device-identity.md` §9，deviceId 已知时此缺口消失。

## 5. 自写 ztp 的两种情形

### 情形 A：zty 还在（或装回官方 zty），只把 ztp 换成自写版 —— **可行且最容易**

zty 对 ztp 的运行时校验只有两条：**包名 = `com.xh.zhitongyunstu`** + 能响应 **action `com.xh.zhitongyun.launcher`**。没有签名校验（MD5 只在 zty "自己下载安装" 那一步校验）。必补兼容面见 §6。特权仍从 zty AIDL 借，zty 还会替你授运行时权限；SD 卡数据全复用。

### 情形 B：zty 也没有，纯自写 ztp 立门户

app 本身能跑（登录 UI、业务 API、SD 数据复用、本地 TOTP），需补三块：

1. **特权层自己造**：自建 `AdminReceiver` + DevicePolicyManager（锁屏/抹机/禁相机等标准能力，需用户激活）；Knox/HEM SDK 理论上可嵌（许可密钥已逆向公开），但 priv-app 权限没有预装签名授不到；root 可兜底静默装卸/iptables。
2. **绕过官方自检**：`checkMDM` / `checkEnvironment` / `isMdmServiceAlive` 都成了自己的代码，直接改写。
3. **设备身份**：deviceId 拿不回（除非 root 或已知）→ 首次登录可能被当新设备；**deviceId + SecretKey 已知时此问题消失**（见 `16-permissions-device-identity.md` §9）。

## 6. 重写兼容面速查（情形 A）

| 项 | 值/要求 |
|----|---------|
| 包名 | `com.xh.zhitongyunstu` |
| 启动 action | `com.xh.zhitongyun.launcher`（WelcomeActivity） |
| ContentProvider | authority `com.xh.zhitongyun.provider`，四张表：`/cache`（真表）、`/client`、`/control`、`/appModelPermission`（虚拟表），并处理数据码通知 |
| 签名体系 | V1 `MD5(method+url+t+key...)` / V2 nonce（`xuehai-sign.md`、`02-signing.md`；密钥在 libxhcore） |
| 客户端标识 | appId `CA106004`、appKey `dsjiqw495soisoss`、secret `5ec34bbc9eecc360c02484ba`、mdmCode `zty_stu`（`App.createAppClientArgs`） |
| 登录 | `POST /api/v2/platform/login` + 登录后处理链（密钥文件、权限位、时间同步、推送注册） |
| 管控消费 | `/api/v1/forbidden/detail` 轮询 + `control-service` 推送 + 广播/Provider 分发 |
| AIDL | 照抄 `MdmAidlInterface` stub 借 zty 特权 |
| 可选 | Tinker、推送长连接、远程协助、Open SDK（`share.json`） |

## 7. 已知一切时的剩余缺口

见 `16-permissions-device-identity.md` §9：deviceId + SecretKey 已知 → 服务器视角与官方无异（身份是填空题）；**唯一缺失是系统级特权**（对操作系统的权力，与服务器身份无关）——情形 A 里照借 zty，情形 B 需自建。
