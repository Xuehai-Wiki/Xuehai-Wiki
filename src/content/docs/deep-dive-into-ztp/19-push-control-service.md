---
title: "推送长连接：control-service 报文与管控下发"

description: "ztp 自研 TCP 推送的业务层拆解：control-service 报文里到底有什么、是否加密、为什么它只是'门铃'而不是'信封'，以及与既有文档的三处勘误"

categories:
  - 技术解析
excerpt: control-service 推送报文的完整三层结构（帧头/Message/PushMessage JSON）、零加密举证（裸 Socket + 明文 UTF-8）、仅一次性 HMAC 认证与硬编码密钥、ACK 先于处理的可靠性缺口，以及 04/ztp-control-report 中的心跳与轮询勘误。
---

# 推送长连接：control-service 报文与管控下发

> 分析对象：ZTP 反编译源码（jadx 输出），路径相对 `app/src/main/java/`，行号为反编译源文件行号。
> 配套阅读：[[04-ipc-ztcloud]]（协议帧与命令字）、[[18-control-policy-fetch]]（策略拉取链路）、[[ztp-control-report]]（管控全量）。

## 一、三个问题，三句话

| 问题 | 答案 |
|------|------|
| `control-service` 消息里有什么 | **只有一个信封**：`appId / subAppId / subMsgType / userId / payload` 等 9 个字段，**不含任何策略内容**；策略字段（curfew、periods、modeDuration…）永远走 HTTP `forbidden/detail` |
| 加密吗 | **不加密**。裸 TCP（`new Socket()`）+ 明文 UTF-8 JSON；唯一的密码学是建连时一次 `HMAC-SHA256(securityKey, deviceId)` 签名，密钥硬编码在 APK 里，且 `securityKey = Base64(accessKey)` |
| 既有文档有没有写 | 有，但都停在"有这条消息"这一层：[[04-ipc-ztcloud]] §3 只讲协议帧、[[ztp-control-report]] §2.2 只有一段分发列表，**没有任何一处给出信封字段、payload 语义或加密结论**，且有三处参数错误（见 §7） |

一句话：**推送是门铃，不是信封。** 门铃响了一声，客户端自己去 `forbidden/detail` 把整份策略取回来。

---

## 二、报文的完整三层结构

一条 `control-service` 推送在网络上落地时，是"帧 → 消息 → 业务 JSON"三层套娃。

### 2.1 第一层：TCP 帧（`PacketEncoder` / `HeaderByteBuf`）

```
+--------+---------+--------+------------------+-------------------+
| MAGIC  | version |  cmd   |  length(变长)     |      body         |
|  0x09  |  0x03   |  0x03  |  1~4 字节         |  Message 编码内容  |
+--------+---------+--------+------------------+-------------------+
   1B        1B       1B        1~4B               length-3 字节
```

- MAGIC 固定 `0x09`，不匹配直接抛 `SocketException("获取数据包MAGIC异常")`（`HeaderByteBuf.verify` L49-55）；
- `length` 是**含 3 字节头**的总长：`bodyLength = length - 3`（`LengthByteBuf.read` L43-44），上限 `MAX_PACKET_LENGTH = 10MB`；
- 编码顺序见 `PacketEncoder.encode` L92-103，解码用 `HeaderByteBuf` + `LengthByteBuf` + `ContentByteBuf` 三段流式读取。

一包心跳的完整字节就是 5 个：`09 03 01 04 01`（MAGIC=9、version=3、cmd=1、length=4、亮屏标志=1）。

### 2.2 第二层：`Message`（cmd = 3）

`Message.decode`（L55-70）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `mode` | 1 字节 | 消息模式（客户端只存不用） |
| `count` | 2 字节 | entry 数量 |
| `entries[]` | — | 每条 = `msgId`(8B long) + `contentLen`(4B int) + `content`(UTF-8) |

`contentLen` 有 10MB 上限校验（`Message.Entry.decode` L25-31），超限只打日志不解析。

### 2.3 第三层：`PushMessage` JSON

`content` 是一段 JSON 字符串，反序列化为 `PushMessage`（`launcher/message/push` 侧，9 个字段）：

| 字段 | 作用 | `control-service` 场景取值 |
|------|------|---------------------------|
| `appId` | 消息归属应用 | 必须与 `subAppId` 相等，否则走"转发给第三方 App"分支 |
| `subAppId` | 子应用/目标模块 | 同上，平台内部消息时二者一致（如 `com.xh.zhitongyunstu`） |
| `subMsgType` | **实际分发键** | `"control-service"` |
| `msgType` | 冗余的父类型 | 客户端不参与分发判断 |
| `msgId` | 业务消息 ID（字符串） | 与传输层的 long `msgId` **不是同一个 ID** |
| `userId` | 目标用户 | 必须等于本地 `SessionData.getUserId()`，否则整条丢弃 |
| `clientId` | 目标客户端 | 客户端不校验 |
| `payload` | 业务载荷 | **该分支完全不读取** |
| `style` | 展示样式（未读计数用） | 无关 |

所以一条真实的 `control-service` 长这样：

```json
[{
  "msgId": 1731658800123,
  "content": "{\"appId\":\"com.xh.zhitongyunstu\",\"subAppId\":\"com.xh.zhitongyunstu\",\"subMsgType\":\"control-service\",\"userId\":\"1234567\",\"payload\":\"\",\"style\":0}"
}]
```

外层那个 `[{msgId, content}]` 数组是 `PushClient.dealMessage` 回吐给业务层的形态（`PushJsonUtil.objToJson(arrayList)`，L124-126）。

> ⚠️ 命名陷阱：`MsgType` 常量表里的 `CONTROL_UPDATE = "control-service"` 是拿去和 **`subMsgType`** 比的，不是 `msgType`（`LauncherPushService.disposeMessage` L153-154 的入参来自 `pushMessage.getSubMsgType()`）。

---

## 三、`control-service` 分支到底做了什么

`LauncherPushService` 的三道闸门：

1. **应用闸**：`consume(pushMessage)` = `appId.equals(subAppId)`（L103-105）。相等 → 平台内部消息，进 `disposeMessage`；不等 → `transMessage` 转发给第三方 App（`MessageCache` + 广播）。
2. **用户闸**：`pushMessage.getUserId()` 与本地 userId 字符串比较，不等直接打 `过滤不匹配消息remote> (...)`（L203-221）。
3. **类型闸**：`switch (subMsgType.hashCode())` 命中 `657941061` → `"control-service"`。

命中后只有两件事（L153-161）：

```java
ControlModel controlModel = ModelFactory.getControlModel();
controlModel.startControlMode();                  // ① 立刻拉一次 forbidden/detail
if (SessionData.isLogin()) {
    launch(ThreadPlugins.getMyScope()) {
        controlModel.reqStudentControlModes(false) // ② 拉一次 TOC 管控模式列表
    }
}
```

**`payload` 从头到尾没有被读取。** 这解释了三件事：

- 服务端**不可能**通过这条推送直接改策略——改策略必须落到 HTTP 接口的数据上；
- 推送的语义是"缓存可能过期了，去重新拉"，属于 **invalidation notice**（失效通知）模型；
- `payload` 传空串、传 `"1"`、传任意垃圾，行为完全一致。

`startControlMode()` 自身还有门控（见 [[18-control-policy-fetch]] §2）：`Permission` 第 4096 位 + 学生端 + `userId > 0`。所以推送到了但权限位被关，只会打一行 `本地管控权限已关闭！！` 然后什么都不做。

### 3.1 完整时序

```
教师端改管控
   │
   ├─(1) 服务端写策略库
   │
   └─(2) 推送服务下发 MESSAGE_CMD(cmd=3)
            entries[0].content = PushMessage{
                appId == subAppId,
                subMsgType: "control-service",
                userId: "<目标学生>",
                payload: ""            ← 不承载策略
            }
            │
            ▼  明文 TCP
   LauncherPushService.onReceiveMessageData
     → 先回 MessageFeedback(cmd=-125)      ← ACK 早于处理
     → 过三道闸 → disposeMessage
            │
            ▼
   ControlRepository.startControlMode()
     → GET /api/v1|v2/pub/platform/users/forbidden/detail   ← 策略真正在这里
            │
            ├─→ XmConfig(control) 落盘（control_key_*）
            ├─→ 广播 com.xuehai.control.action.all_control
            └─→ ContentProvider /control 供各 App 读取
```

一次推送 = 1~2 次 HTTP GET，外加一轮本地广播。这就是"秒级下发"的全部机制。

---

## 四、加密与鉴权：逐层举证

结论先说：**这条链路上没有加密。**

| 层 | 实现 | 是否有加密/完整性保护 |
|----|------|----------------------|
| 传输层 | `new Socket()` + `InetSocketAddress`（`TcpClient.connect` L189-190） | ❌ 无 TLS。整个 `com.xuehai.message` 包内 `SSL / SSLSocket / TrustManager / Cipher / AES / encrypt / decrypt` 关键字命中数为 **0** |
| 帧层 | MAGIC `0x09` + 变长长度（`HeaderByteBuf` / `LengthByteBuf`） | ❌ 仅做格式校验，无 CRC、无 MAC |
| 报文层 | `new String(bArr, Charsets.UTF_8)`（`Message.Entry.decode` L28） | ❌ 直接 UTF-8 解码，明文 JSON |
| 认证层 | `Authorization` 报文一次性签名（`PushClient.auth` L79-93） | ⚠️ 唯一有密码学的地方，仅建连时一次 |

### 4.1 那唯一的签名

```java
String signature = Signer.computeSignature(config.getSecurityKey(), config.getDeviceId());
// = Base64( HMAC-SHA256( key = securityKey, data = deviceId ) )
Authorization auth = new Authorization(
    accessKey,            // "3f025ad519274a6795aaf5161efd7726"
    deviceId,             // 设备号
    clientId,             // 上次服务端下发的 clientId，首连为空
    signature,            // 上面那一串
    "",                   // token —— 填空串，后续报文也不带
    String.valueOf(userId),
    userId + "," + schoolId   // tags
);
```

`Authorization.encodeContent`（L82-92）把这 7 个字符串按"1 字节长度 + UTF-8 内容"顺序平铺，无任何加密。服务端回 `Authorization.Feedback(clientId, token, code)`，`code` 语义在 `ReturnCodes`：100 通过 / 101 通过但换 clientId / 201 签名错 / 202 token 错。

### 4.2 密钥是硬编码且可推导的

```java
// PushUtil.initialize L66
new PushConfig(ctx, host, port, deviceId,
    "3f025ad519274a6795aaf5161efd7726",
    "M2YwMjVhZDUxOTI3NGE2Nzk1YWFmNTE2MWVmZDc3MjY=",
    0L, userId, schoolId, 64, null);
```

`securityKey` 就是 `Base64(accessKey)`：

```
base64_decode("M2YwMjVhZDUxOTI3NGE2Nzk1YWFmNTE2MWVmZDc3MjY=") == "3f025ad519274a6795aaf5161efd7726"
```

也就是说 HMAC 的 key 是 accessKey 的一次 base64 变形，两个"凭据"实际只有一个秘密，且静态躺在 APK 的字符串池里。任何拿到安装包的人都能算出任意 deviceId 的合法签名。

对比 HTTP 侧（[[02-signing]] 的 xhcore JNI 签名 + 证书校验 + 自研 DNS），推送通道的安全水位明显低一档：**它是整个 ztp 里最容易被中间人和本地伪造穿透的通道**。

---

## 五、这条通道的三个可利用面

### 5.1 明文注入（不需要破解任何密钥）

`PushClient.onReceiver`（L270-311）只按 cmd 分支，**不校验报文来源、不校验签名、不校验 msgId 是否被服务端签发过**：

```java
if (cmd == 3) { Message m = new Message(); m.decode(buf); dealMessage(m); return; }
```

同一链路上的中间人（校园网网关、代理、ARP 欺骗）可以直接构造 `cmd=3` 的帧，塞一条 `subMsgType="control-service"` 且 `userId` 正确的 JSON，客户端就会当成真实指令执行。`userId` 也不用猜——它就明文躺在客户端上行第一包 `Authorization` 的 `uid` 字段里。

效果不是"改策略"（payload 被忽略），而是**强制刷新风暴**：每条伪造消息触发 1 次 `forbidden/detail` GET + 一轮广播 + 一次 `reqStudentControlModes`。这既是流量放大，也能配合 `ControlDialog` 的弹出时机做"管控抖动"。

### 5.2 任意 payload 等价

因为 §3 的"payload 不读取"，伪造者不需要知道服务端的 payload 结构，也不需要构造合法策略 JSON。伪造门槛从"逆向业务协议"降到"抄一个信封"。

### 5.3 ACK 先于处理 + 去重表只在内存

```java
boolean zSend = send(messageFeedback);   // ① 先 ACK
if (!arrayList.isEmpty() && zSend) {
    idManager.add(entry.getMsgId());     // ② 再记账
    pushActionHelper.onReceiverMessage(json);  // ③ 最后才回调业务
}
```

（`PushClient.dealMessage` L114-127）

- ACK 在业务处理**之前**发出：业务侧崩溃、进程被杀、`startControlMode` 抛异常，服务端都认为"已送达"，不会重投 → **静默丢消息**；
- `IDManager` 是纯内存 `HashSet`，`load()` 是空实现（L29-30）→ 进程重启后去重表清零，服务端重发的同 `msgId` 会被**再分发一次**；
- 两条叠加的行为特征是：**该丢的会丢，该重的会重**，且都不上报。

---

## 六、连接、心跳与保活参数（实测值）

| 参数 | 值 | 出处 |
|------|----|------|
| 建连超时 | **15s** | `TcpClient` 构造 `this.timeOut = 15000`（L109） |
| 心跳周期 | **30s** | `PushConfig` 合成构造 `(i3 & 64) != 0 ? 30000L : j`（L38-40），`PushUtil` 传 `64` |
| 心跳内容 | 1 字节：亮屏 1 / 灭屏 0 | `Heartbeat.encodeContent` L18-21 |
| 心跳启动 | 建连成功 1s 后起算；亮/灭屏时重置并立即发一次 | `PushClient.onEvent` L248；`PushScreenReceiver` L26-28 |
| 闹钟兜底 | `now + 2 × 心跳`（60s），`setExactAndAllowWhileIdle` | `PushAlarmReceiver` L53-55；`AlarmWalkman` L29-37 |
| Echo 探测 | 发 `Echo("1")` 后 3s 未回 → 任务 4 → `reconnect(0, force=true)` | `PushClient.checkConnect` L195-201 |
| 重连退避 | 3s 起，超 5 次每次 +3s，上限 600s | `RetryRuleV1(0, 600000, 0, 0)` 合成构造 → `(3000, 600000, 5, 3000)` |
| 亮屏补偿 | 亮屏 10s 后发 `PullProto`（cmd 5）拉离线消息 | `PushScreenReceiver` L32-36 → `MyTaskHandler` L35-37 |
| 推送地址 | `UrlCache.getPushUrl()` = 服务端下发项 `SB107001`，须匹配 IPv4 正则，缺省端口 80 | `UrlCache` L187-189；`IpRegular` L15/L40-51 |
| clientId 上报 | `POST /api/v1/users/{userId}/clients/`，body `{appId, clientId, deviceId, providerId:"TT"}` | `MessageRemoteDataSource.registerClient` L35-49 |
| 开关门控 | `Permission.checkPermission(16L)` + `sysAuthority.isPushMessageEnable()` | `PushUtil.initialize` L39-46 |

`PushConstants.HEART_DELAY = 90000` 确实存在，但**全仓无任何引用**（死常量）；实际周期由 `PushConfig` 决定。[[04-ipc-ztcloud]] §3.5 写作"默认 90s（`PushConstants.HEART_DELAY`）"，是把死常量当成了生效值。

---

## 七、既有文档覆盖情况与勘误

### 7.1 覆盖矩阵

| 文档 | 覆盖到什么程度 | 缺什么 |
|------|----------------|--------|
| [[04-ipc-ztcloud]] §3 | 帧格式、命令字表、认证流程、去重、保活——**协议层最全**的一篇 | 完全不涉及业务层：没写 `control-service`、没写 `PushMessage` 字段、没给加密结论；两处参数错 |
| [[ztp-control-report]] §2.2 | 一段（6 行）分发列表，提到 `control-service` → `startControlMode` | 无信封字段、无 payload 语义、无 `userId` 过滤、无注册接口；与 §2.1 一起把 HTTP 定为"主通道"，结论错 |
| [[18-control-policy-fetch]] §6.7 | 把推送定位为"7 个触发点之一"，写明"没有轮询，纯推送 + 一次 GET" | 只有一句话带过报文内容 |

**所以"既有文档里没有管控策略下发的内容吗"——有的，但都是"协议层 + 触发点"视角，缺的正是这一篇讲的东西：报文里有没有策略、加不加密、payload 算什么。**

### 7.2 三处需要修正的说法

| 位置 | 现表述 | 实测 | 证据 |
|------|--------|------|------|
| [[04-ipc-ztcloud]] §3.5 | 心跳默认 **90s** | **30s** | `PushConfig` L38-40 合成构造；`PushUtil` L66 传 marker=64 |
| [[04-ipc-ztcloud]] §3.1 | `TcpClient.connect()` 超时默认 **10s** | **15s** | `TcpClient` L109 `this.timeOut = 15000` |
| [[ztp-control-report]] §2.1 | "HTTP 定时轮询（**主通道**），每 120000ms 重复 → 拉取" | 120s 循环只做**本地反序列化**，不发请求；主通道是**事件驱动**（7 个触发点）+ 推送 | 见 [[18-control-policy-fetch]] §3–§4 |

### 7.3 一条容易混的旁支

`com.xuehai.service.control.ControlService.reqControlData` 里的 `GET /api/v1/forbidden/detail`（走微服务寻址）**不在这条推送链路上**——它是 service 进程的遗留通道，唯一上层调用是 `DebugViewModel`，类上标着 `@Deprecated`。线上生效的是 launcher 进程的 `ControlRepository.startControlMode()`。

---

## 八、关键类清单

| 类 | 位置 | 作用 |
|----|------|------|
| `TcpClient` | `message/sdk` | 裸 Socket 收发、15s 超时、帧解码循环 |
| `PacketEncoder` / `PacketDecoder` | `message/sdk/proto`、`decode` | 变长长度编码/流式解码 |
| `Authorization` | `message/sdk/proto` | 认证报文（7 字段 + HMAC 签名） |
| `Message` / `Message.Entry` | `message/sdk/proto` | 消息帧（mode + count + entries） |
| `MessageFeedback` | `message/sdk/proto` | 回执（每 entry 9 字节） |
| `Heartbeat` / `Echo` / `PullProto` | `message/sdk/proto` | 心跳 / 探测 / 拉离线 |
| `Signer` | `message/sdk/security` | `HMAC-SHA256` + Base64 |
| `PushClient` | `message/sdk/client` | 认证、心跳、去重、分发、重连 |
| `IDManager` | `message/sdk` | 内存去重表（不持久化） |
| `PushUtil` | `launcher/message/push` | `PushConfig` 装配点（硬编码 accessKey/securityKey） |
| `LauncherPushService` | `launcher/message/push` | 业务分发：`control-service` / `assist-notify` / `app-upgrade*` / `app-notification` / `app-syncMessage` |
| `MsgType` | `launcher/message/push` | 分发键常量（与 `subMsgType` 比对） |
| `PushAlarmReceiver` / `AlarmWalkman` / `PushScreenReceiver` | `message/sdk/receiver` | 保活闹钟、亮灭屏补偿 |
| `MessageRemoteDataSource` | `launcher/message/data` | clientId 上报接口 |
