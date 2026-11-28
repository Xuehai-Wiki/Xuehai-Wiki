---
title: "死路清单：二十五条被证伪的路线"

description: "死路清单：二十五条被证伪的路线与场景管控"

categories:
  - 安全分析
  - 研究资料
excerpt: 研究的另一半价值在死路：应用安装七条、网络协议十条、本地原生与 UI 八条，每条都附代码级或字节级死因。另含入口点矩阵、场景管控判定与修复五步、以及「代码里有入口但门禁永假」这一最常见死法的说明。
password: xh-research-2026
protect: full
---

# 死路清单：二十五条被证伪的路线

> 分析对象：研究中逐条排除的攻击路线，以及入口点矩阵与场景管控机制。
> 证据等级：A（代码）+ B（字节）。
> 配套阅读：[[research/attack-chain]]（已打通的链路）、[[research/smp200]]（现场研究）、[[research/postmortem]]（事故复盘）。

## 一、结论速览

| 问题 | 答案 |
| --- | --- |
| 排除了多少条路 | 25 条，分三类 |
| 最常见的一类死因 | 「代码里有入口」但门禁条件永假 |
| 最意外的一条死路 | WebView JS 桥——70 个方法全是读，没有执行 |
| 唯一卡点 | 整库替换会丢会话，而任务行需要已登录才会被读 |
| 最省时间的一课 | 先证伪，再实现 |

一句话概括：**成功路径只有一条，死路有二十五条；写清死路的价值是让下一个人少走二十五次。**

## 二、入口点矩阵

### 2.1 启动链

```text
BOOT_COMPLETED
  → zty 起 MdmService + KeepLiveService
  → PermissionManager.applyRuntimePermissions(ctx, ztp)     // 代授权
  → Intent("com.xh.zhitongyun.launcher").setPackage("com.xh.zhitongyunstu")
  → ztp 启动
```

ztp 运行时会持有 `<外部存储>/xuehai/keep/launcherLock.txt` 的文件锁。锁释放（进程死）后，zty 一秒内发 `com.xh.zhitongyun.empty` 把它拉起来。

**结论：ztp 几乎杀不死。**

### 2.2 zty → ztp 的五个条件

| # | 条件 |
| --- | --- |
| 1 | `DeviceActiveManager.isDeviceActivated()` |
| 2 | `ZtyClientUtil.isZtyClientInstalled()`——**只查包名** |
| 3 | `checkAppUsagePermission` |
| 4 | 无未授权的运行时权限 |
| 5 | 包名匹配 |

第 2 条只查包名、不校验签名，这是「自写 ztp」思路的立足点。

### 2.3 导出组件

| 归属 | 组件 | 用途 |
| --- | --- | --- |
| zty | `MdmService` | MDM 能力 |
| zty | `WelcomeActivity` | 含深链 |
| zty | `DeveloperActivity` | 路由 `/app/developer` |
| zty | `SafeActivity` | 安全页 |
| zty | `EmptyActivity` | 拉起用 |
| zty | `OutLoginActivity` | 登出 |
| zty | `BootReceiver` | 开机 |
| zty | `LauncherReceiver` | 两个 action：强制检查、自动检查 |
| ztp | `AssistService` | `:assist` 进程，每 8 秒轮询 |
| ztp | `ContentProviderReceiver.onResourceUpdate` | 远程协助数据码入口 |
| ztp | `AgentActivity` | `com.xh.zhitongyun.action.agent_login` |
| 课堂 | `HandleSocketMsgService` | 长连接 |
| 课堂 | `ResourceDownLoadService` | 资源下载 |
| 课堂 | `MessageHandleForCanvasHelper` | 画布消息 |

### 2.4 长连接四条

| 通道 | 状态 |
| --- | --- |
| WS 8889 | **已完全劫持** |
| TCP 3200 | 协议逆向完毕，帧全 ACK，但**下游死**：目标服务从未注册 |
| HTTP 事件拉取 | HTTPS，不可中间人 |
| 盒子明文 | 可用：`GET /<classId>_check.xh` 返回 `xh` |

### 2.5 文件系统可写区

| 路径 | 用途 |
| --- | --- |
| 外部存储根下的固定目录 | 日志、配置、keep 目录 |
| 数据库目录 | launcher 与各应用私有库（通过路径穿越可达） |
| 代理配置目录 | 可让 ztp 走我方代理 |
| 下载缓存 | 资源落地点 |
| 加密配置目录 | 敏感配置 |

## 三、第一类死路：应用安装（7 条）

| # | 路线 | 死因 |
| --- | --- | --- |
| 1 | Tinker 热修复下发 | 校验 `mPublicKeyMd5 = MD5(应用自身签名)`，无法伪造 |
| 2 | `PackageInstaller` 会话 | 全树 0 命中，无该 API 调用 |
| 3 | 目录扫描自动安装 | 无扫描安装器 |
| 4 | `DexClassLoader` 动态加载 | 0 命中 |
| 5 | 应用市场 | 只广播通知且需用户点击 |
| 6 | 三星原厂 recovery | `E: footer is wrong` / `E: Signature verification failed` |
| 7 | adb / USB / OTG | 不可用 |

第 1 条值得单独说：Tinker 的校验基点就是「应用自身的签名」，因此任何非官方签名的补丁都过不了。这一条把整条热修复路线判死。

## 四、第二类死路：网络协议（10 条）

| # | 路线 | 死因 |
| --- | --- | --- |
| 8 | PC 直连设备 | 需要 key |
| 9 | 证书中间人 | 客户端只信系统根链，且主机名校验独立实现 |
| 10 | ARP 毒化 | 抓到 14,287 个包全是 PC 相关，设备包 0 |
| 11 | 明文微服务表投毒 | 无接收方 |
| 12 | TCP 3200 下游利用 | 目标服务从未注册，`payload:null` 探测不崩 |
| 13 | 局域网服务端 | 从不实例化，全端口 0 开放，多播地址零包 |
| 14 | 数据库虚拟查询 | 只有查询接口，无写入面 |
| 15 | 特定 type 消息 | 需 `parentDeskTopId == task.getDesktopId()`，真值仅来自 HTTPS |
| 16 | 协助端点直连 | 全继承 TLS 要求 |
| 17 | 域名劫持 | 推送用裸 IP + `matchIp` 强校验，不走 DNS |

第 10 条的现象很有教益：ARP 毒化程序跑得很好，抓到了大量包，但**没有一个是设备的**。原因是设备与 PC 在同一网桥下，流量根本不经过被毒化的路径。

## 五、第三类死路：本地原生与 UI（8 条）

| # | 路线 | 死因 |
| --- | --- | --- |
| 18 | 媒体解析 CVE | 仅 FDK-AAC 相关且需 Android 10+ 特定调用 |
| 19 | `CVE-2021-39623` | 只被系统命令行工具使用，应用侧不可达 |
| 20 | `CVE-2023-4863` | 无投递点 |
| 21 | `ZipUtils.unzipChildFile` | 存在 Zip Slip，但调用者不可达 |
| 22 | `ConfigActivity` | 只写 SharedPreferences，无实际能力 |
| 23 | WebView JS 桥 | **见 §6** |
| 24 | 原生库越界 | 无稳定可利用点 |
| 25 | NTP 时间注入 | 设备开机不发 UDP/123，被动抓 79 包全是 TCP |

## 六、最有价值的一条死路：WebView JS 桥

这条被所有人（包括最初的我）当作最有可能的突破点，结论是**彻底判死**。

### 6.1 表面上的样子

全树共 11 处 WebView 注册点，包括多个自定义 WebView、播放器、提醒弹窗、录制播放页等。`addJavascriptInterface` 调用齐全。

### 6.2 真正的问题

| 观察 | 结论 |
| --- | --- |
| 共 70 个 `@JavascriptInterface` 方法 | 数量看起来很可观 |
| 方法功能逐个归类 | 全部是「读信息 / 上报 / 下载」 |
| 桥对象是什么 | **Activity 自身**（`addJavascriptInterface(this, "webView")`） |
| 有没有 install / exec / loadUrl | **没有** |

### 6.3 为什么这条死得这么彻底

一个 JS 桥能做什么，取决于它暴露的方法，而不是取决于它的存在。70 个方法里没有一个是「执行」语义，也没有 `loadUrl`，因此即使完全控制页面内容，能做的也只是「读设备信息」和「触发下载」。

**这是整个研究里最重要的一次「证伪」**：它看起来是最大的入口，实际是最大的空门。

## 七、唯一卡点

### 7.1 问题

整库替换能写入，但会丢掉会话；而任务行只有已登录才会被 `resumeInstall` 读取。

### 7.2 已试过的绕法

| 尝试 | 结果 |
| --- | --- |
| `status=25` 假装已暂停 | 不触发 |
| `status=0` | 不触发 |
| 补齐 user 行 | 仍丢会话 |
| 合法空 WAL | 不解决会话问题 |
| 压制 443 让客户端走我方 | 其他业务崩 |
| 桌面卡片点击 | 无安装触发 |
| 伪造登录状态文件 | 后续请求需要服务端凭据 |

### 7.3 为什么必须已登录

登录成功后，服务端会下发会话字段（`uv`、`randomStr` 一类），这些字段既是后续 HTTP 请求的凭据，也是长连接注册的凭据。

整库替换会把这些字段所在的表一起覆盖，等于「换了一台没登录的设备」。而没登录的设备不会执行安装任务。

**这是设计上的死锁**：想改库必须先有库，而有了库就丢了登录态。

## 八、场景管控与修复

### 8.1 判定

```text
SceneControlStatus.executeThisTime() @ :884
  if (!SessionData.getSysAuthority().isSceneControlEnable()) return;
  ApplicationManager.getThirdPartyApps()
  calculateNeedForbiddenList(...)  // :700-820
  → setDisableApplication(pkg)
```

语义：禁用列表 = 第三方应用 − 场景白名单。

### 8.2 数据面

| 方法 | 行 | 说明 |
| --- | --- | --- |
| `getSceneControlPath(env, stamp)` | :183 | 拼出 `<SD>/xuehai/config/<env>/<stamp>/sceneControl.ini` |
| `getSceneControlInfos()` | :135 | 读缓存 → 全量读 |
| `readSceneControlInfos()` | :372 | 文件 → JSON |
| `refreshSceneInfosCache()` | :543 | 静态缓存置 null |
| `writeSceneControlInfos(String)` | :658 | 与原文比较后写 |
| `sendClearCacheBroadcast()` | :554 | 发清缓存广播 |

**关键结论：白名单持久化在外部存储的 JSON 文件里，外部可读写。**

### 8.3 广播面

| action | 语义 |
| --- | --- |
| `com.xuehai.control.action_clear_scene_cache` | 丢掉内存里的场景信息 |
| `...action.start_scene_control` | extras：ciphertext、package_name、force_close |
| `...action.stop_scene_control` | ciphertext 为空时移除当前场景 |

注册方式为动态 `registerReceiver`，**无 permission / broadcastPermission**，任意应用可发。

### 8.4 修复五步

```text
1. 递归找 /sdcard/xuehai/config（深度 ≤4）下所有 sceneControl.ini
2. JSON 文本级 patch：定位 "packageNames"，在数组里插入我方包名
   （已含则跳过；空数组插一个；非空插在首位并补逗号）
3. 写回原文件
4. 广播 clear_scene_cache 两次（带 setPackage 与不带各一次）
5. 取证：pm list packages -d | grep -c，pm path，pidof，dump ini 前 700 字符
```

### 8.5 判据

| 观测 | 结论 | 动作 |
| --- | --- | --- |
| `def-ini-count ≥ 1` 且之后不再死 | 修复成立 | 用 C2 固化 |
| `def-ini-count = 0` + `def-tree` 有目录 | 路径不同 | 按真实结构重出 |
| 死亡时刻 `dis=1` | 确认 disable | 扩白名单 |
| 死亡时刻 `dis=0` | 不是 disable | 转 force-stop 归因 |

## 九、证据纪律

这三条贯穿全部 25 条判死：

| 纪律 | 含义 |
| --- | --- |
| 两处独立确认 | 一处代码 + 一处字节，或两处互不相关的代码 |
| 门禁必须枚举 | 每个 `if` 都记判定表达式与默认值 |
| 日志不作证据 | 多渠道日志与远程上报，缺失与存在都不能推出结论 |

详见 [[research/unlocker-methodology]]。

## 十、下一步（当时的判断）

| 优先级 | 方向 | 理由 |
| --- | --- | --- |
| P0 | WebView 桥 | 后被追加否定，见 §6 |
| P1 | 读原语 | 已成立 |
| P2 | 自写 ztp | zty 只校验包名，响应 action 不校验签名 |
| P3 | 预置应用 + 一次性登录 | 绕开在线链路全部不确定性 |

P2 的立足点值得单列：**zty 拉起 ztp 时只检查包名，不校验签名，且响应 action 不校验来源。** 这是整条链路上第二个「无校验」的接缝。

---

一句话概括：**二十五条死路里，有二十条死在「代码里有入口但门禁永假」，只有五条死在真正的技术不可行——而这两种死法在现象上完全一样。**
