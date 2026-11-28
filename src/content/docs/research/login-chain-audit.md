---
title: "登录链路的逐帧审计"

description: "登录链路逐帧审计：十二步执行顺序与真实报文"

categories:
  - 安全分析
  - 研究资料
excerpt: 从 Activity 创建到真实请求发出，逐条读出十二步门禁顺序；记录真实登录报文的十四个字段与响应判读；定位「系统异常」白名单根因；修正 su 判定语义；并记下两个真实漏钩。
password: xh-research-2026
protect: full
---

# 登录链路的逐帧审计

> 分析对象：管理端登录界面的完整执行链（从 Activity 创建到真实请求发出）。
> 证据等级：A（字节码顺序）+ B（真实报文）。
> 配套阅读：[[xuehai-login-api]]（登录接口）、[[research/envspoof]]（伪装模块）、[[06-initialization]]（初始化流程）。

## 一、结论速览

| 问题 | 答案 |
| --- | --- |
| 登录前有几个门 | 十二步，顺序由字节码固定 |
| 真实请求长什么样 | 一个 POST，约 336 字节，14 个字段 |
| 为什么卡在激活码 | 响应 `activated:false` + `accessToken:null`，服务端要求先激活 |
| 一个良性告警 | 解析错误日志不影响登录，可忽略 |
| 「系统异常」的真正原因 | 一个系统版本白名单里没有当前值 |
| su 判定怎么改才对 | 从「拒绝」改成「不存在」 |

## 二、登录前的十二步

从 `LoginViewModel` 的登录方法字节码里逐条读出的顺序：

| # | 步骤 | 说明 |
| --- | --- | --- |
| 1 | `InputMode.isDefault()` / `isDev()` / `hasHistorySecretKey()` / `clearInputMode()` | 输入模式判定与清理 |
| 2 | `checkMDM()` | 管理端状态检查 |
| 3 | `LoginRequest.isPasswordLogin()` | 登录方式分流 |
| 4 | `DeviceManagerPolicyProxy.verifyDevelopToken()` | 开发者令牌校验 |
| 5 | `reqScanAbility()` | 扫描能力查询（一次 GET） |
| 6 | `isBrushCode() → MdmModel.checkBrushCode()` | 刷码登录分支 |
| 7 | `toDeveloper()` / `initInputMethod()` | 开发者模式与输入法 |
| 8 | `checkAndActiveAdmin()` | 设备管理员激活检查 |
| 9 | `checkNetStatus()` | 网络状态 |
| 10 | `checkSdcardIsFull()` | 存储空间 |
| 11 | `LoginUtil.checkLoginFormat()` | 输入格式 |
| 12 | `actualOnlineLogin()` | **真正发起网络请求** |

顺序的意义：**前 11 步任何一步失败，第 12 步都不会执行**。所以「点了登录没反应」通常意味着某个前置检查静默返回了，而不是网络问题。

## 三、界面侧的挂载点

`LoginActivity.onCreate` 末尾的调用序列（按顺序）：

| 动作 | 说明 |
| --- | --- |
| `replaceFragmentInActivity(LoginModeFragment)` | 挂载登录模式片段 |
| 订阅 `getShowVerifyDeviceDialog` | 触发激活码对话框 |
| 订阅 `getShowSpecialPermission` | 触发悬浮窗权限检查 |
| 订阅 `getUserAgreementVisible` | 用户协议 |
| 订阅 `getActiveAdmin` | 引导到设备管理员页 |
| 订阅 `getSkipToMdmVerify` | 引导到安全页 |
| `loadLocalCache()` | 读本地缓存 |
| `clearBlackApp()` | 清理黑名单 |
| `SafeCheckUtils.check()` | 安全检查（已置空） |
| `checkFloatWindowPermission()` | 悬浮窗权限（已置为 true） |

后两项是被 hook 覆盖的典型位置。

## 四、真实登录报文

### 4.1 请求

```text
POST https://ztp.yunzuoye.net/api/v2/platform/login
Content-Length: 336
User-Agent: <包名>/<版本> (<型号>; android; <版本号>; <序列号>)
```

字段清单：

| 字段 | 说明 |
| --- | --- |
| `userName` | 账号名 |
| `password` | 口令的 MD5 |
| `loginType` | 固定 5（口令登录） |
| `deviceId` | 设备序列号 |
| `osDisplay` | 系统显示版本串 |
| `imei` | 空 |
| `ap` | `wifi` |
| `mac` | 空 |
| `isNew` | `true` |
| `activationCode` | **空**（首次登录时） |
| `installTime` | 安装时间戳 |
| `mdmVersionCode` | 管理端版本码 |
| `mdmVersionName` | 管理端版本名 |
| `forceActivateBenefit` | `false` |
| `state` | 空 |

### 4.2 响应

```text
200 OK (143ms)  Content-Length: 1591  X-Content-Security: s/md5v1
```

体内容关键字段：

| 字段 | 值 | 含义 |
| --- | --- | --- |
| `code` | 200 | 请求成功 |
| `userId` | 有值 | 账号存在、口令正确 |
| `activated` | **false** | 设备未激活 |
| `accessToken` | **null** | 无会话令牌 |
| `refreshToken` | null | — |
| `uv` / `randomStr` | null | 会话凭据字段，未下发 |
| `microAddressDTOList` | null | 微服务地址表，未下发 |

### 4.3 判读

| 观察 | 结论 |
| --- | --- |
| 拿到 `userId` | 账号与口令正确 |
| `activated:false` | 设备未激活，服务端拒绝放行 |
| `accessToken:null` | 无令牌，后续所有业务请求都无凭据 |
| `uv/randomStr:null` | 长连接所需的凭据同样缺失 |
| 界面弹出「请输入激活码」 | 与响应一致 |

关键结论：**这一步的失败原因不是伪装不完整，而是服务端要求一个一次性激活码。** 这是业务门禁，不是技术门禁。

### 4.4 一个良性告警

日志里出现：

```text
[Lc]:: accountJson parse error ... JSONArray
```

根因：响应里某个字段存在但值为 JSON `null`，代码对其做 `new JSONArray("null")` 抛异常，被 catch 后只打 warn。

**这条告警不影响登录**。它被误当成「解析失败导致登录失败」浪费了大量排查时间，值得单独记一笔。

### 4.5 状态文件

| 路径 | 状态 |
| --- | --- |
| 授权文件目录 | 无 `*.atcd` 文件 |
| 会话配置目录 | 不存在 |
| 使用标记 | 已置为「已使用」 |

说明当时的设备处于「从未激活过」的状态。

## 五、「系统异常，不可使用」的根因

文案位置：

```text
com.xuehai.launcher.guide.InitGuideActivity$onCreate$12
```

判定方法：`checkDeviceOSIsCustomSystem()`。

实现方式：维护一个**系统版本串白名单**，共 24 条。当前机型的三个变体在名单内：

```text
UP1A.231005.007.P620ZCU2AYH1_B2BF
UP1A.231005.007.P620ZCU2AYG2_B2BF
UP1A.231005.007.P620ZCU2AXI3_B2BF
```

而第三方系统的版本串是裸的 `UP1A.231005.007`——**不在白名单里**，因此必然弹「系统异常」。

修复的四项：

| # | 修复点 |
| --- | --- |
| 1 | 把系统显示版本串改为带定制后缀的值 |
| 2 | hook `checkDeviceOSIsCustomSystem()` 返回 true |
| 3 | hook 机型有效性判定返回 false（跳过自定义系统检查） |
| 4 | hook 系统 root 判定返回 false |

连带影响：登录请求的 `osDisplay` 字段会变成定制后缀值——这是可接受的，因为它在白名单内。

## 六、su 语义修正

早期做法是让 su 调用返回 false、退出码 1。这等于「有 su 但拒绝执行」，是异常信号。

修正为「不存在」：

| 调用 | 修正后 |
| --- | --- |
| `Runtime.exec("su")` | `IOException: Cannot run program "su": error=2, No such file or directory` |
| `ProcessBuilder("su").start()` | 同上 |
| `sh -c "su ..."` | stderr `sh: su: not found`，退出码 127 |
| `which su` / `command -v su` | 空输出，退出码 1 |

配套 `File.exists/isFile/isDirectory/canExecute/canRead` 对 `/su`、magisk、ksu、apatch、lsposed 全部返回 false。

## 七、审计发现的两个漏钩

这两处是本次审计最有价值的产出：

| 漏钩 | 后果 |
| --- | --- |
| 包名少一个字母（`abrstu` vs `abrustu`） | 整个包从未进入 hook 范围，日志与检测照常 |
| 只钩了 `common.crack.*`，漏了 `compat.crack.*` | 另一组同类逻辑完全裸露 |

同类的还有 `common.sdk.proxy.*` 与 `system.mdm.proxy.*` 的分裂。

教训：hook 清单必须按反编译树里的实际包路径逐条核对。

## 八、最终建议

| 建议 | 理由 |
| --- | --- |
| 先点登录、不输激活码 | 确认是否弹激活框，验证前置 11 步是否全通 |
| 只输一次激活码 | 激活码为一次性，浪费掉需重新申请 |
| 任何一步与预期不符就停下 | 拿 logcat 而不是继续猜 |
| 不要忽略 `parse error` 告警 | 但也不要把它当根因 |
| 不要试图伪造激活状态 | 后续通信需要服务端认可的会话凭据 |

---

一句话概括：**登录链路的每一道门都是显式的、可枚举的、可逐条验证的——真正过不去的那道门，是「需要服务端发一个码」，而不是任何技术伪装。**
