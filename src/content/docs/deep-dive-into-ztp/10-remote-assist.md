---
title: "远程协助（Remote Assist）"
description: "智通平台的远程协助功能：老师通过学海服务器远程控制学生平板"
categories:
  - 功能解析
excerpt: 智通平台内置一套完整的远程协助系统，老师端通过学海服务器下发指令，学生平板上的 AssistService 轮询拉取任务并执行，支持安装/卸载应用、执行 shell 命令、上传文件、查看系统信息等。
---

# 远程协助（Remote Assist）

## 概述

智通平台（学生端 `com.xh.zhitongyunstu`）内置一套**远程协助**系统，用于让学海老师远程控制学生平板。整个系统由三部分组成：

1. **学海服务器**：保存协助会话（assist）、任务（task）与结果（result）。
2. **智通平台（学生平板）**：`AssistService`（独立进程 `:assist`）轮询拉取任务，用 ANTLR 解析的 DSL 指令执行操作，并把结果回传服务器。
3. **老师端**：通过服务器下发 `ENTRY` 通知，学生平板收到后开始协助。

## 关键类与入口

| 类 | 作用 |
|---|---|
| `com.xuehai.launcher.assist.AssistManager` | 单例，负责绑定/解绑 `AssistService`、发起协助请求、发送协助消息 |
| `com.xuehai.launcher.assist.AssistService` | 独立进程 `:assist` 中的服务，轮询任务、显示悬浮窗、心跳保活 |
| `com.xuehai.launcher.assist.RemoteAssistActivity` | 协助状态页（学生可见），显示"协助中/协助完成"等状态 |
| `com.xuehai.launcher.assist.RemoteViewModel` | 协助页 ViewModel，触发 `requestAssist` |
| `com.xuehai.launcher.assist.data.AssistRemoteDataSource` | 与服务器通信的 REST 数据源 |
| `com.xuehai.launcher.assist.data.AssistModelImpl` | 业务逻辑：拉取任务、解析 DSL、执行、上报结果 |
| `com.xuehai.launcher.assist.antlr.AssistFunc` | DSL 指令的实际执行者（安装应用、执行 shell 等） |
| `com.xuehai.launcher.assist.antlr.MyVisitor` | ANTLR 访问器，把 DSL 语法树映射到 `AssistFunc` 方法调用 |
| `com.xuehai.launcher.assist.antlr.ZAZEParser/ZAZELexer` | 自定义 DSL 语法（ZAZE.g4）的解析器 |

## 协助流程

### 1. 发起协助（老师端 → 服务器 → 学生平板）

- 老师端在服务器上发起协助，服务器生成一个 `assistId`。
- 服务器通过**资源同步通道**（`MyContentProvider` 的 `CPVDCache`）下发 `REMOTE_ASSIST` 数据码（`CA106004SB1030140001`）。
- 智通平台 `ContentProviderReceiver.onResourceUpdate()` 收到该数据码后调用：

```java
ModelFactory.getAssistModel().requestAssist(null);
```

- `AssistModelImpl.requestAssist()` 调用 `AssistRemoteDataSource.requestAssist()`，向服务器请求协助：

```
GET {base}/api/v1/users/{userId}/devices/{deviceId}/assists
```

- 服务器返回 JSON，包含 `id`（assistId）和 `hidden`（是否隐藏悬浮窗）。
- `AssistNotify.parseJsonObject()` 把响应解析为 `AssistNotify`，`operate` 固定为 `ENTRY`。
- `AssistManager.sendAssistMessage()` 通过 `Messenger` IPC 把通知发给 `:assist` 进程的 `AssistService`。

### 2. 学生平板进入协助状态

`AssistService.assistNotify()` 收到 `ENTRY` 通知后：

- 保存 `assistId` 和 `hidden` 标志。
- 调用 `startAssist()`：
  - `LauncherUtil.setScreenCloseTime(Integer.MAX_VALUE)` —— **让屏幕永不自动关闭**（协助期间）。
  - 设置状态为 `STATUS_CONNECT(1)`。
  - 立即发送一次心跳消息（`MSG_HERT = 101`）。

### 3. 轮询任务（心跳循环）

`AssistService` 使用 `HandlerThread("assist_thread")` 上的 `mHandler` 做心跳循环：

- 每 **8 秒**（`HEART_TIME`）调用一次 `doAssist()`。
- `doAssist()` 调用 `AssistModelImpl.requestAssistTask(assistId, ...)`：

```
GET {base}/api/v1/users/{userId}/devices/{deviceId}/assists/{assistId}/tasks
```

- 服务器返回一个 JSON 数组，每个元素是一个 `AssistInstruction`：
  - `id` → taskId
  - `instruction` → DSL 指令字符串
  - `step` → 步骤号
- 每个任务被包装成 `TaskEntity`（key 为 `"{assistId}_{step}"`），推入 `Task.create("request_assist_task").executeOnAsyncAuto()` 任务队列顺序执行。
- 若超过 **60 秒**（`HEART_TIMEOUT`）没有收到服务器响应，`assistTimeout()` 触发，状态置为 `STATUS_DISCONNECT(2)` 并停止协助。
- 若服务器返回错误码 `107000400`，直接停止协助。

### 4. 执行 DSL 指令

每个任务执行时：

```java
AssistTaskResult result = (AssistTaskResult) new MyVisitor(assistInstruction)
    .visit(new ZAZEParser(new CommonTokenStream(new ZAZELexer(
        CharStreams.fromString(instruction, "utf-8")))).prog());
```

- `MyVisitor` 把 DSL 语法树映射为对 `AssistFunc` 方法的**反射调用**（`ReflectUtil.executeMethod`）。
- 执行结果（字符串或 `AssistTaskResult`）被收集。
- 执行完成后调用 `upAssistResult()` 上报：

```
POST {base}/api/v1/users/{userId}/devices/{deviceId}/assist/result
```

请求体为 `AssistTaskResult` JSON：
```json
{
  "assistanceId": "...",
  "taskId": "...",
  "result": 1,          // 1=成功 2=失败
  "content": ["..."],   // 文本结果
  "resources": [{"fileType": 1|2|3, "url": "..."}]  // 上传的文件资源
}
```

### 5. 结束协助

- 服务器下发非 `ENTRY` 的 operate（或 `QUIT`）时，`assistNotify()` 调用 `stopAssist()`。
- `stopAssist()`：
  - `LauncherUtil.setScreenCloseTime(300000)` —— 恢复屏幕关闭时间为 5 分钟。
  - 状态置为 `STATUS_FINISH(4)`。
  - 清空 `assistId`，关闭所有线程任务。
- 老师端也可通过 `AssistModelImpl.quitAssist()` 直接发送 `QUIT` action 的 Intent 给 `AssistService`（带 `immediate=true` 时立即 `stopSelf()`）。

## ZAZE DSL 指令语言

`AssistService` 收到的 `instruction` 是一段自定义 DSL 脚本（ANTLR 语法 `ZAZE.g4`）。语法结构：

```
prog        : statement+ ;
statement   : assignStatement | blockStatement | loopStatement | functionStatement ;
assignStatement : Identifier '=' expression NEWLINE ;
blockStatement  : '{' statement* '}' ;
loopStatement   : 'loop' quoteExpr blockStatement ;
functionStatement: Identifier quoteExpr blockStatement? ;
quoteExpr   : '(' argumentList ')' ;
argumentList: expression (',' expression)* ;
expression  : variableExpression ;
variableExpression: INT | Identifier | BooleanLiteral | StringLiteral ;
```

即：**函数调用** `函数名(参数1, 参数2)`、**变量赋值** `x = 值`、**循环** `loop(次数) { ... }`、**代码块** `{ ... }`。

`MyVisitor.visitFunctionStatement()` 通过反射调用 `AssistFunc` 中与函数名同名的方法，参数为解析后的值。

## AssistFunc 可执行指令清单（后门能力）

`AssistFunc` 暴露了以下可被远程调用的方法：

| 方法 | 功能 | 危险等级 |
|---|---|---|
| `test()` | 返回 `"success"`，连通性测试 | 低 |
| `checkNetwork()` | 返回 WiFi SSID、RSSI、IP、DNS、网关、网络类型、MAC 地址 | 中（信息泄露） |
| `probe(url)` | 对任意 URL 发起 GET 请求并回传结果 | 中（SSRF） |
| `getSystemConfig()` | 返回系统版本、型号、SDK、bootloader、厂商、指纹、内存、机器码、MAC、屏幕、SD 卡空间 | 中（信息泄露） |
| `getAppInfo(packageName)` | 返回指定应用名称、包名、路径、版本 | 低 |
| `getInstallAppList()` | 返回所有已安装应用列表 | 中（信息泄露） |
| `installAppOffline(filePath)` | 通过 MDM 策略安装本地 APK | **高** |
| `installAppOnline(url)` | 下载 URL 的 APK 到 `{SD}/xuehai/download/app/assist/{md5}.apk` 并安装 | **高** |
| `unInstallApp(packageName)` | 通过 MDM 策略卸载应用 | **高** |
| `getFileTree(dir)` | 列出目录下所有文件（名称、是否文件、大小） | **高（文件系统浏览）** |
| `renameFile(filePath, newFileName)` | 重命名文件 | **高** |
| `downloadFile(url, savePath)` | 下载任意 URL 到指定路径 | **高** |
| `uploadFile(filePath)` | 上传文件到学海日志服务（目录自动打包 zip） | **高（数据外泄）** |
| `getFileLength(filePath)` | 获取文件大小 | 中 |
| `notifyAppLogService(packageName, action)` | 向指定包名的应用发送启动服务 Intent | 中 |
| `uploadLocationInfo()` | 返回本地保存的定位信息 | 中（隐私） |
| `executeCmd(cmd)` | **执行任意 shell 命令**并回传输出 | **极高（RCE）** |
| `clearFirewall()` | 清除 MDM 防火墙应用/域名规则 | **高** |
| `clearAppData(packageName)` | 清除指定应用数据（不能清自己） | **高** |
| `dumpAppUsageEvents(start, end)` | 导出应用使用事件快照 | 中 |
| `exit()` | 退出协助 | 低 |

## 悬浮窗 UI

- 协助进行中，`AssistService` 在主线程 `mUIHandler` 上显示一个**悬浮窗**（`window_assist` 布局），显示当前状态文字（协助中/协助完成/协助断开）。
- 悬浮窗可拖动，点击后打开 `RemoteAssistActivity`。
- 若服务器下发 `hidden=1`，则**不显示悬浮窗**（隐藏协助）。
- 悬浮窗类型：Android 8.0+ 用 `TYPE_APPLICATION_OVERLAY(2038)`，否则 `TYPE_PHONE(2003)`。

## 隐藏协助 vs 可见协助

协助分为两种模式，由服务器下发的 `AssistNotify.hidden` 字段决定：

| 模式 | `hidden` | 悬浮窗 | 学生感知 | 用途 |
|---|---|---|---|---|
| **可见协助** | `0` | 显示（可拖动，点击打开状态页） | 学生能看到"协助中"悬浮窗 | 老师指导/演示，学生知情 |
| **隐藏协助** | `1` | **不显示** | 学生完全无感知 | 隐蔽监控/远程操作 |

隐藏协助的完整行为链：

1. 服务器下发 `REMOTE_ASSIST` 数据码（`CA106004SB1030140001`）。
2. `AssistNotify.parseJsonObject()` 读取 `hidden` 字段（`optInt("hidden", 0)`）。
3. `AssistService.assistNotify()` 保存 `assistPopHidden = true`。
4. `setStatus()` 中 `if (this.assistPopHidden) return;` —— **所有悬浮窗显示/隐藏逻辑被跳过**。
5. 协助期间 `setScreenCloseTime(Integer.MAX_VALUE)` 让屏幕常亮（即使隐藏协助，屏幕也不会自动熄灭，这是学生可感知的异常）。
6. 协助结束后 `setScreenCloseTime(300000)` 恢复。

**注意**：隐藏协助下学生仍可通过 `RemoteAssistActivity` 看到协助状态（若被打开），但正常使用中不会出现任何提示。

## 状态机

| 状态值 | 名称 | 含义 |
|---|---|---|
| 0 | 协助断开 | 初始/空闲 |
| 1 | 协助中 | 已连接，正在轮询 |
| 2 | 协助断开 | 超时断开 |
| 3 | 协助中 | 请求中 |
| 4 | 协助完成 | 正常结束 |
| 5 | 协助断开 | 请求失败 |

状态通过广播 `com.xh.common.service.assist`（extra `status`）通知 `RemoteAssistActivity`。

## 相关 API 汇总

| 方法 | URL | 说明 |
|---|---|---|
| 请求协助 | `GET /api/v1/users/{userId}/devices/{deviceId}/assists` | 获取 assistId |
| 拉取任务 | `GET /api/v1/users/{userId}/devices/{deviceId}/assists/{assistId}/tasks` | 获取指令列表 |
| 心跳 | `PUT /api/v1/assists/{assistId}/active` | body: `{"deviceId": ...}` |
| 上报结果 | `POST /api/v1/users/{userId}/devices/{deviceId}/assist/result` | 上报执行结果 |

## 安全分析

1. **远程代码执行**：`executeCmd()` 允许老师端在任意学生平板上执行任意 shell 命令。
2. **远程安装/卸载应用**：`installAppOnline()` / `unInstallApp()` 可远程部署或移除任意应用。
3. **文件系统完全访问**：`getFileTree()` / `downloadFile()` / `uploadFile()` 可浏览、下载、上传平板上的任意文件。
4. **隐藏协助**：`hidden=1` 时悬浮窗不显示，学生无法感知协助正在进行。
5. **屏幕常亮**：协助期间 `setScreenCloseTime(Integer.MAX_VALUE)` 让屏幕永不关闭。
6. **无鉴权**：所有操作仅依赖 `assistId`，无二次验证。