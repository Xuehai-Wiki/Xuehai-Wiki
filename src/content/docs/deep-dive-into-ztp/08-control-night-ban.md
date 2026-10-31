---
title: "夜禁与管控子系统"

description: "智通平台的夜禁、管控时段、场景控制与时长限制体系，以及服务器配置的拉取与强制机制"

categories:
  - 技术解析
excerpt: 智通平台（夜禁/管控）体系：NightForbidManager/NightControl/ControlManager/ControlServer 的配置拉取、判定与强制机制，默认 22:30-6:00 夜禁、时段/场景/时长控制。
---

# 夜禁与管控子系统

## 一、概述

智通平台在获得服务器下发的管控配置后，会在指定时间段内禁止平板使用（夜禁/管控时段），通过前台 Service、系统策略与全屏界面强制实施。管控体系分布在 `com.xuehai.launcher.control`（UI）与 `com.xuehai.service.control`（核心逻辑）两个包。

## 二、管控类型

管控按 `ControlType` 分三类，统一抽象为 `TimeControl`：

| 类型 | 类 | 说明 |
|------|----|------|
| **夜禁** | `NightControl` | 每日固定时段（如 22:30 - 6:00）禁止使用 |
| **长时间** | `LongTimeControl` | 某应用/应用的连续使用时长限制 |
| **场景** | `SceneControl` | 场景控制（上课/考试等场景时段） |

## 三、夜禁机制

### 3.1 NightForbidManager（UI 侧）

`com.xuehai.launcher.control.NightForbidManager`：管理夜禁状态的轮询通知。

- `getNightForbid()`：从 `ModelFactory.getControlModel().getLongTimeAndNightForbid()` 获取 `LongTimeAndNightForbid`（服务器下发的 curfew 夜禁 + periods 时段 + modeDuration 模式时长 + userDuration 用户时长）
- 若为 ToC 控制类型或无配置：返回 `null`（不启用夜禁）
- 若服务器无夜禁时间：使用本地默认 `NightForbid.getDefaultNightForbid()`（**22:30 - 6:00**）
- 通知循环：`nightForbidRunnable`（LooperTask）在夜禁状态变化时：
  - 通过 EventBus 发送 `EventObject.RefreshTheme` + `RefreshTimeControl`
  - `TimeControlManager.notifyTimeControlChanged(NIGHT_CONTROL)` 触发管控生效
  - 计算下一次检测时间（`DateUtil.transTodayMillis` 时区转换）

### 3.2 NightControl（核心判定）

`com.xuehai.service.control.NightControl`：`checkInControl()` 判定当前时间是否在夜禁内：

```kotlin
fun checkInControl(timeMillis: Long) =
    timeMillis > getFormatBeginTime()      // 过了今日开始时间
    || timeMillis + 86400000 < getFormatEndTime()  // 或还不到今日结束时间（跨日）
```

### 3.3 NightForbid（实体）

`LongTimeAndNightForbid.NightForbid`：
- `isInCurfew(time)` = `time > formatBeginTime || time + 86400000 < formatEndTime`
- `getDefaultNightForbid()`：`beginTime = floorToDayStart + 81000000`（22:30 = 8.1 千万毫秒），`endTime = floorToDayStart + 21600000`（6:00）
- 所有时间转 GMT+8 时区处理

## 四、管控数据拉取（API）

管控配置通过 `com.xuehai.launcher.control.data.ControlRemoteDataSource` 拉取：

| API | 方法 | 说明 |
|-----|------|------|
| `GET /api/v1/config/policy` | GET | 拉取全局策略配置 |
| `GET /api/v1/forbidden/{classId}/detail` | GET | 班级禁用详情 |
| `GET /api/v2/pub/platform/users/forbidden/detail` | GET | 用户禁用详情（V2，**学生端夜禁/管控配置主接口**） |
| `GET /api/v1/forbidden/applications` | GET | 禁用应用列表 |
| `GET /api/v1/curfews/{classId}` | GET | 拉取班级夜禁（curfew）配置 |
| `GET /api/v1/forbidden/{studentId}/fullDetail` | GET | 学生完整管控详情 |
| `GET /api/v1/pub/curfews/{userId}` | GET | 拉取用户夜禁配置 |
| `GET /api/v1/pub/curfews/status/teacher/{userId}/set` | GET | 教师设置夜禁状态 |
| `GET /api/v1/pub/control/classes/modes/options` | GET | 班级管控模式选项 |
| `GET /api/v1/pub/scene` | GET | 场景控制配置 |
| `GET /api/v1/holiday/switch` | GET | 假期开关 |
| `GET /api/v1/platform/student/{userId}/eyeshield/info` | GET | 护眼信息 |

## 五、管控实施机制

### 5.1 TimeControlManager

`com.xuehai.service.control.time.TimeControlManager`：
- `getNightControlData(context, pkg)` — 获取某应用当前夜禁数据
- `getLongTimeControlData(context, pkg)` — 获取长时间控制数据
- `notifyTimeControlChanged(context, type, ...)` — 通知管控类型变化
- `getNightControlDialog()` / `getLongTimeControlDialog()` — 创建管控弹窗

### 5.2 ControlManager

`com.xuehai.service.control.ControlManager`：
- `checkControlStatus(ControlReq)` — 检查场景/长时间/夜禁任一是否生效
- `getControlData(req, forwardTipMinute)` — 按优先级（场景 > 夜禁 > 长时间）选择当前生效的管控
- `createControlDialog(...)` — 创建对应类型的管控弹窗（5 分钟提前提示）
- `findClosedControl()` — 选择更早生效的管控

### 5.3 SyncService 与前台 Service

`com.xuehai.service.control.SyncService`（Manifest 注册）：后台同步服务，定期拉取/同步管控配置，调用 `DataLoader`（`DataLoaderV1`/`V2`）从服务器加载控制数据并缓存。

### 5.4 强制实施

- 管控生效时：`ControlDialogManager`/`ControlDialog` 弹出全屏对话框（学生无法关闭）
- 配合 MDM 设备策略（`PolicyManager.getDevicePolicyProxy()`）锁定屏幕、禁用返回键
- 长时控制/夜禁到期后恢复：`NightForbidManager` 轮询到时段结束发通知恢复
- `ControlsRefreshManager` 负责管控配置的定时刷新

## 六、管控 UI（ControlActivity 等）

| Activity | 说明 |
|----------|------|
| `ControlActivity` | 管控主界面（教师/管理端） |
| `ControlRuleAct` / `AppDetailActivity` / `SchoolControlDetailActivity` | 管控规则/详情 |
| `ControlAppPeriodActivity` / `ControlAppPeriodSettingActivity` | 应用时段管控设置 |
| `CurfewTimeActivity` | 夜禁时间设置 |
| `ControlSettingActivity` | 管控设置 |
| `SearchStudentAct` / `StudentControlAppsAct` / `StudentBatchControlListAct` | 学生管控 |
| `ControlPeriodFragment` / `ControlCurfewFragment` / `ControlOfflineFragment` | 管控配置页 fragment |
| `AIViolationWarningActivity` | AI 违规预警 |

## 七、关键类清单

| 类 | 位置 | 作用 |
|----|------|------|
| `NightForbidManager` | `com.xuehai.launcher.control` | 夜禁状态通知轮询 |
| `NightControl` / `TimeControl` | `com.xuehai.service.control` | 夜禁/时间段判定 |
| `ControlManager` / `ControlServer` | `com.xuehai.service.control` | 管控创建与实施 |
| `ControlRemoteDataSource` | `com.xuehai.launcher.control.data` | 管控配置 API |
| `SyncService` / `ControlService` | `com.xuehai.service.control` | 管控同步服务 |
| `DataLoader` / `DataLoaderV1/V2` | `com.xuehai.service.control.loader` | 管控数据加载 |
| `LongTimeAndNightForbid` | `com.xuehai.launcher.common.data.entity` | 管控数据实体 |
| `ControlSwitch` / `ControlReq` | `com.xuehai.service.control` | 管控开关/请求 |
