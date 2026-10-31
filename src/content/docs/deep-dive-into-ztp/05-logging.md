---
title: "学海日志与埋点体系"

description: "客户端日志采集、压缩、上传链路：LogService 定时任务、logcat 抓取、埋点统计、崩溃上报、用户反馈上报"

categories:
  - 技术解析
excerpt: 学海客户端的完整日志与埋点体系：日志目录结构、LogService 调度、logcat 抓取、埋点统计、XCrash 崩溃上报与用户反馈。
---

# 学海日志与埋点体系解析

## 前言

学海客户端的日志体系分为两大块：

1. **客户端日志**（`com.xuehai.launcher.log`）—— 日志采集、压缩、上传到 Kibana / 文件服务器
2. **核心统计埋点**（`com.p017xh.xhcore.common.statistic` + `service` + `xcrash`）—— 埋点采集、logcat 抓取、崩溃上报、用户反馈

## 一、日志目录结构

### 1.1 基础路径

```
{sdcard}/xuehai/log/           ← 日志根目录（LOG_DIR）
{sdcard}/xuehai/log/statistics/ ← 统计目录（STATISTICS_DIR）
```

### 1.2 日志目录（LogFile）

| 常量 | 路径 | 说明 |
|------|------|------|
| `LOG_DIR_CRASH_AND_UPLOAD` | `{BASE}/com.xh.logcatcher/local/logs/appLog` | 崩溃+上传日志（旧版） |
| `LOG_DIR_APP_ERROR` | `{LOG_DIR}/local/appLog` | 应用错误日志（旧版） |
| `LOG_DIR_NET_CHECK` | `{LOG_DIR}/local/netCheck` | 网络检测（已废弃，检测到即删除） |
| `LOG_STATISTICS` | `{LOG_DIR}/StatisticsInfo.log` | 统计信息 |
| `LOG_STATISTICS_DIR` | `{LOG_DIR}/StatisticsInfo` | 统计目录 |
| `LOG_DIR_APP_BURY` | `{LOG_DIR}/bury` | 埋点日志 |
| `LOG_DIR_APP_UPLOAD` | `{LOG_DIR}/local/upload` | 上传目录 |
| `LOG_DIR_UPLOAD_BY_FILE` | `{LOG_DIR}/local/upload/file` | 文件方式上传 |
| `LOG_DIR_UPLOAD_BY_IO` | `{LOG_DIR}/local/upload/io` | IO 方式上传 |
| `LOG_DIR_UPLOAD_UN_KNOW` | `{LOG_DIR}/local/upload/unKnow` | 未知类型 |
| `LOG_DIR_APP_ZIP` | `{LOG_DIR}/local/zip` | 压缩包 |
| `BURY_LOG_PATH` | `{STATISTICS_DIR}/timing/file` | 埋点文件 |
| `APP_ERROR_LOG_PATH` | `{STATISTICS_DIR}/timing/string/appUpload` | 应用错误 |
| `APM_LOG_PATH` | `{STATISTICS_DIR}/timing/string/apm` | APM |
| `NETWORK_ERROR_LOG_PATH` | `{STATISTICS_DIR}/realtime/string/networkError` | 网络错误（实时） |
| `CRASH_LOG_PATH` | `{STATISTICS_DIR}/realtime/string/crash` | 崩溃（实时） |
| `NETWROK_INFO_PATH` | `{LOG_DIR}/networkinfo` | 网络信息 |

### 1.3 日志类型（ClientLogType）

| 枚举 | typeName | type | 说明 |
|------|----------|------|------|
| `CRASH` | `crash` | `CRASH` | 崩溃 |
| `ERROR` | `appError` | `ERROR` | 应用错误 |
| `NET_ERROR` | `networkError` | `ERROR` | 网络错误 |
| `UPLOAD` | `appUpload` | `APPLOG` | 上传日志 |
| `APP_DAY_STATISTICS` | `dayStatistics` | `0` | 日统计 |
| `APP_BURY_STATISTICS` | `bury` | `1` | 埋点统计 |
| `APP_TIMING_LOG` | `appTimingLog` | `appTimingLog` | 定时日志 |

## 二、日志服务（LogService）

### 2.1 生命周期

- `onBind`：加载环境、清缓存、启动单线程循环（`looperExecutor`）、开始监听目录
- `onUnbind`：停止循环、关闭线程池、停止监听

### 2.2 主循环（loopRun）

```
每 looperCheckInterval 执行一次：
1. FileCheckUtil.autoCheckXhDir(schoolId)   // 检查目录
2. 有权限(512)时：
   - 删除废弃的 netCheck 目录
   - 已登录（userId >= 0）：
     a. dealRealTimeLog()  —— 实时日志上传
     b. dealTimingLog()    —— 定时日志上传
```

### 2.3 实时日志（dealRealTimeLog）

遍历 `LogServiceConfig.realTimeFiles`：
- `LOG_DIR_CRASH_AND_UPLOAD`
- `LOG_DIR_APP_ERROR`
- `CRASH_LOG_PATH`
- `NETWORK_ERROR_LOG_PATH`

每个目录调用 `ClientLogManager.checkAndUploadKibanaLog(dir)`。

### 2.4 定时日志（dealTimingLog）

- 距上次上传超过 `timingLogCheckInterval` 时：`dumpAllTimingLog()` + 记录时间
- `checkAndUploadFileLogDir(LOG_DIR_UPLOAD_BY_FILE)` —— 文件方式上传
- `checkAndUploadKibanaLog(LOG_DIR_UPLOAD_BY_IO)` —— IO 方式上传

### 2.5 调度间隔（LogServiceConfig）

| 参数 | 有权限(8192) | 无权限 |
|------|-------------|--------|
| `looperCheckInterval` | 30s | `(random(5)+1) * 60s` |
| `timingLogCheckInterval` | 60s | 远程配置 `buryLogInterval`（默认 1h，最小 60s） |

### 2.6 目录监听（LogDirListener）

- 监听 `LOG_DIR_CRASH_AND_UPLOAD` 和 `CRASH_LOG_PATH`
- 文件写入事件（CLOSE_WRITE）触发 `uploadToKibana`
- 过滤：文件不存在 / 无回调 / `ConstStatistics.isFile`（timing/file 目录）不处理
- 仅处理以 `crash` 开头的文件

## 三、日志处理（ClientLogManager）

### 3.1 checkAndUploadKibanaLog

1. 格式化目录
2. 按修改时间排序，取最近 5 个文件
3. 筛选"未使用"文件（`isUnused`：修改时间距今 ≥ 1s）
4. 文件 → `uploadClientLogToKibana`；目录 → 删除

### 3.2 uploadClientLogToKibana

- 文件名格式：`{type}#{packageName}#.log`（`#` 分隔）
- 解析 type（crash/appError/networkError/appUpload → 映射为 CRASH/ERROR/ERROR/APPLOG）
- 调用 `LogUpload.uploadLogToKibana(packageName, filePath, type)`

### 3.3 checkAndUploadFileLogDir

- 遍历目录：子目录 → `checkBigDataLog`；文件 → 删除
- `checkBigDataLog`：
  1. 删除 `.7z` 文件
  2. 筛选 > 524288 字节的文件 → `LogProcessor.splitFile` 分割
  3. 合并小文件（< 471859.2 字节）为 `{dir}_{yyyyMMdd_HHmmss_SSS}_merged.log`
  4. 再次分割合并文件
  5. 每个文件 `LogUpload.uploadBuryToBigData`

### 3.4 dumpAllTimingLog

- 统计日志（`LOG_STATISTICS` / `LOG_STATISTICS_DIR`）→ `APP_DAY_STATISTICS`
- 埋点日志（`LOG_DIR_APP_BURY` / `BURY_LOG_PATH`）→ `APP_BURY_STATISTICS`
- `APP_TIMING_IO_LOG` 下所有文件 → `APP_TIMING_LOG`
- 未使用文件移动到上传目录（`LogFile.createUploadFilePath`）

### 3.5 uploadCatchLog

- 合并 `catch#{pkg}#.log.bak` + `.1` + 主文件 → 上传到日志服务

### 3.6 getAppPid

- 执行 `ps | grep {packageName}` 解析 PID（用于 logcat 过滤）

## 四、日志文件处理工具

### 4.1 LogProcessor

- `splitFile(sourceFile, limitSize)`：按行分割大文件，目标文件 `{name}.patch{index}`，分割后重命名为 `{name}_{ext}.{ext}`，删除源文件
- `mergeFile(fileList, outFile)`：合并多个文件

### 4.2 LogCompress

- AES 加密（密钥不足 16 字节用 `A` 补齐），输出大写 hex
- 用于埋点大数据加密（密钥 `111111`）

### 4.3 LogUpload

**uploadLogToKibana**（客户端日志 → Kibana）：
1. 权限检查（512）、网络检查、`PollInterfaceManager.isIntercept(ERROR_UPLOAD)` 检查
2. 读取文件内容，构造 JSON：`{logContent, packageName, type}`
3. POST `{kibanaServerUrl}/api/v3/users/{userId}/devices/{deviceId}/logs`
4. 成功删除文件 + `requestSuccess`；失败 `requestFail`（触发轮询拦截）

**uploadBuryToBigData**（埋点 → 大数据）：
1. 权限/网络/`BURY_UPLOAD` 拦截检查
2. 读取文件字节 → gzip 压缩 → Base64 → AES 加密（密钥 `111111`）
3. 构造 JSON：`{appId: "clientPlatform", topic: "app_duration", ts, content, sign}`
4. **签名**：`sign = MD5("clientPlatformapp_duration" + content + ts + "111111")`
5. POST `{bigDataUrl}/api/v1/userTrackDataReceiver/collect`
6. 成功删除文件 + `requestSuccess`；失败 `requestFail`

## 五、logcat 抓取（LogcatService / LogcatUtil）

### 5.1 LogcatService

- 单线程池执行 `LogcatUtil.startCatchLog`
- 默认最大 4MB（`LOG_MAX_SIZE = 4194304`），可传 `maxSize` 扩展

### 5.2 LogcatUtil

- 命令：`logcat -v time process | grep {pid}`
- 输出文件：`{sdcard}/xuehai/log/catch#{packageName}#.log`
- 超过大小限制时轮转：主文件 → `.1` 备份
- 过滤行：空行、`SurfaceControl`、`ViewRootImpl`、`AppStorageService`、`XHStreamFetcher`、`ClearConfigLoader`
- 5 分钟无输出自动重置运行状态

## 六、埋点统计体系（com.p017xh.xhcore.common.statistic）

### 6.1 埋点事件（BuryEvent）

字段：`uid`、`uuid`（deviceNum）、`schoolId`、`appPkg`、`appVer`、`type`、`name`、`data`、`time`。

### 6.2 采集流程

```
DataCollectionUtil.setBury(event)
  → BuryStrategyManager.getInstance().bury(event)
    → XHBuryStrategy.bury(event)
      → AppBury.getInstance().addEvent(event)   // 内存队列（上限 10000，溢出丢 500）

App 切后台 / 定时触发：
  → DataCollectionUtil.dumpBury()
    → AppBury.appendBuryEventToFile(getBuryFile())
      → 文件 > 5MB 则轮转 .1
      → 写入 {STATISTICS_DIR}/timing/file/bury_{pkg}_{ver}.log
```

### 6.3 埋点策略（BuryStrategyManager）

按 `XHAppConfigProxy.getBuryConfig()` 选择：
- `XHAnalysysBuryConfig` → `XHAnalysysBuryStrategy`（XH + 数极客双写）
- `AnalysysBuryConfig` → `AnalysysBuryStrategy`（数极客）
- 默认 → `XHBuryStrategy`（本地文件）

### 6.4 定时采样（BuryTimerHelper）

- 采样周期：生产 60s / 调试 3s（`BURY_SAMPLING_PERIOD_CLIENT`）
- 上传周期：生产 300s / 调试 5s（`BURY_SAMPLING_PERIOD_UPLOAD`）
- 每周期收集：连接耗时、下载/上传速度、下载/上传流量、下载次数（内网/外网）

### 6.5 统计类型（ConstStatistics）

| 类型 | 值 | 名称 |
|------|-----|------|
| 连接耗时 | 65538 | `connection_time_consuming` |
| 下载速度 | 65539 | `download_speed` |
| 上传速度 | 65543 | `upload_speed` |
| 下载流量 | 65544 | `download_traffic` |
| 下载次数 | 10238 | `10238` |
| 应用使用 | 11 | `app_usage` |
| HTTPDNS | 2037 | `10122` |

### 6.6 应用使用统计（AppUsageDurationManager）

- 前台记录 `appOnTopStartTime`（nanoTime）
- 切后台时计算时长，写入 `app_usage` 埋点

### 6.7 前台应用记录（TopAppManager）

- 应用切前台时写 `{sdcard}/xuehai/keep/StatisticsKeep.log`（JSON：packageName）

## 七、崩溃上报（XCrashUtil）

### 7.1 初始化

- `XCrash.init`：禁用 Java 崩溃处理器（`disableJavaCrashHandler`），启用 Native 与 ANR
- Native 配置：最多 10 个日志、dump 4 个线程（白名单：Signal Catcher / Jit thread pool / render）
- ANR 配置：最多 10 个日志
- 主线程空闲时检查历史 tombstone 并上传

### 7.2 崩溃处理

- `onCrash`：写崩溃时间 → 解析 tombstone → `reduceInfoInTombstoneMap`（截断 stack）→ `LogManager.getInstance().uploadCrashLog(map)` → 删除 tombstone
- 磁盘耗尽时仅记录，等待网络恢复后上传

## 八、用户反馈上报（BaseUserReportUploader）

### 8.1 流程

```
upload():
  deleteFiles()                    // 清空 userReport 目录
  prepareFilesForZip()             // 收集数据
    - 用户信息（CPVDUser）
    - Activity 栈 / 最近 Activity 列表
    - data.json（序列化自身）
    - 完整 logcat 日志（catch#{pkg}#.log + .1）
  doZip()                          // 打包
  uploadZipAndPostToTrack()        // 上传
    - 上传 zip 到文件服务器
    - POST https://admin.yunzuoye.net/api/track/saveTrack
```

### 8.2 目录

```
{sdcard}/xuehai/log/userReport/{pkg}/
```

### 8.3 上传文件名

```
{errorType}_{code}_{message}_{userId}_{yyyy-MM-dd-HH-mm-ss}_{traceId}.zip
```

### 8.4 上报请求体（UserReportSaveTrackRequestBodyModel）

`iType`（角色类型）、`sAppVersion`、`sCode`、`sName`、`sOfferIds`、`sSchoolId`、`sTaskContent`（HTML 链接指向上传的 zip）。

## 九、日志上传端点汇总

| 用途 | 端点 |
|------|------|
| 客户端日志 → Kibana | `{kibanaServerUrl}/api/v3/users/{userId}/devices/{deviceId}/logs` |
| 埋点 → 大数据 | `{bigDataUrl}/api/v1/userTrackDataReceiver/collect` |
| 文件日志上传 | `http://filesoss.yunzuoye.net/XHFileServer/file/upload/{appCode}` |
| 用户反馈 zip 上传 | `https://filesoss.yunzuoye.net/XHFileServer/file/upload/{appId}/` |
| 用户反馈上报 | `https://admin.yunzuoye.net/api/track/saveTrack` |

## 十、安全观察

1. **埋点加密密钥硬编码**：`111111`（AES + MD5 签名）
2. **日志明文落盘**：logcat 日志、埋点文件均明文存储于 sdcard，可被其他应用读取
3. **上传去重**：`UploadHelper` 用 `path + MD5(file)` 做 LruCache 去重，重复上传直接返回缓存地址
4. **权限门控**：日志上传受 `Permission.checkPermission(512)` 控制，无权限时静默拒绝
5. **轮询拦截**：`PollInterfaceManager` 对 `ERROR_UPLOAD` / `BURY_UPLOAD` 做失败拦截，失败后暂停上传
6. **日志文件大小限制**：单文件 5MB 轮转、上传前分割为 512KB 分片